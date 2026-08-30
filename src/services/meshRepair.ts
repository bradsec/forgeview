import * as THREE from 'three'
import type { RepairStageId } from './repairStages'
import type { MeshHealth } from './meshHealth'

export interface PerMeshStage { id: RepairStageId; before: MeshHealth; after: MeshHealth; note?: string }

export function runRepairInWorker(
  meshes: THREE.Mesh[],
  stageIds: RepairStageId[],
  onProgress: (percent: number, phase: string) => void,
  signal?: AbortSignal,
): Promise<{ geometries: THREE.BufferGeometry[]; perMesh: PerMeshStage[][] }> {
  if (meshes.length === 0) return Promise.reject(new Error('The scene has no mesh geometry to repair'))
  const payload = meshes.map((mesh) => {
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    const positions = new Float32Array(src.getAttribute('position').array as ArrayLike<number>).buffer
    if (src !== mesh.geometry) src.dispose()
    return { positions, index: null as ArrayBuffer | null }
  })
  const worker = new Worker(new URL('./meshRepair.worker.ts', import.meta.url), { type: 'module' })
  const id = Date.now()
  return new Promise((resolve, reject) => {
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Repair cancelled', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (e) => { cleanup(); reject(new Error(e.message || 'Repair worker failed')) }
    worker.onmessage = (e: MessageEvent) => {
      if (e.data.id !== id) return
      if (e.data.type === 'progress') { onProgress(e.data.percent, e.data.phase); return }
      cleanup()
      const geometries = (e.data.meshes as { positions: ArrayBuffer }[]).map((m) => {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3))
        g.computeVertexNormals()
        return g
      })
      onProgress(100, 'Repair complete')
      resolve({ geometries, perMesh: e.data.perMesh as PerMeshStage[][] })
    }
    worker.postMessage({ id, meshes: payload, stageIds }, payload.map((p) => p.positions))
  })
}
