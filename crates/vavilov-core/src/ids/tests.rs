use super::*;

#[test]
fn a_revision_grows_by_one_up_to_the_largest_number_a_window_reads_exactly() {
    assert_eq!(Revision::ZERO.next(), Ok(Revision::new(1)));
    assert_eq!(
        Revision::new(9_007_199_254_740_990).next(),
        Ok(Revision::new(9_007_199_254_740_991))
    );
    assert_eq!(
        Revision::new(9_007_199_254_740_991).next(),
        Err(CommandError::Defect {
            what: "the revision would pass 9007199254740991".to_owned()
        })
    );
    assert!(Revision::new(u64::MAX).next().is_err());
}

#[test]
fn a_hover_sequence_number_stops_at_the_same_bound() {
    assert_eq!(HoverSeq::ZERO.next().map(HoverSeq::get), Ok(1));
    assert!(HoverSeq::new(9_007_199_254_740_991).next().is_err());
}

#[test]
fn a_time_that_is_not_finite_is_a_defect() {
    assert_eq!(
        SentAt::new(1_727_865_600_000.5).map(SentAt::get),
        Ok(1_727_865_600_000.5)
    );
    for time in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(matches!(
            SentAt::new(time),
            Err(CommandError::Defect { .. })
        ));
    }
}
