# SP-2d: Split by shell

Status: approved design, 2026-09-01. Part of the print-prep roadmap
(`2026-08-30-print-prep-roadmap.md`), the fourth and final cycle of SP-2
(staged auto-repair). Independent of SP-2b/SP-2c code paths; builds on SP-2a
(undo stack) and reuses `meshTopology.ts` from SP-2c.

## Purpose

Separate a multi-body model (disconnected triangle islands in one mesh) into
individually named, toggleable, exportable parts in the scene, as one undoable
edit.

## Decisions (locked, from brainstorming 2026-09-01)

- **Operates on the preview model, one repairable mesh.** Split targets the
  single-file preview (`modelGroupRef`) and requires exactly one mesh that
  passes the SP-2c `isRepairable` test (single draw group, non-array material,
  no `uv` / `color`). 0 or >1 repairable meshes, or multi-model mode active,
  disables the control with a reason. This is the common multi-body STL/OBJ
  case.
- **Output is in-memory parts, separate from `loadedModels`.** A new
  `splitPartsRef: Map<string, THREE.Mesh>` in `Viewer3D` plus a
  `splitPartsGroupRef` group added to the scene; a store `splitParts:
  SplitPart[]` carries the metadata. The file-driven `loadedModels` array is
  untouched.
- **Threshold, small fragments dropped.** Connected components below
  `minFraction` of the total triangle count (default `0.001`) are discarded,
  never turned into parts; the single largest component is always kept. A
  transient note reports how many were removed. The original geometry is never
  mutated, so undo restores the full model including the dropped specks.
- **New Prepare "Parts" section.** A `Split by shell` button plus, once split,
  a list: per row an auto-name (`` `${baseName} — part ${n}` ``), triangle
  count, a visibility checkbox, an Export button. No rename, no per-part
  delete. Undo of the `Split by shell` history entry recombines.
- **Part export reuses the Export dialog, scoped.** A part row's Export opens
  the existing `ExportDialog` (format picker, filename, save flow) scoped to
  that part's geometry via a new `exportTargetId` store field; filename
  defaults to the part name.
- **No new npm dependency.** Reuses `meshTopology.triModel` (merged-vertex
  union-find, same primitive `removeSmallShells` uses), the SP-2a undo stack,
  and `collectExportMeshes` / `exportMeshes`.

## Non-goals

- No redo. No rename. No per-part delete. No re-split of an already-split model
  (the button is disabled while `splitParts.length > 0`; undo first).
- No multi-mesh or multi-material preview support: a model with 0 or >1
  repairable meshes is blocked with a message.
- `sealApplied` is untouched by a split.
- No change to how `loadedModels` (directory panel / add-to-scene) works.
- Split does not persist: loading a new file or clearing discards parts.

## Current state this builds on

- `src/services/meshTopology.ts` (SP-2c): `triModel(geo) → { positions:
  Float32Array (non-indexed soup), tris: number[][] (merged ids), vertexCount
  }`, `fromPositions(positions) → BufferGeometry` (runs
  `computeVertexNormals`), `KEY`, `vertexTable`, `rebuild`.
- `src/services/repairStages.ts` `removeSmallShells(geo, minFraction = 0.01)`
  — the existing union-find-over-merged-ids connected-component labeller;
  SP-2d's `splitByShell` is the same labelling, emitting each kept component
  as its own geometry instead of filtering one geometry.
