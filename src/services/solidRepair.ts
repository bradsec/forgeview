import * as THREE from 'three'
import { analyzeGeometry, type MeshHealth } from './makeSolid'
import { visibleTriangleFlags } from './visibleTriangles'

export interface SolidRepairStats {
  before: MeshHealth
  after: MeshHealth
  meshes: number
  resolution: number
}

export interface SolidRepairResult {
  geometries: THREE.BufferGeometry[]
  stats: SolidRepairStats
}

function sumHealth(values: MeshHealth[]): MeshHealth {
  return values.reduce((result, value) => ({
    triangles: result.triangles + value.triangles,
    vertices: result.vertices + value.vertices,
    boundaryEdges: result.boundaryEdges + value.boundaryEdges,
    nonManifoldEdges: result.nonManifoldEdges + value.nonManifoldEdges,
    duplicateFaces: result.duplicateFaces + value.duplicateFaces,
    degenerateFaces: result.degenerateFaces + value.degenerateFaces,
    watertight: result.watertight && value.watertight,
  }), { triangles: 0, vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: values.length > 0 })
}

function combinedPositions(meshes: THREE.Mesh[]): Float32Array {
  for (const mesh of meshes) mesh.updateWorldMatrix(true, false)
  const inverseTarget = meshes[0].matrixWorld.clone().invert()
  const sources = meshes.map((mesh) => mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone())
  const total = sources.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0)
  const positions = new Float32Array(total * 3)
  const point = new THREE.Vector3()
  let offset = 0
  sources.forEach((geometry, meshIndex) => {
    const transform = new THREE.Matrix4().multiplyMatrices(inverseTarget, meshes[meshIndex].matrixWorld)
    const attribute = geometry.getAttribute('position')
    for (let index = 0; index < attribute.count; index++) {
      point.fromBufferAttribute(attribute, index).applyMatrix4(transform)
      positions[offset++] = point.x
      positions[offset++] = point.y
      positions[offset++] = point.z
    }
    geometry.dispose()
  })
  return positions
}

/**
 * Solid fill: classify every triangle of the combined scene against the
 * outside air (in a worker) and keep only the exterior ones, byte-identical
 * to the input. Enclosed cavity walls and faces hidden inside overlapping
 * parts are deleted, so the model becomes one filled STL-style solid whose
 * outer appearance is unchanged while triangle and vertex counts drop.
 */
export function repairGeometriesInWorker(
  meshes: THREE.Mesh[],
  resolution: number,
  onProgress: (percent: number, phase: string) => void,
  signal?: AbortSignal
): Promise<SolidRepairResult> {
  if (meshes.length === 0) return Promise.reject(new Error('The scene has no mesh geometry to repair'))
  const before = sumHealth(meshes.map((mesh) => analyzeGeometry(mesh.geometry)))
  onProgress(1, 'Combining scene as triangle soup')
  const positions = combinedPositions(meshes)
  // GPU visibility protects surfaces behind gaps narrower than a detection
  // voxel; without WebGL the voxel classification stands alone.
  onProgress(2, 'Checking outside visibility')
  const visible = visibleTriangleFlags(positions, (fraction) =>
    onProgress(2 + Math.round(fraction * 3), 'Checking outside visibility')
  )
  const worker = new Worker(new URL('./solidRepair.worker.ts', import.meta.url), { type: 'module' })
  const id = Date.now()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Repair cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event.message || 'Solid fill worker failed'))
    }
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.id !== id) return
      if (event.data.type === 'progress') {
        onProgress(event.data.percent, event.data.phase)
        return
      }
      cleanup()
      const sealed = new Float32Array(event.data.positions)
      if (sealed.length === 0) {
        reject(new Error('Solid fill found no exterior surface to keep'))
        return
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(sealed, 3))
      geometry.computeVertexNormals()
      const after = analyzeGeometry(geometry)
      const geometries = [geometry, ...meshes.slice(1).map(() => new THREE.BufferGeometry())]
      onProgress(100, 'Solid fill complete')
      resolve({ geometries, stats: { before, after, meshes: meshes.length, resolution: event.data.resolution } })
    }
    const transfer: ArrayBuffer[] = [positions.buffer as ArrayBuffer]
    if (visible) transfer.push(visible.buffer as ArrayBuffer)
    worker.postMessage({ id, positions: positions.buffer, visible: visible?.buffer ?? null, resolution }, transfer)
  })
}
