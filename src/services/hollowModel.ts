import { requestManifold } from './manifoldService'
import type { HollowOptions } from './manifoldTypes'
export type { HollowOptions } from './manifoldTypes'

/** Approximate inward offset; resolution controls the longest grid dimension. */
export function hollowModel(positions: Float32Array, options: HollowOptions, signal?: AbortSignal): Promise<Float32Array> {
  return requestManifold({ operation: 'hollow', positions, options }, signal) as Promise<Float32Array>
}
