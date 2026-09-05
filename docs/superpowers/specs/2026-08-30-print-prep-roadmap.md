# Forge View: 3D Print Prep Roadmap

Status: draft, in brainstorming. Created 2026-08-30.

Goal: extend Forge View from "viewer + Make solid" into a focused pre-slicer
prep tool: diagnose a mesh, fix it, measure it, orient it, and do the common
geometry edits (boolean, cut, hollow) that today force users into Blender or
Meshmixer.

This document is the catalogue and the sub-project breakdown. Each sub-project
(SP-n) gets its own design spec + implementation plan + release before the next
one starts.

## Locked decisions (2026-08-30)

- Sub-project order: SP-1 -> SP-9 as listed below, dependency-ordered.
- Wasm dependencies allowed where they add robustness or speed
  (`manifold-3d` for boolean/cut/hollow, a VCGlib/MeshFix wasm for hole-fill,
  `three-mesh-bvh` JS for raycast-based analysis). Hand-roll the simple worker
  passes (weld, normals, small-shell removal, overhang classify, decimate) in
  plain TS.
- Ship one sub-project at a time, each fully tested and released on the
  existing v1.x cadence.

## Current state (v1.7.2)

- Import STL / 3MF / OBJ / GLTF / GLB / PLY / DAE; export STL / 3MF / OBJ / PLY / GLB.
- `src/services/meshHealth.ts` `analyzeGeometry()` -> triangles, vertices,
  boundaryEdges, nonManifoldEdges, duplicateFaces, degenerateFaces, watertight.
- `src/services/solidRepair.ts` + `.worker.ts` + `src/services/exteriorShell.ts`:
  Edit > Make solid. Voxel air-flood plus optional GPU visibility pass. Seals
  the outer skin, drops interior geometry, one-level undo (`undoRef` in
  `Viewer3D.tsx`). Worker-backed with progress.
- `SolidEditorDialog.tsx` modal. `Sidebar.tsx` "File Info" + "Geometry" readout
  (vertices, meshes, boundary edges, non-manifold).
- Store: `viewerStore.ts`. `GeometryDetails` already carries width/height/depth
  and `modelUnitInMm` (currently only populated from glTF/3MF root userData).
- Stack: React 19, Three 0.185, Zustand 5, Tauri 2, Vite, Vitest, Playwright.

## Feature catalogue

### Tier 1: high value, moderate effort

1. Staged auto-repair pipeline. Individually runnable + "Repair all":
   weld vertices by distance, drop degenerate + duplicate faces, unify normals,
   remove small disconnected shells, fill hole loops (flat, optional smooth).
   Before/after counts per stage, like Make solid. Biggest single gap.
2. Wall-thickness analysis + heatmap. Interior ray/SDF sample, colour faces
   below an mm threshold, report min thickness + thin-region count. Needs mm scale.
3. Overhang / printability heatmap. Pick build-Z, colour faces past the
   overhang angle (default 45 deg from vertical). Cheap: per-face normal dot.
4. Auto-orient for minimum supports. Search 6 axis-aligned + ~20 tilted
   orientations, score by overhang area + projected support volume + footprint
   stability, snap to best. Reuses (3).
5. Boolean union / subtract / intersect. Drain holes, merge assemblies, carve
   joints, split for bed size. `manifold-3d` wasm (guaranteed watertight out).
6. Plane cut / split. Interactive plane, slice into two shells, cap the cut
   face, optional alignment-pin holes (boolean with (5)).

### Tier 2: high value, needs scale / UI groundwork

7. Real-world units + measure. Units prompt on import for formats that carry
   none (STL/OBJ/PLY), mm bounding box, point-to-point measure, scale-to-target,
   scale-to-build-volume.
8. Transform panel. Move / rotate / scale / drop-to-floor (min-Z to 0) /
   center-on-plate / mirror.
9. Hollowing + drain holes. Inward offset shell by wall thickness (voxel, reuse
   Make solid grid), subtract, punch drain holes.
