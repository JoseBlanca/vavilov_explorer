//! What a window's call to a command asks of the session: the arguments
//! read, checked and turned into a request of the core, then dispatched.
//! The Tauri commands and the test program behind the e2e harness both
//! call [`call`], so the harness tests the windows against the app's own
//! reading of their calls (`docs/core.md`, section 7). `subscribe` is not
//! here: each side has its own transport for the channel.

use std::str::FromStr;

use serde::Deserialize;
use tauri::http::HeaderMap;
use tauri::ipc::InvokeBody;
use vavilov_core::{
    CellMatch, Colour, ColumnId, Command, CommandError, EditMode, Filter, LevelCode, Outcome,
    Position, Request, Revision, Role, RowIndex, RowsRequest, Selected, SelectedGroups, SentAt,
    Session, Showing, TableDescription,
};

/// The commands `call` takes, every command of the app but `subscribe`.
pub const COMMANDS: &[&str] = &[
    "describe_table",
    "fetch_rows",
    "set_selection",
    "assign_rows",
    "unassign_rows",
    "set_hover",
    "set_active_classification",
    "select_groups",
    "add_group",
    "delete_group",
    "edit_group",
    "set_edit_mode",
    "set_role",
    "set_filter",
    "set_cells",
    "undo",
    "redo",
];

/// Applies the call of `command` with its body and headers to the session.
/// A command with rows takes them as a raw body, one bit per row, with the
/// headers `based-on`, `sent-at` and, for a lasso, `column` and `target`
/// (with +: a code, or `unassigned`) or `selected` (with −: what is
/// selected, its codes and `unassigned`, if it is, between commas), and
/// for cells typed in, `column`, `text` and `decimal-mark`, the last two
/// percent-encoded as `encodeURIComponent` writes them, since a header
/// holds ASCII alone; the others take JSON arguments in camelCase, and an
/// argument the command does not have is refused, so that a name that
/// drifts between a window and the app fails at once.
///
/// # Errors
///
/// The refusals of the dispatcher, or a `Defect` for an unknown command,
/// an argument or a header missing, unknown or of the wrong type, and a
/// JSON body where raw bytes belong.
pub fn call(
    session: &mut Session,
    command: &str,
    body: &InvokeBody,
    headers: &HeaderMap,
) -> Result<Reply, CommandError> {
    if command == "describe_table" {
        json_args::<Nothing>(command, body)?;
        return session.describe().map(Reply::Description);
    }
    if command == "fetch_rows" {
        let args: RowsArgs = json_args(command, body)?;
        let request = RowsRequest {
            first: Position::new(args.first),
            count: args.count,
            columns: args.columns.into_iter().map(ColumnId::new).collect(),
            based_on: Revision::new(args.based_on),
        };
        return session.rows(&request).map(Reply::Rows);
    }
    let request = match command {
        "set_selection" => {
            let based_on = Revision::new(header(headers, "based-on")?);
            let sent_at = sent_at_header(headers)?;
            let rows = session.rows_from_window(raw_body(body)?, based_on)?;
            Request {
                command: Command::SetSelection { rows },
                based_on,
                sent_at,
            }
        }
        "assign_rows" => {
            let column = ColumnId::new(header(headers, "column")?);
            let target = target_header(headers)?;
            let based_on = Revision::new(header(headers, "based-on")?);
            let sent_at = sent_at_header(headers)?;
            let rows = session.rows_from_window(raw_body(body)?, based_on)?;
            Request {
                command: Command::AssignRows {
                    column,
                    target,
                    rows,
                },
                based_on,
                sent_at,
            }
        }
        "unassign_rows" => {
            let column = ColumnId::new(header(headers, "column")?);
            let selected = selected_header(headers)?;
            let based_on = Revision::new(header(headers, "based-on")?);
            let sent_at = sent_at_header(headers)?;
            let rows = session.rows_from_window(raw_body(body)?, based_on)?;
            Request {
                command: Command::UnassignRows {
                    column,
                    selected,
                    rows,
                },
                based_on,
                sent_at,
            }
        }
        "set_cells" => {
            let column = ColumnId::new(header(headers, "column")?);
            let text = percent_header(headers, "text")?;
            let decimal_mark = percent_header(headers, "decimal-mark")?;
            let based_on = Revision::new(header(headers, "based-on")?);
            let sent_at = sent_at_header(headers)?;
            let rows = session.rows_from_window(raw_body(body)?, based_on)?;
            Request {
                command: Command::SetCells {
                    column,
                    rows,
                    text,
                    decimal_mark,
                },
                based_on,
                sent_at,
            }
        }
        "set_hover" => {
            let args: HoverArgs = json_args(command, body)?;
            request(
                Command::SetHover {
                    row: args.row.map(RowIndex::new),
                },
                args.based_on,
                args.sent_at,
            )?
        }
        "set_active_classification" => {
            let args: ActiveArgs = json_args(command, body)?;
            let column = args.column.map(ColumnId::new);
            request(
                Command::SetActiveClassification { column },
                args.based_on,
                args.sent_at,
            )?
        }
        "select_groups" => {
            let args: GroupsArgs = json_args(command, body)?;
            let command = Command::SelectGroups {
                column: ColumnId::new(args.column),
                selected: args.selected,
            };
            request(command, args.based_on, args.sent_at)?
        }
        "add_group" => {
            let args: AddGroupArgs = json_args(command, body)?;
            let command = Command::AddGroup {
                column: ColumnId::new(args.column),
                name: args.name,
                decimal_mark: args.decimal_mark,
            };
            request(command, args.based_on, args.sent_at)?
        }
        "delete_group" => {
            let args: DeleteGroupArgs = json_args(command, body)?;
            let command = Command::DeleteGroup {
                column: ColumnId::new(args.column),
                group: LevelCode::new(args.group),
            };
            request(command, args.based_on, args.sent_at)?
        }
        "edit_group" => {
            let args: EditGroupArgs = json_args(command, body)?;
            let colour = Colour::from_css(&args.colour).ok_or_else(|| CommandError::Defect {
                what: format!("a group given the colour {:?}", args.colour),
            })?;
            let command = Command::EditGroup {
                column: ColumnId::new(args.column),
                group: LevelCode::new(args.group),
                name: args.name,
                colour,
                decimal_mark: args.decimal_mark,
            };
            request(command, args.based_on, args.sent_at)?
        }
        "set_edit_mode" => {
            let args: EditModeArgs = json_args(command, body)?;
            let command = Command::SetEditMode {
                column: ColumnId::new(args.column),
                selected: args.selected,
                mode: args.mode,
            };
            request(command, args.based_on, args.sent_at)?
        }
        "set_role" => {
            let args: RoleArgs = json_args(command, body)?;
            let command = Command::SetRole {
                column: ColumnId::new(args.column),
                role: args.role,
            };
            request(command, args.based_on, args.sent_at)?
        }
        "set_filter" => {
            let args: FilterArgs = json_args(command, body)?;
            let filter = Filter {
                text: args.text,
                column: args.column.map(ColumnId::new),
                cell: args.cell,
                showing: args.showing,
            };
            let command = Command::SetFilter {
                filter,
                decimal_mark: args.decimal_mark,
            };
            request(command, args.based_on, args.sent_at)?
        }
        "undo" => {
            let args: At = json_args(command, body)?;
            request(Command::Undo, args.based_on, args.sent_at)?
        }
        "redo" => {
            let args: At = json_args(command, body)?;
            request(Command::Redo, args.based_on, args.sent_at)?
        }
        other => {
            return Err(CommandError::Defect {
                what: format!("a call to an unknown command {other}"),
            });
        }
    };
    session.dispatch(request).map(Reply::Applied)
}

