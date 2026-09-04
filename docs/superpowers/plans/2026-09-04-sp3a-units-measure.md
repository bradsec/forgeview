# SP-3a: Units + Measure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Forge View a real-world scale: confirm/correct the import unit for unitless formats, show the bounding box in mm/cm/in, measure a distance between two picked surface points, and scale the model to a target dimension or to fit a build volume.

**Architecture:** Two pure services (`unitConversion.ts`, `scaleMath.ts`) hold all maths. A `measureOverlay.ts` Three service builds/picks/disposes the scene-level markers + line (no `WebGLRenderer`, jsdom-testable). `Viewer3D` gains four handle methods (`setModelUnit`, `getModelDimensionsMm`, `scaleModelBy`, `resetMeasure`) and one `measureMode` pick-loop effect modelled on the existing hole-fill effect. Scale is applied to each model root's `.scale` (the exporter already bakes `matrixWorld`) as one `UndoEntry`. Four small Prepare/Details components render the UI. The SP-1 "On build plate" readiness row is wired from `buildVolumeMm` + mm dimensions.

**Tech Stack:** React 19, Three 0.185, Zustand 5, Vitest, Playwright, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-04-sp3a-units-measure-design.md`

## Global Constraints

- **No new npm dependency.** Reuse `three`, the SP-2a undo stack (`pushUndo` / `UndoEntry` in `Viewer3D`), the SP-2c overlay/badge pattern, `@testing-library/react` + Vitest, Playwright.
- **Assumed unit for unitless formats is mm** (`modelUnitInMm = 1`). Model loads immediately; the prompt is a non-blocking correction, never a modal.
- **Display unit UI offers `mm`, `cm`, `in`.** The `'m'` member of `MeasurementUnit` stays in the type; `unitConversion` supports all four; the UI does not offer `m`.
- **Scale is uniform only** in SP-3a. Applied to root `.scale`, never to geometry positions. Non-uniform/free scale, move, rotate, mirror, drop-to-floor are SP-3b.
- **No persistence.** Assumed unit resets to mm per import; `measurementUnit` and `buildVolumeMm` are in-memory store state with defaults.
- **`DEFAULT_BUILD_VOLUME_MM = { x: 220, y: 220, z: 250 }`.**
- **`SCALE_FACTOR_BOUNDS = { min: 1e-4, max: 1e4 }`.** A computed factor outside this (or non-finite / `<= 0`) blocks the action.
- **Scale section is disabled** when `geometryDetails === null`, `splitParts.length > 0`, or `measureMode` is on.
- **Measure auto-disarms** when `repairDialogOpen` turns true and on model unload (`setFile` / `setFileFromBuffer`), matching hole-fill.
- Every behaviour change updates the README + CHANGELOG in the same cycle (Task 14).
- Run `pnpm test` (unit) and `pnpm exec tsc --noEmit` after each task; `pnpm test:e2e` for Task 13.

---

## Task 1: `unitConversion.ts` pure service

**Files:**
- Create: `src/services/unitConversion.ts`
- Test: `src/services/unitConversion.test.ts`

**Interfaces:**
- Consumes: `MeasurementUnit` from `../store/viewerStore` (`'mm' | 'cm' | 'm' | 'in'`).
- Produces:
  - `UNIT_IN_MM: Record<MeasurementUnit, number>` — `{ mm: 1, cm: 10, m: 1000, in: 25.4 }`.
  - `toMm(value: number, unit: MeasurementUnit): number`
  - `fromMm(mm: number, unit: MeasurementUnit): number`
  - `formatLength(value: number, unit: MeasurementUnit): string` — value already in `unit`; up to 2 decimals, trailing zeros trimmed, unit suffixed (e.g. `"100 mm"`, `"3.94 in"`). Non-finite input -> `"—"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { UNIT_IN_MM, toMm, fromMm, formatLength } from './unitConversion'

