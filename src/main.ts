import "./style.css";
import { StateMachine } from "./app/state";
import { GyroAdapter, isGyroSupported } from "./input/gyroAdapter";
import { MouseAdapter } from "./input/mouseAdapter";
import type { InputAdapter, Sample } from "./input/types";
import { PermissionDeniedError } from "./input/types";
import { HighPass, LowPass, deadband } from "./dsp/filter";
import { extract, type TremorFeatures } from "./dsp/features";
import { Seismograph } from "./viz/seismograph";
import { renderFingerprint } from "./viz/fingerprint";
import { runMorph } from "./viz/morph";
import { downloadPNG, shareCanvas } from "./share/png";
import { decodeFeatures, encodeFeatures, readHashFromUrl } from "./share/hash";

const RECORD_SECONDS = 10;
const CALIBRATE_MS = 2000;

// Gyro: iOS accelerometer noise σ ≈ 50–80 mg even when stationary.
// Anything below this threshold we treat as "still". Tremor signals worth
// drawing are typically 100 mg+.
const GYRO_NOISE_FLOOR = 0.12; // m/s²

// Reference amplitude — defines what "fills the polar ring" looks like.
// Same recording always renders at the same absolute size, so a still
// session reads as a quiet wobble and a shaky session fills the ring.
const GYRO_REF_AMP = 0.6;  // m/s² ≈ moderate tremor
const MOUSE_REF_AMP = 8;   // px/frame

const root = document.getElementById("app") as HTMLElement;
const sm = new StateMachine();

const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
const inputMode: "gyro" | "mouse" = isCoarsePointer && isGyroSupported() ? "gyro" : "mouse";

const xs: number[] = [];
const ys: number[] = [];
const zs: number[] = [];
const hpX = new HighPass();
const hpY = new HighPass();
const hpZ = new HighPass();
const lpX = new LowPass(0.4);
const lpY = new LowPass(0.4);
const lpZ = new LowPass(0.4);
let recordStart = 0;
let recordTimer: number | null = null;
let stallCheck: number | null = null;
// Tracks whether the raw input source is producing any samples at all.
// Post-deadband filtered values can legitimately be zero (still phone), so
// we monitor pre-filter activity to detect a dead motion API.
let rawSamplesSeen = 0;
let rawAnyNonZero = false;

let adapter: InputAdapter | null = null;
let seismograph: Seismograph | null = null;

function clearRoot(): void {
  root.innerHTML = "";
}

function renderLanding(): void {
  clearRoot();
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.innerHTML = `
    <div>
      <h1 class="title">Can you hold still?</h1>
      <button class="begin" type="button">Begin</button>
      <p class="caption">${
        inputMode === "gyro"
          ? "Reading from your phone's motion sensors"
          : "Reading from your mouse"
      }</p>
    </div>
  `;
  screen.querySelector(".begin")?.addEventListener("click", () => {
    void startCalibrating();
  });
  root.appendChild(screen);
}

function renderCalibrating(): void {
  clearRoot();
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.innerHTML = `
    <div>
      <h1 class="title">${
        inputMode === "gyro" ? "Hold the phone naturally" : "Rest your hand on the mouse"
      }</h1>
      <p class="caption">Calibrating…</p>
    </div>
  `;
  root.appendChild(screen);
}

function renderRecording(): void {
  clearRoot();
  const wrap = document.createElement("section");
  wrap.className = "screen";
  wrap.style.padding = "0";
  const canvas = document.createElement("canvas");
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  wrap.appendChild(canvas);
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.top = "1.5rem";
  overlay.style.left = "0";
  overlay.style.right = "0";
  overlay.style.textAlign = "center";
  overlay.style.color = "var(--muted)";
  overlay.innerHTML = `<div>Hold as still as you can.</div><div id="countdown" class="caption" style="margin-top:0.5rem">${RECORD_SECONDS}s</div>`;
  wrap.appendChild(overlay);
  root.appendChild(wrap);

  seismograph = new Seismograph(canvas, {
    duration: RECORD_SECONDS,
    axes: inputMode === "mouse" ? 2 : 3,
    // After deadband, "still" gyro reads as 0; floor keeps the centerline
    // visible without amplifying nothing into the whole screen.
    scaleFloor: inputMode === "mouse" ? 1.5 : 0.15,
  });
  seismograph.start();
}

