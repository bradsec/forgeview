import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { geometryFromWorld, requireEditable, worldPositions } from './editGeometry'

describe('static edit coordinates', () => {
  it('round trips mirrored transformed geometry without changing its winding', () => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3))
    const mesh = new THREE.Mesh(g)
    mesh.position.set(5, 6, 7)
    mesh.scale.x = -2
    const world = worldPositions(mesh)
    expect([...world]).toEqual([5,6,7, 5,7,7, 3,6,7])
    expect([...geometryFromWorld(world, mesh).getAttribute('position').array]).toEqual([...g.getAttribute('position').array])
  })
  it('rejects attributes that cannot survive position-only replacement', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry())
    expect(() => requireEditable([mesh])).toThrow('static, untextured')
    expect(() => geometryFromWorld(new Float32Array([NaN, 0, 0]))).toThrow('Invalid geometry result')
  })
})
