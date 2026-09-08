import * as THREE from 'three'

/** Copy decoded XYZ values without including interleaved sibling attributes. */
export function packedPositions(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const positions = new Float32Array(attribute.count * 3)
  for (let index = 0; index < attribute.count; index++) {
    positions[index * 3] = attribute.getX(index)
    positions[index * 3 + 1] = attribute.getY(index)
    positions[index * 3 + 2] = attribute.getZ(index)
  }
  return positions
}

export function nonIndexedPositions(geo: THREE.BufferGeometry): Float32Array {
  const src = geo.index ? geo.toNonIndexed() : geo
  const out = packedPositions(src.getAttribute('position'))
  if (src !== geo) src.dispose()
  return out
}

export function fromPositions(positions: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
}

export const KEY = (x: number, y: number, z: number) =>
  `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`

/** merged-vertex triangle model shared by normals / smallShells / holeFill / boundary loops */
export function triModel(geo: THREE.BufferGeometry) {
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

export function rebuild(
  tris: number[][],
  vertexKeyOf: (id: number) => [number, number, number],
): THREE.BufferGeometry {
  const out = new Float32Array(tris.length * 9)
  let o = 0
  for (const tri of tris) for (const id of tri) {
    const [x, y, z] = vertexKeyOf(id)
    out[o++] = x; out[o++] = y; out[o++] = z
  }
  return fromPositions(out)
}

/** first-seen XYZ for each merged vertex id, read back from the raw position soup */
export function vertexTable(
  positions: Float32Array,
  tris: number[][],
  vertexCount: number,
): [number, number, number][] {
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
