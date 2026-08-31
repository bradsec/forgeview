# SP-2c: Fill single hole on click

Status: approved design, 2026-08-31. Part of the print-prep roadmap
(`2026-08-30-print-prep-roadmap.md`), the third cycle of SP-2 (staged
auto-repair). Builds on SP-2b (staged repair pipeline + Repair modal) and SP-2a
(undo history stack).

## Purpose

Let the user close one specific open boundary loop from the viewport instead of
running the all-loops `Fill holes` stage. Arm a pick mode from the Prepare
panel, every open loop on an eligible mesh draws as a highlighted outline, click
one to cap just that loop. Each fill is its own undo entry.

## Decisions (locked, from brainstorming 2026-08-31)

- **Pick model: highlight all loops, click one.** On arm, every simple open
  boundary loop on an eligible mesh is drawn as an outline overlay. Hover
  brightens the loop under the cursor and shows its vertex count. Click fills
  that loop.
- **Entry point: Prepare panel `RepairSection`.** A `Fill a single hole` toggle
  button, sibling of `Repair…` and `Undo last model edit`. The panel is
  non-modal so the viewport stays interactive. The readiness card `boundary`
  row `Fix` button is unchanged (still opens the Repair modal at the seal
  stage).
- **Stay armed after a fill.** A click fills one loop (one undo entry labelled
  `Fill hole`), then the overlays re-extract and redraw so the next hole can be
  filled without re-toggling. `Esc` or toggling the button off exits the mode.
- **Eligible meshes only, extraction on the main thread.** Overlays are drawn
  only for meshes that pass the SP-2b `isRepairable` test (non-array material,
  single draw group, no `uv` / `color` attribute). Loop extraction is a single
  synchronous O(triangle) pass on arm and after each fill (same order of cost
  as one `analyzeGeometry`). Ineligible meshes are reported as a count, not
  drawn.
- **No new npm dependency.** Reuses the boundary-edge walk already in
  `fillHoles`, `THREE.Raycaster`, and the SP-2a undo stack.

## Non-goals

- No worker. No redo. No hover badge beyond a vertex count.
- No ear-clipping / constrained triangulation: the cap is the same
  best-fit-plane centroid fan as `fillHoles`. Non-planar or large loops can
  produce a self-intersecting cap; that is the documented `fillHoles`
  limitation, unchanged here.
- No overlays on textured / multi-material meshes (a count is surfaced instead).
- No pinched-loop filling: a boundary component with a vertex of in- or
  out-degree > 1 is skipped, exactly as `fillHoles` skips it.
- `sealApplied` is untouched by a single-hole fill.
- No new `Viewer3DHandle` method: the mode is driven entirely through the
  store.

## Current state this builds on

