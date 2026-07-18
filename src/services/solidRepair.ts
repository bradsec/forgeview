import * as THREE from 'three'
import { analyzeGeometry, type MeshHealth } from './makeSolid'

export interface SolidRepairStats {
  before: MeshHealth
  after: MeshHealth
  meshes: number
  shellsRemoved: number
}

export interface SolidRepairResult {
  geometries: THREE.BufferGeometry[]
  stats: SolidRepairStats
}

interface GeometryGroup {
  start: number
  count: number
  materialIndex?: number
}

function sumHealth(values: MeshHealth[]): MeshHealth {
  const sum = values.reduce((result, value) => ({
    triangles: result.triangles + value.triangles,
    vertices: result.vertices + value.vertices,
    boundaryEdges: result.boundaryEdges + value.boundaryEdges,
    nonManifoldEdges: result.nonManifoldEdges + value.nonManifoldEdges,
    duplicateFaces: result.duplicateFaces + value.duplicateFaces,
    degenerateFaces: result.degenerateFaces + value.degenerateFaces,
    watertight: result.watertight && value.watertight,
  }), { triangles: 0, vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0, duplicateFaces: 0, degenerateFaces: 0, watertight: values.length > 0 })
  return sum
}

export function repairGeometriesInWorker(
  geometries: THREE.BufferGeometry[],
  onProgress: (percent: number, phase: string) => void,
  signal?: AbortSignal
): Promise<SolidRepairResult> {
  if (geometries.length === 0) return Promise.reject(new Error('The scene has no mesh geometry to repair'))
  const sources = geometries.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry.clone())
  const before = sumHealth(sources.map(analyzeGeometry))
  const workerGeometries = sources.map((geometry) => {
    const position = geometry.getAttribute('position')
    return {
      positions: new Float32Array(position.array as ArrayLike<number>).buffer,
      groups: geometry.groups.map((group) => ({ ...group })),
    }
  })
  const worker = new Worker(new URL('./solidRepair.worker.ts', import.meta.url), { type: 'module' })
  const id = Date.now()
  onProgress(5, 'Preparing geometry')
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      for (const source of sources) source.dispose()
      reject(new DOMException('Repair cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      cleanup()
      for (const source of sources) source.dispose()
      reject(new Error(event.message || 'Mesh repair worker failed'))
    }
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.id !== id) return
      if (event.data.type === 'progress') {
        const completed = event.data.completed as number
        onProgress(10 + Math.round((completed / geometries.length) * 80), `Repairing mesh ${completed + 1} of ${geometries.length}`)
        return
      }
      const results = event.data.results as Array<{ index: ArrayBuffer; groups: GeometryGroup[]; health: MeshHealth; shellsRemoved: number }>
      const repaired = sources.map((source, index) => {
        source.setIndex(new THREE.BufferAttribute(new Uint32Array(results[index].index), 1))
        source.clearGroups()
        for (const group of results[index].groups) source.addGroup(group.start, group.count, group.materialIndex ?? 0)
        return source
      })
      cleanup()
      onProgress(100, 'Repair complete')
      resolve({
        geometries: repaired,
        stats: {
          before,
          after: sumHealth(results.map((result) => result.health)),
          meshes: repaired.length,
          shellsRemoved: results.reduce((sum, result) => sum + result.shellsRemoved, 0),
        },
      })
    }
    worker.postMessage({ id, geometries: workerGeometries }, workerGeometries.map((geometry) => geometry.positions))
  })
}
