# SP-4b: Wall-thickness heatmap

Status: approved design, 2026-09-06. Second cycle of SP-4 (analysis
heatmaps). Builds on SP-4a (overhang heatmap - the overlay pattern, the
readiness-row wiring, the `AnalysisSection` component, the export-exclusion
tag mechanism) and SP-3a (mm scale). Runs after SP-H (in-app help), so this
cycle's plan includes appending a wall-thickness entry to the feature
guide.

## Purpose

Colour faces whose local wall is thinner than a configurable minimum
(default 1.0 mm) so a user can see where a print would be fragile or fail
to slice, and turn the SP-1 readiness card's disabled "Thin walls" row into
a live check. This is catalogue item 2, the one SP-4 feature that needs
`three-mesh-bvh` ("cheap per-face normal dot" did overhangs in SP-4a;
thickness needs interior raycasting).

## Current state (relevant slice, established in SP-4a)

- `src/services/overhangOverlay.ts` is the direct template: `buildOverhangOverlay(meshes, thresholdDeg, isEligible, highlightColor?)` -> world-space-baked non-indexed copy per eligible mesh, per-vertex `color` attribute (base colour vs `0xff3b30` highlight per face), fresh `MeshStandardMaterial({ vertexColors: true, ... })`, original `mesh.visible = false` (only for meshes it actually hid, only after the build loop succeeds - the SP-4a final-review fixes), group tagged `userData.overhangOverlay = true`; `disposeOverhangOverlay(group)` frees geometry+material, detaches, does NOT restore visibility.
- `src/services/overhangAnalysis.ts` is the pure classifier; `computeOverhangFaceMask(positions, thresholdDeg)` returns `{ mask: Uint8Array; count: number }` from a flat non-indexed position array.
- `Viewer3D.updateGeometryDetails()` computes `overhangFaceCount` from world-space-baked positions per mesh, summed, and writes it onto `GeometryDetails`. `prepChecks` reads `details.overhangFaceCount`: `pass` at 0, `warn` (not `fail`) at >0, no `fixId`. Ten test files construct `GeometryDetails` literals and all carry `overhangFaceCount: 0` now.
- `Viewer3D` Effect 12 builds/rebuilds/tears down the overhang overlay keyed `[overhangMode, overhangThresholdDeg, rendererGen]`; Effect 13 auto-disarms it on `repairDialogOpen`; Effect 14 recomputes `updateGeometryDetails()` on `overhangThresholdDeg` change; Effects "10f/10g" mutually disarm `overhangMode` and `holeFillMode`. Store resets `overhangMode: false` and `overhangOverlayStatus: null` on `setFile`/`setFileFromBuffer`.
- `src/components/prepare/AnalysisSection.tsx` (no props, store-driven): the overhang toggle + a local-string-state threshold input. Locked only on `!geometryDetails`.
- `exporters.ts` `collectExportMeshes` skips `userData.measureOverlay || userData.holeOverlay || userData.overhangOverlay`.
- `modelUnitInMm` (SP-3a): mm per one raw geometry unit, `null` for unitless formats. SP-4a's convention when `null` is "assume 1".
- Scene up-axis is world Y; `GeometryDetails` already carries `width/height/depth` and triangle counts.

## Decisions (locked 2026-09-06)

### Dependency: `three-mesh-bvh`

Add `three-mesh-bvh` (the roadmap's locked-decision dependency for
"raycast-based analysis"), pinned to an exact version in `dependencies`,
matching this repo's exact-pin convention for `three` (`0.185.1`) and
`@types/three` (`0.185.0`). It is compatible with three 0.185. Used only in
the new analysis code; no global `THREE.Mesh.prototype.raycast`
monkey-patch (the service constructs `MeshBVH` directly and calls
`bvh.raycastFirst` itself).

### Algorithm: one inward ray per face, main thread, size-gated

For each triangle of a **world-space-baked, non-indexed** geometry:

