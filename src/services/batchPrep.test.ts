import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js'
import { exportSTL } from './exporters'
import { prepareBatch, runBatchWorker, BATCH_MAX_FILES, BATCH_MAX_SOURCE_BYTES, BATCH_MAX_OUTPUT_BYTES } from './batchPrep'
import { prepareBatchGeometry } from './batchPrepGeometry'
import type { GridFile } from './gridFiles'

const file = (name: string, size = 100): GridFile => ({ name, path: `/models/${name}`, extension: name.slice(name.lastIndexOf('.')), size, mtime: 0 })
function boxBytes() { return exportSTL([new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3))]).buffer as ArrayBuffer }

describe('batch preparation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('repairs duplicate faces, preserves source and emits a grounded Z-up STL', () => {
    const geo = new THREE.BoxGeometry(1, 2, 3).toNonIndexed()
    const original = new Float32Array(geo.getAttribute('position').array)
    const positions = new Float32Array(original.length + 9)
    positions.set(original)
    positions.set(original.subarray(0, 9), original.length)
    const before = positions.slice()
    const result = prepareBatchGeometry(positions)
    const output = new STLLoader().parse(result.bytes.buffer as ArrayBuffer)
    output.computeBoundingBox()
    expect(output.getAttribute('position').count).toBe(36)
    expect(output.boundingBox!.min.z).toBeCloseTo(0)
    expect(output.boundingBox!.max.z).toBeCloseTo(1)
    expect(result.notes).toContain('duplicate: 1 removed')
    expect(positions).toEqual(before)
  })

  it('continues past failed and skipped files and writes unique outputs with millimeter dimensions', async () => {
    const files = [file('part.stl'), file('bad.stl'), file('large.stl', BATCH_MAX_SOURCE_BYTES + 1), file('part.stl')]
    const read = vi.fn(async (source: GridFile) => {
      if (source.name === 'bad.stl') throw new Error('Cannot read source')
      return boxBytes()
    })
    const result = await prepareBatch(files, 'in', new AbortController().signal, vi.fn(), {
      read, process: async (positions) => prepareBatchGeometry(positions),
    })
    expect(result.entries.map((entry) => entry.status)).toEqual(['success', 'failed', 'skipped', 'success'])
    expect(read).toHaveBeenCalledTimes(3)
    const archive = unzipSync(result.bytes)
    expect(Object.keys(archive)).toEqual(['001-part.stl', '004-part.stl', 'manifest.json'])
    const manifest = JSON.parse(strFromU8(archive['manifest.json']))
    expect(manifest.outputUnit).toBe('mm')
    expect(manifest.entries[1].reason).toBe('Cannot read source')
    const geo = new STLLoader().parse(archive['001-part.stl'].buffer as ArrayBuffer)
    geo.computeBoundingBox()
    const size = geo.boundingBox!.getSize(new THREE.Vector3())
    expect([size.x, size.y, size.z].sort((a, b) => a - b)).toEqual(expect.arrayContaining([expect.closeTo(25.4, 3), expect.closeTo(50.8, 3), expect.closeTo(76.2, 3)]))
  })

  it('uses glTF meter units instead of the unitless selection', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const encoded = btoa(String.fromCharCode(...new Uint8Array(positions.buffer)))
    const gltf = { asset: { version: '2.0' }, buffers: [{ uri: `data:application/octet-stream;base64,${encoded}`, byteLength: positions.byteLength }], bufferViews: [{ buffer: 0, byteLength: positions.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }
    const process = vi.fn(async (_positions: Float32Array) => ({ bytes: new Uint8Array([1]), notes: [] }))
    const result = await prepareBatch([file('part.gltf')], 'in', new AbortController().signal, vi.fn(), {
      read: async () => new Uint8Array(new TextEncoder().encode(JSON.stringify(gltf))).buffer, process,
    })
    expect(result.entries[0]).toMatchObject({ status: 'success' })
    expect(process).toHaveBeenCalled()
    expect(process.mock.calls[0]?.[0]).toEqual(new Float32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 0]))
  })

  it('skips animations before parsing or processing', async () => {
    const process = vi.fn()
    const result = await prepareBatch([file('animated.gltf')], 'mm', new AbortController().signal, vi.fn(), {
      read: async () => new TextEncoder().encode('{"animations":[{}]}').buffer as ArrayBuffer, process,
    })
    expect(result.entries[0].status).toBe('skipped')
    expect(process).not.toHaveBeenCalled()
  })

  it('rejects oversized listings before reading and cancellation prevents later files', async () => {
    const read = vi.fn(async () => boxBytes())
    const controller = new AbortController()
    const process = vi.fn(async () => { controller.abort(); return { bytes: new Uint8Array(), notes: [] } })
    await expect(prepareBatch(Array.from({ length: BATCH_MAX_FILES + 1 }, () => file('a.stl')), 'mm', controller.signal, vi.fn(), { read, process })).rejects.toThrow('at most 100')
    expect(read).not.toHaveBeenCalled()
    await expect(prepareBatch([file('a.stl'), file('b.stl')], 'mm', controller.signal, vi.fn(), { read, process })).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).toHaveBeenCalledOnce()
  })

  it('records output budget overflow and worker errors without aborting the remaining files', async () => {
    const oversized = new Uint8Array()
    Object.defineProperty(oversized, 'byteLength', { value: BATCH_MAX_OUTPUT_BYTES + 1 })
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('Repair failed'))
      .mockResolvedValueOnce({ bytes: oversized, notes: [] })
      .mockResolvedValueOnce({ bytes: new Uint8Array([1]), notes: [] })
    const result = await prepareBatch([file('bad.stl'), file('big.stl'), file('good.stl')], 'mm', new AbortController().signal, vi.fn(), {
      read: async () => boxBytes(), process,
    })
    expect(result.entries.map((entry) => entry.status)).toEqual(['failed', 'skipped', 'success'])
    expect(result.entries[1].reason).toContain('256 MiB')
    expect(Object.keys(unzipSync(result.bytes))).toEqual(['003-good.stl', 'manifest.json'])
  })

  it('terminates a running worker on cancellation', async () => {
    const terminate = vi.fn()
    vi.stubGlobal('Worker', class { terminate = terminate; postMessage = vi.fn() })
    const controller = new AbortController()
    const pending = runBatchWorker(new Float32Array(9), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminate).toHaveBeenCalledOnce()
  })
})
