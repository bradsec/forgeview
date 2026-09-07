/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import { weldSoup, meshToSoup } from './manifoldBridge'

const scope = self as DedicatedWorkerGlobalScope
let wasmPromise: Promise<ManifoldToplevel> | null = null
const getWasm = () => {
  if (!wasmPromise) wasmPromise = Module({ locateFile: () => wasmUrl }).then((w) => { w.setup(); return w })
  return wasmPromise
}

interface CutRequest {
  id: number
  // Non-indexed world-space soup, 9 floats per triangle.
  positions: ArrayBuffer
  normal: [number, number, number]
  // partA keeps dot(normal, p) - offset >= 0
  offset: number
}

scope.onmessage = async (e: MessageEvent<CutRequest>) => {
  const { id, normal, offset } = e.data
  try {
    const { Manifold, Mesh } = await getWasm()
    const soup = new Float32Array(e.data.positions)
    const weld = weldSoup(soup)
    let solid: InstanceType<typeof Manifold>
    try {
      const mesh = new Mesh({ numProp: 3, vertProperties: weld.vertProperties, triVerts: weld.triVerts })
      solid = new Manifold(mesh)
    } catch {
      scope.postMessage({ id, type: 'error', message: 'The model is not a closed solid. Run Repair, then try the cut again.' })
      return
    }
    if (solid.status() !== 'NoError' || solid.isEmpty()) {
      solid.delete()
      scope.postMessage({ id, type: 'error', message: 'The model is not a closed solid. Run Repair, then try the cut again.' })
      return
    }
    const a = solid.trimByPlane(normal, offset)
    const b = solid.trimByPlane([-normal[0], -normal[1], -normal[2]], -offset)
    solid.delete()
    const ma = a.getMesh(); const mb = b.getMesh()
    a.delete(); b.delete()
    const partA = meshToSoup(ma.vertProperties, ma.triVerts, ma.numProp)
    const partB = meshToSoup(mb.vertProperties, mb.triVerts, mb.numProp)
    scope.postMessage({ id, type: 'result', partA, partB }, [partA.buffer, partB.buffer])
  } catch (err) {
    scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
