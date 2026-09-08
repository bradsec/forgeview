/// <reference lib="webworker" />
import * as THREE from 'three'
import { remeshGeometry, type RemeshOptions } from './remesh'
const scope = self as DedicatedWorkerGlobalScope
scope.onmessage = (event: MessageEvent<{ positions: Float32Array; options: RemeshOptions }>) => {
  const input = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(event.data.positions, 3))
  try {
    const result = remeshGeometry(input, event.data.options)
    const output = result.geometry.index ? result.geometry.toNonIndexed() : result.geometry
    const positions = output.getAttribute('position').array as Float32Array
    scope.postMessage({ positions, beforeTriangles: result.beforeTriangles, afterTriangles: result.afterTriangles }, [positions.buffer])
    if (output !== result.geometry) output.dispose()
    result.geometry.dispose()
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'Remesh failed' })
  } finally { input.dispose() }
}
