# SP-4a: Overhang heatmap

Status: approved design, 2026-09-05. Part of the print-prep roadmap
(`2026-08-30-print-prep-roadmap.md`). First cycle of SP-4 (analysis
heatmaps). Builds on SP-3 (mm scale, closed) and SP-1 (Prepare panel /
readiness card `overhangs` row, currently a disabled placeholder).

SP-4 (catalogue refs 2 wall-thickness, 3 overhangs, X-ray/clipping) is split
into three cycles, mirroring SP-2/SP-3's decomposition, each its own spec +
plan + release:

- **SP-4a (this spec):** overhang / printability heatmap. No new dependency
  ("cheap: per-face normal dot" per the catalogue).
- **SP-4b (later):** wall-thickness analysis + heatmap. Needs
  `three-mesh-bvh` for interior raycasting/SDF sampling.
- **SP-4c (later):** X-ray / clipping plane, a viewing aid independent of
  either heatmap.

## Purpose

Colour faces that would need print supports (steeply downward-facing past a
threshold angle) directly in the viewport, and turn the SP-1 readiness
card's disabled "Overhangs" row into a live check.

## Current state (relevant slice)

- `src/services/prepChecks.ts`: `ANALYSIS_ROWS` includes `{ id: 'overhangs',
  label: 'Overhangs' }`, always rendered `state: 'unavailable'` today. The
  `onPlate` row (SP-3a) is the direct precedent for turning one of these rows
  live: it reads a value off `GeometryDetails` and switches state
  accordingly.
- `Viewer3D.tsx` `updateGeometryDetails()` is the single place per-model
  derived stats are computed (triangles, vertices, boundary edges,
  non-manifold edges, ...) and written onto `GeometryDetails`, read by
  `prepChecks`. It runs on every load and after every edit.
- Scene up-axis is world **Y**. SP-3b's `dropToFloor` established that the
  model sits with its bounding box's `min.y` at the plate; layers print
  bottom-to-top along `+Y`, so "straight down" (toward the plate, the
  direction that most needs support underneath) is world `(0, -1, 0)`.
- `.stl` and `.ply` loaders (`src/loaders/index.ts:159,165`) already produce
  **non-indexed** `BufferGeometry` (three.js's `STLLoader`/`PLYLoader` emit
  one unshared vertex triple per triangle) with `MeshStandardMaterial({
  side: THREE.DoubleSide })`. `.obj` / `.3mf` / `.gltf` / `.glb` / `.dae` may
  be indexed and may use other materials.
