//! Online beat tracking (DSP-7): a phase-locked beat predictor driven by the tempo estimate.
//!
//! The tempo estimator says *how often* beats happen; this module decides *when*. Every
//! `UPDATE_EVERY` hops it finds the phase that best explains the recent onset-strength envelope,
//! by scoring a comb of impulses one beat period apart:
//!
//! ```text
//! score(o) = Σ_k w_k · env[now - o - k·P],   w_k = 0.8^k,   o in [0, P)
//! ```
//!
//! where `o` is how many frames ago the most recent beat was. That measurement steers a
//! phase-locked loop: small disagreements nudge the predicted next beat by a fraction of the
//! error, and a large one has to repeat before the tracker jumps, so a single syncopated hit
//! can't knock it off. Beats are emitted when the frame clock reaches the *predicted* time, so
//! they land on the beat rather than one detection delay after it. `phase` runs 0..1 between
//! beats, for animation.
//!
//! When the tempo changes, the period follows the estimator immediately, and the next comb
//! measurement re-locks the phase.

pub const HISTORY: usize = 512;
const UPDATE_EVERY: usize = 4;
const LOOP_GAIN: f32 = 0.35;
const JUMP_AFTER: u32 = 2;

pub struct BeatTracker {
    env: [f32; HISTORY],
    pos: usize,
    filled: usize,
    /// Frame counter (hops since start).
    t: f64,
    since_update: usize,
    /// Beat period in frames (0 = no tempo yet).
    period: f64,
    /// Predicted frame of the next beat.
    next_beat: f64,
    last_beat: f64,
    disagreements: u32,
    pub phase: f32,
    /// True on the hop during which a predicted beat fell.
    pub beat: bool,
    /// Fractional frame (hops since start) of the beat emitted on this hop.
    pub beat_frame: f64,
}

impl Default for BeatTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl BeatTracker {
    pub fn new() -> Self {
        Self {
            env: [0.0; HISTORY],
            pos: 0,
            filled: 0,
            t: 0.0,
            since_update: 0,
            period: 0.0,
            next_beat: 0.0,
            last_beat: 0.0,
            disagreements: 0,
            phase: 0.0,
            beat: false,
            beat_frame: 0.0,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// Envelope value `ago` frames before the newest (linear interpolation; 0 outside history).
    fn env_ago(&self, ago: f64) -> f32 {
        if ago < 0.0 {
            return 0.0;
        }
        let i = ago.floor() as usize;
        if i + 1 >= self.filled {
            return 0.0;
        }
        let frac = (ago - i as f64) as f32;
        let at = |k: usize| self.env[(self.pos + HISTORY - 1 - k) % HISTORY];
        at(i) * (1.0 - frac) + at(i + 1) * frac
    }

    /// Frames since the most recent beat, according to the comb over recent onset strength.
    fn measure_offset(&self) -> f64 {
        let p = self.period;
        let combs = ((self.filled as f64 / p).floor() as usize).clamp(1, 8);
        let steps = p.ceil() as usize;
        let mut best = (0.0, f32::MIN);
        for s in 0..steps {
            let o = s as f64;
            let mut score = 0.0;
            let mut w = 1.0;
            for k in 0..combs {
                score += w * self.env_ago(o + k as f64 * p);
                w *= 0.8;
            }
            if score > best.1 {
                best = (o, score);
            }
        }
        best.0
    }

    /// Advances one hop with this hop's onset strength and the current tempo (frames per beat
    /// derived from `bpm`, 0 = unknown). No allocation.
    pub fn update(&mut self, strength: f32, bpm: f32, hop_rate: f32) {
        self.env[self.pos] = strength;
        self.pos = (self.pos + 1) % HISTORY;
        self.filled = (self.filled + 1).min(HISTORY);
        self.beat = false;

        if bpm > 0.0 {
            let p = 60.0 * hop_rate as f64 / bpm as f64;
            if self.period == 0.0 {
                self.period = p;
                self.next_beat = self.t + p;
                self.last_beat = self.t;
            } else {
                self.period = p;
            }
        }

        if self.period > 0.0 {
            self.since_update += 1;
            if self.since_update >= UPDATE_EVERY && self.filled as f64 > 2.0 * self.period {
                self.since_update = 0;
                let p = self.period;
                // The comb says the last beat was `offset` frames ago, so the next is due at:
                let measured = self.t - self.measure_offset() + p;
                // Wrap the error into (-P/2, P/2] relative to our prediction.
                let mut err = measured - self.next_beat;
                err -= p * (err / p).round();
                if err.abs() < 0.2 * p {
                    self.next_beat += LOOP_GAIN as f64 * err;
                    self.disagreements = 0;
                } else {
                    self.disagreements += 1;
                    if self.disagreements >= JUMP_AFTER {
                        self.next_beat += err;
                        self.disagreements = 0;
                    }
                }
                // Never schedule a beat in the past.
                while self.next_beat <= self.t {
                    self.next_beat += p;
                }
            }

            if self.t + 1.0 > self.next_beat {
                self.beat = true;
                self.beat_frame = self.next_beat;
                self.last_beat = self.next_beat;
                self.next_beat += self.period;
            }
            self.phase = (((self.t - self.last_beat) / self.period).clamp(0.0, 1.0)) as f32;
        }
        self.t += 1.0;
    }
}
