/// <reference lib="webworker" />
import * as THREE from 'three'
import { analyzeGeometry, makeSolidGeometry } from './makeSolid'

interface RepairRequest {
  id: number
  geometries: Array<{ positions: ArrayBuffer; groups: GeometryGroup[] }>
}

interface GeometryGroup {
  start: number
  count: number
  materialIndex?: number
}

const scope = self as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<RepairRequest>) => {
  const { id, geometries } = event.data
  const results: Array<{ index: ArrayBuffer; groups: GeometryGroup[]; health: ReturnType<typeof analyzeGeometry>; shellsRemoved: number }> = []
  const transfers: Transferable[] = []
  for (let meshIndex = 0; meshIndex < geometries.length; meshIndex++) {
    scope.postMessage({ id, type: 'progress', completed: meshIndex, total: geometries.length })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(geometries[meshIndex].positions), 3))
    for (const group of geometries[meshIndex].groups) geometry.addGroup(group.start, group.count, group.materialIndex ?? 0)
    const repaired = makeSolidGeometry(geometry)
    const index = new Uint32Array(repaired.geometry.index?.array ?? [])
    results.push({
      index: index.buffer,
      groups: repaired.geometry.groups.map((group) => ({ ...group })),
      health: analyzeGeometry(repaired.geometry),
      shellsRemoved: repaired.shellsRemoved,
    })
    transfers.push(index.buffer)
    repaired.geometry.dispose()
    geometry.dispose()
  }
  scope.postMessage({ id, type: 'complete', results }, transfers)
}
