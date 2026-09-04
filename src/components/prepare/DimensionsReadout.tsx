import { useViewerStore, type MeasurementUnit } from '../../store/viewerStore'
import { fromMm, formatLength } from '../../services/unitConversion'

const UNITS: MeasurementUnit[] = ['mm', 'cm', 'in']

export function DimensionsReadout() {
  const details = useViewerStore((s) => s.geometryDetails)
  const unit = useViewerStore((s) => s.measurementUnit)
  const setUnit = useViewerStore((s) => s.setMeasurementUnit)
  if (!details) return null

  const scale = details.modelUnitInMm ?? 1
  const rows = {
    Width: details.width * scale,
    Height: details.height * scale,
    Depth: details.depth * scale,
  }
  const longest = Math.max(rows.Width, rows.Height, rows.Depth)
  const fmt = (mm: number) => formatLength(fromMm(mm, unit), unit)

  return (
    <div data-testid="dimensions-readout" className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
          Dimensions
        </h2>
        <div role="group" aria-label="Display unit" className="flex gap-1">
          {UNITS.map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
              className={
                'px-2 py-0.5 rounded text-xs ' +
                (unit === u ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
              }
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {Object.entries(rows).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{k}</dt>
            <dd className="text-sm font-mono tabular-nums">{fmt(v)}</dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Longest</dt>
          <dd className="text-sm font-mono tabular-nums">{fmt(longest)}</dd>
        </div>
      </dl>
    </div>
  )
}
