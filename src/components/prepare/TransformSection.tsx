import { useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { toMm } from '../../services/unitConversion'
import { isFactorInBounds } from '../../services/scaleMath'
import type { Viewer3DHandle } from '../Viewer3D'

type Axis = 'x' | 'y' | 'z'
type AxisStrings = Record<Axis, string>

const BLANK: AxisStrings = { x: '', y: '', z: '' }
const AXES: Axis[] = ['x', 'y', 'z']

function hasAnyAxisValue(values: AxisStrings): boolean {
  return AXES.some((axis) => {
    const raw = values[axis].trim()
    return raw !== '' && Number.isFinite(Number(raw))
  })
}

/**
 * Every axis the user actually filled in must be a scale factor the viewer can
 * apply. An out-of-bounds factor can push the camera's near/far planes past
 * broken, and an invalid one would silently clamp to 1 and push a no-op undo
 * entry that evicts a real edit off the bounded stack.
 */
function allAxisScalesValid(values: AxisStrings): boolean {
  return AXES.every((axis) => {
    const raw = values[axis].trim()
    return raw === '' || isFactorInBounds(Number(raw))
  })
}

function parseAxisInputs(
  values: AxisStrings,
  toDelta: (n: number) => number,
  identity: number,
): { x: number; y: number; z: number } {
  const delta = { x: identity, y: identity, z: identity }
  for (const axis of AXES) {
    const raw = values[axis].trim()
    if (raw === '') continue
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    delta[axis] = toDelta(n)
  }
  return delta
}

export function TransformSection({
  viewerRef,
}: {
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const unit = useViewerStore((s) => s.measurementUnit)
  const splitParts = useViewerStore((s) => s.splitParts)
  const measureMode = useViewerStore((s) => s.measureMode)
  const locked = !details || splitParts.length > 0 || measureMode
  const scaleUnit = details?.modelUnitInMm ?? 1

  const [move, setMove] = useState<AxisStrings>(BLANK)
  const [rotate, setRotate] = useState<AxisStrings>(BLANK)
  const [scale, setScale] = useState<AxisStrings>(BLANK)
  const [orientNote, setOrientNote] = useState<string | null>(null)
  const [layoutNote, setLayoutNote] = useState<string | null>(null)

  const moveHasAny = hasAnyAxisValue(move)
  const rotateHasAny = hasAnyAxisValue(rotate)
  const scaleHasAny = hasAnyAxisValue(scale)
  const scaleAllValid = allAxisScalesValid(scale)

  const applyMove = () => {
    if (!moveHasAny) return
    const delta = parseAxisInputs(move, (mm) => toMm(mm, unit) / scaleUnit, 0)
    viewerRef.current?.moveModelBy(delta)
    setMove(BLANK)
    setLayoutNote(null) // a manual reposition invalidates the arrangement
  }
  const applyRotate = () => {
    if (!rotateHasAny) return
    const delta = parseAxisInputs(rotate, (deg) => (deg * Math.PI) / 180, 0)
    viewerRef.current?.rotateModelBy(delta)
    setRotate(BLANK)
    setOrientNote(null) // a manual rotate invalidates the auto-orient figure
    setLayoutNote(null) // and shifts the footprint, so the arrangement too
  }
  const runAutoOrient = () => {
    const r = viewerRef.current?.autoOrient()
    if (!r || r.status === 'empty') return
    if (r.status === 'skipped') { setOrientNote('Model too large to auto-orient'); return }
    if (r.status === 'noop') { setOrientNote('Already well oriented'); return }
    setOrientNote(`Overhang area ${r.beforePct}% to ${r.afterPct}%`)
  }
  const runArrange = () => {
    const r = viewerRef.current?.arrangeOnPlate()
    if (!r || r.status === 'empty') return
    if (r.placed === 0) setLayoutNote('Nothing fits the build volume')
    else if (r.placed === r.total) setLayoutNote(`Arranged ${r.total} model${r.total === 1 ? '' : 's'}`)
    else setLayoutNote(`Arranged ${r.placed} of ${r.total}, the rest do not fit`)
  }
  const applyScale = () => {
    if (!scaleHasAny || !scaleAllValid) return
    const raw = parseAxisInputs(scale, (f) => f, 1)
    const safe = {
      x: raw.x > 0 ? raw.x : 1,
      y: raw.y > 0 ? raw.y : 1,
      z: raw.z > 0 ? raw.z : 1,
    }
    viewerRef.current?.scaleModelByAxes(safe)
    setScale(BLANK)
    setLayoutNote(null) // a resize changes the footprint, invalidating the layout
  }

  const axisInputs = (
    label: string,
    values: AxisStrings,
    setValues: (v: AxisStrings) => void,
    unitLabel: string,
  ) => (
    <div className="prepare-form-group">
      <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</span>
      <div className="transform-axis-fields">
        {AXES.map((axis) => (
          <label key={axis} className="prepare-field">
            <span>{axis.toUpperCase()}</span>
            <input
              aria-label={`${label} ${axis}`}
              inputMode="decimal"
              value={values[axis]}
              disabled={locked}
              onChange={(e) => setValues({ ...values, [axis]: e.target.value })}
              className="w-16 bg-[var(--bg-button)] rounded px-2 py-1 text-sm font-mono"
            />
          </label>
        ))}
        <span className="self-center text-xs text-[var(--text-muted)]">{unitLabel}</span>
      </div>
    </div>
  )

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Transform
      </h3>
      {locked && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {splitParts.length > 0
            ? 'Recombine split parts before transforming.'
            : measureMode
              ? 'Stop measuring before transforming.'
              : 'Open a model to transform.'}
        </p>
      )}
      <div className="prepare-transform-form">
        {axisInputs('Move', move, setMove, unit)}
        <button
          type="button"
          disabled={locked || !moveHasAny}
          onClick={applyMove}
          className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
        >
          Apply move
        </button>

        {axisInputs('Rotate', rotate, setRotate, 'deg')}
        <button
          type="button"
          disabled={locked || !rotateHasAny}
          onClick={applyRotate}
          className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
        >
          Apply rotate
        </button>

        {axisInputs('Scale (free)', scale, setScale, '×')}
        {!locked && scaleHasAny && !scaleAllValid && (
          <p className="text-xs text-[var(--error)]">Enter a scale factor within range.</p>
        )}
        <button
          type="button"
          disabled={locked || !scaleHasAny || !scaleAllValid}
          onClick={applyScale}
          className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
        >
          Apply scale
        </button>

        <div className="prepare-form-group">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Mirror</span>
          <div className="prepare-actions">
            {AXES.map((axis) => (
              <button
                key={axis}
                type="button"
                disabled={locked}
                onClick={() => { viewerRef.current?.mirrorModel(axis); setOrientNote(null); setLayoutNote(null) }}
                className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
              >
                Mirror {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="prepare-actions">
          <button
            type="button"
            disabled={locked}
            onClick={() => { viewerRef.current?.dropToFloor(); setLayoutNote(null) }}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
          >
            Drop to floor
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => { viewerRef.current?.centerOnPlate(); setLayoutNote(null) }}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
          >
            Center on plate
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={runAutoOrient}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
          >
            Auto-orient
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={runArrange}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
          >
            Arrange on plate
          </button>
        </div>
        {orientNote && <p className="text-xs text-[var(--text-muted)]">{orientNote}</p>}
        {layoutNote && <p className="text-xs text-[var(--text-muted)]">{layoutNote}</p>}
      </div>
    </div>
  )
}
