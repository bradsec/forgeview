export interface OverhangMaskResult {
  mask: Uint8Array
  count: number
}

const NORMAL_EPSILON = 1e-10

export function computeOverhangFaceMask(
  positions: Float32Array,
  thresholdDeg: number,
): OverhangMaskResult {
  const faceCount = Math.floor(positions.length / 9)
  const mask = new Uint8Array(faceCount)
  let count = 0

  for (let f = 0; f < faceCount; f++) {
    const o = f * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    // Face normal = e1 x e2. Only the y-component is needed for the
    // straight-down angle, but the length of the full vector is needed to
    // detect a degenerate (near-zero-area) triangle.
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < NORMAL_EPSILON) continue
    const normalizedNy = ny / len
    const angleFromStraightDownDeg = (Math.acos(Math.max(-1, Math.min(1, -normalizedNy))) * 180) / Math.PI
    if (angleFromStraightDownDeg < thresholdDeg) {
      mask[f] = 1
      count++
    }
  }

  return { mask, count }
}
