/**
 * A stop the user can ask for while a long run is going.
 *
 * A scan or an apply over a few hundred files takes minutes and holds the
 * window that started it. Until this existed the only way out was to close the
 * window or quit Zotero -- and quitting part-way through an apply is the one
 * moment in this plugin where quitting costs something.
 *
 * It is one flag rather than a token per run because only one run happens at a
 * time: each window disables its own action buttons while it works. A flag any
 * loop can read needs nothing threaded through every call.
 *
 * Every loop checks it *between* whole files, never inside the work for one, so
 * a stop cannot land halfway through creating an item or moving a file.
 */
let requested = false;

/** The Stop button. */
export function requestStop(): void {
  requested = true;
}

/**
 * Called at the top of every run. Without it, a stop asked for at the very end
 * of one run would still be set when the next one started and would kill it
 * before it read a single file.
 */
export function beginRun(): void {
  requested = false;
}

export function stopRequested(): boolean {
  return requested;
}

/**
 * Thrown by work whose output is only meaningful whole.
 *
 * Reconcile compares a folder against the library in both directions; half of
 * that comparison is not a smaller answer, it is a wrong one -- every item it
 * had not reached yet would read as having no copy in the folder. So reconcile
 * abandons rather than returning what it has, and the window says so.
 */
export class Stopped extends Error {
  constructor() {
    super("stopped");
    this.name = "Stopped";
  }
}

/** True for the error above, across the window boundary where instanceof fails. */
export function isStopped(e: unknown): boolean {
  return !!e && (e as { name?: string }).name === "Stopped";
}

/** Throw if a stop has been asked for. For work that cannot be left half done. */
export function throwIfStopped(): void {
  if (requested) throw new Stopped();
}
