import * as THREE from 'three'

function vertexKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

export interface MeshHealth {
  triangles: number
  vertices: number
  boundaryEdges: number
  nonManifoldEdges: number
  duplicateFaces: number
  degenerateFaces: number
  watertight: boolean
}

/** Count vertices, edges, and manifold defects of a triangle mesh. Positions
 * are merged at 1e-6 so split-vertex source data still reads as connected. */
export function analyzeGeometry(geometry: THREE.BufferGeometry): MeshHealth {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position')
  if (!position) {
    if (source !== geometry) source.dispose()
    return { triangles: 0, vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: false }
  }
  const vertexIds = new Map<string, number>()
  const cornerIds = new Int32Array(position.count)
  for (let corner = 0; corner < position.count; corner++) {
    const key = vertexKey(position.getX(corner), position.getY(corner), position.getZ(corner))
    if (!vertexIds.has(key)) vertexIds.set(key, vertexIds.size)
    cornerIds[corner] = vertexIds.get(key)!
  }
  const edges = new Map<string, number>()
  const faces = new Set<string>()
  let duplicateFaces = 0
  let degenerateFaces = 0
  const triangles = Math.floor(position.count / 3)
  for (let triangle = 0; triangle < triangles; triangle++) {
    const ids = [cornerIds[triangle * 3], cornerIds[triangle * 3 + 1], cornerIds[triangle * 3 + 2]]
    const a = new THREE.Vector3().fromBufferAttribute(position, triangle * 3)
    const b = new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + 1)
    const c = new THREE.Vector3().fromBufferAttribute(position, triangle * 3 + 2)
    if (new Set(ids).size < 3 || new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).lengthSq() <= 1e-20) {
      degenerateFaces++
      continue
    }
    const face = [...ids].sort((x, y) => x - y).join(':')
    if (faces.has(face)) duplicateFaces++
    else faces.add(face)
    for (let edge = 0; edge < 3; edge++) {
      const key = edgeKey(ids[edge], ids[(edge + 1) % 3])
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  const boundaryEdges = [...edges.values()].filter((count) => count === 1).length
  const nonManifoldEdges = [...edges.values()].filter((count) => count > 2).length
  const result = {
    triangles,
    vertices: vertexIds.size,
    boundaryEdges,
    nonManifoldEdges,
    duplicateFaces,
    degenerateFaces,
    watertight: triangles > 0 && boundaryEdges === 0 && nonManifoldEdges === 0 && duplicateFaces === 0 && degenerateFaces === 0,
  }
  if (source !== geometry) source.dispose()
  return result
}
