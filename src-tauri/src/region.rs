//! The decimal mark of the system's region, which Excel follows, read from
//! the operating system: on macOS from the current locale, on Windows from
//! the user's locale, and on Linux from `LC_NUMERIC`, as `LC_ALL`,
//! `LC_NUMERIC` and `LANG` set it. A window's language can differ from
//! the region: with English as the language and Spain as the region, the
//! web view writes 1.5 and Excel 1,5 (measured on macOS on 2 October
//! 2026). The export of a CSV starts from it (`docs/design.md`,
//! section 7).

use vavilov_core::CommandError;

/// The decimal mark of the system's region, as the system writes it, `,`
/// or `.`, or another mark the user set.
///
/// # Errors
///
/// A `Defect` when the system cannot give it, which no supported system
/// does.
pub fn decimal_mark() -> Result<String, CommandError> {
    let mark = system_decimal_mark().map_err(|reason| CommandError::Defect {
        what: format!("the decimal mark of the system's region could not be read: {reason}"),
    })?;
    if mark.is_empty() {
        return Err(CommandError::Defect {
            what: "the system's region has an empty decimal mark".to_owned(),
        });
    }
    Ok(mark)
}

#[cfg(target_os = "macos")]
fn system_decimal_mark() -> Result<String, String> {
    use objc2_foundation::NSLocale;
    // The locale that follows the user's changes in System Settings while
    // the app runs, which the locale of currentLocale does not.
    Ok(NSLocale::autoupdatingCurrentLocale()
        .decimalSeparator()
        .to_string())
}

#[cfg(windows)]
fn system_decimal_mark() -> Result<String, String> {
    use windows::Win32::Globalization::{GetLocaleInfoEx, LOCALE_SDECIMAL};
    use windows::core::PCWSTR;
    // LOCALE_SDECIMAL is at most three characters and the final null.
    let mut buffer = [0_u16; 4];
    // SAFETY: a null name is LOCALE_NAME_USER_DEFAULT, the user's locale;
    // the buffer is a live slice whose length the binding passes with it,
    // and the call writes no more than that.
    let written = unsafe { GetLocaleInfoEx(PCWSTR::null(), LOCALE_SDECIMAL, Some(&mut buffer)) };
    let written = usize::try_from(written).map_err(|_| "a negative length".to_owned())?;
    if written == 0 {
        return Err(windows::core::Error::from_thread().to_string());
    }
    // The length counts the final null.
    let mark = buffer
        .get(..written.saturating_sub(1))
        .ok_or_else(|| format!("a length of {written} beyond the buffer"))?;
    String::from_utf16(mark).map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn system_decimal_mark() -> Result<String, String> {
    // SAFETY: the name is a valid C string, empty to take the locale from
    // the environment, and the null base asks for a new locale object,
    // which changes nothing of the process's own locale.
    let locale =
        unsafe { libc::newlocale(libc::LC_NUMERIC_MASK, c"".as_ptr(), std::ptr::null_mut()) };
    if locale.is_null() {
        return Err(std::io::Error::last_os_error().to_string());
    }
    // SAFETY: the locale is the live one just made; the text it gives
    // stays valid until the locale is freed, below, after it was copied.
    let mark = unsafe {
        let radix = libc::nl_langinfo_l(libc::RADIXCHAR, locale);
        if radix.is_null() {
            Err("nl_langinfo_l gave no text".to_owned())
        } else {
            std::ffi::CStr::from_ptr(radix)
                .to_str()
                .map(str::to_owned)
                .map_err(|error| error.to_string())
        }
    };
    // SAFETY: the locale was made by newlocale and is freed once.
    unsafe { libc::freelocale(locale) };
    mark
}

#[cfg(test)]
mod tests;
