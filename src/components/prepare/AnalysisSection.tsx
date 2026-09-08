import { useEffect, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'

export function AnalysisSection() {
  const hasModel = useViewerStore((s) => s.geometryDetails !== null)
  const overhangMode = useViewerStore((s) => s.overhangMode)
  const storeThreshold = useViewerStore((s) => s.overhangThresholdDeg)
  const overhangOverlayStatus = useViewerStore((s) => s.overhangOverlayStatus)
  const [thresholdStr, setThresholdStr] = useState(String(storeThreshold))

  const wallThicknessMode = useViewerStore((s) => s.wallThicknessMode)
  const minWallThicknessMm = useViewerStore((s) => s.minWallThicknessMm)
  const wallThicknessOverlayStatus = useViewerStore((s) => s.wallThicknessOverlayStatus)
  const thinWallFaceCount = useViewerStore((s) => s.geometryDetails?.thinWallFaceCount)
  const [minWallStr, setMinWallStr] = useState(String(minWallThicknessMm))
  const tooLarge = hasModel && thinWallFaceCount === null

  useEffect(() => {
    setThresholdStr((raw) => Number(raw) === storeThreshold ? raw : String(storeThreshold))
  }, [storeThreshold])

  useEffect(() => {
    setMinWallStr((raw) => Number(raw) === minWallThicknessMm ? raw : String(minWallThicknessMm))
  }, [minWallThicknessMm])

  const xrayMode = useViewerStore((s) => s.xrayMode)
  const clipMode = useViewerStore((s) => s.clipMode)
  const clipAxis = useViewerStore((s) => s.clipAxis)
  const clipOffset = useViewerStore((s) => s.clipOffset)
  const clipFlip = useViewerStore((s) => s.clipFlip)

  const onThresholdChange = (raw: string) => {
    setThresholdStr(raw)
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n < 180) useViewerStore.getState().setOverhangThresholdDeg(n)
  }

  const onMinWallChange = (raw: string) => {
    setMinWallStr(raw)
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) useViewerStore.getState().setMinWallThicknessMm(n)
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Analysis
      </h3>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Highlight downward-facing overhangs and thin walls, or look inside with X-ray and a clip plane.
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Min wall</span>
          <input
            aria-label="Min wall"
            inputMode="decimal"
            value={minWallStr}
            disabled={!hasModel}
            onChange={(e) => onMinWallChange(e.target.value)}
            className="w-16 bg-[var(--bg-button)] rounded px-2 py-1 text-sm font-mono"
          />
          <span className="text-xs text-[var(--text-muted)]">mm</span>
        </div>
        <button
          type="button"
          disabled={!hasModel || tooLarge}
          aria-pressed={wallThicknessMode}
          onClick={() => useViewerStore.getState().setWallThicknessMode(!wallThicknessMode)}
          className={
            'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
            (wallThicknessMode ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
          }
        >
          {wallThicknessMode ? 'Hide wall thickness heatmap' : 'Show wall thickness heatmap'}
        </button>
        {tooLarge && (
          <p className="text-xs text-[var(--text-muted)]">
            Model too large for wall-thickness analysis
          </p>
        )}
        {wallThicknessMode && wallThicknessOverlayStatus && wallThicknessOverlayStatus.unsampledFaces > 0 && (
          <p className="text-xs text-[var(--text-muted)]">
            {wallThicknessOverlayStatus.unsampledFaces} face{wallThicknessOverlayStatus.unsampledFaces === 1 ? '' : 's'} could not be sampled (open surface)
          </p>
        )}
        {wallThicknessMode && wallThicknessOverlayStatus && wallThicknessOverlayStatus.skippedMeshes > 0 && (
          <p className="text-xs text-[var(--text-muted)]">
            {wallThicknessOverlayStatus.skippedMeshes} mesh{wallThicknessOverlayStatus.skippedMeshes === 1 ? '' : 'es'} not eligible
          </p>
        )}
        <button
          type="button"
          disabled={!hasModel}
          aria-pressed={xrayMode}
          onClick={() => useViewerStore.getState().setXrayMode(!xrayMode)}
          className={
            'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
            (xrayMode ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
          }
        >
          {xrayMode ? 'Hide X-ray' : 'Show X-ray'}
        </button>
        <button
          type="button"
          disabled={!hasModel}
          aria-pressed={clipMode}
          onClick={() => useViewerStore.getState().setClipMode(!clipMode)}
          className={
            'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
            (clipMode ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
          }
        >
          {clipMode ? 'Hide clip plane' : 'Show clip plane'}
        </button>
        {clipMode && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Clip axis</span>
              {(['x', 'y', 'z'] as const).map((ax) => (
                <button
                  key={ax}
                  type="button"
                  disabled={!hasModel}
                  aria-pressed={clipAxis === ax}
                  onClick={() => useViewerStore.getState().setClipAxis(ax)}
                  className={
                    'px-2 py-1 rounded text-sm disabled:opacity-50 ' +
                    (clipAxis === ax ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
                  }
                >
                  {ax.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Clip position</span>
              <input
                aria-label="Clip position"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clipOffset}
                disabled={!hasModel}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) useViewerStore.getState().setClipOffset(n)
                }}
                className="flex-1"
              />
            </div>
            <button
              type="button"
              disabled={!hasModel}
              aria-pressed={clipFlip}
              onClick={() => useViewerStore.getState().setClipFlip(!clipFlip)}
              className={
                'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
                (clipFlip ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
              }
            >
              Flip side
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