- `src/components/Viewer3D.tsx`:
  - `modelGroupRef: useRef<THREE.Object3D | undefined>` — the single-file
    preview object. `modelMapRef: Map<string, THREE.Object3D>` — multi-model
    entries. `modelRoots() = [modelGroupRef.current,
    ...modelMapRef.current.values()].filter(Boolean)` (line ~148).
  - `modelMeshes()` traverses `modelRoots()` for `THREE.Mesh` children
    (line ~150).
  - `isRepairable(m)` — module-scope export (SP-2c): `!Array.isArray(m.material)
    && geometry.groups.length <= 1 && !geometry.getAttribute('uv') &&
    !geometry.getAttribute('color')`.
  - SP-2c pattern for a scene-level ref group + a store-driven effect +
    an `UndoEntry` built to match the exact scene mutation
    (`holeOverlayRef` / `applyLoopFill` / `pushUndo`). `refreshTail`-style
    tail: `applyViewMode` per root, `updateTriangleDetails`,
    `updateGeometryDetails`, `invalidate()`, one forced `renderer.render`.
  - `pushUndo(entry)` bounded (`pushBounded`, `MAX_UNDO = 5`), `undoEdit`,
    `clearUndo`. `clearUndo()` + `setHoleFillMode(false)` run on preview
    teardown (~effect 2) and multi-model id change.
  - Effect 5 multi-model add path clones nothing — it `loadModel(path)`s.
    Split has no path; it builds meshes in memory.
  - `Viewer3DHandle` (line ~37): `getScene`, `getCamera`, `runRepair`,
    `undoEdit`, `getModelDimensions`, etc.
- `src/components/prepare/PreparePanel.tsx` — renders `ReadinessCard`
  (guarded on `geometryDetails`) then `<RepairSection onUndoEdit={onUndoEdit}
  />`. Takes `{ onUndoEdit }`. Mounted inside `Sidebar`, which `App.tsx`
  mounts twice (desktop + `mobile`), passing `onUndoEdit`.
- `src/components/ExportDialog.tsx` — `{ viewerRef }`. `runExport()` does
  `const scene = viewerRef.current?.getScene()`, then
  `collectExportMeshes(scene)` → `exportMeshes(meshes, format, { threeMFUnit
  })`. Filename default from `exportFileName(fileName, format)`. Driven by
  store `exportOpen` / `setExportOpen`.
- `src/services/exporters.ts` — `collectExportMeshes(root: THREE.Object3D):
  THREE.Mesh[]` (clones every mesh under `root` with world transform baked),
  `exportMeshes(meshes, format, opts)`, `disposeExportMeshes(meshes)`.
- `src/store/viewerStore.ts` — `ViewerState`; `setFile` / `setFileFromBuffer`
  reset per-model fields (SP-2c added `holeFillMode` / `holeFillStatus`
  resets there). `exportOpen` / `setExportOpen`. `pendingModelLoads`.
- `src/store/viewerStore.test.ts`, `e2e/prepare-panel.spec.ts` (SP-2b/SP-2c
  style: fixture STL built in-test, Prepare tab, drive an edit, assert, undo
  from the history list).

## Design

### 1. `src/services/splitByShell.ts` (new, pure)

```ts
import * as THREE from 'three'

export interface ShellSplitResult {
  /** one geometry per kept connected component, largest triangle count first */
  parts: THREE.BufferGeometry[]
  droppedFragments: number
  droppedTriangles: number
}

/**
 * Label connected components by shared merged-vertex id (union-find, the same
 * labelling `removeSmallShells` uses) and emit each kept component as its own
 * non-indexed geometry. A component is kept when its triangle count is at
 * least `minFraction` of the total; the single largest component is always
 * kept. Dropped components are counted, not emitted. Parts are ordered by
 * descending triangle count. The input geometry is never mutated.
 */
export function splitByShell(
  geo: THREE.BufferGeometry,
  minFraction = 0.001,
): ShellSplitResult
```

Algorithm:

1. `{ positions, tris, vertexCount } = triModel(geo)`; `table =
   vertexTable(positions, tris, vertexCount)`.
2. Union-find over `vertexCount`; for each `tri` union its three ids. Group
   triangle indices by `find(tri[0])`.
3. `total = tris.length`; `maxLen = max(group triangle counts)`.
4. Keep a group when `group.length === maxLen || group.length >= minFraction *
   total`. For each kept group, `rebuild(groupTris, id => table[id])` → one
   geometry. Dropped groups: `droppedFragments++`, `droppedTriangles +=
   group.length`.
5. Sort `parts` by descending triangle count (recompute from the group sizes;
   do not re-analyze).
6. Single group in → `parts.length === 1`, `droppedFragments === 0`.

`rebuild` already runs `computeVertexNormals` via `fromPositions`. No new
helpers; import `triModel`, `vertexTable`, `rebuild` from `./meshTopology`.

