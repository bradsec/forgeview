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

import { pushBounded, discardAll, popApply } from './undoStack'
import type { UndoEntry } from './undoStack'

const entry = (label: string, calls: string[]): UndoEntry => ({
  label,
  apply: () => calls.push(`apply:${label}`),
  discard: () => calls.push(`discard:${label}`),
})

describe('pushBounded', () => {
  it('discards the oldest entry past the cap and keeps the array instance', () => {
    const calls: string[] = []
    const stack: UndoEntry[] = []
    for (let i = 1; i <= MAX_UNDO + 1; i++) pushBounded(stack, entry(`e${i}`, calls))
    expect(stack).toHaveLength(MAX_UNDO)
    expect(calls).toEqual(['discard:e1'])
    expect(stack[0].label).toBe('e2')
  })

  it('honors an explicit max', () => {
    const calls: string[] = []
    const stack: UndoEntry[] = []
    pushBounded(stack, entry('a', calls), 1)
    pushBounded(stack, entry('b', calls), 1)
    expect(stack.map((e) => e.label)).toEqual(['b'])
    expect(calls).toEqual(['discard:a'])
  })
})

describe('discardAll', () => {
  it('discards every entry and empties in place', () => {
    const calls: string[] = []
    const stack: UndoEntry[] = [entry('a', calls), entry('b', calls)]
    const ref = stack
    discardAll(stack)
    expect(calls).toEqual(['discard:a', 'discard:b'])
    expect(stack).toHaveLength(0)
    expect(stack).toBe(ref)
  })
})

describe('popApply', () => {
  it('applies newest-first for n steps', () => {
    const calls: string[] = []
    const stack: UndoEntry[] = [entry('a', calls), entry('b', calls), entry('c', calls)]
    popApply(stack, 2)
    expect(calls).toEqual(['apply:c', 'apply:b'])
    expect(stack.map((e) => e.label)).toEqual(['a'])
  })
})
