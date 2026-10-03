//! The plans of the changes to the levels of a category: a population
//! added to the active classification (`docs/design.md`, section 2.1), and
//! the edits that add and remove a level for undo and redo. No code
//! changes, so the rows the filter shows stay as they are.

use super::{Change, Plan, StepKind, active_classification, check_decimal_mark, step_of};
use crate::cells::new_level;
use crate::convert::usize_from;
use crate::edit::Edit;
use crate::error::{CommandError, PopulationRefusal};
use crate::ids::{ColumnId, SentAt};
use crate::message::{MessageKind, MessageWriter};
use crate::session::{Active, HistoryStep, OpenProject, Selected, SharedState};
use crate::table::{Categorical, Colour, Level, MAX_LEVELS, level_code, unused_colour};
use crate::text::nfc;

/// Whether a change of levels can make a code mean another population, so
/// that a command made before it that names a level is refused.
#[derive(Clone, Copy)]
enum Meaning {
    /// Every code means what it meant: a level added after the last.
    Kept,
    /// A code may mean another population: a level removed.
    MayChange,
}

/// The new levels of a column, and what else the change sets.
struct NewLevels {
    column: ColumnId,
    categorical: Categorical,
    /// The active classification, when the change sets it.
    active: Option<Option<Active>>,
    meaning: Meaning,
    step: HistoryStep,
}

/// Plans a population named `name` added last to the active
/// classification `column`, with the first colour of the list none of its
/// populations has, and selected for editing.
pub(super) fn plan_add_population(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    name: &str,
    decimal_mark: &str,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    check_decimal_mark(decimal_mark, "a population's name")?;
    active_classification(open, column)?;
    let found = open
        .table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?;
    let categorical = found
        .categorical()
        .ok_or(CommandError::NotCategory { column })?;
    let refused = |refusal| CommandError::PopulationRefused {
        column_name: found.name().to_owned(),
        text: name.to_owned(),
        refusal,
    };
    // In the composed form of the table's texts (`crate::text`).
    let level =
        new_level(categorical, found.values().role(), &nfc(name), decimal_mark).map_err(refused)?;
    if let Some(index) = categorical.levels().position(&level) {
        let code = level_code(index)?;
        return Err(refused(PopulationRefusal::Taken { code }));
    }
    let num_levels = categorical.num_levels()?;
    if num_levels >= MAX_LEVELS {
        return Err(refused(PopulationRefusal::TooMany {
            max_levels: MAX_LEVELS,
        }));
    }
    let code = level_code(usize_from(num_levels))?;
    let colour = unused_colour(categorical.colours())?;
    // Selecting the new population releases + or −.
    let selected = Active {
        column,
        selected: Some(Selected::Population(code)),
        mode: None,
    };
    plan_add_level(
        state,
        open,
        column,
        (level, colour),
        Some(selected),
        StepKind::Record,
        sent_at,
    )
}

/// Plans `added`, a level and its colour, after the last level of
/// `column`: a new population, which `select` then selects for editing,
/// or the redo of one, or the undo of its removal.
pub(super) fn plan_add_level(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    added: (Level, Colour),
    select: Option<Active>,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    let (level, colour) = added;
    let categorical = categorical_of(open, column)?.with_level(level, colour)?;
    let new = NewLevels {
        column,
        categorical,
        active: select.map(Some),
        meaning: Meaning::Kept,
        step: step_of(kind, Edit::RemoveLevel { column }),
    };
    plan_levels(state, open, new, sent_at)
}

/// Plans the last level of `column` removed, which no row holds: the undo
/// of a population added, or the redo of its removal. A population
/// selected for editing that was that level is no longer selected.
pub(super) fn plan_remove_level(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    let (categorical, level, colour) = categorical_of(open, column)?.without_last_level()?;
    let removed = Selected::Population(level_code(categorical.levels().len())?);
    let active = open
        .interaction
        .active
        .filter(|active| active.column == column && active.selected == Some(removed))
        .map(|_| {
            Some(Active {
                column,
                selected: None,
                mode: None,
            })
        });
    let new = NewLevels {
        column,
        categorical,
        active,
        meaning: Meaning::MayChange,
        step: step_of(
            kind,
            Edit::AddLevel {
                column,
                level,
                colour,
            },
        ),
    };
    plan_levels(state, open, new, sent_at)
}

/// Plans new levels of a column: the column, its levels when a code may
/// mean another population, and the shape of the table take the new
/// revision, and the message carries the codes, which are the same, beside
/// the column's revision, as a window expects of a category.
fn plan_levels(
    state: &SharedState,
    open: &OpenProject,
    new: NewLevels,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    let NewLevels {
        column,
        categorical,
        active,
        meaning,
        step,
    } = new;
    let revision = state.revision.next()?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.shape(revision)?;
    if let Some(active) = active {
        message.active(active)?;
    }
    message.codes(column, revision, categorical.codes())?;
    message.columns(&[(column, revision)])?;
    message.undo(open.history.after(&step))?;
    let levels_at = match meaning {
        Meaning::Kept => None,
        Meaning::MayChange => Some(revision),
    };
    Ok(Plan {
        revision,
        message: message.finish(),
        change: Change::Levels {
            column,
            categorical,
            levels_at,
            active,
            step,
        },
    })
}

/// The category `column`, which a change of its levels needs.
fn categorical_of(open: &OpenProject, column: ColumnId) -> Result<&Categorical, CommandError> {
    open.table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?
        .categorical()
        .ok_or(CommandError::NotCategory { column })
}
