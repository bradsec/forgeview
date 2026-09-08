export type BooleanOperation = 'union' | 'subtract' | 'intersection'

export interface HollowOptions {
  wallThickness: number
  resolution: number
  drainRadius: number
  drainAxis: 'x' | 'y' | 'z'
  drainOffset: [number, number, number]
}

export type ManifoldRequest =
  | { operation: 'hollow'; positions: Float32Array; options: HollowOptions }
  | { operation: 'cut'; positions: Float32Array; normal: [number, number, number]; offset: number }
  | { operation: BooleanOperation; positions: Float32Array; other: Float32Array }

export interface PlaneCutResult {
  partA: Float32Array
  partB: Float32Array
}
export type ManifoldResult = PlaneCutResult | Float32Array
