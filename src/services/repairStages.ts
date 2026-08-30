import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface StageResult {
  geometry: THREE.BufferGeometry
  note?: string
}

export const REPAIR_STAGE_IDS = [
  'weld', 'degenerate', 'duplicate', 'normals', 'smallShells', 'holeFill',
] as const
export type RepairStageId = (typeof REPAIR_STAGE_IDS)[number]

export const STAGE_LABEL: Record<RepairStageId | 'seal', string> = {
  weld: 'Weld vertices',
  degenerate: 'Remove degenerate faces',
  duplicate: 'Remove duplicate faces',
  normals: 'Unify normals',
  smallShells: 'Remove small shells',
  holeFill: 'Fill holes',
  seal: 'Make solid (seal)',
}

function nonIndexedPositions(geo: THREE.BufferGeometry): Float32Array {
  const src = geo.index ? geo.toNonIndexed() : geo
  const attr = src.getAttribute('position') as THREE.BufferAttribute
  const out = new Float32Array(attr.array as ArrayLike<number>)
  if (src !== geo) src.dispose()
  return out
}

function fromPositions(positions: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
}

const KEY = (x: number, y: number, z: number) =>
  `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`

export function weldVertices(geo: THREE.BufferGeometry, tolerance = 1e-4): StageResult {
  try {
    const src = geo.index ? geo.clone() : geo.toNonIndexed()
    const merged = mergeVertices(src, tolerance)
    if (src !== geo) src.dispose()
    merged.computeVertexNormals()
    return { geometry: merged }
  } catch {
    return { geometry: geo.clone(), note: 'skipped: unsupported attribute layout' }
  }
}

export function dropDegenerateFaces(geo: THREE.BufferGeometry): StageResult {
  const p = nonIndexedPositions(geo)
  const kept: number[] = []
  let removed = 0
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let t = 0; t < p.length; t += 9) {
    a.set(p[t], p[t + 1], p[t + 2])
    b.set(p[t + 3], p[t + 4], p[t + 5])
    c.set(p[t + 6], p[t + 7], p[t + 8])
    const dup = a.distanceToSquared(b) <= 1e-12 || b.distanceToSquared(c) <= 1e-12 || a.distanceToSquared(c) <= 1e-12
    const area2 = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).lengthSq()
    if (dup || area2 <= 1e-20) { removed++; continue }
    for (let k = 0; k < 9; k++) kept.push(p[t + k])
  }
  return { geometry: fromPositions(new Float32Array(kept)), note: removed ? `${removed} removed` : undefined }
}

export function dropDuplicateFaces(geo: THREE.BufferGeometry): StageResult {
  const p = nonIndexedPositions(geo)
  const ids = new Map<string, number>()
  const cornerId = (i: number) => {
    const k = KEY(p[i], p[i + 1], p[i + 2])
    let id = ids.get(k)
    if (id === undefined) { id = ids.size; ids.set(k, id) }
    return id
  }
  const seen = new Set<string>()
  const kept: number[] = []
  let removed = 0
  for (let t = 0; t < p.length; t += 9) {
    const tri = [cornerId(t), cornerId(t + 3), cornerId(t + 6)].sort((x, y) => x - y).join(':')
    if (seen.has(tri)) { removed++; continue }
    seen.add(tri)
    for (let k = 0; k < 9; k++) kept.push(p[t + k])
  }
  return { geometry: fromPositions(new Float32Array(kept)), note: removed ? `${removed} removed` : undefined }
}

/** merged-vertex triangle model shared by normals / smallShells / holeFill */
function triModel(geo: THREE.BufferGeometry) {
  const p = nonIndexedPositions(geo)
  const ids = new Map<string, number>()
  const triCount = p.length / 9
  const tris: number[][] = []
  for (let t = 0; t < triCount; t++) {
    const tri: number[] = []
    for (let c = 0; c < 3; c++) {
      const i = t * 9 + c * 3
      const k = KEY(p[i], p[i + 1], p[i + 2])
      let id = ids.get(k)
      if (id === undefined) { id = ids.size; ids.set(k, id) }
      tri.push(id)
    }
    tris.push(tri)
  }
  return { positions: p, tris, vertexCount: ids.size }
}

function rebuild(tris: number[][], vertexKeyOf: (id: number) => [number, number, number]): THREE.BufferGeometry {
  const out = new Float32Array(tris.length * 9)
  let o = 0
  for (const tri of tris) for (const id of tri) {
    const [x, y, z] = vertexKeyOf(id)
    out[o++] = x; out[o++] = y; out[o++] = z
  }
  return fromPositions(out)
}