- `src/services/repairStages.ts`:
  - `fillHoles(geo)` — builds merged-vertex ids via `triModel`, collects
    directed boundary edges (used by exactly one triangle, kept in that
    triangle's traversal direction), union-finds them into components, marks a
    component pinched when any vertex has boundary in- or out-degree > 1,
    walks the non-pinched components into closed loops with a `boundaryNext`
    map, and for each simple loop (closed, `length >= 3`) appends a centroid
    fan wound `(centroidId, b, a)` against each directed edge `a -> b`. Returns
    a fresh geometry; the input is never mutated. `note` reports
    `"N filled, M skipped"`.
  - `StageResult { geometry: THREE.BufferGeometry; note?: string }`.
  - `triModel(geo)` → `{ positions: Float32Array (non-indexed soup), tris:
    number[][] (merged ids), vertexCount }`; `vertexTable(positions, tris,
    vertexCount)` → first-seen `[x,y,z]` per id; `rebuild(tris, idToXYZ)` →
    `fromPositions` (which runs `computeVertexNormals`). `KEY(x,y,z)` rounds to
    1e6.
- `src/services/meshHealth.ts` `analyzeGeometry(geo) → MeshHealth`
  (`triangles, vertices, boundaryEdges, nonManifoldEdges, duplicateFaces,
  degenerateFaces, watertight`).
- `src/components/Viewer3D.tsx`:
  - `modelMeshes()` → all scene meshes; `withGeometry(list)` → those with a
    `position` attribute; `modelRoots()` for `applyViewMode`.
  - `isRepairable(m)` is currently a local closure inside the `runRepair`
    handle (line ~303): `!Array.isArray(m.material) && g.groups.length <= 1 &&
    !g.getAttribute('uv') && !g.getAttribute('color')`.
  - `undoStackRef = useRef<UndoEntry[]>([])`; `pushUndo(entry)` (bounded via
    `pushBounded`, then `syncUndoLabels()`), `clearUndo()` (`discardAll` +
    sync), `undoEdit(steps)` (`popApply` + `syncUndoLabels` + scene refresh;
    resets `sealApplied` only on a full drain).
  - `refreshTail()` inside `runRepair`: `applyViewMode` per root,
    `updateTriangleDetails`, `updateGeometryDetails`, `invalidate()`, then one
    forced synchronous `renderer.render` for backgrounded-tab cases.
  - Effect that builds the renderer/scene/controls also creates
    `const raycaster = new THREE.Raycaster()` + `const mouse = new
    THREE.Vector2()` and a `dblclick` recenter handler
    (`renderer.domElement`, NDC from `getBoundingClientRect`). A second
    raycaster block near line ~992 handles multi-model selection.
  - `clearUndo()` runs on preview teardown (~493) and on multi-model id change
    (~674).
  - The mount is `<div ref={mountRef} className="relative ...">` (already a
    positioned container, so an absolutely-positioned child badge is safe —
    confirm the class list when wiring).
- `src/store/viewerStore.ts` — `ViewerState`; `setFile` / `setFileFromBuffer`
  reset per-model fields. SP-2b added `sealApplied` + `setSealApplied`,
  `repairDialogOpen` + `setRepairDialogOpen`, `undoLabels`, `canUndoEdit`.
- `src/components/prepare/RepairSection.tsx` — reads `canUndoEdit`,
  `undoLabels`, `hasModel` (`filePath !== null || loadedModels.length > 0`);
  renders `Repair…` (→ `setRepairDialogOpen(true)`), `Undo last model edit`
  (→ `onUndoEdit(1)`), and the undo history list.
- `src/services/undoStack.ts` — `UndoEntry { label; apply; discard }`,
  `pushBounded`, `discardAll`, `popApply`, `clampUndoSteps`, `MAX_UNDO = 5`.
- `e2e/prepare-panel.spec.ts` — SP-2b end-to-end style: load a fixture,
  open the Prepare tab, drive a repair, assert readiness rows, undo from the
  history list.

## Design

### 1. `src/services/boundaryLoops.ts` (new, pure)

No React, no WebGL beyond a `BufferGeometry` argument. Extracts the
directed-boundary-edge walk that currently lives inside `fillHoles` so the two
share one implementation.

```ts
import * as THREE from 'three'

export interface BoundaryLoop {
  /** Ordered loop vertices in the geometry's local space. Consecutive pairs
   *  (points[i] -> points[i+1], wrapping) are the directed boundary edges:
   *  the surface lies to the left of that direction, so a cap must wind the
   *  other way. */
  points: [number, number, number][]
  vertexCount: number
}

export interface BoundaryLoopResult {
  loops: BoundaryLoop[]   // simple only: closed, vertexCount >= 3, non-pinched
  skippedPinched: number  // pinched boundary components not represented above
}

export function extractBoundaryLoops(geo: THREE.BufferGeometry): BoundaryLoopResult
```

Algorithm (lifted verbatim from `fillHoles`, minus the fan step):

1. `triModel(geo)` → merged ids + position soup + `vertexTable`.
2. Count undirected edge use; an edge used exactly once is a boundary edge.
   Record it directed, in the traversing triangle's order.
3. Union-find the directed edges by endpoint. Track per-vertex in-degree and
   out-degree; a component with any vertex whose in- or out-degree > 1 is
   pinched → its edges are not walked; `skippedPinched++` once per such
   component.
4. Build `boundaryNext: Map<number, number>` over the non-pinched edges; walk
   each unvisited start node forward until it returns to the start (a closed
   loop) or the chain breaks / revisits (skip, do not count — a non-pinched
   chain that fails to close is degenerate input). A closed chain with
   `< 3` vertices is skipped.
5. For each closed loop, map ids back to `[x,y,z]` via `vertexTable` and emit
   `{ points, vertexCount: points.length }`.

`triModel`, `vertexTable`, and `KEY` move to a shared internal module or are
exported from `repairStages.ts` for `boundaryLoops.ts` to import — pick the
smaller diff; do not copy them.

### 2. `fillHoles` refactor + `fillLoop` — `src/services/repairStages.ts`

- `fillHoles` calls `extractBoundaryLoops(geo)`, then for each returned loop
  appends the centroid fan (existing winding: for consecutive loop points
  `a`, `b`, push triangle `(centroidId, bId, aId)`), then `rebuild`. `note`
  becomes `"${loops.length} filled, ${skippedPinched + closedButSkipped}
  skipped"` — keep the current wording (`"N filled, M skipped"`); the skipped
  count is `skippedPinched` plus any closed loop shorter than 3 (there were
  none before because pinched were the only skips; a `< 3` closed chain is not
  reachable from real geometry, but keep the guard).
- New export:

  ```ts
  export function fillLoop(
    geo: THREE.BufferGeometry,
    loop: [number, number, number][],
  ): StageResult
  ```

  Non-indexed position soup of `geo` (same `nonIndexedPositions` helper),
  resolve each `loop` point to an existing vertex index by `KEY` match (the
  points came from this geometry, so every match succeeds; if any point fails
  to match, return `geo.clone()` with `note: 'skipped: loop not on geometry'`
  — a guard against a stale overlay). Compute the centroid, append one fan:
  for each consecutive pair `a → b` in `loop` (wrapping), append triangle
  `(centroid, b, a)`. `fromPositions` the result (runs `computeVertexNormals`).
  Input geometry untouched.

- `fillHoles`'s existing unit tests must stay green unchanged (same output for
  the same input).

