use super::*;
use crate::filter::texts::NumberTexts;
use crate::fixtures::{code, column, float, integer, names, plants};
use crate::table::{Role, Stored};

fn filter(text: &str) -> Filter {
    Filter {
        condition: Condition::Contains {
            text: text.to_owned(),
        },
        ..Filter::none()
    }
}

/// `filter` with "is" in the place of "contains", the whole cell.
fn whole(filter: Filter) -> Filter {
    let Condition::Contains { text } = filter.condition else {
        panic!("no text to make whole");
    };
    Filter {
        condition: Condition::Is { text },
        ..filter
    }
}

fn in_column(text: &str, column: u32) -> Filter {
    Filter {
        column: Some(ColumnId::new(column)),
        ..filter(text)
    }
}

/// The names of the rows `filter` shows of `table`, numbers written with
/// the point, or `None` for every row.
fn shown(table: &Table, filter: &Filter) -> Option<Vec<String>> {
    shown_with(table, filter, ".")
}

/// The names of the rows `filter` shows of `table`, numbers written with
/// `decimal_mark`, or `None` for every row.
fn shown_with(table: &Table, filter: &Filter, decimal_mark: &str) -> Option<Vec<String>> {
    shown_rows(
        filter,
        Some(decimal_mark),
        table,
        None,
        &NumberTexts::default(),
    )
    .unwrap()
    .map(|rows| {
        rows.iter()
            .map(|row| table.names().names()[usize_from(row.get())].clone())
            .collect()
    })
}

#[test]
fn a_filter_with_no_text_shows_every_row_whatever_its_choices() {
    let table = plants();
    let choices = Filter {
        showing: Showing::NotMatching,
        ..whole(filter(""))
    };
    assert_eq!(shown(&table, &choices), None);
}

#[test]
fn a_text_is_found_in_any_column_the_first_included() {
    let table = plants();
    // "1" is in p1's name and height 1.5, and in the seeds 10 and 12.
    assert_eq!(shown(&table, &filter("1")).unwrap(), ["p1", "p2"]);
    assert_eq!(shown(&table, &filter("p3")).unwrap(), ["p3"]);
}

#[test]
fn a_text_in_one_column_is_found_there_only() {
    let table = plants();
    // note, column 6: NA, missing, missing, tall; "a" is in origin's Spain
    // too.
    assert_eq!(shown(&table, &in_column("a", 6)).unwrap(), ["p1", "p4"]);
    // The first column, the names, by its id 0.
    assert_eq!(shown(&table, &in_column("4", 0)).unwrap(), ["p4"]);
}

#[test]
fn case_is_ignored_and_a_whole_cell_must_be_the_whole_text() {
    let table = plants();
    assert_eq!(shown(&table, &in_column("SPA", 2)).unwrap(), ["p1", "p4"]);
    // "is" of any column matches a category's whole text.
    let whole = |text: &str| whole(filter(text));
    assert_eq!(shown(&table, &whole("spa")).unwrap(), Vec::<String>::new());
    assert_eq!(shown(&table, &whole("spain")).unwrap(), ["p1", "p4"]);
}

#[test]
fn a_missing_cell_never_matches_so_the_rows_that_do_not_match_show_it() {
    let table = plants();
    // origin: Spain, Peru, missing, Spain.
    let not = Filter {
        showing: Showing::NotMatching,
        ..in_column("spain", 2)
    };
    assert_eq!(shown(&table, &not).unwrap(), ["p2", "p3"]);
    // note: NA as a text, missing, missing, tall. The text NA matches.
    assert_eq!(shown(&table, &in_column("na", 6)).unwrap(), ["p1"]);
}

#[test]
fn a_decimal_number_matches_by_its_text_with_the_region_s_mark() {
    // A column of numbers is searched by its text in any column alone.
    let table = Table::new(
        "IndividualID",
        names(&["p1", "p2", "p3", "p4"]),
        vec![column(
            "height",
            float(vec![Some(1.5), None, Some(2.0), Some(3.25)]),
        )],
    )
    .unwrap();
    let comma = |text: &str| shown_with(&table, &filter(text), ",").unwrap();
    // height: 1.5, missing, 2, 3.25.
    assert_eq!(comma("1,5"), ["p1"]);
    assert_eq!(comma("1.5"), Vec::<String>::new());
    assert_eq!(comma("3,2"), ["p4"]);
    // 2.0 is shown as 2.
    assert_eq!(comma("2,0"), Vec::<String>::new());
}

#[test]
fn yes_and_no_match_as_the_table_writes_them() {
    let table = plants();
    let whole = whole(filter("true"));
    assert_eq!(shown(&table, &whole).unwrap(), ["p1", "p4"]);
}

