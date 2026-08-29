import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { exteriorTriangleFlags, finalizeSolid } from './exteriorShell'
import { analyzeGeometry } from './meshHealth'

function analyzeSoup(soup: Float32Array) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(soup, 3))
  const health = analyzeGeometry(geometry)
  geometry.dispose()
  return health
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

  it('keeps every triangle of a closed surface even without the GPU pass', () => {
    const soup = sphereSoup(32, 10)
    const flags = exteriorTriangleFlags(soup, 128, undefined, false)
    expect(Array.from(flags).every((flag) => flag === 1)).toBe(true)
  })

  it('is at least as conservative without the GPU pass as with it', () => {
    const left = sphereSoup(40, 10)
    const right = new Float32Array(left)
    for (let i = 0; i < right.length; i += 3) right[i] += 8
    const soup = concat(left, right)
    const withGpu = Array.from(exteriorTriangleFlags(soup, 128, undefined, true)).filter((f) => f === 1).length
    const withoutGpu = Array.from(exteriorTriangleFlags(soup, 128, undefined, false)).filter((f) => f === 1).length
    expect(withoutGpu).toBeGreaterThanOrEqual(withGpu)
  })

  it('does not delete more recessed detail as the grid gets finer', () => {
    // Two overlapping spheres: the fraction of the skin kept must not drop
    // when the detection grid is refined (a fixed-voxel dilation would).
    const left = sphereSoup(40, 10)
    const right = new Float32Array(left)
    for (let i = 0; i < right.length; i += 3) right[i] += 8
    const soup = concat(left, right)
    const coarse = Array.from(exteriorTriangleFlags(soup, 96)).filter((f) => f === 1).length
    const fine = Array.from(exteriorTriangleFlags(soup, 160)).filter((f) => f === 1).length
    expect(fine).toBeGreaterThanOrEqual(coarse * 0.98)
  })

  it('strip mode (dilationOverride 1) keeps the skin but trims more than the default', () => {
    const sphere = sphereSoup(32, 10)
    const skinKept = Array.from(exteriorTriangleFlags(sphere, 128, undefined, true, 1)).filter((f) => f === 1).length
    expect(skinKept).toBe(sphere.length / 9) // a closed skin still survives minimal dilation

    const left = sphereSoup(40, 10)
    const right = new Float32Array(left)
    for (let i = 0; i < right.length; i += 3) right[i] += 8
    const soup = concat(left, right)
    const normal = Array.from(exteriorTriangleFlags(soup, 128)).filter((f) => f === 1).length
    const stripped = Array.from(exteriorTriangleFlags(soup, 128, undefined, true, 1)).filter((f) => f === 1).length
    expect(stripped).toBeLessThan(normal)
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

describe('finalizeSolid', () => {
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

  it('leaves an already closed surface watertight without adding caps', () => {
    // Output may shrink: the UV sphere soup contains zero-area pole triangles
    // that finalization drops as degenerate.
    const soup = sphereSoup(24, 10)
    const sealed = finalizeSolid(soup)
    expect(sealed.length).toBeLessThanOrEqual(soup.length)
    expect(analyzeSoup(sealed).watertight).toBe(true)
  })

  it('caps an open box into a watertight solid', () => {
    const soup = openBoxSoup()
    const before = analyzeSoup(soup)
    expect(before.boundaryEdges).toBe(4)
    const sealed = finalizeSolid(soup)
    const health = analyzeSoup(sealed)
    expect(health.boundaryEdges).toBe(0)
    expect(health.watertight).toBe(true)
    // Ear clipping the square opening adds exactly two triangles and no new
    // vertex (a centroid fan would add one).
    expect(sealed.length / 9).toBe(soup.length / 9 + 2)
    expect(health.vertices).toBe(8)
  })

  it('closes a non-planar boundary loop', () => {
    // Two triangles sharing a diagonal, outer edges forming a saddle quad that
    // lies in no single plane: the Newell/ear-clip path must still seal it.
    const soup = new Float32Array([
      0, 0, 0, 2, 0, 1, 2, 2, 0,
      0, 0, 0, 2, 2, 0, 0, 2, 1,
    ])
    expect(analyzeSoup(soup).boundaryEdges).toBe(4)
    expect(analyzeSoup(finalizeSolid(soup)).boundaryEdges).toBe(0)
  })

  it('closes a concave opening with an ear-clip cap', () => {
    // Concave pentagon (vertex D pulled toward the centre) meshed as a fan
    // from an interior point, so the only boundary is the concave rim. A plain
    // centroid fan would leave slivers; ear clipping must still seal it.
    const A = [0, 0, 0]
    const B = [4, 0, 0]
    const C = [4, 4, 0]
    const D = [2, 1.4, 0]
    const E = [0, 4, 0]
    const G = [2, 1.9, 0] // interior point, collinear with no edge
    const tri = (p: number[], q: number[]) => [...G, ...p, ...q]
    const soup = new Float32Array([
      ...tri(A, B), ...tri(B, C), ...tri(C, D), ...tri(D, E), ...tri(E, A),
    ])
    expect(analyzeSoup(soup).boundaryEdges).toBe(5)
    expect(analyzeSoup(finalizeSolid(soup)).boundaryEdges).toBe(0)
  })

  it('welds crack gaps relative to model scale', () => {
    // Same open box scaled up 1000x with float-noise cracks on the rim:
    // welding must scale with the model or the cracks stay open.
    const soup = openBoxSoup()
    const scaled = new Float32Array(soup.length)
    for (let i = 0; i < soup.length; i++) scaled[i] = soup[i] * 1000 + (i % 7 === 0 ? 1e-4 : 0)
    const health = analyzeSoup(finalizeSolid(scaled))
    expect(health.boundaryEdges).toBe(0)
    expect(health.watertight).toBe(true)
  })

  it('snaps crack rims wider than the base weld and still seals', () => {
    // Scale-1000 box with the z=1 face shifted 0.3 units: the gap is far
    // beyond the base weld quantum (~0.017) and only closes via the
    // boundary-vertex snap rounds.
    const soup = openBoxSoup()
    const scaled = new Float32Array(soup.length)
    for (let i = 0; i < soup.length; i++) scaled[i] = soup[i] * 1000
    for (let i = 18; i < 36; i += 3) scaled[i + 2] += 0.3
    const health = analyzeSoup(finalizeSolid(scaled))
    expect(health.boundaryEdges).toBe(0)
    expect(health.watertight).toBe(true)
  })

  it('closes tangled figure-8 boundaries that loop walking cannot chain', () => {
    // 3x3 quad plate with two diagonal quads removed around the shared center
    // vertex: the hole boundary forms a figure-8 through that vertex, and the
    // outer rim is a separate loop. Every boundary edge must end up closed.
    const soup: number[] = []
    const at = (i: number, j: number) => [i * 100, j * 100, 0]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if ((i === 0 && j === 0) || (i === 1 && j === 1)) continue
      soup.push(...quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)))
    }
    const health = analyzeSoup(finalizeSolid(new Float32Array(soup)))
    expect(health.boundaryEdges).toBe(0)
  })

  it('drives boundary edges to zero on a sphere with a large irregular hole', () => {
    // Remove a jagged band of triangles so the opening is neither planar nor a
    // simple loop; terminal closure must still leave no open edge.
    const full = sphereSoup(40, 10)
    const keep: number[] = []
    for (let t = 0; t < full.length / 9; t++) {
      const y = (full[t * 9 + 1] + full[t * 9 + 4] + full[t * 9 + 7]) / 3
      const x = (full[t * 9] + full[t * 9 + 3] + full[t * 9 + 6]) / 3
      if (y > 2 && y < 7 && x > 0 && (t % 3 !== 0)) continue // punch a ragged hole
      keep.push(...full.slice(t * 9, t * 9 + 9))
    }
    const soup = new Float32Array(keep)
    expect(analyzeSoup(soup).boundaryEdges).toBeGreaterThan(10)
    expect(analyzeSoup(finalizeSolid(soup)).boundaryEdges).toBe(0)
  })

  it('removes duplicate double-wall faces that break manifoldness', () => {
    const soup = sphereSoup(24, 10)
    const doubled = new Float32Array(soup.length + 9)
    doubled.set(soup)
    doubled.set(soup.subarray(0, 9), soup.length)
    expect(analyzeSoup(doubled).watertight).toBe(false)
    const health = analyzeSoup(finalizeSolid(doubled))
    expect(health.duplicateFaces).toBe(0)
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
    const health = analyzeSoup(finalizeSolid(filtered))
    expect(health.boundaryEdges).toBe(0)
  })
})
