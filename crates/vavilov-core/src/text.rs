//! The one form of text the core keeps: Unicode's composed form, NFC, so
//! that a letter with an accent is one character however it was typed or
//! written in a file. A Mac often writes `é` as `e` and a combining accent,
//! two characters, where typing gives one; compared as written, `Perú` from
//! a file and `Perú` typed would be two populations. Every text that enters
//! the core, from an imported file or typed by the user, goes through
//! [`nfc`] (decided by the owner on 3 October 2026).

use unicode_normalization::{IsNormalized, UnicodeNormalization, is_nfc_quick};

/// `text` in Unicode's composed form, NFC. A text already in it, as almost
/// every text is, is copied without being composed again.
pub(crate) fn nfc(text: &str) -> String {
    match is_nfc_quick(text.chars()) {
        IsNormalized::Yes => text.to_owned(),
        IsNormalized::No | IsNormalized::Maybe => text.nfc().collect(),
    }
}

#[cfg(test)]
mod tests;