1. Face normal `n` from the cross product of its two edges (outward,
   computed directly - do not trust a stored normal attribute), normalised.
2. Face centroid `c` (mean of the three vertices).
3. Cast a ray with origin `c - n * eps` (just inside the surface, `eps` a
   tiny fraction of the geometry's bounding-sphere radius, e.g.
   `radius * 1e-4` clamped to a small absolute floor) and direction `-n`,
   using `bvh.raycastFirst(ray, THREE.DoubleSide)` so the far wall is hit
   from either side and internal walls count.
4. If there is a hit, `thicknessWorld = hit.distance` (world units, since
   the BVH is on world-baked geometry). `thicknessMm = thicknessWorld *
   (modelUnitInMm ?? 1)`. The face is **thin** when `thicknessMm <
   minWallMm`.
5. If there is no hit (open surface, ray escapes), the face is
   **unsampled**: not flagged thin, not counted, but tallied so the UI can
   report partial coverage.

Per-face (not per-vertex) sampling matches SP-4a's overhang model and keeps
the ray budget at one per triangle. The BVH build is `O(n log n)`; one
`raycastFirst` per face is `O(n log n)` total - fast for typical print
models but not free on huge meshes, so:

- **`WALL_THICKNESS_MAX_TRIANGLES = 250_000`.** When the summed triangle
  count across the analysed meshes exceeds this, the analysis is skipped
  entirely: `thinWallFaceCount` is `null`, the readiness row reads
  `unavailable` with a "model too large" detail, and the overlay toggle is
  disabled with a note. A Web Worker is the eventual fix for large meshes
  (carry-forward), not this cycle.

### `GeometryDetails.thinWallFaceCount: number | null`

Add `thinWallFaceCount: number | null` (nullable, unlike SP-4a's always-a-
number `overhangFaceCount`, because "too large to analyse" and "no meshes"
are real states). Computed in `Viewer3D.updateGeometryDetails()` alongside
`overhangFaceCount`: build a BVH per world-baked mesh, sample every face,
sum the thin count; `null` when total triangles > the cap. This is the
second `GeometryDetails` field ripple this SP series has needed - the same
ten test files that got `overhangFaceCount: 0` in SP-4a now also need
`thinWallFaceCount: 0` (or `null`) added; the plan does it as one batch
task, same as SP-4a.

`prepChecks`'s `thickness` row (id `thickness`, label "Thin walls",
currently always `unavailable`) goes live:

- `thinWallFaceCount === null` -> `unavailable`, detail "Too large to
  analyse" (or "Open a model" via the existing `!details` branch).
- `=== 0` -> `pass`, detail "0 thin-wall faces".
- `> 0` -> `warn` (not `fail` - a thin wall is a caution, not a repairable
  defect), detail "N thin-wall face(s)", no `fixId`.

### Overlay: mirrors SP-4a exactly, red highlight, own tag

- `src/services/wallThicknessOverlay.ts`: `buildWallThicknessOverlay(meshes, minWallMm, unitInMm, isEligible, highlightColor?)` -> the same structure as `buildOverhangOverlay` (skip `!mesh.visible`, world-bake non-indexed, per-face `color`, hide-after-loop, `hiddenMeshes` only for meshes it hid), group tagged `userData.wallThicknessOverlay = true`, thin faces get `0xff3b30` (same red as overhang - the two heatmaps are never shown at once, and "problem = red" is the consistent language). Returns `{ group, hiddenMeshes, meshCount, skippedMeshes, unsampledFaces }`. `disposeWallThicknessOverlay(group)` identical in spirit to `disposeOverhangOverlay`.
- The per-face classification is a shared pure-ish helper
  `src/services/wallThickness.ts` `computeWallThicknessMask(geometry: THREE.BufferGeometry, minWallMm: number, unitInMm: number): { mask: Uint8Array; thinCount: number; unsampledCount: number }` - builds the `MeshBVH`, casts the rays, returns the mask. Both the overlay builder and `updateGeometryDetails` call it (each on its own world-baked geometry copy, same as SP-4a ran two separate world-bakes). It is Three-touching (needs `MeshBVH`), so it is unit-tested with real small geometries, not mocked.
