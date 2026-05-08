import type { TremorFeatures } from "../dsp/features";

const LINEAR_COLORS = ["#ff8a65", "#7aa2ff", "#9affc1"] as const;

export interface MorphInput {
  features: TremorFeatures;
  series: { x: number[]; y: number[]; z: number[] };
  axes: 2 | 3;
  duration: number;
  // Absolute amplitude that maps to a "full" radial wobble. Same value across
  // sessions in a given input mode → still recordings render quieter.
  referenceAmplitude: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function hueFor(freq: number): number {
  // 3 Hz → 220 (cool), 15 Hz → 10 (warm).
  const t = Math.max(0, Math.min(1, (freq - 3) / 12));
  return 220 - t * 210;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function runMorph(
  canvas: HTMLCanvasElement,
  input: MorphInput,
  onComplete: () => void,
): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    onComplete();
    return () => undefined;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(w, h) * 0.28;

  const buffers = [input.series.x, input.series.y, input.series.z];
  const polarHues = [
    hueFor(input.features.x.dominantFreq),
    hueFor(input.features.y.dominantFreq),
    hueFor(input.features.z.dominantFreq),
  ];

  // Linear (seismo-side) auto-scale matches what the user just saw on screen
  // so the morph starts visually continuous with the live waveform.
  const peakSample = Math.max(
    1e-3,
    ...buffers.flatMap((b) => b.map(Math.abs)),
  );
  const seismoMaxAmp = peakSample * 1.1;
  // Polar (fingerprint-side) is absolute. Soft-saturated so heavy shakes
  // can't blow past the ring and still recordings render small.
  const refAmp = Math.max(input.referenceAmplitude, 1e-3);
  const half = h / 2;

  let cancelled = false;
  let rafId = 0;
  const start = performance.now();

  const tick = (): void => {
    if (cancelled) return;
    const elapsed = performance.now() - start;
    const raw = Math.min(1, elapsed / input.duration);
    const t = easeInOutCubic(raw);

    ctx.clearRect(0, 0, w, h);

    // Outer ring fades in as the line wraps up.
    const ringAlpha = t * 0.18;
    if (ringAlpha > 0.01) {
      ctx.strokeStyle = `rgba(122,162,255,${ringAlpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 1.3, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let a = 0; a < 3; a++) {
      if (a >= input.axes) continue;
      const buf = buffers[a];
      if (buf.length < 2) continue;

      const polarColor = `hsla(${polarHues[a]}, 80%, 65%, ${0.55 + 0.25 * (1 - t)})`;
      const linColor = LINEAR_COLORS[a];
      ctx.strokeStyle = t < 0.4 ? linColor : polarColor;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();

      const N = buf.length;
      for (let i = 0; i < N; i++) {
        const u = N === 1 ? 0 : i / (N - 1);
        const v = buf[i];

        // Linear (seismograph) endpoint.
        const xLin = u * w;
        const normLin = Math.max(-1, Math.min(1, v / seismoMaxAmp));
        const yLin = half - normLin * (half * 0.8);

        // Polar (fingerprint) endpoint — absolute scale + soft saturation.
        const theta = u * Math.PI * 2 - Math.PI / 2;
        const normPol = Math.tanh(v / refAmp);
        const r = baseR + normPol * (baseR * 0.4);
        const xPol = cx + Math.cos(theta) * r;
        const yPol = cy + Math.sin(theta) * r;

        const x = lerp(xLin, xPol, t);
        const y = lerp(yLin, yPol, t);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (raw < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      onComplete();
    }
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
  };
}
