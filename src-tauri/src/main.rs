//! The executable of Vavilov Explorer.

// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    match vavilov_explorer_lib::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Vavilov Explorer could not start: {error}");
            ExitCode::FAILURE
        }
    }
}
