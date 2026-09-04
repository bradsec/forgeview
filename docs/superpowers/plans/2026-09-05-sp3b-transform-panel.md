# SP-3b: Transform Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add move, rotate, free (per-axis) scale, mirror, drop-to-floor, and center-on-plate to the Prepare panel, each a single undoable edit on the model root's transform.

**Architecture:** Six new `Viewer3DHandle` methods (`moveModelBy`, `rotateModelBy`, `scaleModelByAxes`, `mirrorModel`, `dropToFloor`, `centerOnPlate`) follow SP-3a's `scaleModelBy` shape exactly: capture each model root's pre-op `position`/`rotation`/`scale` vector, mutate it, push one bespoke `UndoEntry` whose `apply` restores the captured vectors and re-runs `updateGeometryDetails()` + `refreshSceneEnvironment()` + `invalidate()`. A new `TransformSection.tsx` component (styled like `ScaleSection.tsx`) holds Move/Rotate/free-Scale numeric inputs (local string state per axis, blank = "don't touch that axis") plus Mirror/Drop-to-floor/Center-on-plate buttons, locked under the same three conditions as `ScaleSection`.

**Tech Stack:** React 19, Three 0.185, Zustand 5, Vitest, Playwright, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-05-sp3b-transform-panel-design.md`

## Global Constraints

- **No new npm dependency.**
- **Every numeric action is a delta on top of the current transform**, and every input resets to blank after Apply. Move/Rotate: blank axis = untouched (excluded from the delta, not `0`). Free scale: blank axis = factor `1` (untouched).
- **Move offsets convert mm/cm/in to a raw-geometry-unit delta** via `toMm(value, unit) / (modelUnitInMm ?? 1)` before reaching the handle — translation lives in the parent/world frame, independent of the object's own `.scale`.
- **Rotate takes radians at the handle boundary**; `TransformSection` converts degrees to radians before calling.
- **Free scale factors must be finite and `> 0` per axis**; an invalid non-blank value falls back to `1` (untouched) for that axis, same outcome as leaving it blank.
- **`TransformSection` is locked** (every control disabled, a reason shown) when `!geometryDetails || splitParts.length > 0 || measureMode`, exact reason wording matching `ScaleSection`: `'Recombine split parts before transforming.'`, `'Stop measuring before transforming.'`, `'Open a model to transform.'`.
- **No jest-dom in this repo** (discovered during SP-3a; `@testing-library/jest-dom` is not installed). Write every component test with vitest/RTL-core assertions from the start — `(el as HTMLButtonElement).disabled`, `(el as HTMLInputElement).value`, `getByRole`/`getByLabelText` directly (they throw if absent) — matching `src/components/prepare/ScaleSection.test.tsx` and `PreparePanel.test.tsx`. Do not write `toBeInTheDocument()` / `toBeDisabled()` / `toHaveTextContent()` anywhere in this plan's tests.
- **No unit test for the six `Viewer3DHandle` methods.** Same reasoning as SP-3a's `scaleModelBy`/`resetMeasure`: the imperative handle needs refs the WebGL renderer effect populates, absent in jsdom (`Viewer3D.test.tsx` covers only exported pure helpers + the WebGL-less error path). Verification for those tasks is `tsc --noEmit` clean + full unit suite no-regression; runtime correctness is the Task 6 e2e's job. `TransformSection`'s own logic (delta computation, blank-axis handling, factor clamping) IS unit-testable and must be tested there.
- **`pnpm test` (full suite) + `pnpm exec tsc --noEmit` pass before every commit.**

---

## Task 1: Viewer3D handle — `moveModelBy`, `rotateModelBy`

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (see Global Constraints). Verification: `tsc --noEmit` clean, full suite no regression (currently 49 files / 370 tests).

**Interfaces:**
- Consumes: `modelRoots()`, `updateGeometryDetails()`, `refreshSceneEnvironment()`, `invalidate()`, `pushUndo()` (all already in `Viewer3D.tsx`, same helpers `scaleModelBy` at `Viewer3D.tsx:459-479` uses); `THREE`.
- Produces (added to `Viewer3DHandle` after `resetMeasure`, and to the `useImperativeHandle` object after `resetMeasure`'s existing implementation at `Viewer3D.tsx:480-491`):
  - `moveModelBy: (delta: { x: number; y: number; z: number }) => void`
  - `rotateModelBy: (deltaRad: { x: number; y: number; z: number }) => void`

- [ ] **Step 1: Add the two signatures to `Viewer3DHandle`**

In `Viewer3DHandle` (`Viewer3D.tsx`, after the existing `resetMeasure: () => void` line):

```ts
  /** Translate every model root by `delta` (raw geometry units) as one undoable edit. */
  moveModelBy: (delta: { x: number; y: number; z: number }) => void
  /** Rotate every model root by `deltaRad` (radians, added to current Euler XYZ) as one undoable edit. */
  rotateModelBy: (deltaRad: { x: number; y: number; z: number }) => void
