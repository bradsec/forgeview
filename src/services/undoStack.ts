/** Deepest undo history kept in memory. Each entry retains the pre-edit
 * geometry, so the ceiling bounds worst-case memory on large models. */
export const MAX_UNDO = 5

/** One reversible model edit held on the undo stack. `apply` rolls the edit
 * back; `discard` releases the retained pre-edit geometry when the entry falls
 * off the stack without being undone. */
export interface UndoEntry {
  label: string
  apply: () => void
  discard: () => void
}

/** Number of edits an undo request should actually roll back: 0 when nothing
 * is stacked, otherwise the request floored into [1, length]. */
export function clampUndoSteps(steps: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(1, Math.floor(steps)), length)
}
