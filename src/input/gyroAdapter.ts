import {
  PermissionDeniedError,
  type InputAdapter,
  type SampleHandler,
} from "./types";

type IOSDeviceMotionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

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
      onSample({
        t: performance.now(),
        dx: a.x ?? 0,
        dy: a.y ?? 0,
        dz: a.z ?? 0,
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
