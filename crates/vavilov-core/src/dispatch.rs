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

mod cells;
mod levels;

use crate::command::{Command, Request};
use crate::convert::{u64_from, usize_from};
use crate::edit::Edit;
use crate::error::CommandError;
use crate::filter::texts::NumberTexts;
use crate::filter::{
    Condition, Filter, MAX_FILTER_TEXT, MovedCodes, Replaced, fits, fitted, shown_rows,
};
use crate::ids::{ColumnId, HoverSeq, LevelCode, Revision, RowIndex, SentAt, WindowLabel};
use crate::message::{MessageKind, MessageWriter, whole_state};
use crate::row_set::RowSet;
use crate::session::{
    Active, EditMode, History, HistoryStep, Interaction, OpenProject, Project, Selected,
    SelectedGroups, SendFailed, Session, SharedState, Shown,
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
    /// The widgets the command left with a column they cannot show, all of
    /// them after a load: the session no longer has them nor their
    /// subscribers, and the caller closes their windows once it has
    /// released the lock (`docs/core.md`, section 7).
    pub closed: Vec<WindowLabel>,
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
    /// a level, a group or a row that the table does not have, a set
    /// of rows of the wrong length, nothing to undo or redo; or a `Defect`.
    pub fn dispatch(&mut self, request: Request) -> Result<Outcome, CommandError> {
        self.keep_number_texts(&request.command)?;
        match self.plan(request)? {
            Some(plan) => self.commit(plan),
            None => Ok(Outcome {
                changed: Changed::Nothing,
                dropped: Vec::new(),
                closed: Vec::new(),
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

    /// Writes the texts of the decimal numbers a search by `command` will
    /// read, when it searches: a filter with a text, or an edit while the
    /// filter has one. They are not part of the state, so a command refused
    /// after this has still changed nothing.
    fn keep_number_texts(&mut self, command: &Command) -> Result<(), CommandError> {
        let Project::Open(open) = &mut self.state.project else {
            return Ok(());
        };
        let mark = match command {
            Command::SetFilter {
                filter,
                decimal_mark,
            } => {
                // The mark is checked before the texts are written with it, as
                // the command checks it again: one of any length would write
                // every decimal number of the table with it.
                check_decimal_mark(decimal_mark, "a filter")?;
                filter.reads_number_texts().then(|| decimal_mark.clone())
            }
            Command::LoadTable { .. }
            | Command::SetHover { .. }
            | Command::SetActiveClassification { .. }
            | Command::SelectGroups { .. }
            // A group added holds no row, so no row matches anew.
            | Command::AddGroup { .. } => None,
            // A selection assigns the rows that enter it while + or − is
            // pressed.
            Command::SetSelection { .. }
            | Command::SetEditMode { .. }
            | Command::AssignRows { .. }
            | Command::UnassignRows { .. }
            | Command::DeleteGroup { .. }
            | Command::EditGroup { .. }
            | Command::SetRole { .. }
            | Command::SetCells { .. }
            | Command::Undo
            | Command::Redo => {
                if open.interaction.filter.reads_number_texts() {
                    open.interaction.decimal_mark.clone()
                } else {
                    None
                }
            }
        };
        match mark {
            Some(mark) => open.number_texts.refresh(&open.table, &mark),
            None => Ok(()),
        }
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
        let based_on = request.based_on;
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
                let entering = rows
                    .rows()
                    .filter(|row| !open.interaction.selection.contains(*row));
                if let Some((column, changes)) =
                    pressed_changes(&open.table, open.interaction.active.as_ref(), entering)?
                    && !changes.is_empty()
                {
                    let also = Also {
                        selection: Some(rows),
                        active: None,
                    };
                    return plan_codes(
                        state,
                        open,
                        column,
                        changes,
                        StepKind::Record,
                        also,
                        sent_at,
                    );
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
            Command::SetFilter {
                filter,
                decimal_mark,
            } => {
                let open = state.project.open()?;
                check_decimal_mark(&decimal_mark, "a filter")?;
                let length = filter.text().map_or(0, |text| text.chars().count());
                if length > MAX_FILTER_TEXT {
                    return Err(CommandError::Defect {
                        what: format!(
                            "a filter's text of {length} characters, more than the find bar's {MAX_FILTER_TEXT}"
                        ),
                    });
                }
                // A group chosen from a list the groups have changed since is
                // stale, as every command that names a group is.
                if let (Some(column), Condition::Group { code: Some(_) }) =
                    (filter.column, &filter.condition)
                {
                    check_levels_at(open, column, based_on)?;
                }
                if !fits(&filter, &open.table)? {
                    return Err(CommandError::Defect {
                        what: format!(
                            "a filter {:?} on column {:?}, which does not fit it",
                            filter.condition, filter.column
                        ),
                    });
                }
                if filter == open.interaction.filter
                    && Some(&decimal_mark) == open.interaction.decimal_mark.as_ref()
                {
                    return Ok(None);
                }
                let rows = shown_rows(
                    &filter,
                    Some(&decimal_mark),
                    &open.table,
                    None,
                    &open.number_texts,
                )?;
                let revision = state.revision.next()?;
                let shown = Shown { rows, at: revision };
                let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
                message.filter(&filter, Some(&decimal_mark), &shown, open.table.num_rows())?;
                Ok(Some(Plan {
                    revision,
                    message: message.finish(),
                    change: Change::Filter {
                        filter,
                        decimal_mark,
                        shown,
                    },
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
                if open.interaction.active.as_ref().map(|active| active.column) == column {
                    return Ok(None);
                }
                let active = column.map(|column| Active {
                    column,
                    selected: SelectedGroups::none(),
                    mode: None,
                });
                plan_active(state, active, sent_at)
            }
            Command::SelectGroups { column, selected } => {
                let open = state.project.open()?;
                let active = active_classification(open, column)?;
                if !selected.groups().is_empty() {
                    // Made before a level was removed: a code may name
                    // another group, or none.
                    check_levels_at(open, column, based_on)?;
                    for code in selected.groups() {
                        check_level(&open.table, column, *code)?;
                    }
                }
                if active.selected == selected {
                    return Ok(None);
                }
                // Another selection releases + or −.
                let active = Active {
                    column,
                    selected,
                    mode: None,
                };
                plan_active(state, Some(active), sent_at)
            }
            Command::SetEditMode {
                column,
                selected,
                mode,
            } => {
                let open = state.project.open()?;
                let active = active_classification(open, column)?;
                if !selected.groups().is_empty() {
                    check_levels_at(open, column, based_on)?;
                }
                if active.selected != selected {
                    return Err(CommandError::NotSelected);
                }
                if active.mode == mode {
                    return Ok(None);
                }
                if mode.is_some() && selected.is_empty() {
                    return Err(CommandError::NoGroupSelected);
                }
                check_button(mode, &selected)?;
                let pressed = Active {
                    column,
                    selected,
                    mode,
                };
                if let Some((column, changes)) = pressed_changes(
                    &open.table,
                    Some(&pressed),
                    open.interaction.selection.rows(),
                )? && !changes.is_empty()
                {
                    let also = Also {
                        selection: None,
                        active: Some(Some(pressed)),
                    };
                    return plan_codes(
                        state,
                        open,
                        column,
                        changes,
                        StepKind::Record,
                        also,
                        sent_at,
                    );
                }
                plan_active(state, Some(pressed), sent_at)
            }
            Command::AssignRows {
                column,
                target,
                rows,
            } => {
                let open = state.project.open()?;
                if let Selected::Group(_) = target {
                    active_classification(open, column)?;
                    check_levels_at(open, column, based_on)?;
                }
                let codes = lasso(open, column, &SelectedGroups::one(target), &rows)?;
                let new = match target {
                    Selected::Group(code) => Some(code),
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
                selected,
                rows,
            } => {
                let open = state.project.open()?;
                active_classification(open, column)?;
                check_levels_at(open, column, based_on)?;
                let codes = lasso(open, column, &selected, &rows)?;
                check_button(Some(EditMode::Remove), &selected)?;
                let changes = rows
                    .rows()
                    .filter(|row| {
                        code_of(codes, *row).is_some_and(|code| selected.holds(Some(code)))
                    })
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
            Command::AddGroup {
                column,
                name,
                decimal_mark,
            } => {
                let open = state.project.open()?;
                levels::plan_add_group(state, open, column, &name, &decimal_mark, sent_at).map(Some)
            }
            Command::DeleteGroup { column, group } => {
                let open = state.project.open()?;
                levels::plan_delete_group(state, open, column, group, based_on, sent_at).map(Some)
            }
            Command::EditGroup {
                column,
                group,
                name,
                colour,
                decimal_mark,
            } => {
                let open = state.project.open()?;
                let edited = levels::Edited {
                    column,
                    group,
                    name: &name,
                    colour,
                    decimal_mark: &decimal_mark,
                };
                levels::plan_edit_group(state, open, &edited, based_on, sent_at)
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
            Command::SetCells {
                column,
                rows,
                text,
                decimal_mark,
            } => {
                let open = state.project.open()?;
                cells::plan_set_cells(state, open, column, &rows, text, &decimal_mark, sent_at)
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
    /// The widgets the change leaves with a column they cannot show are
    /// dropped before the message is sent, so that their windows, which
    /// the caller closes, receive nothing more.
    fn commit(&mut self, plan: Plan) -> Result<Outcome, CommandError> {
        let Plan {
            revision,
            message,
            change,
        } = plan;
        let widgets_before = self.widget_labels();
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
            Change::Filter {
                filter,
                decimal_mark,
                shown,
            } => {
                let open = open_for_commit(&mut self.state.project)?;
                open.interaction.filter = filter;
                open.interaction.decimal_mark = Some(decimal_mark);
                open.interaction.shown = shown;
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
                shown,
                selection,
                active,
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
                let Some(categorical) = values.categorical_mut() else {
                    return Err(defect(column, "is no longer a category"));
                };
                categorical.codes = codes;
                *column_revision = revision;
                if let Some(Refiltered { filter, shown }) = shown {
                    open.interaction.filter = filter;
                    open.interaction.shown = shown;
                }
                if let Some(selection) = selection {
                    open.interaction.selection = selection;
                }
                if let Some(active) = active {
                    open.interaction.active = active;
                }
                open.history.take(step);
                Changed::State(revision)
            }
            Change::Cells {
                column,
                values,
                shown,
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
                if let Some(Refiltered { filter, shown }) = shown {
                    open.interaction.filter = filter;
                    open.interaction.shown = shown;
                }
                open.history.take(step);
                Changed::State(revision)
            }
            Change::Names { names, shown, step } => {
                let open = open_for_commit(&mut self.state.project)?;
                open.table.set_names(names, revision);
                if let Some(Refiltered { filter, shown }) = shown {
                    open.interaction.filter = filter;
                    open.interaction.shown = shown;
                }
                open.history.take(step);
                Changed::State(revision)
            }
            Change::Values {
                column,
                values,
                active,
                shown,
                step,
            } => {
                let open = open_for_commit(&mut self.state.project)?;
                let Column {
                    revision: column_revision,
                    levels_at,
                    values: slot,
                    ..
                } = open
                    .table
                    .column_mut(column)
                    .ok_or_else(|| defect(column, "is gone"))?;
                *slot = values;
                *column_revision = revision;
                *levels_at = revision;
                open.shape_at = revision;
                if let Some(active) = active {
                    open.interaction.active = active;
                }
                if let Some(Refiltered { filter, shown }) = shown {
                    open.interaction.filter = filter;
                    open.interaction.shown = shown;
                }
                open.history.take(step);
                Changed::State(revision)
            }
            Change::Levels {
                column,
                values,
                levels_at,
                active,
                shown,
                step,
            } => {
                let open = open_for_commit(&mut self.state.project)?;
                let Column {
                    revision: column_revision,
                    levels_at: column_levels_at,
                    values: slot,
                    ..
                } = open
                    .table
                    .column_mut(column)
                    .ok_or_else(|| defect(column, "is gone"))?;
                if slot.role() != values.role() {
                    return Err(defect(column, "has another role"));
                }
                *slot = values;
                *column_revision = revision;
                if let Some(levels_at) = levels_at {
                    *column_levels_at = levels_at;
                }
                open.shape_at = revision;
                if let Some(active) = active {
                    open.interaction.active = active;
                }
                if let Some(Refiltered { filter, shown }) = shown {
                    open.interaction.filter = filter;
                    open.interaction.shown = shown;
                }
                open.history.take(step);
                Changed::State(revision)
            }
        };
        self.state.revision = revision;
        let closed = self.drop_unfit_widgets(widgets_before);
        let dropped = self
            .subscribers
            .broadcast(&message)
            .into_iter()
            .map(|(label, reason)| Dropped { label, reason })
            .collect();
        Ok(Outcome {
            changed,
            dropped,
            closed,
        })
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
    Filter {
        filter: Filter,
        decimal_mark: String,
        shown: Shown,
    },
    Hover {
        row: Option<RowIndex>,
        seq: HoverSeq,
    },
    /// New codes of a category, with the rows shown when they change, and
    /// the selection or the active classification when the command sets
    /// them.
    Codes {
        column: ColumnId,
        codes: Vec<Option<LevelCode>>,
        shown: Option<Refiltered>,
        selection: Option<RowSet>,
        active: Option<Option<Active>>,
        step: HistoryStep,
    },
    /// New values of some cells of a column of numbers or text, the whole
    /// column as they leave it, with the rows shown when they change.
    Cells {
        column: ColumnId,
        values: ColumnValues,
        shown: Option<Refiltered>,
        step: HistoryStep,
    },
    /// New names of some individuals, all of them as they leave them, with
    /// the rows shown when they change.
    Names {
        names: Vec<String>,
        shown: Option<Refiltered>,
        step: HistoryStep,
    },
    /// New values of a column, with the active classification when the
    /// change clears it, and the rows shown when they change.
    Values {
        column: ColumnId,
        values: ColumnValues,
        active: Option<Option<Active>>,
        shown: Option<Refiltered>,
        step: HistoryStep,
    },
    /// New levels of a category, and its codes, as values of its role,
    /// with the revision its levels take when a code may now mean another
    /// group, the active classification when the change sets it, and
    /// the rows shown when they change.
    Levels {
        column: ColumnId,
        values: ColumnValues,
        levels_at: Option<Revision>,
        active: Option<Option<Active>>,
        shown: Option<Refiltered>,
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
                selected: SelectedGroups::none(),
                mode: None,
            }),
            selection: RowSet::empty(table.num_rows()),
            hover: None,
            filter: Filter::none(),
            decimal_mark: None,
            shown: Shown {
                rows: None,
                at: revision,
            },
        },
        history: History::default(),
        table,
        number_texts: NumberTexts::default(),
        widgets: Vec::new(),
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
    message.active(active.as_ref())?;
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
            plan_codes(state, open, column, changes, kind, Also::NOTHING, sent_at)
        }
        Edit::SetValues { column, values } => {
            plan_values(state, open, column, values, kind, sent_at).map(Some)
        }
        Edit::SetCells { column, changes } => {
            cells::plan_cells(state, open, column, changes, kind, sent_at)
        }
        Edit::SetNames { changes } => cells::plan_names(state, open, changes, kind, sent_at),
        Edit::InsertLevel {
            column,
            code,
            level,
            colour,
            rows,
        } => {
            let inserted = levels::Inserted {
                code,
                level,
                colour,
                rows,
            };
            levels::plan_insert_level(state, open, column, inserted, None, kind, sent_at).map(Some)
        }
        Edit::DeleteLevel { column, code } => {
            levels::plan_delete_level(state, open, column, code, kind, sent_at).map(Some)
        }
        Edit::SetLevel {
            column,
            code,
            level,
            colour,
        } => levels::plan_set_level(state, open, column, (code, level, colour), kind, sent_at)
            .map(Some),
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
/// column and the shape of the table take the new revision; an active
/// classification made a number or text stops being active, and one that
/// stays a category loses its selected group.
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
    // The active classification stays active while it is a category, of
    // countries or not,
    // but its levels may have been built again, so its codes may mean other
    // groups: what was selected for editing is cleared.
    let active = open
        .interaction
        .active
        .as_ref()
        .filter(|active| active.column == column)
        .map(|_| {
            values.role().is_categorical().then_some(Active {
                column,
                selected: SelectedGroups::none(),
                mode: None,
            })
        });
    let revision = state.revision.next()?;
    // For the same reason a filter by one of its groups is cleared: a code
    // kept would name another group (docs/design.md, section 2.1).
    let cleared = |_: LevelCode| None;
    let shown = refiltered(
        open,
        Replaced::Values(column, &values),
        revision,
        Some((column, &cleared)),
    )?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.shape(revision)?;
    if let Some(active) = &active {
        message.active(active.as_ref())?;
    }
    if let Some(refiltered) = &shown {
        message.filter(
            &refiltered.filter,
            open.interaction.decimal_mark.as_deref(),
            &refiltered.shown,
            open.table.num_rows(),
        )?;
    }
    if let Some(categorical) = values.categorical() {
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
            shown,
            step,
        },
    })
}

/// What a change of codes sets of the interaction in the same command: the
/// selection whose new rows it assigns, or the button pressed whose rows
/// selected it assigns.
struct Also {
    selection: Option<RowSet>,
    active: Option<Option<Active>>,
}

impl Also {
    /// Nothing of the interaction: a lasso, an edit of a cell, an undo.
    const NOTHING: Self = Self {
        selection: None,
        active: None,
    };
}

/// The rows whose code changes, each with its new code, in the order of
/// the rows.
type CodeChanges = Vec<(RowIndex, Option<LevelCode>)>;

/// The codes that the rows `entering` the selection take while + or − is
/// pressed on `active`, with the column, or `None` when no button is
/// pressed. + gives them the one row selected, a group or none; − leaves
/// unassigned those in a selected group. A row already where the button
/// puts it is left out.
fn pressed_changes(
    table: &Table,
    active: Option<&Active>,
    entering: impl Iterator<Item = RowIndex>,
) -> Result<Option<(ColumnId, CodeChanges)>, CommandError> {
    let Some(Active {
        column,
        selected,
        mode: Some(mode),
    }) = active
    else {
        return Ok(None);
    };
    check_button(Some(*mode), selected)?;
    let codes = classification(table, *column)?.codes();
    let changes = match mode {
        EditMode::Add => {
            let new = match selected.single() {
                Some(Selected::Group(code)) => Some(code),
                Some(Selected::Unassigned) => None,
                None => {
                    return Err(CommandError::Defect {
                        what: "+ pressed with other than one row selected".to_owned(),
                    });
                }
            };
            entering
                .filter(|row| code_of(codes, *row) != new)
                .map(|row| (row, new))
                .collect()
        }
        EditMode::Remove => entering
            .filter(|row| code_of(codes, *row).is_some_and(|code| selected.holds(Some(code))))
            .map(|row| (row, None))
            .collect(),
    };
    Ok(Some((*column, changes)))
}

/// Refuses as a defect a button that cannot act on `selected`, which a
/// window does not offer: + with other than one row selected, and − with
/// no group among them.
fn check_button(mode: Option<EditMode>, selected: &SelectedGroups) -> Result<(), CommandError> {
    let offered = match mode {
        None => true,
        Some(EditMode::Add) => selected.single().is_some(),
        Some(EditMode::Remove) => !selected.groups().is_empty(),
    };
    if offered {
        return Ok(());
    }
    Err(CommandError::Defect {
        what: format!("{mode:?} pressed on {:?}", selected.groups()),
    })
}

/// Plans new codes of some rows of a category, with what `also` sets of
/// the interaction in the same command. An edit that changes no row
/// changes nothing.
fn plan_codes(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    changes: Vec<(RowIndex, Option<LevelCode>)>,
    kind: StepKind,
    also: Also,
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
        .ok_or_else(|| defect(column, "is not a category"))?;
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
    let shown = refiltered(open, Replaced::Codes(column, &codes), revision, None)?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    if let Some(active) = &also.active {
        message.active(active.as_ref())?;
    }
    if let Some(selection) = &also.selection {
        message.selection(selection)?;
    }
    message.codes(column, revision, &codes)?;
    message.columns(&[(column, revision)])?;
    message.undo(open.history.after(&step))?;
    if let Some(refiltered) = &shown {
        message.filter(
            &refiltered.filter,
            open.interaction.decimal_mark.as_deref(),
            &refiltered.shown,
            num_rows,
        )?;
    }
    Ok(Some(Plan {
        revision,
        message: message.finish(),
        change: Change::Codes {
            column,
            codes,
            shown,
            selection: also.selection,
            active: also.active,
            step,
        },
    }))
}

/// The filter as an edit leaves it, fitted to its column, and the rows it
/// shows then.
struct Refiltered {
    filter: Filter,
    shown: Shown,
}

/// The filter once `replaced` is applied, its group moved by `moved` when
/// the groups of `moved`'s column are renumbered and the whole fitted to its
/// column (`filter::fitted`), and the rows it shows, taking the edit's
/// `revision`; `None` when neither the filter nor the rows change, so that
/// the pages a window holds stay good.
fn refiltered(
    open: &OpenProject,
    replaced: Replaced<'_>,
    revision: Revision,
    moved: Option<MovedCodes<'_>>,
) -> Result<Option<Refiltered>, CommandError> {
    let filter = fitted(&open.interaction.filter, &open.table, Some(replaced), moved)?;
    let rows = shown_rows(
        &filter,
        open.interaction.decimal_mark.as_deref(),
        &open.table,
        Some(replaced),
        &open.number_texts,
    )?;
    if filter == open.interaction.filter && rows == open.interaction.shown.rows {
        return Ok(None);
    }
    Ok(Some(Refiltered {
        filter,
        shown: Shown { rows, at: revision },
    }))
}

/// The codes of the active classification, for a lasso made with
/// `expected` selected, with `rows`, once the lasso is checked against the
/// session.
fn lasso<'a>(
    open: &'a OpenProject,
    column: ColumnId,
    expected: &SelectedGroups,
    rows: &RowSet,
) -> Result<&'a [Option<LevelCode>], CommandError> {
    let active = active_classification(open, column)?;
    if active.selected.is_empty() {
        return Err(CommandError::NoGroupSelected);
    }
    if active.selected != *expected {
        return Err(CommandError::NotSelected);
    }
    check_row_set(rows, open.table.num_rows())?;
    Ok(classification(&open.table, column)?.codes())
}

/// The active classification, when it is `column`.
fn active_classification(open: &OpenProject, column: ColumnId) -> Result<&Active, CommandError> {
    open.interaction
        .active
        .as_ref()
        .filter(|active| active.column == column)
        .ok_or(CommandError::NotActiveClassification { column })
}

/// The levels and codes of a category of the table, which can be the
/// active classification.
fn classification(table: &Table, column: ColumnId) -> Result<&Categorical, CommandError> {
    if column == table.names().id() {
        return Err(CommandError::NotCategory { column });
    }
    table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?
        .categorical()
        .ok_or(CommandError::NotCategory { column })
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

/// Refuses a command that names a level of `column` and was made, at
/// `based_on`, before the column's levels last changed other than by one
/// added last, since its code may now mean another group
/// (`docs/core.md`, section 4).
fn check_levels_at(
    open: &OpenProject,
    column: ColumnId,
    based_on: Revision,
) -> Result<(), CommandError> {
    let levels_at = open
        .table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?
        .levels_at;
    if based_on < levels_at {
        return Err(CommandError::LevelsChanged {
            column,
            based_on,
            levels_at,
        });
    }
    Ok(())
}

/// Refuses as a defect a decimal mark that no region has: one character
/// on macOS, at most three on Windows, by `LOCALE_SDECIMAL`. `what` says
/// what came with it.
fn check_decimal_mark(decimal_mark: &str, what: &str) -> Result<(), CommandError> {
    if !(1..=3).contains(&decimal_mark.chars().count()) {
        return Err(CommandError::Defect {
            what: format!("{what} with the decimal mark {decimal_mark:?}"),
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
