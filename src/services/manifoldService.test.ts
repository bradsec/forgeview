import { afterEach, beforeEach, expect, it, vi } from 'vitest'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
}
beforeEach(() => {
  vi.resetModules()
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => vi.unstubAllGlobals())
const request = { operation: 'cut' as const, positions: new Float32Array(9), normal: [1, 0, 0] as [number, number, number], offset: 0 }

it('copies input and reuses the worker after success', async () => {
  const { requestManifold } = await import('./manifoldService')
  const first = requestManifold(request)
  const worker = FakeWorker.instances[0]
  const message = worker.postMessage.mock.calls[0][0]
  expect(message.request.positions).not.toBe(request.positions)
  const result = { partA: new Float32Array(9), partB: new Float32Array(9) }
  worker.onmessage?.({ data: { id: message.id, result } })
  await expect(first).resolves.toBe(result)
  const second = requestManifold(request)
  expect(FakeWorker.instances).toHaveLength(1)
  worker.onmessage?.({ data: { id: worker.postMessage.mock.calls[1][0].id, error: 'Not a solid' } })
  await expect(second).rejects.toThrow('Not a solid')
})
it('rejects an already cancelled request without creating a worker', async () => {
  const { requestManifold } = await import('./manifoldService')
  const controller = new AbortController()
  controller.abort()
  await expect(requestManifold(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(FakeWorker.instances).toHaveLength(0)
})
it('terminates computation on cancellation and recreates the worker', async () => {
  const { requestManifold } = await import('./manifoldService')
  const controller = new AbortController()
  const pending = requestManifold(request, controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  const next = requestManifold(request)
  expect(FakeWorker.instances).toHaveLength(2)
  FakeWorker.instances[1].onerror?.({ message: 'Crash' })
  await expect(next).rejects.toThrow('Crash')
})
it('rejects all pending operations after an unreadable message', async () => {
  const { requestManifold } = await import('./manifoldService')
  const a = requestManifold(request)
  const b = requestManifold(request)
  FakeWorker.instances[0].onmessageerror?.()
  await expect(a).rejects.toThrow('unreadable')
  await expect(b).rejects.toThrow('unreadable')
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
})