### 3. Store — `src/store/viewerStore.ts`

Add to `ViewerState`:

```ts
holeFillMode: boolean
setHoleFillMode: (on: boolean) => void
holeFillStatus: { loops: number; skippedMeshes: number } | null
setHoleFillStatus: (s: { loops: number; skippedMeshes: number } | null) => void
```

Initial `holeFillMode: false`, `holeFillStatus: null`. `setFile` and
`setFileFromBuffer` reset both (`holeFillMode: false`, `holeFillStatus: null`)
alongside the other per-model resets.

### 4. Viewer3D — overlay, pick, fill

- Lift `isRepairable` to module scope (shared by `runRepair` and the new
  code). No behaviour change.
- New ref:

  ```ts
  const holeOverlayRef = useRef<{
    lines: { line: THREE.LineLoop; mesh: THREE.Mesh; loop: BoundaryLoop }[]
    hovered: number | null
  } | null>(null)
  ```

- Overlay materials: one shared `LineBasicMaterial` for the idle state
  (`color` = accent, `depthTest: false`, `transparent: true`, `opacity: 0.9`)
  and one for the hovered state (brighter / full opacity). `renderOrder` on
  each `LineLoop` set above the meshes. Dispose the two materials on unmount.

- `buildOverlays()`:
  1. `disposeOverlays()` first (idempotent redraw).
  2. `meshes = withGeometry(modelMeshes())`; `repairable = meshes.filter(isRepairable)`.
  3. For each repairable mesh: `extractBoundaryLoops(mesh.geometry)`. For each
     `loop`, make a `THREE.BufferGeometry` from `loop.points` (flat
     `Float32Array`), a `THREE.LineLoop` with the idle material, add it as a
     **child of that mesh** (inherits the mesh's world transform; points stay
     local). Push `{ line, mesh, loop }`.
  4. `totalLoops = sum`, `skippedMeshes = meshes.length - repairable.length`.
     `useViewerStore.getState().setHoleFillStatus({ loops: totalLoops,
     skippedMeshes })`.
  5. `invalidate()`.

- `disposeOverlays()`: for each entry `entry.mesh.remove(entry.line)`,
  `entry.line.geometry.dispose()` (material is shared, not disposed here);
  null the ref; `setHoleFillStatus(null)`; `invalidate()`.

- Effect keyed on the store `holeFillMode`:
  - `true` → `buildOverlays()`, attach pointer + key listeners (below).
  - `false` → detach listeners, `disposeOverlays()`.
  - cleanup detaches + disposes.
  - Also force `holeFillMode` off (via `setHoleFillMode(false)`, which
    re-enters this effect) when: `repairDialogOpen` turns true (a second
    effect or a check in the existing dialog-open path), the multi-model id
    changes (next to the existing `clearUndo()` at ~674), and preview teardown
    (next to `clearUndo()` at ~493).

- Pointer move handler on `renderer.domElement` (only while armed):
  NDC from `getBoundingClientRect` (same math as the dblclick handler),
  `raycaster.setFromCamera`, `raycaster.params.Line.threshold` raised (start
  at a value scaled to model size, e.g. `boundingSphere.radius * 0.01`; tune),
  `raycaster.intersectObjects(holeOverlayRef.current.lines.map(l => l.line))`.
  Nearest hit → set that entry's `line.material` to the hovered material,
  reset the previously hovered entry to idle, store `hovered` index, position
  an absolutely-placed badge `div` (a ref-held element appended to the mount)
  at the loop centroid projected to screen (`Vector3.project(camera)` →
  pixels), text `"${loop.vertexCount} vertices"`. No hit → clear hover + hide
  badge. `invalidate()` on any change.

