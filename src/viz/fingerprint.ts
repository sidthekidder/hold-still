import type { TremorFeatures } from "../dsp/features";

export interface FingerprintInput {
  features: TremorFeatures;
  // Raw per-axis samples used to bend the timeline into a closed loop.
  series: { x: number[]; y: number[]; z: number[] };
  // Absolute amplitude reference; see main.ts. Permalink view picks a default.
  referenceAmplitude?: number;
}

const SIZE = 1080;
const BG = "#0a0e1a";

function hueFor(freq: number): number {
  // 3 Hz → 220 (cool blue), 15 Hz → 10 (warm red).
  const t = Math.max(0, Math.min(1, (freq - 3) / 12));
  return 220 - t * 210;
}

function drawBackground(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);
  // Subtle grain.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 6;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  baseR: number,
  samples: number[],
  refAmp: number,
  hue: number,
): void {
  if (samples.length < 4) return;
  const n = samples.length;
  const refSafe = Math.max(refAmp, 0.001);
  ctx.strokeStyle = `hsla(${hue}, 80%, 65%, 0.55)`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const theta = (i / n) * Math.PI * 2 - Math.PI / 2;
    // Absolute amplitude → tanh saturation. Same shake → same image, always.
    const norm = Math.tanh(samples[idx] / refSafe);
    const r = baseR + norm * (baseR * 0.4);
    const x = cx + Math.cos(theta) * r;
    const y = cy + Math.sin(theta) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawSeal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hash: number,
): void {
  const grid = 5;
  const cell = 14;
  const total = grid * cell;
  const ox = cx - total / 2;
  const oy = cy - total / 2;
  ctx.fillStyle = "rgba(232,236,245,0.85)";
  let h = hash >>> 0;
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      h = (h * 1664525 + 1013904223) >>> 0;
      if ((h & 0xff) > 140) {
        ctx.fillRect(ox + c * cell, oy + r * cell, cell - 3, cell - 3);
      }
    }
  }
}

function hashFeatures(f: TremorFeatures): number {
  const parts = [
    f.x.dominantFreq, f.x.amplitude, f.x.spectralSpread, f.x.peakiness,
    f.y.dominantFreq, f.y.amplitude, f.y.spectralSpread, f.y.peakiness,
    f.z.dominantFreq, f.z.amplitude, f.z.spectralSpread, f.z.peakiness,
    ...f.axisAsymmetry,
  ];
  let h = 2166136261;
  for (const p of parts) {
    const bits = Math.floor(p * 1e6) >>> 0;
    h ^= bits;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function renderFingerprint(
  canvas: HTMLCanvasElement,
  input: FingerprintInput,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  canvas.width = SIZE;
  canvas.height = SIZE;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  drawBackground(ctx, SIZE);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const baseR = SIZE * 0.32;
  const { features: f, series } = input;

  // Outer ring whose width modulates with mean spectral spread.
  const meanSpread = (f.x.spectralSpread + f.y.spectralSpread + f.z.spectralSpread) / 3;
  ctx.strokeStyle = "rgba(122,162,255,0.18)";
  ctx.lineWidth = Math.max(1, Math.min(18, 1 + meanSpread * 3));
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 1.3, 0, Math.PI * 2);
  ctx.stroke();

  // Default for permalink view (no input mode known); gyro-tuned.
  const refAmp = input.referenceAmplitude ?? 0.6;
  drawTrace(ctx, cx, cy, baseR, series.x, refAmp, hueFor(f.x.dominantFreq));
  drawTrace(ctx, cx, cy, baseR, series.y, refAmp, hueFor(f.y.dominantFreq));
  drawTrace(ctx, cx, cy, baseR, series.z, refAmp, hueFor(f.z.dominantFreq));

  drawSeal(ctx, cx, cy, hashFeatures(f));

  // Watermark
  ctx.fillStyle = "rgba(232,236,245,0.4)";
  ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("hold-still", SIZE - 24, SIZE - 24);
}
