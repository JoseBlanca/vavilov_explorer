//! The plans of the changes to the levels of a category: a population of
//! the active classification added, deleted, renamed or given another
//! colour (`docs/design.md`, section 2.1), and the edits that insert,
//! delete and set a level for undo and redo.

use super::{
    Change, Plan, StepKind, active_classification, check_decimal_mark, check_level,
    check_levels_at, refiltered, step_of,
};
use crate::cells::new_level;
use crate::convert::usize_from;
use crate::edit::Edit;
use crate::error::{CommandError, PopulationRefusal};
use crate::filter::Replaced;
use crate::ids::{ColumnId, LevelCode, Revision, RowIndex, SentAt};
use crate::message::{MessageKind, MessageWriter};
use crate::session::{Active, HistoryStep, OpenProject, Selected, SharedState};
use crate::table::{
    Categorical, Colour, ColumnValues, Level, MAX_LEVELS, PALETTE, Role, level_code, unused_colour,
};
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
    let inserted = Inserted {
        code,
        level,
        colour,
        rows: Vec::new(),
    };
    plan_insert_level(
        state,
        open,
        column,
        inserted,
        Some(selected),
        StepKind::Record,
        sent_at,
    )
}

/// Plans the population `population` of the active classification
/// `column` deleted, its individuals left unassigned, by a command made at
/// `based_on`.
pub(super) fn plan_delete_population(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    population: LevelCode,
    based_on: Revision,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    active_classification(open, column)?;
    check_levels_at(open, column, based_on)?;
    check_level(&open.table, column, population)?;
    plan_delete_level(state, open, column, population, StepKind::Record, sent_at)
}

/// What [`Command::EditPopulation`](crate::Command::EditPopulation) asks
/// of a population.
pub(super) struct Edited<'a> {
    pub(super) column: ColumnId,
    pub(super) population: LevelCode,
    pub(super) name: &'a str,
    pub(super) colour: Colour,
    pub(super) decimal_mark: &'a str,
}

/// Plans the population of `edited` given the name and colour it asks for,
/// by a command made at `based_on`; `None` when it has them already.
pub(super) fn plan_edit_population(
    state: &SharedState,
    open: &OpenProject,
    edited: &Edited<'_>,
    based_on: Revision,
    sent_at: Option<SentAt>,
) -> Result<Option<Plan>, CommandError> {
    let Edited {
        column,
        population,
        name,
        colour,
        decimal_mark,
    } = *edited;
    check_decimal_mark(decimal_mark, "a population's name")?;
    active_classification(open, column)?;
    check_levels_at(open, column, based_on)?;
    check_level(&open.table, column, population)?;
    if !PALETTE.contains(&colour) {
        return Err(CommandError::Defect {
            what: format!("a population given the colour {colour:?}, which is not in the list"),
        });
    }
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
    let level =
        new_level(categorical, found.values().role(), &nfc(name), decimal_mark).map_err(refused)?;
    let index = usize::from(population.get());
    match categorical.levels().position(&level) {
        Some(other) if other != index => {
            let code = level_code(other)?;
            return Err(refused(PopulationRefusal::Taken { code }));
        }
        Some(_) if categorical.colours().get(index) == Some(&colour) => return Ok(None),
        Some(_) | None => {}
    }
    plan_set_level(
        state,
        open,
        column,
        (population, level, colour),
        StepKind::Record,
        sent_at,
    )
    .map(Some)
}

/// A level to insert into a category: its code, its value, its colour and
/// the rows, which hold no level, to give it.
pub(super) struct Inserted {
    pub(super) code: LevelCode,
    pub(super) level: Level,
    pub(super) colour: Colour,
    pub(super) rows: Vec<RowIndex>,
}

/// Plans `inserted` into `column`: a new population, last, which `select`
/// then selects for editing, or the redo of one, or the undo of one
/// deleted. A population selected for editing at its code or after keeps
/// being selected, at its new code.
pub(super) fn plan_insert_level(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    inserted: Inserted,
    select: Option<Active>,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    let Inserted {
        code,
        level,
        colour,
        rows,
    } = inserted;
    let old = categorical_of(open, column)?;
    // A level inserted last changes the meaning of no code.
    let meaning = if u32::from(code.get()) == old.num_levels()? {
        Meaning::Kept
    } else {
        Meaning::MayChange
    };
    let categorical = old.with_level_at(code, level, colour, &rows)?;
    let active = match select {
        Some(select) => Some(Some(select)),
        None => moved_selection(open, column, |selected| {
            if selected.get() >= code.get() {
                selected.get().checked_add(1).map(LevelCode::new)
            } else {
                Some(selected)
            }
        }),
    };
    let new = NewLevels {
        column,
        categorical,
        active,
        meaning,
        step: step_of(kind, Edit::DeleteLevel { column, code }),
    };
    plan_levels(state, open, new, sent_at)
}