/// What a call gives back.
#[derive(Debug)]
pub enum Reply {
    /// A command applied, with the windows whose channel failed.
    Applied(Outcome),
    /// The description of the table, for `describe_table`.
    Description(TableDescription),
    /// A page of rows, as the bytes of a message of rows, for `fetch_rows`.
    Rows(Vec<u8>),
}

/// The arguments of a command that takes none.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Nothing {}

/// The arguments of undo and redo: the revision and the time every JSON
/// call carries. Each struct names them itself, since serde does not refuse
/// unknown fields through a flattened one.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct At {
    based_on: u64,
    sent_at: Option<f64>,
}

/// The arguments of `fetch_rows`, which changes nothing and so carries
/// no time.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RowsArgs {
    first: u32,
    count: u32,
    columns: Vec<u32>,
    based_on: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HoverArgs {
    row: Option<u32>,
    based_on: u64,
    sent_at: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveArgs {
    column: Option<u32>,
    based_on: u64,
    sent_at: Option<f64>,
}

/// The arguments of `select_groups`: the active classification and what
/// to select in it, a list of `{ "group": code }` and `"unassigned"`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GroupsArgs {
    column: u32,
    selected: SelectedGroups,
    based_on: u64,
    sent_at: Option<f64>,
}

/// The arguments of `add_group`: the active classification, the
/// name typed, and the decimal mark the window writes numbers with.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddGroupArgs {
    column: u32,
    name: String,
    decimal_mark: String,
    based_on: u64,
    sent_at: Option<f64>,
}

/// The arguments of `delete_group`: the active classification and
/// the code of the group.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteGroupArgs {
    column: u32,
    group: u16,
    based_on: u64,
    sent_at: Option<f64>,
}

/// The arguments of `edit_group`: the active classification, the
/// code of the group, the name typed, its colour as CSS writes one,
/// `#rrggbb`, and the decimal mark the window writes numbers with.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditGroupArgs {
    column: u32,
    group: u16,
    name: String,
    colour: String,
    decimal_mark: String,
    based_on: u64,
    sent_at: Option<f64>,
}

/// The arguments of `set_edit_mode`: the active classification, what is
/// selected in it, and the button pressed, `"add"`, `"remove"` or `null`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditModeArgs {
    column: u32,
    selected: SelectedGroups,
    mode: Option<EditMode>,
    based_on: u64,
    sent_at: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoleArgs {
    column: u32,
    role: Role,
    based_on: u64,
    sent_at: Option<f64>,
}