10. Adaptive decimation / remesh. Target triangle count or max deviation;
    uniform remesh to clean bad triangulation. MeshLib wasm or worker QEM.
11. Split into parts by shell. Separate loose bodies into individually
    exportable, named, toggleable models.

### Tier 3: polish

- X-ray / clipping plane to inspect interiors and verify Make solid / hollow.
- Print-readiness score card: one panel, green/amber/red per check, each row a
  shortcut to its fix. Turns raw health numbers into an action list.
- Build-volume box: configurable plate size, ghost box, overflow warning,
  lay-flat / center buttons.
- Bed layout: auto-arrange multi-model scene non-overlapping on the plate.
- Batch prep: apply repair + orient to every model in a folder from the grid,
  export all.
- Fill single hole on click: pick a boundary loop in the viewport, fill just it.
- Deeper undo: history list once there are many edit ops.

## Sub-project breakdown

| SP | Name | Contains (catalogue refs) | Depends on | New deps |
|----|------|---------------------------|------------|----------|
| SP-1 | Prepare panel shell + readiness score card | Tier-3 score card; menu -> panel refactor; Make solid moved in | none | none |
| SP-2 | Staged auto-repair | 1, 11, fill-single-hole | SP-1 | maybe VCGlib/MeshFix wasm for hole-fill |
| SP-3 | Units + measure + transform | 7, 8 | SP-1 | none |
| SP-4 | Analysis heatmaps | 2, 3, X-ray/clipping | SP-3 (mm scale) | `three-mesh-bvh` |
| SP-5 | Auto-orient + build volume | 4, build-volume box, bed layout | SP-3, SP-4 | none |
| SP-6 | Boolean + plane cut | 5, 6 | SP-2 (cut cap needs hole-fill) | `manifold-3d` wasm |
| SP-7 | Hollowing + drain holes | 9 | SP-6 | none extra |
| SP-8 | Decimation / remesh | 10 | SP-1 | MeshLib wasm or worker QEM |
| SP-9 | Batch prep | batch prep | SP-2, SP-5 | none |

## Testing approach (all sub-projects)

Matches existing setup:

- Vitest unit tests per service / worker function. Synthetic geometry fixtures:
  open box, non-manifold tetra, self-intersecting pair, multi-shell, thin slab.
- Assert before/after invariants: triangle counts move the right way,
  `watertight` flips as expected, exterior vertices unchanged where a feature
  promises that (see memory: make-solid-expectations), min thickness matches a
  hand-computed value.
- Playwright e2e per panel workflow, in the style of
  `e2e/make-solid-large.spec.ts`. A passing Playwright spec exercising the new
  feature end-to-end in a browser is a hard completion gate for every
  sub-project: no SP is "done" until `pnpm test:e2e` covers it and passes.
  Run the `verify` skill recipe to drive the app for manual confirmation too.
- Watch the fflate/jsdom cross-realm typed-array gotcha (memory:
  fflate-jsdom-realm-gotcha) for any wasm / worker boundary that moves
  Float32Array / Uint32Array.

## SP-1 design decisions (locked 2026-08-30)

- Prepare panel is a tab in the existing right sidebar: `Details | Prepare`,
  one visible at a time. Reuses the Sidebar shell, resize handle, and mobile
  drawer.
- The `Edit` toolbar menu is removed. A single `Prepare` control (toolbar
  button / menu entry) opens and focuses the Prepare tab. `Make solid` moves
  into the panel's Repair section; `SolidEditorDialog` is launched from there
  (kept as-is for SP-1, folded into the repair pipeline in SP-2).
- Readiness score card lists every planned check now: watertight, non-manifold
  edges, degenerate faces, duplicate faces, boundary edges, thin walls,
  overhangs, off-plate. Checks whose analysis lands in a later sub-project
  render a disabled "not yet available" row and are wired in that sub-project.
- Undo stays single-level (`undoRef`) for SP-1. The multi-step undo stack is
  built in SP-2 when several repair ops exist to stack.

