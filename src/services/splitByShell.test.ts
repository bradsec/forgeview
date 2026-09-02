import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { splitByShell } from './splitByShell'
import { analyzeGeometry } from './meshHealth'

/** N unit cubes as one non-indexed mesh, each offset +4 on X from the last */
function cubes(n: number): THREE.BufferGeometry {
  const unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
  const out = new Float32Array(unit.length * n)
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < unit.length; i += 3) {
      out[k * unit.length + i] = unit[i] + k * 4
      out[k * unit.length + i + 1] = unit[i + 1]
      out[k * unit.length + i + 2] = unit[i + 2]
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(out, 3))
  return g
}

/** subdivided cube plus a 2-triangle speck far away */
function cubePlusSpeck(): THREE.BufferGeometry {
  const cube = new THREE.BoxGeometry(1, 1, 1, 20, 20, 20).toNonIndexed().getAttribute('position').array as Float32Array
  const speck = new Float32Array([
    50, 50, 50, 51, 50, 50, 50, 51, 50,
    51, 50, 50, 51, 51, 50, 50, 51, 50,
  ])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...cube, ...speck]), 3))
  return g
}

describe('splitByShell', () => {
  it('splits two separated cubes into two parts of equal size', () => {
    const src = cubes(2)
    const { parts, droppedFragments, droppedTriangles } = splitByShell(src)
    expect(parts.length).toBe(2)
    expect(droppedFragments).toBe(0)
    expect(droppedTriangles).toBe(0)
    const t0 = analyzeGeometry(parts[0]).triangles
    const t1 = analyzeGeometry(parts[1]).triangles
    expect(t0).toBe(12)
    expect(t1).toBe(12)
    // input untouched
    expect(src.getAttribute('position').count).toBe(72)
  })

  it('drops a sub-threshold speck and keeps the cube', () => {
    const { parts, droppedFragments, droppedTriangles } = splitByShell(cubePlusSpeck())
    expect(parts.length).toBe(1)
    expect(analyzeGeometry(parts[0]).triangles).toBe(4800)
    expect(droppedFragments).toBe(1)
    expect(droppedTriangles).toBe(2)
  })

  it('returns a single part for one connected shell', () => {
    const { parts, droppedFragments } = splitByShell(new THREE.BoxGeometry(1, 1, 1))
    expect(parts.length).toBe(1)
    expect(droppedFragments).toBe(0)
  })

  it('orders parts largest first', () => {
    // subdivided cube (192 tris) and plain cube (12 tris), no speck
    const subdivided = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4).toNonIndexed().getAttribute('position').array as Float32Array
    const plain = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
    const plainOffset = new Float32Array(plain.length)
    for (let i = 0; i < plain.length; i += 3) { plainOffset[i] = plain[i] + 20; plainOffset[i + 1] = plain[i + 1]; plainOffset[i + 2] = plain[i + 2] }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...subdivided, ...plainOffset]), 3))
    const { parts, droppedFragments } = splitByShell(g)
    expect(parts.length).toBe(2)
    expect(droppedFragments).toBe(0)
    const t0 = analyzeGeometry(parts[0]).triangles
    const t1 = analyzeGeometry(parts[1]).triangles
    expect(t0).toBe(192)
    expect(t1).toBe(12)
    expect(t0).toBeGreaterThan(t1)
  })
})
