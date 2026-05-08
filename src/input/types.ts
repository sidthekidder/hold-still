export interface Sample {
  t: number;
  // Raw motion components (acceleration in m/s² for gyro; px deltas for mouse).
  dx: number;
  dy: number;
  dz: number;
  // Lateral tilt (roll) — drives brush Y. -1..1, positive = tilted right.
  tilt: number;
  // Forward-back tilt (pitch) — drives hue temperature. -1..1, positive = forward.
  pitch: number;
  // Motion magnitude — drives stroke width. ~0 still, ~1 brisk, can exceed 1.
  speed: number;
}

export type SampleHandler = (s: Sample) => void;

export interface InputAdapter {
  readonly mode: "gyro" | "mouse";
  start(onSample: SampleHandler): Promise<void>;
  stop(): void;
}

export class PermissionDeniedError extends Error {
  constructor(message = "Motion permission denied") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}
