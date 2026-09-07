import * as THREE from 'three'

export const AUTO_ORIENT_CANDIDATES = 64
export const AUTO_ORIENT_MAX_FACES = 200_000
/** How many distinct face-normal directions (largest total area first) are
 *  tried as candidate rest orientations, on top of the Fibonacci sweep. A
 *  flat resting face must be an exact candidate for its own contact area to
 *  register, which a sparse Fibonacci lattice cannot guarantee. */
const AUTO_ORIENT_FACE_NORMAL_CANDIDATES = 256
/** Quantisation grid for de-duplicating near-parallel face normals (~1 degree). */
const NORMAL_DEDUPE_GRID = 50

const DEGENERATE_EPSILON = 1e-10
const W_OVERHANG = 1.0
const W_HEIGHT = 0.2
const W_CONTACT = 0.15
const CONTACT_NORMAL_MIN = 0.985

export interface AutoOrientResult {
  quaternion: [number, number, number, number]
  overhangFractionBefore: number
  overhangFractionAfter: number
  candidatesEvaluated: number
  skipped: boolean
}

/** n roughly-uniform unit vectors on the sphere (Fibonacci lattice). */
export function fibonacciSphere(n: number): [number, number, number][] {
  const out: [number, number, number][] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    out.push([Math.cos(theta) * r, y, Math.sin(theta) * r])
  }
  return out
}

/**
 * `positions` is a WORLD-SPACE, NON-INDEXED triangle soup (9 floats/face) -
 * the merged current geometry of every model mesh. `thresholdDeg` is the
 * overhang angle from straight down (same value the Overhangs row uses).
 * A face is a downward-facing overhang for a candidate down-vector `d` when
 * dot(unitNormal, d) > cos(thresholdDeg).
 */
export function computeBestOrientation(
  positions: Float32Array,
  thresholdDeg: number,
): AutoOrientResult {
  const faceCount = Math.floor(positions.length / 9)
  const cosThreshold = Math.cos((thresholdDeg * Math.PI) / 180)

  // Per-face unit normal + area, one pass. Degenerate faces get area 0 and a
  // zero normal so they never count as overhang or contact.
  const normals = new Float32Array(faceCount * 3)
  const areas = new Float32Array(faceCount)
  let totalArea = 0
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let f = 0; f < faceCount; f++) {
    const o = f * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    for (const [vx, vy, vz] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] as const) {
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy
      if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz
    }
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < DEGENERATE_EPSILON) continue
    normals[f * 3] = nx / len
    normals[f * 3 + 1] = ny / len
    normals[f * 3 + 2] = nz / len
    const area = len / 2
    areas[f] = area
    totalArea += area
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1

  // Evaluate one candidate down-vector: returns its overhang fraction (support
  // needing, i.e. within thresholdDeg of straight down and NOT resting on the
  // plate), contact fraction, normalised height, and the weighted cost.
  const evalCandidate = (dx: number, dy: number, dz: number) => {
    const upx = -dx, upy = -dy, upz = -dz
    let minH = Infinity
    let maxH = -Infinity
    for (let f = 0; f < faceCount; f++) {
      const o = f * 9
      for (let v = 0; v < 3; v++) {
        const h = positions[o + v * 3] * upx + positions[o + v * 3 + 1] * upy + positions[o + v * 3 + 2] * upz
        if (h < minH) minH = h
        if (h > maxH) maxH = h
      }
    }
    const height = maxH - minH
    const contactEps = Math.max(height * 1e-3, 1e-4)
    let overhangArea = 0
    let contactArea = 0
    for (let f = 0; f < faceCount; f++) {
      if (areas[f] === 0) continue
      const nd = normals[f * 3] * dx + normals[f * 3 + 1] * dy + normals[f * 3 + 2] * dz
      // Bed contact: near-straight-down normal AND all 3 vertices on the
      // lowest plane along this build axis.
      let isContact = false
      if (nd > CONTACT_NORMAL_MIN) {
        const o = f * 9
        isContact = true
        for (let v = 0; v < 3; v++) {
          const h = positions[o + v * 3] * upx + positions[o + v * 3 + 1] * upy + positions[o + v * 3 + 2] * upz
          if (h - minH > contactEps) { isContact = false; break }
        }
      }
      if (isContact) contactArea += areas[f]
      // Support-needing overhang: within thresholdDeg of straight down AND
      // not resting on the plate. Excluding the contact set is what makes
      // "rest it flat" the low-overhang answer instead of "stand it on edge".
      else if (nd > cosThreshold) overhangArea += areas[f]
    }
    const overhangFraction = totalArea > 0 ? overhangArea / totalArea : 0
    const contactFraction = totalArea > 0 ? contactArea / totalArea : 0
    const heightNorm = height / diag
    const cost = W_OVERHANG * overhangFraction + W_HEIGHT * heightNorm - W_CONTACT * contactFraction
    return { overhangFraction, cost }
  }

  const base = evalCandidate(0, -1, 0)
  const before = base.overhangFraction

  if (faceCount > AUTO_ORIENT_MAX_FACES) {
    return {
      quaternion: [0, 0, 0, 1],
      overhangFractionBefore: before,
      overhangFractionAfter: before,
      candidatesEvaluated: 0,
      skipped: true,
    }
  }

  // Candidate rest directions: the model's own face normals (largest total
  // coplanar area first) plus a Fibonacci sweep for shapes with no good flat
  // face. De-duplicate on a coarse grid so a big flat region contributes one
  // candidate, not thousands.
  const buckets = new Map<string, { dir: [number, number, number]; area: number }>()
  for (let f = 0; f < faceCount; f++) {
    if (areas[f] === 0) continue
    const nx = normals[f * 3], ny = normals[f * 3 + 1], nz = normals[f * 3 + 2]
    const key =
      Math.round(nx * NORMAL_DEDUPE_GRID) + ',' +
      Math.round(ny * NORMAL_DEDUPE_GRID) + ',' +
      Math.round(nz * NORMAL_DEDUPE_GRID)
    const b = buckets.get(key)
    if (b) b.area += areas[f]
    else buckets.set(key, { dir: [nx, ny, nz], area: areas[f] })
  }
  const faceDirs = [...buckets.values()]
    .sort((a, b) => b.area - a.area)
    .slice(0, AUTO_ORIENT_FACE_NORMAL_CANDIDATES)
    .map((b) => b.dir)

  const dirs: [number, number, number][] = [...faceDirs, ...fibonacciSphere(AUTO_ORIENT_CANDIDATES)]
  let bestDir: [number, number, number] | null = null
  let bestCost = base.cost
  let bestOverhang = before

  for (const [dx, dy, dz] of dirs) {
    const c = evalCandidate(dx, dy, dz)
    // Strictly better than the current orientation to switch, so a tie keeps
    // the current orientation and the result is a no-op.
    if (c.cost < bestCost - 1e-9) {
      bestCost = c.cost
      bestDir = [dx, dy, dz]
      bestOverhang = c.overhangFraction
    }
  }

  let quaternion: [number, number, number, number] = [0, 0, 0, 1]
  if (bestDir) {
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(bestDir[0], bestDir[1], bestDir[2]),
      new THREE.Vector3(0, -1, 0),
    )
    quaternion = [q.x, q.y, q.z, q.w]
  }

  return {
    quaternion,
    overhangFractionBefore: before,
    overhangFractionAfter: bestDir ? bestOverhang : before,
    candidatesEvaluated: dirs.length + 1,
    skipped: false,
  }
}
