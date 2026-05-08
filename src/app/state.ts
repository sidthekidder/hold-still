export type AppState =
  | "landing"
  | "calibrating"
  | "recording"
  | "revealing"
  | "fingerprint";

export type Listener = (state: AppState, prev: AppState) => void;

export class StateMachine {
  private state: AppState = "landing";
  private listeners = new Set<Listener>();

  get current(): AppState {
    return this.state;
  }

  transition(next: AppState): void {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    for (const fn of this.listeners) fn(next, prev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