- Click handler on `renderer.domElement` (only while armed): if `hovered` is
  non-null, `applyLoopFill(entry.mesh, entry.loop)`. Guard: ignore the click
  if it was a drag (OrbitControls) — compare pointerdown / pointerup position
  within a few px, same idea as any existing click-vs-drag guard, or gate on
  `controls` not having moved.

- `Escape` keydown (window, only while armed) → `setHoleFillMode(false)`.

- `applyLoopFill(mesh, loop)`:
  1. `before = withGeometry(modelMeshes())`; if `mesh` is not in it, bail.
  2. `original = mesh.geometry`; `res = fillLoop(original, loop.points)`; if
     `res.geometry === original` (guard hit), bail without an undo entry.
  3. `mesh.geometry = res.geometry`.
  4. `pushUndo({ label: 'Fill hole', apply: () => { if (mesh.geometry !==
     original) { mesh.geometry.dispose(); mesh.geometry = original } },
     discard: () => original.dispose() })`.
  5. `buildOverlays()` (re-extract; the filled loop is gone, the rest remain).
  6. `refreshTail()` equivalent: `applyViewMode` per root,
     `updateTriangleDetails`, `updateGeometryDetails`, `invalidate()`, one
     forced `renderer.render`. Factor the `runRepair` tail into a reusable
     local if it is not already.
  7. Does **not** call `setSealApplied`.

- Disposal on unmount: `disposeOverlays()`, dispose the two shared overlay
  materials, remove all listeners, remove the badge element.

### 5. `src/components/prepare/RepairSection.tsx`

Add between `Repair…` and `Undo last model edit`:

```tsx
<button
  type="button"
  disabled={!hasModel}
  aria-pressed={holeFillMode}
  onClick={() => useViewerStore.getState().setHoleFillMode(!holeFillMode)}
  className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm self-start disabled:opacity-50 aria-pressed:bg-[var(--accent-button)] aria-pressed:text-white"
>
  Fill a single hole
</button>
{holeFillMode && (
  <p className="text-xs text-[var(--text-muted)]">
    Click a highlighted loop in the viewport. Press Esc to stop.
    {holeFillStatus && (
      <> {holeFillStatus.loops} open loop{holeFillStatus.loops === 1 ? '' : 's'}
      {holeFillStatus.skippedMeshes > 0 &&
        ` · ${holeFillStatus.skippedMeshes} mesh${holeFillStatus.skippedMeshes === 1 ? '' : 'es'} not eligible`}
      </>
    )}
  </p>
)}
```

Reads `holeFillMode` and `holeFillStatus` from the store. Verify the
`aria-pressed:` Tailwind variant is available in this project's config; if
not, switch to a conditional `className` expression.

### 6. Docs

- `README.md` — the Prepare panel section: add a line on `Fill a single hole`
  (arm from the Repair section, click a highlighted open loop, each fill is a
  separate undo step).
- `CHANGELOG.md` — Unreleased: `Prepare > Repair: Fill a single hole — pick one
  open boundary loop in the viewport and cap just it.`
- `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md` — SP-2c row → status
  line with the branch and commit range once shipped. The SP-2b carry-forward
  note about `fillHoles` pinch handling stays as is: SP-2c inherits the same
  skip behaviour, it does not resolve it.

## Files

New: `src/services/boundaryLoops.ts` (+ `.test.ts`).

Modified: `src/services/repairStages.ts` (+ `.test.ts`),
`src/components/Viewer3D.tsx`, `src/components/prepare/RepairSection.tsx`
(+ `.test.tsx`), `src/store/viewerStore.ts` (+ `.test.ts`),
`e2e/prepare-panel.spec.ts`, `README.md`, `CHANGELOG.md`,
`docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`.

## Testing

- `boundaryLoops.test.ts`:
  - open box (top face missing, 10 triangles) → `loops.length === 1`,
    `loops[0].vertexCount === 4`, `skippedPinched === 0`; the 4 points are the
    top-rim corners.
  - a box with two separate square holes → `loops.length === 2`.
  - figure-eight boundary sharing one apex vertex → `loops.length === 0`,
    `skippedPinched === 1`.
  - closed cube → `loops.length === 0`, `skippedPinched === 0`.
