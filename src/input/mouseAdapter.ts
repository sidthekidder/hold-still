import type { InputAdapter, SampleHandler } from "./types";

export class MouseAdapter implements InputAdapter {
  readonly mode = "mouse" as const;
  private rafId: number | null = null;
  private accX = 0;
  private accY = 0;
  private moveHandler: ((e: PointerEvent) => void) | null = null;

  async start(onSample: SampleHandler): Promise<void> {
    const move = (e: PointerEvent): void => {
      this.accX += e.movementX || 0;
      this.accY += e.movementY || 0;
    };
    this.moveHandler = move;
    window.addEventListener("pointermove", move, { passive: true });

    const tick = (): void => {
      const t = performance.now();
      const dx = this.accX;
      const dy = this.accY;
      this.accX = 0;
      this.accY = 0;
      onSample({ t, dx, dy, dz: 0 });
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
