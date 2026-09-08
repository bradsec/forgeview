import * as THREE from 'three'
import { invoke } from '@tauri-apps/api/core'
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js'
import { parseModelBuffer, disposeModel } from '../loaders'
import { getBrowserFile, isBrowserPath } from './browserFs'
import { AUTO_ORIENT_MAX_FACES as BATCH_MAX_FACES } from './autoOrient'
import type { GridFile } from './gridFiles'

export const BATCH_MAX_FILES = 100
export const BATCH_MAX_SOURCE_BYTES = 32 * 1024 * 1024
export const BATCH_MAX_OUTPUT_BYTES = 256 * 1024 * 1024
export type BatchInputUnit = 'mm' | 'cm' | 'in'
export interface BatchEntry {
  source: string
  status: 'success' | 'failed' | 'skipped'
  output?: string
  reason?: string
  notes?: string[]
}
export interface BatchResult { bytes: Uint8Array; entries: BatchEntry[] }
export interface BatchProgress { completed: number; total: number; name: string }

function abortError(): DOMException { return new DOMException('Batch cancelled', 'AbortError') }
function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw abortError() }

export function runBatchWorker(positions: Float32Array, signal: AbortSignal): Promise<{ bytes: Uint8Array; notes: string[] }> {
  checkAbort(signal)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./batchPrep.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); reject(abortError()) }
    signal.addEventListener('abort', cancel, { once: true })
    worker.onmessage = (event) => {
      cleanup()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data)
    }
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || 'Batch worker failed')) }
    worker.onmessageerror = () => { cleanup(); reject(new Error('Batch worker response could not be read')) }
    try { worker.postMessage(positions, [positions.buffer]) } catch (error) { cleanup(); reject(error) }
  })
}

async function readBatchFile(file: GridFile): Promise<ArrayBuffer> {
  if (isBrowserPath(file.path)) {
    const source = getBrowserFile(file.path)
    if (!source) throw new Error('Source file is no longer available')
    return source.arrayBuffer()
  }
  return invoke<ArrayBuffer>('read_file_bytes', { path: file.path })
}

/** Static glTF only, with embedded buffers and no texture loads during batch parsing. */
function validateGltf(buffer: ArrayBuffer, extension: string): string | null {
  let json: string
  if (extension === '.glb') {
    if (buffer.byteLength < 20) throw new Error('Invalid GLB header')
    const view = new DataView(buffer)
    const length = view.getUint32(12, true)
    if (view.getUint32(16, true) !== 0x4e4f534a || length > buffer.byteLength - 20) throw new Error('Invalid GLB JSON chunk')
    json = new TextDecoder().decode(new Uint8Array(buffer, 20, length))
  } else json = new TextDecoder().decode(buffer)
  const data = JSON.parse(json)
  if (data.animations?.length || data.skins?.length || data.meshes?.some((mesh: { primitives?: { targets?: unknown[] }[] }) => mesh.primitives?.some((p) => p.targets?.length))) {
    return 'Animated, skinned, and morph-target models require manual preparation'
  }
  if (data.images?.length || data.buffers?.some((entry: { uri?: string }) => entry.uri && !entry.uri.startsWith('data:'))) {
    return 'Textured or externally referenced glTF requires manual preparation'
  }
  return null
}

export interface BatchDependencies {
  read: (file: GridFile) => Promise<ArrayBuffer>
  process: typeof runBatchWorker
}