- `repairStages.test.ts`:
  - `fillLoop(openBox, topLoop.points)` → `analyzeGeometry` `watertight ===
    true`, `boundaryEdges === 0`; triangle count is `10 + 4` (fan of 4);
    every appended fan triangle's face normal has positive dot with
    `(faceCentroid - loopCentroid)` for the convex fixture (outward-facing
    cap).
  - `fillLoop` with a point not on the geometry → returns a clone, `note`
    set, triangle count unchanged.
  - existing `fillHoles` suite runs unchanged and green after the extractor
    refactor (regression guard on the shared code path).
- `viewerStore.test.ts`: `holeFillMode` default `false` + setter;
  `holeFillStatus` default `null` + setter; `setFile` resets both;
  `setFileFromBuffer` resets both.
- `RepairSection.test.tsx`: the toggle flips `holeFillMode`; `aria-pressed`
  reflects it; disabled when `hasModel` is false; with `holeFillMode` true and
  a `holeFillStatus` of `{ loops: 3, skippedMeshes: 1 }` the helper text reads
  `3 open loops · 1 mesh not eligible`; `{ loops: 1, skippedMeshes: 0 }` reads
  `1 open loop` with no eligibility clause.
- `Viewer3D.test.tsx` (jsdom, in the style of the existing suite):
  - loading an open-box model then setting `holeFillMode` true adds exactly one
    `LineLoop` under the mesh and sets `holeFillStatus.loops` to 1.
  - setting `holeFillMode` false removes and disposes it and clears
    `holeFillStatus`.
  - invoking the internal fill path for that loop (exposed via a test seam or
    driven through a stubbed raycast hit) swaps the mesh geometry, pushes an
    undo entry labelled `Fill hole`, and a subsequent `buildOverlays` finds 0
    loops; `undoEdit(1)` restores the original geometry and 1 loop.
  - a real pointer raycast + click is left to e2e.
- e2e `prepare-panel.spec.ts` (hard completion gate for SP-2c):
  load the open-box fixture → open the Prepare tab → click `Fill a single
  hole` → the viewport shows the loop overlay → click it → `check-boundary`
  readiness row becomes `pass` (or the boundary-edge count drops to 0) → the
  undo history shows `Fill hole` → click it → the row returns to `fail`.

Verification gate: `pnpm test` green, `pnpm exec tsc --noEmit` clean,
`pnpm build` clean, `pnpm test:e2e -- prepare-panel` passes. Run the `verify`
skill recipe for manual confirmation.

## Risks

- **Non-planar / large loop caps.** The centroid fan can self-intersect or
  bridge a concave rim. Same limitation `fillHoles` already ships; SP-2c does
  not add ear-clipping. The e2e uses a convex fixture; the outward-normal unit
  assertion catches a fully inverted cap.
- **Line picking threshold.** `raycaster.params.Line.threshold` is in world
  units; too small and thin loops are unclickable, too large and adjacent
  loops both hit. Scale it to the model bounding sphere and pick the nearest
  intersection. Tune during implementation with the `verify` recipe.
- **Badge positioning.** Screen-projecting the loop centroid needs the mount
  rect and the camera; recompute on pointer move and on `controls` change
  while armed. If the badge proves fiddly, fall back to a fixed-position
  status line in the panel showing the hovered loop's vertex count (still
  satisfies "hover shows a count").
- **Overlay as a mesh child.** Adding the `LineLoop` under the mesh means
  `applyViewMode` / traversal code that iterates mesh children must not treat
  it as model geometry. Check `applyViewMode`, `updateTriangleDetails`,
  `updateGeometryDetails`, exporters, and the multi-model selection raycast
  for `traverse` calls that would pick up a `LineLoop`; filter by
  `isLineLoop` / a `userData` tag, or add the overlays to a scene-level group
  transformed to match the mesh instead. Decide during implementation; the
  scene-level group is the safer default if any traversal is ambiguous.
- **Re-extraction cost after each fill.** One O(triangle) pass per repairable
  mesh per fill. Accepted (locked). Only a concern on multi-million-triangle
  models, where the all-loops `Fill holes` stage is the better tool anyway.
- **Drag vs click.** A left-drag orbit ending over a loop must not fill it.
  Gate the click on pointer travel from pointerdown being under a few pixels.

## Open questions

None blocking. The `raycaster.params.Line.threshold` scale factor and the
badge-vs-panel-status-line choice are settled during implementation against the
`verify` recipe.
