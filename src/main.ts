import "./style.css";
import { StateMachine } from "./app/state";
import { GyroAdapter, isGyroSupported } from "./input/gyroAdapter";
import { MouseAdapter } from "./input/mouseAdapter";
import type { InputAdapter, Sample } from "./input/types";
import { PermissionDeniedError } from "./input/types";
import { LowPass } from "./dsp/filter";
import { extract, type TremorFeatures } from "./dsp/features";
import { Painter, pickPalette, renderPaintingFinal, type PaintPoint } from "./viz/painter";
import { renderFingerprint } from "./viz/fingerprint";
import { downloadPNG, shareCanvas } from "./share/png";
import { decodeFeatures, encodeFeatures, readHashFromUrl } from "./share/hash";

const RECORD_SECONDS = 15;
const CALIBRATE_MS = 800;

const root = document.getElementById("app") as HTMLElement;
const sm = new StateMachine();

const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
const inputMode: "gyro" | "mouse" = isCoarsePointer && isGyroSupported() ? "gyro" : "mouse";

let adapter: InputAdapter | null = null;
let painter: Painter | null = null;

const xs: number[] = [];
const ys: number[] = [];
const zs: number[] = [];

let tiltLP = new LowPass(0.25);
let pitchLP = new LowPass(0.25);
let speedLP = new LowPass(0.4);
let tiltOffset = 0;
let pitchOffset = 0;
const calibTiltSamples: number[] = [];
const calibPitchSamples: number[] = [];

let recordStart = 0;
let recordTimer: number | null = null;
let stallCheck: number | null = null;
let rawSamplesSeen = 0;
let rawAnyNonZero = false;

function clearRoot(): void {
  root.innerHTML = "";
}

function renderLanding(): void {
  clearRoot();
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.innerHTML = `
    <div>
      <h1 class="title">Paint with motion</h1>
      <button class="begin" type="button">Begin</button>
      <p class="caption">${
        inputMode === "gyro"
          ? "Tilt your phone to move the brush. 10 seconds."
          : "Move your mouse to paint. 10 seconds."
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
        inputMode === "gyro" ? "Hold the phone how you'd like" : "Settle your mouse"
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
  overlay.style.pointerEvents = "none";
  overlay.innerHTML = `
    <div>${inputMode === "gyro" ? "Tilt to paint" : "Move to paint"}</div>
    <div id="countdown" class="caption" style="margin-top:0.5rem">${RECORD_SECONDS}s</div>
  `;
  wrap.appendChild(overlay);
  root.appendChild(wrap);

  painter = new Painter(canvas, { duration: RECORD_SECONDS });
  painter.start();
}

function renderFinalScreen(features: TremorFeatures, points: readonly PaintPoint[]): void {
  clearRoot();
  const screen = document.createElement("section");
  screen.className = "screen";
  screen.style.flexDirection = "column";

  const canvas = document.createElement("canvas");
  canvas.style.width = "min(90vmin, 540px)";
  canvas.style.height = "min(90vmin, 540px)";
  canvas.style.borderRadius = "12px";

  const { palette, name: paletteName } = pickPalette(points);

  const caption = document.createElement("p");
  caption.className = "caption";
  caption.textContent = `your motion painting · ${paletteName}`;

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <button id="save">Save image</button>
    <button id="share">Share</button>
    <button id="again">Try again</button>
  `;

  const inner = document.createElement("div");
  inner.style.display = "grid";
  inner.style.placeItems = "center";
  inner.appendChild(canvas);
  inner.appendChild(caption);
  inner.appendChild(actions);

  screen.appendChild(inner);
  root.appendChild(screen);

  renderPaintingFinal(canvas, points, { palette });

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

function renderPermalinkFingerprint(features: TremorFeatures): void {
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
  caption.textContent = "shared painting fingerprint";

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `<button id="again">Make your own</button>`;

  const inner = document.createElement("div");
  inner.style.display = "grid";
  inner.style.placeItems = "center";
  inner.appendChild(canvas);
  inner.appendChild(caption);
  inner.appendChild(actions);

  screen.appendChild(inner);
  root.appendChild(screen);

  renderFingerprint(canvas, { features, series: { x: [], y: [], z: [] } });

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
    if (calibTiltSamples.length > 0) {
      let sum = 0;
      for (const v of calibTiltSamples) sum += v;
      tiltOffset = sum / calibTiltSamples.length;
    }
    if (calibPitchSamples.length > 0) {
      let sum = 0;
      for (const v of calibPitchSamples) sum += v;
      pitchOffset = sum / calibPitchSamples.length;
    }
    calibTiltSamples.length = 0;
    calibPitchSamples.length = 0;
    xs.length = 0; ys.length = 0; zs.length = 0;
    tiltLP = new LowPass(0.25);
    pitchLP = new LowPass(0.25);
    speedLP = new LowPass(0.4);
    startRecording();
  }, CALIBRATE_MS);
}

