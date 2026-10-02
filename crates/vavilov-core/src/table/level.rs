//! A level of a categorical column: in a classification, a population.

use crate::table::colour::Colour;

/// A level of a categorical column, with its name and its colour. Every
/// categorical column has a colour for each level, since any of them can
/// become the active classification.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Level {
    name: String,
    colour: Colour,
}

impl Level {
    /// A level of this name and colour. The name is checked, not empty and
    /// unique within its column, when the table is built.
    #[must_use]
    pub fn new(name: impl Into<String>, colour: Colour) -> Self {
        Self {
            name: name.into(),
            colour,
        }
    }

    /// The name, as the user sees it.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The colour of the level in every view.
    #[must_use]
    pub const fn colour(&self) -> Colour {
        self.colour
    }
}
