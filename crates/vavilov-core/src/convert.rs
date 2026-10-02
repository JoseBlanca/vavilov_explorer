//! The widenings between `u32`, `usize` and `u64` that cannot fail on the
//! platforms the app is built for.

// A `usize` of 32 to 64 bits holds every `u32` and fits a `u64`; a build
// for another platform stops here instead of losing a value.
const _: () = assert!(
    usize::BITS >= 32 && usize::BITS <= 64,
    "usize of 32 to 64 bits"
);

/// A `u32`, such as a row or a count of rows, as an index.
pub(crate) fn usize_from(value: u32) -> usize {
    // The assertion above makes the fallback unreachable.
    usize::try_from(value).unwrap_or(usize::MAX)
}

/// A length, as the `u64` an error reports.
pub(crate) fn u64_from(value: usize) -> u64 {
    // The assertion above makes the fallback unreachable.
    u64::try_from(value).unwrap_or(u64::MAX)
}
