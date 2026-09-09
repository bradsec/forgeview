import * as THREE from 'three'
import { analyzeGeometry, type MeshHealth } from './meshHealth'
import { visibleTriangleFlags } from './visibleTriangles'

export interface SolidRepairStats {
  before: MeshHealth
  after: MeshHealth
  meshes: number
  resolution: number
  /** False when WebGL was unavailable and only the voxel air-flood ran, which
   * trims recessed surfaces behind gaps narrower than a detection voxel. */
  gpuAssisted: boolean
  /** True when internal-wall removal was requested and actually ran. Requested
   * but false means WebGL was unavailable, so it was skipped. */
  strippedWalls: boolean
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
export async function repairGeometriesInWorker(
  meshes: THREE.Mesh[],
  resolution: number,
  onProgress: (percent: number, phase: string) => void,
  signal?: AbortSignal,
  options?: { stripInternalWalls?: boolean; renderer?: THREE.WebGLRenderer | null }
): Promise<SolidRepairResult> {
  signal?.throwIfAborted()
  if (meshes.length === 0) return Promise.reject(new Error('The scene has no mesh geometry to repair'))
  const before = sumHealth(meshes.map((mesh) => analyzeGeometry(mesh.geometry)))
  onProgress(1, 'Combining scene as triangle soup')
  const positions = combinedPositions(meshes)
  // GPU visibility protects surfaces behind gaps narrower than a detection
  // voxel; it runs on the viewer's own renderer so it never evicts the
  // viewport's WebGL context. Without a renderer the voxel classification
  // stands alone.
  onProgress(2, 'Checking outside visibility')
  const visible = visibleTriangleFlags(
    positions,
    (fraction) => onProgress(2 + Math.round(fraction * 3), 'Checking outside visibility'),
    options?.renderer
  )
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./solidRepair.worker.ts', import.meta.url), { type: 'module' })
  const id = Date.now()
  return new Promise((resolve, reject) => {
    let settled = false
    let geometry: THREE.BufferGeometry | undefined
    const cleanup = () => {
      settled = true
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      cleanup()
      geometry?.dispose()
      reject(error)
    }
    const abort = () => fail(new DOMException('Repair cancelled', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => fail(new Error(event.message || 'Solid fill worker failed'))
    worker.onmessageerror = () => fail(new Error('Could not read solid fill worker result'))
    worker.onmessage = (event: MessageEvent) => {
      if (settled || event.data.id !== id) return
      try {
        signal?.throwIfAborted()
        if (event.data.type === 'progress') {
          onProgress(event.data.percent, event.data.phase)
          return
        }
        if (event.data.type !== 'complete') throw new Error('Unexpected solid fill worker response')
        const sealed = new Float32Array(event.data.positions)
        const normals = new Float32Array(event.data.normals)
        if (sealed.length === 0) throw new Error('Solid fill found no exterior surface to keep')
        if (sealed.length % 9 !== 0 || normals.length !== sealed.length || !event.data.after) {
          throw new Error('Invalid solid fill worker result')
        }
        geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(sealed, 3))
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
        onProgress(100, 'Solid fill complete')
        if (settled) return
        signal?.throwIfAborted()
        const geometries = [geometry, ...meshes.slice(1).map(() => new THREE.BufferGeometry())]
        cleanup()
        resolve({
          geometries,
          stats: {
            before,
            after: event.data.after,
            meshes: meshes.length,
            resolution: event.data.resolution,
            gpuAssisted: visible !== null,
            strippedWalls: event.data.strippedWalls === true,
          },
        })
      } catch (error) {
        fail(error)
      }
    }
    const transfer: ArrayBuffer[] = [positions.buffer as ArrayBuffer]
    if (visible) transfer.push(visible.buffer as ArrayBuffer)
    try {
      worker.postMessage(
        {
          id,
          positions: positions.buffer,
          visible: visible?.buffer ?? null,
          resolution,
          stripInternalWalls: options?.stripInternalWalls === true,
        },
        transfer
      )
    } catch (error) {
      fail(error)
    }
  })
}