Full SP-1 spec: see `2026-08-30-sp1-prepare-panel-design.md`.
Plan: `../plans/2026-08-30-sp1-prepare-panel.md`.

### SP-1 status: implemented on branch `worktree-sp1-prepare-panel`

Commits 758e137..3e39177 (7 task commits + 1 final-review fix commit). Unit
suite 251 pass, `tsc` clean, `build` clean, `e2e/prepare-panel.spec.ts` green.

Carry-forward into SP-2 (deferred from SP-1 reviews, do not lose):

- **Watertight-row Fix loop.** A seal that leaves inherited non-manifold edges
  keeps the `watertight` row at "Fix needed" with a live Fix that reopens the
  tool that just ran. SP-2 owns the repair pipeline: annotate the row or
  suppress the Fix affordance once a seal has run.
- **Empty-state gating.** SP-1 renders the `prepare-empty` card placeholder
  when `geometryDetails === null`; `RepairSection` stays mounted so Undo is
  always reachable. Revisit if SP-2 changes when `geometryDetails` goes null.
- **`--text-warning` token undefined.** The card's `warn` state styling falls
  back to a hardcoded colour; no check emits `warn` yet. Define the token in
  both themes when a check first needs it.
- **Fix button renders on any `fixId`** even with no registered handler
  (only `seal` exists now). Guard with the handler map when SP-2 adds fix ids.
- **Double `<Sidebar>` mount.** `App.tsx` mounts `<Sidebar>` + `<Sidebar mobile>`
  permanently, so `PreparePanel` / `prepChecks` run twice per render and the
  tab strip's static `id`s (`right-tab-*`, `right-tabpanel-*`) can collide when
  both instances render tab markup at once (viewport-resize edge; keyboard tab
  focus may target the hidden instance, though switching still works via the
  store). Negligible today; gate future prep sections that do real work in
  render (BVH, raycasts, worker kickoff) on visibility, and give the tab
  markup instance-unique ids (`useId`) or render one Sidebar.
- Stale doc comment `src/components/Sidebar.tsx` "Closable via header button"
  (close moved to the tab strip).

## SP-2 decomposition (2026-08-30)

SP-2 (staged auto-repair) is split into four cycles, each its own spec + plan +
build:

| # | Piece | Depends on | Status |
|---|-------|-----------|--------|
| SP-2a | Undo history stack | — | SHIPPED, branch `sp2a-undo-history`, commits e993477..6f57ce2. Bounded 5-entry `UndoEntry[]` in Viewer3D, `undoEdit(steps?)`, `undoLabels` store field, clickable undo list in the Repair section. Spec: `2026-08-30-sp2a-undo-history-design.md`. |
| SP-2b | Staged repair pipeline + Repair modal | SP-2a | SHIPPED, branch `sp2b-repair-pipeline`, commits 7beea99..6897dfa (11 tasks + a final-review fix wave; 2 tasks needed 1 fix round, final review needed 1 wave). `src/services/repairStages.ts` (weld / degenerate / duplicate / unify-normals-with-signed-volume-outward-correction / remove-small-shells / fill-holes-skipping-pinched-components + `runStages`), `meshRepair.worker.ts` + `meshRepair.ts`, `Viewer3D.runRepair` (per-mesh simple stages + seal, one undo entry, skips textured/multi-material meshes), `RepairDialog.tsx` (replaces `SolidEditorDialog`; per-stage before→after, WebGL-less + strip-walls warnings, skipped-mesh note), `sealApplied` readiness annotation (clears SP-1 watertight-Fix-loop), `useId` Sidebar tab ids. Spec: `2026-08-30-sp2b-repair-pipeline-design.md`; plan: `../plans/2026-08-30-sp2b-repair-pipeline.md`. |
| SP-2c | Fill single hole on click | SP-2b | SHIPPED, branch `sp2c-fill-single-hole`, commits ca5dc74..ba1acee. `src/services/meshTopology.ts` (shared topology helpers), `boundaryLoops.ts` (`extractBoundaryLoops` + `centroidFan`), `repairStages.fillLoop` + `fillHoles` refactored onto the extractor, `holeFillOverlay.ts` (translucent cap + outline overlays, `pickOverlay`), `Viewer3D` scene-level overlay group + `holeFillMode` effect + `applyLoopFill` (one `Fill hole` undo entry), `RepairSection` toggle. Spec: `2026-08-30-sp2c-fill-single-hole-design.md`; plan: `../plans/2026-08-31-sp2c-fill-single-hole.md`. |
| SP-2d | Split by shell | — | SHIPPED, branch `sp2d-split-by-shell`, commits d6984ed..b4adb8d. `src/services/splitByShell.ts` (union-find component split into part geometries, sub-threshold fragments dropped), `Viewer3D.splitByShell` handle (scene-level part group, one `Split by shell` undo entry, retained pre-split object restored on undo), `splitParts` / `exportTargetId` store, `PartsSection.tsx` (Split button + per-part visibility + Export), `ExportDialog` scoped export. Spec: `2026-08-31-sp2d-split-by-shell-design.md`; plan: `../plans/2026-09-02-sp2d-split-by-shell.md`. **SP-2 (staged auto-repair) is now complete** (SP-2a/b/c/d all shipped). |

