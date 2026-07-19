/// <reference lib="webworker" />

import { exteriorTriangleFlags, finalizeSolid } from './exteriorShell'

interface RepairRequest {
  id: number
  positions: ArrayBuffer
  colors: ArrayBuffer | null
  resolution: number
}

const scope = self as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<RepairRequest>) => {
  const { id, resolution } = event.data
  const positions = new Float32Array(event.data.positions)
  const colors = event.data.colors ? new Uint8Array(event.data.colors) : null
  const flags = exteriorTriangleFlags(positions, resolution, (percent, phase) =>
    scope.postMessage({ id, type: 'progress', percent, phase })
  )
  let kept = 0
  for (let triangle = 0; triangle < flags.length; triangle++) if (flags[triangle]) kept++
  const filtered = new Float32Array(kept * 9)
  const filteredColors = colors ? new Uint8Array(kept * 9) : null
  let out = 0
  for (let triangle = 0; triangle < flags.length; triangle++) {
    if (!flags[triangle]) continue
    filtered.set(positions.subarray(triangle * 9, triangle * 9 + 9), out)
    if (colors && filteredColors) filteredColors.set(colors.subarray(triangle * 9, triangle * 9 + 9), out)
    out += 9
  }
  scope.postMessage({ id, type: 'progress', percent: 96, phase: 'Welding and sealing openings' })
  const sealed = finalizeSolid(filtered, filteredColors)
  const transfer: ArrayBuffer[] = [sealed.positions.buffer as ArrayBuffer]
  if (sealed.colors) transfer.push(sealed.colors.buffer as ArrayBuffer)
  scope.postMessage(
    { id, type: 'complete', positions: sealed.positions.buffer, colors: sealed.colors?.buffer ?? null, resolution },
    transfer
  )
}
