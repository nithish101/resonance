/** Fixed-capacity sample window with percentile queries. Allocation-free after construction. */
export class Window {
  private readonly values: Float64Array;
  private readonly scratch: Float64Array;
  private n = 0;
  private head = 0;

  constructor(capacity: number) {
    this.values = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  push(v: number): void {
    this.values[this.head] = v;
    this.head = (this.head + 1) % this.values.length;
    if (this.n < this.values.length) this.n++;
  }

  get size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
    this.head = 0;
  }

  /** p in [0, 1]. Nearest-rank percentile; 0 when empty. */
  percentile(p: number): number {
    if (this.n === 0) return 0;
    const s = this.scratch.subarray(0, this.n);
    s.set(this.values.subarray(0, this.n));
    s.sort();
    return s[Math.min(this.n - 1, Math.max(0, Math.ceil(p * this.n) - 1))]!;
  }

  max(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, this.values[i]!);
    return m;
  }

  mean(): number {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.values[i]!;
    return this.n ? s / this.n : 0;
  }
}

/** performance.now() on a clock shared by every thread (ms since the Unix epoch). */
export const wallNow = () => performance.timeOrigin + performance.now();
