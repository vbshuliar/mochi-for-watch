// Keep session requests serial: abandoning a reply does not cancel a server-side task.
// Each new intent revokes the old turn's right to change the screen or play audio.
export class TurnCoordinator {
  constructor() { this.generation = 0; this.tail = Promise.resolve(); }
  begin() { return ++this.generation; }
  current(ticket) { return ticket === this.generation; }
  invalidate() { this.generation++; }
  async run(ticket, work) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    try {
      await previous;
      if (!this.current(ticket)) return;
      const result = await work();
      return this.current(ticket) ? result : undefined;
    } finally { release(); }
  }
}