- `exporters.ts` `collectExportMeshes` skip-check also matches
  `userData.wallThicknessOverlay` (same one-line change + mirrored test as
  SP-4a's `overhangOverlay` addition).

### Store + Viewer3D wiring: parallel to the overhang path

- Store: `wallThicknessMode: boolean` (default `false`), `minWallThicknessMm: number` (default `1.0`), `wallThicknessOverlayStatus: { meshCount: number; skippedMeshes: number; unsampledFaces: number } | null` (default `null`). Setters `setWallThicknessMode`, `setMinWallThicknessMm`, `setWallThicknessOverlayStatus`. `setFile`/`setFileFromBuffer` reset `wallThicknessMode: false` and `wallThicknessOverlayStatus: null` (not the threshold - it persists within a session, same stance as `overhangThresholdDeg`).
- `Viewer3D`: `updateGeometryDetails` also computes `thinWallFaceCount`
  (with the size gate). A new overlay effect keyed `[wallThicknessMode,
  minWallThicknessMm, rendererGen]` mirroring Effect 12. An auto-disarm
  effect on `repairDialogOpen`. A recompute effect keyed
  `[minWallThicknessMm]`.
- **Mutual exclusion.** Both heatmaps hide the model's originals, so only
  one may be armed at a time. The interlock web (each effect keyed on the
  single flag that is turning on, mirroring the established Effect 10d/10e
  pattern) becomes: arming any one of `overhangMode`, `wallThicknessMode`,
  `holeFillMode` disarms the other two. That is the three existing
  overhang<->holeFill / overhang<->(nothing yet) effects plus new
  wallThickness<->overhang and wallThickness<->holeFill pairs. Measure is
  NOT interlocked with either heatmap (it raycasts the hidden originals at
  identical world positions and reads correctly - confirmed for overhang in
  SP-4a's final review, and the same reasoning holds here).

### `AnalysisSection` grows a second tool

Add, below the existing overhang controls in `AnalysisSection.tsx`:

- A "Min wall (mm)" input (local string state, same pattern as the overhang
  angle input; commits to `setMinWallThicknessMm(n)` only when
  `Number.isFinite(n) && n > 0`).
- A "Show wall thickness heatmap" / "Hide wall thickness heatmap" toggle
  (`aria-pressed={wallThicknessMode}`), disabled on `!geometryDetails` OR
  when `thinWallFaceCount === null` (too large / nothing to analyse) - in
  the too-large case show a note "Model too large for wall-thickness
  analysis".
- The "N mesh(es) not eligible" note, plus, when
  `wallThicknessOverlayStatus.unsampledFaces > 0`, a second note "N face(s)
  could not be sampled (open surface)".

The section stays locked only on `!geometryDetails` overall (read-only
view).

## Architecture

### New files

| File | Responsibility |
|------|----------------|
| `src/services/wallThickness.ts` | Three + `MeshBVH`. `computeWallThicknessMask(geometry, minWallMm, unitInMm)`. |
| `src/services/wallThicknessOverlay.ts` | Three. `buildWallThicknessOverlay(...)`, `disposeWallThicknessOverlay(group)`. Mirrors `overhangOverlay.ts`. |

### Modified files

| File | Change |
|------|--------|
| `package.json` / lockfile | add `three-mesh-bvh` (exact pin) to `dependencies`. |
| `src/store/viewerStore.ts` | `GeometryDetails.thinWallFaceCount: number \| null`; `wallThicknessMode`, `minWallThicknessMm` (1.0), `wallThicknessOverlayStatus` + setters; `setFile`/`setFileFromBuffer` reset the mode + status; `WALL_THICKNESS_MAX_TRIANGLES` export (or keep it in `wallThickness.ts`). |
| ~10 test files | add `thinWallFaceCount: 0` to every `GeometryDetails` literal (batch task, same list as SP-4a's `overhangFaceCount` ripple). |
| `src/services/prepChecks.ts` | wire the `thickness` row from `details.thinWallFaceCount` (null -> unavailable, 0 -> pass, >0 -> warn). |
| `src/services/prepChecks.test.ts` | cases for the three states. |
| `src/services/exporters.ts` (+ test) | skip `userData.wallThicknessOverlay`. |
| `src/components/Viewer3D.tsx` | `updateGeometryDetails` computes `thinWallFaceCount` (size-gated); overlay effect; repair-dialog auto-disarm; threshold recompute effect; the two new mutual-exclusion effect pairs. |
| `src/components/prepare/AnalysisSection.tsx` (+ test) | the min-wall input, the toggle, the too-large note, the unsampled note. |
| `src/components/HelpModal.tsx` | append a `{ title: 'Wall thickness heatmap', body: ... }` entry to `HELP_SECTIONS`. |
| README / CHANGELOG / roadmap | record SP-4b; extend the SP-4 decomposition table. |

### Data flow

```
Model loads / edited -> updateGeometryDetails()
  -> if total triangles > WALL_THICKNESS_MAX_TRIANGLES: thinWallFaceCount = null
  -> else per mesh: world-bake non-indexed geo, computeWallThicknessMask(geo, minWallThicknessMm, modelUnitInMm ?? 1)
     -> MeshBVH(geo); per face: centroid + outward normal; ray from centroid - n*eps along -n;
        bvh.raycastFirst(ray, DoubleSide); thin if hit && hit.distance * unitInMm < minWallMm; miss -> unsampled
  -> thinWallFaceCount = sum of thin counts -> GeometryDetails
  -> prepChecks' thickness row: unavailable / pass / warn

AnalysisSection: "Show wall thickness heatmap" -> store.setWallThicknessMode(true)
  (interlock effects disarm overhangMode + holeFillMode)
  -> Viewer3D effect: buildWallThicknessOverlay(eligible visible meshes, minWallThicknessMm, modelUnitInMm ?? 1)
       per mesh: world-bake, computeWallThicknessMask, colour thin faces red, hide original after the loop
  -> scene shows the recoloured copy; status note reports skipped + unsampled

min-wall input change -> setMinWallThicknessMm(n)
  -> recompute effect: updateGeometryDetails() (row refreshes)
  -> overlay effect (keyed on minWallThicknessMm) rebuilds if armed

toggle off / repairDialogOpen / model unload / arming another heatmap or hole-fill
  -> effect cleanup: disposeWallThicknessOverlay(group); restore visible on the meshes it hid
```

### Error handling

- Total triangles over the cap: `thinWallFaceCount = null`; row
  `unavailable`; toggle disabled with the too-large note. No BVH is built.
- No eligible meshes: toggle still enabled if a model is open, overlay
  builds nothing, the "N not eligible" note shows.
- Open / non-watertight mesh: rays escape -> those faces are `unsampled`,
  reported in the note; the analysis still returns a count for the faces it
  could sample. Not a hard block (matches SP-4a not blocking on anything).
- `modelUnitInMm === null`: treated as `1` (assume mm), consistent with
  every other mm readout since SP-3a.
- Degenerate face (zero-area, no stable normal): skipped from sampling,
  same as `overhangAnalysis`'s `NORMAL_EPSILON` guard.
- WebGL-less environment: `updateGeometryDetails` still runs (BVH + raycast
  are pure CPU, no renderer needed) - so unlike SP-4a's overlay effect,
  the COUNT path here is actually exercisable in a jsdom unit test if
  desired. The overlay-build effect still needs the scene refs and stays
  e2e-verified only.

## Testing

Matches the established setup. A passing
`e2e/wall-thickness-heatmap.spec.ts` is the hard completion gate.

- Unit `wallThickness.test.ts`: a known thin slab (two parallel triangle
  layers 0.5 units apart, `unitInMm = 1`) flags both faces at `minWallMm =
  1.0` and neither at `minWallMm = 0.2`; a thick block does not flag; an
  open single triangle yields `unsampledCount = 1`, `thinCount = 0`; a
  degenerate triangle is skipped without throwing; the mask length equals
  the face count.
- Unit `wallThicknessOverlay.test.ts`: mirrors `overhangOverlay.test.ts` -
  one overlay mesh per eligible visible mesh, `color` attribute sized to
  the vertex count, thin faces carry the highlight RGB and non-thin carry
  the base RGB (the mask->colour assertion SP-4a's final review demanded),
  `!mesh.visible` inputs skipped, ineligible counted, dispose frees and
  detaches, hide happens after the loop.
- Unit `prepChecks.test.ts`: `thickness` row `unavailable` at `null`,
  `pass` at `0`, `warn` (not `fail`) with no `fixId` at `> 0`; unaffected
  by the `sealApplied` remap.
- Unit `exporters.test.ts`: a `userData.wallThicknessOverlay` group's mesh
  is excluded from `collectExportMeshes`.
- Component `AnalysisSection.test.tsx`: the min-wall input commits a valid
  value and rejects `<= 0`; the wall-thickness toggle flips
  `wallThicknessMode`; the toggle is disabled and the too-large note shows
  when `geometryDetails.thinWallFaceCount === null`; the unsampled note
  shows when the status has `unsampledFaces > 0`.
- Component `HelpModal.test.tsx`: extended to assert the new "Wall
  thickness heatmap" heading renders.
- `Viewer3D.tsx` overlay effect + the `updateGeometryDetails`
  `thinWallFaceCount` computation: no dedicated unit test for the effect
  (WebGL-less jsdom, same as every prior Viewer3D effect); `tsc` + no
  suite regression + the e2e are the gate. (The count computation itself
  is pure CPU and covered transitively by `wallThickness.test.ts`.)
- E2e `e2e/wall-thickness-heatmap.spec.ts`: load a hand-built thin slab
  STL (~0.5 mm thick, assumed-mm), confirm the `thickness` readiness row
  starts `warn` with a non-zero count at the default 1.0 mm minimum; lower
  the min-wall input to `0.2` and confirm the row flips to `pass` with `0`;
  raise it back; toggle the heatmap on and off without error; export while
  armed and confirm the download still succeeds (proves the
  `wallThicknessOverlay` exclusion tag). Also confirm that arming the
  overhang heatmap while the wall-thickness heatmap is on flips the
  wall-thickness toggle back to "Show ..." (the mutual-exclusion interlock).

## Non-goals / carry-forward

- **Web Worker for large meshes.** The 250k-triangle cap is the stopgap; a
  worker that builds the BVH and samples off the main thread (watching the
  fflate/jsdom cross-realm typed-array gotcha for the geometry transfer) is
  the real fix and a natural first task of a later polish pass.
- **Continuous thin->thick colour gradient.** Binary (thin = red) only,
  matching SP-4a's overhang decision.
- **Per-vertex sampling / smoothing.** One ray per face centroid this
  cycle.
- **True SDF / medial-axis thickness.** The single-inward-ray heuristic is
  the standard cheap approximation (Meshmixer / PrusaSlicer do similar); it
  can under-report thickness at concave corners and over-report through
  slots. Documented, not chased.
- **A shared "world-baked overlay copy" helper** across
  overhang/wall-thickness (and SP-4c). SP-4a's final review recommended
  extracting one; do it when SP-4c makes it a third caller, not now (two
  callers with a mechanical mirror is tolerable duplication).
- **Persisted `minWallThicknessMm`.** Resets to 1.0 per session, same as
  `overhangThresholdDeg` and `buildVolumeMm`.
- **SP-4c (X-ray / clipping plane):** the remaining, not-started cycle of
  SP-4.
