export interface PlaneCutResult {
  partA: Float32Array
  partB: Float32Array
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: PlaneCutResult) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./manifold.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const { id, type } = e.data
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (type === 'result') p.resolve({ partA: e.data.partA, partB: e.data.partB })
      else p.reject(new Error(e.data.message ?? 'Plane cut failed'))
    }
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Plane cut worker crashed'))
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

/** `positions` is a non-indexed world-space triangle soup. The plane keeps
 *  `dot(normal, p) - offset >= 0` for `partA`. */
export function cutByPlane(
  positions: Float32Array,
  normal: [number, number, number],
  offset: number,
): Promise<PlaneCutResult> {
  const id = nextId++
  const buf = positions.slice().buffer
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, positions: buf, normal, offset }, [buf])
  })
}
