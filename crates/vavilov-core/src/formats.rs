//! The words of the formats of a file the user imports or exports: how a
//! text file is split and written, and what the user chooses for the
//! export of a CSV (`docs/design.md`, section 7). They are the core's own,
//! so that a window and the app name no type of `table_io`; `import.rs` and
//! `export.rs` turn them into `table_io`'s.

use serde::{Deserialize, Serialize};

/// The format a file was read as, found from its first bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileFormat {
    /// A CSV or a TSV: its places are lines, and a column its place in the
    /// row.
    Text,
    /// An xlsx: its places are the rows and the columns of the sheet.
    Xlsx,
}

/// The character between the cells of a row of a text file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Separator {
    /// The tab, as in a TSV.
    Tab,
    /// `;`, as a Spanish Excel writes a CSV.
    Semicolon,
    /// `,`.
    Comma,
}

/// The mark between the whole part and the decimals of a number.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DecimalMark {
    /// `1.5`.
    Point,
    /// `1,5`.
    Comma,
}

/// The encoding a CSV is written in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvEncoding {
    /// UTF-8, with no mark.
    Utf8,
    /// UTF-8 after its mark, as Excel writes "CSV UTF-8", which Excel reads
    /// as UTF-8 when it opens the file.
    Utf8WithMark,
    /// Windows-1252, what Excel on Windows writes for "CSV".
    Windows1252,
}

/// How a missing value is written in a CSV.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MissingText {
    /// As an empty cell.
    Empty,
    /// As `NA`.
    Na,
}

/// What the user chose for the export of a CSV. A window cannot send the
/// comma as both the separator and the decimal mark: `table_io` would
/// write each decimal number in quotes, `"1,5"`, which the import reads
/// back as text (decided by the owner on 2 October 2026).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(try_from = "CsvChoicesOnWire")]
pub struct CsvChoices {
    /// The character between the cells.
    pub separator: Separator,
    /// The mark of the decimals.
    pub decimal: DecimalMark,
    /// The encoding.
    pub encoding: CsvEncoding,
    /// How a missing value is written.
    pub missing: MissingText,
}

/// `CsvChoices` as a window sends it, before the separator and the decimal
/// mark are checked against each other.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CsvChoicesOnWire {
    separator: Separator,
    decimal: DecimalMark,
    encoding: CsvEncoding,
    missing: MissingText,
}

impl TryFrom<CsvChoicesOnWire> for CsvChoices {
    type Error = &'static str;

    fn try_from(choices: CsvChoicesOnWire) -> Result<Self, Self::Error> {
        match (choices.separator, choices.decimal) {
            (Separator::Comma, DecimalMark::Comma) => {
                Err("the comma cannot be both the separator and the decimal mark")
            }
            (Separator::Comma | Separator::Semicolon | Separator::Tab, _) => Ok(Self {
                separator: choices.separator,
                decimal: choices.decimal,
                encoding: choices.encoding,
                missing: choices.missing,
            }),
        }
    }
}

/// The format of an export: a CSV with the user's choices, or an xlsx.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(from = "ExportFormatOnWire")]
pub enum ExportFormat {
    /// A CSV.
    Csv {
        /// What the user chose.
        choices: CsvChoices,
    },
    /// An xlsx, one sheet.
    Xlsx,
}

/// `ExportFormat` as a window sends it. serde does not refuse a field
/// beside the tag of a variant with no fields, `{"kind":"xlsx","x":1}`,
/// so the xlsx is a variant of no fields here, which it refuses.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum ExportFormatOnWire {
    Csv { choices: CsvChoices },
    Xlsx {},
}

impl From<ExportFormatOnWire> for ExportFormat {
    fn from(format: ExportFormatOnWire) -> Self {
        match format {
            ExportFormatOnWire::Csv { choices } => Self::Csv { choices },
            ExportFormatOnWire::Xlsx {} => Self::Xlsx,
        }
    }
}

impl ExportFormat {
    /// The extension of a file of the format, without its dot.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Csv { .. } => "csv",
            Self::Xlsx => "xlsx",
        }
    }
}

#[cfg(test)]
mod tests;
