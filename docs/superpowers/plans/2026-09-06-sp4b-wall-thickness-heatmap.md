# SP-4b: Wall-thickness Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colour faces whose local wall is thinner than a configurable minimum (default 1.0 mm) directly in the viewport, and turn the SP-1 readiness card's disabled "Thin walls" row into a live check. Ship the in-app help entry and docs in the same cycle (roadmap standing rule).

**Architecture:** A near-total mirror of SP-4a's overhang heatmap. New `three-mesh-bvh` dependency. `wallThickness.ts` builds a `MeshBVH` on a world-space-baked non-indexed geometry and casts one inward ray per face centroid to measure the distance to the opposite wall; a face is thin when `distance * modelUnitInMm < minWallMm`, and 'unsampled' when the ray escapes. `wallThicknessOverlay.ts` mirrors `overhangOverlay.ts` (world-bake, per-face colour, hide originals after the loop, `userData.wallThicknessOverlay` tag). `GeometryDetails.thinWallFaceCount: number | null` (nullable: `null` when total triangles exceed `WALL_THICKNESS_MAX_TRIANGLES = 250_000` or nothing is loaded). `prepChecks` `thickness` row goes live. `Viewer3D` gets a parallel overlay effect, repair-dialog auto-disarm, threshold-recompute effect, and mutual-exclusion effects so only one of {overhang, wall-thickness, hole-fill} is armed at a time. `AnalysisSection` grows a second tool. `HelpModal.HELP_SECTIONS` gains an entry.

**Tech Stack:** React 19, Three 0.185, three-mesh-bvh, Zustand 5, Vitest, Playwright, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-06-sp4b-wall-thickness-heatmap-design.md`

## Global Constraints

- **`three-mesh-bvh` is the ONE allowed new dependency** (roadmap locked decision). Add it to `dependencies`, pinned to an exact version (matching the repo's exact pins for `three` `0.185.1` / `@types/three` `0.185.0`). Used only in `wallThickness.ts`. No global `THREE.Mesh.prototype.raycast` monkey-patch - construct `MeshBVH` and call `bvh.raycastFirst` directly.
- **`WALL_THICKNESS_MAX_TRIANGLES = 250_000`.** When the summed triangle count of the analysed meshes exceeds this, no BVH is built: `thinWallFaceCount` is `null`, the readiness row is `unavailable` ("Too large to analyse"), the overlay toggle is disabled with a note.
- **`GeometryDetails.thinWallFaceCount: number | null`** (required field, nullable). Ten existing test files construct `GeometryDetails` literals (the same list that carries `overhangFaceCount: 0`); each needs `thinWallFaceCount: 0` added - one batch task, same as SP-4a.
- **World-space, per-face, one inward ray.** Classify from positions baked through `mesh.matrixWorld` (`geometry.index ? geometry.toNonIndexed() : geometry.clone()` then `applyMatrix4`). Ray origin `centroid - normal * eps` (eps a tiny fraction of the bounding-sphere radius), direction `-normal`, `bvh.raycastFirst(ray, THREE.DoubleSide)`. Hit -> `thicknessMm = hit.distance * (modelUnitInMm ?? 1)`. No hit -> unsampled.
- **`thickness` readiness row:** `null` -> `unavailable`; `0` -> `pass` ("0 thin-wall faces"); `> 0` -> `warn` (not `fail`) ("N thin-wall face(s)"), no `fixId`.
- **Highlight colour `0xff3b30`** (same red as overhang - the two heatmaps are never shown together, "problem = red" is consistent).
- **Only one heatmap / hole-fill armed at once.** Add mutual-exclusion effects mirroring the existing Effect 10d/10e / 10f/10g pattern (each `useEffect` keyed on the single flag turning on): arming any of `overhangMode` / `wallThicknessMode` / `holeFillMode` disarms the other two. NO interlock with `measureMode`.
- **`AnalysisSection` stays locked only on `!geometryDetails`** overall (read-only view). The wall-thickness toggle is additionally disabled when `geometryDetails.thinWallFaceCount === null`.
- **No jest-dom** - vitest/RTL-core assertions only in component tests.
- **No unit test for `Viewer3D.tsx`'s new overlay effect** (WebGL-less jsdom, same as every prior Viewer3D effect). `wallThickness.ts` itself IS pure CPU and fully unit-tested. `tsc` + no suite regression + the e2e are the gate.
- **`pnpm test` (full suite) + `pnpm exec tsc --noEmit` pass before every commit.**
- **No em dash** in prose, comments, or commit messages.

---

## Task 1: add the `three-mesh-bvh` dependency

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install it pinned**

Run: `pnpm add three-mesh-bvh` then edit `package.json` to pin the resolved
version EXACTLY (strip any `^`), matching the `three` / `@types/three`
exact-pin style. It goes under `dependencies` (it ships runtime code).

- [ ] **Step 2: Verify it imports and the suite is unaffected**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean, 413 tests still pass (no code uses the lib yet).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add three-mesh-bvh for wall-thickness raycasting"
```

---

## Task 2: `wallThickness.ts` analysis service

**Files:**
- Create: `src/services/wallThickness.ts`
- Test: `src/services/wallThickness.test.ts`

