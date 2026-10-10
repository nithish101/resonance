//! DSP-11: the per-hop hot path performs zero heap allocations. A counting global allocator
//! wraps the system allocator for this test binary only.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;
static ALLOCS: AtomicUsize = AtomicUsize::new(0);

// SAFETY: forwards to the system allocator unchanged; only counts calls.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: same contract as the caller's.
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        // SAFETY: same contract as the caller's.
        unsafe { System.dealloc(p, l) }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: same contract as the caller's.
        unsafe { System.realloc(p, l, n) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

#[test]
fn process_does_not_allocate() {
    let f = resonance_fixtures::groove(48_000, 120.0, 6.0, 3);
    let mono = f.mono();
    for sr in [44_100.0f32, 48_000.0] {
        let mut a = resonance_dsp::Analyzer::new(resonance_dsp::Config::new(sr));
        let hop = a.config().hop;
        let before = ALLOCS.load(Ordering::SeqCst);
        for chunk in mono.chunks_exact(hop) {
            a.input_mut().copy_from_slice(chunk);
            a.process();
        }
        a.set_params(2.0, 0.1);
        a.reset();
        let after = ALLOCS.load(Ordering::SeqCst);
        assert_eq!(
            after - before,
            0,
            "process() allocated {} times",
            after - before
        );
        assert!(a.hops() > 500);
    }
}
