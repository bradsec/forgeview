import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  buildMeasureOverlay,
  setMeasurePoint,
  measureDistance,
  pickSurfacePoint,
  disposeMeasureOverlay,
} from './measureOverlay'

describe('measureOverlay', () => {
  it('builds a tagged group with hidden markers and line', () => {
    const ov = buildMeasureOverlay(0.5)
    expect(ov.group.userData.measureOverlay).toBe(true)
    expect(ov.markerA.visible).toBe(false)
    expect(ov.markerB.visible).toBe(false)
    expect(ov.line.visible).toBe(false)
  })

  it('places A, then B, then restarts on the third point', () => {
    const ov = buildMeasureOverlay(0.5)
    expect(setMeasurePoint(ov, new THREE.Vector3(0, 0, 0))).toBe('A')
    expect(ov.markerA.visible).toBe(true)
    expect(setMeasurePoint(ov, new THREE.Vector3(3, 4, 0))).toBe('B')
    expect(ov.line.visible).toBe(true)
    expect(measureDistance(ov, 1)).toBeCloseTo(5)
    expect(measureDistance(ov, 10)).toBeCloseTo(50)
    expect(setMeasurePoint(ov, new THREE.Vector3(9, 9, 9))).toBe('reset')
    expect(ov.pointB).toBeNull()
    expect(ov.line.visible).toBe(false)
    expect(measureDistance(ov, 1)).toBeNull()
  })

  it('picks the nearest surface hit', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    mesh.updateMatrixWorld(true)
    const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    const p = pickSurfacePoint([mesh], rc)
    expect(p).not.toBeNull()
    expect(p!.z).toBeCloseTo(1)
    const miss = new THREE.Raycaster(new THREE.Vector3(10, 10, 5), new THREE.Vector3(0, 0, -1))
    expect(pickSurfacePoint([mesh], miss)).toBeNull()
  })

  it('dispose detaches the group', () => {
    const scene = new THREE.Scene()
    const ov = buildMeasureOverlay(0.5)
    scene.add(ov.group)
    disposeMeasureOverlay(ov)
    expect(ov.group.parent).toBeNull()
  })
})
