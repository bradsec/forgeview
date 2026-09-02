import * as THREE from 'three'
import { triModel, vertexTable, rebuild } from './meshTopology'

export interface ShellSplitResult {
  parts: THREE.BufferGeometry[]
  droppedFragments: number
  droppedTriangles: number
}

/**
 * Label connected components by shared merged-vertex id (union-find, the same
 * labelling `removeSmallShells` uses) and emit each kept component as its own
 * non-indexed geometry. A component is kept when its triangle count is at
 * least `minFraction` of the total; the single largest component is always
 * kept. Dropped components are counted, not emitted. `parts` is ordered by
 * descending triangle count. The input geometry is never mutated.
 */
export function splitByShell(
  geo: THREE.BufferGeometry,
  minFraction = 0.001,
): ShellSplitResult {
  const { positions, tris, vertexCount } = triModel(geo)
  const table = vertexTable(positions, tris, vertexCount)

  const parent = Array.from({ length: vertexCount }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const union = (x: number, y: number) => { parent[find(x)] = find(y) }
  for (const tri of tris) { union(tri[0], tri[1]); union(tri[1], tri[2]) }

  const compTris = new Map<number, number[]>()
  tris.forEach((tri, ti) => {
    const r = find(tri[0])
    let list = compTris.get(r)
    if (!list) { list = []; compTris.set(r, list) }
    list.push(ti)
  })

  const groups = [...compTris.values()]
  const total = tris.length
  const maxLen = Math.max(...groups.map((g) => g.length))

  const kept: number[][] = []
  let droppedFragments = 0
  let droppedTriangles = 0
  for (const g of groups) {
    if (g.length === maxLen || g.length >= minFraction * total) kept.push(g)
    else { droppedFragments++; droppedTriangles += g.length }
  }

  kept.sort((a, b) => b.length - a.length)
  const parts = kept.map((g) => rebuild(g.map((ti) => tris[ti]), (id) => table[id]))

  return { parts, droppedFragments, droppedTriangles }
}
