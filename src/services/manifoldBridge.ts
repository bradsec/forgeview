/** Weld a non-indexed triangle soup (9 floats/tri) into a manifold vertex
 *  set: quantise each position onto a fine grid and reuse the index of a
 *  coincident vertex. Manifold needs shared vertices along shared edges. */
export function weldSoup(soup: Float32Array): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const triCount = Math.floor(soup.length / 9)
  // grid ~ 1e-5 of a unit; scale by the bbox so it is relative
  let min = Infinity, max = -Infinity
  for (let i = 0; i < soup.length; i++) {
    const v = soup[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = Math.max(max - min, 1)
  const q = span * 1e-6
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
