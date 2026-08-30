/** Deepest undo history kept in memory. Each entry retains the pre-edit
 * geometry, so the ceiling bounds worst-case memory on large models. */
export const MAX_UNDO = 5

/** Number of edits an undo request should actually roll back: 0 when nothing
 * is stacked, otherwise the request floored into [1, length]. */
export function clampUndoSteps(steps: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(1, Math.floor(steps)), length)
}
