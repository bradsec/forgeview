export function sampleSpacing(extents: readonly number[], resolution: number): number {
  return Math.max(...extents) / resolution
}
