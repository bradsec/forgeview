import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { decimateGeometry } from './decimate'

describe('decimateGeometry', () => {
  it('reduces a mesh above 100,000 triangles and preserves indexed source buffers', async () => {
    const input = new THREE.SphereGeometry(10, 320, 200)
    const positions = input.getAttribute('position').array.slice()
    const indices = input.index!.array.slice()
    const output = await decimateGeometry(input, 10_000)
    expect(input.index!.count / 3).toBeGreaterThan(100_000)
    expect(output.index!.count / 3).toBeLessThanOrEqual(10_000)
    expect(output.index!.count / 3).toBeGreaterThanOrEqual(9_900)
    expect(output.getAttribute('position').count).toBeLessThan(input.getAttribute('position').count)
    expect(output.getAttribute('position').array.every(Number.isFinite)).toBe(true)
    expect(input.getAttribute('position').array).toEqual(positions)
    expect(input.index!.array).toEqual(indices)
  })

  it('reduces a million-triangle model', async () => {
    const input = new THREE.SphereGeometry(10, 1024, 512)
    const output = await decimateGeometry(input, 100_000)
    expect(input.index!.count / 3).toBeGreaterThan(1_000_000)
    expect(output.index!.count / 3).toBeLessThanOrEqual(100_000)
    expect(output.index!.count / 3).toBeGreaterThanOrEqual(99_900)
    expect(output.getAttribute('position').array.every(Number.isFinite)).toBe(true)
  }, 15_000)

  it('welds triangle soup before simplification', async () => {
    const input = new THREE.SphereGeometry(10, 40, 30).toNonIndexed()
    const output = await decimateGeometry(input, 100)
    expect(output.index!.count / 3).toBeLessThanOrEqual(100)
    expect(output.index!.count / 3).toBeGreaterThanOrEqual(4)
    const vertexCount = output.getAttribute('position').count
    expect(output.index!.array.every((index) => index < vertexCount)).toBe(true)
    expect(input.index).toBeNull()
  })

  it('rejects malformed inputs and invalid targets', async () => {
    await expect(decimateGeometry(new THREE.BufferGeometry(), 4)).rejects.toThrow('positions')
    const input = new THREE.BoxGeometry()
    await expect(decimateGeometry(input, 3)).rejects.toThrow('Target')
    await expect(decimateGeometry(input, 13)).rejects.toThrow('Target')
    input.index!.setX(0, 999)
    await expect(decimateGeometry(input, 4)).rejects.toThrow('invalid vertex index')
    input.index!.setX(0, 0)
    input.getAttribute('position').setX(0, Infinity)
    await expect(decimateGeometry(input, 4)).rejects.toThrow('non-finite')
  })
})
