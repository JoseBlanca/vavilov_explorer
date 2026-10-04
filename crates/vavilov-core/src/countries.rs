//! The countries the country sub-role accepts, and the code each is shown
//! by (`docs/design.md`, section 6): those of ISO 3166-1 and the former ones
//! of ISO 3166-3, named by their codes or their ISO names in English.

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

/// A country as a view names and draws it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Country {
    /// Its common name in English, `Russia` for the Russian Federation
    /// (`docs/design.md`, section 2.2).
    pub name: &'static str,
    /// Its ISO numeric code, three digits such as `724`, by which the map's
    /// shapes are named; `None` for a former country, which the map does
    /// not draw.
    pub numeric: Option<&'static str>,
}

/// The country shown by `code`, its three-letter code or the four-letter
/// one of a former country, as [`country_code`] gives it; `None` for a code
/// of no country.
#[must_use]
pub fn country_of(code: &str) -> Option<Country> {
    table::COUNTRIES
        .binary_search_by(|(shown, _, _)| (*shown).cmp(code))
        .ok()
        .and_then(|index| table::COUNTRIES.get(index))
        .map(|(_, name, numeric)| Country {
            name,
            numeric: *numeric,
        })
}

/// Every name and code, in lower case, of the country shown by `code`,
/// its own code among them; none for a code of no country.
pub(crate) fn names_of(code: &str) -> impl Iterator<Item = &'static str> + '_ {
    table::NAMES
        .iter()
        .filter(move |(_, shown)| *shown == code)
        .map(|(name, _)| *name)
}

#[cfg(test)]
mod tests;