fn countries() -> Table {
    let stored = Stored::Text(vec![
        Some("Spain".to_owned()),
        Some("ES".to_owned()),
        Some("Peru".to_owned()),
        Some("Estonia".to_owned()),
        None,
    ]);
    let values =
        ColumnValues::from_stored(stored, Role::Country, ColumnId::new(1), "country").unwrap();
    Table::new(
        "IndividualID",
        names(&["c1", "c2", "c3", "c4", "c5"]),
        vec![column("country", values)],
    )
    .unwrap()
}

#[test]
fn a_country_matches_by_its_shown_code_and_every_iso_name_and_code() {
    let table = countries();
    // ESP, ESP, PER, EST, missing.
    assert_eq!(
        shown(&table, &in_column("kingdom of spain", 1)).unwrap(),
        ["c1", "c2"]
    );
    assert_eq!(shown(&table, &in_column("spa", 1)).unwrap(), ["c1", "c2"]);
    // Part of the shown code ESP.
    assert_eq!(shown(&table, &in_column("sp", 1)).unwrap(), ["c1", "c2"]);
    // A code is compared whole: "es" is Spain's, and only part of EST.
    assert_eq!(
        shown(&table, &in_column("es", 1)).unwrap(),
        ["c1", "c2", "c4"]
    );
    assert_eq!(shown(&table, &in_column("pe", 1)).unwrap(), ["c3"]);
    let whole = whole(filter("peru"));
    assert_eq!(shown(&table, &whole).unwrap(), ["c3"]);
}

#[test]
fn accents_are_not_ignored() {
    let table = Table::new(
        "IndividualID",
        names(&["a1", "a2"]),
        vec![column(
            "place",
            ColumnValues::Text(vec![Some("Côte".to_owned()), Some("Cote".to_owned())]),
        )],
    )
    .unwrap();
    assert_eq!(shown(&table, &filter("cote")).unwrap(), ["a2"]);
    assert_eq!(shown(&table, &filter("CÔTE")).unwrap(), ["a1"]);
}