export async function prepareBatch(
  files: GridFile[], unit: BatchInputUnit, signal: AbortSignal,
  onProgress: (progress: BatchProgress) => void,
  dependencies: BatchDependencies = { read: readBatchFile, process: runBatchWorker },
): Promise<BatchResult> {
  if (files.length > BATCH_MAX_FILES) throw new Error(`Choose a folder with at most ${BATCH_MAX_FILES} files`)
  checkAbort(signal)
  const { collectExportMeshes, disposeExportMeshes } = await import('./exporters')
  const unitScale = { mm: 1, cm: 10, in: 25.4 }[unit]
  if (!unitScale) throw new Error('Choose mm, cm, or in for unitless files')
  const archive: Record<string, Uint8Array> = Object.create(null)
  const entries: BatchEntry[] = []
  let outputBytes = 0
  for (const [index, file] of files.entries()) {
    checkAbort(signal)
    onProgress({ completed: index, total: files.length, name: file.name })
    const entry: BatchEntry = { source: file.path, status: 'failed' }
    let root: THREE.Object3D | undefined
    let meshes: THREE.Mesh[] = []
    try {
      const extension = file.extension.toLowerCase()
      if (file.size > BATCH_MAX_SOURCE_BYTES) { entry.status = 'skipped'; entry.reason = 'Source exceeds 32 MiB'; continue }
      const buffer = await dependencies.read(file)
      checkAbort(signal)
      if (buffer.byteLength > BATCH_MAX_SOURCE_BYTES) { entry.status = 'skipped'; entry.reason = 'Source exceeds 32 MiB'; continue }
      if (extension === '.glb' || extension === '.gltf') {
        const reason = validateGltf(buffer, extension)
        if (reason) { entry.status = 'skipped'; entry.reason = reason; continue }
      }
      if (extension === '.dae') {
        const doc = new DOMParser().parseFromString(new TextDecoder().decode(buffer), 'application/xml')
        if (doc.querySelector('library_animations, library_controllers, library_images')) {
          entry.status = 'skipped'; entry.reason = 'Animated, deformed, or textured Collada requires manual preparation'; continue
        }
      }
      root = await parseModelBuffer(buffer, extension)
      checkAbort(signal)
      let faceCount = 0
      let deformed = false
      root.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          deformed ||= node instanceof THREE.SkinnedMesh || Object.keys(node.geometry.morphAttributes).length > 0
          faceCount += (node.geometry.index?.count ?? node.geometry.getAttribute('position')?.count ?? 0) / 3 * (node instanceof THREE.InstancedMesh ? node.count : 1)
        }
      })
      if (deformed || faceCount > BATCH_MAX_FACES) {
        entry.status = 'skipped'; entry.reason = deformed ? 'Deformed model requires manual preparation' : 'Model exceeds 200,000 triangles'; continue
      }
      meshes = collectExportMeshes(root)
      const scale = typeof root.userData.modelUnitInMm === 'number' ? root.userData.modelUnitInMm : unitScale
      const positions = new Float32Array(faceCount * 9)
      let offset = 0
      for (const mesh of meshes) {
        const geometry = mesh.geometry
        const position = geometry.getAttribute('position')
        const count = geometry.index?.count ?? position.count
        for (let i = 0; i < count; i++) {
          const vertex = geometry.index?.getX(i) ?? i
          positions[offset++] = position.getX(vertex) * scale
          positions[offset++] = position.getY(vertex) * scale
          positions[offset++] = position.getZ(vertex) * scale
        }
      }
      const result = await dependencies.process(positions, signal)
      checkAbort(signal)
      if (outputBytes + result.bytes.byteLength > BATCH_MAX_OUTPUT_BYTES - 1024 * 1024) {
        entry.status = 'skipped'; entry.reason = 'Batch output exceeds 256 MiB'; continue
      }
      const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'model'
      const output = `${String(index + 1).padStart(3, '0')}-${safeName}.stl`
      archive[output] = result.bytes
      outputBytes += result.bytes.byteLength
      Object.assign(entry, { status: 'success', output, notes: result.notes })
    } catch (error) {
      checkAbort(signal)
      entry.reason = error instanceof Error ? error.message : String(error)
    } finally {
      disposeExportMeshes(meshes)
      if (root) disposeModel(root, new THREE.Scene())
      entries.push(entry)
    }
  }
  checkAbort(signal)
  archive['manifest.json'] = new Uint8Array(strToU8(JSON.stringify({
    outputUnit: 'mm', upAxis: 'Z', unitlessInputUnit: unit,
    stages: ['weld', 'degenerate', 'duplicate', 'normals', 'smallShells', 'holeFill', 'autoOrient'], entries,
  }, null, 2)))
  onProgress({ completed: files.length, total: files.length, name: 'Creating ZIP' })
  const bytes = zipSync(archive, { level: 0 })
  checkAbort(signal)
  if (bytes.byteLength > BATCH_MAX_OUTPUT_BYTES) throw new Error('ZIP exceeds 256 MiB')
  return { bytes, entries }
}
