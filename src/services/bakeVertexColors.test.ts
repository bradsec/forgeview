import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bakeCornerColors } from './bakeVertexColors'

function triangleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  return geometry
}

describe('bakeCornerColors', () => {
  it('returns null when nothing carries color information', () => {
    const mesh = new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff }))
    expect(bakeCornerColors([mesh])).toBeNull()
  })

  it('bakes flat material colors as sRGB bytes per corner', () => {
    const mesh = new THREE.Mesh(triangleGeometry(), new THREE.MeshStandardMaterial({ color: 0xc83214 }))
    const bytes = bakeCornerColors([mesh])
    expect(bytes).not.toBeNull()
    expect(bytes!.length).toBe(9)
    expect(Array.from(bytes!.subarray(0, 3))).toEqual([0xc8, 0x32, 0x14])
  })

  it('prefers an existing vertex color attribute over the material color', () => {
    const geometry = triangleGeometry()
    // Linear red on every vertex; expect sRGB red bytes out.
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3))
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x00ff00 }))
    const bytes = bakeCornerColors([mesh])
    expect(Array.from(bytes!.subarray(0, 3))).toEqual([255, 0, 0])
  })

  it('follows the index order of indexed geometry', () => {
    const geometry = triangleGeometry()
    geometry.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3))
    geometry.setIndex([2, 1, 0])
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    const bytes = bakeCornerColors([mesh])
    expect(Array.from(bytes!.subarray(0, 3))).toEqual([0, 0, 255])
    expect(Array.from(bytes!.subarray(6, 9))).toEqual([255, 0, 0])
  })
})
