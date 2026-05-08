export interface Sample {
  t: number;
  dx: number;
  dy: number;
  dz: number;
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
