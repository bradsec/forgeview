import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
import type { HollowOptions } from './manifoldTypes'
import { meshToSoup } from './manifoldBridge'

/** Sample a signed distance field, then remove the inward offset solid. */
export function hollowSolid(wasm: ManifoldToplevel, outer: Manifold, options: HollowOptions): Manifold {
  const { wallThickness, resolution, drainRadius, drainAxis, drainOffset } = options
  if (!Number.isFinite(wallThickness) || wallThickness <= 0 || !Number.isInteger(resolution) || resolution < 16 || resolution > 64
    || !Number.isFinite(drainRadius) || drainRadius < 0 || !['x', 'y', 'z'].includes(drainAxis)
    || drainOffset.length !== 3 || !drainOffset.every(Number.isFinite)) throw new Error('Invalid hollow settings')
  const bounds = outer.boundingBox()
  const extent = bounds.max.map((value, axis) => value - bounds.min[axis])
  const longest = Math.max(...extent)
  const spacing = longest / resolution
  if (wallThickness < spacing) throw new Error('Wall thickness is below the sampling spacing. Increase resolution or wall thickness.')
  const mesh = outer.getMesh()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(meshToSoup(mesh.vertProperties, mesh.triVerts, mesh.numProp), 3))
  const owned: Manifold[] = []
  try {
    const tree = new MeshBVH(geometry)
    const point = new Vector3()
    const ray = new Ray(point, new Vector3(1, 0.371390676, 0.69474659).normalize())
    const distanceTarget = { point: new Vector3(), distance: 0, faceIndex: 0 }
    const cavity = wasm.Manifold.levelSet(position => {
      point.set(...position)
      const nearest = tree.closestPointToPoint(point, distanceTarget)
      if (!nearest) throw new Error('Could not sample model surface')
      if (nearest.distance < longest * 1e-12) return 0
      const hits = tree.raycast(ray, DoubleSide).sort((a, b) => a.distance - b.distance)
      let crossings = 0
      let previous = -Infinity
      for (const hit of hits) {
        // Shared triangle edges can report the same crossing twice.
        if (hit.distance - previous > longest * 1e-10) crossings++
        previous = hit.distance
      }
      return (crossings % 2 ? 1 : -1) * nearest.distance
    }, bounds, spacing, wallThickness)
    owned.push(cavity)
    if (cavity.status() !== 'NoError' || cavity.isEmpty()) throw new Error('Wall thickness leaves no cavity at this resolution')
    let result = outer.subtract(cavity)
    owned.push(result)
    if (drainRadius > 0) {
      const axis = { x: 0, y: 1, z: 2 }[drainAxis]
      const center = [...drainOffset] as [number, number, number]
      center[axis] = (bounds.min[axis] + bounds.max[axis]) / 2
      const cylinder = wasm.Manifold.cylinder(extent[axis] + 2 * longest, drainRadius, drainRadius, 48, true)
      owned.push(cylinder)
      const rotated = cylinder.rotate(drainAxis === 'x' ? [0, 90, 0] : drainAxis === 'y' ? [90, 0, 0] : [0, 0, 0])
      owned.push(rotated)
      const cutter = rotated.translate(center)
      owned.push(cutter)
      const connection = cavity.intersect(cutter)
      owned.push(connection)
      if (connection.isEmpty()) throw new Error('Drain hole does not reach the cavity. Move it closer to the model center.')
      result = result.subtract(cutter)
      owned.push(result)
    }
    if (result.status() !== 'NoError' || result.isEmpty()) throw new Error('Hollow settings remove the entire model')
    owned.splice(owned.indexOf(result), 1)
    return result
  } finally {
    geometry.dispose()
    for (const solid of owned.reverse()) solid.delete()
  }
}
