//! A minimal complex type. Keeping our own (instead of `num-complex`) keeps the WASM build free
//! of dependencies and lets the FFT be read top to bottom.

use core::ops::{Add, Mul, Sub};

#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[repr(C)]
pub struct Complex {
    pub re: f32,
    pub im: f32,
}

impl Complex {
    pub const ZERO: Self = Self { re: 0.0, im: 0.0 };

    #[inline(always)]
    pub const fn new(re: f32, im: f32) -> Self {
        Self { re, im }
    }

    #[inline(always)]
    pub fn conj(self) -> Self {
        Self::new(self.re, -self.im)
    }

    #[inline(always)]
    pub fn norm_sqr(self) -> f32 {
        self.re * self.re + self.im * self.im
    }

    #[inline(always)]
    pub fn norm(self) -> f32 {
        self.norm_sqr().sqrt()
    }

    #[inline(always)]
    pub fn scale(self, k: f32) -> Self {
        Self::new(self.re * k, self.im * k)
    }

    /// e^{i·theta}, computed in f64 so large tables stay accurate.
    pub fn cis(theta: f64) -> Self {
        Self::new(theta.cos() as f32, theta.sin() as f32)
    }
}

impl Add for Complex {
    type Output = Self;
    #[inline(always)]
    fn add(self, o: Self) -> Self {
        Self::new(self.re + o.re, self.im + o.im)
    }
}

impl Sub for Complex {
    type Output = Self;
    #[inline(always)]
    fn sub(self, o: Self) -> Self {
        Self::new(self.re - o.re, self.im - o.im)
    }
}

impl Mul for Complex {
    type Output = Self;
    #[inline(always)]
    fn mul(self, o: Self) -> Self {
        Self::new(
            self.re * o.re - self.im * o.im,
            self.re * o.im + self.im * o.re,
        )
    }
}
