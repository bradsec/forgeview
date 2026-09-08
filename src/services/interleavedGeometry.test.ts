import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { parseModelBuffer } from '../loaders'
import { dropDuplicateFaces } from './repairStages'
import { buildOverhangOverlay, disposeOverhangOverlay } from './overhangOverlay'
import { buildWallThicknessOverlay, disposeWallThicknessOverlay } from './wallThicknessOverlay'

async function interleavedMesh(): Promise<THREE.Mesh> {
  const data = new Float32Array([
    0, -1, 0, 0, 0, 0,
    0, -1, 0, 1, 0, 0,
    0, -1, 0, 1, 0, 1,
  ])
  const uri = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...new Uint8Array(data.buffer)))}`
  const document = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: data.byteLength, uri }],
    bufferViews: [{ buffer: 0, byteLength: data.byteLength, byteStride: 24 }],
    accessors: [
      { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 0, 1] },
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }
  const bytes = new Uint8Array(new TextEncoder().encode(JSON.stringify(document)))
  const scene = await parseModelBuffer(bytes.buffer, '.gltf')
  return scene.children[0] as THREE.Mesh
}

describe('interleaved glTF geometry', () => {
  it('repairs without turning normals into extra vertices', async () => {
    const mesh = await interleavedMesh()
    expect(mesh.geometry.getAttribute('position')).toBeInstanceOf(THREE.InterleavedBufferAttribute)
    const result = dropDuplicateFaces(mesh.geometry)

    expect([...result.geometry.getAttribute('position').array]).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 1])
    expect(mesh.geometry.getAttribute('normal').getY(0)).toBe(-1)
  })

  it('highlights all three vertices of an interleaved overhang', async () => {
    const mesh = await interleavedMesh()
    const result = buildOverhangOverlay([mesh], 45, () => true)
    const geometry = (result.group.children[0] as THREE.Mesh).geometry
    const colors = geometry.getAttribute('color')
    const highlight = new THREE.Color(0xff3b30)

    expect(colors.count).toBe(3)
    for (let index = 0; index < 3; index++) {
      expect(colors.getX(index)).toBeCloseTo(highlight.r)
      expect(colors.getY(index)).toBeCloseTo(highlight.g)
      expect(colors.getZ(index)).toBeCloseTo(highlight.b)
    }
    disposeOverhangOverlay(result.group)
  })

  it('counts only the real open face in wall analysis', async () => {
    const mesh = await interleavedMesh()
    const result = buildWallThicknessOverlay([mesh], 1, 1, () => true)
    const geometry = (result.group.children[0] as THREE.Mesh).geometry

    expect(result.unsampledFaces).toBe(1)
    expect(geometry.getAttribute('color').count).toBe(3)
    disposeWallThicknessOverlay(result.group)
  })
})
