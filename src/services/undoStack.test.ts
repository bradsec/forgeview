import { describe, it, expect } from 'vitest'
import { clampUndoSteps, MAX_UNDO } from './undoStack'

describe('clampUndoSteps', () => {
  it('MAX_UNDO is 5', () => {
    expect(MAX_UNDO).toBe(5)
  })

  it('returns 0 for an empty stack regardless of steps', () => {
    expect(clampUndoSteps(1, 0)).toBe(0)
    expect(clampUndoSteps(3, 0)).toBe(0)
  })

  it('clamps to at least 1 when the stack is non-empty', () => {
    expect(clampUndoSteps(0, 3)).toBe(1)
    expect(clampUndoSteps(-2, 3)).toBe(1)
  })

  it('clamps to the stack length', () => {
    expect(clampUndoSteps(9, 3)).toBe(3)
    expect(clampUndoSteps(2, 3)).toBe(2)
  })

  it('floors fractional steps', () => {
    expect(clampUndoSteps(2.9, 5)).toBe(2)
  })
})
