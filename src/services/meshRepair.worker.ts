import * as THREE from 'three'
import { runStages, type RepairStageId } from './repairStages'

interface InMsg {
  id: number
  meshes: { positions: ArrayBuffer; index: ArrayBuffer | null }[]
  stageIds: RepairStageId[]
}

self.onmessage = (event: MessageEvent<InMsg>) => {
  const { id, meshes, stageIds } = event.data
  const outMeshes: { positions: ArrayBuffer; index: ArrayBuffer | null }[] = []
  const perMesh: unknown[] = []
  const transfer: ArrayBuffer[] = []
  meshes.forEach((m, i) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3))
    if (m.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.index), 1))
    ;(self as unknown as Worker).postMessage({
      type: 'progress', id,
      percent: Math.round((i / meshes.length) * 90),
      phase: `Repairing mesh ${i + 1} of ${meshes.length}`,
    })
    const { geometry, stages } = runStages(g, stageIds)
    const pos = (geometry.index ? geometry.toNonIndexed() : geometry).getAttribute('position')
      .array as Float32Array
    const buf = new Float32Array(pos).buffer
    outMeshes.push({ positions: buf, index: null })
    transfer.push(buf)
    perMesh.push(stages)
    g.dispose()
    geometry.dispose()
  })
  ;(self as unknown as Worker).postMessage({ id, meshes: outMeshes, perMesh }, transfer)
}
