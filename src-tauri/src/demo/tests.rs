use vavilov_core::Active;

use super::*;

/// The number of missing values of a column and of present ones.
fn missing_and_present(values: &ColumnValues) -> (usize, usize) {
    let missing = match values {
        ColumnValues::Numeric(values) => values.iter().filter(|value| value.is_none()).count(),
        ColumnValues::Integer(values) => values.iter().filter(|value| value.is_none()).count(),
        ColumnValues::Text(values) => values.iter().filter(|value| value.is_none()).count(),
        ColumnValues::Boolean(values) => values.iter().filter(|value| value.is_none()).count(),
        ColumnValues::Categorical(categorical) => categorical
            .codes()
            .iter()
            .filter(|code| code.is_none())
            .count(),
    };
    (missing, values.len().checked_sub(missing).unwrap())
}

fn numbers(table: &Table, name: &str) -> Vec<f64> {
    let column = table.columns().iter().find(|c| c.name() == name).unwrap();
    let ColumnValues::Numeric(values) = column.values() else {
        panic!("{name} is not numeric");
    };
    values.iter().flatten().copied().collect()
}

#[test]
fn the_demo_table_has_its_plants_and_columns_in_order() {
    let table = table().unwrap();
    assert_eq!(table.num_rows(), 2_000);
    assert_eq!(table.names().header(), "accession");
    assert_eq!(table.names().names()[0], "VAV-0001");
    assert_eq!(table.names().names()[1_999], "VAV-2000");
    let columns: Vec<(&str, &str)> = table
        .columns()
        .iter()
        .map(|column| {
            let kind = match column.values() {
                ColumnValues::Numeric(_) => "numeric",
                ColumnValues::Integer(_) => "integer",
                ColumnValues::Text(_) => "text",
                ColumnValues::Boolean(_) => "boolean",
                ColumnValues::Categorical(_) => "categorical",
            };
            (column.name(), kind)
        })
        .collect();
    assert_eq!(
        columns,
        [
            ("country", "categorical"),
            ("cluster", "categorical"),
            ("latitude", "numeric"),
            ("longitude", "numeric"),
            ("PC1", "numeric"),
            ("PC2", "numeric"),
            ("PC3", "numeric"),
            ("height", "numeric"),
            ("seeds", "integer"),
            ("fertile", "boolean"),
            ("note", "text"),
        ]
    );
}

#[test]
fn the_levels_are_in_alphabetical_order_with_the_colours_from_orange() {
    let table = table().unwrap();
    let levels = |id: u32| -> Vec<(String, Colour)> {
        table
            .column(ColumnId::new(id))
            .unwrap()
            .categorical()
            .unwrap()
            .levels()
            .iter()
            .map(|level| (level.name().to_owned(), level.colour()))
            .collect()
    };
    let country = levels(1);
    let names: Vec<&str> = country.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(
        names,
        ["China", "Ethiopia", "India", "Mexico", "Peru", "Spain"]
    );
    assert_eq!(country[0].1, rgb(0xE6, 0x9F, 0x00));
    assert_eq!(country[5].1, rgb(0xD5, 0x5E, 0x00));
    let cluster: Vec<String> = levels(2).into_iter().map(|(name, _)| name).collect();
    assert_eq!(cluster, ["A", "B", "C", "D"]);
}

#[test]
fn every_column_has_missing_values_and_most_are_present() {
    let table = table().unwrap();
    for column in table.columns() {
        let (missing, present) = missing_and_present(column.values());
        // The principal components are never missing, as a PCA gives none.
        if column.name().starts_with("PC") {
            assert_eq!(missing, 0, "{}", column.name());
        } else {
            assert!(missing > 0, "{} has no missing value", column.name());
        }
        assert!(present > 1_700, "{}: {present} present", column.name());
    }
}

#[test]
fn every_country_and_cluster_has_plants_and_the_values_are_plausible() {
    let table = table().unwrap();
    for id in [1, 2] {
        let categorical = table
            .column(ColumnId::new(id))
            .unwrap()
            .categorical()
            .unwrap();
        for code in 0..categorical.levels().len() {
            let count = categorical
                .codes()
                .iter()
                .filter(|c| c.map(|c| usize::from(c.get())) == Some(code))
                .count();
            assert!(count > 100, "level {code} of column {id}: {count} plants");
        }
    }
    assert!(
        numbers(&table, "latitude")
            .iter()
            .all(|lat| (-90.0..=90.0).contains(lat))
    );
    assert!(
        numbers(&table, "longitude")
            .iter()
            .all(|lon| (-180.0..=180.0).contains(lon))
    );
    assert!(
        numbers(&table, "height")
            .iter()
            .all(|h| (20.0..=200.0).contains(h))
    );
    let column = table.column(ColumnId::new(9)).unwrap();
    let ColumnValues::Integer(seeds) = column.values() else {
        panic!("seeds is not integer");
    };
    assert!(seeds.iter().flatten().all(|seeds| (0..400).contains(seeds)));
}

#[test]
fn the_demo_table_is_the_same_on_every_launch() {
    assert_eq!(table().unwrap(), table().unwrap());
}

#[test]
fn loading_it_opens_the_table_with_the_country_active() {
    let session = Mutex::new(Session::new());
    load(&session).unwrap();
    let session = session.lock().unwrap();
    assert_eq!(session.table().unwrap().num_rows(), 2_000);
    assert_eq!(
        session.active(),
        Some(Active {
            column: COUNTRY,
            selected: None,
        })
    );
}
