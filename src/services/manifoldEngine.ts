import { hollowSolid } from './manifoldHollow'
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import { meshToSoup, weldSoup } from './manifoldBridge'
import type { ManifoldRequest, ManifoldResult } from './manifoldTypes'

export function soupToSolid(wasm: ManifoldToplevel, positions: Float32Array): Manifold {
  const mesh = new wasm.Mesh({ numProp: 3, ...weldSoup(positions) })
  // Mesh is a JS data object. merge records boundary vertex equivalences.
  mesh.merge()
  const solid = new wasm.Manifold(mesh)
  try {
    if (solid.status() !== 'NoError' || solid.isEmpty()) {
      throw new Error('The model is not a closed solid. Run Repair, then try again.')
    }
    return solid
  } catch (error) {
    solid.delete()
    throw error
  }
}

function output(solid: Manifold): Float32Array {
  if (solid.status() !== 'NoError') throw new Error(`Solid operation failed: ${solid.status()}`)
  const mesh = solid.getMesh()
  return meshToSoup(mesh.vertProperties, mesh.triVerts, mesh.numProp)
}

export function executeManifold(wasm: ManifoldToplevel, request: ManifoldRequest): ManifoldResult {
  const owned: Manifold[] = []
  try {
    const solid = soupToSolid(wasm, request.positions)
    owned.push(solid)
    if (request.operation === 'hollow') {
      const result = hollowSolid(wasm, solid, request.options)
      owned.push(result)
      return output(result)
    }
    if (request.operation === 'cut') {
      const length = Math.hypot(...request.normal)
      if (!Number.isFinite(length) || length === 0 || !Number.isFinite(request.offset)) throw new Error('Invalid cut plane')
      const normal = request.normal.map(value => value / length) as [number, number, number]
      const [a, b] = solid.splitByPlane(normal, request.offset / length)
      owned.push(a, b)
      return { partA: output(a), partB: output(b) }
    }
    const other = soupToSolid(wasm, request.other)
    owned.push(other)
    const result = request.operation === 'union' ? solid.add(other)
      : request.operation === 'subtract' ? solid.subtract(other) : solid.intersect(other)
    owned.push(result)
    return output(result)
  } finally {
    for (const solid of owned.reverse()) solid.delete()
  }
}
