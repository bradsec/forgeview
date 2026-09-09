import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { repairGeometriesInWorker } from './solidRepair'
import { analyzeGeometry } from './meshHealth'
import { visibleTriangleFlags } from './visibleTriangles'

vi.mock('./visibleTriangles', () => ({ visibleTriangleFlags: vi.fn(() => null) }))

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { MockWorker.instances.push(this) }
  emit(data: Record<string, unknown>) {
    this.onmessage?.({ data: { id: this.postMessage.mock.calls[0][0].id, ...data } } as MessageEvent)
  }
}

function fixture() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  const positions = new Float32Array(geometry.getAttribute('position').array)
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
  return {
    mesh: new THREE.Mesh(geometry),
    complete: { type: 'complete', positions: positions.buffer, normals: normals.buffer, after: analyzeGeometry(geometry), resolution: 128 },
  }
}

beforeEach(() => {
  MockWorker.instances = []
  vi.stubGlobal('Worker', MockWorker)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('solid repair worker orchestration', () => {
  it('uses worker normals and health without recomputing normals on the UI thread', async () => {
    const { mesh, complete } = fixture()
    const compute = vi.spyOn(THREE.BufferGeometry.prototype, 'computeVertexNormals')
    const progress = vi.fn()
    const promise = repairGeometriesInWorker([mesh], 128, progress)
    const worker = MockWorker.instances[0]
    worker.emit(complete)
    const result = await promise
    expect(result.stats.after).toEqual(complete.after)
    expect(result.geometries[0].getAttribute('normal').array).toEqual(new Float32Array(complete.normals))
    expect(compute).not.toHaveBeenCalled()
    expect(progress).toHaveBeenLastCalledWith(100, 'Solid fill complete')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('rejects before preprocessing when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(repairGeometriesInWorker([fixture().mesh], 128, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(visibleTriangleFlags).not.toHaveBeenCalled()
    expect(MockWorker.instances).toHaveLength(0)
  })

  it('can cancel during the final health-check phase and ignores late completion', async () => {
    const controller = new AbortController()
    const { mesh, complete } = fixture()
    const progress = vi.fn()
    const promise = repairGeometriesInWorker([mesh], 128, progress, controller.signal)
    const worker = MockWorker.instances[0]
    worker.emit({ type: 'progress', percent: 98, phase: 'Checking repaired geometry' })
    controller.abort()
    worker.emit(complete)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(progress).not.toHaveBeenCalledWith(100, expect.anything())
  })

  it('rejects malformed results instead of leaving the repair pending', async () => {
    const promise = repairGeometriesInWorker([fixture().mesh], 128, vi.fn())
    const worker = MockWorker.instances[0]
    worker.emit({ type: 'complete', positions: new Float32Array(9).buffer })
    await expect(promise).rejects.toThrow('Invalid solid fill worker result')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('rejects progress callback exceptions and terminates the worker', async () => {
    const promise = repairGeometriesInWorker([fixture().mesh], 128, (percent) => {
      if (percent === 98) throw new Error('progress failed')
    })
    const worker = MockWorker.instances[0]
    worker.emit({ type: 'progress', percent: 98, phase: 'Checking repaired geometry' })
    await expect(promise).rejects.toThrow('progress failed')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
