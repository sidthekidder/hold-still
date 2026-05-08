import {
  PermissionDeniedError,
  type InputAdapter,
  type SampleHandler,
} from "./types";

type IOSDeviceMotionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

// Normalization references: 200 deg/s of combined rotation reads as speed=1.
// Casual wrist motion sits 30–60, a deliberate flick clears 200.
const ROTATION_RATE_REF = 200;

export function isGyroSupported(): boolean {
  return typeof DeviceMotionEvent !== "undefined";
}

export class GyroAdapter implements InputAdapter {
  readonly mode = "gyro" as const;
  private handler: ((e: DeviceMotionEvent) => void) | null = null;

  async start(onSample: SampleHandler): Promise<void> {
    const Ctor = DeviceMotionEvent as IOSDeviceMotionEvent;
    if (typeof Ctor.requestPermission === "function") {
      const result = await Ctor.requestPermission();
      if (result !== "granted") throw new PermissionDeniedError();
    }

    const handler = (e: DeviceMotionEvent): void => {
      const a = e.accelerationIncludingGravity ?? e.acceleration;
      if (!a) return;
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const az = a.z ?? 0;
      // Gravity x-component / 9.8 ≈ sin(roll). Clamped because momentary
      // shake spikes exceed 1g and would push the brush off-canvas.
      const tilt = Math.max(-1, Math.min(1, ax / 9.8));
      // Same idea for pitch — gravity y-component. Calibration in main.ts
      // subtracts the user's natural-hold offset so 0 = comfortable angle.
      const pitch = Math.max(-1, Math.min(1, ay / 9.8));
      const r = e.rotationRate;
      let speed = 0;
      if (r) {
        const ra = r.alpha ?? 0;
        const rb = r.beta ?? 0;
        const rg = r.gamma ?? 0;
        speed = Math.sqrt(ra * ra + rb * rb + rg * rg) / ROTATION_RATE_REF;
      }
      onSample({
        t: performance.now(),
        dx: ax,
        dy: ay,
        dz: az,
        tilt,
        pitch,
        speed,
      });
    };
    this.handler = handler;
    window.addEventListener("devicemotion", handler);
  }

  stop(): void {
    if (this.handler) {
      window.removeEventListener("devicemotion", this.handler);
      this.handler = null;
    }
  }
}
