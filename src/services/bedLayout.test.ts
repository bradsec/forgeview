import { describe, it, expect } from 'vitest'
import { computeBedLayout } from './bedLayout'

describe('computeBedLayout', () => {
  it('places a single item centred on the origin', () => {
    const r = computeBedLayout([{ id: 'a', w: 20, d: 10 }], { x: 200, z: 200 }, 5)
    expect(r.unplaced).toEqual([])
    expect(r.placements).toHaveLength(1)
    expect(r.placements[0]).toMatchObject({ id: 'a' })
    expect(r.placements[0].cx).toBeCloseTo(0)
    expect(r.placements[0].cz).toBeCloseTo(0)
  })

  it('lays three same-size items in one row with the gap between them', () => {
    const items = [
      { id: 'a', w: 20, d: 20 },
      { id: 'b', w: 20, d: 20 },
      { id: 'c', w: 20, d: 20 },
    ]
    const r = computeBedLayout(items, { x: 200, z: 200 }, 10)
    expect(r.unplaced).toEqual([])
    const byId = Object.fromEntries(r.placements.map((p) => [p.id, p]))
    // centres 30 apart (20 width + 10 gap), symmetric about 0
    const xs = ['a', 'b', 'c'].map((k) => byId[k].cx).sort((p, q) => p - q)
    expect(xs[1] - xs[0]).toBeCloseTo(30)
    expect(xs[2] - xs[1]).toBeCloseTo(30)
    expect(xs[0] + xs[2]).toBeCloseTo(0)
    // all in the same row
    for (const k of ['a', 'b', 'c']) expect(byId[k].cz).toBeCloseTo(byId.a.cz)
  })

  it('wraps to a new row when the next item overflows the bed width', () => {
    // all the same size so the depth-then-width sort keeps input order
    const items = [
      { id: 'a', w: 60, d: 30 },
      { id: 'b', w: 60, d: 30 },
      { id: 'c', w: 60, d: 30 }, // 3 * 60 + 2 * gap = 190 < 200 -> still row 1
      { id: 'd', w: 60, d: 30 }, // 4th overflows the width -> row 2
    ]
    const r = computeBedLayout(items, { x: 200, z: 200 }, 5)
    expect(r.unplaced).toEqual([])
    const byId = Object.fromEntries(r.placements.map((p) => [p.id, p]))
    // a, b, c share a row; d is on the next row (row depth 30 + gap 5)
    expect(byId.b.cz).toBeCloseTo(byId.a.cz)
    expect(byId.c.cz).toBeCloseTo(byId.a.cz)
    expect(byId.d.cz - byId.a.cz).toBeCloseTo(35)
    // row 1 centres are 65 apart (60 width + 5 gap) and symmetric about 0
    const xs = [byId.a.cx, byId.b.cx, byId.c.cx].sort((p, q) => p - q)
    expect(xs[1] - xs[0]).toBeCloseTo(65)
    expect(xs[0] + xs[2]).toBeCloseTo(0)
  })

  it('marks an item wider than the bed as unplaced and still lays the rest', () => {
    const r = computeBedLayout(
      [{ id: 'big', w: 300, d: 10 }, { id: 'ok', w: 20, d: 20 }],
      { x: 200, z: 200 },
      5,
    )
    expect(r.unplaced).toEqual(['big'])
    expect(r.placements.map((p) => p.id)).toEqual(['ok'])
  })

  it('marks items that overflow the bed depth as unplaced', () => {
    // rows of depth 80 each; bed.z 200 fits 2 rows (0..80, 85..165), the 3rd (170..250) overflows
    const items = Array.from({ length: 9 }, (_, i) => ({ id: String(i), w: 90, d: 80 }))
    const r = computeBedLayout(items, { x: 200, z: 200 }, 5)
    // 2 per row (2 * 90 + 5 = 185 < 200), 2 rows placed -> 4 items, 5 unplaced
    expect(r.placements).toHaveLength(4)
    expect(r.unplaced).toHaveLength(5)
  })

  it('returns empty for no items', () => {
    expect(computeBedLayout([], { x: 100, z: 100 }, 5)).toEqual({ placements: [], unplaced: [] })
  })

  it('still reports unplaced ids when nothing can be placed', () => {
    const r = computeBedLayout(
      [{ id: 'a', w: 500, d: 10 }, { id: 'b', w: 500, d: 10 }],
      { x: 200, z: 200 },
      5,
    )
    expect(r.placements).toEqual([])
    expect(r.unplaced.sort()).toEqual(['a', 'b'])
  })

  it('breaks equal-key ties by input order', () => {
    const items = [
      { id: 'first', w: 20, d: 20 },
      { id: 'second', w: 20, d: 20 },
      { id: 'third', w: 20, d: 20 },
    ]
    const r = computeBedLayout(items, { x: 200, z: 200 }, 5)
    expect(r.placements.map((p) => p.id)).toEqual(['first', 'second', 'third'])
  })

  it('treats a non-finite footprint as unplaced instead of poisoning the layout', () => {
    const r = computeBedLayout(
      [{ id: 'bad', w: Number.NaN, d: 10 }, { id: 'ok', w: 20, d: 20 }],
      { x: 200, z: 200 },
      5,
    )
    expect(r.unplaced).toEqual(['bad'])
    expect(r.placements).toHaveLength(1)
    expect(r.placements[0].id).toBe('ok')
    expect(Number.isFinite(r.placements[0].cx)).toBe(true)
    expect(Number.isFinite(r.placements[0].cz)).toBe(true)
  })
})