### Carry-forward from SP-2b (deferred / parked, do not lose)

- **Attribute-preserving weld.** SP-2b's simple stages SKIP any mesh with an
  array material, >1 draw group, or a `uv`/`color` attribute (they emit
  position-only geometry that would blank a multi-material mesh and strip
  texture/vertex-colour data). `weldVertices` specifically COULD carry
  `uv`/`color`/`groups` through the worker — a real later enhancement so
  textured models can at least be welded.
- **`unifyNormals` on non-manifold meshes** abandons the whole connected
  component (any non-2-manifold edge). The signed-volume outward correction
  only runs on orientable components. A raycast/occlusion outward test would
  be more robust.
- **`fillHoles` pinch handling** now SKIPS non-simple (pinched) boundary
  components wholesale rather than partially filling; a real ear-clip /
  constrained triangulation for non-planar or pinched loops is the eventual
  upgrade.
- **`sealApplied` partial-undo gap.** Reset on a full undo drain and on
  `clearUndo`/`setFile`; a partial undo that removes just the seal entry while
  older entries remain still leaves the flag set until the next load
  (accepted, design spec §7).
- Perf, unmeasured: `dropDegenerateFaces` allocates `Vector3`s per triangle;
  `fillHoles` uses `loop.includes` (O(n²) in loop length); `runStages` runs
  `analyzeGeometry` twice per stage boundary. Matters only on multi-million-
  triangle models.
- `make-solid-large.spec.ts` (opt-in) `detailValue()` helper has unverified
  DOM assumptions and a long-timeout-on-the-wrong-assertion; `model-workflows`
  test title says "visible progress" but only asserts hidden-after. Tidy when
  next touching e2e.
- `meshRepair.worker.ts` is the first repo worker to bundle `three` (~116 KB
  lazy chunk). Splitting the `STAGE_LABEL` / `REPAIR_STAGE_IDS` constants into
  their own module would guarantee `mergeVertices` tree-shakes out of the main
  chunk rather than depending on Rollup.
- SP-2d split-by-shell changes the mesh SET, so its `UndoEntry` cannot reuse
  `runRepair`'s fixed-`meshes`-array `apply`; build one matched to the add/
  remove it performs.

Carry-forward into SP-2b (deferred from SP-2a final review):

- Move the stack mechanics into `src/services/undoStack.ts` as pure functions
  over `UndoEntry[]` (`pushBounded`, `discardAll`, `popAndApply`, closures
  injected) as the FIRST commit of SP-2b, so push/overflow/pop ordering is
  unit-testable with fake entries and no WebGL. `UndoEntry` interface already
  lives there.
