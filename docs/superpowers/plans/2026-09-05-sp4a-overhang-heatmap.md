# SP-4a: Overhang Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colour faces past an overhang angle threshold directly in the viewport (a hide-and-recolour overlay, no geometry mutation) and turn the SP-1 readiness card's disabled "Overhangs" row into a live pass/warn check.

**Architecture:** A pure `overhangAnalysis.ts` classifies each triangle from a flat position array using its own cross-product face normal against straight-down, no Three import. `GeometryDetails` gains `overhangFaceCount`, computed in `Viewer3D.updateGeometryDetails()` from world-space-baked positions (so it reflects the model's actual current orientation after any transform). A Three-touching `overhangOverlay.ts` builds one recoloured, world-space-baked copy per eligible mesh into a scene-level group tagged `userData.overhangOverlay = true` (mirroring the SP-2c/SP-3a hole-fill/measure overlay pattern) while hiding the originals; `src/services/exporters.ts` gains the same tag to its existing overlay-exclusion check. A new `AnalysisSection.tsx` (no `viewerRef` — everything is store-driven, Viewer3D reacts to the store directly) holds the toggle + threshold input.

**Tech Stack:** React 19, Three 0.185, Zustand 5, Vitest, Playwright, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-05-sp4a-overhang-heatmap-design.md`

## Global Constraints

- **No new npm dependency.**
- **Overhang definition:** for a face with unit normal `n`, `angleFromStraightDownDeg = degrees(acos(clamp(-n.y, -1, 1)))`; `isOverhang = angleFromStraightDownDeg < overhangThresholdDeg`. Default `overhangThresholdDeg = 45`.
- **World-space, not local-space.** Both the readiness-row count and the overlay classify faces using positions baked through `mesh.matrixWorld` (via `geometry.index ? geometry.toNonIndexed() : geometry.clone()` then `applyMatrix4`), so a rotated/mirrored model (SP-3b) is classified in its actual current orientation, not its authored one.
- **Binary highlight only** (a fixed highlight colour vs. the model's base colour), no continuous gradient this cycle.
- **`overhangs` readiness row: `warn` (not `fail`) when count > 0**, `pass` at 0, no `fixId` — an overhang is informational, not a defect with an automated fix.
- **`AnalysisSection` is locked only on `!geometryDetails`** — no split-parts or measure-mode lock (read-only viewing, not an edit).
- **Overlay auto-disarms only on `repairDialogOpen` and model unload** (`setFile`/`setFileFromBuffer` reset `overhangMode: false`, which the effect's own cleanup already handles via its dependency array — no separate teardown call needed in the store action, matching how `measureMode`'s reset already works). Staleness under Move/Rotate/Scale/Mirror/Drop/Center/Split while armed is an accepted, documented limitation — do not build a full N-way interlock this cycle.
- **`GeometryDetails.overhangFaceCount` is required, not optional.** Ten existing test files construct `GeometryDetails` literals directly (`prepChecks.test.ts`, `UnitPrompt.test.tsx`, `Sidebar.test.tsx`, `TransformSection.test.tsx`, `viewerStore.test.ts`, `DimensionsReadout.test.tsx`, `ScaleSection.test.tsx`, `MeasureSection.test.tsx`, `PreparePanel.test.tsx`, `loaders/index.test.ts`) and each needs `overhangFaceCount: 0` added — Task 2 does this as one batch, not scattered across later tasks.
- **No jest-dom in this repo.** Every new component test uses vitest/RTL-core assertions from the start (`(el as HTMLButtonElement).disabled`, `(el as HTMLInputElement).value`, `getByRole`/`getByLabelText` directly) — never `toBeInTheDocument()` / `toBeDisabled()` / `toHaveTextContent()`.
- **No unit test for `Viewer3D.tsx`'s new overlay-build effect or the `updateGeometryDetails` addition's live behaviour** — same accepted reasoning as every prior Viewer3D handle/effect addition (WebGL-less jsdom; `Viewer3D.test.tsx` covers only exported pure helpers + the WebGL-less error path). Verification is `tsc --noEmit` clean + full-suite no-regression; the e2e is the runtime gate.
- **`pnpm test` (full suite) + `pnpm exec tsc --noEmit` pass before every commit.**

---

## Task 1: `overhangAnalysis.ts` pure service

**Files:**
- Create: `src/services/overhangAnalysis.ts`
- Test: `src/services/overhangAnalysis.test.ts`

**Interfaces:**
- Produces:
  - `interface OverhangMaskResult { mask: Uint8Array; count: number }`
  - `computeOverhangFaceMask(positions: Float32Array, thresholdDeg: number): OverhangMaskResult` — `positions.length` is a multiple of 9 (one `[x,y,z]` triple per vertex, three vertices per face, non-indexed layout). For each face: compute the face normal via cross product of its two edge vectors; if the normal's length is below a small epsilon (degenerate triangle), that face is excluded from both the mask and the count; otherwise compute `angleFromStraightDownDeg = degrees(acos(clamp(-normalizedNy, -1, 1)))` and set `mask[face] = 1` (and increment `count`) when that angle is less than `thresholdDeg`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeOverhangFaceMask } from './overhangAnalysis'

describe('computeOverhangFaceMask', () => {
  it('flags a straight-down-facing triangle at any positive threshold', () => {
    // Winding (P0,P1,P2) with these positions yields normal (0,-1,0) exactly.
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 0, 1,
    ])
    const { mask, count } = computeOverhangFaceMask(positions, 1)
    expect(Array.from(mask)).toEqual([1])
    expect(count).toBe(1)
  })

  it('never flags a vertical wall triangle', () => {
    // Winding yields normal (1,0,0) — a vertical wall, 90 deg from straight down.
    const positions = new Float32Array([
      0, 0, 0,
      0, 1, 0,
      0, 1, 1,
    ])
    const { mask, count } = computeOverhangFaceMask(positions, 89)
    expect(Array.from(mask)).toEqual([0])
    expect(count).toBe(0)
  })

  it('flags a 30-degree-from-straight-down face only when the threshold exceeds 30', () => {
    // A flat plate rotated 30 deg about X from a straight-down-facing plate.
    // See derivation in the design spec: normal becomes (0, -cos30, -sin30),
    // i.e. angleFromStraightDown = 30 deg exactly.
    const cos30 = Math.cos((30 * Math.PI) / 180)
    const sin30 = Math.sin((30 * Math.PI) / 180)
    const p0 = [0, 0, 0]
    const p1 = [20, 0, 0]
    const p2 = [20, -10 * sin30, 10 * cos30]
    const positions = new Float32Array([...p0, ...p1, ...p2])
    expect(computeOverhangFaceMask(positions, 45).count).toBe(1)
    expect(computeOverhangFaceMask(positions, 15).count).toBe(0)
  })

  it('excludes a degenerate (zero-area) triangle without throwing', () => {
    const positions = new Float32Array([
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ])
    expect(() => computeOverhangFaceMask(positions, 45)).not.toThrow()
    const { mask, count } = computeOverhangFaceMask(positions, 45)
    expect(Array.from(mask)).toEqual([0])
    expect(count).toBe(0)
  })

  it('sums count correctly across multiple faces', () => {
    const down = [0, 0, 0, 1, 0, 0, 1, 0, 1] // normal (0,-1,0)
    const wall = [0, 0, 0, 0, 1, 0, 0, 1, 1] // normal (1,0,0)
    const positions = new Float32Array([...down, ...wall])
    const { mask, count } = computeOverhangFaceMask(positions, 45)
    expect(Array.from(mask)).toEqual([1, 0])
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/overhangAnalysis.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface OverhangMaskResult {
  mask: Uint8Array
  count: number
}

const NORMAL_EPSILON = 1e-10

export function computeOverhangFaceMask(
  positions: Float32Array,
  thresholdDeg: number,
): OverhangMaskResult {
  const faceCount = Math.floor(positions.length / 9)
  const mask = new Uint8Array(faceCount)
  let count = 0

  for (let f = 0; f < faceCount; f++) {
    const o = f * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    // Face normal = e1 x e2. Only the y-component is needed for the
    // straight-down angle, but the length of the full vector is needed to
    // detect a degenerate (near-zero-area) triangle.
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < NORMAL_EPSILON) continue
    const normalizedNy = ny / len
    const angleFromStraightDownDeg = (Math.acos(Math.max(-1, Math.min(1, -normalizedNy))) * 180) / Math.PI
    if (angleFromStraightDownDeg < thresholdDeg) {
      mask[f] = 1
      count++
    }
  }

  return { mask, count }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/overhangAnalysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/overhangAnalysis.ts src/services/overhangAnalysis.test.ts
git commit -m "feat: overhangAnalysis - per-face straight-down angle classification"
```

---

## Task 2: viewerStore fields + `GeometryDetails.overhangFaceCount` ripple

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts` (extend)
- Modify (mechanical, one line each): `src/services/prepChecks.test.ts`, `src/components/prepare/UnitPrompt.test.tsx`, `src/components/Sidebar.test.tsx`, `src/components/prepare/TransformSection.test.tsx`, `src/components/prepare/DimensionsReadout.test.tsx`, `src/components/prepare/ScaleSection.test.tsx`, `src/components/prepare/MeasureSection.test.tsx`, `src/components/prepare/PreparePanel.test.tsx`, `src/loaders/index.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `GeometryDetails.overhangFaceCount: number` (required field, added to the interface).
  - `overhangMode: boolean` (default `false`), `overhangThresholdDeg: number` (default `45`), `overhangOverlayStatus: { meshCount: number; skippedMeshes: number } | null` (default `null`).
  - `setOverhangMode(on: boolean): void`, `setOverhangThresholdDeg(deg: number): void`, `setOverhangOverlayStatus(status: { meshCount: number; skippedMeshes: number } | null): void`.
  - `setFile` / `setFileFromBuffer` also reset `overhangMode: false` (matching the existing `measureMode: false` reset in both).

- [ ] **Step 1: Write the failing test** (append to `viewerStore.test.ts`)

```ts
describe('overhang heatmap state', () => {
  beforeEach(() =>
    useViewerStore.setState({ overhangMode: false, overhangThresholdDeg: 45, overhangOverlayStatus: null }),
  )

  it('defaults', () => {
    const s = useViewerStore.getState()
    expect(s.overhangMode).toBe(false)
    expect(s.overhangThresholdDeg).toBe(45)
    expect(s.overhangOverlayStatus).toBeNull()
  })

  it('set actions', () => {
    useViewerStore.getState().setOverhangMode(true)
    expect(useViewerStore.getState().overhangMode).toBe(true)
    useViewerStore.getState().setOverhangThresholdDeg(30)
    expect(useViewerStore.getState().overhangThresholdDeg).toBe(30)
    useViewerStore.getState().setOverhangOverlayStatus({ meshCount: 2, skippedMeshes: 1 })
    expect(useViewerStore.getState().overhangOverlayStatus).toEqual({ meshCount: 2, skippedMeshes: 1 })
  })

  it('setFile clears overhangMode', () => {
    useViewerStore.getState().setOverhangMode(true)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    expect(useViewerStore.getState().overhangMode).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: FAIL, fields/actions missing.

- [ ] **Step 3: Write minimal implementation**

In the `GeometryDetails` interface, add:

```ts
  overhangFaceCount: number
```

In the `ViewerState` interface, alongside the measure-mode fields:

```ts
  overhangMode: boolean
  overhangThresholdDeg: number
  overhangOverlayStatus: { meshCount: number; skippedMeshes: number } | null
  setOverhangMode: (on: boolean) => void
  setOverhangThresholdDeg: (deg: number) => void
  setOverhangOverlayStatus: (status: { meshCount: number; skippedMeshes: number } | null) => void
```

In `create()` defaults (near `measureMode: false,`):

```ts
  overhangMode: false,
  overhangThresholdDeg: 45,
  overhangOverlayStatus: null,
```

Actions (near `setMeasureMode`):

```ts
  setOverhangMode: (on) => set({ overhangMode: on }),
  setOverhangThresholdDeg: (deg) => set({ overhangThresholdDeg: deg }),
  setOverhangOverlayStatus: (status) => set({ overhangOverlayStatus: status }),
```

In both `setFile` and `setFileFromBuffer` `set({ ... })` objects, add:

```ts
      overhangMode: false,
```

- [ ] **Step 4: Update every existing `GeometryDetails` literal**

In each of these 10 files, find every object literal that constructs a
`GeometryDetails` (they all currently include `modelUnitInMm`) and add
`overhangFaceCount: 0,` alongside it:

`src/services/prepChecks.test.ts`, `src/components/prepare/UnitPrompt.test.tsx`,
`src/components/Sidebar.test.tsx`, `src/components/prepare/TransformSection.test.tsx`,
`src/components/prepare/DimensionsReadout.test.tsx`, `src/components/prepare/ScaleSection.test.tsx`,
`src/components/prepare/MeasureSection.test.tsx`, `src/components/prepare/PreparePanel.test.tsx`,
`src/loaders/index.test.ts`

(`viewerStore.test.ts` itself was already handled in Step 1/3 above if it
constructs any `GeometryDetails` literal — check and add there too if so.)

- [ ] **Step 5: Run the full suite + tsc**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, all tests pass (the new viewerStore tests plus every
existing test whose fixture now includes `overhangFaceCount: 0`).

- [ ] **Step 6: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts \
  src/services/prepChecks.test.ts src/components/prepare/UnitPrompt.test.tsx \
  src/components/Sidebar.test.tsx src/components/prepare/TransformSection.test.tsx \
  src/components/prepare/DimensionsReadout.test.tsx src/components/prepare/ScaleSection.test.tsx \
  src/components/prepare/MeasureSection.test.tsx src/components/prepare/PreparePanel.test.tsx \
  src/loaders/index.test.ts
git commit -m "feat: overhang heatmap store state; GeometryDetails gains overhangFaceCount"
```

---

## Task 3: `overhangOverlay.ts` Three service

**Files:**
- Create: `src/services/overhangOverlay.ts`
- Test: `src/services/overhangOverlay.test.ts`

**Interfaces:**
- Consumes: `computeOverhangFaceMask` from `./overhangAnalysis` (Task 1, merged).
- Produces:
  - `interface OverhangOverlayResult { group: THREE.Group; hiddenMeshes: THREE.Mesh[]; meshCount: number; skippedMeshes: number }`
  - `buildOverhangOverlay(meshes: THREE.Mesh[], thresholdDeg: number, isEligible: (m: THREE.Mesh) => boolean, highlightColor?: number): OverhangOverlayResult` — for each eligible mesh: convert its geometry to non-indexed (clone if already non-indexed), bake to world space via `mesh.matrixWorld`, classify faces with `computeOverhangFaceMask`, build a per-vertex `color` attribute (each face's 3 vertices get the same colour: the mesh's own base colour when flagged `0`, `highlightColor` — default `0xff3b30` — when flagged `1`), wrap in a fresh `MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide })`, add the resulting mesh to `group` (tagged `userData.overhangOverlay = true`), and set the ORIGINAL mesh's `visible = false` (pushed onto `hiddenMeshes`). Ineligible meshes increment `skippedMeshes` and are left alone (still visible, unmodified).
  - `disposeOverhangOverlay(group: THREE.Group): void` — disposes every child mesh's geometry + material, detaches the group from its parent. Does NOT restore `hiddenMeshes` visibility (that is the caller's job, matching the hole-fill/measure overlay split of responsibility where the Viewer3D effect owns showing/hiding the real scene meshes).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildOverhangOverlay, disposeOverhangOverlay } from './overhangOverlay'

function boxMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1, 1) // indexed by default
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x123456 }))
}

describe('overhangOverlay', () => {
  it('builds one tagged overlay mesh per eligible mesh and hides the original', () => {
    const mesh = boxMesh()
    const scene = new THREE.Scene()
    scene.add(mesh)
    mesh.updateMatrixWorld(true)

    const result = buildOverhangOverlay([mesh], 45, () => true)

    expect(result.group.userData.overhangOverlay).toBe(true)
    expect(result.group.children.length).toBe(1)
    expect(result.meshCount).toBe(1)
    expect(result.skippedMeshes).toBe(0)
    expect(mesh.visible).toBe(false)
    expect(result.hiddenMeshes).toEqual([mesh])

    const overlayMesh = result.group.children[0] as THREE.Mesh
    const colorAttr = overlayMesh.geometry.getAttribute('color')
    const posAttr = overlayMesh.geometry.getAttribute('position')
    expect(colorAttr).toBeDefined()
    expect(colorAttr.count).toBe(posAttr.count)
    // BoxGeometry converted to non-indexed must not still carry an index.
    expect(overlayMesh.geometry.index).toBeNull()
  })

  it('counts an ineligible mesh as skipped and leaves it untouched', () => {
    const mesh = boxMesh()
    mesh.updateMatrixWorld(true)
    const result = buildOverhangOverlay([mesh], 45, () => false)
    expect(result.meshCount).toBe(0)
    expect(result.skippedMeshes).toBe(1)
    expect(result.group.children.length).toBe(0)
    expect(mesh.visible).toBe(true)
    expect(result.hiddenMeshes).toEqual([])
  })

  it('dispose frees geometries/materials and detaches the group', () => {
    const mesh = boxMesh()
    mesh.updateMatrixWorld(true)
    const scene = new THREE.Scene()
    const result = buildOverhangOverlay([mesh], 45, () => true)
    scene.add(result.group)
    disposeOverhangOverlay(result.group)
    expect(result.group.parent).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/overhangOverlay.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import * as THREE from 'three'
import { computeOverhangFaceMask } from './overhangAnalysis'

export interface OverhangOverlayResult {
  group: THREE.Group
  hiddenMeshes: THREE.Mesh[]
  meshCount: number
  skippedMeshes: number
}

export function buildOverhangOverlay(
  meshes: THREE.Mesh[],
  thresholdDeg: number,
  isEligible: (m: THREE.Mesh) => boolean,
  highlightColor = 0xff3b30,
): OverhangOverlayResult {
  const group = new THREE.Group()
  group.userData.overhangOverlay = true
  const hiddenMeshes: THREE.Mesh[] = []
  let meshCount = 0
  let skippedMeshes = 0
  const highlight = new THREE.Color(highlightColor)

  for (const mesh of meshes) {
    if (!isEligible(mesh)) { skippedMeshes++; continue }
    mesh.updateWorldMatrix(true, false)
    const source = mesh.geometry as THREE.BufferGeometry
    const worldGeo = source.index ? source.toNonIndexed() : source.clone()
    worldGeo.applyMatrix4(mesh.matrixWorld)

    const posAttr = worldGeo.getAttribute('position') as THREE.BufferAttribute
    const positions = posAttr.array as Float32Array
    const { mask } = computeOverhangFaceMask(positions, thresholdDeg)

    const baseHex = (mesh.material as THREE.MeshStandardMaterial)?.color?.getHex?.() ?? 0xb0b0b0
    const base = new THREE.Color(baseHex)
    const colors = new Float32Array(positions.length)
    const faceCount = Math.floor(positions.length / 9)
    for (let f = 0; f < faceCount; f++) {
      const c = mask[f] ? highlight : base
      for (let v = 0; v < 3; v++) {
        const o = (f * 3 + v) * 3
        colors[o] = c.r
        colors[o + 1] = c.g
        colors[o + 2] = c.b
      }
    }
    worldGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    worldGeo.computeVertexNormals()

    const overlayMesh = new THREE.Mesh(
      worldGeo,
      new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide,
      }),
    )
    group.add(overlayMesh)

    mesh.visible = false
    hiddenMeshes.push(mesh)
    meshCount++
  }

  return { group, hiddenMeshes, meshCount, skippedMeshes }
}

export function disposeOverhangOverlay(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      ;(child.material as THREE.Material).dispose()
    }
  }
  group.parent?.remove(group)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/overhangOverlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/overhangOverlay.ts src/services/overhangOverlay.test.ts
git commit -m "feat: overhangOverlay - world-space-baked recoloured overlay per eligible mesh"
```

---

## Task 4: wire the "Overhangs" readiness row

**Files:**
- Modify: `src/services/prepChecks.ts`
- Test: `src/services/prepChecks.test.ts` (extend)

**Interfaces:**
- Consumes: `GeometryDetails.overhangFaceCount` (Task 2, merged).
- Produces: the `overhangs` row (inside the `ANALYSIS_ROWS.map` in the `details` branch) is `pass` at count `0` (detail `"0 overhang faces"`), `warn` at count `> 0` (detail `` `${count} overhang face${count === 1 ? '' : 's'}` ``), no `fixId` in either case. The `onPlate` row's existing logic and the `!details` branch are unchanged.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('overhangs row', () => {
  const base = {
    width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1, overhangFaceCount: 0,
  }

  it('passes at zero overhang faces', () => {
    const rows = prepChecks(base)
    const row = rows.find((r) => r.id === 'overhangs')!
    expect(row.state).toBe('pass')
    expect(row.detail).toBe('0 overhang faces')
    expect(row.fixId).toBeUndefined()
  })

  it('warns (not fails) at a nonzero count, pluralised correctly', () => {
    const oneRow = prepChecks({ ...base, overhangFaceCount: 1 }).find((r) => r.id === 'overhangs')!
    expect(oneRow.state).toBe('warn')
    expect(oneRow.detail).toBe('1 overhang face')
    expect(oneRow.fixId).toBeUndefined()

    const manyRow = prepChecks({ ...base, overhangFaceCount: 5 }).find((r) => r.id === 'overhangs')!
    expect(manyRow.state).toBe('warn')
    expect(manyRow.detail).toBe('5 overhang faces')
  })

  it('is unaffected by the sealApplied remap', () => {
    const row = prepChecks({ ...base, overhangFaceCount: 3 }, true).find((r) => r.id === 'overhangs')!
    expect(row.state).toBe('warn')
    expect(row.detail).toBe('3 overhang faces')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/prepChecks.test.ts`
Expected: FAIL (row is `unavailable`).

- [ ] **Step 3: Write minimal implementation**

In the `ANALYSIS_ROWS.map` inside the `details` branch, add an `overhangs`
branch alongside the existing `onPlate` one:

```ts
    ...ANALYSIS_ROWS.map((row) => {
      if (row.id === 'onPlate' && buildVolumeMm) {
        // ... unchanged ...
      }
      if (row.id === 'overhangs') {
        const count = details.overhangFaceCount
        return count === 0
          ? { ...row, state: 'pass' as const, detail: '0 overhang faces' }
          : { ...row, state: 'warn' as const, detail: `${count} overhang face${count === 1 ? '' : 's'}` }
      }
      return { ...row, state: 'unavailable' as const, detail: 'Available in a later update' }
    }),
```

(The `thickness` row still falls through to `unavailable` — SP-4b's concern.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/prepChecks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/prepChecks.ts src/services/prepChecks.test.ts
git commit -m "feat: wire the Overhangs readiness row from overhangFaceCount"
```

---

## Task 5: exclude the overhang overlay from export

**Files:**
- Modify: `src/services/exporters.ts`
- Test: `src/services/exporters.test.ts` (extend)

**Interfaces:**
- Produces: `collectExportMeshes`'s overlay-skip check also matches `userData.overhangOverlay`.

- [ ] **Step 1: Write the failing test**

Read the existing `measureOverlay`/`holeOverlay` exclusion tests already in
`src/services/exporters.test.ts` first and mirror their exact fixture-building
and assertion style (a tagged group containing a mesh, run through
`collectExportMeshes`, assert the mesh is absent from the result). Add an
equivalent case for a group tagged `userData.overhangOverlay = true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/exporters.test.ts`
Expected: FAIL (the overhang-tagged mesh is currently collected).

- [ ] **Step 3: Write minimal implementation**

In `collectExportMeshes`'s `visit` function, change:

```ts
    if (node.userData.measureOverlay || node.userData.holeOverlay) return
```

to:

```ts
    if (node.userData.measureOverlay || node.userData.holeOverlay || node.userData.overhangOverlay) return
```

Update the comment above it to mention the overhang overlay alongside
measure/hole-fill.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/exporters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/exporters.ts src/services/exporters.test.ts
git commit -m "feat: exclude the overhang heatmap overlay from exported files"
```

---

## Task 6: Viewer3D — live overhang count + overlay build/teardown effect

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (see Global Constraints). Verification: `tsc --noEmit` clean +
full-suite no regression.

**Interfaces:**
- Consumes: `computeOverhangFaceMask` (Task 1), `buildOverhangOverlay` /
  `disposeOverhangOverlay` (Task 3), `isRepairable` (already in this file),
  `withGeometry` / `modelMeshes` / `modelRoots` / `invalidate` (already in
  this file), store fields `overhangMode` / `overhangThresholdDeg` /
  `setOverhangOverlayStatus` (Task 2, merged).
- Produces: `updateGeometryDetails()` gains an `overhangFaceCount` field on
  the object it passes to `setGeometryDetails`; a new overlay-lifecycle
  effect; a new auto-disarm effect; a new threshold-change recompute effect.

- [ ] **Step 1: Add the world-space overhang count to `updateGeometryDetails`**

Import at the top of the file:

```ts
import { computeOverhangFaceMask } from '../services/overhangAnalysis'
import { buildOverhangOverlay, disposeOverhangOverlay } from '../services/overhangOverlay'
```

In `updateGeometryDetails()` (`Viewer3D.tsx:222-245`), after `const health =
summariseHealth(...)` and before the `unitScales` computation, add:

```ts
    const overhangThreshold = useViewerStore.getState().overhangThresholdDeg
    let overhangFaceCount = 0
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false)
      const geo = mesh.geometry as THREE.BufferGeometry
      const worldGeo = geo.index ? geo.toNonIndexed() : geo.clone()
      worldGeo.applyMatrix4(mesh.matrixWorld)
      const posAttr = worldGeo.getAttribute('position') as THREE.BufferAttribute
      overhangFaceCount += computeOverhangFaceMask(posAttr.array as Float32Array, overhangThreshold).count
      worldGeo.dispose()
    }
```

Add `overhangFaceCount,` to the object passed to `setGeometryDetails({...})`
(alongside `width`, `height`, `depth`, `meshes: meshes.length`,
`modelUnitInMm`, `...health`).

- [ ] **Step 2: Add an overlay ref near `holeOverlayRef`**

```ts
  const overhangOverlayRef = useRef<{ group: THREE.Group; hiddenMeshes: THREE.Mesh[] } | null>(null)
```

- [ ] **Step 3: Add rebuild/teardown helpers near `rebuildHoleOverlays`/`teardownHoleOverlays`**

```ts
  const rebuildOverhangOverlay = () => {
    const scene = sceneRef.current
    if (!scene) return
    teardownOverhangOverlay()
    const meshes = withGeometry(modelMeshes())
    const threshold = useViewerStore.getState().overhangThresholdDeg
    const { group, hiddenMeshes, meshCount, skippedMeshes } = buildOverhangOverlay(meshes, threshold, isRepairable)
    scene.add(group)
    overhangOverlayRef.current = { group, hiddenMeshes }
    useViewerStore.getState().setOverhangOverlayStatus({ meshCount, skippedMeshes })
    invalidate()
  }

  const teardownOverhangOverlay = () => {
    const cur = overhangOverlayRef.current
    if (cur) {
      disposeOverhangOverlay(cur.group)
      for (const m of cur.hiddenMeshes) m.visible = true
    }
    overhangOverlayRef.current = null
    useViewerStore.getState().setOverhangOverlayStatus(null)
    invalidate()
  }
```

- [ ] **Step 4: Add the three new effects**, placed after Effect 10e (the
  measure/hole-fill mutual-exclusion effects, `Viewer3D.tsx:1848-1859`):

```ts
  // Effect 12: Overhang heatmap — build/rebuild the recoloured overlay while
  // armed. No pointer wiring: this is a read-only view, not a pick tool, so
  // there is nothing to click.
  const overhangMode = useViewerStore((s) => s.overhangMode)
  const overhangThresholdDeg = useViewerStore((s) => s.overhangThresholdDeg)
  useEffect(() => {
    if (!overhangMode) return
    const scene = sceneRef.current
    if (!scene) return
    rebuildOverhangOverlay()
    return () => {
      teardownOverhangOverlay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overhangMode, overhangThresholdDeg, rendererGen])

  // Effect 13: Auto-disarm the overhang heatmap when the Repair dialog opens
  // — a repair can rewrite the geometry the overlay is a frozen copy of.
  useEffect(() => {
    if (repairDialogOpen && overhangMode) useViewerStore.getState().setOverhangMode(false)
  }, [repairDialogOpen, overhangMode])

  // Effect 14: Changing the overhang threshold recomputes the live readiness
  // count even when the heatmap itself is not armed (Effect 12 already
  // rebuilds the overlay on this same dependency when it IS armed).
  useEffect(() => {
    updateGeometryDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overhangThresholdDeg])
```

`repairDialogOpen` is already declared earlier in the file (Effect 9's
`const repairDialogOpen = useViewerStore((s) => s.repairDialogOpen)`) — do
not redeclare it.

- [ ] **Step 5: Type-check + full suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, no regression.

- [ ] **Step 6: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D - live overhang count and heatmap overlay lifecycle"
```

---

## Task 7: `AnalysisSection` component

**Files:**
- Create: `src/components/prepare/AnalysisSection.tsx`
- Test: `src/components/prepare/AnalysisSection.test.tsx`

**Interfaces:**
- Consumes: `useViewerStore` (`geometryDetails`, `overhangMode`,
  `overhangThresholdDeg`, `overhangOverlayStatus`, `setOverhangMode`,
  `setOverhangThresholdDeg`). No `viewerRef` — everything is store-driven;
  `Viewer3D` reacts to `overhangMode`/`overhangThresholdDeg` directly via
  Task 6's effects.
- Produces: `AnalysisSection()` (no props).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalysisSection } from './AnalysisSection'
import { useViewerStore } from '../../store/viewerStore'

const details = {
  width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: 1, overhangFaceCount: 0,
}

describe('AnalysisSection', () => {
  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: null, overhangMode: false, overhangThresholdDeg: 45, overhangOverlayStatus: null,
    }),
  )

  it('disables the toggle and threshold input without a model', () => {
    render(<AnalysisSection />)
    expect((screen.getByRole('button', { name: 'Show overhang heatmap' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Overhang angle') as HTMLInputElement).disabled).toBe(true)
  })

  it('toggles overhang mode', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Show overhang heatmap' }))
    expect(useViewerStore.getState().overhangMode).toBe(true)
  })

  it('updates the threshold on a valid value', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection />)
    const input = screen.getByLabelText('Overhang angle')
    await userEvent.clear(input)
    await userEvent.type(input, '30')
    expect(useViewerStore.getState().overhangThresholdDeg).toBe(30)
  })

  it('ignores an out-of-range threshold value', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<AnalysisSection />)
    const input = screen.getByLabelText('Overhang angle')
    await userEvent.clear(input)
    await userEvent.type(input, '999')
    expect(useViewerStore.getState().overhangThresholdDeg).toBe(45)
  })

  it('shows the not-eligible note when meshes were skipped', () => {
    useViewerStore.setState({
      geometryDetails: details,
      overhangMode: true,
      overhangOverlayStatus: { meshCount: 1, skippedMeshes: 2 },
    })
    render(<AnalysisSection />)
    expect(screen.getByText('2 meshes not eligible')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/AnalysisSection.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/prepare/AnalysisSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/AnalysisSection.tsx src/components/prepare/AnalysisSection.test.tsx
git commit -m "feat: AnalysisSection - overhang heatmap toggle and threshold"
```

---

## Task 8: mount `AnalysisSection` into the Prepare panel

**Files:**
- Modify: `src/components/prepare/PreparePanel.tsx`
- Test: `src/components/prepare/PreparePanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `AnalysisSection` from Task 7.
- Produces: `<AnalysisSection />` mounted after `<TransformSection>` in
  `PreparePanel`'s render (no `viewerRef` needed for this section).

- [ ] **Step 1: Extend `PreparePanel.test.tsx`**

```ts
it('renders the Analysis section', () => {
  useViewerStore.setState({
    geometryDetails: {
      width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
      boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
      watertight: true, modelUnitInMm: 1, overhangFaceCount: 0,
    },
  })
  render(<PreparePanel viewerRef={{ current: null }} />)
  expect(screen.getByRole('heading', { name: 'Analysis' })).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/prepare/PreparePanel.test.tsx`
Expected: FAIL, no "Analysis" heading.

- [ ] **Step 3: Wire `PreparePanel.tsx`**

Add the import:

```tsx
import { AnalysisSection } from './AnalysisSection'
```

Add the mount, after `<TransformSection viewerRef={viewerRef} />`:

```tsx
      <AnalysisSection />
```

- [ ] **Step 4: Run test to verify it passes, then the full suite**

Run: `pnpm test -- src/components/prepare/PreparePanel.test.tsx`
Expected: PASS.

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/PreparePanel.tsx src/components/prepare/PreparePanel.test.tsx
git commit -m "feat: mount AnalysisSection into the Prepare panel"
```

---

## Task 9: end-to-end spec (hard completion gate)

**Files:**
- Create: `e2e/overhang-heatmap.spec.ts`

Follow the structure of `e2e/transform-panel.spec.ts` and
`e2e/units-measure.spec.ts`: deterministic inline STL, `.filter({ visible:
true })` on every panel/toolbar/tab locator (desktop + hidden-mobile double
sidebar mount), `test.skip(isMobile, ...)`, `test.setTimeout(120_000)`.

**Fixture, hand-derived (do not regenerate differently):** a flat two-triangle
plate rotated 30 degrees about the X axis from a straight-down-facing plate,
so its face normal is exactly 30 degrees from straight-down (derivation: see
the design spec and Task 1's third test case). With `w = 20`, `d = 10`:

```
cos30 = 0.8660254, sin30 = 0.5
P0 = (0, 0, 0)
P1 = (20, 0, 0)
P2 = (20, -5, 8.660254)
P3 = (0, -5, 8.660254)
```

Two triangles `(P0, P1, P2)` and `(P0, P2, P3)`, both sharing the same face
plane (30 degrees from straight down). At the default threshold (45), BOTH
triangles are overhangs (`overhangFaceCount = 2`). At a threshold below 30
(e.g. 15), NEITHER is (`overhangFaceCount = 0`).

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test'

/** A flat plate rotated 30 deg about X from straight-down-facing, so its
 *  face normal sits exactly 30 deg from straight down. See the design spec
 *  and overhangAnalysis.test.ts for the derivation. Both triangles share
 *  the same face plane. */
function rampPlateStl(): string {
  const p0 = [0, 0, 0]
  const p1 = [20, 0, 0]
  const p2 = [20, -5, 8.660254]
  const p3 = [0, -5, 8.660254]
  const tris = [[p0, p1, p2], [p0, p2, p3]]
  let out = 'solid ramp\n'
  for (const tri of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const v of tri) out += `vertex ${v[0]} ${v[1]} ${v[2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid ramp\n'
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

test.describe('Overhang heatmap', () => {
  test('flags the ramp at the default threshold, clears below its angle, toggles, and exports', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Overhang heatmap flow verified on desktop')
    test.setTimeout(120_000)
    // Force the download-event export path instead of a native file picker,
    // matching e2e/model-workflows.spec.ts's export test.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    await dropStl(page, rampPlateStl(), 'ramp.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    // Default threshold (45): the 30-deg ramp face is an overhang.
    await expect(check('overhangs')).toHaveAttribute('data-state', 'warn')
    await expect(check('overhangs')).toContainText('2 overhang faces')

    // Lower the threshold below the ramp's angle: no longer an overhang.
    const thresholdInput = page.getByLabel('Overhang angle').filter({ visible: true })
    await thresholdInput.fill('15')
    await expect(check('overhangs')).toHaveAttribute('data-state', 'pass')
    await expect(check('overhangs')).toContainText('0 overhang faces')

    // Restore the default so the heatmap toggle below is exercised at a
    // threshold where the ramp is actually flagged.
    await thresholdInput.fill('45')
    await expect(check('overhangs')).toHaveAttribute('data-state', 'warn')

    // Toggle the heatmap on and off without error.
    const toggle = page.getByRole('button', { name: /overhang heatmap/i }).filter({ visible: true })
    await toggle.click()
    await expect(page.getByRole('button', { name: 'Hide overhang heatmap' }).filter({ visible: true })).toBeVisible()
    await toggle.click()
    await expect(page.getByRole('button', { name: 'Show overhang heatmap' }).filter({ visible: true })).toBeVisible()

    // Arm it again and confirm export still succeeds (proves the
    // userData.overhangOverlay exclusion tag works end to end).
    await toggle.click()
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export model as…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export model' })
    await expect(dialog).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('ramp.stl')
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/overhang-heatmap.spec.ts`
Expected: 1 passed (desktop), 1 skipped (mobile). If a selector doesn't
match the real DOM (the export menu item's exact role/name, the readiness
row's `data-testid`/`data-state` shape, the toggle button's accessible name),
adjust to match what `e2e/model-workflows.spec.ts` (export flow) and
`e2e/prepare-panel.spec.ts` (readiness row shape) already established —
those are the source of truth, not this plan's guess. Run at least twice to
confirm stability. Do not add retries or waits beyond what those files
already use.

- [ ] **Step 3: Commit**

```bash
git add e2e/overhang-heatmap.spec.ts
git commit -m "test: e2e overhang readiness row, threshold change, toggle, export exclusion"
```

---

## Task 10: docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** — add a short "Overhang heatmap" entry near the
  other Prepare-panel feature entries: highlights faces past a configurable
  overhang angle (default 45 deg) directly in the viewport, and a live
  readiness-card row. Match the surrounding feature-list style, no em dash
  (repo convention).

- [ ] **Step 2: CHANGELOG** — add an entry under the current/next version
  heading, matching prior entries' format:

```
- Prepare panel: overhang heatmap (SP-4a). Colours faces past a
  configurable overhang angle (default 45 degrees from straight down)
  directly in the viewport; the Overhangs readiness row is now live.
```

- [ ] **Step 3: roadmap** — in
  `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`, add an "SP-4
  decomposition" section (mirroring the SP-2/SP-3 decomposition tables)
  marking SP-4a SHIPPED with branch name, commit range (fill in from `git
  log` once Task 1-9 commits exist), files touched (`overhangAnalysis.ts`,
  `overhangOverlay.ts`, `AnalysisSection.tsx`, the `GeometryDetails` /
  `prepChecks` / `exporters.ts` / `Viewer3D.tsx` changes), spec link
  `../specs/2026-09-05-sp4a-overhang-heatmap-design.md`, plan link
  `../plans/2026-09-05-sp4a-overhang-heatmap.md`. Note SP-4b
  (wall-thickness heatmap, needs `three-mesh-bvh`) and SP-4c
  (X-ray/clipping) as the remaining, not-started cycles of SP-4.

- [ ] **Step 4: Sanity check**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS (no code change, sanity only).

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-4a overhang heatmap"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| Overhang definition / pure classification | 1 |
| `GeometryDetails.overhangFaceCount` + store fields + fixture ripple | 2 |
| Overlay build/dispose (world-space bake, base/highlight colour, eligibility skip) | 3 |
| Readiness row (`pass`/`warn`, no `fixId`) | 4 |
| Export exclusion tag | 5 |
| Live count computation + overlay lifecycle + repair-dialog auto-disarm + threshold-change recompute | 6 |
| Toggle + threshold UI, locked only on `!geometryDetails` | 7 |
| Mount | 8 |
| E2e hard gate | 9 |
| Docs | 10 |

Non-goals (continuous gradient, full N-way edit interlock, persisted
threshold, SP-4b/SP-4c) are explicitly out and have no task, as intended.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N".
Every code step has full code, including the hand-derived e2e fixture
geometry (no vague "pick a wedge shape" left for the implementer to
improvise incorrectly).

**3. Type consistency:** `computeOverhangFaceMask(positions, thresholdDeg)`
— Tasks 1, 3, 6, all call sites pass a `Float32Array` and a `number`,
matching. `buildOverhangOverlay(meshes, thresholdDeg, isEligible,
highlightColor?)` / `disposeOverhangOverlay(group)` — Tasks 3, 6 use the
same signature. `GeometryDetails.overhangFaceCount: number` — Tasks 2, 4, 6,
7, 8 all read/write it consistently. Store field names (`overhangMode`,
`overhangThresholdDeg`, `overhangOverlayStatus`, `setOverhangMode`,
`setOverhangThresholdDeg`, `setOverhangOverlayStatus`) consistent across
Tasks 2, 6, 7. `AnalysisSection` takes no props anywhere it's referenced
(Tasks 7, 8) — deliberately different from every other Prepare-panel
section, called out explicitly in Task 7/8 so a reviewer doesn't flag the
missing `viewerRef` as an oversight.
