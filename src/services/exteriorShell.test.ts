import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { exteriorTriangleFlags, sealHoles } from './exteriorShell'
import { analyzeGeometry } from './makeSolid'

function analyzeSoup(soup: Float32Array) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(soup, 3))
  const health = analyzeGeometry(geometry)
  geometry.dispose()
  return health
}

function withCaps(soup: Float32Array): Float32Array {
  const caps = sealHoles(soup)
  const sealed = new Float32Array(soup.length + caps.length)
  sealed.set(soup)
  sealed.set(caps, soup.length)
  return sealed
}

function sphereSoup(segments: number, radius: number): Float32Array {
  const vertices: number[] = []
  const at = (i: number, j: number): [number, number, number] => {
    const theta = (i / segments) * Math.PI
    const phi = (j / segments) * 2 * Math.PI
    return [
      radius * Math.sin(theta) * Math.cos(phi),
      radius * Math.cos(theta),
      radius * Math.sin(theta) * Math.sin(phi),
    ]
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i + 1, j + 1)
      const d = at(i, j + 1)
      vertices.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
  return new Float32Array(vertices)
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

describe('exteriorTriangleFlags', () => {
  it('keeps every triangle of a single closed surface', () => {
    const soup = sphereSoup(32, 10)
    const flags = exteriorTriangleFlags(soup, 96)
    expect(Array.from(flags).every((flag) => flag === 1)).toBe(true)
  })

  it('deletes geometry enclosed inside the model and keeps the outer skin', () => {
    const outer = sphereSoup(32, 10)
    const inner = sphereSoup(32, 5)
    const flags = exteriorTriangleFlags(concat(outer, inner), 96)
    const outerCount = outer.length / 9
    const outerKept = Array.from(flags.subarray(0, outerCount)).filter((flag) => flag === 1).length
    const innerKept = Array.from(flags.subarray(outerCount)).filter((flag) => flag === 1).length
    expect(outerKept).toBe(outerCount)
    expect(innerKept).toBe(0)
  })

  it('keeps both skins of overlapping parts only where they face outside air', () => {
    // Two overlapping spheres: the lens-shaped caps buried inside the other
    // sphere are interior and must be dropped; everything else survives.
    const left = sphereSoup(48, 10)
    const right = new Float32Array(left)
    for (let i = 0; i < right.length; i += 3) right[i] += 8
    const flags = exteriorTriangleFlags(concat(left, right), 128)
    const kept = Array.from(flags).filter((flag) => flag === 1).length
    const total = flags.length
    expect(kept).toBeLessThan(total)
    expect(kept).toBeGreaterThan(total * 0.6)
  })
})

describe('sealHoles', () => {
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d]

  function openBoxSoup(): Float32Array {
    // Unit cube with consistent outward winding, top face missing.
    const [p000, p100, p010, p110, p001, p101, p011, p111] = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ]
    return new Float32Array([
      ...quad(p000, p010, p110, p100), // z=0
      ...quad(p001, p101, p111, p011), // z=1
      ...quad(p000, p100, p101, p001), // y=0
      ...quad(p100, p110, p111, p101), // x=1
      ...quad(p010, p011, p111, p110), // y=1
      // x=0 face omitted: open box
    ])
  }

  it('adds nothing to an already closed surface', () => {
    const soup = sphereSoup(24, 10)
    expect(sealHoles(soup).length).toBe(0)
  })

  it('caps an open box into a watertight solid', () => {
    const soup = openBoxSoup()
    const before = analyzeSoup(soup)
    expect(before.boundaryEdges).toBe(4)
    const sealed = withCaps(soup)
    const health = analyzeSoup(sealed)
    expect(health.boundaryEdges).toBe(0)
    expect(health.watertight).toBe(true)
  })

  it('seals the junction loops left after removing buried faces', () => {
    const left = sphereSoup(48, 10)
    const right = new Float32Array(left)
    for (let i = 0; i < right.length; i += 3) right[i] += 8
    const combined = concat(left, right)
    const flags = exteriorTriangleFlags(combined, 128)
    let kept = 0
    for (const flag of flags) if (flag) kept++
    const filtered = new Float32Array(kept * 9)
    let out = 0
    for (let triangle = 0; triangle < flags.length; triangle++) {
      if (!flags[triangle]) continue
      filtered.set(combined.subarray(triangle * 9, triangle * 9 + 9), out)
      out += 9
    }
    const before = analyzeSoup(filtered)
    expect(before.boundaryEdges).toBeGreaterThan(0)
    const health = analyzeSoup(withCaps(filtered))
    expect(health.boundaryEdges).toBe(0)
  })
})
