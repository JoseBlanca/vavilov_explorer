//! The plans of the edits of cells in the table (`docs/design.md`,
//! section 2.1): a value typed in one cell or in the selection's, read by
//! the column's storage type, changes every row or none and is one undo.
//! A category's cells are its codes, planned as a lasso's are.

use super::{
    Change, Plan, StepKind, check_decimal_mark, check_row_set, code_of, plan_codes, refiltered,
    step_of,
};
use crate::cells::{Typed, name_of, typed};
use crate::convert::usize_from;
use crate::edit::{CellValue, Edit};
use crate::error::CommandError;
use crate::filter::Replaced;
use crate::ids::{ColumnId, RowIndex, SentAt};
use crate::message::{MessageKind, MessageWriter};
use crate::row_set::RowSet;
use crate::session::{OpenProject, SharedState};
use crate::table::{ColumnValues, INDIVIDUAL_ID, Numbers};

/// Plans the cells of `rows` in `column` set to what `text` gives, read
/// with `decimal_mark`; `None` when every row has that value already.
pub(super) fn plan_set_cells(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    rows: &RowSet,
    text: String,
    decimal_mark: &str,
    sent_at: Option<SentAt>,
) -> Result<Option<Plan>, CommandError> {
    check_decimal_mark(decimal_mark, "a value typed in a cell")?;
    let table = &open.table;
    check_row_set(rows, table.num_rows())?;
    if column == table.names().id() {
        let mut picked = rows.rows();
        let Some(row) = picked.next() else {
            return Ok(None);
        };
        if picked.next().is_some() {
            return Err(CommandError::Defect {
                what: format!("one ID given to {} individuals", rows.rows().count()),
            });
        }
        let names = table.names().names();
        let index = usize_from(row.get());
        let name = name_of(names, index, &text).map_err(|refusal| CommandError::CellRefused {
            column_name: INDIVIDUAL_ID.to_owned(),
            text,
            refusal,
        })?;
        let changes = if names.get(index) == Some(&name) {
            Vec::new()
        } else {
            vec![(row, name)]
        };
        return plan_names(state, open, changes, StepKind::Record, sent_at);
    }
    let found = table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?;
    let given = typed(found.values(), &text, decimal_mark).map_err(|refusal| {
        CommandError::CellRefused {
            column_name: found.name().to_owned(),
            text,
            refusal,
        }
    })?;
    match given {
        Typed::Code(new) => {
            let codes = found
                .categorical()
                .ok_or_else(|| defect(column, "gave a code and is not a category"))?
                .codes();
            let changes = rows
                .rows()
                .filter(|row| code_of(codes, *row) != new)
                .map(|row| (row, new))
                .collect();
            plan_codes(state, open, column, changes, StepKind::Record, sent_at)
        }
        Typed::Value(value) => {
            let mut changes = Vec::new();
            for row in rows.rows() {
                if cell_at(found.values(), row)? != value {
                    changes.push((row, value.clone()));
                }
            }
            plan_cells(state, open, column, changes, StepKind::Record, sent_at)
        }
    }
}

