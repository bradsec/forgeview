# SP-2b: Staged repair pipeline + Repair modal

Status: approved design, 2026-08-30. Part of the print-prep roadmap
(`2026-08-30-print-prep-roadmap.md`), the core slice of SP-2 (staged
auto-repair). Builds on SP-2a (undo history stack). SP-2c (fill single hole on
click) and SP-2d (split by shell) build on this.

## Purpose

Turn "Make solid" from a single opaque operation into a list of individually
runnable mesh-repair stages, presented in a dedicated Repair modal with
per-stage before/after counts and a "Repair all" pipeline. Also clear the
deferred SP-1 review debt and the SP-2a carry-forwards.

## Decisions (locked)

- **Per-mesh, structure preserved.** Stages 1-6 run on each scene mesh
  independently; mesh count, materials, and multi-part layout are kept. Only
  the seal stage collapses the scene to one mesh (its existing behavior).
- **Seal is the final stage in the Repair modal.** `SolidEditorDialog` is
  retired; its resolution + strip-walls controls move into the seal stage row.
- **"Repair all" = one undo entry** (labelled `Repair all`); an individual
  stage run = one entry labelled with that stage. Fixed pipeline order: weld →
  degenerate → duplicate → normals → small-shell → hole-fill → seal.
- **No new npm dependency.** `mergeVertices` comes from
  `three/examples/jsm/utils/BufferGeometryUtils.js`, which ships inside the
  `three` package already in use.

## Non-goals

- No viewport hole picking (SP-2c). No shell-to-model split (SP-2d).
- No ear-clipping / constrained triangulation for hole-fill — best-fit-plane
  centroid fan only. Non-simple or deeply non-planar loops are left as a later
  enhancement; the stage reports how many loops it filled vs skipped.
- No redo.
- No change to the seal algorithm itself (`solidRepair` / `exteriorShell` /
  `visibleTriangles` untouched).

## Current state this builds on

- `src/services/solidRepair.ts` `repairGeometriesInWorker(meshes, resolution,
  onProgress, signal, { stripInternalWalls, renderer })` → GPU visibility +
  voxel worker → `{ geometries: BufferGeometry[], stats: SolidRepairStats }`
  where `geometries[0]` is the sealed soup and the rest are empty placeholders.
- `src/services/meshHealth.ts` `analyzeGeometry(geometry) → MeshHealth`
  (`triangles, vertices, boundaryEdges, nonManifoldEdges, duplicateFaces,
  degenerateFaces, watertight`), and `summariseHealth(healths[])`.
- `src/services/undoStack.ts` — `MAX_UNDO = 5`, `clampUndoSteps`,
  `interface UndoEntry { label; apply; discard }`.
- `src/components/Viewer3D.tsx`:
  - `undoStackRef = useRef<UndoEntry[]>([])`; `syncUndoLabels()` (line ~170),
    `pushUndo(entry)` with shift+discard over `MAX_UNDO` (~175), `clearUndo()`
    disposes all (~180). `clearUndo()` runs on preview teardown (~493) and
    multi-model id change (~674).
  - `makeSolid` handle (~235): runs `repairGeometriesInWorker`, swaps per-mesh
    geometry + `meshes[0]` material to a fresh `MeshStandardMaterial`, then
    `pushUndo({ label: 'Make solid', apply, discard })` where `apply` restores
    geometry + material and disposes the solid material, `discard` disposes the
    retained originals + material. Then `applyViewMode`, `updateTriangleDetails`,
    `updateGeometryDetails`, one-time render.
  - `undoEdit(steps = 1)` (~286): pop+apply `clampUndoSteps(steps, len)` entries.
  - `Viewer3DHandle` (~32): `makeSolid(...)`, `undoEdit(steps?)`.
- `src/components/SolidEditorDialog.tsx` — modal driven by
  `solidEditorOpen`; `resolution` select (96/128/160), `stripWalls` checkbox
  (needs WebGL2), progress + stat grid, calls `viewerRef.current.makeSolid`.
- Store `solidEditorOpen` / `setSolidEditorOpen`, referenced by: `App.tsx`,
  `Viewer3D.tsx` (none — only the dialog), `SolidEditorDialog.tsx`,
  `prepare/PreparePanel.tsx` (`FIX_HANDLERS.seal`), `prepare/RepairSection.tsx`
  (`Make solid…` button), and tests `SolidEditorDialog.test.tsx`,
  `PreparePanel.test.tsx`, `SceneControls.test.tsx`.