```

- [ ] **Step 2: Add the two method bodies**

In `useImperativeHandle(ref, () => ({ ... }))`, after the existing `resetMeasure` entry:

```ts
    moveModelBy: (delta: { x: number; y: number; z: number }) => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const dx = Number.isFinite(delta.x) ? delta.x : 0
      const dy = Number.isFinite(delta.y) ? delta.y : 0
      const dz = Number.isFinite(delta.z) ? delta.z : 0
      const prev = roots.map((r) => r.position.clone())
      roots.forEach((r) => {
        r.position.x += dx
        r.position.y += dy
        r.position.z += dz
      })
      pushUndo({
        label: 'Move',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.position.copy(prev[i])
          })
          updateGeometryDetails()
          refreshSceneEnvironment()
          invalidate()
        },
        discard: () => {},
      })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
    rotateModelBy: (deltaRad: { x: number; y: number; z: number }) => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const rx = Number.isFinite(deltaRad.x) ? deltaRad.x : 0
      const ry = Number.isFinite(deltaRad.y) ? deltaRad.y : 0
      const rz = Number.isFinite(deltaRad.z) ? deltaRad.z : 0
      const prev = roots.map((r) => r.rotation.clone())
      roots.forEach((r) => {
        r.rotation.x += rx
        r.rotation.y += ry
        r.rotation.z += rz
      })
      pushUndo({
        label: 'Rotate',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.rotation.copy(prev[i])
          })
          updateGeometryDetails()
          refreshSceneEnvironment()
          invalidate()
        },
        discard: () => {},
      })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
```

- [ ] **Step 3: Type-check + full suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, 370 tests pass (no regression).

- [ ] **Step 4: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D handle - moveModelBy, rotateModelBy"
```

---

## Task 2: Viewer3D handle — `scaleModelByAxes`, `mirrorModel`

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (see Global Constraints).

