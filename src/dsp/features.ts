import { fft, hannWindow, magnitudeSpectrum } from "./fft";

export interface AxisFeatures {
  dominantFreq: number;
  amplitude: number;
  spectralSpread: number;
  peakiness: number;
}

export interface TremorFeatures {
  x: AxisFeatures;
  y: AxisFeatures;
  z: AxisFeatures;
  axisAsymmetry: [number, number, number];
  sampleRate: number;
  sampleCount: number;
}

const FREQ_LOW = 3;
const FREQ_HIGH = 15;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function rms(arr: Float64Array | number[]): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / arr.length);
}

function kurtosis(arr: Float64Array | number[]): number {
  const n = arr.length;
  if (n === 0) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += arr[i];
  mean /= n;
  let m2 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= n;
  m4 /= n;
  if (m2 === 0) return 0;
  return m4 / (m2 * m2) - 3;
}

export function extractAxis(samples: number[], sampleRate: number): AxisFeatures {
  const n = samples.length;
  if (n < 8) {
    return { dominantFreq: 0, amplitude: 0, spectralSpread: 0, peakiness: 0 };
  }

  const amplitude = rms(samples);
  const peakiness = kurtosis(samples);

  const N = nextPow2(n);
  const real = new Float64Array(N);
  const imag = new Float64Array(N);
  const w = hannWindow(n);
  for (let i = 0; i < n; i++) real[i] = samples[i] * w[i];
  fft(real, imag);
  const mags = magnitudeSpectrum(real, imag);

  const binHz = sampleRate / N;
  const lo = Math.max(1, Math.floor(FREQ_LOW / binHz));
  const hi = Math.min(mags.length - 1, Math.ceil(FREQ_HIGH / binHz));

  let peakBin = lo;
  let peakMag = 0;
  for (let k = lo; k <= hi; k++) {
    if (mags[k] > peakMag) {
      peakMag = mags[k];
      peakBin = k;
    }
  }

  // Spectral spread: weighted std-dev of magnitude around the peak.
  let totalMag = 0;
  let weightedVar = 0;
  for (let k = lo; k <= hi; k++) {
    const f = k * binHz;
    const peakF = peakBin * binHz;
    weightedVar += mags[k] * (f - peakF) * (f - peakF);
    totalMag += mags[k];
  }
  const spectralSpread = totalMag > 0 ? Math.sqrt(weightedVar / totalMag) : 0;

  return {
    dominantFreq: peakBin * binHz,
    amplitude,
    spectralSpread,
    peakiness,
  };
}

export function extract(
  xs: number[],
  ys: number[],
  zs: number[],
  sampleRate: number,
): TremorFeatures {
  const x = extractAxis(xs, sampleRate);
  const y = extractAxis(ys, sampleRate);
  const z = extractAxis(zs, sampleRate);
  const total = x.amplitude + y.amplitude + z.amplitude || 1;
  return {
    x,
    y,
    z,
    axisAsymmetry: [x.amplitude / total, y.amplitude / total, z.amplitude / total],
    sampleRate,
    sampleCount: xs.length,
  };
}
