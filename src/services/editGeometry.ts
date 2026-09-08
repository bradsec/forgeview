import * as THREE from 'three'
import { nonIndexedPositions } from './meshTopology'

export function requireEditable(meshes: THREE.Mesh[]): void {
  if (!meshes.length) throw new Error('No mesh geometry is open')
  for (const mesh of meshes) {
    const g = mesh.geometry
    if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh ||
        mesh.morphTargetInfluences?.some(v => v !== 0) || Array.isArray(mesh.material) ||
        g.groups.length > 1 || g.hasAttribute('uv') || g.hasAttribute('color')) {
      throw new Error('This operation requires static, untextured meshes with one material')
    }
  }
}

function reverseTriangles(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 9) for (let axis = 0; axis < 3; axis++) {
    const value = positions[i + 3 + axis]
    positions[i + 3 + axis] = positions[i + 6 + axis]
    positions[i + 6 + axis] = value
  }
}

/** Bake static geometry while retaining outward winding under a reflection. */
export function worldPositions(mesh: THREE.Mesh): Float32Array {
  mesh.updateWorldMatrix(true, false)
  const positions = nonIndexedPositions(mesh.geometry)
  const point = new THREE.Vector3()
  for (let i = 0; i < positions.length; i += 3) {
    point.fromArray(positions, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i)
  }
  if (mesh.matrixWorld.determinant() < 0) reverseTriangles(positions)
  return positions
}

export function geometryFromWorld(positions: Float32Array, mesh?: THREE.Mesh): THREE.BufferGeometry {
  const data = new Float32Array(positions)
  if (data.length % 9 || !data.every(Number.isFinite)) throw new Error('Invalid geometry result')
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(data, 3))
  if (mesh) {
    mesh.updateWorldMatrix(true, false)
    if (Math.abs(mesh.matrixWorld.determinant()) < 1e-15) { g.dispose(); throw new Error('Model transform is singular') }
    g.applyMatrix4(mesh.matrixWorld.clone().invert())
    if (mesh.matrixWorld.determinant() < 0) reverseTriangles(data)
  }
  g.computeVertexNormals()
  return g
}
