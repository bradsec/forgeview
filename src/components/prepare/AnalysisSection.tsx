import { useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'

export function AnalysisSection() {
  const hasModel = useViewerStore((s) => s.geometryDetails !== null)
  const overhangMode = useViewerStore((s) => s.overhangMode)
  const storeThreshold = useViewerStore((s) => s.overhangThresholdDeg)
  const overhangOverlayStatus = useViewerStore((s) => s.overhangOverlayStatus)
  const [thresholdStr, setThresholdStr] = useState(String(storeThreshold))

  const onThresholdChange = (raw: string) => {
    setThresholdStr(raw)
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n < 180) useViewerStore.getState().setOverhangThresholdDeg(n)
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Analysis
      </h3>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Highlight faces past the overhang angle from straight down.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Overhang angle</span>
          <input
            aria-label="Overhang angle"
            inputMode="decimal"
            value={thresholdStr}
            disabled={!hasModel}
            onChange={(e) => onThresholdChange(e.target.value)}
            className="w-16 bg-[var(--bg-button)] rounded px-2 py-1 text-sm font-mono"
          />
          <span className="text-xs text-[var(--text-muted)]">deg</span>
        </div>
        <button
          type="button"
          disabled={!hasModel}
          aria-pressed={overhangMode}
          onClick={() => useViewerStore.getState().setOverhangMode(!overhangMode)}
          className={
            'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
            (overhangMode ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
          }
        >
          {overhangMode ? 'Hide overhang heatmap' : 'Show overhang heatmap'}
        </button>
        {overhangMode && overhangOverlayStatus && overhangOverlayStatus.skippedMeshes > 0 && (
          <p className="text-xs text-[var(--text-muted)]">
            {overhangOverlayStatus.skippedMeshes} mesh{overhangOverlayStatus.skippedMeshes === 1 ? '' : 'es'} not eligible
          </p>
        )}
      </div>
    </div>
  )
}