- Entry-shape caution: the Make-solid `UndoEntry`'s `discard` unconditionally
  disposes `originalMaterial` (wrong for a stage that does not swap materials —
  would dispose a live material) and its `apply` captures a fixed `meshes`
  array (wrong for a stage that changes the mesh set, e.g. SP-2d split). Each
  repair stage must build an entry matched to what it actually changed.
- `undoEdit(steps)` runs the full scene refresh even when the clamped step
  count is 0; kept deliberately (the `syncUndoLabels()` in that path
  self-heals a phantom-row click). Leave it.

## SP-3 decomposition (2026-09-04)

SP-3 (units + measure + transform) is split into two cycles. **SP-3 is now complete** (both pieces shipped); next roadmap item is SP-4 (analysis heatmaps).

| # | Piece | Depends on | Status |
|---|-------|-----------|--------|
| SP-3a | Units + measure | — | SHIPPED, branch `worktree-sp3a-units-measure`, commits 5147f26..77cc00c. `src/services/unitConversion.ts`, `scaleMath.ts`, `measureOverlay.ts`, `UnitPrompt.tsx`, `DimensionsReadout.tsx`, `MeasureSection.tsx`, `ScaleSection.tsx` (components), `Viewer3D` handle additions for measure/scale, `prepChecks` wired for on-plate readiness. Spec: `2026-09-04-sp3a-units-measure-design.md`; plan: `../plans/2026-09-04-sp3a-units-measure.md`. |
| SP-3b | Transform panel | — | SHIPPED, branch `worktree-sp3b-transform-panel`, commits 6264302..4d42b34. `Viewer3D` handle methods (`moveModelBy`, `rotateModelBy`, `scaleModelByAxes`, `mirrorModel`, `dropToFloor`, `centerOnPlate`), `TransformSection.tsx`, `PreparePanel.tsx` mount. Spec: `2026-09-05-sp3b-transform-panel-design.md`; plan: `../plans/2026-09-05-sp3b-transform-panel.md`. |

## SP-4 decomposition (2026-09-05)

SP-4 (analysis heatmaps) is split into three cycles:

| # | Piece | Depends on | Status |
|---|-------|-----------|--------|
| SP-4a | Overhang heatmap | — | SHIPPED, branch `worktree-sp4a-overhang-heatmap`, commits e641eb7..3a3c6f8. `src/services/overhangAnalysis.ts`, `overhangOverlay.ts`, `AnalysisSection.tsx`, `GeometryDetails` gains `overhangFaceCount`, `prepChecks` wired for Overhangs readiness row, `exporters.ts` excludes overlay tag, `Viewer3D.tsx` computes live count and owns overlay lifecycle. Spec: `2026-09-05-sp4a-overhang-heatmap-design.md`; plan: `../plans/2026-09-05-sp4a-overhang-heatmap.md`. |
| SP-4b | Wall-thickness heatmap | — | Not started. Interior ray/SDF sample, colour faces below threshold in mm, report min + thin-region count. |
| SP-4c | X-ray / clipping | — | Not started. Inspect interiors, verify Make solid / hollow results. |

## Sources

- Meshmixer 3D print prep: https://www.coohom.com/article/how-to-prepare-3d-models-for-print-in-meshmixer
- Blender 3D Print Toolbox: https://docs.blender.org/manual/en/4.0/addons/mesh/3d_print_toolbox.html
- PrusaSlicer modifier / cut / paint-on supports: https://help.prusa3d.com/article/modifier-meshes-custom-supports-and-other-magic_114258
- Print orientation optimizer: https://iamrapid.com/tools/print-orientation-optimizer-support-calculator/
- manifold (elalish): https://github.com/elalish/manifold
- three-bvh-csg (gkjohnson): https://github.com/gkjohnson/three-bvh-csg
- meshrepair, VCGlib wasm: https://github.com/good-tools/meshrepair
- MeshFixLib: https://github.com/hololocheck/MeshFixLib
- MeshLib: https://meshlib.io/
- Browser mesh boolean benchmarks 2026: https://polydera.com/algorithms/browser-mesh-boolean-libraries-2026