#[test]
fn an_edit_not_yet_applied_is_searched_in_the_place_of_what_it_replaces() {
    let table = plants();
    // origin, column 2: Spain, Peru, missing, Spain; p3 made Peru.
    let codes = [code(0), code(1), code(1), code(0)];
    let rows = shown_rows(
        &in_column("peru", 2),
        Some("."),
        &table,
        Some(Replaced::Codes(ColumnId::new(2), &codes)),
        &NumberTexts::default(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(rows, [RowIndex::new(1), RowIndex::new(2)]);
    // An edit of another column changes nothing of origin's rows.
    let rows = shown_rows(
        &in_column("peru", 2),
        Some("."),
        &table,
        Some(Replaced::Codes(ColumnId::new(3), &codes)),
        &NumberTexts::default(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(rows, [RowIndex::new(1)]);
}

#[test]
fn a_column_the_table_does_not_have_is_refused() {
    assert_eq!(
        shown_rows(
            &in_column("x", 9),
            Some("."),
            &plants(),
            None,
            &NumberTexts::default()
        ),
        Err(CommandError::UnknownColumn {
            column: ColumnId::new(9)
        })
    );
}

#[test]
fn a_column_the_table_does_not_have_is_refused_also_with_no_text() {
    assert_eq!(
        shown_rows(
            &in_column("", 9),
            None,
            &plants(),
            None,
            &NumberTexts::default()
        ),
        Err(CommandError::UnknownColumn {
            column: ColumnId::new(9)
        })
    );
}

#[test]
fn a_text_with_no_decimal_mark_is_a_defect() {
    assert!(matches!(
        shown_rows(&filter("1"), None, &plants(), None, &NumberTexts::default()),
        Err(CommandError::Defect { .. })
    ));
}

#[test]
fn a_decimal_number_is_written_as_javascript_writes_it() {
    assert_eq!(number_text(1.5, ",").unwrap(), "1,5");
    assert_eq!(number_text(-0.0, ",").unwrap(), "0");
    assert_eq!(number_text(2.0, ".").unwrap(), "2");
    assert_eq!(number_text(0.000_001, ".").unwrap(), "0.000001");
    assert_eq!(number_text(1.5e-7, ",").unwrap(), "1,5e-7");
    assert_eq!(number_text(1e21, ".").unwrap(), "1e+21");
    assert_eq!(number_text(-2.5e22, ".").unwrap(), "-2.5e+22");
    assert_eq!(number_text(123_456_789.25, ".").unwrap(), "123456789.25");
}

#[test]
fn of_two_shortest_forms_equally_close_to_a_number_the_even_one_is_written() {
    // Each value lies exactly halfway between two shortest forms that both
    // give it back; node's String(value) writes the even one.
    assert_eq!(
        number_text(608_898_711_247_163.3, ".").unwrap(),
        "608898711247163.2"
    );
    assert_eq!(
        number_text(100_000_000_000.015_63, ",").unwrap(),
        "100000000000,01562"
    );
    assert_eq!(
        number_text(-1_000_000_000_000.031_3, ".").unwrap(),
        "-1000000000000.0312"
    );
}

#[test]
fn a_number_is_written_in_each_of_javascript_s_forms() {
    // The literals are node's String(value).
    assert_eq!(number_text(1e20, ".").unwrap(), "100000000000000000000");
    assert_eq!(
        number_text(123_456_789_012_345_680_000.0, ".").unwrap(),
        "123456789012345680000"
    );
    assert_eq!(number_text(0.000_012_34, ",").unwrap(), "0,00001234");
    assert_eq!(number_text(0.1 + 0.2, ".").unwrap(), "0.30000000000000004");
    assert_eq!(number_text(1e-7, ".").unwrap(), "1e-7");
    assert_eq!(number_text(123e-20, ",").unwrap(), "1,23e-18");
    assert_eq!(number_text(-1.2345e-10, ".").unwrap(), "-1.2345e-10");
    assert_eq!(number_text(5e-324, ".").unwrap(), "5e-324");
    assert_eq!(
        number_text(2.225_073_858_507_201_4e-308, ".").unwrap(),
        "2.2250738585072014e-308"
    );
    assert_eq!(
        number_text(f64::MAX, ".").unwrap(),
        "1.7976931348623157e+308"
    );
    assert_eq!(number_text(f64::NAN, ".").unwrap(), "NaN");
    assert_eq!(number_text(f64::INFINITY, ".").unwrap(), "Infinity");
    assert_eq!(number_text(f64::NEG_INFINITY, ".").unwrap(), "-Infinity");
}

mod in_the_session {
    use super::*;
    use crate::command::{Command, Request};
    use crate::fixtures::decode;
    use crate::ids::{Position, Revision};
    use crate::rows::RowsRequest;
    use crate::session::{Selected, Session};

    const FILTER_PART: u16 = 13;

    /// A window that receives and keeps nothing.
    struct Discard;

    impl crate::session::Subscriber for Discard {
        fn send(&self, _message: Vec<u8>) -> Result<(), crate::session::SendFailed> {
            Ok(())
        }
    }

    fn dispatch(session: &mut Session, command: Command) {
        let based_on = session.revision();
        session
            .dispatch(Request {
                command,
                based_on,
                sent_at: None,
            })
            .unwrap();
    }

    fn loaded() -> Session {
        let mut session = Session::new();
        dispatch(
            &mut session,
            Command::LoadTable {
                table: plants(),
                active_classification: Some(ColumnId::new(2)),
            },
        );
        session
    }

    fn set(session: &mut Session, filter: Filter) {
        dispatch(
            session,
            Command::SetFilter {
                filter,
                decimal_mark: ".".to_owned(),
            },
        );
    }

    /// The rows of the table on a page of every row shown, as a window
    /// fetches it, and the revision since which they are shown.
    fn page(session: &Session, count: u32) -> (Vec<u32>, u64) {
        let message = session
            .rows(&RowsRequest {
                first: Position::new(0),
                count,
                columns: vec![],
                based_on: session.revision(),
            })
            .unwrap();
        let payload = &decode(&message).parts[0].1;
        let shown_at = u64::from_le_bytes(payload[8..16].try_into().unwrap());
        let rows = payload[32..]
            .as_chunks::<4>()
            .0
            .iter()
            .take(usize_from(count))
            .map(|row| u32::from_le_bytes(*row))
            .collect();
        (rows, shown_at)
    }

    #[test]
    fn a_filter_shows_its_rows_in_the_pages_of_the_table() {
        let mut session = loaded();
        set(&mut session, in_column("spain", 2));
        assert_eq!(session.revision(), Revision::new(2));
        // origin: Spain, Peru, missing, Spain.
        assert_eq!(page(&session, 2), (vec![0, 3], 2));
        // A page past the two rows shown is refused.
        assert_eq!(
            session.rows(&RowsRequest {
                first: Position::new(0),
                count: 3,
                columns: vec![],
                based_on: session.revision(),
            }),
            Err(CommandError::RowsOutOfRange {
                first: Position::new(0),
                count: 3,
                num_shown: 2
            })
        );
    }

    /// Sets `filter` with `decimal_mark`, as a window would.
    fn try_set(
        session: &mut Session,
        filter: Filter,
        decimal_mark: &str,
    ) -> Result<crate::dispatch::Outcome, CommandError> {
        let based_on = session.revision();
        session.dispatch(Request {
            command: Command::SetFilter {
                filter,
                decimal_mark: decimal_mark.to_owned(),
            },
            based_on,
            sent_at: None,
        })
    }

    #[test]
    fn a_column_the_table_does_not_have_is_refused_with_no_text_too() {
        let mut session = loaded();
        assert_eq!(
            try_set(&mut session, in_column("", 9), "."),
            Err(CommandError::UnknownColumn {
                column: ColumnId::new(9)
            })
        );
        assert_eq!(session.revision(), Revision::new(1));
    }

    #[test]
    fn a_decimal_mark_of_one_to_three_characters_is_taken_and_another_is_a_defect() {
        let mut session = loaded();
        for mark in ["", "۔,,,", "abcd"] {
            assert!(
                matches!(
                    try_set(&mut session, filter("1"), mark),
                    Err(CommandError::Defect { .. })
                ),
                "{mark:?}"
            );
            assert_eq!(session.revision(), Revision::new(1));
        }
        // Three characters, as a region of Windows may have, the first of
        // two bytes.
        try_set(&mut session, filter("1"), "٫ab").unwrap();
        assert_eq!(session.revision(), Revision::new(2));
    }

    #[test]
    fn a_text_of_up_to_the_field_s_limit_is_taken_and_a_longer_one_is_a_defect() {
        let mut session = loaded();
        let longest = "é".repeat(MAX_FILTER_TEXT);
        assert!(matches!(
            try_set(&mut session, filter(&format!("{longest}e")), "."),
            Err(CommandError::Defect { .. })
        ));
        assert_eq!(session.revision(), Revision::new(1));
        try_set(&mut session, filter(&longest), ".").unwrap();
        assert_eq!(session.revision(), Revision::new(2));
    }

    #[test]
    fn the_same_filter_with_another_decimal_mark_is_set_again() {
        let mut session = loaded();
        // height: 1.5, missing, 2, 3.25.
        set(&mut session, filter("1,5"));
        assert_eq!(page(&session, 0), (vec![], 2));
        try_set(&mut session, filter("1,5"), ",").unwrap();
        assert_eq!(session.revision(), Revision::new(3));
        assert_eq!(page(&session, 1), (vec![0], 3));
    }

    #[test]
    fn a_page_of_a_filter_carries_the_values_of_the_rows_shown() {
        let mut session = loaded();
        set(&mut session, in_column("spain", 2));
        // origin: Spain, Peru, missing, Spain; p1 and p4 shown. Their note,
        // height and seeds.
        let message = session
            .rows(&RowsRequest {
                first: Position::new(0),
                count: 2,
                columns: vec![ColumnId::new(6), ColumnId::new(1), ColumnId::new(4)],
                based_on: session.revision(),
            })
            .unwrap();
        #[rustfmt::skip]
        let expected: Vec<u8> = vec![
            3, 0, 0, 0, 0, 0, 0, 0, // rows, no time
            2, 0, 0, 0, 0, 0, 0, 0, // revision 2
            0, 0, 0, 0, 0, 0, 0, 0, // no time
            // page: loaded at 1, rows shown since 2, names since 1, from
            // position 0, 2 rows, which are the rows 0 and 3
            8, 0, 0, 0, 40, 0, 0, 0,
            1, 0, 0, 0, 0, 0, 0, 0,
            2, 0, 0, 0, 0, 0, 0, 0,
            1, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 2, 0, 0, 0,
            0, 0, 0, 0, 3, 0, 0, 0,
            // names: offsets 0, 2, 4, then p1p4
            9, 0, 0, 0, 16, 0, 0, 0,
            0, 0, 0, 0, 2, 0, 0, 0,
            4, 0, 0, 0, b'p', b'1', b'p', b'4',
            // note, column 6, text, revision 1: none missing; NA, tall
            10, 0, 0, 0, 42, 0, 0, 0,
            6, 0, 0, 0, 2, 0, 0, 0,
            1, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 2, 0, 0, 0,
            6, 0, 0, 0, b'N', b'A', b't', b'a',
            b'l', b'l', 0, 0, 0, 0, 0, 0,
            // height, column 1, numeric: none missing; 1.5, 3.25
            10, 0, 0, 0, 40, 0, 0, 0,
            1, 0, 0, 0, 0, 0, 0, 0,
            1, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0xF8, 0x3F,
            0, 0, 0, 0, 0, 0, 0x0A, 0x40,
            // seeds, column 4, integer: none missing; 10, 7
            10, 0, 0, 0, 40, 0, 0, 0,
            4, 0, 0, 0, 1, 0, 0, 0,
            1, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            10, 0, 0, 0, 0, 0, 0, 0,
            7, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert_eq!(message, expected);
    }

    #[test]
    fn the_same_filter_again_changes_nothing() {
        let mut session = loaded();
        set(&mut session, in_column("spain", 2));
        set(&mut session, in_column("spain", 2));
        assert_eq!(session.revision(), Revision::new(2));
    }

    #[test]
    fn a_lasso_that_changes_which_rows_match_shows_them_at_its_revision() {
        // Searched in origin, and in any column.
        for searched in [in_column("spain", 2), filter("spain")] {
            let mut session = loaded();
            dispatch(
                &mut session,
                Command::SelectGroups {
                    column: ColumnId::new(2),
                    selected: crate::SelectedGroups::one(Selected::Group(LevelCode::new(0))),
                },
            );
            set(&mut session, searched.clone());
            assert_eq!(page(&session, 2), (vec![0, 3], 3), "{searched:?}");
            // p3, missing, into Spain.
            dispatch(
                &mut session,
                Command::AssignRows {
                    column: ColumnId::new(2),
                    target: Selected::Group(LevelCode::new(0)),
                    rows: crate::row_set::RowSet::from_rows(4, [RowIndex::new(2)]).unwrap(),
                },
            );
            assert_eq!(page(&session, 3), (vec![0, 2, 3], 4), "{searched:?}");
            dispatch(&mut session, Command::Undo);
            assert_eq!(page(&session, 2), (vec![0, 3], 5), "{searched:?}");
        }
    }

    #[test]
    fn a_change_of_role_that_changes_which_rows_match_shows_them_at_its_revision() {
        let place = Stored::Text(vec![
            Some("Spain".to_owned()),
            Some("Peru".to_owned()),
            Some("Spain".to_owned()),
        ]);
        let table = Table::new(
            "IndividualID",
            names(&["q1", "q2", "q3"]),
            vec![column(
                "place",
                ColumnValues::from_stored(place, Role::Text, ColumnId::new(1), "place").unwrap(),
            )],
        )
        .unwrap();
        let mut session = Session::new();
        dispatch(
            &mut session,
            Command::LoadTable {
                table,
                active_classification: None,
            },
        );
        // "esp", Spain's ISO code, is in no text of the column.
        set(&mut session, in_column("esp", 1));
        assert_eq!(page(&session, 0), (vec![], 2));
        // Made a column of countries, Spain is found by its code.
        dispatch(
            &mut session,
            Command::SetRole {
                column: ColumnId::new(1),
                role: Role::Country,
            },
        );
        assert_eq!(page(&session, 2), (vec![0, 2], 3));
        dispatch(&mut session, Command::Undo);
        assert_eq!(page(&session, 0), (vec![], 4));
    }

    #[test]
    fn an_edit_that_changes_no_row_shown_keeps_the_pages_of_the_rows_shown() {
        let mut session = loaded();
        set(&mut session, in_column("spain", 2));
        // A change of role of height, at 3, leaves origin's rows as they
        // were, shown since 2.
        dispatch(
            &mut session,
            Command::SetRole {
                column: ColumnId::new(1),
                role: Role::Category,
            },
        );
        assert_eq!(session.revision(), Revision::new(3));
        assert_eq!(page(&session, 2), (vec![0, 3], 2));
    }

    #[test]
    fn the_filter_part_says_the_rows_shown_and_the_filter() {
        let mut session = loaded();
        set(
            &mut session,
            Filter {
                column: Some(ColumnId::new(2)),
                condition: Condition::Group {
                    code: Some(LevelCode::new(0)),
                },
                showing: Showing::NotMatching,
            },
        );
        let snapshot = session
            .subscribe(crate::ids::WindowLabel::main(), Box::new(Discard))
            .unwrap();
        let part = decode(&snapshot)
            .parts
            .into_iter()
            .find(|(kind, _)| *kind == FILTER_PART)
            .unwrap()
            .1;
        #[rustfmt::skip]
        let expected: Vec<u8> = vec![
            2, 0, 0, 0, 0, 0, 0, 0, // rows shown since 2
            2, 0, 0, 0, 2, 0, 0, 0, // 2 shown, column 2
            2, 0, 1, 1, 0, 0, 0, 0, // a group, not matching, rows below, its code 0
            0, 0, 0, 0, 0, 0, 0, 0, // no text: the offsets 0 and 0
            0b0110, // p2 and p3 shown
        ];
        assert_eq!(part, expected);
    }

    #[test]
    fn a_load_clears_the_filter() {
        let mut session = loaded();
        set(&mut session, in_column("spain", 2));
        dispatch(
            &mut session,
            Command::LoadTable {
                table: plants(),
                active_classification: None,
            },
        );
        assert_eq!(page(&session, 4), (vec![0, 1, 2, 3], 3));
    }

    /// The filter the session holds.
    fn held(session: &Session) -> Filter {
        session
            .state
            .project
            .as_open()
            .unwrap()
            .interaction
            .filter
            .clone()
    }

    fn group(code: u16) -> Filter {
        Filter {
            column: Some(ColumnId::new(2)),
            condition: Condition::Group {
                code: Some(LevelCode::new(code)),
            },
            showing: Showing::Matching,
        }
    }

    #[test]
    fn a_condition_that_does_not_fit_its_column_is_a_defect() {
        let mut session = loaded();
        let compare = |column: Option<u32>| Filter {
            column: column.map(ColumnId::new),
            condition: Condition::Compare {
                comparison: Comparison::AtMost,
                text: "2".to_owned(),
            },
            showing: Showing::Matching,
        };
        for unfit in [
            // A comparison of a text, of a category and of any column.
            compare(Some(6)),
            compare(Some(2)),
            compare(None),
            // A group of a column of numbers, and of no column.
            Filter {
                column: Some(ColumnId::new(1)),
                ..group(0)
            },
            Filter {
                column: None,
                ..group(0)
            },
            // A group the column does not have.
            group(2),
            // "is" a text of a category, which offers its groups, and
            // "contains" of a column of numbers.
            whole(in_column("spain", 2)),
            in_column("1", 1),
        ] {
            assert!(
                matches!(
                    try_set(&mut session, unfit.clone(), "."),
                    Err(CommandError::Defect { .. })
                ),
                "{unfit:?}"
            );
        }
        assert_eq!(session.revision(), Revision::new(1));
    }

    #[test]
    fn a_deleted_group_clears_the_filter_and_one_before_it_moves_it() {
        let mut session = loaded();
        // origin: Spain (0), Peru (1); Peru holds p2.
        set(&mut session, group(1));
        assert_eq!(page(&session, 1), (vec![1], 2));
        dispatch(
            &mut session,
            Command::DeleteGroup {
                column: ColumnId::new(2),
                group: LevelCode::new(0),
            },
        );
        // Peru is now code 0, and the filter follows it.
        assert_eq!(held(&session), group(0));
        assert_eq!(page(&session, 1).0, vec![1]);
        // The undo gives Spain back at 0, and Peru its code 1.
        dispatch(&mut session, Command::Undo);
        assert_eq!(held(&session), group(1));
        assert_eq!(page(&session, 1).0, vec![1]);
        dispatch(
            &mut session,
            Command::DeleteGroup {
                column: ColumnId::new(2),
                group: LevelCode::new(1),
            },
        );
        // Peru deleted: the filter is cleared to "contains" with no text,
        // and shows every row.
        assert_eq!(
            held(&session),
            Filter {
                column: Some(ColumnId::new(2)),
                ..Filter::none()
            }
        );
        assert_eq!(page(&session, 4).0, vec![0, 1, 2, 3]);
    }

    #[test]
    fn a_change_of_role_clears_a_filter_that_no_longer_fits_and_keeps_one_that_does() {
        let mut session = loaded();
        let at_most = Filter {
            column: Some(ColumnId::new(1)),
            condition: Condition::Compare {
                comparison: Comparison::AtMost,
                text: "2".to_owned(),
            },
            showing: Showing::Matching,
        };
        set(&mut session, at_most.clone());
        // height: 1.5, missing, 2, 3.25; a latitude is still a number.
        dispatch(
            &mut session,
            Command::SetRole {
                column: ColumnId::new(1),
                role: Role::Latitude,
            },
        );
        assert_eq!(held(&session), at_most);
        assert_eq!(page(&session, 2).0, vec![0, 2]);
        dispatch(
            &mut session,
            Command::SetRole {
                column: ColumnId::new(1),
                role: Role::Category,
            },
        );
        assert_eq!(
            held(&session),
            Filter {
                column: Some(ColumnId::new(1)),
                ..Filter::none()
            }
        );
        assert_eq!(page(&session, 4).0, vec![0, 1, 2, 3]);
    }

    #[test]
    fn a_category_made_text_clears_a_filter_by_its_group() {
        let mut session = loaded();
        // origin: Spain, Peru, missing, Spain.
        set(&mut session, group(0));
        dispatch(
            &mut session,
            Command::SetRole {
                column: ColumnId::new(2),
                role: Role::Text,
            },
        );
        assert_eq!(
            held(&session),
            Filter {
                column: Some(ColumnId::new(2)),
                ..Filter::none()
            }
        );
        assert_eq!(page(&session, 4).0, vec![0, 1, 2, 3]);
    }

    #[test]
    fn the_filter_part_of_a_comparison_says_when_its_number_cannot_be_read() {
        let mut session = loaded();
        set(
            &mut session,
            Filter {
                column: Some(ColumnId::new(1)),
                condition: Condition::Compare {
                    comparison: Comparison::Greater,
                    text: "2,5".to_owned(),
                },
                showing: Showing::Matching,
            },
        );
        let snapshot = session
            .subscribe(crate::ids::WindowLabel::main(), Box::new(Discard))
            .unwrap();
        let part = decode(&snapshot)
            .parts
            .into_iter()
            .find(|(kind, _)| *kind == FILTER_PART)
            .unwrap()
            .1;
        #[rustfmt::skip]
        let expected: Vec<u8> = vec![
            2, 0, 0, 0, 0, 0, 0, 0, // rows shown since 2
            4, 0, 0, 0, 1, 0, 0, 0, // every row of 4 shown, column 1
            3, 4, 0, 0, 1, 0, 255, 255, // a comparison, >, matching, every row, no number, no group
            0, 0, 0, 0, 3, 0, 0, 0, // the text's offsets 0 and 3
            b'2', b',', b'5', // 2,5, and no bits after it
        ];
        assert_eq!(part, expected);
    }
}

#[test]
fn a_number_is_found_by_every_character_its_text_can_have_and_by_no_other() {
    // Each column alone, searched by its text in any column.
    let sizes = Table::new(
        "IndividualID",
        names(&["a", "b", "c"]),
        vec![column("size", float(vec![Some(1e21), Some(-1.5), None]))],
    )
    .unwrap();
    let counts = Table::new(
        "IndividualID",
        names(&["a", "b", "c"]),
        vec![column("count", integer(vec![Some(-12), None, Some(7)]))],
    )
    .unwrap();
    let comma = |text: &str| shown_with(&sizes, &filter(text), ",").unwrap();
    assert_eq!(comma("E+21"), ["a"]);
    assert_eq!(comma("-1,5"), ["b"]);
    assert_eq!(comma("1,5x"), Vec::<String>::new());
    assert_eq!(comma("1.5"), Vec::<String>::new());
    let integers = |text: &str| shown_with(&counts, &filter(text), ",").unwrap();
    assert_eq!(integers("-1"), ["a"]);
    assert_eq!(integers("7"), ["c"]);
    assert_eq!(integers("7 "), Vec::<String>::new());
}

mod kept_texts {
    use super::*;
    use crate::filter::texts::NumberTexts;
    use crate::ids::Revision;

    /// The rows `filter` shows with `texts` kept, or written afresh.
    fn rows_with(
        table: &Table,
        filter: &Filter,
        mark: &str,
        texts: &NumberTexts,
    ) -> Option<Vec<RowIndex>> {
        shown_rows(filter, Some(mark), table, None, texts).unwrap()
    }

    #[test]
    fn the_texts_of_a_decimal_column_are_kept_for_its_revision_and_decimal_mark() {
        let table = plants();
        let mut texts = NumberTexts::default();
        texts.refresh(&table, ",").unwrap();
        let height = ColumnId::new(1);
        let revision = table.column(height).unwrap().revision();
        // height: 1.5, missing, 2, 3.25.
        let kept: Vec<Option<String>> = texts
            .column(height, revision, ",")
            .unwrap()
            .map(|text| text.unwrap().map(str::to_owned))
            .collect();
        assert_eq!(
            kept,
            [
                Some("1,5".to_owned()),
                None,
                Some("2".to_owned()),
                Some("3,25".to_owned())
            ]
        );
        // Not for another decimal mark, another revision, nor a column of
        // whole numbers, seeds.
        assert!(texts.column(height, revision, ".").is_none());
        assert!(texts.column(height, Revision::new(9), ",").is_none());
        assert!(texts.column(ColumnId::new(4), revision, ",").is_none());
    }

    #[test]
    fn a_search_with_the_texts_kept_finds_the_rows_it_finds_without() {
        let table = Table::new(
            "IndividualID",
            names(&["a", "b", "c", "d"]),
            vec![column(
                "size",
                float(vec![Some(1e21), Some(-1.5), Some(-0.0), None]),
            )],
        )
        .unwrap();
        for mark in [",", "."] {
            let mut texts = NumberTexts::default();
            texts.refresh(&table, mark).unwrap();
            for text in ["1", "e+21", "-1,5", "-1.5", "0", "5", "1,5x"] {
                for filter in [filter(text), whole(filter(text))] {
                    assert_eq!(
                        rows_with(&table, &filter, mark, &texts),
                        rows_with(&table, &filter, mark, &NumberTexts::default()),
                        "{text} with {mark}"
                    );
                }
            }
        }
    }

    #[test]
    fn texts_kept_for_a_column_since_changed_are_not_read() {
        let before = plants();
        let mut texts = NumberTexts::default();
        texts.refresh(&before, ",").unwrap();
        // The same column, height, at revision 5 with other values.
        let mut after = Table::new(
            "IndividualID",
            names(&["p1", "p2", "p3", "p4"]),
            vec![column("height", float(vec![Some(7.5), None, None, None]))],
        )
        .unwrap();
        after.set_revisions(Revision::new(5));
        let shown = rows_with(&after, &filter("7,5"), ",", &texts);
        assert_eq!(shown, Some(vec![RowIndex::new(0)]));
    }
}

#[test]
fn a_text_searched_with_an_accent_written_apart_finds_the_cells_that_have_it_composed() {
    let table = Table::new(
        "IndividualID",
        names(&["Jos\u{e9}", "Jose"]),
        vec![column("height", float(vec![Some(1.0), Some(2.0)]))],
    )
    .unwrap();
    assert_eq!(
        shown(&table, &filter("Jose\u{301}")),
        Some(vec!["Jos\u{e9}".to_owned()])
    );
}

#[test]
fn is_matches_the_whole_text_of_a_cell() {
    let table = plants();
    // note: NA, missing, missing, tall.
    assert_eq!(shown(&table, &whole(in_column("TALL", 6))).unwrap(), ["p4"]);
    assert_eq!(
        shown(&table, &whole(in_column("tal", 6))).unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn a_group_matches_its_individuals_and_none_chosen_shows_every_row() {
    let table = plants();
    let group = |code: Option<u16>| Filter {
        column: Some(ColumnId::new(2)),
        condition: Condition::Group {
            code: code.map(LevelCode::new),
        },
        showing: Showing::Matching,
    };
    // origin: Spain, Peru, missing, Spain.
    assert_eq!(shown(&table, &group(Some(0))).unwrap(), ["p1", "p4"]);
    assert_eq!(shown(&table, &group(Some(1))).unwrap(), ["p2"]);
    assert_eq!(shown(&table, &group(None)), None);
}

#[test]
fn a_comparison_matches_the_numbers_that_compare_so_and_never_a_missing_one() {
    let table = plants();
    let compare = |column: u32, comparison: Comparison, text: &str| Filter {
        column: Some(ColumnId::new(column)),
        condition: Condition::Compare {
            comparison,
            text: text.to_owned(),
        },
        showing: Showing::Matching,
    };
    // height: 1.5, missing, 2, 3.25.
    let height = |comparison, text: &str| shown(&table, &compare(1, comparison, text)).unwrap();
    assert_eq!(height(Comparison::Less, "2"), ["p1"]);
    assert_eq!(height(Comparison::AtMost, "2"), ["p1", "p3"]);
    assert_eq!(height(Comparison::Equal, "2"), ["p3"]);
    assert_eq!(height(Comparison::Equal, "2.00"), ["p3"]);
    assert_eq!(height(Comparison::AtLeast, "2"), ["p3", "p4"]);
    assert_eq!(height(Comparison::Greater, "2"), ["p4"]);
    // seeds, whole numbers: 10, 12, missing, 7.
    assert_eq!(
        shown(&table, &compare(4, Comparison::AtLeast, "10")).unwrap(),
        ["p1", "p2"]
    );
    // The rows that do not match show the missing height.
    let not = Filter {
        showing: Showing::NotMatching,
        ..compare(1, Comparison::AtMost, "2")
    };
    assert_eq!(shown(&table, &not).unwrap(), ["p2", "p4"]);
    // Read with the region's decimal mark.
    assert_eq!(
        shown_with(&table, &compare(1, Comparison::Less, "1,6"), ",").unwrap(),
        ["p1"]
    );
}

#[test]
fn a_comparison_with_no_number_or_one_it_cannot_read_shows_every_row_and_says_so() {
    let table = plants();
    let compare = |text: &str| Filter {
        column: Some(ColumnId::new(1)),
        condition: Condition::Compare {
            comparison: Comparison::Less,
            text: text.to_owned(),
        },
        showing: Showing::Matching,
    };
    assert_eq!(shown(&table, &compare("")), None);
    assert!(!compare("").unreadable_number(Some(".")));
    // A point where the region's mark is the comma is no number.
    assert_eq!(shown_with(&table, &compare("1.5"), ","), None);
    assert!(compare("1.5").unreadable_number(Some(",")));
    assert!(compare("abc").unreadable_number(Some(".")));
    assert!(!compare("1.5").unreadable_number(Some(".")));
}

#[test]
fn is_missing_matches_the_missing_cells_of_a_column_or_of_any() {
    let table = plants();
    let missing = |column: Option<u32>| Filter {
        column: column.map(ColumnId::new),
        condition: Condition::Missing,
        showing: Showing::Matching,
    };
    // height: 1.5, missing, 2, 3.25; origin: Spain, Peru, missing, Spain.
    assert_eq!(shown(&table, &missing(Some(1))).unwrap(), ["p2"]);
    assert_eq!(shown(&table, &missing(Some(2))).unwrap(), ["p3"]);
    // The IDs are never missing.
    assert_eq!(
        shown(&table, &missing(Some(0))).unwrap(),
        Vec::<String>::new()
    );
    // p4 has every cell; p1 has no cluster.
    assert_eq!(shown(&table, &missing(None)).unwrap(), ["p1", "p2", "p3"]);
    let not_missing = Filter {
        showing: Showing::NotMatching,
        ..missing(Some(1))
    };
    assert_eq!(shown(&table, &not_missing).unwrap(), ["p1", "p3", "p4"]);
}