describe('unitConversion', () => {
  it('has the standard scale table', () => {
    expect(UNIT_IN_MM).toEqual({ mm: 1, cm: 10, m: 1000, in: 25.4 })
  })

  it('converts to and from mm', () => {
    expect(toMm(5, 'cm')).toBe(50)
    expect(toMm(1, 'in')).toBeCloseTo(25.4)
    expect(fromMm(50, 'cm')).toBe(5)
    expect(fromMm(25.4, 'in')).toBeCloseTo(1)
  })

  it('round-trips', () => {
    for (const u of ['mm', 'cm', 'm', 'in'] as const) {
      expect(fromMm(toMm(12.5, u), u)).toBeCloseTo(12.5)
    }
  })

  it('formats with trimmed decimals and a unit suffix', () => {
    expect(formatLength(100, 'mm')).toBe('100 mm')
    expect(formatLength(3.937, 'in')).toBe('3.94 in')
    expect(formatLength(2.5, 'cm')).toBe('2.5 cm')
    expect(formatLength(Number.NaN, 'mm')).toBe('—')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/unitConversion.test.ts`
Expected: FAIL, `unitConversion` module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/unitConversion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/unitConversion.ts src/services/unitConversion.test.ts
git commit -m "feat: unitConversion — mm/cm/m/in scale table, convert, format"
```

---

## Task 2: `scaleMath.ts` pure service

**Files:**
- Create: `src/services/scaleMath.ts`
- Test: `src/services/scaleMath.test.ts`

**Interfaces:**
- Produces:
  - `SCALE_FACTOR_BOUNDS: { min: number; max: number }` — `{ min: 1e-4, max: 1e4 }`.
  - `isFactorInBounds(factor: number): boolean` — finite, `> 0`, within `[min, max]`.
  - `scaleToTargetFactor(currentMm: number, targetMm: number): number` — `targetMm / currentMm`; returns `NaN` when `currentMm <= 0` or either arg non-finite or `targetMm <= 0`.
  - `scaleToFitFactor(dimsMm: { width: number; height: number; depth: number }, plateMm: { x: number; y: number; z: number }): number` — `min(x/width, y/height, z/depth)`; returns `NaN` when any dimension `<= 0` or any input non-finite.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  SCALE_FACTOR_BOUNDS,
  isFactorInBounds,
  scaleToTargetFactor,
  scaleToFitFactor,
} from './scaleMath'

describe('scaleMath', () => {
  it('exposes the factor bounds', () => {
    expect(SCALE_FACTOR_BOUNDS).toEqual({ min: 1e-4, max: 1e4 })
  })

  it('validates factors', () => {
    expect(isFactorInBounds(1)).toBe(true)
    expect(isFactorInBounds(0)).toBe(false)
    expect(isFactorInBounds(-2)).toBe(false)
    expect(isFactorInBounds(1e5)).toBe(false)
    expect(isFactorInBounds(Number.NaN)).toBe(false)
  })

  it('computes scale-to-target', () => {
    expect(scaleToTargetFactor(50, 100)).toBe(2)
    expect(scaleToTargetFactor(0, 100)).toBeNaN()
    expect(scaleToTargetFactor(50, 0)).toBeNaN()
  })

  it('computes scale-to-fit from the limiting axis', () => {
    const f = scaleToFitFactor({ width: 100, height: 50, depth: 25 }, { x: 200, y: 200, z: 200 })
    expect(f).toBe(2) // width is limiting: 200/100
    expect(scaleToFitFactor({ width: 0, height: 1, depth: 1 }, { x: 1, y: 1, z: 1 })).toBeNaN()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/scaleMath.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/scaleMath.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/scaleMath.ts src/services/scaleMath.test.ts
git commit -m "feat: scaleMath — scale-to-target and scale-to-fit factor helpers"
```

---

## Task 3: viewerStore fields for measure + build volume

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts`

**Interfaces:**
- Produces (new store state + actions):
  - `DEFAULT_BUILD_VOLUME_MM: { x: number; y: number; z: number }` exported constant `{ x: 220, y: 220, z: 250 }`.
  - `measureMode: boolean` (default `false`)
  - `measureDistanceMm: number | null` (default `null`)
  - `buildVolumeMm: { x: number; y: number; z: number }` (default a copy of `DEFAULT_BUILD_VOLUME_MM`)
  - `setMeasureMode(on: boolean): void` — turning off also clears `measureDistanceMm`.
  - `setMeasureDistanceMm(mm: number | null): void`
  - `setBuildVolumeMm(v: { x: number; y: number; z: number }): void`
  - `resetBuildVolumeMm(): void`
  - `setFile` / `setFileFromBuffer` also reset `measureMode: false`, `measureDistanceMm: null`.

- [ ] **Step 1: Write the failing test** (append to `viewerStore.test.ts`)

```ts
import { DEFAULT_BUILD_VOLUME_MM } from './viewerStore'

describe('units + measure state', () => {
  beforeEach(() => {
    useViewerStore.setState({
      measureMode: false,
      measureDistanceMm: null,
      buildVolumeMm: { ...DEFAULT_BUILD_VOLUME_MM },
    })
  })

  it('defaults', () => {
    const s = useViewerStore.getState()
    expect(s.measureMode).toBe(false)
    expect(s.measureDistanceMm).toBeNull()
    expect(s.buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 })
  })

  it('turning measure off clears the distance', () => {
    useViewerStore.getState().setMeasureMode(true)
    useViewerStore.getState().setMeasureDistanceMm(42)
    useViewerStore.getState().setMeasureMode(false)
    expect(useViewerStore.getState().measureDistanceMm).toBeNull()
  })

  it('build volume set + reset', () => {
    useViewerStore.getState().setBuildVolumeMm({ x: 300, y: 300, z: 400 })
    expect(useViewerStore.getState().buildVolumeMm).toEqual({ x: 300, y: 300, z: 400 })
    useViewerStore.getState().resetBuildVolumeMm()
    expect(useViewerStore.getState().buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 })
  })

  it('setFile clears measure state', () => {
    useViewerStore.getState().setMeasureMode(true)
    useViewerStore.getState().setMeasureDistanceMm(9)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    expect(useViewerStore.getState().measureMode).toBe(false)
    expect(useViewerStore.getState().measureDistanceMm).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: FAIL, `DEFAULT_BUILD_VOLUME_MM` undefined / actions missing.

- [ ] **Step 3: Write minimal implementation**

Near the top of `viewerStore.ts` (after the `MeasurementUnit` type):

```ts
export const DEFAULT_BUILD_VOLUME_MM = { x: 220, y: 220, z: 250 } as const
```

In the `ViewerState` interface, alongside the hole-fill fields:

```ts
  measureMode: boolean
  measureDistanceMm: number | null
  buildVolumeMm: { x: number; y: number; z: number }
  setMeasureMode: (on: boolean) => void
  setMeasureDistanceMm: (mm: number | null) => void
  setBuildVolumeMm: (v: { x: number; y: number; z: number }) => void
  resetBuildVolumeMm: () => void
```

In `create()` defaults (near `holeFillStatus: null,`):

```ts
  measureMode: false,
  measureDistanceMm: null,
  buildVolumeMm: { ...DEFAULT_BUILD_VOLUME_MM },
```

Actions (near `setHoleFillStatus`):

```ts
  setMeasureMode: (on) =>
    set(on ? { measureMode: true } : { measureMode: false, measureDistanceMm: null }),
  setMeasureDistanceMm: (mm) => set({ measureDistanceMm: mm }),
  setBuildVolumeMm: (v) => set({ buildVolumeMm: v }),
  resetBuildVolumeMm: () => set({ buildVolumeMm: { ...DEFAULT_BUILD_VOLUME_MM } }),
```

In both `setFile` and `setFileFromBuffer` `set({ ... })` objects, add:

```ts
      measureMode: false, measureDistanceMm: null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: store fields for measure mode, measured distance, build volume"
```

---

## Task 4: `measureOverlay.ts` Three service

**Files:**
- Create: `src/services/measureOverlay.ts`
- Test: `src/services/measureOverlay.test.ts`

**Interfaces:**
- Produces:
  - `interface MeasureOverlay { group: THREE.Group; markerA: THREE.Mesh; markerB: THREE.Mesh; line: THREE.Line; pointA: THREE.Vector3 | null; pointB: THREE.Vector3 | null }`
  - `buildMeasureOverlay(markerRadius: number): MeasureOverlay` — group has `userData.measureOverlay = true`; markers hidden until placed; `renderOrder` high, `depthTest: false`.
  - `setMeasurePoint(ov: MeasureOverlay, p: THREE.Vector3): 'A' | 'B' | 'reset'` — 1st call places A; 2nd places B + line; a 3rd call clears B/line and restarts with the new point as A.
  - `measureDistance(ov: MeasureOverlay, unitInMm: number): number | null` — `null` unless both points set; else `|A-B| * unitInMm`.
  - `pickSurfacePoint(meshes: THREE.Mesh[], raycaster: THREE.Raycaster): THREE.Vector3 | null` — nearest hit's world-space `point`, cloned.
  - `disposeMeasureOverlay(ov: MeasureOverlay): void` — frees geometries + the shared marker material + line material, detaches the group.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  buildMeasureOverlay,
  setMeasurePoint,
  measureDistance,
  pickSurfacePoint,
  disposeMeasureOverlay,
} from './measureOverlay'

describe('measureOverlay', () => {
  it('builds a tagged group with hidden markers and line', () => {
    const ov = buildMeasureOverlay(0.5)
    expect(ov.group.userData.measureOverlay).toBe(true)
    expect(ov.markerA.visible).toBe(false)
    expect(ov.markerB.visible).toBe(false)
    expect(ov.line.visible).toBe(false)
  })

  it('places A, then B, then restarts on the third point', () => {
    const ov = buildMeasureOverlay(0.5)
    expect(setMeasurePoint(ov, new THREE.Vector3(0, 0, 0))).toBe('A')
    expect(ov.markerA.visible).toBe(true)
    expect(setMeasurePoint(ov, new THREE.Vector3(3, 4, 0))).toBe('B')
    expect(ov.line.visible).toBe(true)
    expect(measureDistance(ov, 1)).toBeCloseTo(5)
    expect(measureDistance(ov, 10)).toBeCloseTo(50)
    expect(setMeasurePoint(ov, new THREE.Vector3(9, 9, 9))).toBe('reset')
    expect(ov.pointB).toBeNull()
    expect(ov.line.visible).toBe(false)
    expect(measureDistance(ov, 1)).toBeNull()
  })

  it('picks the nearest surface hit', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    mesh.updateMatrixWorld(true)
    const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    const p = pickSurfacePoint([mesh], rc)
    expect(p).not.toBeNull()
    expect(p!.z).toBeCloseTo(1)
    const miss = new THREE.Raycaster(new THREE.Vector3(10, 10, 5), new THREE.Vector3(0, 0, -1))
    expect(pickSurfacePoint([mesh], miss)).toBeNull()
  })

  it('dispose detaches the group', () => {
    const scene = new THREE.Scene()
    const ov = buildMeasureOverlay(0.5)
    scene.add(ov.group)
    disposeMeasureOverlay(ov)
    expect(ov.group.parent).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/measureOverlay.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import * as THREE from 'three'

export interface MeasureOverlay {
  group: THREE.Group
  markerA: THREE.Mesh
  markerB: THREE.Mesh
  line: THREE.Line
  pointA: THREE.Vector3 | null
  pointB: THREE.Vector3 | null
}

export function buildMeasureOverlay(markerRadius: number): MeasureOverlay {
  const mat = new THREE.MeshBasicMaterial({ color: 0x4c9ffe, depthTest: false })
  const geoA = new THREE.SphereGeometry(markerRadius, 16, 12)
  const geoB = geoA.clone()
  const markerA = new THREE.Mesh(geoA, mat)
  const markerB = new THREE.Mesh(geoB, mat)
  markerA.visible = markerB.visible = false
  markerA.renderOrder = markerB.renderOrder = 1000

  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ])
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x4c9ffe, depthTest: false }))
  line.visible = false
  line.renderOrder = 1000

  const group = new THREE.Group()
  group.userData.measureOverlay = true
  group.add(markerA, markerB, line)
  return { group, markerA, markerB, line, pointA: null, pointB: null }
}

export function setMeasurePoint(ov: MeasureOverlay, p: THREE.Vector3): 'A' | 'B' | 'reset' {
  if (ov.pointA && ov.pointB) {
    ov.pointB = null
    ov.markerB.visible = false
    ov.line.visible = false
    ov.pointA = p.clone()
    ov.markerA.position.copy(p)
    ov.markerA.visible = true
    return 'reset'
  }
  if (!ov.pointA) {
    ov.pointA = p.clone()
    ov.markerA.position.copy(p)
    ov.markerA.visible = true
    return 'A'
  }
  ov.pointB = p.clone()
  ov.markerB.position.copy(p)
  ov.markerB.visible = true
  const attr = ov.line.geometry.getAttribute('position') as THREE.BufferAttribute
  attr.setXYZ(0, ov.pointA.x, ov.pointA.y, ov.pointA.z)
  attr.setXYZ(1, ov.pointB.x, ov.pointB.y, ov.pointB.z)
  attr.needsUpdate = true
  ov.line.geometry.computeBoundingSphere()
  ov.line.visible = true
  return 'B'
}

export function measureDistance(ov: MeasureOverlay, unitInMm: number): number | null {
  if (!ov.pointA || !ov.pointB) return null
  return ov.pointA.distanceTo(ov.pointB) * unitInMm
}

export function pickSurfacePoint(
  meshes: THREE.Mesh[],
  raycaster: THREE.Raycaster,
): THREE.Vector3 | null {
  const hit = raycaster.intersectObjects(meshes, false)[0]
  return hit ? hit.point.clone() : null
}

export function disposeMeasureOverlay(ov: MeasureOverlay): void {
  ov.markerA.geometry.dispose()
  ov.markerB.geometry.dispose()
  ;(ov.markerA.material as THREE.Material).dispose()
  ov.line.geometry.dispose()
  ;(ov.line.material as THREE.Material).dispose()
  ov.group.parent?.remove(ov.group)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/measureOverlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/measureOverlay.ts src/services/measureOverlay.test.ts
git commit -m "feat: measureOverlay — two-point marker/line overlay + surface pick"
```

---

## Task 5: wire the "On build plate" readiness row

**Files:**
- Modify: `src/services/prepChecks.ts`
- Test: `src/services/prepChecks.test.ts`

**Interfaces:**
- Consumes: `GeometryDetails`, `buildVolumeMm` shape from Task 3.
- Produces: `prepChecks(details, sealApplied = false, buildVolumeMm?: { x: number; y: number; z: number }): PrepCheck[]`. When `details` and `buildVolumeMm` are both present, the `onPlate` row is `pass` ("Within build volume") when `w<=x && h<=y && d<=z` using `w = details.width * (details.modelUnitInMm ?? 1)` etc., else `fail` ("Exceeds build volume", `fixId: 'scale'`). Without `buildVolumeMm` the row stays `unavailable` as today.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('on-plate row', () => {
  const base = {
    width: 100, height: 100, depth: 100, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1,
  }

  it('passes when the model fits the plate', () => {
    const rows = prepChecks(base, false, { x: 220, y: 220, z: 250 })
    const row = rows.find((r) => r.id === 'onPlate')!
    expect(row.state).toBe('pass')
  })

  it('fails with a scale fix when an axis exceeds the plate', () => {
    const rows = prepChecks({ ...base, width: 300 }, false, { x: 220, y: 220, z: 250 })
    const row = rows.find((r) => r.id === 'onPlate')!
    expect(row.state).toBe('fail')
    expect(row.fixId).toBe('scale')
  })

  it('respects modelUnitInMm', () => {
    const rows = prepChecks({ ...base, width: 30, modelUnitInMm: 10 }, false, { x: 220, y: 220, z: 250 })
    // 30 * 10 = 300 mm > 220
    expect(rows.find((r) => r.id === 'onPlate')!.state).toBe('fail')
  })

  it('stays unavailable without a build volume', () => {
    const rows = prepChecks(base, false)
    expect(rows.find((r) => r.id === 'onPlate')!.state).toBe('unavailable')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/prepChecks.test.ts`
Expected: FAIL (row is `unavailable`, no `fixId`).

- [ ] **Step 3: Write minimal implementation**

Change the signature and the `ANALYSIS_ROWS.map` in the `details` branch only:

```ts
export function prepChecks(
  details: GeometryDetails | null,
  sealApplied = false,
  buildVolumeMm?: { x: number; y: number; z: number },
): PrepCheck[] {
```

In the `rows` array, replace the `...ANALYSIS_ROWS.map(...)` spread with:

```ts
    ...ANALYSIS_ROWS.map((row) => {
      if (row.id === 'onPlate' && buildVolumeMm) {
        const s = details.modelUnitInMm ?? 1
        const w = details.width * s
        const h = details.height * s
        const d = details.depth * s
        const fits = w <= buildVolumeMm.x && h <= buildVolumeMm.y && d <= buildVolumeMm.z
        return fits
          ? { ...row, state: 'pass' as const, detail: 'Within build volume' }
          : { ...row, state: 'fail' as const, detail: 'Exceeds build volume', fixId: 'scale' }
      }
      return { ...row, state: 'unavailable' as const, detail: 'Available in a later update' }
    }),
```

(The `!details` branch is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/prepChecks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/prepChecks.ts src/services/prepChecks.test.ts
git commit -m "feat: wire the On build plate readiness row from the build volume"
```

---

## Task 6: Viewer3D handle — `setModelUnit`, `getModelDimensionsMm`, `scaleModelBy`

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test: the imperative handle needs refs the `WebGLRenderer` effect populates, and jsdom has no WebGL (`Viewer3D.test.tsx` only covers exported pure helpers + the WebGL-less error path). These methods are covered by the Task 13 e2e; their maths live in the tested pure services.

**Interfaces:**
- Consumes: `modelRoots()`, `updateGeometryDetails()`, `refreshSceneEnvironment()`, `invalidate()`, `pushUndo()` (all already in `Viewer3D`); `THREE`.
- Produces (added to `Viewer3DHandle`):
  - `setModelUnit(mm: number): void` — writes `userData.modelUnitInMm = mm` on every root whose value is not a number, then `updateGeometryDetails()`.
  - `getModelDimensionsMm(): THREE.Vector3 | null` — union `Box3` size times `(geometryDetails.modelUnitInMm ?? 1)`.
  - `scaleModelBy(factor: number, label: string): void` — no-op when no roots or `factor` non-finite / `<= 0`; else multiply each root `.scale` by `factor`, `pushUndo` an entry that restores the captured pre-scale `.scale` vectors and re-runs `updateGeometryDetails()` + `refreshSceneEnvironment()` + `invalidate()`, `discard: () => {}`; after pushing, run the same three refreshers.

- [ ] **Step 1: Extend the `Viewer3DHandle` interface**

In `Viewer3DHandle` (after `getModelDimensions`):

```ts
  /** Assign `modelUnitInMm` to every root that has none (unitless STL/OBJ/PLY). */
  setModelUnit: (mm: number) => void
  /** Union bounding-box size in millimetres, or null when no model is open. */
  getModelDimensionsMm: () => THREE.Vector3 | null
  /** Uniformly scale every model root by `factor` as one undoable edit. */
  scaleModelBy: (factor: number, label: string) => void
```

- [ ] **Step 2: Add the handle methods**

In the `useImperativeHandle(ref, () => ({ ... }))` object, after `getModelDimensions`:

```ts
    setModelUnit: (mm: number) => {
      let changed = false
      for (const root of modelRoots()) {
        if (typeof root.userData.modelUnitInMm !== 'number') {
          root.userData.modelUnitInMm = mm
          changed = true
        }
      }
      if (changed) updateGeometryDetails()
    },
    getModelDimensionsMm: () => {
      const roots = modelRoots()
      if (roots.length === 0) return null
      const box = new THREE.Box3()
      for (const root of roots) box.expandByObject(root)
      const size = box.getSize(new THREE.Vector3())
      const unit = useViewerStore.getState().geometryDetails?.modelUnitInMm ?? 1
      return size.multiplyScalar(unit)
    },
    scaleModelBy: (factor: number, label: string) => {
      const roots = modelRoots()
      if (roots.length === 0 || !Number.isFinite(factor) || factor <= 0) return
      const prev = roots.map((r) => r.scale.clone())
      roots.forEach((r) => r.scale.multiplyScalar(factor))
      pushUndo({
        label,
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

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the unit suite (no regression)**

Run: `pnpm test`
Expected: PASS (unchanged count + Tasks 1-5 additions).

- [ ] **Step 5: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D handle — setModelUnit, getModelDimensionsMm, scaleModelBy"
```

---

## Task 7: Viewer3D — measure pick-loop effect + `resetMeasure`

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (WebGL-less jsdom, as Task 6). Covered by Task 13 e2e.

**Interfaces:**
- Consumes: `measureMode`, `setMeasureMode`, `setMeasureDistanceMm`, `measurementUnit`, `geometryDetails` from the store; `repairDialogOpen`; `buildMeasureOverlay` / `setMeasurePoint` / `measureDistance` / `pickSurfacePoint` / `disposeMeasureOverlay` from `../services/measureOverlay`; `fromMm` / `formatLength` from `../services/unitConversion`; existing `withGeometry(modelMeshes())`, `rendererRef`, `sceneRef`, `cameraRef`, `mountRef`, `rendererGen`, `invalidate`.
- Produces:
  - A `measureOverlayRef` ref.
  - Effect keyed `[measureMode, rendererGen]`: builds the overlay, adds it to the scene, creates a DOM badge in `mountRef`, wires `pointerdown` (drag guard) + `click` (raycast -> `pickSurfacePoint` -> `setMeasurePoint` -> `setMeasureDistanceMm` -> badge) + `Escape` (`setMeasureMode(false)`); cleanup disposes the overlay, removes the badge and listeners, and `setMeasureDistanceMm(null)`.
  - Effect keyed `[repairDialogOpen, measureMode]`: `if (repairDialogOpen && measureMode) setMeasureMode(false)`.
  - `Viewer3DHandle.resetMeasure(): void` — clears both points, hides markers + line, `setMeasureDistanceMm(null)`, `invalidate()`.

- [ ] **Step 1: Add imports + ref**

Top of `Viewer3D.tsx` imports:

```ts
import {
  buildMeasureOverlay, setMeasurePoint, measureDistance, pickSurfacePoint,
  disposeMeasureOverlay, type MeasureOverlay,
} from '../services/measureOverlay'
import { fromMm, formatLength } from '../services/unitConversion'
```

Near `holeOverlayRef`:

```ts
  const measureOverlayRef = useRef<MeasureOverlay | null>(null)
```

- [ ] **Step 2: Add `resetMeasure` to the handle**

In `Viewer3DHandle` (after `scaleModelBy`):

```ts
  /** Clear the current measurement without leaving measure mode. */
  resetMeasure: () => void
```

In `useImperativeHandle`, after `scaleModelBy`:

```ts
    resetMeasure: () => {
      const ov = measureOverlayRef.current
      if (!ov) return
      ov.pointA = null
      ov.pointB = null
      ov.markerA.visible = false
      ov.markerB.visible = false
      ov.line.visible = false
      useViewerStore.getState().setMeasureDistanceMm(null)
      invalidate()
    },
```

- [ ] **Step 3: Add a marker-radius helper**

Near `rebuildHoleOverlays` (a plain function inside the component):

```ts
  const measureMarkerRadius = () => {
    const roots = modelRoots()
    if (roots.length === 0) return 0.01
    const box = new THREE.Box3()
    for (const root of roots) box.expandByObject(root)
    const s = box.getSize(new THREE.Vector3())
    return Math.max(Math.max(s.x, s.y, s.z) * 0.008, 1e-4)
  }
```

- [ ] **Step 4: Add the measure effect** (place right after Effect 10, the hole-fill auto-disarm)

```ts
  // Effect 10b: Measure mode — overlay lifecycle + pointer/click/key wiring.
  const measureMode = useViewerStore((s) => s.measureMode)
  useEffect(() => {
    if (!measureMode) return
    const el = rendererRef.current?.domElement
    const scene = sceneRef.current
    const mount = mountRef.current
    if (!el || !scene || !mount) return

    const overlay = buildMeasureOverlay(measureMarkerRadius())
    scene.add(overlay.group)
    measureOverlayRef.current = overlay

    const badge = document.createElement('div')
    badge.className =
      'pointer-events-none absolute z-20 px-1.5 py-0.5 rounded text-[11px] ' +
      'bg-[var(--bg-elevated,#1e1e28)] text-[var(--text-primary,#fff)] shadow'
    badge.style.display = 'none'
    mount.appendChild(badge)

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downX = 0, downY = 0
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY }

    const onClick = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return // was a drag
      const rect = el.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, cameraRef.current!)
      const p = pickSurfacePoint(withGeometry(modelMeshes()), raycaster)
      if (!p) return
      setMeasurePoint(overlay, p)
      const unitInMm = useViewerStore.getState().geometryDetails?.modelUnitInMm ?? 1
      const dist = measureDistance(overlay, unitInMm)
      useViewerStore.getState().setMeasureDistanceMm(dist)
      if (dist != null && overlay.pointA && overlay.pointB) {
        const unit = useViewerStore.getState().measurementUnit
        const mid = overlay.pointA.clone().lerp(overlay.pointB, 0.5).project(cameraRef.current!)
        badge.textContent = formatLength(fromMm(dist, unit), unit)
        badge.style.left = `${(mid.x * 0.5 + 0.5) * rect.width}px`
        badge.style.top = `${(-mid.y * 0.5 + 0.5) * rect.height}px`
        badge.style.display = ''
      } else {
        badge.style.display = 'none'
      }
      invalidate()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useViewerStore.getState().setMeasureMode(false)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
      disposeMeasureOverlay(overlay)
      measureOverlayRef.current = null
      badge.remove()
      useViewerStore.getState().setMeasureDistanceMm(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureMode, rendererGen])

  // Effect 10c: Auto-disarm measure when the Repair dialog opens
  useEffect(() => {
    if (repairDialogOpen && measureMode) useViewerStore.getState().setMeasureMode(false)
  }, [repairDialogOpen, measureMode])
```

- [ ] **Step 5: Type-check + unit suite + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS.

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D measure mode — pick two points, live distance badge"
```

---

## Task 8: `UnitPrompt` component

**Files:**
- Create: `src/components/prepare/UnitPrompt.tsx`
- Test: `src/components/prepare/UnitPrompt.test.tsx`

**Interfaces:**
- Consumes: `useViewerStore` `geometryDetails`; `UNIT_IN_MM` from `../../services/unitConversion`; `Viewer3DHandle` type from `../Viewer3D`.
- Produces: `UnitPrompt({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> })`. Renders nothing unless `geometryDetails && geometryDetails.modelUnitInMm === null`. Shows text "Unit not specified, assuming millimetres.", a `mm/cm/in` `<select aria-label="Import unit">` (default `mm`), and an **Apply** button that calls `viewerRef.current?.setModelUnit(mm)` for the selected unit. Root has `data-testid="unit-prompt"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnitPrompt } from './UnitPrompt'
import { useViewerStore } from '../../store/viewerStore'

const details = (over: Partial<ReturnType<typeof useViewerStore.getState>['geometryDetails'] & object> = {}) => ({
  width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: false, modelUnitInMm: null, ...over,
})

describe('UnitPrompt', () => {
  beforeEach(() => useViewerStore.setState({ geometryDetails: null }))

  it('renders nothing without a model', () => {
    const { container } = render(<UnitPrompt viewerRef={{ current: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing once a unit is known', () => {
    useViewerStore.setState({ geometryDetails: details({ modelUnitInMm: 1 }) })
    const { container } = render(<UnitPrompt viewerRef={{ current: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('applies the selected unit in mm', async () => {
    useViewerStore.setState({ geometryDetails: details() })
    const setModelUnit = vi.fn()
    render(<UnitPrompt viewerRef={{ current: { setModelUnit } as never }} />)
    await userEvent.selectOptions(screen.getByLabelText('Import unit'), 'in')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(setModelUnit).toHaveBeenCalledWith(25.4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/UnitPrompt.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { UNIT_IN_MM } from '../../services/unitConversion'
import type { Viewer3DHandle } from '../Viewer3D'

const CHOICES = [
  { label: 'mm', mm: UNIT_IN_MM.mm },
  { label: 'cm', mm: UNIT_IN_MM.cm },
  { label: 'in', mm: UNIT_IN_MM.in },
]

export function UnitPrompt({
  viewerRef,
}: {
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const [choice, setChoice] = useState('mm')
  if (!details || details.modelUnitInMm !== null) return null
  const mm = CHOICES.find((c) => c.label === choice)!.mm
  return (
    <div data-testid="unit-prompt" className="mt-6 rounded border border-[var(--bg-button)] p-3">
      <p className="text-xs text-[var(--text-muted)]">Unit not specified, assuming millimetres.</p>
      <div className="mt-2 flex items-center gap-2">
        <select
          aria-label="Import unit"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="bg-[var(--bg-button)] rounded px-2 py-1 text-sm"
        >
          {CHOICES.map((c) => (
            <option key={c.label} value={c.label}>{c.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => viewerRef.current?.setModelUnit(mm)}
          className="px-3 py-1 rounded bg-[var(--accent-button)] text-white text-sm"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/prepare/UnitPrompt.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/UnitPrompt.tsx src/components/prepare/UnitPrompt.test.tsx
git commit -m "feat: UnitPrompt — non-blocking import-unit correction"
```

---

## Task 9: `DimensionsReadout` component

**Files:**
- Create: `src/components/prepare/DimensionsReadout.tsx`
- Test: `src/components/prepare/DimensionsReadout.test.tsx`

**Interfaces:**
- Consumes: `useViewerStore` `geometryDetails`, `measurementUnit`, `setMeasurementUnit`; `fromMm` + `formatLength` from `../../services/unitConversion`.
- Produces: `DimensionsReadout()`. Renders nothing when `geometryDetails === null`. Shows a "Dimensions" heading, a `mm / cm / in` segmented control (`aria-pressed` on the active one, calls `setMeasurementUnit`), and a grid of Width / Height / Depth / Longest, each `= geometryDetails.<axis> * (modelUnitInMm ?? 1)` mm then `formatLength(fromMm(mm, unit), unit)`. Root `data-testid="dimensions-readout"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DimensionsReadout } from './DimensionsReadout'
import { useViewerStore } from '../../store/viewerStore'

const details = {
  width: 100, height: 50, depth: 25, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: 1,
}

describe('DimensionsReadout', () => {
  beforeEach(() => useViewerStore.setState({ geometryDetails: null, measurementUnit: 'mm' }))

  it('renders nothing without a model', () => {
    const { container } = render(<DimensionsReadout />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows mm dimensions and the longest edge', () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<DimensionsReadout />)
    expect(screen.getByText('100 mm')).toBeInTheDocument() // width + longest
    expect(screen.getByText('50 mm')).toBeInTheDocument()
    expect(screen.getByText('25 mm')).toBeInTheDocument()
  })

  it('switches the display unit', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<DimensionsReadout />)
    await userEvent.click(screen.getByRole('button', { name: 'in' }))
    expect(useViewerStore.getState().measurementUnit).toBe('in')
    expect(screen.getByText('3.94 in')).toBeInTheDocument() // 100mm
  })

  it('applies modelUnitInMm', () => {
    useViewerStore.setState({ geometryDetails: { ...details, modelUnitInMm: 10 } })
    render(<DimensionsReadout />)
    expect(screen.getByText('1000 mm')).toBeInTheDocument() // 100 * 10
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/DimensionsReadout.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/prepare/DimensionsReadout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/DimensionsReadout.tsx src/components/prepare/DimensionsReadout.test.tsx
git commit -m "feat: DimensionsReadout — W/H/D + longest edge in mm/cm/in"
```

---

## Task 10: `MeasureSection` component

**Files:**
- Create: `src/components/prepare/MeasureSection.tsx`
- Test: `src/components/prepare/MeasureSection.test.tsx`

**Interfaces:**
- Consumes: `useViewerStore` `geometryDetails`, `measureMode`, `setMeasureMode`, `measureDistanceMm`, `measurementUnit`; `fromMm` + `formatLength`; `Viewer3DHandle` type.
- Produces: `MeasureSection({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> })`. A "Measure" section: a toggle button (`aria-pressed={measureMode}`, label `Measure distance` / `Stop measuring`, disabled when `geometryDetails === null`) that calls `setMeasureMode(!measureMode)`; when `measureMode`, a `Clear` button calling `viewerRef.current?.resetMeasure()` and an "Press Esc to stop." hint; when `measureDistanceMm != null`, a `<p data-testid="measure-distance">` showing `formatLength(fromMm(measureDistanceMm, unit), unit)`. When `geometryDetails.modelUnitInMm === null`, the intro text appends " Assuming millimetres.".

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MeasureSection } from './MeasureSection'
import { useViewerStore } from '../../store/viewerStore'

const withModel = () =>
  useViewerStore.setState({
    geometryDetails: {
      width: 1, height: 1, depth: 1, vertices: 1, meshes: 1,
      boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
      watertight: true, modelUnitInMm: 1,
    },
  })

describe('MeasureSection', () => {
  beforeEach(() =>
    useViewerStore.setState({ geometryDetails: null, measureMode: false, measureDistanceMm: null, measurementUnit: 'mm' }),
  )

  it('disables the toggle without a model', () => {
    render(<MeasureSection viewerRef={{ current: null }} />)
    expect(screen.getByRole('button', { name: 'Measure distance' })).toBeDisabled()
  })

  it('toggles measure mode', async () => {
    withModel()
    render(<MeasureSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Measure distance' }))
    expect(useViewerStore.getState().measureMode).toBe(true)
  })

  it('shows the measured distance in the display unit', () => {
    withModel()
    useViewerStore.setState({ measureMode: true, measureDistanceMm: 25.4, measurementUnit: 'in' })
    render(<MeasureSection viewerRef={{ current: null }} />)
    expect(screen.getByTestId('measure-distance')).toHaveTextContent('1 in')
  })

  it('Clear calls the handle', async () => {
    withModel()
    useViewerStore.setState({ measureMode: true })
    const resetMeasure = vi.fn()
    render(<MeasureSection viewerRef={{ current: { resetMeasure } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(resetMeasure).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/MeasureSection.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
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
            (measureMode ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
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
        {measureMode && <p className="text-xs text-[var(--text-muted)]">Press Esc to stop.</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/prepare/MeasureSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/MeasureSection.tsx src/components/prepare/MeasureSection.test.tsx
git commit -m "feat: MeasureSection — toggle measure mode, show live distance"
```

---

## Task 11: `ScaleSection` component

**Files:**
- Create: `src/components/prepare/ScaleSection.tsx`
- Test: `src/components/prepare/ScaleSection.test.tsx`

**Interfaces:**
- Consumes: `useViewerStore` `geometryDetails`, `measurementUnit`, `splitParts`, `measureMode`, `buildVolumeMm`, `setBuildVolumeMm`, `resetBuildVolumeMm`; `toMm` from `../../services/unitConversion`; `scaleToTargetFactor` / `scaleToFitFactor` / `isFactorInBounds` from `../../services/scaleMath`; `Viewer3DHandle` type.
- Produces: `ScaleSection({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> })`. Root `<div id="prepare-scale">`. Locked (all inputs/buttons disabled, reason shown) when `!geometryDetails || splitParts.length > 0 || measureMode`. **Scale to target:** axis `<select aria-label="Target axis">` (`Width|Height|Depth|Longest edge`, values `width|height|depth|longest`) + `<input aria-label="Target length (<unit>)">` + an Apply button calling `viewerRef.current?.scaleModelBy(factor, 'Scale to target')` where `factor = scaleToTargetFactor(axisMm, toMm(Number(target), unit))`, disabled unless `isFactorInBounds(factor)`. `axisMm` uses `geometryDetails.<axis> * (modelUnitInMm ?? 1)`, `longest` = max of the three. **Scale to build volume:** three `<input aria-label="Build volume x|y|z">` bound to `buildVolumeMm` (non-finite -> `0`), a `Reset` button (`resetBuildVolumeMm`), and a `Fit to build volume` button calling `scaleModelBy(scaleToFitFactor(dimsMm, {x,y,z}), 'Scale to fit build volume')`, disabled unless in bounds.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScaleSection } from './ScaleSection'
import { useViewerStore, DEFAULT_BUILD_VOLUME_MM } from '../../store/viewerStore'

const details = {
  width: 50, height: 20, depth: 10, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: 1,
}

describe('ScaleSection', () => {
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, measurementUnit: 'mm', splitParts: [], measureMode: false,
      buildVolumeMm: { ...DEFAULT_BUILD_VOLUME_MM },
    }),
  )

  it('locks while split by shell', () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'a', triangleCount: 1, visible: true }] })
    render(<ScaleSection viewerRef={{ current: null }} />)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('scales the longest edge to a target', async () => {
    const scaleModelBy = vi.fn()
    render(<ScaleSection viewerRef={{ current: { scaleModelBy } as never }} />)
    // default axis "longest" = 50; target 100 -> factor 2
    await userEvent.type(screen.getByLabelText('Target length (mm)'), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(scaleModelBy).toHaveBeenCalledWith(2, 'Scale to target')
  })

  it('rejects an out-of-range target', async () => {
    render(<ScaleSection viewerRef={{ current: null }} />)
    await userEvent.type(screen.getByLabelText('Target length (mm)'), '0')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('fits to the build volume', async () => {
    const scaleModelBy = vi.fn()
    render(<ScaleSection viewerRef={{ current: { scaleModelBy } as never }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fit to build volume' }))
    // min(220/50, 220/20, 250/10) = 4.4
    expect(scaleModelBy).toHaveBeenCalledWith(4.4, 'Scale to fit build volume')
  })

  it('resets the build volume', async () => {
    useViewerStore.setState({ buildVolumeMm: { x: 1, y: 1, z: 1 } })
    render(<ScaleSection viewerRef={{ current: null }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(useViewerStore.getState().buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/ScaleSection.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import { toMm } from '../../services/unitConversion'
import { scaleToTargetFactor, scaleToFitFactor, isFactorInBounds } from '../../services/scaleMath'
import type { Viewer3DHandle } from '../Viewer3D'

type Axis = 'width' | 'height' | 'depth' | 'longest'

export function ScaleSection({
  viewerRef,
}: {
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const unit = useViewerStore((s) => s.measurementUnit)
  const splitParts = useViewerStore((s) => s.splitParts)
  const measureMode = useViewerStore((s) => s.measureMode)
  const buildVolume = useViewerStore((s) => s.buildVolumeMm)
  const [axis, setAxis] = useState<Axis>('longest')
  const [target, setTarget] = useState('')

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
    const n = Number(raw)
    useViewerStore.getState().setBuildVolumeMm({ ...buildVolume, [k]: Number.isFinite(n) ? n : 0 })
  }

  return (
    <div id="prepare-scale">
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
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Scale to target</span>
          <div className="flex gap-2">
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
            <input
              aria-label={`Target length (${unit})`}
              inputMode="decimal"
              value={target}
              disabled={locked}
              onChange={(e) => setTarget(e.target.value)}
              className="w-24 bg-[var(--bg-button)] rounded px-2 py-1 text-sm font-mono"
            />
            <span className="self-center text-xs text-[var(--text-muted)]">{unit}</span>
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

        <div className="flex flex-col gap-1">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">
            Scale to build volume (mm)
          </span>
          <div className="flex gap-2 items-center">
            {(['x', 'y', 'z'] as const).map((k) => (
              <input
                key={k}
                aria-label={`Build volume ${k}`}
                inputMode="decimal"
                value={String(buildVolume[k])}
                disabled={locked}
                onChange={(e) => setVol(k, e.target.value)}
                className="w-16 bg-[var(--bg-button)] rounded px-2 py-1 text-sm font-mono"
              />
            ))}
            <button
              type="button"
              onClick={() => useViewerStore.getState().resetBuildVolumeMm()}
              className="text-xs text-[var(--text-muted)] underline"
            >
              Reset
            </button>
          </div>
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/prepare/ScaleSection.test.tsx`
Expected: PASS. (Note: the `4.4` assertion may land as `4.3999...`; if so change the impl-side nothing and the test to `expect(scaleModelBy.mock.calls[0][0]).toBeCloseTo(4.4)` — a floating-point tolerance, not a logic change.)

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/ScaleSection.tsx src/components/prepare/ScaleSection.test.tsx
git commit -m "feat: ScaleSection — scale to target dimension or to fit the build volume"
```

---

## Task 12: mount the new UI + wire the scale fix

**Files:**
- Modify: `src/components/Sidebar.tsx` (render `UnitPrompt` + `DimensionsReadout` in the Details tab)
- Modify: `src/components/prepare/PreparePanel.tsx` (mount `MeasureSection` + `ScaleSection`, pass `buildVolumeMm` to `prepChecks`, add the `scale` fix handler)
- Test: `src/components/prepare/PreparePanel.test.tsx` (extend)

**Interfaces:**
- Consumes: Tasks 8-11 components; `useViewerStore` `buildVolumeMm`.
- Produces: the Details tab shows `<UnitPrompt viewerRef>` then `<DimensionsReadout />` after the Geometry grid; the Prepare panel shows `<MeasureSection viewerRef>` and `<ScaleSection viewerRef>` after `<PartsSection>`; `prepChecks(details, sealApplied, buildVolumeMm)`; `FIX_HANDLERS.scale` scrolls `#prepare-scale` into view.

- [ ] **Step 1: Extend `PreparePanel.test.tsx`**

```ts
it('renders the Measure and Scale sections', () => {
  useViewerStore.setState({
    geometryDetails: {
      width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
      boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
      watertight: true, modelUnitInMm: 1,
    },
  })
  render(<PreparePanel viewerRef={{ current: null }} />)
  expect(screen.getByRole('heading', { name: 'Measure' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Scale' })).toBeInTheDocument()
})
```

(Match the existing `PreparePanel.test.tsx` import/render style; it already renders with a `viewerRef` prop.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/PreparePanel.test.tsx`
Expected: FAIL, no Measure/Scale headings.

- [ ] **Step 3: Wire `PreparePanel.tsx`**

```tsx
import { useViewerStore } from '../../store/viewerStore'
import { prepChecks } from '../../services/prepChecks'
import { ReadinessCard } from './ReadinessCard'
import { RepairSection } from './RepairSection'
import { PartsSection } from './PartsSection'
import { MeasureSection } from './MeasureSection'
import { ScaleSection } from './ScaleSection'
import type { Viewer3DHandle } from '../Viewer3D'

const FIX_HANDLERS: Record<string, () => void> = {
  seal: () => useViewerStore.getState().setRepairDialogOpen(true),
  scale: () =>
    document.getElementById('prepare-scale')?.scrollIntoView({ block: 'center' }),
}

export function PreparePanel({
  onUndoEdit,
  viewerRef,
}: {
  onUndoEdit?: (steps?: number) => void
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  const details = useViewerStore((s) => s.geometryDetails)
  const sealApplied = useViewerStore((s) => s.sealApplied)
  const buildVolumeMm = useViewerStore((s) => s.buildVolumeMm)

  return (
    <div className="flex flex-col gap-6">
      {details ? (
        <ReadinessCard
          checks={prepChecks(details, sealApplied, buildVolumeMm)}
          onFix={(fixId) => FIX_HANDLERS[fixId]?.()}
          canFix={(id) => Object.hasOwn(FIX_HANDLERS, id)}
        />
      ) : (
        <p data-testid="prepare-empty" className="text-sm text-[var(--text-muted)]">
          Open a model to run checks.
        </p>
      )}
      <RepairSection onUndoEdit={onUndoEdit} />
      <PartsSection viewerRef={viewerRef} />
      <MeasureSection viewerRef={viewerRef} />
      <ScaleSection viewerRef={viewerRef} />
    </div>
  )
}
```

- [ ] **Step 4: Wire `Sidebar.tsx`**

Add imports:

```tsx
import { UnitPrompt } from './prepare/UnitPrompt'
import { DimensionsReadout } from './prepare/DimensionsReadout'
```

In the Details tabpanel, immediately after the `{geometryDetails && ( <> ... </> )}` block and before the closing `</div>` of the scroll container (currently `src/components/Sidebar.tsx:261`):

```tsx
            <UnitPrompt viewerRef={viewerRef} />
            <DimensionsReadout />
```

- [ ] **Step 5: Run tests + type-check**

Run: `pnpm exec tsc --noEmit && pnpm test -- src/components/prepare/PreparePanel.test.tsx src/components/Sidebar.test.tsx`
Expected: PASS. If `Sidebar.test.tsx` asserts an exact child count of the Details panel, update it to include the two new always-mounted (but empty-when-no-model) nodes.

- [ ] **Step 6: Full unit suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.tsx src/components/prepare/PreparePanel.tsx src/components/prepare/PreparePanel.test.tsx src/components/Sidebar.test.tsx
git commit -m "feat: mount unit prompt, dimensions, measure + scale sections; wire scale fix"
```

---

## Task 13: end-to-end spec (hard completion gate)

**Files:**
- Create: `e2e/units-measure.spec.ts`

Follow the structure of `e2e/prepare-panel.spec.ts` (same fixture-loading and panel-opening helpers). Use an existing STL fixture (the one `prepare-panel.spec.ts` loads); STL is unitless so the prompt must appear.

**Interfaces:**
- Consumes: the running app, the Prepare tab, the Details tab, `data-testid` hooks `unit-prompt`, `dimensions-readout`, `measure-distance`, and the `#prepare-scale` section.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test'
import { loadFixture, openPreparePanel } from './helpers' // reuse whatever prepare-panel.spec.ts uses

test.describe('SP-3a units + measure', () => {
  test('unit prompt, dimensions, measure, scale, undo', async ({ page }) => {
    await page.goto('/')
    await loadFixture(page, 'cube.stl') // an STL fixture already used by prepare-panel.spec.ts

    // 1. Details tab shows the unit prompt + a mm dimensions readout
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.getByTestId('unit-prompt')).toBeVisible()
    const dims = page.getByTestId('dimensions-readout')
    await expect(dims).toContainText('mm')

    // 2. Switch display unit to inches and back
    await dims.getByRole('button', { name: 'in' }).click()
    await expect(dims).toContainText('in')
    await dims.getByRole('button', { name: 'mm' }).click()

    // 3. Measure two points
    await openPreparePanel(page)
    await page.getByRole('button', { name: 'Measure distance' }).click()
    const canvas = page.locator('canvas').first()
    const box = (await canvas.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5)
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5)
    await expect(page.getByTestId('measure-distance')).toBeVisible()
    await page.getByRole('button', { name: 'Stop measuring' }).click()

    // 4. Scale the longest edge to 100 mm
    await page.locator('#prepare-scale').getByLabel(/Target length/).fill('100')
    await page.locator('#prepare-scale').getByRole('button', { name: 'Apply' }).click()
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.getByTestId('dimensions-readout')).toContainText('100 mm')

    // 5. Undo restores the original dimensions
    await openPreparePanel(page)
    await page.getByRole('button', { name: 'Undo last model edit' }).click()
    await page.getByRole('tab', { name: 'Details' }).click()
    await expect(page.getByTestId('dimensions-readout')).not.toContainText('100 mm')

    // 6. Scale to a small build volume flips the On build plate row to pass
    await openPreparePanel(page)
    for (const [label, value] of [['Build volume x', '50'], ['Build volume y', '50'], ['Build volume z', '50']] as const) {
      await page.getByLabel(label).fill(value)
    }
    await page.getByRole('button', { name: 'Fit to build volume' }).click()
    await expect(page.getByText('On build plate')).toBeVisible()
    await expect(page.locator('[data-check-id="onPlate"], text=Within build volume').first()).toBeVisible()
  })
})
```

Adjust selectors/helpers to match `prepare-panel.spec.ts` exactly (fixture name, `openPreparePanel`, the readiness-row markup). If `ReadinessCard` rows have no stable hook, assert on the visible `Within build volume` detail text instead.

- [ ] **Step 2: Run it**

Run: `pnpm test:e2e -- units-measure`
Expected: PASS. If clicks miss the mesh (camera framing), nudge the fractional offsets toward centre; do not add retries.

- [ ] **Step 3: Commit**

```bash
git add e2e/units-measure.spec.ts
git commit -m "test: e2e units prompt, dimensions, measure, scale, undo"
```

---

## Task 14: docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md` (record SP-3a)

- [ ] **Step 1: README** — in the feature list where SP-2 features are described, add a short "Units and measure" entry: import unit prompt for STL/OBJ/PLY, dimensions in mm/cm/in, point-to-point measure, scale to target, scale to build volume. Match the surrounding style.

- [ ] **Step 2: CHANGELOG** — add an entry under the current unreleased/next version heading, style matching prior SP entries:

```
- Prepare panel: real-world units and measure (SP-3a). Import unit prompt for
  unitless formats, bounding-box dimensions in mm/cm/in, point-to-point
  distance measure, scale-to-target and scale-to-build-volume, and the
  On build plate readiness check.
```

- [ ] **Step 3: roadmap** — in `2026-08-30-print-prep-roadmap.md`, add an SP-3 decomposition note mirroring the SP-2 table, marking SP-3a SHIPPED with the branch name and commit range, and SP-3b (transform panel) as the remaining cycle. Update the SP row status line for SP-3.

- [ ] **Step 4: verify docs build/lint if the repo lints markdown** (skip if none).

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS (no code change; sanity only).

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-3a units + measure"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| Unit model / `UNIT_IN_MM` / conversions | 1 |
| Scale factor maths + bounds | 2 |
| `measureMode` / `measureDistanceMm` / `buildVolumeMm` state + `setFile` reset | 3 |
| Measure overlay build/pick/dispose | 4 |
| Off-plate readiness row wired | 5 |
| `setModelUnit`, `getModelDimensionsMm`, `scaleModelBy` + undo entry | 6 |
| Measure pick-loop effect, badge, auto-disarm, `resetMeasure` | 7 |
| Import unit prompt UI | 8 |
| mm/cm/in dimensions readout | 9 |
| Measure section UI | 10 |
| Scale section UI (target + build volume, guards) | 11 |
| Mount into Details + Prepare, scale fix handler | 12 |
| E2E gate | 13 |
| README / CHANGELOG / roadmap | 14 |

Non-goals (transform panel, volume readout, multi-segment measure, vertex snap, persistence, build-volume box) are explicitly out and have no task, as intended.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step has full code. The two "adjust to match the existing helper" notes in Tasks 12-13 point at concrete existing files, not unspecified work.

**3. Type consistency:** `scaleModelBy(factor, label)` — 2 args everywhere (handle def Task 6, `ScaleSection` Task 11, e2e Task 13). `setModelUnit(mm)` — Tasks 6, 8. `resetMeasure()` — Tasks 7, 10. `getModelDimensionsMm()` returns `THREE.Vector3 | null` — Task 6, unused by components (they read `geometryDetails` directly), kept for the handle contract and potential e2e. `prepChecks(details, sealApplied, buildVolumeMm?)` — Tasks 5, 12. `buildVolumeMm` shape `{ x, y, z }` — Tasks 3, 5, 11, 12. `MeasureOverlay` fields — Task 4 def, Task 7 use (`pointA`, `pointB`, `markerA/B.visible`, `line.visible`). Store field names (`measureMode`, `measureDistanceMm`, `buildVolumeMm`, `setMeasureMode`, `setMeasureDistanceMm`, `setBuildVolumeMm`, `resetBuildVolumeMm`, `DEFAULT_BUILD_VOLUME_MM`) consistent Tasks 3, 7, 10, 11, 12.

One known floating-point caveat is called out inline in Task 11 Step 4 (the `4.4` fit factor) with the exact fix (switch that assertion to `toBeCloseTo`).