- `src/services/prepChecks.ts` — `prepChecks(details) → PrepCheck[]`; the
  `watertight`, `nonManifold`, `boundary`, `degenerate`, `duplicate` fail rows
  all carry `fixId: 'seal'`.
- `src/components/prepare/ReadinessCard.tsx` — renders a `Fix` button whenever
  `check.fixId` is set; `warn` state styled with the non-existent
  `var(--text-warning,#b45309)`.
- `src/components/prepare/PreparePanel.tsx` — `FIX_HANDLERS: Record<string, () =>
  void> = { seal: () => setSolidEditorOpen(true) }`; `onFix={(fixId) =>
  FIX_HANDLERS[fixId]?.()}`.
- `src/components/Sidebar.tsx` — tab strip with static `id`s `right-tab-details`
  / `right-tab-prepare` and `role="tabpanel"` `id`s `right-tabpanel-*`; mounted
  twice by `App.tsx` (desktop `<Sidebar>` + `<Sidebar mobile>` in the mobile
  drawer), so those ids duplicate in the DOM. Doc comment line ~19 says
  "Closable via header button" (stale; the close moved to the tab strip in SP-1).
- Theme: `src/themes/index.ts` exposes `--warning` (`#E7B85C` light / `#E8A020`
  dark), `--success` is **not** a token (ReadinessCard uses the `#15803d`
  fallback), `--error` exists.

## Design

### 1. Pure stage functions — `src/services/repairStages.ts`

No React, no WebGL. Each stage takes and returns a `THREE.BufferGeometry` and
never mutates its input (clone or build fresh). Non-indexed input is handled;
output may be indexed or not (callers re-run `analyzeGeometry`, which tolerates
both).

```ts
export interface StageResult {
  geometry: THREE.BufferGeometry
  /** stage-specific note for the modal, e.g. "3 loops filled, 1 skipped" */
  note?: string
}

export const REPAIR_STAGE_IDS = [
  'weld', 'degenerate', 'duplicate', 'normals', 'smallShells', 'holeFill',
] as const
export type RepairStageId = typeof REPAIR_STAGE_IDS[number]

export const STAGE_LABEL: Record<RepairStageId | 'seal', string> = {
  weld: 'Weld vertices',
  degenerate: 'Remove degenerate faces',
  duplicate: 'Remove duplicate faces',
  normals: 'Unify normals',
  smallShells: 'Remove small shells',
  holeFill: 'Fill holes',
  seal: 'Make solid (seal)',
}

export function weldVertices(geo: THREE.BufferGeometry, tolerance = 1e-4): StageResult
export function dropDegenerateFaces(geo: THREE.BufferGeometry): StageResult
export function dropDuplicateFaces(geo: THREE.BufferGeometry): StageResult
export function unifyNormals(geo: THREE.BufferGeometry): StageResult
export function removeSmallShells(geo: THREE.BufferGeometry, minFraction = 0.01): StageResult
export function fillHoles(geo: THREE.BufferGeometry): StageResult

/** Run an ordered subset of the simple stages on one geometry, in
 * REPAIR_STAGE_IDS order regardless of input order. Returns the final geometry
 * plus the per-stage MeshHealth before/after and note. */
export function runStages(
  geo: THREE.BufferGeometry,
  stageIds: RepairStageId[],
): { geometry: THREE.BufferGeometry; stages: { id: RepairStageId; before: MeshHealth; after: MeshHealth; note?: string }[] }
```

Algorithms:

- **weld** — `mergeVertices(geo, tolerance)` from `BufferGeometryUtils`. Wrap in
  try/catch; on throw (degenerate attribute layout) return the input clone
  unchanged with a note.
- **degenerate** — to-non-indexed; drop any triangle whose three positions
  contain a duplicate (within 1e-6) or whose cross-product length² ≤ 1e-20
  (same test `meshHealth` uses). Rebuild positions.
- **duplicate** — merge positions at 1e-6 into vertex ids (same keying as
  `meshHealth.vertexKey`); drop a triangle whose sorted id-triple was already
  seen. Rebuild.
