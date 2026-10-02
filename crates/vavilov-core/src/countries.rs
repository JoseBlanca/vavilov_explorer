//! The countries the country sub-role accepts, and the code each is shown
//! by (`docs/design.md`, section 6): those of ISO 3166-1 and the former ones
//! of ISO 3166-3, named by their codes, their ISO names in English or their
//! names in Natural Earth.

mod table;

/// The code `text` names a country by, its three-letter code, or the
/// four-letter one of a former country whose three-letter code a current
/// country has; `None` when it names no country. Case and surrounding
/// spaces are ignored, accents are not.
#[must_use]
pub fn country_code(text: &str) -> Option<&'static str> {
    let key = text.trim().to_lowercase();
    table::NAMES
        .binary_search_by(|(name, _)| (*name).cmp(key.as_str()))
        .ok()
        .and_then(|index| table::NAMES.get(index))
        .map(|(_, code)| *code)
}

#[cfg(test)]
mod tests;
