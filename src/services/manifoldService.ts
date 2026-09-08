import type { ManifoldRequest, ManifoldResult } from './manifoldTypes'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (result: ManifoldResult) => void; reject: (error: Error) => void; cleanup: () => void }>()

function stop(error: Error) {
  worker?.terminate()
  worker = null
  for (const entry of pending.values()) {
    entry.cleanup()
    entry.reject(error)
  }
  pending.clear()
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./manifold.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ id: number; result: ManifoldResult; error?: string }>) => {
      const entry = pending.get(event.data.id)
      if (!entry) return
      pending.delete(event.data.id)
      entry.cleanup()
      if (event.data.error) entry.reject(new Error(event.data.error))
      else entry.resolve(event.data.result)
    }
    worker.onerror = event => stop(new Error(event.message || 'Solid operation worker crashed'))
    worker.onmessageerror = () => stop(new Error('Solid operation worker returned an unreadable message'))
  }
  return worker
}

/** Cancelling terminates WASM execution and cancels any queued operations too. */
export function requestManifold(request: ManifoldRequest, signal?: AbortSignal): Promise<ManifoldResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Solid operation cancelled', 'AbortError'))
  return new Promise((resolve, reject) => {
    const id = nextId++
    const abort = () => stop(new DOMException('Solid operation cancelled', 'AbortError'))
    const cleanup = () => signal?.removeEventListener('abort', abort)
    pending.set(id, { resolve, reject, cleanup })
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const positions = request.positions.slice()
      const copy = !('other' in request) ? { ...request, positions } : { ...request, positions, other: request.other.slice() }
      const transfer = !('other' in copy) ? [positions.buffer] : [positions.buffer, copy.other.buffer]
      getWorker().postMessage({ id, request: copy }, transfer)
    } catch (error) {
      pending.delete(id)
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