### 2. Store — `src/store/viewerStore.ts`

```ts
export interface SplitPart {
  id: string          // crypto.randomUUID()
  name: string
  triangleCount: number
  visible: boolean
}
```

Add to `ViewerState`:

```ts
splitParts: SplitPart[]                                  // initial []
setSplitParts: (parts: SplitPart[]) => void
setSplitPartVisible: (id: string, visible: boolean) => void
exportTargetId: string | null                            // initial null
setExportTargetId: (id: string | null) => void
```

- `setSplitPartVisible` maps over `splitParts`, flips the matching `visible`.
- `setFile` / `setFileFromBuffer` reset `splitParts: []` and `exportTargetId:
  null` (same object passed to `set(...)` as the SP-2c resets).
- `setExportOpen(false)` also clears `exportTargetId` — put the reset in the
  `ExportDialog` close handler rather than the store setter to keep the
  setter dumb; see §5.

### 3. Viewer3D — split, undo, teardown

New refs:

```ts
const splitPartsGroupRef = useRef<THREE.Group | undefined>(undefined)
const splitPartsRef = useRef<Map<string, THREE.Mesh>>(new Map())
```

`modelRoots()` becomes:

```ts
const modelRoots = () =>
  [modelGroupRef.current, ...modelMapRef.current.values(), splitPartsGroupRef.current]
    .filter((r): r is THREE.Object3D => Boolean(r))
```

New handle method (the handle method and the pure service share the name
`splitByShell`; the component imports the service, e.g. `import { splitByShell
as splitGeometryByShell } from '../services/splitByShell'`, or calls it
qualified — pick one in the plan and keep it consistent):

```ts
splitByShell: () => { parts: number; droppedFragments: number }
getSplitPart: (id: string) => THREE.Mesh | undefined
```

`splitByShell()` handle flow (synchronous — the labelling is one O(triangle) pass):

1. Guard: `modelGroupRef.current` must exist and `modelMapRef` be empty, else
   throw `'Split by shell works on a single open model'`. `splitPartsRef` must
   be empty, else throw `'Already split — undo Split by shell first'`.
2. `meshes = withGeometry(modelMeshes()).filter(isRepairable)`. Require
   `meshes.length === 1`; on 0 throw `'No splittable mesh: the model uses
   textures or multiple materials'`, on >1 throw `'Split by shell needs a
   single-mesh model'`.
3. `mesh = meshes[0]`; `res = splitByShell(mesh.geometry)`. If
   `res.parts.length < 2` → dispose `res.parts`, throw `'Nothing to split:
   the model is a single connected shell'`.
4. `original = modelGroupRef.current`. Remove `original` from the scene
   (`scene.remove(original)`) — keep the ref value AND the object graph for
   undo; do **not** `disposeModel` it.
5. Build `const group = new THREE.Group()`; `group.userData.splitGroup =
   true`. For each part geometry, in `res` order:
   - `const partMesh = new THREE.Mesh(partGeo, (mesh.material as
     THREE.Material).clone())`
   - copy `mesh` world transform onto `partMesh` (`mesh.updateWorldMatrix(true,
     false)`; decompose `mesh.matrixWorld` into `partMesh.position/quaternion/
     scale`) so parts sit exactly where the body was.
   - `const id = crypto.randomUUID()`; `partMesh.userData.splitPartId = id`;
     `partMesh.name = `${baseName} — part ${i + 1}``.
   - `group.add(partMesh)`; `splitPartsRef.current.set(id, partMesh)`.
   `baseName` = `fileName` (store) with any trailing extension stripped, or
   `'model'` when null.
   Apply the current view mode (`applyViewMode(group, viewMode)`) and the
   theme model colour to each `partMesh` material (reuse the recolour block
   from the Effect 5 add path).
   `scene.add(group)`; `splitPartsGroupRef.current = group`.
6. `setSplitParts(parts)` where each entry is `{ id, name, triangleCount:
   <group size for that part>, visible: true }`. Triangle counts come from
   `res` (largest first), not a re-analyze.
