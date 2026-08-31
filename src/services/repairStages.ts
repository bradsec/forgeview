import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { analyzeGeometry, type MeshHealth } from './meshHealth'
import {
  KEY, nonIndexedPositions, fromPositions, triModel, rebuild, vertexTable,
} from './meshTopology'
import { extractBoundaryLoops, centroidFan } from './boundaryLoops'

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

export function weldVertices(geo: THREE.BufferGeometry, tolerance = 1e-4): StageResult {
  try {
    // mergeVertices accepts indexed and non-indexed input and returns a fresh
    // geometry, so the caller's geometry is never touched and nothing to clean
    // up leaks on the throw path below.
    const merged = mergeVertices(geo, tolerance)
    merged.computeVertexNormals()
    return { geometry: merged }
  } catch {
    return { geometry: geo.clone(), note: 'skipped: weld failed' }
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

/**
 * BFS over shared-edge adjacency, per connected component, flipping each
 * triangle's winding to agree with its component seed, then recomputing vertex
 * normals. Seed-consistent is not enough: if the seed is itself inverted the
 * whole component ends up wound inward, so after the BFS pass each orientable
 * component's signed volume `V = Σ dot(a, cross(b, c)) / 6` is checked and the
 * whole component reversed when `V < 0`, leaving normals pointing outward. If a
 * component contains an edge that would force one triangle into both
 * orientations at once (non-orientable, e.g. a Mobius strip), every tentative
 * flip in that component is reverted, the signed-volume correction is skipped,
 * and the component is left exactly as it came in; the count of such components
 * is reported in `note`. Never throws on a non-orientable input. Pure: the input
 * geometry is not mutated.
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
    const component = [seed]
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
            component.push(nti)
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
      continue
    }
    // Seed-consistent now; flip the whole component if it came out inward.
    let volume = 0
    for (const ti of component) {
      const [ia, ib, ic] = tris[ti]
      const a = table[ia], b = table[ib], c = table[ic]
      const cx = b[1] * c[2] - b[2] * c[1]
      const cy = b[2] * c[0] - b[0] * c[2]
      const cz = b[0] * c[1] - b[1] * c[0]
      volume += a[0] * cx + a[1] * cy + a[2] * cz
    }
    if (volume < 0) for (const ti of component) tris[ti].reverse()
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

/**
 * Seal open boundaries via extractBoundaryLoops + centroidFan. Does not use
 * the old merge/rebuild machinery. Pure: the input geometry is not mutated.
 */
export function fillHoles(geo: THREE.BufferGeometry): StageResult {
  const { loops, skippedPinched } = extractBoundaryLoops(geo)
  if (loops.length === 0) {
    return {
      geometry: geo.clone(),
      note: skippedPinched ? `0 filled, ${skippedPinched} skipped` : undefined,
    }
  }
  const soup = nonIndexedPositions(geo)
  const fans = loops.map((l) => centroidFan(l.points))
  const total = soup.length + fans.reduce((s, f) => s + f.length, 0)
  const out = new Float32Array(total)
  out.set(soup, 0)
  let off = soup.length
  for (const f of fans) { out.set(f, off); off += f.length }
  return {
    geometry: fromPositions(out),
    note: `${loops.length} loop${loops.length === 1 ? '' : 's'} filled${
      skippedPinched ? `, ${skippedPinched} skipped` : ''
    }`,
  }
}

/**
 * Cap one already-identified boundary loop. `loop` is an ordered vertex ring
 * from `extractBoundaryLoops` for THIS geometry; each point must KEY-match a
 * vertex of `geo`. Appends `centroidFan(loop)` to a non-indexed copy. Pure.
 */
export function fillLoop(
  geo: THREE.BufferGeometry,
  loop: [number, number, number][],
): StageResult {
  const soup = nonIndexedPositions(geo)
  const present = new Set<string>()
  for (let i = 0; i < soup.length; i += 3) present.add(KEY(soup[i], soup[i + 1], soup[i + 2]))
  for (const [x, y, z] of loop) {
    if (!present.has(KEY(x, y, z))) {
      return { geometry: geo.clone(), note: 'skipped: loop not on geometry' }
    }
  }
  const fan = centroidFan(loop)
  const out = new Float32Array(soup.length + fan.length)
  out.set(soup, 0)
  out.set(fan, soup.length)
  return { geometry: fromPositions(out) }
}

const STAGE_FN: Record<RepairStageId, (g: THREE.BufferGeometry) => StageResult> = {
  weld: (g) => weldVertices(g),
  degenerate: dropDegenerateFaces,
  duplicate: dropDuplicateFaces,
  normals: unifyNormals,
  smallShells: (g) => removeSmallShells(g),
  holeFill: fillHoles,
}

export interface RunStage {
  id: RepairStageId
  before: MeshHealth
  after: MeshHealth
  note?: string
}

/**
 * Apply the requested repair stages to a clone of `geo`, always in canonical
 * `REPAIR_STAGE_IDS` order regardless of the order they are passed. Each stage
 * records mesh health before and after via `analyzeGeometry`. Intermediate
 * geometries are disposed; the caller's input and the returned geometry are not.
 * `onStage` fires immediately before each stage runs, with the count already
 * completed, the total to run, and the stage id, so a caller can report
 * sub-mesh progress.
 */
export function runStages(
  geo: THREE.BufferGeometry,
  stageIds: RepairStageId[],
  onStage?: (done: number, total: number, id: RepairStageId) => void,
): { geometry: THREE.BufferGeometry; stages: RunStage[] } {
  const want = new Set(stageIds)
  const ordered = REPAIR_STAGE_IDS.filter((id) => want.has(id))
  let current = geo.clone()
  const stages: RunStage[] = []
  let done = 0
  for (const id of ordered) {
    onStage?.(done, ordered.length, id)
    const before = analyzeGeometry(current)
    const res = STAGE_FN[id](current)
    if (res.geometry !== current) current.dispose()
    current = res.geometry
    stages.push({ id, before, after: analyzeGeometry(current), note: res.note })
    done++
  }
  return { geometry: current, stages }
}
