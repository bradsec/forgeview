import { describe, it, expect } from 'vitest'
import { prepChecks } from './prepChecks'
import type { GeometryDetails } from '../store/viewerStore'

const clean: GeometryDetails = {
  width: 10, height: 10, depth: 10, vertices: 100, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: null,
}

const ORDER = ['watertight', 'nonManifold', 'boundary', 'degenerate', 'duplicate', 'thickness', 'overhangs', 'onPlate']

describe('prepChecks', () => {
  it('returns the fixed row order', () => {
    expect(prepChecks(clean).map((c) => c.id)).toEqual(ORDER)
    expect(prepChecks(null).map((c) => c.id)).toEqual(ORDER)
  })

  it('marks every row unavailable with no model', () => {
    for (const check of prepChecks(null)) {
      expect(check.state).toBe('unavailable')
      expect(check.detail).toBe('Open a model')
      expect(check.fixId).toBeUndefined()
    }
  })

  it('passes a clean watertight model on every computed row', () => {
    const byId = Object.fromEntries(prepChecks(clean).map((c) => [c.id, c]))
    for (const id of ['watertight', 'nonManifold', 'boundary', 'degenerate', 'duplicate']) {
      expect(byId[id].state).toBe('pass')
      expect(byId[id].fixId).toBeUndefined()
    }
  })

  it('keeps analysis rows unavailable even with a model', () => {
    const byId = Object.fromEntries(prepChecks(clean).map((c) => [c.id, c]))
    for (const id of ['thickness', 'overhangs', 'onPlate']) {
      expect(byId[id].state).toBe('unavailable')
      expect(byId[id].detail).toBe('Available in a later update')
      expect(byId[id].fixId).toBeUndefined()
    }
  })

  it('fails and offers seal for a leaky non-manifold model', () => {
    const leaky: GeometryDetails = {
      ...clean, watertight: false, boundaryEdges: 6, nonManifoldEdges: 3,
      degenerateFaces: 2, duplicateFaces: 1,
    }
    const byId = Object.fromEntries(prepChecks(leaky).map((c) => [c.id, c]))
    expect(byId.watertight.state).toBe('fail')
    expect(byId.watertight.detail).toBe('Not watertight')
    expect(byId.watertight.fixId).toBe('seal')
    expect(byId.boundary.detail).toBe('6 open edges')
    expect(byId.nonManifold.detail).toBe('3 non-manifold edges')
    expect(byId.degenerate.detail).toBe('2 degenerate faces')
    expect(byId.duplicate.detail).toBe('1 duplicate face')
    for (const id of ['boundary', 'nonManifold', 'degenerate', 'duplicate']) {
      expect(byId[id].state).toBe('fail')
      expect(byId[id].fixId).toBe('seal')
    }
  })

  it('annotates watertight/manifold as warn (no Fix) once a seal has run', () => {
    const leaky: GeometryDetails = { ...clean, watertight: false, nonManifoldEdges: 4, boundaryEdges: 0 }
    const byId = Object.fromEntries(prepChecks(leaky, true).map((c) => [c.id, c]))
    expect(byId.watertight.state).toBe('warn')
    expect(byId.watertight.fixId).toBeUndefined()
    expect(byId.watertight.detail).toMatch(/residual/i)
    expect(byId.nonManifold.state).toBe('warn')
    expect(byId.nonManifold.fixId).toBeUndefined()
  })

  it('still fails a real open edge after a seal', () => {
    const holed: GeometryDetails = { ...clean, watertight: false, boundaryEdges: 6 }
    const byId = Object.fromEntries(prepChecks(holed, true).map((c) => [c.id, c]))
    expect(byId.boundary.state).toBe('fail')
  })

  it('sealApplied omitted behaves as today', () => {
    const leaky: GeometryDetails = { ...clean, watertight: false, nonManifoldEdges: 4 }
    expect(prepChecks(leaky).find((c) => c.id === 'watertight')!.state).toBe('fail')
  })
})