const MORPH_MS = 1600;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function renderFingerprintScreen(features: TremorFeatures, series: { x: number[]; y: number[]; z: number[] }): void {
  clearRoot();
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.style.flexDirection = "column";
  const canvas = document.createElement("canvas");
  canvas.style.width = "min(90vmin, 540px)";
  canvas.style.height = "min(90vmin, 540px)";
  canvas.style.borderRadius = "12px";

  const caption = document.createElement("p");
  caption.className = "caption";
  caption.textContent = "This is your tremor. Everyone has one.";

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <button id="save">Save image</button>
    <button id="share">Share</button>
    <button id="again">Try again</button>
  `;

  const readout = document.createElement("div");
  readout.className = "readout";
  const peak = Math.max(features.x.dominantFreq, features.y.dominantFreq, features.z.dominantFreq);
  const amp = (features.x.amplitude + features.y.amplitude + features.z.amplitude) / 3;
  readout.textContent = `${peak.toFixed(2)} Hz · ${(amp * 1000).toFixed(0)} mg · ${features.sampleCount} samples`;

  const inner = document.createElement("div");
  inner.style.display = "grid";
  inner.style.placeItems = "center";
  inner.appendChild(canvas);
  inner.appendChild(caption);
  inner.appendChild(actions);

  screen.appendChild(inner);
  screen.appendChild(readout);
  root.appendChild(screen);

  renderFingerprint(canvas, {
    features,
    series,
    referenceAmplitude: inputMode === "mouse" ? MOUSE_REF_AMP : GYRO_REF_AMP,
  });

  const hash = encodeFeatures(features);
  const shareUrl = `${window.location.origin}${window.location.pathname}?f=${hash}`;
  history.replaceState(null, "", `?f=${hash}`);

  actions.querySelector<HTMLButtonElement>("#save")?.addEventListener("click", () => {
    void downloadPNG(canvas);
  });
  actions.querySelector<HTMLButtonElement>("#share")?.addEventListener("click", () => {
    void shareCanvas(canvas, shareUrl);
  });
  actions.querySelector<HTMLButtonElement>("#again")?.addEventListener("click", () => {
    history.replaceState(null, "", window.location.pathname);
    sm.transition("landing");
  });
}

async function startCalibrating(): Promise<void> {
  sm.transition("calibrating");
  try {
    adapter = inputMode === "gyro" ? new GyroAdapter() : new MouseAdapter();
    await adapter.start(handleSample);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      showToast("Need motion access — switching to mouse mode.");
      adapter = new MouseAdapter();
      await adapter.start(handleSample);
    } else {
      throw err;
    }
  }
  setTimeout(() => {
    xs.length = 0; ys.length = 0; zs.length = 0;
    hpX.reset(); hpY.reset(); hpZ.reset();
    lpX.reset(); lpY.reset(); lpZ.reset();
    startRecording();
  }, CALIBRATE_MS);
}

function handleSample(s: Sample): void {
  rawSamplesSeen++;
  if (s.dx !== 0 || s.dy !== 0 || s.dz !== 0) rawAnyNonZero = true;
  let fx: number, fy: number, fz: number;
  if (inputMode === "mouse") {
    // Pixel deltas are already AC and discrete; no filtering needed.
    fx = s.dx; fy = s.dy; fz = s.dz;
  } else {
    // Bandpass: LP kills high-freq sensor noise above ~7 Hz, HP strips
    // gravity / slow drift, deadband zeroes everything below the noise floor.
    fx = deadband(hpX.step(lpX.step(s.dx)), GYRO_NOISE_FLOOR);
    fy = deadband(hpY.step(lpY.step(s.dy)), GYRO_NOISE_FLOOR);
    fz = deadband(hpZ.step(lpZ.step(s.dz)), GYRO_NOISE_FLOOR);
  }
  if (sm.current === "recording") {
    xs.push(fx);
    ys.push(fy);
    zs.push(fz);
    seismograph?.push(fx, fy, fz);
  }
}

function startRecording(): void {
  recordStart = performance.now();
  rawSamplesSeen = 0;
  rawAnyNonZero = false;
  sm.transition("recording");

  recordTimer = window.setInterval(() => {
    const elapsed = (performance.now() - recordStart) / 1000;
    const remaining = Math.max(0, RECORD_SECONDS - elapsed);
    const cd = document.getElementById("countdown");
    if (cd) cd.textContent = `${remaining.toFixed(1)}s`;
    if (elapsed >= RECORD_SECONDS) finishRecording();
  }, 100);

  // Detect a dead motion API: either no samples at all, or samples that are
  // all literal zero (some Android browsers in private mode). Gravity makes
  // a working gyro produce non-zero raw samples even on a still phone.
  stallCheck = window.setTimeout(() => {
    if (inputMode !== "gyro") return;
    if (rawSamplesSeen === 0 || !rawAnyNonZero) {
      showToast("No motion detected — switching to mouse mode.");
      cleanupRecording();
      adapter?.stop();
      adapter = new MouseAdapter();
      void adapter.start(handleSample).then(() => {
        xs.length = 0; ys.length = 0; zs.length = 0;
        hpX.reset(); hpY.reset(); hpZ.reset();
        lpX.reset(); lpY.reset(); lpZ.reset();
        startRecording();
      });
    }
  }, 800);

  document.addEventListener("visibilitychange", onVisibility);
}

function onVisibility(): void {
  if (document.hidden && sm.current === "recording") {
    showToast("Come back to keep recording.");
  }
}

function cleanupRecording(): void {
  if (recordTimer !== null) clearInterval(recordTimer);
  recordTimer = null;
  if (stallCheck !== null) clearTimeout(stallCheck);
  stallCheck = null;
  document.removeEventListener("visibilitychange", onVisibility);
}

function finishRecording(): void {
  cleanupRecording();
  adapter?.stop();

  const elapsedSec = (performance.now() - recordStart) / 1000;
  const sampleRate = xs.length / Math.max(elapsedSec, 0.001);
  const features = extract(xs, ys, zs, sampleRate);
  const series = { x: [...xs], y: [...ys], z: [...zs] };

  const canvas = seismograph?.canvas ?? null;
  // Stop the live render loop but keep the canvas in the DOM for the morph.
  seismograph?.destroy();
  seismograph = null;

  // Hide overlay copy during the morph.
  const overlay = root.querySelector<HTMLElement>("section .caption")?.parentElement ?? null;
  if (overlay) overlay.style.opacity = "0";

  const goFingerprint = (): void => {
    sm.transition("fingerprint");
    renderFingerprintScreen(features, series);
  };

  if (!canvas || prefersReducedMotion()) {
    sm.transition("revealing");
    goFingerprint();
    return;
  }

  sm.transition("revealing");
  runMorph(
    canvas,
    {
      features,
      series,
      axes: inputMode === "mouse" ? 2 : 3,
      duration: MORPH_MS,
      referenceAmplitude: inputMode === "mouse" ? MOUSE_REF_AMP : GYRO_REF_AMP,
    },
    () => {
      setTimeout(goFingerprint, 500);
    },
  );
}

function showToast(text: string): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

sm.subscribe((state) => {
  switch (state) {
    case "landing": renderLanding(); break;
    case "calibrating": renderCalibrating(); break;
    case "recording": renderRecording(); break;
    case "revealing": /* morph runs on the existing recording canvas */ break;
    case "fingerprint": /* rendered by finishRecording */ break;
  }
});

function bootstrap(): void {
  const hash = readHashFromUrl();
  if (hash) {
    const features = decodeFeatures(hash);
    if (features) {
      // Permalink view: render directly, with empty series (no waveform overlay).
      sm.transition("fingerprint");
      // Permalink view has no series; trace omitted, ring + seal still render.
      renderFingerprintScreen(features, { x: [], y: [], z: [] });
      return;
    }
  }
  renderLanding();
}

bootstrap();
