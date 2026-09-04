export const SCALE_FACTOR_BOUNDS = { min: 1e-4, max: 1e4 }

export function isFactorInBounds(factor: number): boolean {
  return (
    Number.isFinite(factor) &&
    factor > 0 &&
    factor >= SCALE_FACTOR_BOUNDS.min &&
    factor <= SCALE_FACTOR_BOUNDS.max
  )
}

export function scaleToTargetFactor(currentMm: number, targetMm: number): number {
  if (!Number.isFinite(currentMm) || !Number.isFinite(targetMm)) return Number.NaN
  if (currentMm <= 0 || targetMm <= 0) return Number.NaN
  return targetMm / currentMm
}

export function scaleToFitFactor(
  dimsMm: { width: number; height: number; depth: number },
  plateMm: { x: number; y: number; z: number },
): number {
  const values = [dimsMm.width, dimsMm.height, dimsMm.depth, plateMm.x, plateMm.y, plateMm.z]
  if (values.some((v) => !Number.isFinite(v))) return Number.NaN
  if (dimsMm.width <= 0 || dimsMm.height <= 0 || dimsMm.depth <= 0) return Number.NaN
  return Math.min(plateMm.x / dimsMm.width, plateMm.y / dimsMm.height, plateMm.z / dimsMm.depth)
}
