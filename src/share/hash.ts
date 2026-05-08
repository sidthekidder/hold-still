import type { TremorFeatures, AxisFeatures } from "../dsp/features";

// Compact: 4 fields × 3 axes × 2 bytes (uint16 quantized) + 3 asymmetry × 1 byte = 27 bytes
// + 2-byte sample-rate + 2-byte sample-count = 31 bytes. Plenty of headroom under 80.

const FREQ_MAX = 30; // Hz cap
const AMP_MAX = 4; // generous (m/s² for phone, px/frame for mouse)
const SPREAD_MAX = 10;
const KURT_MIN = -3;
const KURT_MAX = 30;

function quant(value: number, lo: number, hi: number, bits: number): number {
  const span = hi - lo;
  const t = Math.max(0, Math.min(1, (value - lo) / span));
  const max = (1 << bits) - 1;
  return Math.round(t * max);
}

function dequant(q: number, lo: number, hi: number, bits: number): number {
  const span = hi - lo;
  const max = (1 << bits) - 1;
  return lo + (q / max) * span;
}

function packAxis(buf: number[], a: AxisFeatures): void {
  buf.push(quant(a.dominantFreq, 0, FREQ_MAX, 16) & 0xff, (quant(a.dominantFreq, 0, FREQ_MAX, 16) >> 8) & 0xff);
  buf.push(quant(a.amplitude, 0, AMP_MAX, 16) & 0xff, (quant(a.amplitude, 0, AMP_MAX, 16) >> 8) & 0xff);
  buf.push(quant(a.spectralSpread, 0, SPREAD_MAX, 16) & 0xff, (quant(a.spectralSpread, 0, SPREAD_MAX, 16) >> 8) & 0xff);
  buf.push(quant(a.peakiness, KURT_MIN, KURT_MAX, 16) & 0xff, (quant(a.peakiness, KURT_MIN, KURT_MAX, 16) >> 8) & 0xff);
}

function unpackAxis(bytes: Uint8Array, off: number): AxisFeatures {
  const u16 = (i: number): number => bytes[off + i] | (bytes[off + i + 1] << 8);
  return {
    dominantFreq: dequant(u16(0), 0, FREQ_MAX, 16),
    amplitude: dequant(u16(2), 0, AMP_MAX, 16),
    spectralSpread: dequant(u16(4), 0, SPREAD_MAX, 16),
    peakiness: dequant(u16(6), KURT_MIN, KURT_MAX, 16),
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 0 ? "" : "=".repeat(4 - (b64url.length % 4));
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeFeatures(f: TremorFeatures): string {
  const buf: number[] = [];
  packAxis(buf, f.x);
  packAxis(buf, f.y);
  packAxis(buf, f.z);
  for (const a of f.axisAsymmetry) {
    buf.push(quant(a, 0, 1, 8));
  }
  buf.push(Math.min(255, Math.round(f.sampleRate)) & 0xff);
  const count = Math.min(0xffff, f.sampleCount);
  buf.push(count & 0xff, (count >> 8) & 0xff);
  return bytesToBase64Url(new Uint8Array(buf));
}

export function decodeFeatures(hash: string): TremorFeatures | null {
  try {
    const bytes = base64UrlToBytes(hash);
    if (bytes.length < 24 + 3 + 3) return null;
    const x = unpackAxis(bytes, 0);
    const y = unpackAxis(bytes, 8);
    const z = unpackAxis(bytes, 16);
    const a0 = dequant(bytes[24], 0, 1, 8);
    const a1 = dequant(bytes[25], 0, 1, 8);
    const a2 = dequant(bytes[26], 0, 1, 8);
    const sampleRate = bytes[27] || 60;
    const sampleCount = bytes[28] | (bytes[29] << 8);
    return {
      x, y, z,
      axisAsymmetry: [a0, a1, a2],
      sampleRate,
      sampleCount,
    };
  } catch {
    return null;
  }
}

export function readHashFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("f");
}
