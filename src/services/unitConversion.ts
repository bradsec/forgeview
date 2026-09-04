import type { MeasurementUnit } from '../store/viewerStore'

export const UNIT_IN_MM: Record<MeasurementUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
}

export function toMm(value: number, unit: MeasurementUnit): number {
  return value * UNIT_IN_MM[unit]
}

export function fromMm(mm: number, unit: MeasurementUnit): number {
  return mm / UNIT_IN_MM[unit]
}

export function formatLength(value: number, unit: MeasurementUnit): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 100) / 100
  return `${rounded} ${unit}`
}
