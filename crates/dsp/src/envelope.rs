//! Envelope followers and level tracking used for smoothing and auto-gain (DSP-4, ER-4).

/// One-pole coefficient for a time constant, given the update rate in Hz.
pub fn coeff(time_constant_secs: f32, rate_hz: f32) -> f32 {
    if time_constant_secs <= 0.0 {
        0.0
    } else {
        (-1.0 / (time_constant_secs * rate_hz)).exp()
    }
}

/// Asymmetric one-pole follower: fast attack, slower release.
#[derive(Debug, Clone, Copy)]
pub struct Follower {
    pub value: f32,
    attack: f32,
    release: f32,
}

impl Follower {
    pub fn new(attack_secs: f32, release_secs: f32, rate_hz: f32) -> Self {
        Self {
            value: 0.0,
            attack: coeff(attack_secs, rate_hz),
            release: coeff(release_secs, rate_hz),
        }
    }

    pub fn set_times(&mut self, attack_secs: f32, release_secs: f32, rate_hz: f32) {
        self.attack = coeff(attack_secs, rate_hz);
        self.release = coeff(release_secs, rate_hz);
    }

    #[inline]
    pub fn update(&mut self, x: f32) -> f32 {
        let a = if x > self.value {
            self.attack
        } else {
            self.release
        };
        self.value = x + a * (self.value - x);
        self.value
    }
}

/// Slow peak tracker in dB for auto-gain: jumps up instantly, decays at `decay_db_per_sec`, and
/// never falls below `floor_db`. The floor is the noise gate's partner: a near-silent input
/// can't drag the reference down and get amplified into flashing (ER-4).
#[derive(Debug, Clone, Copy)]
pub struct PeakTracker {
    pub db: f32,
    decay_per_update: f32,
    floor_db: f32,
}

impl PeakTracker {
    pub fn new(floor_db: f32, decay_db_per_sec: f32, rate_hz: f32) -> Self {
        Self {
            db: floor_db,
            decay_per_update: decay_db_per_sec / rate_hz,
            floor_db,
        }
    }

    #[inline]
    pub fn update(&mut self, x_db: f32) -> f32 {
        self.db = (self.db - self.decay_per_update)
            .max(x_db)
            .max(self.floor_db);
        self.db
    }

    pub fn reset(&mut self) {
        self.db = self.floor_db;
    }
}

/// Power to dB with a floor, so log(0) never happens.
#[inline]
pub fn power_db(p: f32) -> f32 {
    10.0 * p.max(1e-12).log10()
}