- SP-2c's `holeFillOverlay.ts` and SP-3a's `measureOverlay.ts` are the
  established overlay pattern: a pure-ish Three service builds/disposes a
  scene-level `THREE.Group` tagged `userData.<name>Overlay = true`; `Viewer3D`
  owns a `<name>Mode` `useEffect` that builds the group on arm, tears it down
  on disarm/cleanup; `src/services/exporters.ts` `collectExportMeshes`
  already skips any subtree tagged `userData.measureOverlay` /
  `userData.holeOverlay` (added in SP-3a's final-review fix wave) — the same
  mechanism extends directly to a new overlay tag.

## Decisions (locked 2026-09-05)

### Overhang definition

For a triangle with unit face normal `n` (computed directly from the
triangle's three positions via a cross product, independent of any stored
vertex-normal attribute — robust to smoothed normals that would otherwise
hide a sharp overhang edge), define:

```
angleFromStraightDownDeg = degrees(acos(clamp(-n.y, -1, 1)))
isOverhang = angleFromStraightDownDeg < overhangThresholdDeg
```

`angleFromStraightDownDeg` is `0` when the face points exactly straight down
(the worst case, a flat ceiling with nothing below it) and `90` at a
vertical wall or anything not facing generally downward. Default
`overhangThresholdDeg = 45` (matches the catalogue: "default 45 deg from
vertical"). This is a print-prep visual aid, not a slicer-grade overhang
model — documented plainly rather than chasing exact parity with any one
slicer's internal convention.

### Analysis is pure and dependency-free

`src/services/overhangAnalysis.ts` exports
`computeOverhangFaceMask(positions: Float32Array, thresholdDeg: number):
{ mask: Uint8Array; count: number }` operating on a flat, non-indexed
position array (length a multiple of 9: one `[x,y,z]` triple per vertex,
three vertices per face). No `THREE` import — plain arithmetic (matches
`unitConversion.ts`/`scaleMath.ts`'s dependency-free style from SP-3a,
keeping this layer trivially unit-testable and reusable from both the
readiness-row computation and the overlay builder without duplicating the
maths).

### Readiness row: `GeometryDetails` gains `overhangFaceCount`

Add `overhangFaceCount: number` to `GeometryDetails` (alongside the existing
scalar stats), computed inside `updateGeometryDetails()` for every mesh with
geometry, using the current `overhangThresholdDeg` from the store, and
summed across meshes. Required, not optional, matching how `modelUnitInMm`
was added in SP-3a: ten existing test files construct `GeometryDetails`
object literals directly (`prepChecks.test.ts`, `UnitPrompt.test.tsx`,
`Sidebar.test.tsx`, `TransformSection.test.tsx`, `viewerStore.test.ts`,
`DimensionsReadout.test.tsx`, `ScaleSection.test.tsx`,
`MeasureSection.test.tsx`, `PreparePanel.test.tsx`, `loaders/index.test.ts`)
and each needs one line (`overhangFaceCount: 0`) added to stay green under
`tsc`. This is mechanical and cheap; the implementation plan gives it its
own task rather than scattering it across whichever task happens to touch
`prepChecks` first. `prepChecks`'s `overhangs` row becomes real: `state:
'warn'` (not `'fail'` — an overhang is informational, printable with
supports, not a defect) when `count > 0`, `'pass'` when `count === 0`, detail
text `"N overhang face(s)"`. No `fixId` — there is no automated fix, matching
SP-1's carry-forward guidance to guard the Fix affordance with a registered
handler (none registered for `overhangs`).

Changing `overhangThresholdDeg` (see below) must re-run
`updateGeometryDetails()` so the row and any live overlay both reflect the
new threshold — a small `useEffect` in `Viewer3D` keyed on the store's
`overhangThresholdDeg` value, calling `updateGeometryDetails()` (which
no-ops internally when there are no roots, same guard every other update
path already has).

### Overlay: hide-and-replace, world-space baked, tagged for export exclusion

A new **Analysis** section in the Prepare panel (`AnalysisSection.tsx`) has
an "Overhang heatmap" toggle and a threshold number input (degrees, default
45). Arming it:

1. For each eligible mesh (`isRepairable` from SP-2c — single draw group,
   non-array material, no `uv`/`color` attribute; textured/multi-material
   meshes are skipped, matching the Repair pipeline's existing eligibility
   gate, and reported via the same "N mesh(es) not eligible" note style
   `RepairSection` already uses for hole-fill), build a **new, separate**
   `THREE.Mesh` whose geometry is the original's positions converted to
   non-indexed (`geometry.index ? geometry.toNonIndexed() : geometry.clone()`)
   and baked to **world space** via `applyMatrix4(mesh.matrixWorld)` (the
   same "bake once, add at identity" idiom `collectExportMeshes` and
   `holeFillOverlay` already use — sidesteps ever reparenting the overlay
   under a transformed ancestor). Recompute per-face normals from the world
   positions (`computeOverhangFaceMask` needs face-accurate normals in the
   same space the classification decision is made in) and set a `color`
   `BufferAttribute`: each face's three vertices get the same colour, either
   the model's own base colour (read from the original mesh's
   `MeshStandardMaterial.color` when present, else the STL/PLY default
   `0xb0b0b0`) or a fixed highlight `0xff3b30` when that face is flagged.
   Material: `MeshStandardMaterial({ vertexColors: true, roughness: 0.45,
   metalness: 0.1, side: THREE.DoubleSide })` — a fresh material per overlay
   mesh (disposed on teardown), not shared, so per-model base colour differs
   correctly.
2. Hide the original mesh (`mesh.visible = false`) and add the overlay mesh
   to one scene-level `THREE.Group` tagged `userData.overhangOverlay = true`.
3. `src/services/exporters.ts` `collectExportMeshes` gains one more tag to
   its existing overlay-skip check (`measureOverlay` / `holeOverlay` /
   `overhangOverlay`), so the overlay never leaks into an exported file even
   if a user exports while the heatmap is armed.
4. Disarming (toggle off, or the guards below) restores `mesh.visible = true`
   on every hidden original and disposes the overlay group (geometries,
   materials, remove from scene) — mirrors `teardownHoleOverlays`.

Changing the threshold while armed rebuilds the overlay in place (same
teardown + rebuild the section already needs for the toggle itself — no new
mechanism).

### Guards: read-only, no undo-stack lock, but disarm on repair and on model change

Unlike Measure/Scale/Transform, the overhang overlay never mutates model
geometry or the undo stack — it hides/shows and colours a display copy.
`AnalysisSection` is therefore disabled only when `!geometryDetails` (no
model), not on `splitParts.length > 0` or `measureMode` — a user can freely
inspect overhangs while measuring or after a split.

It **does** auto-disarm (mirroring the existing `repairDialogOpen`
auto-disarm effects for hole-fill and measure) when:

- `repairDialogOpen` turns true — a repair can rewrite the very geometry the
  overlay is a frozen copy of.
- The model unloads (`setFile` / `setFileFromBuffer`) — same reset point
  `measureMode` already uses.

**Known, accepted limitation (documented, not fixed this cycle):** running
Move / Rotate / Scale / Mirror / Drop-to-floor / Center-on-plate / Split by
shell while the overhang overlay is armed leaves a stale overlay (the
original mesh's `matrixWorld` or geometry changed after the overlay's
world-space bake). This is display-only staleness — it does not corrupt the
undo stack, export, or the readiness row (which recomputes from the live
mesh, not the overlay). It is the same class of limitation SP-3a/SP-3b's
final reviews already accepted for the hole-fill overlay under those same
transform actions (documented there as a roadmap carry-forward); toggling
the heatmap off and back on refreshes it. A full N-way interlock across
every edit action and every overlay mode is out of scope for one cycle.

## Architecture

### New files

| File | Responsibility |
|------|----------------|
| `src/services/overhangAnalysis.ts` | Pure. `computeOverhangFaceMask(positions, thresholdDeg)`. No Three. |
| `src/services/overhangOverlay.ts` | Three. `buildOverhangOverlay(meshes, thresholdDeg, isEligible)`, `disposeOverhangOverlay(group)`. Mirrors `holeFillOverlay.ts` shape. |
| `src/components/prepare/AnalysisSection.tsx` | Overhang heatmap toggle + threshold input. Locked only on `!geometryDetails`. |

### Modified files

| File | Change |
|------|--------|
| `src/store/viewerStore.ts` | `GeometryDetails.overhangFaceCount: number`. New: `overhangMode: boolean` (default false), `overhangThresholdDeg: number` (default 45), `setOverhangMode`, `setOverhangThresholdDeg`. Reset `overhangMode: false` in `setFile`/`setFileFromBuffer` (same spot `measureMode` resets). |
| `src/components/Viewer3D.tsx` | `updateGeometryDetails()` computes `overhangFaceCount` via `computeOverhangFaceMask` per mesh, summed. New `overhangMode` effect (build/rebuild/dispose overlay group, hide/show original meshes) mirroring the hole-fill effect. New small effect: recompute `updateGeometryDetails()` when `overhangThresholdDeg` changes. Auto-disarm effect for `repairDialogOpen`. |
| `src/services/prepChecks.ts` | `overhangs` row reads `details.overhangFaceCount`: `pass` (0) / `warn` (>0), no `fixId`. |
| `src/services/exporters.ts` | `collectExportMeshes`'s overlay-skip check also matches `userData.overhangOverlay`. |
| `src/components/prepare/PreparePanel.tsx` | Mount `<AnalysisSection viewerRef={viewerRef} />` after `<TransformSection>`. |

### Data flow

```
Model loads / edited -> updateGeometryDetails()
  -> for each mesh with geometry: computeOverhangFaceMask(positions, overhangThresholdDeg)
  -> overhangFaceCount = sum of counts -> GeometryDetails.overhangFaceCount
  -> prepChecks' overhangs row: pass/warn from that count

AnalysisSection: toggle Overhang heatmap on
  -> store.setOverhangMode(true)
  -> Viewer3D effect: buildOverhangOverlay(eligible meshes, overhangThresholdDeg)
       for each: toNonIndexed/clone, bake to world space, compute per-face
       mask, build color attribute, new Mesh -> overlay group; hide original
  -> scene shows the recoloured copy

AnalysisSection: threshold input change (while armed)
  -> setOverhangThresholdDeg(value)
  -> Viewer3D effect (keyed on overhangThresholdDeg): updateGeometryDetails()
     (row refreshes) AND, since overhangMode is still true, tear down +
     rebuild the overlay with the new threshold

AnalysisSection: toggle off / repairDialogOpen becomes true / model unload
  -> disposeOverhangOverlay(group); every hidden mesh.visible = true
```

### Error handling

- No model / no eligible meshes: `AnalysisSection` shows a note ("N mesh(es)
  not eligible" style, matching `RepairSection`) and the toggle stays
  disabled when there is nothing eligible at all.
- WebGL-less environment: same as every other Viewer3D-backed section — the
  effect early-returns when `sceneRef`/`rendererRef` are absent; the section
  shows the established "3D view unavailable" note.
- Degenerate (zero-area) triangles: a cross product of two zero/near-zero
  edge vectors yields a near-zero-length normal; `computeOverhangFaceMask`
  guards divide-by-zero by treating a normal that fails to normalise
  (length below a small epsilon) as `isOverhang = false` for that face
  (excluded from both the count and the highlight — a degenerate face has no
  meaningful orientation to flag).

## Testing

Matches the established setup. A passing
`e2e/overhang-heatmap.spec.ts` is the hard completion gate.

- Unit: `overhangAnalysis.test.ts` — a flat horizontal downward-facing
  triangle (normal `(0,-1,0)`) flags at any threshold `> 0`; a vertical wall
  triangle (normal `(1,0,0)`) never flags; a triangle just inside/outside the
  default 45° threshold (hand-computed angle) flags correctly on each side;
  a degenerate (zero-area) triangle does not flag and does not throw;
  multi-face input sums count correctly.
- `overhangOverlay.test.ts` — mirrors `holeFillOverlay.test.ts`'s shape:
  build produces one overlay mesh per eligible input mesh with a `color`
  attribute sized to its vertex count, ineligible meshes are skipped and
  counted, dispose frees geometries/materials and empties the group.
- `prepChecks.test.ts` — `overhangs` row `pass` at count 0, `warn` (not
  `fail`) at count > 0, no `fixId`.
- `exporters.test.ts` — a mesh inside a group tagged
  `userData.overhangOverlay = true` is excluded from `collectExportMeshes`,
  mirroring the existing `measureOverlay`/`holeOverlay` exclusion tests.
- Component: `AnalysisSection.test.tsx` — disabled without a model, toggle
  calls `setOverhangMode`, threshold input calls `setOverhangThresholdDeg`,
  ineligible-mesh note renders. No jest-dom (this repo has none — use
  vitest/RTL-core assertions from the start, matching every SP-3
  component test).
- `Viewer3D.tsx`'s new overlay-build/hide-show effect: **no unit test**,
  same accepted reasoning as every prior Viewer3D handle/effect addition
  (WebGL-less jsdom) — verified by the e2e instead.
- E2e: load a model with at least one steeply downward-facing face (a
  simple wedge/ramp shape, generated inline like the other e2e fixtures),
  confirm the `overhangs` readiness row starts at `warn` with the expected
  count, toggle the heatmap on and off without error, change the threshold
  and confirm the row's count changes accordingly, confirm export still
  succeeds while the heatmap is armed (proves the overlay-exclusion tag
  works end to end, mirroring how SP-3a's final fix wave closed the
  equivalent gap for measure/hole-fill).

## Non-goals / carry-forward

- **Continuous colour gradient by severity**: binary highlight/base-colour
  only this cycle, matching the catalogue's "cheap: per-face normal dot"
  framing. A gradient is a pure styling change on top of the same mask if
  wanted later.
- **Full interlock with every edit action** (Move/Rotate/Scale/Mirror/Drop/
  Center/Split): only the repair-dialog and model-unload disarms are wired;
  the rest is documented staleness, matching the hole-fill overlay's existing
  accepted limitation.
- **Persisted threshold**: `overhangThresholdDeg` resets to 45 on reload,
  same as SP-3a's `buildVolumeMm` in-memory-only stance (a settings
  integration is a later concern).
- **SP-4b (wall-thickness heatmap)** and **SP-4c (X-ray/clipping)**: separate
  cycles, not started.
