// Live "paint with motion" canvas: time on X, tilt → brush Y, pitch → hue
// temperature, motion speed → stroke width and chromatic-split / particle
// bursts on peaks. Strokes are Catmull-Rom smoothed and reflected below a
// horizon for a "painting on water" feel.

export interface PaintPoint {
  tNorm: number;
  y: number;
  pitch: number;
  speed: number;
}

export interface PainterOptions {
  duration: number;
}

const Y_CENTER_FRAC = 0.4;
const Y_RANGE_FRAC = 0.25;
const HORIZON_FRAC = 0.7;
const MIRROR_COMPRESSION = 0.5;
const MIRROR_ALPHA = 0.32;
const SPLIT_THRESHOLD = 0.6;
const BURST_THRESHOLD = 0.6;
const PEAK_RING_THRESHOLD = 0.55;

export interface Palette {
  baseHue: number;     // central hue of the painting
  pitchSwing: number;  // hue shift per unit pitch
  speedKick: number;   // hue shift per unit speed
  timeDrift: number;   // hue rotation across the full painting
}

export const DEFAULT_PALETTE: Palette = {
  baseHue: 295,
  pitchSwing: 55,
  speedKick: 90,
  timeDrift: 40,
};

const PALETTES: Record<string, Palette> = {
  // Calm session — green/teal/violet washes
  aurora:    { baseHue: 160, pitchSwing: 70,  speedKick: 50,  timeDrift: 90 },
  // Energetic — magenta/cyan/pink, sharp speed kicks
  synthwave: { baseHue: 320, pitchSwing: 50,  speedKick: 100, timeDrift: 60 },
  // Wild — narrow warm spectrum with extreme bursts
  lava:      { baseHue: 25,  pitchSwing: 35,  speedKick: 100, timeDrift: 30 },
  // Rhythmic — full-spectrum drift
  rainbow:   { baseHue: 200, pitchSwing: 100, speedKick: 60,  timeDrift: 200 },
};

export interface PalettePick {
  palette: Palette;
  name: string;
}

export function pickPalette(points: readonly PaintPoint[]): PalettePick {
  if (points.length < 4) return { palette: DEFAULT_PALETTE, name: "default" };
  let sumSpeed = 0;
  let sumSpeedSq = 0;
  let minTilt = 1;
  let maxTilt = -1;
  let crossings = 0;
  let prevSign = 0;
  for (const p of points) {
    sumSpeed += p.speed;
    sumSpeedSq += p.speed * p.speed;
    if (p.y < minTilt) minTilt = p.y;
    if (p.y > maxTilt) maxTilt = p.y;
    const s = p.y > 0.05 ? 1 : p.y < -0.05 ? -1 : 0;
    if (s !== 0 && prevSign !== 0 && s !== prevSign) crossings++;
    if (s !== 0) prevSign = s;
  }
  const n = points.length;
  const meanSpeed = sumSpeed / n;
  const speedStd = Math.sqrt(Math.max(0, sumSpeedSq / n - meanSpeed * meanSpeed));
  const tiltRange = maxTilt - minTilt;

  if (crossings >= 6 && tiltRange > 0.6) {
    return { palette: PALETTES.rainbow, name: "rainbow" };
  }
  if (meanSpeed > 0.35 && speedStd > 0.25) {
    return { palette: PALETTES.lava, name: "lava" };
  }
  if (meanSpeed > 0.3) {
    return { palette: PALETTES.synthwave, name: "synthwave" };
  }
  return { palette: PALETTES.aurora, name: "aurora" };
}

interface Pt { x: number; y: number }

function pointToScreen(p: PaintPoint, w: number, h: number): Pt {
  return {
    x: p.tNorm * w,
    y: h * Y_CENTER_FRAC - p.y * h * Y_RANGE_FRAC,
  };
}

function hueFor(point: PaintPoint, prev: PaintPoint, palette: Palette): number {
  const speed = (prev.speed + point.speed) / 2;
  const pitch = (prev.pitch + point.pitch) / 2;
  return (
    (palette.baseHue + pitch * palette.pitchSwing + speed * palette.speedKick + point.tNorm * palette.timeDrift) % 360 + 360
  ) % 360;
}

