import type { InputAdapter, SampleHandler } from "./types";

// Cursor motion of 30 px between samples reads as speed=1.
const SPEED_REF_PX = 30;

export class MouseAdapter implements InputAdapter {
  readonly mode = "mouse" as const;
  private rafId: number | null = null;
  private accX = 0;
  private accY = 0;
  private cursorX = 0;
  private cursorY = 0;
  private moveHandler: ((e: PointerEvent) => void) | null = null;

  async start(onSample: SampleHandler): Promise<void> {
    this.cursorX = window.innerWidth / 2;
    this.cursorY = window.innerHeight / 2;
    const move = (e: PointerEvent): void => {
      this.accX += e.movementX || 0;
      this.accY += e.movementY || 0;
      this.cursorX = e.clientX;
      this.cursorY = e.clientY;
    };
    this.moveHandler = move;
    window.addEventListener("pointermove", move, { passive: true });

    const tick = (): void => {
      const t = performance.now();
      const dx = this.accX;
      const dy = this.accY;
      this.accX = 0;
      this.accY = 0;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      // Cursor above center → tilt up (-Y in screen coords) → +1.
      const tilt = Math.max(-1, Math.min(1, (h / 2 - this.cursorY) / (h / 2)));
      // Cursor right of center → pitch forward (warm).
      const pitch = Math.max(-1, Math.min(1, (this.cursorX - w / 2) / (w / 2)));
      const speed = Math.sqrt(dx * dx + dy * dy) / SPEED_REF_PX;
      onSample({ t, dx, dy, dz: 0, tilt, pitch, speed });
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.moveHandler) {
      window.removeEventListener("pointermove", this.moveHandler);
      this.moveHandler = null;
    }
  }
}
