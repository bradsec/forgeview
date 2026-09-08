import { requestManifold } from './manifoldService'
import type { PlaneCutResult } from './manifoldTypes'
export type { PlaneCutResult } from './manifoldTypes'

/** World-space soups; part A keeps dot(normal, p) >= offset. */
export function cutByPlane(positions: Float32Array, normal: [number, number, number], offset: number, signal?: AbortSignal): Promise<PlaneCutResult> {
  return requestManifold({ operation: 'cut', positions, normal, offset }, signal) as Promise<PlaneCutResult>
}
