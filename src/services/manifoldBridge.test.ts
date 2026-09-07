import { describe, it, expect } from 'vitest'
import { weldSoup, meshToSoup } from './manifoldBridge'

describe('weldSoup', () => {
  it('merges coincident vertices of a two-triangle quad into 4 unique verts', () => {
    // quad (0,0,0)(1,0,0)(1,1,0) + (0,0,0)(1,1,0)(0,1,0): 6 soup verts, 4 unique
    const soup = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0,
      0, 0, 0, 1, 1, 0, 0, 1, 0,
    ])
    const { vertProperties, triVerts } = weldSoup(soup)
    expect(vertProperties.length).toBe(4 * 3)
    expect(triVerts.length).toBe(6)
    // every index is in range and the two shared verts are reused
    expect(Math.max(...triVerts)).toBe(3)
    expect(triVerts[0]).toBe(triVerts[3]) // (0,0,0) shared
    expect(triVerts[2]).toBe(triVerts[4]) // (1,1,0) shared
  })

  it('keeps near-but-not-coincident vertices separate', () => {
    const soup = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0.5, 0.5, 0.5, 2, 0, 0, 0, 2, 0,
    ])
    const { vertProperties } = weldSoup(soup)
    expect(vertProperties.length).toBe(6 * 3) // nothing merged
  })
})

describe('meshToSoup', () => {
  it('expands indexed manifold output back to a flat non-indexed soup', () => {
    const vertProperties = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
    const triVerts = new Uint32Array([0, 1, 2, 0, 2, 3])
    const soup = meshToSoup(vertProperties, triVerts, 3)
    expect(soup.length).toBe(6 * 3)
    expect(Array.from(soup.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0])
    expect(Array.from(soup.slice(9, 18))).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0])
  })

  it('reads only the first 3 of numProp properties per vertex', () => {
    // numProp 5: position + 2 extra floats
    const vertProperties = new Float32Array([1, 2, 3, 9, 9, 4, 5, 6, 9, 9, 7, 8, 9, 9, 9])
    const triVerts = new Uint32Array([0, 1, 2])
    const soup = meshToSoup(vertProperties, triVerts, 5)
    expect(Array.from(soup)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
