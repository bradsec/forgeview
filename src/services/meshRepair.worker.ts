import * as THREE from 'three'
import { runStages, STAGE_LABEL, type RepairStageId } from './repairStages'

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
    // Progress advances as each stage of this mesh completes so a large
    // single-mesh model does not sit at one number until the seal phase.
    const post = (percent: number, phase: string) =>
      (self as unknown as Worker).postMessage({ type: 'progress', id, percent, phase })
    const { geometry, stages } = runStages(g, stageIds, (doneStages, totalStages, stageId) => {
      const stageFraction = totalStages > 0 ? doneStages / totalStages : 0
      post(
        Math.round(((i + stageFraction) / meshes.length) * 90),
        `Mesh ${i + 1}/${meshes.length}: ${STAGE_LABEL[stageId]}`,
      )
    })
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    const pos = flat.getAttribute('position').array as Float32Array
    const buf = new Float32Array(pos).buffer
    outMeshes.push({ positions: buf, index: null })
    transfer.push(buf)
    perMesh.push(stages)
    if (flat !== geometry) flat.dispose()
    g.dispose()
    geometry.dispose()
  })
  ;(self as unknown as Worker).postMessage({ id, meshes: outMeshes, perMesh }, transfer)
}
