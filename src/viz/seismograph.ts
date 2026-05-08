// Live scrolling 3-axis waveform during the recording phase.

const COLORS = ["#ff8a65", "#7aa2ff", "#9affc1"] as const;
const TRACE_COUNT = 3;

export interface SeismographOptions {
  duration: number; // seconds visible on screen
  axes: 2 | 3;
  // Minimum auto-scale amplitude. Stops the trace from filling the screen
  // with magnified sensor noise after a deadband, in input-mode-native units.
  scaleFloor?: number;
}

export class Seismograph {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private buffers: number[][] = [[], [], []];
  private maxAmp: number;
  private rafId: number | null = null;

  constructor(
    public readonly canvas: HTMLCanvasElement,
    private readonly opts: SeismographOptions = { duration: 5, axes: 3 },
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.maxAmp = opts.scaleFloor ?? 1.5;
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private resize = (): void => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { canvas } = this;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  push(dx: number, dy: number, dz: number): void {
    const limit = Math.ceil(this.opts.duration * 60) + 64;
    this.buffers[0].push(dx);
    this.buffers[1].push(dy);
    this.buffers[2].push(dz);
    for (const buf of this.buffers) {
      while (buf.length > limit) buf.shift();
    }
    // Auto-range: track recent peak with fast decay so small signals stay
    // visible after a startup transient. Floor prevents divide-by-near-zero.
    const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const floor = this.opts.scaleFloor ?? 1.5;
    if (m > this.maxAmp) this.maxAmp = m;
    else this.maxAmp = Math.max(floor, this.maxAmp * 0.96 + m * 0.04);
  }

  start(): void {
    if (this.rafId !== null) return;
    const draw = (): void => {
      this.render();
      this.rafId = requestAnimationFrame(draw);
    };
    this.rafId = requestAnimationFrame(draw);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.resize);
  }

  private render(): void {
    const { ctx, canvas } = this;
    const w = canvas.width / this.dpr;
    const h = canvas.height / this.dpr;
    ctx.clearRect(0, 0, w, h);

    const axes = this.opts.axes;
    const half = h / 2;
    const amp = Math.max(this.maxAmp, 0.01);

    for (let a = 0; a < TRACE_COUNT; a++) {
      if (a >= axes) continue;
      const buf = this.buffers[a];
      if (buf.length < 2) continue;
      ctx.strokeStyle = COLORS[a];
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      const stepX = w / Math.max(buf.length - 1, 1);
      for (let i = 0; i < buf.length; i++) {
        const x = i * stepX;
        const norm = Math.max(-1, Math.min(1, buf[i] / amp));
        const y = half - norm * (half * 0.8);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  get latestSamples(): { x: number[]; y: number[]; z: number[] } {
    return {
      x: [...this.buffers[0]],
      y: [...this.buffers[1]],
      z: [...this.buffers[2]],
    };
  }
}
