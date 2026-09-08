import * as THREE from 'three'
import { runStages, REPAIR_STAGE_IDS } from './repairStages'
import { computeBestOrientation, AUTO_ORIENT_MAX_FACES } from './autoOrient'
import { exportSTL } from './exporters'

export const BATCH_MAX_FACES = AUTO_ORIENT_MAX_FACES

/** Repair and orient already transformed millimeter triangle positions. */
export function prepareBatchGeometry(positions: Float32Array): { bytes: Uint8Array; notes: string[] } {
  if (!positions.length || positions.length % 9 !== 0 || positions.length / 9 > BATCH_MAX_FACES) {
    throw new Error(`Expected 1 to ${BATCH_MAX_FACES.toLocaleString()} triangles`)
  }
  if (!positions.every(Number.isFinite)) throw new Error('Geometry contains non-finite coordinates')
  const source = new THREE.BufferGeometry()
  source.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  let geometry: THREE.BufferGeometry | undefined
  let flat: THREE.BufferGeometry | undefined
  const material = new THREE.MeshBasicMaterial()
  try {
    const result = runStages(source, [...REPAIR_STAGE_IDS])
    geometry = result.geometry
    flat = geometry.index ? geometry.toNonIndexed() : geometry
    const repaired = flat.getAttribute('position').array as Float32Array
    if (!repaired.length || repaired.length / 9 > BATCH_MAX_FACES) throw new Error('Repaired geometry exceeds the triangle limit or is empty')
    const orientation = computeBestOrientation(repaired, 45)
    if (orientation.skipped) throw new Error('Auto-orient triangle limit exceeded')
    flat.applyQuaternion(new THREE.Quaternion(...orientation.quaternion))
    flat.computeBoundingBox()
    const box = flat.boundingBox!
    flat.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
    // Orientation uses Y-up internally; STL print coordinates use Z-up.
    flat.rotateX(Math.PI / 2)
    const bytes = exportSTL([new THREE.Mesh(flat, material)])
    return { bytes, notes: result.stages.flatMap((stage) => stage.note ? [`${stage.id}: ${stage.note}`] : []) }
  } finally {
    if (flat && flat !== geometry) flat.dispose()
    geometry?.dispose()
    source.dispose()
    material.dispose()
  }
}
