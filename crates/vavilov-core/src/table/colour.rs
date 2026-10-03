//! The colour of a level, and the list of colours levels are given.

use crate::error::CommandError;

/// A colour in sRGB, one byte a channel, as a window draws it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Colour {
    /// Red, 0 to 255.
    pub red: u8,
    /// Green, 0 to 255.
    pub green: u8,
    /// Blue, 0 to 255.
    pub blue: u8,
}

impl Colour {
    /// The colour of a text as CSS writes one, `#rrggbb`, in lower or upper
    /// case; `None` for any other text.
    #[must_use]
    pub fn from_css(text: &str) -> Option<Self> {
        let hex = text.strip_prefix('#')?;
        if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let channel = |range: std::ops::Range<usize>| {
            hex.get(range)
                .and_then(|pair| u8::from_str_radix(pair, 16).ok())
        };
        Some(rgb(channel(0..2)?, channel(2..4)?, channel(4..6)?))
    }
}

const fn rgb(red: u8, green: u8, blue: u8) -> Colour {
    Colour { red, green, blue }
}

/// The colours levels are given, in order, when a category is built (`docs/design.md`, section 5): Okabe and Ito's
/// list without its black, then the same mixed with 40 % white, then with
/// 40 % black, each channel rounded to the nearest. Decided by the owner on
/// 2 October 2026. A column of more levels starts the list again, which
/// the owner accepted the same day until there are more views to judge it
/// by.
pub const PALETTE: [Colour; 21] = [
    // Okabe and Ito's, without black, from orange
    rgb(230, 159, 0),   // orange, #e69f00
    rgb(86, 180, 233),  // sky blue, #56b4e9
    rgb(0, 158, 115),   // bluish green, #009e73
    rgb(240, 228, 66),  // yellow, #f0e442
    rgb(0, 114, 178),   // blue, #0072b2
    rgb(213, 94, 0),    // vermillion, #d55e00
    rgb(204, 121, 167), // reddish purple, #cc79a7
    // the same mixed with 40 % white
    rgb(240, 197, 102), // orange, #f0c566
    rgb(154, 210, 242), // sky blue, #9ad2f2
    rgb(102, 197, 171), // bluish green, #66c5ab
    rgb(246, 239, 142), // yellow, #f6ef8e
    rgb(102, 170, 209), // blue, #66aad1
    rgb(230, 158, 102), // vermillion, #e69e66
    rgb(224, 175, 202), // reddish purple, #e0afca
    // the same mixed with 40 % black
    rgb(138, 95, 0),   // orange, #8a5f00
    rgb(52, 108, 140), // sky blue, #346c8c
    rgb(0, 95, 69),    // bluish green, #005f45
    rgb(144, 137, 40), // yellow, #908928
    rgb(0, 68, 107),   // blue, #00446b
    rgb(128, 56, 0),   // vermillion, #803800
    rgb(122, 73, 100), // reddish purple, #7a4964
];

/// The colours of `num_levels` levels, in order.
#[must_use]
pub fn palette(num_levels: usize) -> Vec<Colour> {
    PALETTE.iter().copied().cycle().take(num_levels).collect()
}

/// The colour of a level added to a category whose levels have `colours`:
/// the first of [`PALETTE`] that none of them has, and, when they have
/// every one, the colour [`palette`] gives the next level, so that the list
/// starts again as it does for a category built with more levels.
///
/// # Errors
///
/// A `Defect` if the list, which is never empty, gave no colour.
pub(crate) fn unused_colour(colours: &[Colour]) -> Result<Colour, CommandError> {
    if let Some(colour) = PALETTE.iter().find(|colour| !colours.contains(colour)) {
        return Ok(*colour);
    }
    PALETTE
        .iter()
        .copied()
        .cycle()
        .nth(colours.len())
        .ok_or_else(|| CommandError::Defect {
            what: "no colour in the list of colours".to_owned(),
        })
}

#[cfg(test)]
mod tests;
