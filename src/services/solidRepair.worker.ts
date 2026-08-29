/// <reference lib="webworker" />

import { exteriorTriangleFlags, finalizeSolid } from './exteriorShell'

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
  let kept = 0
  for (let triangle = 0; triangle < flags.length; triangle++) {
    if (visible && visible[triangle]) flags[triangle] = 1
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
  const sealed = finalizeSolid(filtered)
  scope.postMessage(
    { id, type: 'complete', positions: sealed.buffer, resolution, strippedWalls: strip },
    [sealed.buffer]
  )
}
