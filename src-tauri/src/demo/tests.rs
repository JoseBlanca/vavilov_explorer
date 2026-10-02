use vavilov_core::{Active, Colour, LevelValues, Numbers, PALETTE, Role, StorageType};

use super::*;

/// The number of missing values of a column and of present ones.
fn missing_and_present(values: &ColumnValues) -> (usize, usize) {
    let missing = match values {
        ColumnValues::Number(Numbers::Float(values)) => {
            values.iter().filter(|value| value.is_none()).count()
        }
        ColumnValues::Number(Numbers::Integer(values)) => {
            values.iter().filter(|value| value.is_none()).count()
        }
        ColumnValues::Text(values) => values.iter().filter(|value| value.is_none()).count(),
        ColumnValues::Category(categorical) | ColumnValues::Classification(categorical) => {
            categorical
                .codes()
                .iter()
                .filter(|code| code.is_none())
                .count()
        }
    };
    (missing, values.len().checked_sub(missing).unwrap())
}

fn numbers(table: &Table, name: &str) -> Vec<f64> {
    let column = table.columns().iter().find(|c| c.name() == name).unwrap();
    let ColumnValues::Number(Numbers::Float(values)) = column.values() else {
        panic!("{name} is not a number of decimals");
    };
    values.iter().flatten().copied().collect()
}

#[test]
fn the_demo_table_has_its_plants_and_columns_in_order() {
    let table = table().unwrap();
    assert_eq!(table.num_rows(), 2_000);
    assert_eq!(table.names().header(), "Individual ID");
    assert_eq!(table.names().names()[0], "VAV-0001");
    assert_eq!(table.names().names()[1_999], "VAV-2000");
    let columns: Vec<(&str, StorageType, Role)> = table
        .columns()
        .iter()
        .map(|column| {
            (
                column.name(),
                column.values().storage_type(),
                column.values().role(),
            )
        })
        .collect();
    assert_eq!(
        columns,
        [
            ("country", StorageType::Text, Role::Classification),
            ("cluster", StorageType::Text, Role::Classification),
            ("latitude", StorageType::Float, Role::Number),
            ("longitude", StorageType::Float, Role::Number),
            ("PC1", StorageType::Float, Role::Number),
            ("PC2", StorageType::Float, Role::Number),
            ("PC3", StorageType::Float, Role::Number),
            ("height", StorageType::Float, Role::Number),
            ("seeds", StorageType::Integer, Role::Number),
            ("fertile", StorageType::Boolean, Role::Category),
            ("flower colour", StorageType::Text, Role::Category),
            ("note", StorageType::Text, Role::Text),
        ]
    );
}

#[test]
fn the_levels_are_in_order_with_the_colours_from_orange() {
    let table = table().unwrap();
    let levels = |id: u32| -> (LevelValues, Vec<Colour>) {
        let categorical = table
            .column(ColumnId::new(id))
            .unwrap()
            .categorical()
            .unwrap();
        (categorical.levels().clone(), categorical.colours().to_vec())
    };
    let texts = |names: &[&str]| LevelValues::Text(names.iter().map(|n| (*n).to_owned()).collect());
    let (country, colours) = levels(1);
    assert_eq!(
        country,
        texts(&["China", "Ethiopia", "India", "Mexico", "Peru", "Spain"])
    );
    assert_eq!(colours, &PALETTE[..6]);
    assert_eq!(levels(2).0, texts(&["A", "B", "C", "D"]));
    assert_eq!(levels(10).0, LevelValues::Boolean(vec![false, true]));
    assert_eq!(levels(11).0, texts(&["pink", "purple", "white"]));
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
    let ColumnValues::Number(Numbers::Integer(seeds)) = column.values() else {
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
