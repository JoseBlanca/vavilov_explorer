//! The dispatcher: the one function that applies a command to the
//! session (`docs/core.md`, section 4).
//!
//! It works in two steps. The plan checks the command against the session
//! and builds everything the change needs, the new values, the reverse for
//! undo and the bytes of the message; it can fail, and it changes nothing.
//! The commit then applies the plan: it first finds what it changes, which
//! fails only on a defect and before anything is changed, and then only
//! assigns values the plan holds, takes the history step and sends the
//! message.

use crate::command::{Command, Request};
use crate::convert::{u64_from, usize_from};
use crate::edit::Edit;
use crate::error::CommandError;
use crate::ids::{ColumnId, HoverSeq, LevelCode, Revision, RowIndex, SentAt, WindowLabel};
use crate::message::{MessageKind, MessageWriter, whole_state};
use crate::row_set::RowSet;
use crate::session::{
    Active, History, HistoryStep, Interaction, OpenProject, Project, SendFailed, Session,
    SessionState,
};
use crate::table::{Categorical, Column, ColumnValues, Table};

/// What a command applied.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    /// What it changed.
    pub changed: Changed,
    /// The windows whose subscriber failed to send the message, and were
    /// removed. The command was applied all the same; the app reports each
    /// as a defect and reloads the window if it is still open.
    pub dropped: Vec<Dropped>,
}

/// What a command changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Changed {
    /// Nothing: the command asked for the state there was. It took no
    /// revision, sent no message and recorded nothing to undo.
    Nothing,
    /// The hover, with its sequence number; it took no revision.
    Hover(HoverSeq),
    /// The document or the interaction, at this new revision.
    State(Revision),
}

/// A window removed because its subscriber failed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dropped {
    /// The window's label.
    pub label: WindowLabel,
    /// Why its message could not be sent.
    pub reason: SendFailed,
}

impl Session {
    /// Applies the command of `request` whole, or refuses it and changes
    /// nothing. A change takes the next revision and sends one message to
    /// every window, before this returns.
    ///
    /// # Errors
    ///
    /// The refusal, with what the window needs to say why: no project
    /// open, a command made before the current table was loaded, a column,
    /// a level, a population or a row that the table does not have, a set
    /// of rows of the wrong length, nothing to undo or redo; or a `Defect`.
    pub fn dispatch(&mut self, request: Request) -> Result<Outcome, CommandError> {
        match self.plan(request)? {
            Some(plan) => self.commit(plan),
            None => Ok(Outcome {
                changed: Changed::Nothing,
                dropped: Vec::new(),
            }),
        }
    }

    /// Checks the command and builds what it changes, or `None` when it
    /// changes nothing. It changes nothing itself.
    fn plan(&self, request: Request) -> Result<Option<Plan>, CommandError> {
        let state = &self.state;
        if request.based_on > state.revision {
            return Err(CommandError::Defect {
                what: format!(
                    "a command made at revision {}, after the current one, {}",
                    request.based_on, state.revision
                ),
            });
        }
        if request.based_on < state.loaded_at {
            return Err(CommandError::MadeBeforeLoad {
                based_on: request.based_on,
                loaded_at: state.loaded_at,
            });
        }
        let sent_at = request.sent_at;
        match request.command {
            Command::LoadTable {
                table,
                active_classification,
            } => plan_load(state, table, active_classification, sent_at).map(Some),
            Command::SetSelection { rows } => {
                let open = state.project.open()?;
                check_row_set(&rows, open.table.num_rows())?;
                if rows == open.interaction.selection {
                    return Ok(None);
                }
                let revision = state.revision.next()?;
                let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
                message.selection(&rows)?;
                Ok(Some(Plan {
                    revision,
                    message: message.finish(),
                    change: Change::Selection(rows),
                }))
            }
            Command::SetHover { row } => {
                let open = state.project.open()?;
                if let Some(row) = row {
                    check_row(row, open.table.num_rows())?;
                }
                if row == open.interaction.hover {
                    return Ok(None);
                }
                let seq = state.hover_seq.next()?;
                let mut message = MessageWriter::new(MessageKind::Hover, state.revision, sent_at);
                message.hover(seq, row)?;
                Ok(Some(Plan {
                    revision: state.revision,
                    message: message.finish(),
                    change: Change::Hover { row, seq },
                }))
            }
            Command::SetActiveClassification { column } => {
                let open = state.project.open()?;
                if let Some(column) = column {
                    categorical(&open.table, column)?;
                }
                if open.interaction.active.map(|active| active.column) == column {
                    return Ok(None);
                }
                let active = column.map(|column| Active {
                    column,
                    selected: None,
                });
                plan_active(state, active, sent_at)
            }
            Command::SelectPopulation { column, population } => {
                let open = state.project.open()?;
                let active = active_classification(open, column)?;
                if let Some(code) = population {
                    check_level(&open.table, column, code)?;
                }
                if active.selected == population {
                    return Ok(None);
                }
                plan_active(
                    state,
                    Some(Active {
                        column,
                        selected: population,
                    }),
                    sent_at,
                )
            }
            Command::AssignRows {
                column,
                population,
                rows,
            } => {
                let open = state.project.open()?;
                let codes = lasso(open, column, population, &rows)?;
                let changes = rows
                    .rows()
                    .zip(std::iter::repeat(Some(population)))
                    .filter(|(row, new)| code_of(codes, *row) != *new)
                    .collect();
                plan_edit(
                    state,
                    open,
                    Edit::SetCodes { column, changes },
                    StepKind::Record,
                    sent_at,
                )
            }
            Command::UnassignRows {
                column,
                population,
                rows,
            } => {
                let open = state.project.open()?;
                let codes = lasso(open, column, population, &rows)?;
                let changes = rows
                    .rows()
                    .filter(|row| code_of(codes, *row) == Some(population))
                    .map(|row| (row, None))
                    .collect();
                plan_edit(
                    state,
                    open,
                    Edit::SetCodes { column, changes },
                    StepKind::Record,
                    sent_at,
                )
            }
            Command::Undo => {
                let open = state.project.open()?;
                let edit = open
                    .history
                    .undo
                    .last()
                    .ok_or(CommandError::NothingToUndo)?;
                plan_edit(state, open, edit.clone(), StepKind::Undo, sent_at)
            }
            Command::Redo => {
                let open = state.project.open()?;
                let edit = open
                    .history
                    .redo
                    .last()
                    .ok_or(CommandError::NothingToRedo)?;
                plan_edit(state, open, edit.clone(), StepKind::Redo, sent_at)
            }
        }
    }