- **normals** — build edge→triangles adjacency over merged vertex ids; BFS each
  connected component from an arbitrary seed; for each neighbor sharing an edge
  in the same direction as the current triangle, flip the neighbor's winding;
  after the pass, `geometry.computeVertexNormals()`. If a component is
  non-orientable (a flip conflict), leave it and count it in the note.
- **smallShells** — connected-component label over merged vertex ids; keep
  components with `triangleCount ≥ minFraction * totalTriangles` **and** always
  keep the single largest component; drop the rest. Note reports count + tris
  removed. If only one component, no-op.
- **holeFill** — merged vertex ids; collect boundary edges (used by exactly one
  triangle); walk them into closed loops; for each loop: compute centroid and a
  best-fit plane normal (Newell's method), fan-triangulate centroid→(v_i,
  v_{i+1}) with winding chosen so the fan's normal opposes the plane normal's
  outward sense (consistent with the loop's one-sided edges); append the fan
  triangles. Skip and count any loop that is not a simple closed cycle (an edge
  visited twice, a vertex with >2 boundary edges). Note: "N filled, M skipped".

### 2. Worker — `src/services/meshRepair.worker.ts`

Thin. Message in: `{ id, meshes: { positions: ArrayBuffer, index: ArrayBuffer | null }[], stageIds: RepairStageId[] }`. For each mesh, rebuild a `BufferGeometry`, `runStages`, post progress
(`{ type: 'progress', id, percent, phase }`) between stages, then post
`{ id, meshes: { positions, index }[], perMeshStages: [...][] }` with transferables.
Module worker, same lifecycle pattern as `solidRepair.worker` (AbortController →
`worker.terminate()`).

`src/services/meshRepair.ts` — `runRepairInWorker(meshes: THREE.Mesh[],
stageIds, onProgress, signal) → Promise<{ geometries: THREE.BufferGeometry[];
perMesh: { id: RepairStageId; before: MeshHealth; after: MeshHealth; note?:
string }[][] }>`. Serializes each mesh's `position` + `index`, spawns the
worker, rebuilds `BufferGeometry` per mesh from the reply (`computeVertexNormals`
if the reply carries no normals), aggregates. Mirrors `repairGeometriesInWorker`
error handling and the "open model changed while running" guard.

### 3. `src/services/undoStack.ts` — pure stack helpers (SP-2a carry-forward)

Add and unit-test:

```ts
export function pushBounded(stack: UndoEntry[], entry: UndoEntry, max = MAX_UNDO): void
  // stack.push(entry); while (stack.length > max) stack.shift()!.discard()
export function discardAll(stack: UndoEntry[]): void
  // for (const e of stack) e.discard(); stack.length = 0
export function popApply(stack: UndoEntry[], n: number): void
  // for (let i = 0; i < n; i++) stack.pop()!.apply()   // caller clamps n
```

`Viewer3D`'s `pushUndo` / `clearUndo` / `undoEdit` delegate to these
(`pushUndo` = `pushBounded(undoStackRef.current, entry); syncUndoLabels()`,
`clearUndo` = `discardAll(...); syncUndoLabels()`, `undoEdit` =
`popApply(..., clampUndoSteps(steps, len)); syncUndoLabels(); <refresh>`).
`undoStackRef.current` must stay the **same array instance** for `stack.length =
0` to be observable — change `clearUndo`'s `undoStackRef.current = []` to rely
on `discardAll` emptying in place.

### 4. Viewer3D — `runRepair`

New handle method:

```ts
runRepair: (
  stageIds: (RepairStageId | 'seal')[],
  sealOpts: { resolution: number; stripInternalWalls: boolean },
  onProgress: (percent: number, phase: string) => void,
  signal?: AbortSignal,
) => Promise<RepairRunResult>
```

`RepairRunResult = { label: string; perMesh: {...}[][]; seal?: SolidRepairStats }`.

Flow:
1. `meshes = withGeometry(modelMeshes())`; snapshot `originals = meshes.map(m =>
   m.geometry)` and `hadSeal = stageIds.includes('seal')`, plus
   `originalMaterial = meshes[0].material` (only used if `hadSeal`).
2. If any simple stage in `stageIds`: `runRepairInWorker(meshes, simpleIds,
   ...)`, then per-mesh `mesh.geometry = result.geometries[i]` (dispose the one
   being replaced ONLY if it is not in `originals` — i.e. never here, since we
   snapshot first; the old geometry is retained by the undo entry).
3. If `'seal'` in `stageIds`: call the existing `makeSolid`-style path
   (`repairGeometriesInWorker` + the material swap) but WITHOUT its own
   `pushUndo` — factor the seal apply into `runRepair`. Simplest: extract the
   body of the current `makeSolid` handle minus `pushUndo` into a local
   `applySeal(resolution, onProgress, signal, opts)` returning `{ stats,
   solidMaterial, sealOriginals, sealOriginalMaterial }`; `makeSolid` handle
   calls it then `pushUndo`; `runRepair` calls it then folds into its own entry.
4. Build ONE `UndoEntry`:
   - `label`: `stageIds.length > 1 ? 'Repair all' : STAGE_LABEL[stageIds[0]]`
     (when the caller sends the full pipeline it is `Repair all`; a single id
     uses its label).
   - `apply`: for each mesh, `mesh.geometry.dispose(); mesh.geometry =
     originals[i]`; if `hadSeal`, `meshes[0].material = originalMaterial` and
     `solidMaterial.dispose()`.
   - `discard`: `originals.forEach(g => g.dispose())`; if `hadSeal`, dispose
     `originalMaterial` and (if the seal path allocated one) nothing else.
   Push it via `pushUndo`.
5. `applyViewMode` per root, `updateTriangleDetails`, `updateGeometryDetails`,
   one-time render, return the aggregated result. If the seal ran, also set the
   store `sealApplied: true` (see §7).
6. Guard: if `withGeometry(modelMeshes())` identity/length changed during the
   run, dispose the new geometries and throw `The open model changed while
   repair was running` (same as `makeSolid`).

`makeSolid` handle is kept (used by nothing after §5-6 wiring except possibly
tests) — actually retire it: `runRepair(['seal'], opts, ...)` covers it. Remove
`makeSolid` from `Viewer3DHandle` and delete `SolidEditorDialog`'s call. Keep
`repairGeometriesInWorker` and `applySeal`.

### 5. Repair modal — `src/components/RepairDialog.tsx`

Replaces `SolidEditorDialog.tsx` (delete that file + its test; port relevant
assertions).

- Driven by store `repairDialogOpen` / `setRepairDialogOpen` (rename of
  `solidEditorOpen` / `setSolidEditorOpen`; update all 6 referencing sites).
- Layout: dialog header ("Repair"), a stage list, a footer with **Repair all**
  and Close/Cancel.
- Stage list rows (order = pipeline order): weld, degenerate, duplicate,
  normals, small-shell, hole-fill, seal. Each row:
  - stage label + a one-line "current" hint derived from `geometryDetails`
    where meaningful: normals/weld → none; degenerate → `${degenerateFaces}
    degenerate faces`; duplicate → `${duplicateFaces} duplicate faces`;
    small-shell → `${meshes} meshes`; hole-fill → `${boundaryEdges} open
    edges`; seal → `watertight ? 'Watertight' : 'Not sealed'`.
  - a **Run** button (disabled while any run is active or `!hasModel`).
  - after a run: `before → after` for the fields the stage affects, plus the
    `note`.
  - the **seal** row, when present, shows the resolution `<select>` (96/128/160
    → Draft/Standard/Fine) and the "Remove internal walls" checkbox (disabled
    without WebGL2), same copy as `SolidEditorDialog` today.
- **Repair all**: calls `viewerRef.current.runRepair([...REPAIR_STAGE_IDS,
  'seal'], sealOpts, onProgress, signal)`. **Run** on a row calls
  `runRepair([id], sealOpts, ...)`.
- Progress: one shared progress bar + phase text while a run is active
  (reuse the `<progress>` + phase pattern from `SolidEditorDialog`).
- Abort on close mid-run (AbortController), same as `SolidEditorDialog`.
- Errors: `useViewerStore.getState().setError(...)`, same as today.
- `App.tsx` renders `<RepairDialog viewerRef={viewerRef} />` in place of
  `<SolidEditorDialog />`; the `inert` expression's `solidEditorOpen` →
  `repairDialogOpen`.

### 6. Entry points

- `prepare/PreparePanel.tsx` `FIX_HANDLERS` → `{ seal: () =>
  useViewerStore.getState().setRepairDialogOpen(true) }`.
- `prepare/RepairSection.tsx` `Make solid…` button → label `Repair…`,
  `onClick` → `setRepairDialogOpen(true)`.
- Any Toolbar/menu reference (SP-1 removed the Edit menu; confirm none remain).
- `SceneControls.test.tsx` / `SceneContextMenu` — check for a `makeSolid` or
  `solidEditorOpen` reference and update.

### 7. `sealApplied` flag + watertight Fix-loop annotation

- Store: `sealApplied: boolean` (initial `false`) + `setSealApplied`.
  Set `true` at the end of a `runRepair` whose `stageIds` included `'seal'`.
  Set `false` on model load (`setFile` / `setFileFromBuffer`) and when
  `undoStackRef` becomes empty after an undo/clear that removes the seal
  entry — simplest: `syncUndoLabels()` sets `sealApplied` to
  `labels.includes('Repair all') || labels.includes('Make solid (seal)')`
  is fragile; instead have `clearUndo` and a fully-drained `undoEdit` reset it,
  and `runRepair(seal)` set it. Accept that a partial undo that removes the
  seal entry but leaves earlier entries won't reset the flag until the next
  load — document it.
- `prepChecks(details, sealApplied)` — new second param. When `sealApplied` is
  true and a `watertight` / `nonManifold` row would be `fail`, instead emit
  `state: 'warn'`, detail `'Sealed; residual edges inherited from the original
  skin'`, and **no** `fixId`. `boundary` still uses the real count (a sealed
  shell should have 0). All call sites pass the flag; `ReadinessCard` /
  `PreparePanel` read `sealApplied` from the store.

### 8. SP-1 debt

- **Duplicate tab ids** — `Sidebar.tsx`: `const uid = useId()`; ids become
  `` `${uid}-tab-${tab}` `` / `` `${uid}-tabpanel-${tab}` ``; the keydown
  handler's `document.getElementById(...)` uses the same template. Both mounts
  now have distinct ids.
- **`--text-warning`** — `ReadinessCard.tsx` `STATE_CLASS.warn` →
  `text-[var(--warning)]` (token exists). Remove the bogus fallback.
- **Fix-without-handler guard** — `ReadinessCard` takes a new prop `canFix?:
  (fixId: string) => boolean` (or the handler map); render the `Fix` button
  only when `fixId && (canFix?.(fixId) ?? true)`. `PreparePanel` passes
  `canFix={(id) => id in FIX_HANDLERS}`.
- **Stale doc comment** — `Sidebar.tsx` line ~19: drop "Closable via header
  button", say the panel has Details/Prepare tabs and a close control in the
  tab strip.

## Files

New: `src/services/repairStages.ts` (+ `.test.ts`),
`src/services/meshRepair.ts`, `src/services/meshRepair.worker.ts`,
`src/components/RepairDialog.tsx` (+ `.test.tsx`).

Modified: `src/services/undoStack.ts` (+ `.test.ts`),
`src/components/Viewer3D.tsx`, `src/store/viewerStore.ts` (+ `.test.ts`),
`src/services/prepChecks.ts` (+ `.test.ts`),
`src/components/prepare/ReadinessCard.tsx` (+ `.test.tsx`),
`src/components/prepare/PreparePanel.tsx` (+ `.test.tsx`),
`src/components/prepare/RepairSection.tsx`, `src/components/Sidebar.tsx`
(+ `.test.tsx`), `src/App.tsx`, `src/components/SceneControls.test.tsx`,
`e2e/prepare-panel.spec.ts`, `README.md`, `CHANGELOG.md`.

Deleted: `src/components/SolidEditorDialog.tsx`,
`src/components/SolidEditorDialog.test.tsx`.

## Testing

- `repairStages.test.ts` — per stage with synthetic fixtures built in code:
  - open box (5 faces) → `fillHoles` → `analyzeGeometry.watertight === true`,
    `boundaryEdges === 0`, original 10 triangles unchanged, +N fill triangles.
  - two tetrahedra sharing a face, one wound backwards → `unifyNormals` makes
    winding consistent (all face normals point outward — check sign of
    `dot(faceNormal, faceCentroid - meshCentroid)` is positive for a convex
    fixture).
  - a plane with one triangle duplicated → `dropDuplicateFaces` removes exactly
    one; `analyzeGeometry.duplicateFaces` 1 → 0.
  - a triangle with two coincident vertices appended → `dropDegenerateFaces`
    removes exactly it.
  - split-vertex cube (24 verts) → `weldVertices` → 8 vertices, 12 triangles,
    `watertight` unchanged true.
  - big cube + a 2-triangle speck (< 1% of tris) → `removeSmallShells` drops
    the speck, keeps the cube.
  - `runStages(geo, ['duplicate','weld'])` applies in canonical order (weld
    then duplicate) regardless of arg order — assert via a fixture where order
    matters.
- `undoStack.test.ts` — `pushBounded` overflow (6th push discards the 1st,
  `discard` spy called once, length 5), `discardAll` (every `discard` spy
  called, length 0, same array instance), `popApply` (n=2 pops newest-first,
  `apply` spies called in order).
- `viewerStore.test.ts` — `repairDialogOpen` default false + setter;
  `sealApplied` default false + setter; `setFile` resets `sealApplied`.
- `prepChecks.test.ts` — `sealApplied=true` turns a `watertight:false` /
  `nonManifoldEdges>0` model's rows to `warn` + no `fixId` + the annotation
  detail; `boundary` still `fail` on a real open edge; `sealApplied=false`
  unchanged from today.
- `ReadinessCard.test.tsx` — `warn` row renders no `Fix`; `canFix` returning
  false hides `Fix` even when `fixId` set; `warn` uses `var(--warning)` (assert
  the class string).
- `RepairDialog.test.tsx` — the 7 stage rows render in order; `Run` on the
  `holeFill` row calls `viewerRef.runRepair(['holeFill'], ...)`; `Repair all`
  calls `runRepair` with `['weld','degenerate','duplicate','normals','smallShells','holeFill','seal']`;
  the seal row shows the resolution select and the strip-walls checkbox; close
  while a fake in-flight run aborts. Use a stub `viewerRef` with `vi.fn()`s.
- `Sidebar.test.tsx` — the two tab `id`s differ between a desktop and a mobile
  render (unique per `useId`); arrow-key nav still works.
- `PreparePanel.test.tsx` — `Fix` on the `watertight` row opens the repair
  dialog (`repairDialogOpen` true); with `sealApplied` true the row shows no
  `Fix`.
- e2e `prepare-panel.spec.ts` — open box → `Repair…` → `Fill holes` row `Run` →
  dialog shows `open edges 4 → 0`; close → `check-boundary` `pass`; undo from
  the history list → `fail`. Second test: `Repair all` on the open box → all
  computed readiness rows `pass` or `warn` (none `fail`).

Verification gate: `pnpm test` green, `pnpm exec tsc --noEmit` clean,
`pnpm build` clean, `pnpm test:e2e -- prepare-panel` passes.

## Risks

- **unifyNormals** on non-orientable or multi-shell meshes: BFS flip can
  thrash. Mitigation: per-component, detect a flip conflict (an edge that would
  need the same triangle in both orientations) and abandon that component
  unchanged, counting it in the note. Covered by a deliberately non-orientable
  fixture (Möbius-like strip) asserting the stage returns without error and
  leaves that component's triangle count unchanged.
- **holeFill** winding: getting the fan normal backwards makes an inward-facing
  cap that still reads as `watertight` to `analyzeGeometry` (which is
  orientation-blind) but renders black. The e2e catches a fully broken cap
  (viewport WebGL context check already in the suite); add a `repairStages`
  assertion that every fill triangle's normal has positive dot with the
  outward direction at the loop centroid for the convex open-box fixture.
- **Retiring `SolidEditorDialog`**: 6 call sites + 3 test files. A missed
  reference is a compile error (caught by `tsc`), not a silent break.

## Open questions

None blocking. `minFraction` for `removeSmallShells` default (0.01) and
`weldVertices` `tolerance` default (1e-4) are exposed as function params but not
surfaced in the modal for SP-2b; a later pass can add sliders if users need
them.
