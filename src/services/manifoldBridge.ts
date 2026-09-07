/** Weld a non-indexed triangle soup (9 floats/tri) into a manifold vertex
 *  set: quantise each position onto a fine grid and reuse the index of a
 *  coincident vertex. Manifold needs shared vertices along shared edges. */
export function weldSoup(soup: Float32Array): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const triCount = Math.floor(soup.length / 9)
  // grid relative to the bbox diagonal so the weld tolerance tracks model size
  // and is not inflated by a large offset from the origin
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i + 2 < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const q = Math.max(diag, 1) * 1e-6
  const key = (x: number, y: number, z: number) =>
    Math.round(x / q) + ',' + Math.round(y / q) + ',' + Math.round(z / q)

  const index = new Map<string, number>()
  const verts: number[] = []
  const triVerts = new Uint32Array(triCount * 3)
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const o = t * 9 + c * 3
      const x = soup[o], y = soup[o + 1], z = soup[o + 2]
      const k = key(x, y, z)
      let vi = index.get(k)
      if (vi === undefined) {
        vi = verts.length / 3
        verts.push(x, y, z)
        index.set(k, vi)
      }
      triVerts[t * 3 + c] = vi
    }
  }
  return { vertProperties: new Float32Array(verts), triVerts }
}

/** Expand a manifold mesh (interleaved `vertProperties` with stride `numProp`,
 *  first 3 = position; `triVerts` 3 indices/tri) into a flat non-indexed
 *  position soup, 9 floats/tri. */
export function meshToSoup(vertProperties: Float32Array, triVerts: Uint32Array, numProp: number): Float32Array {
  const triCount = Math.floor(triVerts.length / 3)
  const out = new Float32Array(triCount * 9)
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const vi = triVerts[t * 3 + c]
      const src = vi * numProp
      const dst = t * 9 + c * 3
      out[dst] = vertProperties[src]
      out[dst + 1] = vertProperties[src + 1]
      out[dst + 2] = vertProperties[src + 2]
    }
  }
  return out
}