7. One `UndoEntry`, pushed via `pushUndo`:
   - `label: 'Split by shell'`
   - `apply`: for each `[, m] of splitPartsRef.current` — `m.geometry.dispose()`;
     dispose `m.material` (single, cloned). `scene.remove(group)`;
     `group.clear()`. `splitPartsGroupRef.current = undefined`;
     `splitPartsRef.current.clear()`. `scene.add(original)`;
     `modelGroupRef.current = original`. `setSplitParts([])`.
   - `discard`: `disposeModel(original, scene)` (the retained pre-split object
     is now dead — parts are the live scene).
8. Tail: `for (const root of modelRoots()) applyViewMode(root, viewMode)`;
   `updateTriangleDetails()`; `updateGeometryDetails()`; `invalidate()`; one
   forced `renderer.render`. Does **not** call `setSealApplied`.
9. Return `{ parts: res.parts.length, droppedFragments: res.droppedFragments }`.

`getSplitPart(id)` = `splitPartsRef.current.get(id)`.

**Visibility effect.** A `useEffect` (or store subscription) keyed on
`splitParts`: for each `part`, `splitPartsRef.current.get(part.id)?.visible =
part.visible`; `invalidate()`. Cheap; runs only when the array identity
changes.

**Teardown.** Preview teardown (Effect 2) and multi-model id change already
run `clearUndo()` (which drains the stack, firing each entry's `discard`) and
`setHoleFillMode(false)`. Add, right there, a direct cleanup so a
bounded-out split entry cannot strand a group:

```ts
if (splitPartsGroupRef.current && sceneRef.current) {
  for (const m of splitPartsRef.current.values()) {
    m.geometry.dispose()
    ;(m.material as THREE.Material).dispose?.()
  }
  sceneRef.current.remove(splitPartsGroupRef.current)
  splitPartsGroupRef.current.clear()
  splitPartsGroupRef.current = undefined
  splitPartsRef.current.clear()
}
useViewerStore.getState().setSplitParts([])
```

The retained pre-split `original` in that path: if the undo stack still holds
the split entry, `clearUndo()`'s `discard` disposes it; if the stack was
bounded out, the split entry's `discard` already ran when it fell off and
disposed `original` then. Either way `original` is handled — this block only
cleans the live parts. Add unmount disposal of the split group + materials to
the Effect 1 cleanup alongside the existing scene teardown.

**`disposeViewerResources`** — extend to also dispose a passed split group, or
handle it in the Effect 1 cleanup before `disposeViewerResources` runs.
Prefer the latter (smaller change).

### 4. Traversal audit

`modelRoots()` now yields up to three sources. The split group holds **real
meshes** and is *meant* to be seen by view-mode, triangle/geometry details,
export, and selection raycast — unlike SP-2c's overlay group. Confirm each
consumer treats the split group's children as ordinary model meshes:

- `applyViewMode`, `updateTriangleDetails`, `updateGeometryDetails` — iterate
  `modelRoots()` / `modelMeshes()`; parts included is correct.
- `collectExportMeshes(scene)` (whole-scene export) — walks the scene, picks up
  parts, skips the removed `original`. Correct.
- Both raycast blocks (`dblclick` recenter ~line 598, multi-model selection
  ~line 1093) push `modelGroupRef.current` and `modelMapRef` values as
  targets. Add `splitPartsGroupRef.current` so double-click recenters on a
  part. Selection raycast: parts are not `loadedModels` entries, so any
  selection-by-id logic must tolerate a hit whose object has
  `userData.splitPartId` and no matching `loadedModels` row — treat as no-op
  (do not select).
- SP-2c overlay / hole-fill: `isRepairable` filtering and `buildLoopOverlays`
  run over `modelMeshes()`; post-split they would operate on the parts. Out of
  scope to wire deliberately; not broken (each part is a valid repairable
  mesh).

### 5. `ExportDialog.tsx` — scoped export

- Read `exportTargetId` from the store.
- On close (the existing close handler / `onClose`): call
  `setExportTargetId(null)` alongside `setExportOpen(false)`.
- In `runExport()`:
  ```ts
  const targetId = useViewerStore.getState().exportTargetId
  let root: THREE.Object3D | undefined
  if (targetId) {
    root = viewerRef.current?.getSplitPart(targetId)
    if (!root) { store.setError('That part is no longer in the scene'); return }
  } else {
    root = viewerRef.current?.getScene()
    if (!root) { store.setError('Export needs an open 3D view'); return }
  }
  // ...
  meshes = collectExportMeshes(root)
  ```
- Filename default: when `exportTargetId` is set, use the part's `name` from
  `splitParts` in place of `fileName` for `exportFileName(...)`.
- Dialog title: `Export model` → `Export — {partName}` when scoped.

### 6. `PartsSection.tsx` (new) + `PreparePanel` + `App` wiring

`src/components/prepare/PartsSection.tsx`, props `{ viewerRef:
React.RefObject<Viewer3DHandle | null> }`.

```tsx
const splitParts = useViewerStore((s) => s.splitParts)
const hasModel = useViewerStore((s) => s.filePath !== null)
const multiModel = useViewerStore((s) => s.loadedModels.length > 0)
const pending = useViewerStore((s) => s.pendingModelLoads)
const disabled = !hasModel || multiModel || pending > 0 || splitParts.length > 0
```

- `<h3>` "Split" heading (match `RepairSection`'s heading style).
- `[Split by shell]` button, `disabled`. On click:
  ```ts
  try {
    const { droppedFragments } = viewerRef.current!.splitByShell()
    if (droppedFragments > 0) setNote(`${droppedFragments} tiny fragment${droppedFragments === 1 ? '' : 's'} removed`)
  } catch (e) {
    useViewerStore.getState().setError(e instanceof Error ? e.message : 'Split failed')
  }
  ```
  `setNote` is local `useState`, cleared on the next successful split or when
  `splitParts` empties.
- When `splitParts.length > 0`: `<ul data-testid="split-parts">`, one `<li>`
  per part:
  - `<input type="checkbox" checked={part.visible} aria-label={`Show ${part.name}`}
    onChange={e => useViewerStore.getState().setSplitPartVisible(part.id, e.target.checked)} />`
  - `{part.name}` + `{part.triangleCount.toLocaleString()} tris`
  - `<button>Export</button>` → `useViewerStore.getState().setExportTargetId(part.id);
    useViewerStore.getState().setExportOpen(true)`
  - helper `<p>`: "Undo 'Split by shell' from the history to recombine."

`PreparePanel` — add `viewerRef` to its props, render `<PartsSection
viewerRef={viewerRef} />` after `<RepairSection>`. `Sidebar` — thread
`viewerRef` through to `PreparePanel` (it already forwards `onUndoEdit`).
`App.tsx` — pass `viewerRef={viewerRef}` to both `<Sidebar>` mounts.

Double-mount note (SP-1/SP-2c carry-forward): two `PartsSection` instances
render; both read the same store, so the split button in the hidden instance
is harmless. No per-instance ids needed here (no tab markup).

### 7. Docs

- `README.md` — Prepare panel section: a "Split by shell" bullet (splits a
  multi-body model into named parts; per-part visibility + export; undo
  recombines; tiny fragments dropped).
- `CHANGELOG.md` — Unreleased entry.
- `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md` — SP-2d row →
  SHIPPED with branch + commit range; note SP-2 is complete.

## Files

New: `src/services/splitByShell.ts` (+ `.test.ts`),
`src/components/prepare/PartsSection.tsx` (+ `.test.tsx`).

Modified: `src/components/Viewer3D.tsx`, `src/store/viewerStore.ts`
(+ `.test.ts`), `src/components/prepare/PreparePanel.tsx` (+ `.test.tsx`),
`src/components/Sidebar.tsx`, `src/App.tsx`,
`src/components/ExportDialog.tsx` (+ `.test.tsx`),
`e2e/prepare-panel.spec.ts`, `README.md`, `CHANGELOG.md`,
`docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`.

## Testing

- `splitByShell.test.ts`:
  - two unit cubes offset on X (one mesh, 24 tris) → `parts.length === 2`,
    each 12 tris, `parts[0]` count `>=` `parts[1]` count, `droppedFragments
    === 0`; summed part tris === 24; input `position.count` unchanged.
  - big cube (12 tris) + a 2-triangle speck, `minFraction` default → `parts
    .length === 1`, `droppedFragments === 1`, `droppedTriangles === 2`.
  - single cube → `parts.length === 1`, `droppedFragments === 0`.
  - three components, middle one below threshold → 2 parts, 1 dropped, order
    largest-first.
- `viewerStore.test.ts`: `splitParts` default `[]` + `setSplitParts`;
  `setSplitPartVisible` flips exactly the matching id; `exportTargetId`
  default `null` + setter; `setFile` resets both.
- `PartsSection.test.tsx`: button disabled with no model / in multi-model mode
  / while `splitParts.length > 0`; enabled otherwise; click calls
  `viewerRef.splitByShell` and on a thrown Error routes the message to
  `setError`; with `splitParts` seeded, renders a row per part with the tri
  count; the checkbox calls `setSplitPartVisible(id, false)`; Export sets
  `exportTargetId` to the row id and `exportOpen` true. Stub `viewerRef` with
  `vi.fn()`s.
- `ExportDialog.test.tsx`: with `exportTargetId` set and a stub
  `viewerRef.getSplitPart` returning a `THREE.Mesh`, the title shows the part
  name and `runExport` collects from the part object (assert
  `getSplitPart` called with the id, `getScene` not used for mesh
  collection); closing the dialog calls `setExportTargetId(null)`.
- `PreparePanel.test.tsx`: renders `PartsSection` (a `Split by shell` button
  present); existing assertions unchanged.
- e2e `prepare-panel.spec.ts` — "splits a two-body model into parts":
  a two-cube ASCII-STL fixture (built in-test, like `openBoxStl`) → Prepare
  tab → `Split by shell` → `split-parts` list shows 2 rows with tri counts →
  uncheck part 2 → (assert it is hidden: the simplest robust check is that the
  checkbox state flipped; a pixel check is out of scope) → undo the
  `Split by shell` entry from the history list → `split-parts` gone, undo
  history empty.

Gate: `pnpm test` green, `pnpm exec tsc --noEmit` clean, `pnpm build` clean,
`pnpm test:e2e -- prepare-panel` passes. Run the `verify` recipe for manual
confirmation of the 3-D result.

## Risks

- **Retained-original disposal ordering.** The pre-split `modelGroupRef`
  object is removed from the scene but kept alive for undo. Its `discard`
  (`disposeModel(original, scene)`) must run exactly once — when the split
  entry falls off the bounded stack or is cleared. Mirror the SP-2c
  `runRepair` undo entry's discard discipline; the teardown block in §3 must
  only touch the live parts, never `original`.
- **`modelRoots()` third source.** Every existing `modelRoots()` /
  `modelMeshes()` consumer now potentially sees the split group. The §4 audit
  must be completed during implementation — a missed consumer that assumes at
  most a preview + multi-model set could double-count triangles or mis-apply
  a view mode.
- **Part world transform.** Baking `mesh.matrixWorld` into each part keeps
  them positioned; if the preview mesh had a non-identity parent transform
  (loader-applied rotation), decompose from `matrixWorld`, not `mesh.matrix`.
- **Material cloning.** One cloned `THREE.Material` per part; the undo entry
  and the teardown block both dispose them. A part material leak shows up in
  the `verify` recipe as growing GPU memory across split/undo cycles.
- **Selection raycast.** A click on a part must not throw in the multi-model
  selection handler (which looks up `loadedModels` by id). Guard for a hit
  with `userData.splitPartId`.
- **Very large models.** `splitByShell` allocates a `tris: number[][]` and a
  union-find array sized to the merged vertex count — same footprint as
  `removeSmallShells`, which already runs in the repair pipeline. Acceptable.

## Open questions

None blocking. `minFraction` default `0.001` is a function parameter, not
surfaced in the UI for SP-2d; a later pass can add a control if users need a
different cutoff (the brainstorming "slider" option was deferred).
