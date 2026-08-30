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
