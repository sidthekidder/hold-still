// Single-pole IIR high-pass to strip gravity / DC drift.
// alpha ≈ exp(-2π·fc/fs); fc≈0.5 Hz at fs=60 Hz → alpha ≈ 0.948.
export class HighPass {
  private prevIn = 0;
  private prevOut = 0;
  private primed = false;
  constructor(private readonly alpha: number = 0.95) {}

  step(x: number): number {
    if (!this.primed) {
      this.prevIn = x;
      this.prevOut = 0;
      this.primed = true;
      return 0;
    }
    const y = this.alpha * (this.prevOut + x - this.prevIn);
    this.prevIn = x;
    this.prevOut = y;
    return y;
  }

  reset(): void {
    this.prevIn = 0;
    this.prevOut = 0;
    this.primed = false;
  }
}

// Single-pole IIR low-pass. alpha = 1 - exp(-2π·fc/fs).
// fc≈12 Hz at fs=60 Hz → alpha ≈ 0.72. Use 0.5 for ~7 Hz cutoff.
export class LowPass {
  private prev = 0;
  private primed = false;
  constructor(private readonly alpha: number = 0.5) {}

  step(x: number): number {
    if (!this.primed) {
      this.prev = x;
      this.primed = true;
      return x;
    }
    this.prev = this.alpha * x + (1 - this.alpha) * this.prev;
    return this.prev;
  }

  reset(): void {
    this.prev = 0;
    this.primed = false;
  }
}

// Hard noise gate with smooth shoulder. Anything below `threshold` collapses
// to zero; above, output grows from zero linearly so there's no step.
export function deadband(x: number, threshold: number): number {
  if (x > threshold) return x - threshold;
  if (x < -threshold) return x + threshold;
  return 0;
}
