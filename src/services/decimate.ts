import * as THREE from 'three'
import { MeshoptSimplifier } from 'meshoptimizer/simplifier'

/** Simplify position-only geometry without modifying the source buffers. */
export async function decimateGeometry(input: THREE.BufferGeometry, targetTriangles: number): Promise<THREE.BufferGeometry> {
  const attr = input.getAttribute('position')
  if (!attr || attr.itemSize !== 3) throw new Error('Mesh requires three-component positions')
  const indexCount = input.index?.count ?? attr.count
  const triangles = indexCount / 3
  if (!Number.isInteger(triangles) || triangles < 4) throw new Error('Decimation requires at least 4 triangles')
  if (!Number.isInteger(targetTriangles) || targetTriangles < 4 || targetTriangles > triangles) throw new Error('Target must be between 4 and the current triangle count')
  let positions = new Float32Array(attr.count * 3)
  for (let i = 0; i < attr.count; i++) {
    positions[i * 3] = attr.getX(i)
    positions[i * 3 + 1] = attr.getY(i)
    positions[i * 3 + 2] = attr.getZ(i)
  }
  if (!positions.every(Number.isFinite)) throw new Error('Mesh contains non-finite coordinates')
  const indices = new Uint32Array(indexCount)
  for (let i = 0; i < indexCount; i++) {
    const vertex = input.index ? input.index.getX(i) : i
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= attr.count) throw new Error('Mesh contains an invalid vertex index')
    indices[i] = vertex
  }
  if (!MeshoptSimplifier.supported) throw new Error('Decimation requires WebAssembly support')
  await MeshoptSimplifier.ready
  // STL triangle soup and split shading vertices must share positional indices
  // for the topology-preserving simplifier to find collapsible edges.
  const welded = MeshoptSimplifier.generatePositionRemap(positions, 3)
  for (let i = 0; i < indices.length; i++) indices[i] = welded[indices[i]]
  // Remove unreferenced duplicates too: meshoptimizer classifies seams using
  // the full vertex buffer, including vertices absent from the index buffer.
  const [weldRemap, weldCount] = MeshoptSimplifier.compactMesh(indices)
  positions = compactPositions(positions, weldRemap, weldCount)
  // A permissive error budget lets the requested count drive simplification.
  // Topological constraints can still leave more triangles than requested.
  const [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, targetTriangles * 3, 1)
  if (simplified.length < 12) throw new Error('Decimation produced no usable surface')
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(simplified)
  return new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(compactPositions(positions, remap, vertexCount), 3))
    .setIndex(new THREE.BufferAttribute(simplified, 1))
}

function compactPositions(positions: Float32Array, remap: Uint32Array, vertexCount: number): Float32Array<ArrayBuffer> {
  const compact = new Float32Array(vertexCount * 3)
  for (let i = 0; i < remap.length; i++) {
    if (remap[i] === 0xffffffff) continue
    compact[remap[i] * 3] = positions[i * 3]
    compact[remap[i] * 3 + 1] = positions[i * 3 + 1]
    compact[remap[i] * 3 + 2] = positions[i * 3 + 2]
  }
  return compact
}