    /// Applies a plan. It first finds what it changes, which fails only on
    /// a defect and before anything is changed; from there it only assigns.
    fn commit(&mut self, plan: Plan) -> Result<Outcome, CommandError> {
        let Plan {
            revision,
            message,
            change,
        } = plan;
        let changed = match change {
            Change::Load { project, hover_seq } => {
                self.state.project = Project::Open(project);
                self.state.loaded_at = revision;
                self.state.hover_seq = hover_seq;
                Changed::State(revision)
            }
            Change::Selection(rows) => {
                let open = self.state.project.open_mut()?;
                open.interaction.selection = rows;
                Changed::State(revision)
            }
            Change::Active(active) => {
                let open = self.state.project.open_mut()?;
                open.interaction.active = active;
                Changed::State(revision)
            }
            Change::Hover { row, seq } => {
                let open = self.state.project.open_mut()?;
                open.interaction.hover = row;
                self.state.hover_seq = seq;
                Changed::Hover(seq)
            }
            Change::Codes {
                column,
                codes,
                step,
            } => {
                let open = self.state.project.open_mut()?;
                let Column {
                    revision: column_revision,
                    values,
                    ..
                } = open
                    .table
                    .column_mut(column)
                    .ok_or_else(|| defect(column, "is gone"))?;
                let ColumnValues::Categorical(categorical) = values else {
                    return Err(defect(column, "is no longer categorical"));
                };
                categorical.codes = codes;
                *column_revision = revision;
                open.history.take(step);
                Changed::State(revision)
            }
        };
        self.state.revision = revision;
        let dropped = self
            .subscribers
            .broadcast(&message)
            .into_iter()
            .map(|(label, reason)| Dropped { label, reason })
            .collect();
        Ok(Outcome { changed, dropped })
    }
}

/// What a command will change, with the revision the session will be at
/// and the message to send, all built before anything is changed.
struct Plan {
    revision: Revision,
    message: Vec<u8>,
    change: Change,
}

/// The new values a command gives.
enum Change {
    Load {
        project: Box<OpenProject>,
        hover_seq: HoverSeq,
    },
    Selection(RowSet),
    Active(Option<Active>),
    Hover {
        row: Option<RowIndex>,
        seq: HoverSeq,
    },
    Codes {
        column: ColumnId,
        codes: Vec<Option<LevelCode>>,
        step: HistoryStep,
    },
}

/// Whether an edit is new, an undo or a redo.
#[derive(Clone, Copy)]
enum StepKind {
    Record,
    Undo,
    Redo,
}

fn plan_load(
    state: &SessionState,
    mut table: Table,
    active_classification: Option<ColumnId>,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    if let Some(column) = active_classification {
        categorical(&table, column)?;
    }
    let revision = state.revision.next()?;
    let hover_seq = state.hover_seq.next()?;
    table.set_revisions(revision);
    let project = OpenProject {
        interaction: Interaction {
            active: active_classification.map(|column| Active {
                column,
                selected: None,
            }),
            selection: RowSet::empty(table.num_rows()),
            hover: None,
        },
        history: History::default(),
        table,
    };
    let message = whole_state(
        MessageKind::Change,
        revision,
        sent_at,
        Some(&project),
        revision,
        hover_seq,
    )?;
    Ok(Plan {
        revision,
        message,
        change: Change::Load {
            project: Box::new(project),
            hover_seq,
        },
    })
}

