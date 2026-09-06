import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export const WALL_THICKNESS_MAX_TRIANGLES = 250_000

export interface WallThicknessMaskResult {
  mask: Uint8Array
  thinCount: number
  unsampledCount: number
}

const NORMAL_EPSILON = 1e-10

/**
 * Classify each triangle of a WORLD-SPACE, NON-INDEXED geometry as thin or not
 * by casting one ray inward from the face centroid to the opposite wall.
 * `unitInMm` scales the world-space hit distance to millimetres. A face whose
 * ray escapes (open surface) is 'unsampled' - not thin, not counted, tallied
 * separately. A degenerate (zero-area) face is skipped entirely.
 */
export function computeWallThicknessMask(
  geometry: THREE.BufferGeometry,
  minWallMm: number,
  unitInMm: number,
): WallThicknessMaskResult {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
  const positions = posAttr.array as Float32Array
  const faceCount = Math.floor(positions.length / 9)
  const mask = new Uint8Array(faceCount)
  let thinCount = 0
  let unsampledCount = 0

  if (faceCount === 0) return { mask, thinCount, unsampledCount }

  const bvh = new MeshBVH(geometry)
  geometry.computeBoundingSphere()
  const radius = geometry.boundingSphere?.radius ?? 1
  const eps = Math.max(radius * 1e-4, 1e-6)

  const origin = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const ray = new THREE.Ray()

  for (let f = 0; f < faceCount; f++) {
    const o = f * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < NORMAL_EPSILON) continue
    nx /= len; ny /= len; nz /= len
    const cxm = (ax + bx + cx) / 3
    const cym = (ay + by + cy) / 3
    const czm = (az + bz + cz) / 3
    origin.set(cxm - nx * eps, cym - ny * eps, czm - nz * eps)
    dir.set(-nx, -ny, -nz)
    ray.set(origin, dir)
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide)
    if (!hit) { unsampledCount++; continue }
    const thicknessMm = hit.distance * unitInMm
    if (thicknessMm < minWallMm) { mask[f] = 1; thinCount++ }
  }

  return { mask, thinCount, unsampledCount }
}
