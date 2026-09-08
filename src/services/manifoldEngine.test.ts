// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import { executeManifold, soupToSolid } from './manifoldEngine'
import { meshToSoup, weldSoup } from './manifoldBridge'
import type { PlaneCutResult, HollowOptions } from './manifoldTypes'

let wasm: ManifoldToplevel
let box: Float32Array
let shifted: Float32Array
beforeAll(async () => {
  wasm = await Module()
  wasm.setup()
  const a = wasm.Manifold.cube([10, 10, 10], true)
  const b = a.translate([5, 0, 0])
  for (const [solid, assign] of [[a, (v: Float32Array) => { box = v }], [b, (v: Float32Array) => { shifted = v }]] as const) {
    const mesh = solid.getMesh()
    assign(meshToSoup(mesh.vertProperties, mesh.triVerts, mesh.numProp))
    solid.delete()
  }
})
function volume(soup: Float32Array) {
  const solid = soupToSolid(wasm, soup)
  try { return solid.volume() } finally { solid.delete() }
}
describe('real manifold WASM', () => {
  it('cuts and caps both halves with a non-unit normal', () => {
    const result = executeManifold(wasm, { operation: 'cut', positions: box, normal: [2, 0, 0], offset: 2 }) as PlaneCutResult
    expect(volume(result.partA)).toBeCloseTo(400)
    expect(volume(result.partB)).toBeCloseTo(600)
  })
  it.each([['union', 1500], ['subtract', 500], ['intersection', 500]] as const)('%s produces a closed solid with expected volume', (operation, expected) => {
    expect(volume(executeManifold(wasm, { operation, positions: box, other: shifted }) as Float32Array)).toBeCloseTo(expected)
  })
  it('allows empty boolean results', () => {
    expect((executeManifold(wasm, { operation: 'subtract', positions: box, other: box }) as Float32Array).length).toBe(0)
  })
  it('rejects open and malformed input', () => {
    expect(() => executeManifold(wasm, { operation: 'cut', positions: box.slice(9), normal: [1, 0, 0], offset: 0 })).toThrow()
    expect(() => weldSoup(new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0]))).toThrow('non-finite')
    expect(() => weldSoup(new Float32Array(8))).toThrow('complete triangles')
  })
  const settings: HollowOptions = { wallThickness: 2, resolution: 24, drainRadius: 0, drainAxis: 'z', drainOffset: [0, 0, 0] }
  it('hollows to a closed shell and drains through its cavity', () => {
    const shell = executeManifold(wasm, { operation: 'hollow', positions: box, options: settings }) as Float32Array
    expect(volume(shell)).toBeGreaterThan(780)
    expect(volume(shell)).toBeLessThan(800)
    const drained = executeManifold(wasm, { operation: 'hollow', positions: box, options: { ...settings, drainRadius: 1 } }) as Float32Array
    expect(volume(drained)).toBeLessThan(volume(shell) - 10)
  })
  it('rejects oversized walls and drains missing the cavity', () => {
    expect(() => executeManifold(wasm, { operation: 'hollow', positions: box, options: { ...settings, wallThickness: 6 } })).toThrow('no cavity')
    expect(() => executeManifold(wasm, { operation: 'hollow', positions: box, options: { ...settings, drainRadius: 1, drainOffset: [30, 0, 0] } })).toThrow('does not reach')
  })
})