fn plan_active(
    state: &SessionState,
    active: Option<Active>,
    sent_at: Option<SentAt>,
) -> Result<Option<Plan>, CommandError> {
    let revision = state.revision.next()?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.active(active)?;
    Ok(Some(Plan {
        revision,
        message: message.finish(),
        change: Change::Active(active),
    }))
}

/// Plans an edit of the document: the codes it gives, and its reverse
/// for the history. An edit that changes no row changes nothing.
fn plan_edit(
    state: &SessionState,
    open: &OpenProject,
    edit: Edit,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Option<Plan>, CommandError> {
    let Edit::SetCodes { column, changes } = edit;
    if changes.is_empty() {
        return Ok(None);
    }
    let num_rows = open.table.num_rows();
    let values = categorical(&open.table, column)?;
    let num_levels = values.num_levels()?;
    let mut codes = values.codes().to_vec();
    let mut reverse = Vec::with_capacity(changes.len());
    for (row, new) in changes {
        if let Some(code) = new
            && u32::from(code.get()) >= num_levels
        {
            return Err(CommandError::UnknownLevel {
                column,
                code,
                num_levels,
            });
        }
        let slot = codes
            .get_mut(usize_from(row.get()))
            .ok_or(CommandError::RowOutOfRange { row, num_rows })?;
        reverse.push((row, *slot));
        *slot = new;
    }
    let reverse = Edit::SetCodes {
        column,
        changes: reverse,
    };
    let step = match kind {
        StepKind::Record => HistoryStep::Record(reverse),
        StepKind::Undo => HistoryStep::Undo(reverse),
        StepKind::Redo => HistoryStep::Redo(reverse),
    };
    let revision = state.revision.next()?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.codes(column, revision, &codes)?;
    message.columns(std::iter::once((column, revision)))?;
    message.undo(open.history.after(&step))?;
    Ok(Some(Plan {
        revision,
        message: message.finish(),
        change: Change::Codes {
            column,
            codes,
            step,
        },
    }))
}

/// The codes of the active classification, for a lasso on `population`
/// with `rows`, once the lasso is checked against the session.
fn lasso<'a>(
    open: &'a OpenProject,
    column: ColumnId,
    population: LevelCode,
    rows: &RowSet,
) -> Result<&'a [Option<LevelCode>], CommandError> {
    let active = active_classification(open, column)?;
    let selected = active.selected.ok_or(CommandError::NoPopulationSelected)?;
    if selected != population {
        return Err(CommandError::NotSelectedPopulation { code: population });
    }
    check_row_set(rows, open.table.num_rows())?;
    Ok(categorical(&open.table, column)?.codes())
}

/// The active classification, when it is `column`.
fn active_classification(open: &OpenProject, column: ColumnId) -> Result<Active, CommandError> {
    open.interaction
        .active
        .filter(|active| active.column == column)
        .ok_or(CommandError::NotActiveClassification { column })
}

/// The values of a categorical column of the table.
fn categorical(table: &Table, column: ColumnId) -> Result<&Categorical, CommandError> {
    table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?
        .categorical()
        .ok_or(CommandError::NotCategorical { column })
}

fn check_level(table: &Table, column: ColumnId, code: LevelCode) -> Result<(), CommandError> {
    let num_levels = categorical(table, column)?.num_levels()?;
    if u32::from(code.get()) >= num_levels {
        return Err(CommandError::UnknownLevel {
            column,
            code,
            num_levels,
        });
    }
    Ok(())
}

fn check_row(row: RowIndex, num_rows: u32) -> Result<(), CommandError> {
    if row.get() >= num_rows {
        return Err(CommandError::RowOutOfRange { row, num_rows });
    }
    Ok(())
}

/// Checks that a set of rows is for a table of `num_rows` rows.
fn check_row_set(rows: &RowSet, num_rows: u32) -> Result<(), CommandError> {
    if rows.num_rows() != num_rows {
        return Err(CommandError::RowSetLength {
            num_rows,
            num_bytes: u64_from(rows.as_bytes().len()),
        });
    }
    Ok(())
}

/// The code of `row`, which the lasso checked is in the table.
fn code_of(codes: &[Option<LevelCode>], row: RowIndex) -> Option<LevelCode> {
    codes.get(usize_from(row.get())).copied().flatten()
}

fn defect(column: ColumnId, what: &str) -> CommandError {
    CommandError::Defect {
        what: format!("column {column}, planned for a change, {what}"),
    }
}
