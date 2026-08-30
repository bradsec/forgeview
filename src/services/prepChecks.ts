import type { GeometryDetails } from '../store/viewerStore'

export type PrepCheckState = 'pass' | 'warn' | 'fail' | 'unavailable'

export interface PrepCheck {
  id: string
  label: string
  state: PrepCheckState
  detail: string
  fixId?: string
}

const ANALYSIS_ROWS: { id: string; label: string }[] = [
  { id: 'thickness', label: 'Thin walls' },
  { id: 'overhangs', label: 'Overhangs' },
  { id: 'onPlate', label: 'On build plate' },
]

function countRow(
  id: string,
  label: string,
  count: number,
  singular: string,
  plural: string
): PrepCheck {
  return count === 0
    ? { id, label, state: 'pass', detail: `0 ${plural}` }
    : {
        id,
        label,
        state: 'fail',
        detail: `${count} ${count === 1 ? singular : plural}`,
        fixId: 'seal',
      }
}

/** Ordered print-readiness rows derived from mesh health. Rows whose analysis
 * ships in a later sub-project always return 'unavailable' here. */
export function prepChecks(details: GeometryDetails | null, sealApplied = false): PrepCheck[] {
  if (!details) {
    return [
      { id: 'watertight', label: 'Watertight' },
      { id: 'nonManifold', label: 'Manifold edges' },
      { id: 'boundary', label: 'Open edges' },
      { id: 'degenerate', label: 'Degenerate faces' },
      { id: 'duplicate', label: 'Duplicate faces' },
      ...ANALYSIS_ROWS,
    ].map((row) => ({ ...row, state: 'unavailable' as const, detail: 'Open a model' }))
  }

  const rows: PrepCheck[] = [
    details.watertight
      ? { id: 'watertight', label: 'Watertight', state: 'pass', detail: 'Sealed' }
      : { id: 'watertight', label: 'Watertight', state: 'fail', detail: 'Not watertight', fixId: 'seal' },
    countRow('nonManifold', 'Manifold edges', details.nonManifoldEdges, 'non-manifold edge', 'non-manifold edges'),
    countRow('boundary', 'Open edges', details.boundaryEdges, 'open edge', 'open edges'),
    countRow('degenerate', 'Degenerate faces', details.degenerateFaces, 'degenerate face', 'degenerate faces'),
    countRow('duplicate', 'Duplicate faces', details.duplicateFaces, 'duplicate face', 'duplicate faces'),
    ...ANALYSIS_ROWS.map((row) => ({
      ...row,
      state: 'unavailable' as const,
      detail: 'Available in a later update',
    })),
  ]

  if (!sealApplied) return rows

  // Once a seal has run, residual watertight/manifold defects are inherited from
  // the original skin and are informational only: no Fix button re-opens repair.
  return rows.map((row) =>
    (row.id === 'watertight' || row.id === 'nonManifold') && row.state === 'fail'
      ? {
          ...row,
          state: 'warn' as const,
          detail: 'Sealed; residual edges inherited from the original skin',
          fixId: undefined,
        }
      : row
  )
}