/// Plans the level of `code` deleted from `column`, its rows left with
/// none: a population deleted, the undo of one added, or the redo of one
/// deleted. A population selected for editing that was that level is no
/// longer selected, and one after it keeps being selected, at its new code.
pub(super) fn plan_delete_level(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    code: LevelCode,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    let (categorical, level, colour, rows) = categorical_of(open, column)?.without_level(code)?;
    let active = moved_selection(open, column, |selected| {
        if selected == code {
            None
        } else if selected.get() > code.get() {
            selected.get().checked_sub(1).map(LevelCode::new)
        } else {
            Some(selected)
        }
    });
    let new = NewLevels {
        column,
        categorical,
        active,
        meaning: Meaning::MayChange,
        step: step_of(
            kind,
            Edit::InsertLevel {
                column,
                code,
                level,
                colour,
                rows,
            },
        ),
    };
    plan_levels(state, open, new, sent_at)
}

/// Plans the level of `code` in `column` made `level`, of `colour`, given
/// as `(code, level, colour)`: a population edited, or the undo or redo of
/// it. Every code keeps its meaning.
pub(super) fn plan_set_level(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    set: (LevelCode, Level, Colour),
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Plan, CommandError> {
    let (code, level, colour) = set;
    let (categorical, old_level, old_colour) =
        categorical_of(open, column)?.with_level_set(code, level, colour)?;
    let new = NewLevels {
        column,
        categorical,
        active: None,
        meaning: Meaning::Kept,
        step: step_of(
            kind,
            Edit::SetLevel {
                column,
                code,
                level: old_level,
                colour: old_colour,
            },
        ),
    };
    plan_levels(state, open, new, sent_at)
}

/// The active classification once the codes of `column` move as `moved`
/// says, when it is `column` and has a population selected for editing
/// whose code moves; `None` when it does not change. A population whose
/// code `moved` takes away is no longer selected, which releases + or −.
fn moved_selection(
    open: &OpenProject,
    column: ColumnId,
    moved: impl Fn(LevelCode) -> Option<LevelCode>,
) -> Option<Option<Active>> {
    let active = open
        .interaction
        .active
        .filter(|active| active.column == column)?;
    let Some(Selected::Population(selected)) = active.selected else {
        return None;
    };
    let new = match moved(selected) {
        Some(code) if code == selected => return None,
        Some(code) => Active {
            selected: Some(Selected::Population(code)),
            ..active
        },
        None => Active {
            column,
            selected: None,
            mode: None,
        },
    };
    Some(Some(new))
}

/// Plans new levels of a column: the column, its levels when a code may
/// mean another population, and the shape of the table take the new
/// revision, and the message carries the codes beside the column's
/// revision, as a window expects of a category, and the rows the filter
/// shows when they change.
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
    let values = match open
        .table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?
        .values()
        .role()
    {
        Role::Country => ColumnValues::Country(categorical),
        Role::Category => ColumnValues::Category(categorical),
        role @ (Role::Number | Role::Latitude | Role::Longitude | Role::Text) => {
            return Err(CommandError::Defect {
                what: format!("the levels of column {column}, of role {role:?}, changed"),
            });
        }
    };
    // A name changed, a level gone or its rows given back can change
    // which rows the filter's text matches.
    let shown = refiltered(open, Replaced::Values(column, &values), revision)?;
    let codes = values
        .categorical()
        .ok_or_else(|| CommandError::Defect {
            what: format!("the levels of column {column} lost on the way"),
        })?
        .codes();
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.shape(revision)?;
    if let Some(active) = active {
        message.active(active)?;
    }
    message.codes(column, revision, codes)?;
    message.columns(&[(column, revision)])?;
    message.undo(open.history.after(&step))?;
    if let Some(shown) = &shown {
        message.filter(&open.interaction.filter, shown, open.table.num_rows())?;
    }
    let levels_at = match meaning {
        Meaning::Kept => None,
        Meaning::MayChange => Some(revision),
    };
    Ok(Plan {
        revision,
        message: message.finish(),
        change: Change::Levels {
            column,
            values,
            levels_at,
            active,
            shown,
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