**Interfaces:**
- Produces (added to `Viewer3DHandle` after `rotateModelBy`, and to `useImperativeHandle` after `rotateModelBy`'s body):
  - `scaleModelByAxes: (factors: { x: number; y: number; z: number }) => void`
  - `mirrorModel: (axis: 'x' | 'y' | 'z') => void`

- [ ] **Step 1: Add the two signatures to `Viewer3DHandle`**

```ts
  /** Multiply every model root's `.scale` component-wise by `factors` (each
   *  must be finite and > 0, else treated as 1 / untouched) as one undoable edit. */
  scaleModelByAxes: (factors: { x: number; y: number; z: number }) => void
  /** Negate one `.scale` component on every model root as one undoable edit. */
  mirrorModel: (axis: 'x' | 'y' | 'z') => void
```

- [ ] **Step 2: Add the two method bodies**

```ts
    scaleModelByAxes: (factors: { x: number; y: number; z: number }) => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const fx = Number.isFinite(factors.x) && factors.x > 0 ? factors.x : 1
      const fy = Number.isFinite(factors.y) && factors.y > 0 ? factors.y : 1
      const fz = Number.isFinite(factors.z) && factors.z > 0 ? factors.z : 1
      const prev = roots.map((r) => r.scale.clone())
      roots.forEach((r) => {
        r.scale.x *= fx
        r.scale.y *= fy
        r.scale.z *= fz
      })
      pushUndo({
        label: 'Scale (free)',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.scale.copy(prev[i])
          })
          updateGeometryDetails()
          refreshSceneEnvironment()
          invalidate()
        },
        discard: () => {},
      })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
    mirrorModel: (axis: 'x' | 'y' | 'z') => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const prev = roots.map((r) => r.scale.clone())
      roots.forEach((r) => {
        r.scale[axis] *= -1
      })
      pushUndo({
        label: `Mirror ${axis.toUpperCase()}`,
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.scale.copy(prev[i])
          })
          updateGeometryDetails()
          refreshSceneEnvironment()
          invalidate()
        },
        discard: () => {},
      })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
```

- [ ] **Step 3: Type-check + full suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, 370 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D handle - scaleModelByAxes, mirrorModel"
```

---

## Task 3: Viewer3D handle — `dropToFloor`, `centerOnPlate`

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (see Global Constraints).

**Interfaces:**
- Produces (added to `Viewer3DHandle` after `mirrorModel`, and to `useImperativeHandle` after `mirrorModel`'s body):
  - `dropToFloor: () => void`
  - `centerOnPlate: () => void`

- [ ] **Step 1: Add the two signatures to `Viewer3DHandle`**

```ts
  /** Translate every model root by the same world-Y delta so the union
   *  bounding box's min-Y becomes 0, as one undoable edit. */
  dropToFloor: () => void
  /** Translate every model root by the same world X/Z delta so the union
   *  bounding box's X/Z center becomes (0, 0); Y untouched. One undoable edit. */
  centerOnPlate: () => void
```

- [ ] **Step 2: Add the two method bodies**

Both compute ONE union `Box3` over `modelRoots()` and apply the same delta to
every root's `position`, so a multi-model scene's relative layout is
preserved (matches `refreshSceneEnvironment`'s own union-box treatment).

```ts
    dropToFloor: () => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const box = new THREE.Box3()
      for (const root of roots) box.expandByObject(root)
      const deltaY = -box.min.y
      const prev = roots.map((r) => r.position.clone())
      roots.forEach((r) => {
        r.position.y += deltaY
      })
      pushUndo({
        label: 'Drop to floor',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.position.copy(prev[i])
          })
          updateGeometryDetails()
          refreshSceneEnvironment()
          invalidate()
        },
        discard: () => {},
      })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
    centerOnPlate: () => {
      const roots = modelRoots()
      if (roots.length === 0) return
      const box = new THREE.Box3()
      for (const root of roots) box.expandByObject(root)
      const center = box.getCenter(new THREE.Vector3())
      const deltaX = -center.x
      const deltaZ = -center.z
      const prev = roots.map((r) => r.position.clone())
      roots.forEach((r) => {
        r.position.x += deltaX
        r.position.z += deltaZ
      })
      pushUndo({
        label: 'Center on plate',
        apply: () => {
          modelRoots().forEach((r, i) => {
            if (prev[i]) r.position.copy(prev[i])
          })
          updateGeometryDetails()
          refreshSceneEnvironment()
          invalidate()
        },
        discard: () => {},
      })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
```

- [ ] **Step 3: Type-check + full suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, 370 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D handle - dropToFloor, centerOnPlate"
```

---

## Task 4: `TransformSection` component

**Files:**
- Create: `src/components/prepare/TransformSection.tsx`
- Test: `src/components/prepare/TransformSection.test.tsx`

**Interfaces:**
- Consumes: `useViewerStore` (`geometryDetails`, `measurementUnit`, `splitParts`, `measureMode`); `toMm` from `../../services/unitConversion`; `Viewer3DHandle` type from `../Viewer3D` with the six methods added in Tasks 1-3 (`moveModelBy`, `rotateModelBy`, `scaleModelByAxes`, `mirrorModel`, `dropToFloor`, `centerOnPlate`).
- Produces: `TransformSection({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransformSection } from './TransformSection'
import { useViewerStore } from '../../store/viewerStore'

const details = {
  width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: 1,
}

describe('TransformSection', () => {
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, measurementUnit: 'mm', splitParts: [], measureMode: false,
    }),
  )

  it('locks every control while split by shell', () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'a', triangleCount: 1, visible: true }] })
    render(<TransformSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Apply move' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Mirror Y' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Drop to floor' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables Apply move until an axis has a value', async () => {
    render(<TransformSection viewerRef={{ current: null }} />)
    expect((screen.getByRole('button', { name: 'Apply move' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Move x'), '5')
    expect((screen.getByRole('button', { name: 'Apply move' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('converts move mm to a raw-unit delta, leaves untouched axes at 0, and resets the inputs', async () => {
    const moveModelBy = vi.fn()
    render(<TransformSection viewerRef={{ current: { moveModelBy } as never }} />)
    await userEvent.type(screen.getByLabelText('Move x'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Apply move' }))
    expect(moveModelBy).toHaveBeenCalledWith({ x: 10, y: 0, z: 0 })
    expect((screen.getByLabelText('Move x') as HTMLInputElement).value).toBe('')
  })

  it('converts rotate degrees to radians', async () => {
    const rotateModelBy = vi.fn()
    render(<TransformSection viewerRef={{ current: { rotateModelBy } as never }} />)
    await userEvent.type(screen.getByLabelText('Rotate y'), '90')
    await userEvent.click(screen.getByRole('button', { name: 'Apply rotate' }))
    expect(rotateModelBy).toHaveBeenCalledWith({ x: 0, y: Math.PI / 2, z: 0 })
  })

  it('leaves blank scale axes at factor 1 and rejects a non-positive value', async () => {
    const scaleModelByAxes = vi.fn()
    render(<TransformSection viewerRef={{ current: { scaleModelByAxes } as never }} />)
    await userEvent.type(screen.getByLabelText('Scale (free) y'), '2')
    await userEvent.type(screen.getByLabelText('Scale (free) z'), '-1')
    await userEvent.click(screen.getByRole('button', { name: 'Apply scale' }))
    expect(scaleModelByAxes).toHaveBeenCalledWith({ x: 1, y: 2, z: 1 })
  })

  it('mirror, drop to floor, and center on plate call their handle methods with no args', async () => {
    const mirrorModel = vi.fn()
    const dropToFloor = vi.fn()
    const centerOnPlate = vi.fn()
    render(<TransformSection viewerRef={{ current: { mirrorModel, dropToFloor, centerOnPlate } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mirror Y' }))
    expect(mirrorModel).toHaveBeenCalledWith('y')
    await userEvent.click(screen.getByRole('button', { name: 'Drop to floor' }))
    expect(dropToFloor).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Center on plate' }))
    expect(centerOnPlate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/TransformSection.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { toMm } from '../../services/unitConversion'
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

  const moveHasAny = hasAnyAxisValue(move)
  const rotateHasAny = hasAnyAxisValue(rotate)
  const scaleHasAny = hasAnyAxisValue(scale)

  const applyMove = () => {
    if (!moveHasAny) return
    const delta = parseAxisInputs(move, (mm) => toMm(mm, unit) / scaleUnit, 0)
    viewerRef.current?.moveModelBy(delta)
    setMove(BLANK)
  }
  const applyRotate = () => {
    if (!rotateHasAny) return
    const delta = parseAxisInputs(rotate, (deg) => (deg * Math.PI) / 180, 0)
    viewerRef.current?.rotateModelBy(delta)
    setRotate(BLANK)
  }
  const applyScale = () => {
    if (!scaleHasAny) return
    const raw = parseAxisInputs(scale, (f) => f, 1)
    const safe = {
      x: raw.x > 0 ? raw.x : 1,
      y: raw.y > 0 ? raw.y : 1,
      z: raw.z > 0 ? raw.z : 1,
    }
    viewerRef.current?.scaleModelByAxes(safe)
    setScale(BLANK)
  }

  const axisInputs = (
    label: string,
    values: AxisStrings,
    setValues: (v: AxisStrings) => void,
    unitLabel: string,
  ) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</span>
      <div className="flex gap-2">
        {AXES.map((axis) => (
          <input
            key={axis}
            aria-label={`${label} ${axis}`}
            inputMode="decimal"
            placeholder={axis}
            value={values[axis]}
            disabled={locked}
            onChange={(e) => setValues({ ...values, [axis]: e.target.value })}
            className="w-16 bg-[var(--bg-button)] rounded px-2 py-1 text-sm font-mono"
          />
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
      <div className="mt-3 flex flex-col gap-3">
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
        <button
          type="button"
          disabled={locked || !scaleHasAny}
          onClick={applyScale}
          className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
        >
          Apply scale
        </button>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Mirror</span>
          <div className="flex gap-2">
            {AXES.map((axis) => (
              <button
                key={axis}
                type="button"
                disabled={locked}
                onClick={() => viewerRef.current?.mirrorModel(axis)}
                className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
              >
                Mirror {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={locked}
            onClick={() => viewerRef.current?.dropToFloor()}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
          >
            Drop to floor
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => viewerRef.current?.centerOnPlate()}
            className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm disabled:opacity-50"
          >
            Center on plate
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/prepare/TransformSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/TransformSection.tsx src/components/prepare/TransformSection.test.tsx
git commit -m "feat: TransformSection - move, rotate, free scale, mirror, drop to floor, center on plate"
```

---

## Task 5: mount `TransformSection` into the Prepare panel

**Files:**
- Modify: `src/components/prepare/PreparePanel.tsx`
- Test: `src/components/prepare/PreparePanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `TransformSection` from Task 4.
- Produces: `<TransformSection viewerRef={viewerRef} />` mounted after `<ScaleSection>` in `PreparePanel`'s render.

- [ ] **Step 1: Extend `PreparePanel.test.tsx`**

Add (matching the file's established pattern for the Measure/Scale mount
test):

```ts
it('renders the Transform section', () => {
  useViewerStore.setState({
    geometryDetails: {
      width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
      boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
      watertight: true, modelUnitInMm: 1,
    },
  })
  render(<PreparePanel viewerRef={{ current: null }} />)
  expect(screen.getByRole('heading', { name: 'Transform' })).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/PreparePanel.test.tsx`
Expected: FAIL, no "Transform" heading.

- [ ] **Step 3: Wire `PreparePanel.tsx`**

Add the import:

```tsx
import { TransformSection } from './TransformSection'
```

Add the mount, after `<ScaleSection viewerRef={viewerRef} />`:

```tsx
      <TransformSection viewerRef={viewerRef} />
```

- [ ] **Step 4: Run test to verify it passes, then the full suite**

Run: `pnpm test -- src/components/prepare/PreparePanel.test.tsx`
Expected: PASS.

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, all tests pass (370 existing + this file's new test + Task 4's new file).

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/PreparePanel.tsx src/components/prepare/PreparePanel.test.tsx
git commit -m "feat: mount TransformSection into the Prepare panel"
```

---

## Task 6: end-to-end spec (hard completion gate)

**Files:**
- Create: `e2e/transform-panel.spec.ts`

Follow the structure of `e2e/units-measure.spec.ts` and `e2e/prepare-panel.spec.ts`: deterministic inline STL, `.filter({ visible: true })` on every panel locator (desktop + hidden-mobile double sidebar mount), `test.skip(isMobile, ...)`, `test.setTimeout(120_000)`.

**Rationale for the assertion strategy (record this — do not weaken it in
review without updating this note):** the fixture is a non-cube box
(20 x 10 x 5 mm) specifically so a 90-degree rotation about X visibly swaps
the Height/Depth readout values — a cube would make Rotate's effect
invisible to the Dimensions readout. Move / Mirror / Drop-to-floor /
Center-on-plate have no dedicated DOM readout for position, so their
assertion is that the exact undo-history label appears (proves the click
reached the store and `pushUndo` ran, which requires `modelRoots().length >
0` inside the handle method — a deleted or dead-on-arrival handler would
leave the list empty) and that Undo removes it. This is the same
handle-methods-are-e2e-verified-not-unit-tested pattern SP-3a used for
`scaleModelBy`/`resetMeasure`, which passed a from-scratch final review
clean.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test'

/** ASCII STL of an axis-aligned box: width=20 (X), height=10 (Y), depth=5 (Z).
 *  Deliberately non-cube so a 90-degree rotation about X visibly swaps the
 *  Height/Depth readout. */
function boxStl(w: number, h: number, d: number): string {
  const v = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ]
  const tris = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6],
    [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
  ]
  let out = 'solid box\n'
  for (const [a, b, c] of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid box\n'
}

async function dropStl(page: Page, stl: string, name: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(({ stl, name }) => {
    const file = new File([stl], name, { type: 'model/stl' })
    const dt = new DataTransfer()
    dt.items.add(file)
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, { stl, name })
  await expect(page.getByRole('banner')).toContainText(name)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test.describe('Transform panel', () => {
  test('moves, rotates, scales, mirrors, drops to floor, and centers, each undoable', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Transform flow verified on desktop')
    test.setTimeout(120_000)

    await dropStl(page, boxStl(20, 10, 5), 'box.stl')

    const readout = page.getByTestId('dimensions-readout').filter({ visible: true })
    const rowValue = (label: string) =>
      readout.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]')
    const undoHistory = () => page.getByTestId('undo-history').filter({ visible: true })
    const undoAndCheckGone = async (label: string) => {
      await undoHistory().getByRole('button', { name: new RegExp(label, 'i') }).click()
      await expect(page.getByTestId('undo-history').filter({ visible: true })).toHaveCount(0)
    }

    // Open the sidebar and select the Prepare tab (SP-1's single toolbar
    // control); the sidebar's own Details/Prepare tab strip (role="tab")
    // is then used for every further switch, matching how SP-3a's e2e
    // discovered the real DOM (task-13-report.md).
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    // Baseline dimensions before any transform.
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(rowValue('Width')).toHaveText('20 mm')
    await expect(rowValue('Height')).toHaveText('10 mm')
    await expect(rowValue('Depth')).toHaveText('5 mm')
    await page.getByRole('tab', { name: 'Prepare' }).click()

    // Move: no dimension readout can confirm displacement; the undo entry
    // proves moveModelBy ran and pushed an edit.
    await page.getByLabel('Move x').fill('5')
    await page.getByRole('button', { name: 'Apply move' }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Move'])
    await undoAndCheckGone('Move')

    // Rotate 90 deg about X swaps Height and Depth (10 <-> 5).
    await page.getByLabel('Rotate x').fill('90')
    await page.getByRole('button', { name: 'Apply rotate' }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Rotate'])
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(rowValue('Height')).toHaveText('5 mm')
    await expect(rowValue('Depth')).toHaveText('10 mm')
    await page.getByRole('tab', { name: 'Prepare' }).click()
    await undoAndCheckGone('Rotate')
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(rowValue('Height')).toHaveText('10 mm')
    await expect(rowValue('Depth')).toHaveText('5 mm')
    await page.getByRole('tab', { name: 'Prepare' }).click()

    // Free scale Y x2 doubles the Height reading only (10 -> 20).
    await page.getByLabel('Scale (free) y').fill('2')
    await page.getByRole('button', { name: 'Apply scale' }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Scale (free)'])
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(rowValue('Height')).toHaveText('20 mm')
    await expect(rowValue('Width')).toHaveText('20 mm') // unchanged, still 20
    await page.getByRole('tab', { name: 'Prepare' }).click()
    await undoAndCheckGone('Scale')
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(rowValue('Height')).toHaveText('10 mm')
    await page.getByRole('tab', { name: 'Prepare' }).click()

    // Mirror X: dimensions unchanged, undo entry is the signal.
    await page.getByRole('button', { name: 'Mirror X' }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Mirror X'])
    await undoAndCheckGone('Mirror X')

    // Drop to floor / Center on plate: no readout to check, undo entry is the signal.
    await page.getByRole('button', { name: 'Drop to floor' }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Drop to floor'])
    await undoAndCheckGone('Drop to floor')

    await page.getByRole('button', { name: 'Center on plate' }).click()
    await expect(undoHistory().getByRole('button')).toHaveText(['Center on plate'])
    await undoAndCheckGone('Center on plate')
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/transform-panel.spec.ts` (or the repo's
`pnpm test:e2e -- transform-panel` if that script exists — check
`package.json` for the exact invocation, matching how SP-3a's e2e task ran
it).
Expected: 1 passed (desktop), 1 skipped (mobile project). If any selector
doesn't match the real rendered DOM (tab names, `dt`/`dd` structure, the
`Prepare` toolbar button's accessible name), adjust the selector to what
`e2e/prepare-panel.spec.ts` and `e2e/units-measure.spec.ts` already
established — those are the source of truth for real DOM shape, not this
plan's guess. Do not add retries or waits beyond what those files already
use.

- [ ] **Step 3: Commit**

```bash
git add e2e/transform-panel.spec.ts
git commit -m "test: e2e move, rotate, scale, mirror, drop to floor, center on plate, each undoable"
```

---

## Task 7: docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** — add a short "Transform panel" entry alongside the
  SP-3a units/measure entry: move, rotate, free (per-axis) scale, mirror,
  drop-to-floor, center-on-plate. Match the surrounding feature-list style.

- [ ] **Step 2: CHANGELOG** — add an entry under the current/next version
  heading, matching the SP-3a entry's format:

```
- Prepare panel: transform tools (SP-3b). Move, rotate, and free (per-axis)
  scale as nudge controls; mirror, drop-to-floor, and center-on-plate as
  one-click actions. Each is a single undoable edit. Closes SP-3
  (units + measure + transform).
```

- [ ] **Step 3: roadmap** — in
  `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`, extend the
  SP-3 decomposition (added by SP-3a) with an SP-3b row: SHIPPED, branch
  name, commit range (fill in from `git log` once Task 1-6 commits exist),
  files touched (the 6 `Viewer3D` handle methods, `TransformSection.tsx`,
  `PreparePanel.tsx` mount), spec link
  `../specs/2026-09-05-sp3b-transform-panel-design.md`, plan link
  `../plans/2026-09-05-sp3b-transform-panel.md`. Note that **SP-3 (units +
  measure + transform) is now complete** (mirrors the SP-2 table's closing
  note style) and that the next roadmap item is SP-4 (analysis heatmaps).

- [ ] **Step 4: Sanity check**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS (no code change, sanity only).

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-3b transform panel; SP-3 complete"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| Move (delta, mm/cm/in -> raw units) | 1, 4 |
| Rotate (delta, degrees -> radians) | 1, 4 |
| Free scale (per-axis multiplier, blank = 1) | 2, 4 |
| Mirror X/Y/Z | 2, 4 |
| Drop to floor (union box, world-Y) | 3, 4 |
| Center on plate (union box, world X/Z) | 3, 4 |
| Lock conditions + reason text | 4 |
| Multi-model: per-root for move/rotate/scale/mirror, one shared delta for drop/center | 1, 2, 3 |
| Undo entries (bespoke, capture only the changed field) | 1, 2, 3 |
| Mount into Prepare panel | 5 |
| E2e hard gate | 6 |
| Docs, SP-3 closed | 7 |

Non-goals (absolute-position entry, rotation order picker, quick-90 buttons,
snap-to-grid, per-part transforms after split, live-preview mirror shading
fix) are explicitly out and have no task, as intended.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N".
Every code step has full code. Task 6 Step 2's "adjust the selector to
what the real DOM shows" points at two concrete existing files as the
source of truth, not unspecified work — same pattern SP-3a's plan used for
its own e2e task, which needed no such adjustment in practice.

**3. Type consistency:** `moveModelBy({x,y,z})` / `rotateModelBy({x,y,z})` —
Tasks 1, 4. `scaleModelByAxes({x,y,z})` / `mirrorModel(axis)` — Tasks 2, 4.
`dropToFloor()` / `centerOnPlate()` — Tasks 3, 4 (no-arg, matches). All six
consumed by `TransformSection` with the exact same argument shapes defined
in Tasks 1-3. `parseAxisInputs`/`hasAnyAxisValue` used consistently across
Task 4's implementation and its own tests. Undo labels (`'Move'`,
`'Rotate'`, `'Scale (free)'`, `` `Mirror ${axis.toUpperCase()}` ``,
`'Drop to floor'`, `'Center on plate'`) match between Tasks 1-3's handle
code and Task 6's e2e assertions exactly, including case.
