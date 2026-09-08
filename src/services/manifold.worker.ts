/// <reference lib="webworker" />
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { executeManifold } from './manifoldEngine'
import type { ManifoldRequest } from './manifoldTypes'

const scope = self as DedicatedWorkerGlobalScope
let wasmPromise: Promise<ManifoldToplevel> | null = null
function getWasm() {
  if (!wasmPromise) {
    wasmPromise = Module({ locateFile: () => wasmUrl }).then(wasm => {
      wasm.setup()
      return wasm
    }).catch(error => {
      wasmPromise = null
      throw error
    })
  }
  return wasmPromise
}
scope.onmessage = async (event: MessageEvent<{ id: number; request: ManifoldRequest }>) => {
  const { id, request } = event.data
  try {
    const result = executeManifold(await getWasm(), request)
    const transfer = result instanceof Float32Array ? [result.buffer] : [result.partA.buffer, result.partB.buffer]
    scope.postMessage({ id, result }, transfer as ArrayBuffer[])
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