/// The arguments of `set_filter`: the filter of the find bar, with the
/// decimal mark the window writes numbers with.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilterArgs {
    text: String,
    column: Option<u32>,
    cell: CellMatch,
    showing: Showing,
    decimal_mark: String,
    based_on: u64,
    sent_at: Option<f64>,
}

/// The request of `command`, made at revision `based_on` and sent at
/// `sent_at`, as a window's JSON arguments give them.
///
/// # Errors
///
/// A `Defect` when the time is not finite.
pub fn request(
    command: Command,
    based_on: u64,
    sent_at: Option<f64>,
) -> Result<Request, CommandError> {
    let sent_at = sent_at.map(SentAt::new).transpose()?;
    Ok(Request {
        command,
        based_on: Revision::new(based_on),
        sent_at,
    })
}

/// The JSON arguments of a call, with none missing and none unknown.
///
/// # Errors
///
/// A `Defect` when one is missing, unknown or of the wrong type, or the
/// body is raw bytes.
pub fn json_args<T: for<'de> Deserialize<'de>>(
    command: &str,
    body: &InvokeBody,
) -> Result<T, CommandError> {
    match body {
        InvokeBody::Json(value) => T::deserialize(value).map_err(|error| CommandError::Defect {
            what: format!("the arguments of {command}: {error}"),
        }),
        InvokeBody::Raw(_) => Err(CommandError::Defect {
            what: format!("{command}, which takes JSON arguments, was given raw bytes"),
        }),
    }
}

/// The bytes of a raw body.
fn raw_body(body: &InvokeBody) -> Result<&[u8], CommandError> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(CommandError::Defect {
            what: "a command that takes raw bytes was given JSON, as Tauri sends every \
                   body once a window has fallen back from its custom IPC protocol to postMessage"
                .to_owned(),
        }),
    }
}

/// The text of a header the command needs, percent-encoded UTF-8 as
/// `encodeURIComponent` writes it.
fn percent_header(headers: &HeaderMap, name: &str) -> Result<String, CommandError> {
    let encoded: String = header(headers, name)?;
    let defect = || CommandError::Defect {
        what: format!("a header {name} that is not percent-encoded UTF-8"),
    };
    let mut bytes = Vec::with_capacity(encoded.len());
    let mut rest = encoded.as_bytes();
    while let Some((&first, after)) = rest.split_first() {
        if first == b'%' {
            let (hex, after) = after.split_at_checked(2).ok_or_else(defect)?;
            if !hex.iter().all(u8::is_ascii_hexdigit) {
                return Err(defect());
            }
            let hex = std::str::from_utf8(hex).map_err(|_| defect())?;
            bytes.push(u8::from_str_radix(hex, 16).map_err(|_| defect())?);
            rest = after;
        } else {
            bytes.push(first);
            rest = after;
        }
    }
    String::from_utf8(bytes).map_err(|_| defect())
}

/// The value of a header the command needs.
fn header<T: FromStr>(headers: &HeaderMap, name: &str) -> Result<T, CommandError> {
    optional_header(headers, name)?.ok_or_else(|| CommandError::Defect {
        what: format!("a command without its header {name}"),
    })
}

fn optional_header<T: FromStr>(headers: &HeaderMap, name: &str) -> Result<Option<T>, CommandError> {
    let Some(value) = headers.get(name) else {
        return Ok(None);
    };
    value
        .to_str()
        .ok()
        .and_then(|text| text.parse().ok())
        .map(Some)
        .ok_or_else(|| CommandError::Defect {
            what: format!("a header {name} that does not parse"),
        })
}

/// The target of a lasso in add mode, the header `target`: the code of a
/// group, or `unassigned`.
fn target_header(headers: &HeaderMap) -> Result<Selected, CommandError> {
    let text: String = header(headers, "target")?;
    if text == "unassigned" {
        return Ok(Selected::Unassigned);
    }
    text.parse()
        .map(|code| Selected::Group(LevelCode::new(code)))
        .map_err(|_| CommandError::Defect {
            what: format!("a header target of {text:?}"),
        })
}

/// What is selected, for a lasso with −, the header `selected`: the codes
/// of the groups and `unassigned`, if it is, between commas, or empty for
/// nothing.
fn selected_header(headers: &HeaderMap) -> Result<SelectedGroups, CommandError> {
    let text: String = header(headers, "selected")?;
    if text.is_empty() {
        return Ok(SelectedGroups::none());
    }
    let list = text
        .split(',')
        .map(|item| {
            if item == "unassigned" {
                return Ok(Selected::Unassigned);
            }
            item.parse()
                .map(|code| Selected::Group(LevelCode::new(code)))
                .map_err(|_| CommandError::Defect {
                    what: format!("a header selected of {text:?}"),
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    SelectedGroups::from_list(list)
}

fn sent_at_header(headers: &HeaderMap) -> Result<Option<SentAt>, CommandError> {
    optional_header::<f64>(headers, "sent-at")?
        .map(SentAt::new)
        .transpose()
}

#[cfg(test)]
mod tests;
