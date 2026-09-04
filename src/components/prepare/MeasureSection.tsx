import { useViewerStore } from '../../store/viewerStore'
import { fromMm, formatLength } from '../../services/unitConversion'
import type { Viewer3DHandle } from '../Viewer3D'

export function MeasureSection({
  viewerRef,
}: {
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const measureMode = useViewerStore((s) => s.measureMode)
  const distMm = useViewerStore((s) => s.measureDistanceMm)
  const unit = useViewerStore((s) => s.measurementUnit)
  const hasModel = details !== null

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Measure
      </h3>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Click two points on the model to measure the straight-line distance.
        {details && details.modelUnitInMm === null && ' Assuming millimetres.'}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          disabled={!hasModel}
          aria-pressed={measureMode}
          onClick={() => useViewerStore.getState().setMeasureMode(!measureMode)}
          className={
            'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
            (measureMode
              ? 'bg-[var(--accent-button)] text-white'
              : 'bg-[var(--bg-button)]')
          }
        >
          {measureMode ? 'Stop measuring' : 'Measure distance'}
        </button>
        {measureMode && (
          <button
            type="button"
            onClick={() => viewerRef.current?.resetMeasure()}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm self-start"
          >
            Clear
          </button>
        )}
        {distMm != null && (
          <p data-testid="measure-distance" className="text-sm font-mono tabular-nums">
            {formatLength(fromMm(distMm, unit), unit)}
          </p>
        )}
        {measureMode && (
          <p className="text-xs text-[var(--text-muted)]">Press Esc to stop.</p>
        )}
      </div>
    </div>
  )
}