/// Plans new values of some cells of a column of numbers or text, an edit
/// or its reverse: the column takes the new revision, and the shape of
/// the table does not change. An edit that changes no cell changes
/// nothing.
pub(super) fn plan_cells(
    state: &SharedState,
    open: &OpenProject,
    column: ColumnId,
    changes: Vec<(RowIndex, CellValue)>,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Option<Plan>, CommandError> {
    if changes.is_empty() {
        return Ok(None);
    }
    let num_rows = open.table.num_rows();
    let mut values = open
        .table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?
        .values()
        .clone();
    let mut reverse = Vec::with_capacity(changes.len());
    for (row, new) in changes {
        reverse.push((row, swap_cell(&mut values, column, row, new, num_rows)?));
    }
    let step = step_of(
        kind,
        Edit::SetCells {
            column,
            changes: reverse,
        },
    );
    let revision = state.revision.next()?;
    let shown = refiltered(open, Replaced::Values(column, &values), revision)?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.columns(&[(column, revision)])?;
    message.undo(open.history.after(&step))?;
    if let Some(shown) = &shown {
        message.filter(&open.interaction.filter, shown, num_rows)?;
    }
    Ok(Some(Plan {
        revision,
        message: message.finish(),
        change: Change::Cells {
            column,
            values,
            shown,
            step,
        },
    }))
}

/// Plans new names of some individuals, an edit of an ID or its reverse:
/// the first column takes the new revision. An edit that changes no name
/// changes nothing.
pub(super) fn plan_names(
    state: &SharedState,
    open: &OpenProject,
    changes: Vec<(RowIndex, String)>,
    kind: StepKind,
    sent_at: Option<SentAt>,
) -> Result<Option<Plan>, CommandError> {
    if changes.is_empty() {
        return Ok(None);
    }
    let num_rows = open.table.num_rows();
    let id = open.table.names().id();
    let mut names = open.table.names().names().to_vec();
    let mut reverse = Vec::with_capacity(changes.len());
    for (row, new) in changes {
        let slot = names
            .get_mut(usize_from(row.get()))
            .ok_or(CommandError::RowOutOfRange { row, num_rows })?;
        reverse.push((row, std::mem::replace(slot, new)));
    }
    let step = step_of(kind, Edit::SetNames { changes: reverse });
    let revision = state.revision.next()?;
    let shown = refiltered(open, Replaced::Names(&names), revision)?;
    let mut message = MessageWriter::new(MessageKind::Change, revision, sent_at);
    message.columns(&[(id, revision)])?;
    message.undo(open.history.after(&step))?;
    if let Some(shown) = &shown {
        message.filter(&open.interaction.filter, shown, num_rows)?;
    }
    Ok(Some(Plan {
        revision,
        message: message.finish(),
        change: Change::Names { names, shown, step },
    }))
}

/// The value of the cell of `row` in a column of numbers or text.
fn cell_at(values: &ColumnValues, row: RowIndex) -> Result<CellValue, CommandError> {
    let index = usize_from(row.get());
    let missing_row = || CommandError::Defect {
        what: format!("no row {row} in a column whose rows were checked"),
    };
    match values {
        ColumnValues::Number(numbers)
        | ColumnValues::Latitude(numbers)
        | ColumnValues::Longitude(numbers) => match numbers {
            Numbers::Integer(values) => values
                .get(index)
                .map(|value| CellValue::Integer(*value))
                .ok_or_else(missing_row),
            Numbers::Float(values) => values
                .get(index)
                .map(|value| CellValue::Float(*value))
                .ok_or_else(missing_row),
        },
        ColumnValues::Text(values) => values
            .get(index)
            .map(|value| CellValue::Text(value.clone()))
            .ok_or_else(missing_row),
        ColumnValues::Category(_) | ColumnValues::Country(_) => Err(CommandError::Defect {
            what: "the value of a cell of a category, whose cells are codes".to_owned(),
        }),
    }
}

/// Puts `new` in the cell of `row` of `values` and gives back what was
/// there.
fn swap_cell(
    values: &mut ColumnValues,
    column: ColumnId,
    row: RowIndex,
    new: CellValue,
    num_rows: u32,
) -> Result<CellValue, CommandError> {
    let index = usize_from(row.get());
    let out_of_range = || CommandError::RowOutOfRange { row, num_rows };
    match (values, new) {
        (
            ColumnValues::Number(Numbers::Integer(values))
            | ColumnValues::Latitude(Numbers::Integer(values))
            | ColumnValues::Longitude(Numbers::Integer(values)),
            CellValue::Integer(new),
        ) => {
            let slot = values.get_mut(index).ok_or_else(out_of_range)?;
            Ok(CellValue::Integer(std::mem::replace(slot, new)))
        }
        (
            ColumnValues::Number(Numbers::Float(values))
            | ColumnValues::Latitude(Numbers::Float(values))
            | ColumnValues::Longitude(Numbers::Float(values)),
            CellValue::Float(new),
        ) => {
            let slot = values.get_mut(index).ok_or_else(out_of_range)?;
            Ok(CellValue::Float(std::mem::replace(slot, new)))
        }
        (ColumnValues::Text(values), CellValue::Text(new)) => {
            let slot = values.get_mut(index).ok_or_else(out_of_range)?;
            Ok(CellValue::Text(std::mem::replace(slot, new)))
        }
        (_, new) => Err(defect(
            column,
            &format!("cannot hold the value {new:?} of another storage type"),
        )),
    }
}

fn defect(column: ColumnId, what: &str) -> CommandError {
    CommandError::Defect {
        what: format!("column {column}, edited in its cells, {what}"),
    }
}
