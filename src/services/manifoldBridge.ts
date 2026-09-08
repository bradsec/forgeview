/** Share exactly coincident vertices without rounding away thin features. */
export function weldSoup(soup: Float32Array) {
  if (soup.length === 0 || soup.length % 9 !== 0) throw new Error('Expected complete triangles for a closed solid')
  const vertices: number[] = []
  const indices = new Map<string, number>()
  const triVerts = new Uint32Array(soup.length / 3)
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2]
    if (![x, y, z].every(Number.isFinite)) throw new Error('Model contains non-finite coordinates')
    const key = `${x},${y},${z}`
    let index = indices.get(key)
    if (index === undefined) {
      index = vertices.length / 3
      indices.set(key, index)
      vertices.push(x, y, z)
    }
    triVerts[i / 3] = index
  }
  return { vertProperties: new Float32Array(vertices), triVerts }
}

export function meshToSoup(vertProperties: Float32Array, triVerts: Uint32Array, numProp: number): Float32Array {
  if (numProp < 3 || !Number.isInteger(numProp) || vertProperties.length % numProp || triVerts.length % 3) {
    throw new Error('Invalid solid mesh output')
  }
  const result = new Float32Array(triVerts.length * 3)
  for (let i = 0; i < triVerts.length; i++) {
    const source = triVerts[i] * numProp
    if (source + 2 >= vertProperties.length) throw new Error('Invalid solid mesh index')
    result.set(vertProperties.subarray(source, source + 3), i * 3)
  }
  return result
}
