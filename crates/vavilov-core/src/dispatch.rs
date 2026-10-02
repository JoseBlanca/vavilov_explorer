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
    Active, History, HistoryStep, Interaction, OpenProject, Project, Selected, SendFailed, Session,
    SharedState,
};
use crate::table::{Categorical, Column, ColumnValues, Role, Table};

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

    /// The set of rows a window sent as bytes with a command made at
    /// `based_on`, for the table of the open project. A command made before
    /// the table was loaded is refused as such, before its bytes are read
    /// against a table they were not made for.
    ///
    /// # Errors
    ///
    /// `MadeBeforeLoad`, `NoProject`, or the refusals of
    /// [`RowSet::from_bytes`].
    pub fn rows_from_window(
        &self,
        bytes: &[u8],
        based_on: Revision,
    ) -> Result<RowSet, CommandError> {
        self.check_based_on(based_on)?;
        let open = self.state.project.open()?;
        RowSet::from_bytes(bytes, open.table.num_rows())
    }

    /// Refuses a command made at a revision still to come, a defect, or
    /// before the current table was loaded.
    pub(crate) fn check_based_on(&self, based_on: Revision) -> Result<(), CommandError> {
        let state = &self.state;
        if based_on > state.revision {
            return Err(CommandError::Defect {
                what: format!(
                    "a command made at revision {based_on}, after the current one, {}",
                    state.revision
                ),
            });
        }
        if based_on < state.loaded_at {
            return Err(CommandError::MadeBeforeLoad {
                based_on,
                loaded_at: state.loaded_at,
            });
        }
        Ok(())
    }

    /// Checks the command and builds what it changes, or `None` when it
    /// changes nothing. It changes nothing itself.
    fn plan(&self, request: Request) -> Result<Option<Plan>, CommandError> {
        self.check_based_on(request.based_on)?;
        let state = &self.state;
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
                    classification(&open.table, column)?;
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
            Command::SelectPopulation { column, selected } => {
                let open = state.project.open()?;
                let active = active_classification(open, column)?;
                if let Some(Selected::Population(code)) = selected {
                    check_level(&open.table, column, code)?;
                }
                if active.selected == selected {
                    return Ok(None);
                }
                plan_active(state, Some(Active { column, selected }), sent_at)
            }
            Command::AssignRows {
                column,
                target,
                rows,
            } => {
                let open = state.project.open()?;
                let codes = lasso(open, column, target, &rows)?;
                let new = match target {
                    Selected::Population(code) => Some(code),
                    Selected::Unassigned => None,
                };
                let changes = rows
                    .rows()
                    .zip(std::iter::repeat(new))
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
                let codes = lasso(open, column, Selected::Population(population), &rows)?;
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
            Command::SetRole { column, role } => {
                let open = state.project.open()?;
                if column == open.table.names().id() {
                    return Err(CommandError::UnknownColumn { column });
                }
                let current = open
                    .table
                    .column(column)
                    .ok_or(CommandError::UnknownColumn { column })?;
                let Some(values) = current.values().with_role(role, column, current.name())? else {
                    return Ok(None);
                };
                plan_edit(
                    state,
                    open,
                    Edit::SetValues { column, values },
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
                let open = open_for_commit(&mut self.state.project)?;
                open.interaction.selection = rows;
                Changed::State(revision)
            }
            Change::Active(active) => {
                let open = open_for_commit(&mut self.state.project)?;
                open.interaction.active = active;
                Changed::State(revision)
            }
            Change::Hover { row, seq } => {
                let open = open_for_commit(&mut self.state.project)?;
                open.interaction.hover = row;
                self.state.hover_seq = seq;
                Changed::Hover(seq)
            }
            Change::Codes {
                column,
                codes,
                step,
            } => {
                let open = open_for_commit(&mut self.state.project)?;
                let Column {
                    revision: column_revision,
                    values,
                    ..
                } = open
                    .table
                    .column_mut(column)
                    .ok_or_else(|| defect(column, "is gone"))?;
                let (ColumnValues::Category(categorical)
                | ColumnValues::Classification(categorical)) = values
                else {
                    return Err(defect(
                        column,
                        "is no longer a category or a classification",
                    ));
                };
                categorical.codes = codes;
                *column_revision = revision;
                open.history.take(step);
                Changed::State(revision)
            }
            Change::Values {
                column,
                values,
                active,
                step,
            } => {
                let open = open_for_commit(&mut self.state.project)?;
                let Column {
                    revision: column_revision,
                    values: slot,
                    ..
                } = open
                    .table
                    .column_mut(column)
                    .ok_or_else(|| defect(column, "is gone"))?;
                *slot = values;
                *column_revision = revision;
                open.shape_at = revision;
                if let Some(active) = active {
                    open.interaction.active = active;
                }
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
    /// New values of a column, with the active classification when the
    /// change clears it.
    Values {
        column: ColumnId,
        values: ColumnValues,
        active: Option<Option<Active>>,
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
    state: &SharedState,
    mut table: Table,
    active_classification: Option<ColumnId>,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    if let Some(column) = active_classification {
        classification(&table, column)?;
    }
    let revision = state.revision.next()?;
    let hover_seq = state.hover_seq.next()?;
    table.set_revisions(revision);
    let project = OpenProject {
        shape_at: revision,
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
    state: &SharedState,
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

/// Plans an edit of the document: what it gives, and its reverse for the
/// history.
fn plan_edit(
    state: &SharedState,
    open: &OpenProject,
    edit: Edit,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Option<Plan>, CommandError> {
    match edit {
        Edit::SetCodes { column, changes } => {
            plan_codes(state, open, column, changes, kind, sent_at)
        }
        Edit::SetValues { column, values } => {
            plan_values(state, open, column, values, kind, sent_at).map(Some)
        }
    }
}

fn step_of(kind: StepKind, reverse: Edit) -> HistoryStep {
    match kind {
        StepKind::Record => HistoryStep::Record(reverse),
        StepKind::Undo => HistoryStep::Undo(reverse),
        StepKind::Redo => HistoryStep::Redo(reverse),
    }
}

/// Plans new values of a column, a change of role or its reverse: the
/// column and the shape of the table take the new revision, and a
/// classification that stops being one stops being the active one.
fn plan_values(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    values: ColumnValues,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    let old = open
        .table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?;
    let step = step_of(
        kind,
        Edit::SetValues {
            column,
            values: old.values().clone(),
        },
    );
    let active = open
        .interaction
        .active
        .filter(|active| active.column == column && values.role() != Role::Classification)
        .map(|_| None);
    let revision = state.revision.next()?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.shape(revision)?;
    if let Some(active) = active {
        message.active(active)?;
    }
    if let ColumnValues::Category(categorical) | ColumnValues::Classification(categorical) = &values
    {
        message.codes(column, revision, categorical.codes())?;
    }
    message.columns(&[(column, revision)])?;
    message.undo(open.history.after(&step))?;
    Ok(Plan {
        revision,
        message: message.finish(),
        change: Change::Values {
            column,
            values,
            active,
            step,
        },
    })
}

/// Plans new codes of some rows of a category or a classification. An
/// edit that changes no row changes nothing.
fn plan_codes(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    changes: Vec<(RowIndex, Option<LevelCode>)>,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Option<Plan>, CommandError> {
    if changes.is_empty() {
        return Ok(None);
    }
    let num_rows = open.table.num_rows();
    let values = open
        .table
        .column(column)
        .and_then(Column::categorical)
        .ok_or_else(|| defect(column, "is not a category or a classification"))?;
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
    let step = step_of(
        kind,
        Edit::SetCodes {
            column,
            changes: reverse,
        },
    );
    let revision = state.revision.next()?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.codes(column, revision, &codes)?;
    message.columns(&[(column, revision)])?;
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

/// The codes of the active classification, for a lasso on `target` with
/// `rows`, once the lasso is checked against the session.
fn lasso<'a>(
    open: &'a OpenProject,
    column: ColumnId,
    target: Selected,
    rows: &RowSet,
) -> Result<&'a [Option<LevelCode>], CommandError> {
    let active = active_classification(open, column)?;
    let selected = active.selected.ok_or(CommandError::NoPopulationSelected)?;
    if selected != target {
        return Err(CommandError::NotSelected { target });
    }
    check_row_set(rows, open.table.num_rows())?;
    Ok(classification(&open.table, column)?.codes())
}

/// The active classification, when it is `column`.
fn active_classification(open: &OpenProject, column: ColumnId) -> Result<Active, CommandError> {
    open.interaction
        .active
        .filter(|active| active.column == column)
        .ok_or(CommandError::NotActiveClassification { column })
}

/// The levels and codes of a classification of the table.
fn classification(table: &Table, column: ColumnId) -> Result<&Categorical, CommandError> {
    if column == table.names().id() {
        return Err(CommandError::NotClassification { column });
    }
    table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?
        .classification()
        .ok_or(CommandError::NotClassification { column })
}

fn check_level(table: &Table, column: ColumnId, code: LevelCode) -> Result<(), CommandError> {
    let num_levels = classification(table, column)?.num_levels()?;
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

/// The open project a planned change applies to; the plan checked it is
/// open, so its absence is a defect, not a refusal.
fn open_for_commit(project: &mut Project) -> Result<&mut OpenProject, CommandError> {
    project.open_mut().map_err(|_| CommandError::Defect {
        what: "a change planned for an open project, and none is open".to_owned(),
    })
}

fn defect(column: ColumnId, what: &str) -> CommandError {
    CommandError::Defect {
        what: format!("column {column}, planned for a change, {what}"),
    }
}
