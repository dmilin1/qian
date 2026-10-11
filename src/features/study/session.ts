// Module-level study session state: survives tab switches within one page load, so returning to
// the Study tab skips the start screen.
let started = false

export const studySession = {
  get started(): boolean {
    return started
  },
  start(): void {
    started = true
  },
  /** Tests only. */
  reset(): void {
    started = false
  },
}
