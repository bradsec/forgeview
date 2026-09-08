import { requestManifold } from './manifoldService'
import type { BooleanOperation } from './manifoldTypes'
export type { BooleanOperation } from './manifoldTypes'

/** World-space soups. Subtraction removes B from A. Empty results are valid. */
export function booleanMeshes(a: Float32Array, b: Float32Array, operation: BooleanOperation, signal?: AbortSignal): Promise<Float32Array> {
  return requestManifold({ operation, positions: a, other: b }, signal) as Promise<Float32Array>
}
