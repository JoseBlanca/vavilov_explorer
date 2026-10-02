use super::*;

/// A folder of its own for one test, under the system's folder of
/// temporary files.
fn folder(test: &str) -> std::path::PathBuf {
    let folder = std::env::temp_dir().join(format!("vavilov-files-{test}-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

#[test]
fn a_file_is_read_whole_and_one_larger_than_20_mb_is_refused_from_its_size() {
    let folder = folder("read");
    let small = folder.join("plants.csv");
    std::fs::write(&small, b"IndividualID\nA\n").unwrap();
    assert_eq!(read_for_import(&small).unwrap(), b"IndividualID\nA\n");
    let large = folder.join("variants.csv");
    std::fs::File::create(&large)
        .unwrap()
        .set_len(20_000_001)
        .unwrap();
    assert_eq!(
        read_for_import(&large),
        Err(CommandError::ImportRefused {
            file_name: "variants.csv".to_owned(),
            refusal: ImportRefusal::TooLarge {
                size: 20_000_001,
                max_bytes: 20_000_000,
            },
        })
    );
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn a_file_that_is_not_there_is_not_read_and_says_so() {
    let folder = folder("missing");
    let error = read_for_import(&folder.join("gone.csv")).unwrap_err();
    assert!(
        matches!(
            &error,
            CommandError::FileNotRead { file_name, io: IoFailure::NotFound, .. }
                if file_name == "gone.csv"
        ),
        "{error:?}"
    );
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn an_export_replaces_the_file_and_leaves_no_partial_one() {
    let folder = folder("write");
    let path = folder.join("plants.csv");
    std::fs::write(&path, b"old").unwrap();
    write_export(&path, b"new").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"new");
    let names: Vec<String> = std::fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["plants.csv"]);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn an_export_to_a_folder_that_is_not_there_is_not_written_and_says_so() {
    let folder = folder("nowhere");
    let error = write_export(&folder.join("gone").join("plants.csv"), b"new").unwrap_err();
    assert!(
        matches!(
            &error,
            CommandError::FileNotWritten { file_name, io: IoFailure::NotFound, .. }
                if file_name == "plants.csv"
        ),
        "{error:?}"
    );
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn a_file_of_exactly_20_mb_is_read() {
    let folder = folder("exactly");
    let path = folder.join("plants.csv");
    std::fs::File::create(&path)
        .unwrap()
        .set_len(20_000_000)
        .unwrap();
    assert_eq!(read_for_import(&path).unwrap().len(), 20_000_000);
    std::fs::remove_dir_all(folder).unwrap();
}

#[cfg(unix)]
#[test]
fn a_file_that_holds_more_than_its_size_said_is_read_one_byte_past_the_limit() {
    // /dev/zero says it has 0 bytes and gives as many as are read, as a
    // file that grows after its size was taken.
    let bytes = read_for_import(std::path::Path::new("/dev/zero")).unwrap();
    assert_eq!(bytes.len(), 20_000_001);
}

/// The names in `folder`, in order.
fn names_in(folder: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// The name of the first temporary file an export of this process tries.
fn first_temporary() -> String {
    format!(".vavilov-{}-0.tmp", std::process::id())
}

#[test]
fn an_export_leaves_untouched_the_user_s_files_named_like_a_temporary_one() {
    let folder = folder("named-like");
    let path = folder.join("plants.csv");
    let partial = folder.join("plants.csv.partial");
    let temporary = folder.join(first_temporary());
    std::fs::write(&partial, b"the user's").unwrap();
    std::fs::write(&temporary, b"the user's too").unwrap();
    write_export(&path, b"new").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"new");
    assert_eq!(std::fs::read(&partial).unwrap(), b"the user's");
    assert_eq!(std::fs::read(&temporary).unwrap(), b"the user's too");
    let mut expected = vec![
        first_temporary(),
        "plants.csv".to_owned(),
        "plants.csv.partial".to_owned(),
    ];
    expected.sort();
    assert_eq!(names_in(&folder), expected);
    std::fs::remove_dir_all(folder).unwrap();
}

#[cfg(unix)]
#[test]
fn an_export_does_not_follow_a_link_planted_at_the_name_of_a_temporary_file() {
    let folder = folder("link");
    let outside = folder.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    let target = outside.join("secret.txt");
    std::fs::write(&target, b"secret").unwrap();
    let chosen = folder.join("chosen");
    std::fs::create_dir_all(&chosen).unwrap();
    for name in ["plants.csv.partial".to_owned(), first_temporary()] {
        std::os::unix::fs::symlink(&target, chosen.join(name)).unwrap();
    }
    write_export(&chosen.join("plants.csv"), b"new").unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"secret");
    assert_eq!(std::fs::read(chosen.join("plants.csv")).unwrap(), b"new");
    std::fs::remove_dir_all(folder).unwrap();
}

#[cfg(unix)]
#[test]
fn a_replaced_file_keeps_its_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let folder = folder("permissions");
    let path = folder.join("plants.csv");
    std::fs::write(&path, b"old").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    write_export(&path, b"new").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"new");
    let mode = std::fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn a_file_whose_name_has_250_bytes_is_written() {
    let folder = folder("long-name");
    let name = format!("{}.csv", "a".repeat(246));
    assert_eq!(name.len(), 250);
    write_export(&folder.join(&name), b"new").unwrap();
    assert_eq!(std::fs::read(folder.join(&name)).unwrap(), b"new");
    assert_eq!(names_in(&folder), [name]);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn an_export_over_a_folder_is_not_written_and_leaves_no_temporary_file() {
    let folder = folder("over-folder");
    std::fs::create_dir_all(folder.join("plants.csv")).unwrap();
    let error = write_export(&folder.join("plants.csv"), b"new").unwrap_err();
    assert!(
        matches!(
            &error,
            CommandError::FileNotWritten { file_name, .. } if file_name == "plants.csv"
        ),
        "{error:?}"
    );
    assert_eq!(names_in(&folder), ["plants.csv"]);
    std::fs::remove_dir_all(folder).unwrap();
}

#[cfg(unix)]
#[test]
fn an_export_to_a_folder_the_user_may_not_write_is_refused_as_permission_denied() {
    use std::os::unix::fs::PermissionsExt;
    let folder = folder("read-only");
    let locked = folder.join("locked");
    std::fs::create_dir_all(&locked).unwrap();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();
    // Root may write anywhere, and would not see the refusal.
    let as_root = std::fs::write(locked.join("probe"), b"").is_ok();
    let written = write_export(&locked.join("plants.csv"), b"new");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
    if !as_root {
        let error = written.unwrap_err();
        assert!(
            matches!(
                &error,
                CommandError::FileNotWritten {
                    file_name,
                    io: IoFailure::PermissionDenied,
                    ..
                } if file_name == "plants.csv"
            ),
            "{error:?}"
        );
        assert_eq!(names_in(&locked), Vec::<String>::new());
    }
    std::fs::remove_dir_all(folder).unwrap();
}