/** first-seen XYZ for each merged vertex id, read back from the raw position soup */
function vertexTable(positions: Float32Array, tris: number[][], vertexCount: number): [number, number, number][] {
  const table: [number, number, number][] = new Array(vertexCount)
  let filled = 0
  for (let t = 0; t < tris.length && filled < vertexCount; t++) {
    for (let c = 0; c < 3; c++) {
      const id = tris[t][c]
      if (!table[id]) {
        const i = t * 9 + c * 3
        table[id] = [positions[i], positions[i + 1], positions[i + 2]]
        filled++
      }
    }
  }
  return table
}

/**
 * BFS over shared-edge adjacency, per connected component, flipping each
 * triangle's winding to agree with its component seed, then recomputing vertex
 * normals. If a component contains an edge that would force one triangle into
 * both orientations at once (non-orientable, e.g. a Mobius strip), every
 * tentative flip in that component is reverted and the component is left exactly
 * as it came in; the count of such components is reported in `note`. Never
 * throws on a non-orientable input. Pure: the input geometry is not mutated.
 */
export function unifyNormals(geo: THREE.BufferGeometry): StageResult {
  const { positions, tris, vertexCount } = triModel(geo)
  // Snapshot id -> XYZ now: BFS only permutes ids WITHIN a triangle, never adds
  // or moves them, so a pre-BFS table stays correct. Building it after the
  // reverse()s below would misread the position soup for any flipped triangle.
  const table = vertexTable(positions, tris, vertexCount)
  const ekey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  const edgeMap = new Map<string, number[]>()
  tris.forEach((tri, ti) => {
    for (let e = 0; e < 3; e++) {
      const k = ekey(tri[e], tri[(e + 1) % 3])
      let arr = edgeMap.get(k)
      if (!arr) { arr = []; edgeMap.set(k, arr) }
      arr.push(ti)
    }
  })
  const hasDirectedEdge = (tri: number[], a: number, b: number): boolean => {
    for (let f = 0; f < 3; f++) if (tri[f] === a && tri[(f + 1) % 3] === b) return true
    return false
  }
  const visited = new Array<boolean>(tris.length).fill(false)
  let nonOrientable = 0
  for (let seed = 0; seed < tris.length; seed++) {
    if (visited[seed]) continue
    visited[seed] = true
    const flipped: number[] = []
    const queue = [seed]
    let conflict = false
    while (queue.length) {
      const ti = queue.pop()!
      const tri = tris[ti]
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3]
        for (const nti of edgeMap.get(ekey(a, b)) ?? []) {
          if (nti === ti) continue
          const nb = tris[nti]
          const consistent = hasDirectedEdge(nb, b, a) // shared edge traversed the opposite way
          const inconsistent = hasDirectedEdge(nb, a, b)
          if (!visited[nti]) {
            visited[nti] = true
            if (inconsistent && !consistent) { nb.reverse(); flipped.push(nti) }
            queue.push(nti)
          } else if (inconsistent && !consistent) {
            conflict = true
          }
        }
      }
    }
    if (conflict) {
      for (const ti of flipped) tris[ti].reverse()
      nonOrientable++
    }
  }
  return {
    geometry: rebuild(tris, (id) => table[id]),
    note: nonOrientable
      ? `${nonOrientable} non-orientable component${nonOrientable === 1 ? '' : 's'} left unchanged`
      : undefined,
  }
}

/**
 * Union-find connected components over merged vertex ids. A component is kept
 * when its triangle count is at least `minFraction` of the total, and every
 * component tied for the largest triangle count is always kept; the rest are
 * dropped. `note` reports how many shells were removed and their triangle count.
 * Single-component input is a no-op. Pure: the input geometry is not mutated.
 */
export function removeSmallShells(geo: THREE.BufferGeometry, minFraction = 0.01): StageResult {
  const { positions, tris, vertexCount } = triModel(geo)
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
  const table = vertexTable(positions, tris, vertexCount)
  if (compTris.size <= 1) {
    return { geometry: rebuild(tris, (id) => table[id]) }
  }
  const total = tris.length
  const maxTris = Math.max(...[...compTris.values()].map((list) => list.length))
  const keep = new Set<number>()
  let dropped = 0, droppedTris = 0
  for (const list of compTris.values()) {
    if (list.length === maxTris || list.length >= minFraction * total) list.forEach((ti) => keep.add(ti))
    else { dropped++; droppedTris += list.length }
  }
  const keptTris = tris.filter((_, ti) => keep.has(ti))
  return {
    geometry: rebuild(keptTris, (id) => table[id]),
    note: dropped
      ? `${dropped} shell${dropped === 1 ? '' : 's'} removed (${droppedTris} tri${droppedTris === 1 ? '' : 's'})`
      : undefined,
  }
}
