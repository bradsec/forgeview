import * as THREE from 'three'
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH } from 'three-mesh-bvh'
import { analyzeGeometry } from './meshHealth'

export type RemeshOptions =
  | { operation: 'decimate'; targetTriangles: number }
  | { operation: 'remesh'; resolution: number }
export interface RemeshResult {
  geometry: THREE.BufferGeometry
  beforeTriangles: number
  afterTriangles: number
}

/** Position-only input: callers must reject textured, animated, and multi-material meshes. */
export function remeshGeometry(input: THREE.BufferGeometry, options: RemeshOptions): RemeshResult {
  const attr = input.getAttribute('position')
  if (!attr || attr.itemSize !== 3) throw new Error('Mesh requires three-component positions')
  const count = (input.index?.count ?? attr.count) / 3
  if (!Number.isInteger(count) || count < 4 || count > 100_000) throw new Error('Remesh requires 4 to 100,000 triangles')
  const source = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 9)
  for (let i = 0; i < count * 3; i++) {
    const j = input.index ? input.index.getX(i) : i
    if (!Number.isInteger(j) || j < 0 || j >= attr.count) throw new Error('Mesh contains an invalid vertex index')
    positions[i * 3] = attr.getX(j)
    positions[i * 3 + 1] = attr.getY(j)
    positions[i * 3 + 2] = attr.getZ(j)
  }
  if (!positions.every(Number.isFinite)) throw new Error('Mesh contains non-finite coordinates')
  source.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  let geometry: THREE.BufferGeometry
  try {
    if (options.operation === 'decimate') {
      if (count > 10_000) throw new Error('Decimation is limited to 10,000 input triangles')
      if (!Number.isInteger(options.targetTriangles) || options.targetTriangles < 4 || options.targetTriangles > count) throw new Error('Target must be between 4 and the current triangle count')
      const welded = mergeVertices(source)
      try {
        // Melax collapses vertices, not triangles. Two faces per collapse is an
        // estimate for closed manifold surfaces; always report the actual count.
        const remove = Math.min(welded.getAttribute('position').count - 4, Math.floor((count - options.targetTriangles) / 2))
        geometry = new SimplifyModifier().modify(welded, Math.max(0, remove))
      } finally { welded.dispose() }
    } else {
      geometry = voxelRemesh(source, options.resolution)
    }
  } finally { source.dispose() }
  const afterTriangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
  if (afterTriangles < 4) { geometry.dispose(); throw new Error('Remesh produced no usable surface') }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, beforeTriangles: count, afterTriangles }
}

function voxelRemesh(source: THREE.BufferGeometry, resolution: number): THREE.BufferGeometry {
  if (!Number.isInteger(resolution) || resolution < 8 || resolution > 64) throw new Error('Grid resolution must be an integer from 8 to 64')
  if (!analyzeGeometry(source).watertight) throw new Error('Uniform remesh requires a closed manifold surface')
  source.computeBoundingBox()
  const box = source.boundingBox!
  const size = box.getSize(new THREE.Vector3())
  const step = Math.max(size.x, size.y, size.z) / resolution
  if (!(step > 0)) throw new Error('Mesh has no volume')
  const dims = [size.x, size.y, size.z].map((v) => Math.max(1, Math.ceil(v / step)))
  const [nx, ny, nz] = dims
  const cells = new Uint8Array(nx * ny * nz)
  const index = (x: number, y: number, z: number) => x + nx * (y + ny * z)
  const bvh = new MeshBVH(source)
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(1, 0, 0))
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    ray.origin.set(box.min.x - step, box.min.y + (y + 0.5) * step, box.min.z + (z + 0.5) * step)
    const hits = bvh.raycast(ray, THREE.DoubleSide).map((hit) => hit.distance).sort((a, b) => a - b)
    const crossings = hits.filter((d, i) => i === 0 || d - hits[i - 1] > step * 1e-6)
    let cursor = 0
    for (let x = 0; x < nx; x++) {
      while (cursor < crossings.length && crossings[cursor] < (x + 1.5) * step) cursor++
      if (cursor % 2) cells[index(x, y, z)] = 1
    }
  }
  // Each exposed grid square becomes two equal right triangles. The surface
  // is deliberately stepped, and features smaller than a cell may disappear.
  const faces = [
    { d: [1, 0, 0], c: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
    { d: [-1,0,0], c: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
    { d: [0,1,0], c: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
    { d: [0,-1,0], c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
    { d: [0,0,1], c: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
    { d: [0,0,-1], c: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
  ]
  const output: number[] = []
  const origin = box.min.toArray()
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!cells[index(x, y, z)]) continue
    for (const { d, c } of faces) {
      const adjacent = [x + d[0], y + d[1], z + d[2]]
      if (adjacent.every((v, axis) => v >= 0 && v < dims[axis]) && cells[index(...adjacent as [number, number, number])]) continue
      for (const corner of [0,1,2,0,2,3]) for (let axis = 0; axis < 3; axis++) output.push(origin[axis] + ([x,y,z][axis] + c[corner][axis]) * step)
      if (output.length > 9_000_000) throw new Error('Remesh output exceeds one million triangles; reduce resolution')
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(output, 3))
}

export function remeshGeometryInWorker(geometry: THREE.BufferGeometry, options: RemeshOptions, signal?: AbortSignal): Promise<RemeshResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Remesh cancelled', 'AbortError'))
  const attr = geometry.getAttribute('position')
  if (!attr || attr.itemSize !== 3) return Promise.reject(new Error('Mesh requires three-component positions'))
  const count = geometry.index?.count ?? attr.count
  if (count < 12 || count > 300_000) return Promise.reject(new Error('Remesh requires 4 to 100,000 triangles'))
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const j = geometry.index ? geometry.index.getX(i) : i
    positions.set([attr.getX(j), attr.getY(j), attr.getZ(j)], i * 3)
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./remesh.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Remesh cancelled', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || 'Remesh worker failed')) }
    worker.onmessage = (event: MessageEvent<{ error?: string; positions: Float32Array; beforeTriangles: number; afterTriangles: number }>) => {
      cleanup()
      if (event.data.error) { reject(new Error(event.data.error)); return }
      const result = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(event.data.positions, 3))
      result.computeVertexNormals()
      resolve({ geometry: result, beforeTriangles: event.data.beforeTriangles, afterTriangles: event.data.afterTriangles })
    }
    worker.onmessageerror = () => { cleanup(); reject(new Error('Could not decode remesh worker response')) }
    try {
      worker.postMessage({ positions, options }, [positions.buffer])
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