function handleSample(s: Sample): void {
  rawSamplesSeen++;
  if (s.dx !== 0 || s.dy !== 0 || s.dz !== 0) rawAnyNonZero = true;

  if (sm.current === "calibrating") {
    calibTiltSamples.push(s.tilt);
    calibPitchSamples.push(s.pitch);
    return;
  }
  if (sm.current === "recording") {
    const tilt = tiltLP.step(s.tilt - tiltOffset);
    const pitch = pitchLP.step(s.pitch - pitchOffset);
    const speed = speedLP.step(s.speed);
    painter?.push(tilt, pitch, speed);
    xs.push(s.dx); ys.push(s.dy); zs.push(s.dz);
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

  // Detect a dead motion API: gravity makes a working gyro produce non-zero
  // raw samples even on a still phone, so absence of those means broken sensor.
  stallCheck = window.setTimeout(() => {
    if (adapter?.mode !== "gyro") return;
    if (rawSamplesSeen === 0 || !rawAnyNonZero) {
      showToast("No motion detected — switching to mouse mode.");
      cleanupRecording();
      adapter.stop();
      adapter = new MouseAdapter();
      void adapter.start(handleSample).then(() => {
        xs.length = 0; ys.length = 0; zs.length = 0;
        tiltLP = new LowPass(0.25);
        pitchLP = new LowPass(0.25);
        speedLP = new LowPass(0.4);
        tiltOffset = 0;
        pitchOffset = 0;
        painter?.reset();
        painter?.start();
        startRecording();
      });
    }
  }, 800);

  document.addEventListener("visibilitychange", onVisibility);
}

function onVisibility(): void {
  if (document.hidden && sm.current === "recording") {
    showToast("Come back to keep painting.");
  }
}

function cleanupRecording(): void {
  if (recordTimer !== null) clearInterval(recordTimer);
  recordTimer = null;
  if (stallCheck !== null) clearTimeout(stallCheck);
  stallCheck = null;
  document.removeEventListener("visibilitychange", onVisibility);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function runFlourish(p: Painter, done: () => void): void {
  const wrap = p.canvas.parentElement;
  let flash: HTMLDivElement | null = null;
  if (wrap) {
    flash = document.createElement("div");
    flash.style.cssText =
      "position:absolute;inset:0;background:rgba(255,235,210,0);" +
      "transition:background 220ms ease-out;pointer-events:none";
    wrap.appendChild(flash);
    requestAnimationFrame(() => {
      if (flash) flash.style.background = "rgba(255,235,210,0.18)";
    });
    setTimeout(() => {
      if (!flash) return;
      flash.style.transition = "background 580ms ease-out";
      flash.style.background = "rgba(255,235,210,0)";
    }, 220);
  }

  p.hideHead();

  const start = performance.now();
  const dur = 800;
  const tick = (): void => {
    const t = (performance.now() - start) / dur;
    if (t >= 1) {
      flash?.remove();
      done();
      return;
    }
    // Front-load the cascade so the rush hits in the first half.
    const intensity = t < 0.5 ? 0.6 + t * 0.8 : Math.max(0, 1 - (t - 0.5) * 2);
    p.cascadeStep(intensity);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function finishRecording(): void {
  cleanupRecording();
  adapter?.stop();

  const elapsedSec = (performance.now() - recordStart) / 1000;
  const sampleRate = xs.length / Math.max(elapsedSec, 0.001);
  const features = extract(xs, ys, zs, sampleRate);
  const points = painter ? [...painter.capturedPoints] : [];

  const finalize = (): void => {
    painter?.destroy();
    painter = null;
    sm.transition("fingerprint");
    renderFinalScreen(features, points);
  };

  if (!painter || prefersReducedMotion()) {
    finalize();
    return;
  }

  sm.transition("revealing");
  runFlourish(painter, finalize);
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
    case "revealing": break;
    case "fingerprint": break;
  }
});

function bootstrap(): void {
  const hash = readHashFromUrl();
  if (hash) {
    const features = decodeFeatures(hash);
    if (features) {
      sm.transition("fingerprint");
      renderPermalinkFingerprint(features);
      return;
    }
  }
  renderLanding();
}

bootstrap();