**Interfaces:**
- Produces:
  - `WALL_THICKNESS_MAX_TRIANGLES = 250_000` (exported const).
  - `interface WallThicknessMaskResult { mask: Uint8Array; thinCount: number; unsampledCount: number }`
  - `computeWallThicknessMask(geometry: THREE.BufferGeometry, minWallMm: number, unitInMm: number): WallThicknessMaskResult` - `geometry` must be world-space-baked and non-indexed (caller's job); builds a `MeshBVH`, one inward ray per face centroid, thin when `hit.distance * unitInMm < minWallMm`, unsampled on a miss, degenerate faces skipped.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computeWallThicknessMask, WALL_THICKNESS_MAX_TRIANGLES } from './wallThickness'

function geo(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  return g
}

describe('computeWallThicknessMask', () => {
  it('exports the triangle cap', () => {
    expect(WALL_THICKNESS_MAX_TRIANGLES).toBe(250_000)
  })

  it('flags both faces of a 0.5-unit slab at min-wall 1.0 mm and neither at 0.2 mm', () => {
    // Top triangle: winding gives normal (0, 1, 0). Bottom triangle at y = -0.5:
    // winding gives normal (0, -1, 0). Each face's inward ray travels 0.5 units
    // to the opposite plane.
    const g = geo([
      0, 0, 0, 1, 0, 1, 1, 0, 0, // top, normal +Y
      0, -0.5, 0, 1, -0.5, 0, 1, -0.5, 1, // bottom, normal -Y
    ])
    expect(computeWallThicknessMask(g, 1.0, 1).thinCount).toBe(2)
    expect(computeWallThicknessMask(g, 0.2, 1).thinCount).toBe(0)
  })

  it('respects unitInMm', () => {
    const g = geo([
      0, 0, 0, 1, 0, 1, 1, 0, 0,
      0, -0.5, 0, 1, -0.5, 0, 1, -0.5, 1,
    ])
    // 0.5 units * 10 mm/unit = 5 mm, not thin against a 1 mm minimum
    expect(computeWallThicknessMask(g, 1.0, 10).thinCount).toBe(0)
  })

  it('does not flag a thick 5-unit block', () => {
    const g = geo([
      0, 0, 0, 1, 0, 1, 1, 0, 0,
      0, -5, 0, 1, -5, 0, 1, -5, 1,
    ])
    expect(computeWallThicknessMask(g, 1.0, 1).thinCount).toBe(0)
  })

  it('counts a face whose ray escapes as unsampled', () => {
    const g = geo([0, 0, 0, 1, 0, 1, 1, 0, 0]) // lone triangle, nothing opposite
    const r = computeWallThicknessMask(g, 1.0, 1)
    expect(r.thinCount).toBe(0)
    expect(r.unsampledCount).toBe(1)
  })

  it('skips a degenerate triangle without throwing', () => {
    const g = geo([0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => computeWallThicknessMask(g, 1.0, 1)).not.toThrow()
    const r = computeWallThicknessMask(g, 1.0, 1)
    expect(r.thinCount).toBe(0)
    expect(r.unsampledCount).toBe(0)
    expect(r.mask.length).toBe(1)
  })

  it('mask length equals the face count', () => {
    const g = geo([
      0, 0, 0, 1, 0, 1, 1, 0, 0,
      0, -0.5, 0, 1, -0.5, 0, 1, -0.5, 1,
    ])
    expect(computeWallThicknessMask(g, 1.0, 1).mask.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/wallThickness.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export const WALL_THICKNESS_MAX_TRIANGLES = 250_000

export interface WallThicknessMaskResult {
  mask: Uint8Array
  thinCount: number
  unsampledCount: number
}

const NORMAL_EPSILON = 1e-10

/**
 * Classify each triangle of a WORLD-SPACE, NON-INDEXED geometry as thin or not
 * by casting one ray inward from the face centroid to the opposite wall.
 * `unitInMm` scales the world-space hit distance to millimetres. A face whose
 * ray escapes (open surface) is 'unsampled' - not thin, not counted, tallied
 * separately. A degenerate (zero-area) face is skipped entirely.
 */
export function computeWallThicknessMask(
  geometry: THREE.BufferGeometry,
  minWallMm: number,
  unitInMm: number,
): WallThicknessMaskResult {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
  const positions = posAttr.array as Float32Array
  const faceCount = Math.floor(positions.length / 9)
  const mask = new Uint8Array(faceCount)
  let thinCount = 0
  let unsampledCount = 0

  if (faceCount === 0) return { mask, thinCount, unsampledCount }

  const bvh = new MeshBVH(geometry)
  geometry.computeBoundingSphere()
  const radius = geometry.boundingSphere?.radius ?? 1
  const eps = Math.max(radius * 1e-4, 1e-6)

  const origin = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const ray = new THREE.Ray()

  for (let f = 0; f < faceCount; f++) {
    const o = f * 9
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5]
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < NORMAL_EPSILON) continue
    nx /= len; ny /= len; nz /= len
    const cxm = (ax + bx + cx) / 3
    const cym = (ay + by + cy) / 3
    const czm = (az + bz + cz) / 3
    origin.set(cxm - nx * eps, cym - ny * eps, czm - nz * eps)
    dir.set(-nx, -ny, -nz)
    ray.set(origin, dir)
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide)
    if (!hit) { unsampledCount++; continue }
    const thicknessMm = hit.distance * unitInMm
    if (thicknessMm < minWallMm) { mask[f] = 1; thinCount++ }
  }

  return { mask, thinCount, unsampledCount }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/wallThickness.test.ts`
Expected: PASS. If `bvh.raycastFirst`'s exact signature differs in the
installed `three-mesh-bvh` version (arg order for `side` / `near` / `far`),
consult its README via the `three-mesh-bvh` package docs and adjust the call
only - do not change the algorithm.

- [ ] **Step 5: Commit**

```bash
git add src/services/wallThickness.ts src/services/wallThickness.test.ts
git commit -m "feat: wallThickness - per-face inward-ray thickness classification"
```

---

## Task 3: `wallThicknessOverlay.ts`

**Files:**
- Create: `src/services/wallThicknessOverlay.ts`
- Test: `src/services/wallThicknessOverlay.test.ts`

Mirror `src/services/overhangOverlay.ts` EXACTLY (read it first), with these
deltas:

- Name: `buildWallThicknessOverlay(meshes, minWallMm, unitInMm, isEligible, highlightColor = 0xff3b30)`, `disposeWallThicknessOverlay(group)`.
- Group tag: `group.userData.wallThicknessOverlay = true` (not `overhangOverlay`).
- Per eligible, VISIBLE mesh: same `geometry.index ? toNonIndexed() : clone()` -> `applyMatrix4(mesh.matrixWorld)` world-bake, then classify with `computeWallThicknessMask(worldGeo, minWallMm, unitInMm)` from `./wallThickness` (returns `{ mask, thinCount, unsampledCount }`). Build the per-vertex `color` attribute exactly as overhang does: each face's 3 vertices get `highlightColor` when `mask[f]` else the mesh's base colour (`(mesh.material as THREE.MeshStandardMaterial)?.color?.getHex?.() ?? 0xb0b0b0`).
- Carry SP-4a's final-review fixes from the start: skip `!mesh.visible` meshes (no `skippedMeshes++` for those), collect meshes to hide in a local array and set `visible = false` only AFTER the loop succeeds, `hiddenMeshes` = that array.
- Result adds `unsampledFaces` (sum of `unsampledCount` across meshes): `{ group, hiddenMeshes, meshCount, skippedMeshes, unsampledFaces }`.
- `disposeWallThicknessOverlay` identical to `disposeOverhangOverlay` (dispose each child mesh's geometry + material, `group.parent?.remove(group)`, does NOT restore visibility).

**Interfaces:**
- Consumes: `computeWallThicknessMask` from `./wallThickness`.
- Produces: `interface WallThicknessOverlayResult { group: THREE.Group; hiddenMeshes: THREE.Mesh[]; meshCount: number; skippedMeshes: number; unsampledFaces: number }`, `buildWallThicknessOverlay(...)`, `disposeWallThicknessOverlay(group)`.

- [ ] **Step 1: Write the failing test**

Mirror `src/services/overhangOverlay.test.ts` (read it), adapted:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildWallThicknessOverlay, disposeWallThicknessOverlay } from './wallThicknessOverlay'

/** A thin 0.5-unit slab: top face normal +Y, bottom -Y, 0.5 apart. */
function slabMesh(baseHex = 0x808080): THREE.Mesh {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 1, 1, 0, 0,
    0, -0.5, 0, 1, -0.5, 0, 1, -0.5, 1,
  ]), 3))
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: baseHex }))
}

describe('wallThicknessOverlay', () => {
  it('builds one tagged overlay mesh per eligible visible mesh and hides the original', () => {
    const mesh = slabMesh()
    const scene = new THREE.Scene()
    scene.add(mesh)
    mesh.updateMatrixWorld(true)

    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => true)
    expect(r.group.userData.wallThicknessOverlay).toBe(true)
    expect(r.group.children.length).toBe(1)
    expect(r.meshCount).toBe(1)
    expect(r.skippedMeshes).toBe(0)
    expect(mesh.visible).toBe(false)
    expect(r.hiddenMeshes).toEqual([mesh])

    const overlay = r.group.children[0] as THREE.Mesh
    const colorAttr = overlay.geometry.getAttribute('color')
    const posAttr = overlay.geometry.getAttribute('position')
    expect(colorAttr).toBeDefined()
    expect(colorAttr.count).toBe(posAttr.count)
    // Both slab faces are thin at 1.0 mm -> every vertex carries the highlight.
    const hi = new THREE.Color(0xff3b30)
    expect(colorAttr.getX(0)).toBeCloseTo(hi.r)
    expect(colorAttr.getY(0)).toBeCloseTo(hi.g)
    expect(colorAttr.getZ(0)).toBeCloseTo(hi.b)
  })

  it('leaves non-thin faces at the base colour', () => {
    const mesh = slabMesh(0x808080)
    mesh.updateMatrixWorld(true)
    // 0.2 mm minimum -> the 0.5-unit slab is NOT thin -> base colour.
    const r = buildWallThicknessOverlay([mesh], 0.2, 1, () => true)
    const overlay = r.group.children[0] as THREE.Mesh
    const colorAttr = overlay.geometry.getAttribute('color')
    const base = new THREE.Color(0x808080)
    expect(colorAttr.getX(0)).toBeCloseTo(base.r)
  })

  it('skips an already-hidden mesh without counting it as skipped-ineligible', () => {
    const mesh = slabMesh()
    mesh.visible = false
    mesh.updateMatrixWorld(true)
    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => true)
    expect(r.meshCount).toBe(0)
    expect(r.skippedMeshes).toBe(0)
    expect(r.group.children.length).toBe(0)
  })

  it('counts an ineligible mesh as skipped', () => {
    const mesh = slabMesh()
    mesh.updateMatrixWorld(true)
    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => false)
    expect(r.meshCount).toBe(0)
    expect(r.skippedMeshes).toBe(1)
    expect(mesh.visible).toBe(true)
  })

  it('reports unsampled faces', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 1, 1, 0, 0]), 3))
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x808080 }))
    mesh.updateMatrixWorld(true)
    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => true)
    expect(r.unsampledFaces).toBe(1)
  })

  it('dispose frees and detaches', () => {
    const mesh = slabMesh()
    mesh.updateMatrixWorld(true)
    const scene = new THREE.Scene()
    const r = buildWallThicknessOverlay([mesh], 1.0, 1, () => true)
    scene.add(r.group)
    disposeWallThicknessOverlay(r.group)
    expect(r.group.parent).toBeNull()
  })
})
```

- [ ] **Step 2-5:** run red, implement (mirror `overhangOverlay.ts` with the
  deltas above), run green, full suite, commit:

```bash
git add src/services/wallThicknessOverlay.ts src/services/wallThicknessOverlay.test.ts
git commit -m "feat: wallThicknessOverlay - recoloured thin-wall overlay per eligible mesh"
```

---

## Task 4: store fields + `GeometryDetails.thinWallFaceCount` ripple

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts` (extend)
- Modify (mechanical, `thinWallFaceCount: 0` into each `GeometryDetails` literal): `src/services/prepChecks.test.ts`, `src/components/prepare/UnitPrompt.test.tsx`, `src/components/Sidebar.test.tsx`, `src/components/prepare/TransformSection.test.tsx`, `src/components/prepare/DimensionsReadout.test.tsx`, `src/components/prepare/ScaleSection.test.tsx`, `src/components/prepare/MeasureSection.test.tsx`, `src/components/prepare/PreparePanel.test.tsx`, `src/components/prepare/AnalysisSection.test.tsx`, `src/services/exporters.test.ts` (only if any construct one - grep each for `overhangFaceCount` as the locator)

**Interfaces:**
- Produces on the store:
  - `GeometryDetails.thinWallFaceCount: number | null`
  - `wallThicknessMode: boolean` (default `false`)
  - `minWallThicknessMm: number` (default `1.0`)
  - `wallThicknessOverlayStatus: { meshCount: number; skippedMeshes: number; unsampledFaces: number } | null` (default `null`)
  - `setWallThicknessMode(on: boolean): void`, `setMinWallThicknessMm(mm: number): void`, `setWallThicknessOverlayStatus(status: ... | null): void`
  - `setFile` / `setFileFromBuffer` also reset `wallThicknessMode: false` and `wallThicknessOverlayStatus: null` (NOT `minWallThicknessMm`).

- [ ] **Step 1: Write the failing test** (append to `viewerStore.test.ts`)

```ts
describe('wall thickness heatmap state', () => {
  beforeEach(() =>
    useViewerStore.setState({ wallThicknessMode: false, minWallThicknessMm: 1.0, wallThicknessOverlayStatus: null }),
  )

  it('defaults', () => {
    const s = useViewerStore.getState()
    expect(s.wallThicknessMode).toBe(false)
    expect(s.minWallThicknessMm).toBe(1.0)
    expect(s.wallThicknessOverlayStatus).toBeNull()
  })

  it('set actions', () => {
    useViewerStore.getState().setWallThicknessMode(true)
    expect(useViewerStore.getState().wallThicknessMode).toBe(true)
    useViewerStore.getState().setMinWallThicknessMm(0.6)
    expect(useViewerStore.getState().minWallThicknessMm).toBe(0.6)
    useViewerStore.getState().setWallThicknessOverlayStatus({ meshCount: 1, skippedMeshes: 0, unsampledFaces: 3 })
    expect(useViewerStore.getState().wallThicknessOverlayStatus).toEqual({ meshCount: 1, skippedMeshes: 0, unsampledFaces: 3 })
  })

  it('setFile clears wallThicknessMode and status but not the threshold', () => {
    useViewerStore.getState().setWallThicknessMode(true)
    useViewerStore.getState().setWallThicknessOverlayStatus({ meshCount: 1, skippedMeshes: 0, unsampledFaces: 0 })
    useViewerStore.getState().setMinWallThicknessMm(0.4)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    expect(useViewerStore.getState().wallThicknessMode).toBe(false)
    expect(useViewerStore.getState().wallThicknessOverlayStatus).toBeNull()
    expect(useViewerStore.getState().minWallThicknessMm).toBe(0.4)
  })
})
```

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement** - add `thinWallFaceCount: number | null` to the
  `GeometryDetails` interface; add the four store fields + three setters next
  to the `overhang*` ones; add `wallThicknessMode: false,
  wallThicknessOverlayStatus: null,` to BOTH `setFile` and
  `setFileFromBuffer` set objects.

- [ ] **Step 4: Ripple** - in each listed test file, add `thinWallFaceCount:
  0,` to every `GeometryDetails` object literal (find them by grepping for
  `overhangFaceCount`). Run `pnpm exec tsc --noEmit` - it is the real check
  that no literal was missed anywhere in the repo; fix any it flags.

- [ ] **Step 5:** `pnpm exec tsc --noEmit && pnpm test` clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wall thickness heatmap store state; GeometryDetails gains thinWallFaceCount"
```

---

## Task 5: wire the "Thin walls" readiness row

**Files:**
- Modify: `src/services/prepChecks.ts`
- Test: `src/services/prepChecks.test.ts` (extend)

**Interfaces:**
- Consumes: `GeometryDetails.thinWallFaceCount`.
- Produces: the `thickness` row (id `thickness`, label "Thin walls") inside the `ANALYSIS_ROWS.map` `details` branch: `null` -> `{ ...row, state: 'unavailable', detail: 'Too large to analyse' }`; `0` -> `{ ...row, state: 'pass', detail: '0 thin-wall faces' }`; `> 0` -> `{ ...row, state: 'warn', detail: \`${n} thin-wall face${n === 1 ? '' : 's'}\` }`. No `fixId`. `onPlate`, `overhangs`, and the `!details` branch unchanged.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('thin walls row', () => {
  const base = {
    width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
  }

  it('unavailable when the count is null', () => {
    const row = prepChecks({ ...base, thinWallFaceCount: null }).find((r) => r.id === 'thickness')!
    expect(row.state).toBe('unavailable')
    expect(row.detail).toBe('Too large to analyse')
  })

  it('passes at zero', () => {
    const row = prepChecks(base).find((r) => r.id === 'thickness')!
    expect(row.state).toBe('pass')
    expect(row.detail).toBe('0 thin-wall faces')
    expect(row.fixId).toBeUndefined()
  })

  it('warns (not fails) at a nonzero count, pluralised', () => {
    const one = prepChecks({ ...base, thinWallFaceCount: 1 }).find((r) => r.id === 'thickness')!
    expect(one.state).toBe('warn')
    expect(one.detail).toBe('1 thin-wall face')
    const many = prepChecks({ ...base, thinWallFaceCount: 4 }).find((r) => r.id === 'thickness')!
    expect(many.detail).toBe('4 thin-wall faces')
  })
})
```

- [ ] **Step 2-5:** red, implement the `thickness` branch, green, full suite,
  commit:

```bash
git add src/services/prepChecks.ts src/services/prepChecks.test.ts
git commit -m "feat: wire the Thin walls readiness row from thinWallFaceCount"
```

---

## Task 6: exclude the wall-thickness overlay from export

**Files:**
- Modify: `src/services/exporters.ts`
- Test: `src/services/exporters.test.ts` (extend)

- [ ] **Step 1: Write the failing test** - mirror the existing
  `userData.overhangOverlay` exclusion test, for `userData.wallThicknessOverlay`.

- [ ] **Step 2:** run red.

- [ ] **Step 3: Implement** - in `collectExportMeshes`'s `visit`, change
  `if (node.userData.measureOverlay || node.userData.holeOverlay || node.userData.overhangOverlay) return`
  to also `|| node.userData.wallThicknessOverlay`. Update the comment above.

- [ ] **Step 4-5:** green, full suite, commit:

```bash
git add src/services/exporters.ts src/services/exporters.test.ts
git commit -m "feat: exclude the wall-thickness overlay from exported files"
```

---

## Task 7: Viewer3D - live count (size-gated) + overlay lifecycle + interlocks

**Files:**
- Modify: `src/components/Viewer3D.tsx`

No unit test (WebGL-less jsdom). Verification: `tsc --noEmit` clean + full
suite no regression.

**Interfaces:**
- Consumes: `computeWallThicknessMask` + `WALL_THICKNESS_MAX_TRIANGLES` from `../services/wallThickness`; `buildWallThicknessOverlay` / `disposeWallThicknessOverlay` from `../services/wallThicknessOverlay`; store fields from Task 4; existing `withGeometry` / `modelMeshes` / `modelRoots` / `isRepairable` / `invalidate` / `rendererGen` / `repairDialogOpen` / `holeFillMode` / `overhangMode`.
- Produces: `updateGeometryDetails` also sets `thinWallFaceCount`; a `wallThicknessOverlayRef` + `rebuildWallThicknessOverlay` / `teardownWallThicknessOverlay` helpers; an overlay effect; a repair-dialog auto-disarm effect; a threshold-recompute effect; mutual-exclusion effects.

- [ ] **Step 1: imports**

```ts
import { computeWallThicknessMask, WALL_THICKNESS_MAX_TRIANGLES } from '../services/wallThickness'
import { buildWallThicknessOverlay, disposeWallThicknessOverlay } from '../services/wallThicknessOverlay'
```

- [ ] **Step 2: `thinWallFaceCount` in `updateGeometryDetails`**

Right after the `overhangFaceCount` loop (`Viewer3D.tsx:242-251`), add:

```ts
    const minWallMm = useViewerStore.getState().minWallThicknessMm
    const unitForWall = modelUnitInMm ?? 1
    let totalTris = 0
    for (const mesh of meshes) {
      const pa = (mesh.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute
      totalTris += Math.floor(pa.count / 3)
    }
    let thinWallFaceCount: number | null = null
    if (totalTris <= WALL_THICKNESS_MAX_TRIANGLES) {
      thinWallFaceCount = 0
      for (const mesh of meshes) {
        mesh.updateWorldMatrix(true, false)
        const g = mesh.geometry as THREE.BufferGeometry
        const wg = g.index ? g.toNonIndexed() : g.clone()
        wg.applyMatrix4(mesh.matrixWorld)
        thinWallFaceCount += computeWallThicknessMask(wg, minWallMm, unitForWall).thinCount
        wg.dispose()
      }
    }
```

NOTE: `modelUnitInMm` is computed a few lines below the overhang loop in the
current file. Move the `thinWallFaceCount` block to AFTER the `modelUnitInMm`
const is assigned (so `unitForWall` can read it), i.e. just before the
`setGeometryDetails({...})` call. Add `thinWallFaceCount` to that object
alongside `overhangFaceCount`.

- [ ] **Step 3: ref + helpers** near `overhangOverlayRef` / `rebuildOverhangOverlay`:

```ts
  const wallThicknessOverlayRef = useRef<{ group: THREE.Group; hiddenMeshes: THREE.Mesh[] } | null>(null)

  const rebuildWallThicknessOverlay = () => {
    const scene = sceneRef.current
    if (!scene) return
    teardownWallThicknessOverlay()
    const meshes = withGeometry(modelMeshes())
    const minWallMm = useViewerStore.getState().minWallThicknessMm
    const unit = useViewerStore.getState().geometryDetails?.modelUnitInMm ?? 1
    const { group, hiddenMeshes, meshCount, skippedMeshes, unsampledFaces } =
      buildWallThicknessOverlay(meshes, minWallMm, unit, isRepairable)
    scene.add(group)
    wallThicknessOverlayRef.current = { group, hiddenMeshes }
    useViewerStore.getState().setWallThicknessOverlayStatus({ meshCount, skippedMeshes, unsampledFaces })
    invalidate()
  }

  const teardownWallThicknessOverlay = () => {
    const cur = wallThicknessOverlayRef.current
    if (cur) {
      disposeWallThicknessOverlay(cur.group)
      for (const m of cur.hiddenMeshes) m.visible = true
    }
    wallThicknessOverlayRef.current = null
    useViewerStore.getState().setWallThicknessOverlayStatus(null)
    invalidate()
  }
```

- [ ] **Step 4: effects** - immediately after the existing Effect 12 / 13 /
  14 block for overhang (`Viewer3D.tsx:1899-1943`):

```ts
  // Effect 10h..10k: three-way mutual exclusion. Only one of the overhang
  // heatmap, the wall-thickness heatmap, and hole-fill may be armed at once -
  // each hides the model's originals and/or attaches a canvas listener, so
  // two armed at once produce a stale overlay or a hidden-geometry edit. Each
  // effect keys only on the flag turning on, mirroring Effect 10d/10e.
  const wallThicknessMode = useViewerStore((s) => s.wallThicknessMode)
  const minWallThicknessMm = useViewerStore((s) => s.minWallThicknessMm)
  useEffect(() => {
    if (wallThicknessMode) {
      useViewerStore.getState().setOverhangMode(false)
      useViewerStore.getState().setHoleFillMode(false)
    }
  }, [wallThicknessMode])
  useEffect(() => {
    if (overhangMode) useViewerStore.getState().setWallThicknessMode(false)
  }, [overhangMode])
  useEffect(() => {
    if (holeFillMode) useViewerStore.getState().setWallThicknessMode(false)
  }, [holeFillMode])

  // Effect 15: Wall-thickness heatmap - build/rebuild while armed. No pointer
  // wiring (read-only view).
  useEffect(() => {
    if (!wallThicknessMode) return
    const scene = sceneRef.current
    if (!scene) return
    rebuildWallThicknessOverlay()
    return () => {
      teardownWallThicknessOverlay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallThicknessMode, minWallThicknessMm, rendererGen])

  // Effect 16: Auto-disarm the wall-thickness heatmap when the Repair dialog opens.
  useEffect(() => {
    if (repairDialogOpen && wallThicknessMode) useViewerStore.getState().setWallThicknessMode(false)
  }, [repairDialogOpen, wallThicknessMode])

  // Effect 17: Recompute the live thin-wall count when the minimum changes.
  useEffect(() => {
    updateGeometryDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minWallThicknessMm])
```

The existing overhang Effect 10f/10g (`if (overhangMode) setHoleFillMode(false)` / `if (holeFillMode) setOverhangMode(false)`) stays as-is; the new `if (overhangMode) setWallThicknessMode(false)` and `if (holeFillMode) setWallThicknessMode(false)` are additive. Verify no `overhangMode` / `holeFillMode` selector is redeclared (both already exist above).

- [ ] **Step 5:** `pnpm exec tsc --noEmit && pnpm test` - clean, no regression.

- [ ] **Step 6: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D - live thin-wall count (size-gated) and heatmap overlay lifecycle"
```

---

## Task 8: `AnalysisSection` grows the wall-thickness tool

**Files:**
- Modify: `src/components/prepare/AnalysisSection.tsx`
- Test: `src/components/prepare/AnalysisSection.test.tsx` (extend)

**Interfaces:**
- Consumes: store `wallThicknessMode`, `minWallThicknessMm`, `wallThicknessOverlayStatus`, `setWallThicknessMode`, `setMinWallThicknessMm`, plus `geometryDetails.thinWallFaceCount`.
- Produces: below the existing overhang controls, a "Min wall (mm)" input (local string state, commits to `setMinWallThicknessMm(n)` only when `Number.isFinite(n) && n > 0`), a "Show wall thickness heatmap" / "Hide wall thickness heatmap" toggle (`aria-pressed`), disabled when `!hasModel` OR `thinWallFaceCount === null` (with a note "Model too large for wall-thickness analysis"), and a note "N face(s) could not be sampled (open surface)" when `wallThicknessMode && wallThicknessOverlayStatus?.unsampledFaces > 0`.

- [ ] **Step 1: Write the failing test** (append to `AnalysisSection.test.tsx`; the `details` fixture there now needs `thinWallFaceCount: 0` too - Task 4's ripple covers the existing literal, add the field to any new one you write)

```ts
describe('AnalysisSection - wall thickness', () => {
  const details = {
    width: 10, height: 10, depth: 10, vertices: 1, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: 1, overhangFaceCount: 0, thinWallFaceCount: 0,
  }

  beforeEach(() =>
    useViewerStore.setState({
      geometryDetails: details, wallThicknessMode: false, minWallThicknessMm: 1.0,
      wallThicknessOverlayStatus: null,
    }),
  )

  it('toggles wall thickness mode', async () => {
    render(<AnalysisSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Show wall thickness heatmap' }))
    expect(useViewerStore.getState().wallThicknessMode).toBe(true)
  })

  it('commits a valid min-wall value and rejects <= 0', async () => {
    render(<AnalysisSection />)
    const input = screen.getByLabelText('Min wall')
    await userEvent.clear(input)
    await userEvent.type(input, '0.6')
    expect(useViewerStore.getState().minWallThicknessMm).toBe(0.6)
    await userEvent.clear(input)
    await userEvent.type(input, '-1')
    expect(useViewerStore.getState().minWallThicknessMm).toBe(0.6)
  })

  it('disables the toggle and shows a note when the model is too large', () => {
    useViewerStore.setState({ geometryDetails: { ...details, thinWallFaceCount: null } })
    render(<AnalysisSection />)
    expect((screen.getByRole('button', { name: 'Show wall thickness heatmap' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Model too large for wall-thickness analysis')).toBeTruthy()
  })

  it('shows the unsampled-faces note', () => {
    useViewerStore.setState({
      wallThicknessMode: true,
      wallThicknessOverlayStatus: { meshCount: 1, skippedMeshes: 0, unsampledFaces: 7 },
    })
    render(<AnalysisSection />)
    expect(screen.getByText('7 faces could not be sampled (open surface)')).toBeTruthy()
  })
})
```

- [ ] **Step 2: run red.**

- [ ] **Step 3: Implement** - add to `AnalysisSection.tsx`, after the overhang
  block, mirroring its structure. The min-wall input uses the same
  local-string-state pattern as the overhang-angle input (a `useState`
  initialised from `minWallThicknessMm`, committing on valid parse). The
  toggle mirrors the overhang toggle. Compute
  `const tooLarge = useViewerStore((s) => s.geometryDetails?.thinWallFaceCount) === null && hasModel`
  (or read `geometryDetails` you already have) and use it for the disabled
  state + the note. Keep the section's outer `<h3>Analysis</h3>` and the
  overall `!hasModel` gating; update the intro `<p>` text to mention both
  tools ("Highlight downward-facing overhangs and thin walls.").

- [ ] **Step 4: run green, full suite.**

- [ ] **Step 5: Commit**

```bash
git add src/components/prepare/AnalysisSection.tsx src/components/prepare/AnalysisSection.test.tsx
git commit -m "feat: AnalysisSection - wall thickness heatmap toggle, minimum, notes"
```

---

## Task 9: HELP_SECTIONS entry

**Files:**
- Modify: `src/components/HelpModal.tsx`
- Test: `src/components/HelpModal.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** - add to the "renders the guide"
  test (or a new one): `expect(screen.getByRole('heading', { name: 'Wall thickness heatmap' })).toBeTruthy()`.

- [ ] **Step 2: run red.**

- [ ] **Step 3: Implement** - append to `HELP_SECTIONS`, after "Overhang heatmap":

```ts
  {
    title: 'Wall thickness heatmap',
    body: 'Highlights faces whose wall is thinner than the minimum you set (default 1.0 mm), measured by casting a ray straight into the solid from each face. The Thin walls readiness row uses the same minimum. Very large models are skipped for speed.',
  },
```

- [ ] **Step 4: run green, full suite.**

- [ ] **Step 5: Commit**

```bash
git add src/components/HelpModal.tsx src/components/HelpModal.test.tsx
git commit -m "docs: HelpModal - Wall thickness heatmap feature-guide entry"
```

---

## Task 10: end-to-end spec (hard completion gate)

**Files:**
- Create: `e2e/wall-thickness-heatmap.spec.ts`

Mirror `e2e/overhang-heatmap.spec.ts` (read it): inline STL + `DragEvent('drop')`,
`.filter({ visible: true })` on every panel/tab/toolbar locator,
`test.skip(isMobile, ...)`, `test.setTimeout(120_000)`,
`page.addInitScript` overriding `showSaveFilePicker`, the File-menu export
flow, `check(id)` = `getByTestId('check-<id>').filter({ visible: true })`.

**Fixture:** a thin slab STL - two parallel triangle layers 0.5 units (=
0.5 mm, assumed) apart, so at the default 1.0 mm minimum both faces are thin
(`thinWallFaceCount = 2`, `thickness` row `warn`, "2 thin-wall faces"), and
at a 0.2 mm minimum neither is (`0`, `pass`). Exact vertices (mirroring the
unit-test fixture):

```
top:    (0,0,0) (1,0,1) (1,0,0)       // normal +Y
bottom: (0,-0.5,0) (1,-0.5,0) (1,-0.5,1)  // normal -Y
```

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test'

function slabStl(): string {
  const tris = [
    [[0, 0, 0], [1, 0, 1], [1, 0, 0]],
    [[0, -0.5, 0], [1, -0.5, 0], [1, -0.5, 1]],
  ]
  let out = 'solid slab\n'
  for (const tri of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const v of tri) out += `vertex ${v[0]} ${v[1]} ${v[2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid slab\n'
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

test.describe('Wall thickness heatmap', () => {
  test('flags the slab at the default minimum, clears below it, toggles, and exports', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Wall thickness flow verified on desktop')
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })

    await dropStl(page, slabStl(), 'slab.stl')
    await page.getByRole('button', { name: 'Prepare' }).filter({ visible: true }).click()

    const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

    await expect(check('thickness')).toHaveAttribute('data-state', 'warn')
    await expect(check('thickness')).toContainText('2 thin-wall faces')

    const minInput = page.getByLabel('Min wall').filter({ visible: true })
    await minInput.fill('0.2')
    await expect(check('thickness')).toHaveAttribute('data-state', 'pass')
    await expect(check('thickness')).toContainText('0 thin-wall faces')

    await minInput.fill('1')
    await expect(check('thickness')).toHaveAttribute('data-state', 'warn')

    const toggle = page.getByRole('button', { name: /wall thickness heatmap/i }).filter({ visible: true })
    await toggle.click()
    await expect(page.getByRole('button', { name: 'Hide wall thickness heatmap' }).filter({ visible: true })).toBeVisible()

    // Arming the overhang heatmap disarms this one (three-way interlock).
    await page.getByRole('button', { name: 'Show overhang heatmap' }).filter({ visible: true }).click()
    await expect(page.getByRole('button', { name: 'Show wall thickness heatmap' }).filter({ visible: true })).toBeVisible()

    // Re-arm and export.
    await page.getByRole('button', { name: 'Show wall thickness heatmap' }).filter({ visible: true }).click()
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export model as…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export model' })
    await expect(dialog).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('slab.stl')
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/wall-thickness-heatmap.spec.ts`. Adjust
selectors to the real DOM if the "Min wall" label, toggle name, or readiness
row shape differ from this guess (the source of truth is
`e2e/overhang-heatmap.spec.ts` + `AnalysisSection.tsx` + `ReadinessCard.tsx`).
Run twice for stability. No retries / arbitrary waits. If a genuine product
bug surfaces (e.g. the BVH analysis throws in the browser), STOP and report
BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add e2e/wall-thickness-heatmap.spec.ts
git commit -m "test: e2e thin-wall readiness row, minimum change, toggle, interlock, export"
```

---

## Task 11: docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README** - add a short "Wall thickness heatmap" entry near
  the Overhang heatmap one, matching the file's bullet style. No em dash.

- [ ] **Step 2: CHANGELOG** - under the current/next version heading:

```
- Prepare panel: wall thickness heatmap (SP-4b). Colours faces thinner
  than a configurable minimum (default 1.0 mm) using an inward ray per
  face; the Thin walls readiness row is now live. Large models are
  skipped for speed.
```

- [ ] **Step 3: roadmap** - extend the "SP-4 decomposition" section:
  SP-4b SHIPPED, branch `worktree-sp4b-wall-thickness-heatmap`, commit range
  (from `git log`), files (`wallThickness.ts`, `wallThicknessOverlay.ts`,
  `three-mesh-bvh` dep, `GeometryDetails.thinWallFaceCount`, `prepChecks`
  thickness row, `exporters.ts` tag, `Viewer3D.tsx` effects, `AnalysisSection`
  second tool, `HelpModal` entry), spec/plan links. SP-4c (X-ray/clipping)
  is the remaining not-started cycle.

- [ ] **Step 4: Sanity** - `pnpm exec tsc --noEmit && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-4b wall thickness heatmap"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| `three-mesh-bvh` dependency | 1 |
| Inward-ray-per-face thickness classifier + size cap const | 2 |
| Overlay (world-bake, colour, skip-hidden, hide-after-loop, tag, unsampled) | 3 |
| `GeometryDetails.thinWallFaceCount` (nullable) + store fields + ripple | 4 |
| `thickness` readiness row (null/pass/warn) | 5 |
| Export exclusion tag | 6 |
| Viewer3D: size-gated count, overlay lifecycle, repair auto-disarm, threshold recompute, three-way interlock | 7 |
| `AnalysisSection` second tool (input, toggle, too-large note, unsampled note) | 8 |
| `HELP_SECTIONS` entry (roadmap standing rule) | 9 |
| E2e hard gate (incl. the interlock) | 10 |
| Docs + SP-4 table | 11 |

Non-goals (Web Worker, gradient, per-vertex sampling, true SDF, shared
overlay-copy helper, persisted minimum) have no task, as intended.

**2. Placeholder scan:** No "TBD" / "handle later". Task 2/3/8/10 give full
code or a concrete "mirror file X with these deltas" plus the exact fixture
vertices. Task 4's ripple names the exact files and the grep locator.

**3. Type consistency:** `computeWallThicknessMask(geometry, minWallMm, unitInMm)`
returns `{ mask, thinCount, unsampledCount }` - Tasks 2, 3, 7 use it
identically. `buildWallThicknessOverlay(meshes, minWallMm, unitInMm, isEligible, highlightColor?)`
returns `{ group, hiddenMeshes, meshCount, skippedMeshes, unsampledFaces }` -
Tasks 3, 7. `thinWallFaceCount: number | null` - Tasks 4, 5, 7, 8. Store
names (`wallThicknessMode`, `minWallThicknessMm`, `wallThicknessOverlayStatus`,
the three setters, `WALL_THICKNESS_MAX_TRIANGLES`) consistent across Tasks 4,
7, 8. `userData.wallThicknessOverlay` tag - Tasks 3, 6, 7.
