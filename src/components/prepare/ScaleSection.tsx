import { useEffect, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { toMm } from '../../services/unitConversion'
import { scaleToTargetFactor, scaleToFitFactor, isFactorInBounds } from '../../services/scaleMath'
import type { Viewer3DHandle } from '../Viewer3D'

type Axis = 'width' | 'height' | 'depth' | 'longest'

export function ScaleSection({
  viewerRef,
  sectionRef,
}: {
  viewerRef: React.RefObject<Viewer3DHandle | null>
  sectionRef?: React.RefObject<HTMLDivElement | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const unit = useViewerStore((s) => s.measurementUnit)
  const splitParts = useViewerStore((s) => s.splitParts)
  const measureMode = useViewerStore((s) => s.measureMode)
  const buildVolume = useViewerStore((s) => s.buildVolumeMm)
  const showBuildVolume = useViewerStore((s) => s.showBuildVolume)
  const [axis, setAxis] = useState<Axis>('longest')
  const [target, setTarget] = useState('')
  const [volStr, setVolStr] = useState<{ x: string; y: string; z: string }>({
    x: String(buildVolume.x), y: String(buildVolume.y), z: String(buildVolume.z),
  })

  useEffect(() => {
    setVolStr((previous) => {
      const next = { ...previous }
      for (const axis of ['x', 'y', 'z'] as const) {
        const parsed = Number(previous[axis])
        const committed = Number.isFinite(parsed) ? parsed : 0
        if (committed !== buildVolume[axis]) next[axis] = String(buildVolume[axis])
      }
      return next
    })
  }, [buildVolume.x, buildVolume.y, buildVolume.z])

  const locked = !details || splitParts.length > 0 || measureMode
  const scale = details?.modelUnitInMm ?? 1
  const dimsMm = details
    ? { width: details.width * scale, height: details.height * scale, depth: details.depth * scale }
    : null
  const axisMm = dimsMm
    ? axis === 'longest'
      ? Math.max(dimsMm.width, dimsMm.height, dimsMm.depth)
      : dimsMm[axis]
    : 0

  const targetNum = Number(target)
  const targetFactor =
    Number.isFinite(targetNum) && targetNum > 0 && axisMm > 0
      ? scaleToTargetFactor(axisMm, toMm(targetNum, unit))
      : Number.NaN
  const targetOk = isFactorInBounds(targetFactor)

  const fitFactor = dimsMm
    ? scaleToFitFactor(dimsMm, { x: buildVolume.x, y: buildVolume.y, z: buildVolume.z })
    : Number.NaN
  const fitOk = isFactorInBounds(fitFactor)

  const setVol = (k: 'x' | 'y' | 'z', raw: string) => {
    setVolStr((prev) => ({ ...prev, [k]: raw }))
    const n = Number(raw)
    useViewerStore.getState().setBuildVolumeMm({ ...buildVolume, [k]: Number.isFinite(n) ? n : 0 })
  }

  return (
    <div id="prepare-scale" ref={sectionRef}>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">Scale</h3>
      {locked && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {splitParts.length > 0
            ? 'Recombine split parts before scaling.'
            : measureMode
              ? 'Stop measuring before scaling.'
              : 'Open a model to scale.'}
        </p>
      )}
      <div className="prepare-form-sections">
        <div className="prepare-form-group">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Scale to target</span>
          <div className="scale-target-fields">
            <label className="prepare-field">
              <span>Target axis</span>
              <select
                aria-label="Target axis"
                value={axis}
                disabled={locked}
                onChange={(e) => setAxis(e.target.value as Axis)}
                className="bg-[var(--bg-button)] rounded px-2 py-1 text-sm"
              >
                <option value="width">Width</option>
                <option value="height">Height</option>
                <option value="depth">Depth</option>
                <option value="longest">Longest edge</option>
              </select>
            </label>
            <label className="prepare-field">
              <span>Target length ({unit})</span>
              <input
                aria-label={`Target length (${unit})`}
                inputMode="decimal"
                value={target}
                disabled={locked}
                onChange={(e) => setTarget(e.target.value)}
                className="w-24 bg-[var(--bg-button)] rounded px-2 py-1 text-sm font-mono"
              />
            </label>
          </div>
          {!locked && target !== '' && !targetOk && (
            <p className="text-xs text-[var(--error)]">Enter a length that scales within range.</p>
          )}
          <button
            type="button"
            disabled={locked || !targetOk}
            onClick={() => viewerRef.current?.scaleModelBy(targetFactor, 'Scale to target')}
            className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
          >
            Apply
          </button>
        </div>

        <div className="prepare-form-group">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">
            Scale to build volume (mm)
          </span>
          <div className="scale-volume-fields">
            {(['x', 'y', 'z'] as const).map((k) => (
              <label key={k} className="prepare-field">
                <span>{k.toUpperCase()}</span>
                <input
                  aria-label={`Build volume ${k}`}
                  inputMode="decimal"
                  value={volStr[k]}
                  disabled={locked}
                  onChange={(e) => setVol(k, e.target.value)}
                  className="w-16 bg-[var(--bg-button)] rounded px-2 py-1 text-sm font-mono"
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() => {
                useViewerStore.getState().resetBuildVolumeMm()
                const v = useViewerStore.getState().buildVolumeMm
                setVolStr({ x: String(v.x), y: String(v.y), z: String(v.z) })
              }}
              className="text-xs text-[var(--text-muted)] underline"
            >
              Reset
            </button>
          </div>
          <button
            type="button"
            aria-pressed={showBuildVolume}
            onClick={() => useViewerStore.getState().setShowBuildVolume(!showBuildVolume)}
            className={
              'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
              (showBuildVolume ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
            }
          >
            {showBuildVolume ? 'Hide build volume' : 'Show build volume'}
          </button>
          <button
            type="button"
            disabled={locked || !fitOk}
            onClick={() => viewerRef.current?.scaleModelBy(fitFactor, 'Scale to fit build volume')}
            className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
          >
            Fit to build volume
          </button>
        </div>
      </div>
    </div>
  )
}
