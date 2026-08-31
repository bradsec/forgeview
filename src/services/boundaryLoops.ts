import * as THREE from 'three'
import { triModel, vertexTable } from './meshTopology'

export interface BoundaryLoop {
  points: [number, number, number][]
  vertexCount: number
}

export interface BoundaryLoopResult {
  loops: BoundaryLoop[]
  skippedPinched: number
}

/**
 * Walk a geometry's open boundary into ordered loops. An edge used by exactly
 * one triangle is a boundary edge, kept in that triangle's traversal
 * direction; the surface lies to the left of that direction. Boundary edges
 * are grouped into connected components; a component with any vertex whose
 * boundary in- or out-degree exceeds one is pinched (e.g. a figure-eight
 * sharing an apex) and every chain in it is skipped, counted once in
 * `skippedPinched`. Simple components are walked into closed cycles; a chain
 * that fails to close or is shorter than three vertices is dropped silently
 * (degenerate input, not reachable from real meshes). Pure: the input is not
 * mutated.
 */
export function extractBoundaryLoops(geo: THREE.BufferGeometry): BoundaryLoopResult {
  const { positions, tris, vertexCount } = triModel(geo)
  const table = vertexTable(positions, tris, vertexCount)

  const edgeUse = new Map<string, number>()
  for (const tri of tris) {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1)
    }
  }
  const dirEdges: [number, number][] = []
  for (const tri of tris) {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      if (edgeUse.get(k) === 1) dirEdges.push([a, b])
    }
  }
  if (dirEdges.length === 0) return { loops: [], skippedPinched: 0 }

  const outDeg = new Map<number, number>()
  const inDeg = new Map<number, number>()
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    const p = parent.get(x)
    if (p === undefined) { parent.set(x, x); return x }
    if (p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }
  const union = (x: number, y: number) => { parent.set(find(x), find(y)) }
  for (const [a, b] of dirEdges) {
    outDeg.set(a, (outDeg.get(a) ?? 0) + 1)
    inDeg.set(b, (inDeg.get(b) ?? 0) + 1)
    union(a, b)
  }
  const pinchedRoots = new Set<number>()
  for (const [v, d] of outDeg) if (d > 1) pinchedRoots.add(find(v))
  for (const [v, d] of inDeg) if (d > 1) pinchedRoots.add(find(v))

  const boundaryNext = new Map<number, number>()
  const startNodesSeed: number[] = []
  let boundaryCount = 0
  for (const [a, b] of dirEdges) {
    if (pinchedRoots.has(find(a))) continue
    boundaryNext.set(a, b)
    startNodesSeed.push(a)
    boundaryCount++
  }

  const loops: BoundaryLoop[] = []
  const startNodes = new Set(startNodesSeed)
  while (startNodes.size) {
    const start = startNodes.values().next().value as number
    const loopIds: number[] = []
    let cur = start
    let ok = true
    for (let guard = 0; guard <= boundaryCount + 1; guard++) {
      loopIds.push(cur)
      startNodes.delete(cur)
      const nxt = boundaryNext.get(cur)
      if (nxt === undefined) { ok = false; break }
      if (nxt === start) break
      if (loopIds.includes(nxt)) { ok = false; break }
      cur = nxt
    }
    if (!ok || loopIds.length < 3) continue
    const points = loopIds.map((id) => [...table[id]] as [number, number, number])
    loops.push({ points, vertexCount: points.length })
  }

  return { loops, skippedPinched: pinchedRoots.size }
}

/**
 * Triangle fan from the loop centroid. For consecutive loop points a -> b
 * (wrapping) the triangle is (centroid, b, a): the boundary is directed with
 * the surface on its left, so the cap winds the other way and faces outward.
 * Returns a flat non-indexed position array (points.length triangles).
 */
export function centroidFan(points: [number, number, number][]): Float32Array {
  const n = points.length
  const c: [number, number, number] = [0, 0, 0]
  for (const [x, y, z] of points) { c[0] += x; c[1] += y; c[2] += z }
  c[0] /= n; c[1] /= n; c[2] /= n
  const out = new Float32Array(n * 9)
  let o = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    out[o++] = c[0]; out[o++] = c[1]; out[o++] = c[2]
    out[o++] = b[0]; out[o++] = b[1]; out[o++] = b[2]
    out[o++] = a[0]; out[o++] = a[1]; out[o++] = a[2]
  }
  return out
}
