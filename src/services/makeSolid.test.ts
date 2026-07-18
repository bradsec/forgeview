import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { makeSolidGeometry, splitIntoShells } from './makeSolid'

function mergedBoxes(sizes: number[], offsets: THREE.Vector3[]): THREE.BufferGeometry {
  const positions: number[] = []
  sizes.forEach((size, i) => {
    const box = new THREE.BoxGeometry(size, size, size).toNonIndexed()
    box.translate(offsets[i].x, offsets[i].y, offsets[i].z)
    const pos = box.getAttribute('position')
    for (let c = 0; c < pos.count; c++) {
      positions.push(pos.getX(c), pos.getY(c), pos.getZ(c))
    }
    box.dispose()
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  return geometry
}

const origin = new THREE.Vector3(0, 0, 0)

describe('splitIntoShells', () => {
  it('finds a single shell in one box', () => {
    const geo = mergedBoxes([10], [origin])
    expect(splitIntoShells(geo)).toHaveLength(1)
  })

  it('finds two shells in nested boxes', () => {
    const geo = mergedBoxes([10, 4], [origin, origin])
    const shells = splitIntoShells(geo)
    expect(shells).toHaveLength(2)
    expect(shells.map((s) => s.triangleCount)).toEqual([12, 12])
  })
})

describe('makeSolidGeometry', () => {
  it('keeps a single-shell model unchanged', () => {
    const geo = mergedBoxes([10], [origin])
    const result = makeSolidGeometry(geo)
    expect(result.shellsKept).toBe(1)
    expect(result.shellsRemoved).toBe(0)
    expect(result.geometry.getAttribute('position').count).toBe(36)
  })

  it('removes a cavity shell nested inside the outer shell', () => {
    const geo = mergedBoxes([10, 4], [origin, origin])
    const result = makeSolidGeometry(geo)
    expect(result.shellsRemoved).toBe(1)
    expect(result.shellsKept).toBe(1)
    // Outer box triangles survive intact: 12 tris * 3 verts
    expect(result.geometry.getAttribute('position').count).toBe(36)
    const box = new THREE.Box3().setFromBufferAttribute(
      result.geometry.getAttribute('position') as THREE.BufferAttribute
    )
    expect(box.max.x).toBeCloseTo(5)
    expect(box.min.x).toBeCloseTo(-5)
  })

  it('removes an island nested inside a cavity (depth 2)', () => {
    const geo = mergedBoxes([10, 6, 2], [origin, origin, origin])
    const result = makeSolidGeometry(geo)
    expect(result.shellsRemoved).toBe(2)
    expect(result.shellsKept).toBe(1)
  })

  it('keeps side-by-side shells that do not enclose each other', () => {
    const geo = mergedBoxes([2, 2], [new THREE.Vector3(-3, 0, 0), new THREE.Vector3(3, 0, 0)])
    const result = makeSolidGeometry(geo)
    expect(result.shellsRemoved).toBe(0)
    expect(result.shellsKept).toBe(2)
    expect(result.geometry.getAttribute('position').count).toBe(72)
  })

  it('handles indexed input geometry', () => {
    const outer = new THREE.BoxGeometry(10, 10, 10) // indexed
    const result = makeSolidGeometry(outer)
    expect(result.shellsKept).toBe(1)
  })
})
