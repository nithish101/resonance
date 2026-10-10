//! MIR evaluation metrics (PRD 9.2), shared by the tests and the `pnpm eval` runner.

/// Precision, recall, and F-measure of `detections` against `truth` (both in seconds, sorted),
/// matching each truth event to at most one detection within `tolerance` seconds (greedy by
/// closeness, as in mir_eval's onset evaluation).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FMeasure {
    pub precision: f64,
    pub recall: f64,
    pub f: f64,
    pub matched: usize,
}

pub fn f_measure(detections: &[f64], truth: &[f64], tolerance: f64) -> FMeasure {
    if detections.is_empty() || truth.is_empty() {
        let both_empty = detections.is_empty() && truth.is_empty();
        let v = if both_empty { 1.0 } else { 0.0 };
        return FMeasure {
            precision: v,
            recall: v,
            f: v,
            matched: 0,
        };
    }
    // Candidate pairs within tolerance, closest first.
    let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
    for (i, &d) in detections.iter().enumerate() {
        for (j, &t) in truth.iter().enumerate() {
            let e = (d - t).abs();
            if e <= tolerance {
                pairs.push((e, i, j));
            }
        }
    }
    pairs.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut used_d = vec![false; detections.len()];
    let mut used_t = vec![false; truth.len()];
    let mut matched = 0;
    for (_, i, j) in pairs {
        if !used_d[i] && !used_t[j] {
            used_d[i] = true;
            used_t[j] = true;
            matched += 1;
        }
    }
    let precision = matched as f64 / detections.len() as f64;
    let recall = matched as f64 / truth.len() as f64;
    let f = if matched == 0 {
        0.0
    } else {
        2.0 * precision * recall / (precision + recall)
    };
    FMeasure {
        precision,
        recall,
        f,
        matched,
    }
}

/// Tempo accuracy 1: estimate within 4% of the reference.
pub fn acc1(estimate: f64, reference: f64) -> bool {
    (estimate - reference).abs() <= 0.04 * reference
}

/// Tempo accuracy 2: Acc1, or within 4% of double, half, triple, or a third of the reference.
pub fn acc2(estimate: f64, reference: f64) -> bool {
    [1.0, 2.0, 0.5, 3.0, 1.0 / 3.0]
        .iter()
        .any(|k| acc1(estimate, reference * k))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perfect_and_partial_matches() {
        let t = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(f_measure(&t, &t, 0.07).f, 1.0);
        let d = [1.05, 2.2, 3.0];
        let m = f_measure(&d, &t, 0.07);
        assert_eq!(m.matched, 2);
        assert!((m.precision - 2.0 / 3.0).abs() < 1e-12);
        assert!((m.recall - 0.5).abs() < 1e-12);
    }

    #[test]
    fn one_detection_matches_one_truth() {
        let m = f_measure(&[1.0], &[0.98, 1.02], 0.07);
        assert_eq!(m.matched, 1);
    }

    #[test]
    fn tempo_accuracy() {
        assert!(acc1(121.0, 120.0));
        assert!(!acc1(130.0, 120.0));
        assert!(!acc1(60.0, 120.0) && acc2(60.0, 120.0));
        assert!(acc2(241.0, 120.0));
    }
}
