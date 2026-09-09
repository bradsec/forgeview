/// <reference lib="webworker" />

import * as THREE from 'three'
import { analyzeGeometry } from './meshHealth'
import { exteriorTriangleFlags, finalizeSolid, protectConnectedSkin } from './exteriorShell'

interface RepairRequest {
  id: number
  positions: ArrayBuffer
  /** Per-triangle GPU visibility flags, or null when WebGL was unavailable. */
  visible: ArrayBuffer | null
  resolution: number
  /** Remove internal walls: keep only GPU-visible or skin-adjacent triangles.
   * Ignored when `visible` is null (no way to tell walls from deep recesses). */
  stripInternalWalls: boolean
}

const scope = self as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<RepairRequest>) => {
  const { id, resolution } = event.data
  const positions = new Float32Array(event.data.positions)
  const visible = event.data.visible ? new Uint8Array(event.data.visible) : null
  const strip = event.data.stripInternalWalls && visible !== null
  const flags = exteriorTriangleFlags(
    positions,
    resolution,
    (percent, phase) => scope.postMessage({ id, type: 'progress', percent, phase }),
    visible !== null,
    strip ? 1 : undefined
  )
  // A triangle survives if the voxel flood can reach it from outside air OR
  // the GPU actually saw it from some direction; visibility rescues detail
  // behind gaps narrower than a detection voxel. In strip mode the flood only
  // marks the outermost skin, so anything deeper must be GPU-visible to survive.
  for (let triangle = 0; triangle < flags.length; triangle++) {
    if (visible && visible[triangle]) flags[triangle] = 1
  }
  // Never tear the skin: regrow any dropped triangle that is part of the same
  // surface sheet as a kept one (shares a manifold edge). Without this the
  // flood punches slits where thin walls meet the skin, which cap into
  // flat-bottomed gashes.
  scope.postMessage({ id, type: 'progress', percent: 95, phase: 'Protecting the outer skin' })
  protectConnectedSkin(positions, flags)
  let kept = 0
  for (let triangle = 0; triangle < flags.length; triangle++) {
    if (flags[triangle]) kept++
  }
  const filtered = new Float32Array(kept * 9)
  let out = 0
  for (let triangle = 0; triangle < flags.length; triangle++) {
    if (!flags[triangle]) continue
    filtered.set(positions.subarray(triangle * 9, triangle * 9 + 9), out)
    out += 9
  }
  scope.postMessage({ id, type: 'progress', percent: 96, phase: 'Welding and sealing openings' })
  const sealed = finalizeSolid(filtered, (phase) => {
    scope.postMessage({ id, type: 'progress', percent: 96, phase })
  })
  scope.postMessage({ id, type: 'progress', percent: 98, phase: 'Checking repaired geometry' })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(sealed, 3))
  geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal').array as Float32Array
  const after = analyzeGeometry(geometry)
  geometry.dispose()
  scope.postMessage(
    { id, type: 'complete', positions: sealed.buffer, normals: normals.buffer, after, resolution, strippedWalls: strip },
    [sealed.buffer, normals.buffer]
  )
}
