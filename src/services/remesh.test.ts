import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { remeshGeometry, remeshGeometryInWorker } from './remesh'
import { analyzeGeometry } from './meshHealth'

describe('remeshGeometry', () => {
  it('remeshes a closed surface above the former 100,000 triangle limit', async () => {
    const input = new THREE.BoxGeometry(8, 8, 8, 100, 100, 100)
    const result = await remeshGeometry(input, { operation: 'remesh', resolution: 8 })
    expect(result.beforeTriangles).toBe(120_000)
    expect(result.afterTriangles).toBe(768)
    expect(analyzeGeometry(result.geometry).watertight).toBe(true)
    expect(input.index!.count / 3).toBe(120_000)
    input.dispose()
    result.geometry.dispose()
  })
  it('reduces real sphere geometry and preserves the source', async () => {
    const input = new THREE.SphereGeometry(10, 16, 12)
    const original = input.getAttribute('position').array.slice()
    const result = await remeshGeometry(input, { operation: 'decimate', targetTriangles: 100 })
    expect(result.afterTriangles).toBeLessThan(result.beforeTriangles)
    expect(result.afterTriangles).toBeGreaterThanOrEqual(4)
    expect(input.getAttribute('position').array).toEqual(original)
    expect([...result.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true)
  })
  it('creates a closed uniform grid surface with outward winding', async () => {
    const result = await remeshGeometry(new THREE.BoxGeometry(8, 8, 8), { operation: 'remesh', resolution: 8 })
    expect(result.afterTriangles).toBe(6 * 8 * 8 * 2)
    expect(analyzeGeometry(result.geometry).watertight).toBe(true)
    expect(result.geometry.boundingBox!.min.toArray()).toEqual([-4, -4, -4])
    expect(result.geometry.boundingBox!.max.toArray()).toEqual([4, 4, 4])
    const p = result.geometry.getAttribute('position')
    const n = result.geometry.getAttribute('normal')
    for (let i = 0; i < p.count; i++) expect(new THREE.Vector3().fromBufferAttribute(p, i).dot(new THREE.Vector3().fromBufferAttribute(n, i))).toBeGreaterThan(0)
  })
  it('rejects open surfaces and invalid settings', async () => {
    await expect(remeshGeometry(new THREE.PlaneGeometry(8, 8, 2, 2), { operation: 'remesh', resolution: 8 })).rejects.toThrow('closed manifold')
    await expect(remeshGeometry(new THREE.BoxGeometry(), { operation: 'remesh', resolution: 100 })).rejects.toThrow('8 to 64')
    await expect(remeshGeometry(new THREE.BoxGeometry(), { operation: 'decimate', targetTriangles: 13 })).rejects.toThrow('Target')
  })
  it('honors cancellation before allocating a worker', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(remeshGeometryInWorker(new THREE.BoxGeometry(), { operation: 'remesh', resolution: 8 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})


describe('remesh worker lifecycle', () => {
  it('rejects malformed worker output instead of leaving the operation pending', async () => {
    const terminate = vi.fn()
    class MalformedWorker {
      terminate = terminate
      onmessage?: (event: { data: object }) => void
      postMessage() { this.onmessage?.({ data: { positions: new Float32Array(36) } }) }
    }
    vi.stubGlobal('Worker', MalformedWorker)
    try {
      await expect(remeshGeometryInWorker(new THREE.BoxGeometry(), { operation: 'remesh', resolution: 8 })).rejects.toThrow('Invalid remesh worker response')
      expect(terminate).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
  it('terminates the worker when posting input fails', async () => {
    const terminate = vi.fn()
    class FailedWorker {
      terminate = terminate
      postMessage() { throw new Error('Transfer failed') }
    }
    vi.stubGlobal('Worker', FailedWorker)
    try {
      await expect(remeshGeometryInWorker(new THREE.BoxGeometry(), { operation: 'remesh', resolution: 8 })).rejects.toThrow('Transfer failed')
      expect(terminate).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
  it('terminates an active worker on cancellation', async () => {
    const terminate = vi.fn()
    class PendingWorker {
      terminate = terminate
      postMessage() {}
    }
    vi.stubGlobal('Worker', PendingWorker)
    try {
      const controller = new AbortController()
      const pending = remeshGeometryInWorker(new THREE.BoxGeometry(), { operation: 'remesh', resolution: 8 }, controller.signal)
      controller.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect(terminate).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
  it('rejects missing positions without constructing a worker', async () => {
    await expect(remeshGeometryInWorker(new THREE.BufferGeometry(), { operation: 'remesh', resolution: 8 })).rejects.toThrow('three-component positions')
  })
})