function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0a0e1a");
  g.addColorStop(0.55, "#080612");
  g.addColorStop(1, "#04040a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function buildCurvePath(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Path2D {
  const path = new Path2D();
  path.moveTo(p1.x, p1.y);
  // Catmull-Rom → cubic Bezier (uniform parameterization, tension 1).
  const c1x = p1.x + (p2.x - p0.x) / 6;
  const c1y = p1.y + (p2.y - p0.y) / 6;
  const c2x = p2.x - (p3.x - p1.x) / 6;
  const c2y = p2.y - (p3.y - p1.y) / 6;
  path.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  return path;
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  hue: number, speed: number, scale: number, alphaMult: number,
): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";

  ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${0.04 * alphaMult})`;
  ctx.lineWidth = (16 + speed * 28) * scale;
  ctx.stroke(path);

  ctx.strokeStyle = `hsla(${hue}, 90%, 65%, ${0.10 * alphaMult})`;
  ctx.lineWidth = (6 + speed * 14) * scale;
  ctx.stroke(path);

  ctx.strokeStyle = `hsla(${hue}, 95%, 70%, ${0.45 * alphaMult})`;
  ctx.lineWidth = (1.5 + speed * 5) * scale;
  ctx.stroke(path);

  ctx.globalCompositeOperation = prev;

  // Highlight only on the main pass — keeps mirror softer.
  if (alphaMult >= 0.9) {
    ctx.strokeStyle = `hsla(${(hue + 30) % 360}, 100%, 92%, 0.85)`;
    ctx.lineWidth = (0.6 + speed * 1.5) * scale;
    ctx.stroke(path);
  }
}

function drawChromaticSplit(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  speed: number, scale: number,
): void {
  if (speed <= SPLIT_THRESHOLD) return;
  const t = Math.min(1, (speed - SPLIT_THRESHOLD) / 0.6);
  const offsetMag = t * 6 * scale;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * offsetMag;
  const py = (dx / len) * offsetMag;
  const cw = (1 + speed * 2) * scale;

  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = cw;

  ctx.strokeStyle = "rgba(255, 60, 60, 0.55)";
  ctx.beginPath();
  ctx.moveTo(x1 - px, y1 - py); ctx.lineTo(x2 - px, y2 - py); ctx.stroke();

  ctx.strokeStyle = "rgba(60, 255, 90, 0.55)";
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  ctx.strokeStyle = "rgba(80, 100, 255, 0.55)";
  ctx.beginPath();
  ctx.moveTo(x1 + px, y1 + py); ctx.lineTo(x2 + px, y2 + py); ctx.stroke();

  ctx.globalCompositeOperation = prev;
}

function drawParticleBurst(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  hue: number, speed: number, scale: number,
): void {
  if (speed < BURST_THRESHOLD) return;
  const burst = Math.min(1.5, speed - BURST_THRESHOLD + 0.2);
  const count = Math.floor(burst * 12);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = (Math.random() * 32 + 6) * scale;
    const px = x + Math.cos(angle) * dist;
    const py = y + Math.sin(angle) * dist;
    const r = (0.8 + Math.random() * 2.2) * scale;
    const a = 0.25 + Math.random() * 0.5;
    const h = (hue + (Math.random() - 0.5) * 50 + 360) % 360;
    ctx.fillStyle = `hsla(${h}, 95%, 78%, ${a})`;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = prev;
}

export class Painter {
  private ctx: CanvasRenderingContext2D;
  private headCanvas: HTMLCanvasElement | null = null;
  private headCtx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private points: PaintPoint[] = [];
  private startedAt: number | null = null;
  private peakRingAt: number | null = null;
  private headRafId: number | null = null;

  constructor(
    public readonly canvas: HTMLCanvasElement,
    private readonly opts: PainterOptions = { duration: 10 },
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.installHead();
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private installHead(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const head = document.createElement("canvas");
    head.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none";
    parent.appendChild(head);
    this.headCanvas = head;
    this.headCtx = head.getContext("2d");
  }

  private resize = (): void => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.headCanvas && this.headCtx) {
      this.headCanvas.width = this.canvas.width;
      this.headCanvas.height = this.canvas.height;
      this.headCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    paintBackground(this.ctx, this.cssW, this.cssH);
    if (this.points.length >= 2) this.replay();
  };

  start(): void {
    this.startedAt = performance.now();
    if (this.headRafId === null) {
      this.headRafId = requestAnimationFrame(this.drawHead);
    }
  }

  reset(): void {
    this.points = [];
    this.startedAt = null;
    this.peakRingAt = null;
    paintBackground(this.ctx, this.cssW, this.cssH);
    this.headCtx?.clearRect(0, 0, this.cssW, this.cssH);
  }

  push(tilt: number, pitch: number, speed: number): void {
    if (this.startedAt === null) return;
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const tNorm = Math.max(0, Math.min(1, elapsed / this.opts.duration));
    const point: PaintPoint = { tNorm, y: tilt, pitch, speed };

    // Live drawing: render the segment ending at the previous stored point,
    // using p3 = incoming point as the forward tangent control.
    const len = this.points.length;
    if (len >= 2) {
      const p0 = len >= 3 ? this.points[len - 3] : this.points[len - 2];
      const p1 = this.points[len - 2];
      const p2 = this.points[len - 1];
      this.drawSegment(p0, p1, p2, point, DEFAULT_PALETTE);
    }
    this.points.push(point);

    if (speed > PEAK_RING_THRESHOLD) this.peakRingAt = performance.now();
  }

  destroy(): void {
    window.removeEventListener("resize", this.resize);
    if (this.headRafId !== null) cancelAnimationFrame(this.headRafId);
    this.headRafId = null;
    this.headCanvas?.remove();
    this.headCanvas = null;
    this.headCtx = null;
  }

  hideHead(): void {
    if (this.headRafId !== null) cancelAnimationFrame(this.headRafId);
    this.headRafId = null;
    this.headCtx?.clearRect(0, 0, this.cssW, this.cssH);
  }

  cascadeStep(intensity: number): void {
    if (this.points.length === 0) return;
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    const count = Math.floor(intensity * 6);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * this.points.length);
      const p = this.points[idx];
      const s = pointToScreen(p, w, h);
      const hue = (DEFAULT_PALETTE.baseHue + p.pitch * DEFAULT_PALETTE.pitchSwing + Math.random() * 80 + 360) % 360;
      drawParticleBurst(ctx, s.x, s.y, hue, 1.0 + Math.random() * 0.7, 1);
    }
  }

  get capturedPoints(): readonly PaintPoint[] {
    return this.points;
  }

  private drawSegment(
    p0: PaintPoint, p1: PaintPoint, p2: PaintPoint, p3: PaintPoint,
    palette: Palette,
  ): void {
    const w = this.cssW;
    const h = this.cssH;
    const horizon = h * HORIZON_FRAC;

    const s0 = pointToScreen(p0, w, h);
    const s1 = pointToScreen(p1, w, h);
    const s2 = pointToScreen(p2, w, h);
    const s3 = pointToScreen(p3, w, h);

    const path = buildCurvePath(s0, s1, s2, s3);
    const hue = hueFor(p2, p1, palette);
    const speed = (p1.speed + p2.speed) / 2;

    drawCore(this.ctx, path, hue, speed, 1, 1);
    drawChromaticSplit(this.ctx, s1.x, s1.y, s2.x, s2.y, speed, 1);
    drawParticleBurst(this.ctx, s2.x, s2.y, hue, speed, 1);

    // Mirror reflection — flip + compress vertically about horizon.
    this.ctx.save();
    this.ctx.setTransform(
      this.dpr, 0,
      0, -MIRROR_COMPRESSION * this.dpr,
      0, horizon * (1 + MIRROR_COMPRESSION) * this.dpr,
    );
    drawCore(this.ctx, path, hue, speed, 1, MIRROR_ALPHA);
    this.ctx.restore();
  }

  private replay(): void {
    paintBackground(this.ctx, this.cssW, this.cssH);
    const n = this.points.length;
    if (n < 2) return;
    for (let i = 1; i < n; i++) {
      const p0 = this.points[Math.max(0, i - 2)];
      const p1 = this.points[i - 1];
      const p2 = this.points[i];
      const p3 = this.points[Math.min(n - 1, i + 1)];
      this.drawSegment(p0, p1, p2, p3, DEFAULT_PALETTE);
    }
  }

  private drawHead = (): void => {
    this.headRafId = requestAnimationFrame(this.drawHead);
    const c = this.headCtx;
    if (!c) return;
    const w = this.cssW;
    const h = this.cssH;
    c.clearRect(0, 0, w, h);
    if (this.startedAt === null || this.points.length === 0) return;

    const last = this.points[this.points.length - 1];
    const prev = this.points.length > 1 ? this.points[this.points.length - 2] : last;
    const x = last.tNorm * w;
    const y = h * Y_CENTER_FRAC - last.y * h * Y_RANGE_FRAC;
    const hue = hueFor(last, prev, DEFAULT_PALETTE);

    const now = performance.now();
    const phase = (now / 700) * Math.PI * 2;
    const r = 4 + Math.sin(phase) * 1.5;

    c.save();
    c.globalCompositeOperation = "lighter";

    c.fillStyle = `hsla(${hue}, 95%, 78%, 0.22)`;
    c.beginPath();
    c.arc(x, y, r * 3.2, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = `hsla(${(hue + 20) % 360}, 100%, 94%, 0.9)`;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();

    if (this.peakRingAt !== null) {
      const age = (now - this.peakRingAt) / 450;
      if (age < 1) {
        c.strokeStyle = `hsla(${hue}, 95%, 80%, ${(1 - age) * 0.7})`;
        c.lineWidth = 2 * (1 - age);
        c.beginPath();
        c.arc(x, y, 8 + age * 36, 0, Math.PI * 2);
        c.stroke();
      } else {
        this.peakRingAt = null;
      }
    }

    c.restore();
  };
}

export interface FinalRenderOptions {
  size?: number;
  palette?: Palette;
}

export function renderPaintingFinal(
  canvas: HTMLCanvasElement,
  points: readonly PaintPoint[],
  opts: FinalRenderOptions = {},
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const size = opts.size ?? 1080;
  canvas.width = size;
  canvas.height = size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const palette = opts.palette ?? DEFAULT_PALETTE;

  const bg = ctx.createRadialGradient(
    size / 2, size * Y_CENTER_FRAC, size * 0.1,
    size / 2, size * Y_CENTER_FRAC, size * 0.78,
  );
  bg.addColorStop(0, "#10162a");
  bg.addColorStop(1, "#04050d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const scale = size / 540;
  const horizon = size * HORIZON_FRAC;
  const n = points.length;

  for (let i = 1; i < n; i++) {
    const p0 = points[Math.max(0, i - 2)];
    const p1 = points[i - 1];
    const p2 = points[i];
    const p3 = points[Math.min(n - 1, i + 1)];

    const s0 = pointToScreen(p0, size, size);
    const s1 = pointToScreen(p1, size, size);
    const s2 = pointToScreen(p2, size, size);
    const s3 = pointToScreen(p3, size, size);

    const path = buildCurvePath(s0, s1, s2, s3);
    const hue = hueFor(p2, p1, palette);
    const speed = (p1.speed + p2.speed) / 2;

    drawCore(ctx, path, hue, speed, scale, 1);
    drawChromaticSplit(ctx, s1.x, s1.y, s2.x, s2.y, speed, scale);
    drawParticleBurst(ctx, s2.x, s2.y, hue, speed, scale);

    ctx.save();
    ctx.setTransform(1, 0, 0, -MIRROR_COMPRESSION, 0, horizon * (1 + MIRROR_COMPRESSION));
    drawCore(ctx, path, hue, speed, scale, MIRROR_ALPHA);
    ctx.restore();
  }

  // A faint horizon line catches the eye at the reflection seam.
  ctx.strokeStyle = "rgba(232,236,245,0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(size, horizon);
  ctx.stroke();

  // Film grain
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n2 = (Math.random() - 0.5) * 8;
    d[i] = Math.max(0, Math.min(255, d[i] + n2));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n2));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n2));
  }
  ctx.putImageData(img, 0, 0);

  ctx.fillStyle = "rgba(232,236,245,0.4)";
  ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("hold-still", size - 24, size - 24);
}
