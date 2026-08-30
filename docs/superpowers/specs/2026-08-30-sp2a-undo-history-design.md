# SP-2a: Undo history stack

Status: approved design, 2026-08-30. Part of the print-prep roadmap
(`2026-08-30-print-prep-roadmap.md`), first slice of SP-2 (staged auto-repair).
SP-2b (repair pipeline + modal), SP-2c (fill single hole), SP-2d (split by
shell) build on this.

## Purpose

Replace Viewer3D's single-slot model-edit undo with a bounded history of the
last 5 edits, and surface that history as a list in the Prepare panel so a
user can step back through several repair operations. SP-2b will push one
entry per repair stage; today only Make solid produces an entry.

## Non-goals

- No redo. Undo-only, matching current behavior.
- No new repair stages, worker, or geometry algorithm (SP-2b).
- No persistence. The stack is in-memory and cleared when the model or scene
  changes, exactly as the single slot is today.
- Snapshots stay "hold the pre-edit geometry object" (what the code already
  does) — no cloning, compression, or serialization.

## Current mechanism (what changes)

`src/components/Viewer3D.tsx`:

- `const undoRef = useRef<{ apply: () => void; discard: () => void } | null>(null)`
  (line ~104).
- `clearUndo()` (line ~169): `undoRef.current?.discard(); undoRef.current = null;
  setCanUndoEdit(false)`. Called from preview load (~498), scene-id change
  (~662), and — implicitly via `clearUndo()` at the top of `makeSolid` (~239)
  — before a new edit.
- `makeSolid` handle (~229-274): after the worker returns, `clearUndo()`, then
  captures `originals` (per-mesh geometry array) + `originalMaterial`, swaps in
  the result geometries + a fresh solid material, sets `undoRef.current` to a
  closure pair, `setCanUndoEdit(true)`, refreshes details, paints once.
  - `apply()`: restore each `mesh.geometry` from `originals` (dispose current
    first), restore `meshes[0].material`, dispose the solid material.
  - `discard()`: dispose the retained `originals` and `originalMaterial`.
- `undoEdit()` handle (~276): `undo = undoRef.current; undoRef.current = null;
  undo?.apply(); setCanUndoEdit(false)`, then `applyViewMode` per root,
  `updateTriangleDetails()`, `updateGeometryDetails()`, `refreshSceneEnvironment()`,
  `invalidate()`.
- `Viewer3DHandle.undoEdit: () => void` (line ~33).

`src/store/viewerStore.ts`: `canUndoEdit: boolean` + `setCanUndoEdit`.

`src/App.tsx` (105, 112): `<Sidebar onUndoEdit={() => viewerRef.current?.undoEdit()} />`
desktop + mobile.

`src/components/Sidebar.tsx` (20, 266): `onUndoEdit?: () => void` prop, forwarded
to `<PreparePanel onUndoEdit={onUndoEdit} />`.

`src/components/prepare/PreparePanel.tsx`: `onUndoEdit?: () => void` prop,
forwarded to `<RepairSection onUndoEdit={onUndoEdit} />`.

`src/components/prepare/RepairSection.tsx`: subscribes `canUndoEdit`; renders an
"Undo last model edit" button, `disabled={!canUndoEdit}`, `onClick={() => onUndoEdit?.()}`.

## Design

### UndoEntry and the stack

```ts
interface UndoEntry {
  label: string
  apply: () => void
  discard: () => void
}
```

- `const undoStackRef = useRef<UndoEntry[]>([])` replaces `undoRef`.
- `MAX_UNDO = 5` module constant.
- New helper `pushUndo(entry: UndoEntry)`:
  - `undoStackRef.current.push(entry)`
  - while `undoStackRef.current.length > MAX_UNDO`:
    `undoStackRef.current.shift()!.discard()` (drop + dispose the oldest)
  - `syncUndoLabels()`
- `clearUndo()`:
  - `for (const e of undoStackRef.current) e.discard()`
  - `undoStackRef.current = []` (reassign; the ref holds a mutable array)
  - `syncUndoLabels()` (which also sets `canUndoEdit`)
- `syncUndoLabels()`:
  - `const labels = undoStackRef.current.map((e) => e.label).reverse()` (newest
    first)
  - `useViewerStore.getState().setUndoLabels(labels)`
  - `useViewerStore.getState().setCanUndoEdit(labels.length > 0)`

### makeSolid

Replace the `clearUndo(); ...; undoRef.current = {apply, discard}; setCanUndoEdit(true)`
sequence with: build the same `apply`/`discard` closures, then
`pushUndo({ label: 'Make solid', apply, discard })`. Do NOT `clearUndo()` first —
stacking is the point. Everything else in `makeSolid` (material swap, refresh,
paint) is unchanged.

### undoEdit(steps)

`Viewer3DHandle.undoEdit: (steps?: number) => void`.

```ts
undoEdit: (steps = 1) => {
  const n = Math.min(Math.max(1, Math.floor(steps)), undoStackRef.current.length)
  for (let i = 0; i < n; i++) undoStackRef.current.pop()!.apply()
  syncUndoLabels()
  const roots = modelRoots()
  for (const root of roots) applyViewMode(root, useViewerStore.getState().viewMode)
  updateTriangleDetails()
  updateGeometryDetails()
  refreshSceneEnvironment()
  invalidate()
}
```

`apply()` order matters: popping newest-first and applying each restores the
immediately-prior geometry, so applying N in sequence lands on the state that
existed N edits ago. Each `apply()` disposes the geometry it replaces, so no
leak; the entries below the popped ones still hold their own older originals.

If the stack is empty, `n` clamps to 0, the loop is a no-op, and the refresh
still runs harmlessly. Callers already gate on `canUndoEdit`.

### Store

Add:

- `undoLabels: string[]` — initial `[]`. Newest edit first.
- `setUndoLabels: (labels: string[]) => void`.

Keep `canUndoEdit` and `setCanUndoEdit`; `syncUndoLabels` sets both so existing
consumers (`RepairSection`, the Toolbar removal already done in SP-1) need no
change beyond the list UI.

### RepairSection UI

- Prop type: `onUndoEdit?: (steps?: number) => void`.
- Subscribe `undoLabels` in addition to `canUndoEdit`.
- Keep the "Undo last model edit" button: `disabled={!canUndoEdit}`,
  `onClick={() => onUndoEdit?.(1)}`.
- When `undoLabels.length > 0`, render below the button an ordered list
  (`data-testid="undo-history"`), one row per label, newest first. Each row is
  a button: `Revert to before "<label>"` semantics — clicking row index `k`
  (0-based, newest = 0) calls `onUndoEdit?.(k + 1)`. Show the label text; the
  row's accessible name includes the step count so screen readers differentiate
  ("Undo 1 step: Make solid", "Undo 2 steps: Weld vertices", ...).
- Row styling: small, `var(--token)` classes consistent with `ReadinessCard`
  rows.

### Prop threading

- `App.tsx`: `onUndoEdit={(steps) => viewerRef.current?.undoEdit(steps)}` on both
  `<Sidebar>` instances.
- `Sidebar.tsx`: prop type `onUndoEdit?: (steps?: number) => void`, forwarded
  unchanged.
- `PreparePanel.tsx`: prop type `onUndoEdit?: (steps?: number) => void`,
  forwarded unchanged.

## Files touched

Modified:

- `src/store/viewerStore.ts` — `undoLabels` + `setUndoLabels`.
- `src/store/viewerStore.test.ts` — cover the new field + setter.
- `src/components/Viewer3D.tsx` — stack, `pushUndo`, `syncUndoLabels`,
  `clearUndo` over all entries, `undoEdit(steps)`, handle type, `makeSolid`
  push.
- `src/components/prepare/RepairSection.tsx` — undo history list, prop type.
- `src/components/prepare/RepairSection` is currently untested on its own;
  add `src/components/prepare/RepairSection.test.tsx` OR extend
  `PreparePanel.test.tsx` (choose the latter to match SP-1's structure).
- `src/components/prepare/PreparePanel.tsx` — prop type only.
- `src/components/prepare/PreparePanel.test.tsx` — undo list render + click
  step-count assertions.
- `src/components/Sidebar.tsx` — prop type only.
- `src/App.tsx` — pass `steps` through.
- `e2e/prepare-panel.spec.ts` — after Make solid, assert one "Make solid" row
  in `undo-history`; click it (or the button); assert the readiness row reverts
  and the list empties.
- `README.md` — the undo mention in Features / "Editing and export" ("one-level
  undo" -> "up to 5 steps of undo").
- `CHANGELOG.md` — entry.

## Testing

- `viewerStore.test.ts`: `undoLabels` defaults `[]`; `setUndoLabels(['a','b'])`
  updates; independent of `canUndoEdit` (setter does not touch it).
- `PreparePanel.test.tsx`:
  - `undoLabels: []` -> no `undo-history` list, button disabled.
  - `undoLabels: ['Make solid']`, `canUndoEdit: true` -> list has one row;
    clicking it calls `onUndoEdit` with `1`; the button also calls `onUndoEdit`
    with `1`.
  - `undoLabels: ['Weld vertices', 'Make solid']` -> two rows, newest first;
    clicking row 0 -> `onUndoEdit(1)`, row 1 -> `onUndoEdit(2)`.
- `Viewer3D` unit tests are impractical (no WebGL in jsdom); the stack logic
  that is testable in isolation is the label/clamp math — if the implementer
  can extract `clampUndoSteps(steps, len)` as a pure exported helper and unit
  test it, do so; otherwise the e2e covers the integration.
- `e2e/prepare-panel.spec.ts` (desktop): drop the open box, Make solid via the
  card Fix, close dialog, assert `undo-history` shows exactly one row labelled
  "Make solid" and `check-boundary` is `pass`; click that row; assert
  `check-boundary` returns to `fail` and `undo-history` is gone.

Verification gate: `pnpm test` green, `pnpm exec tsc --noEmit` clean,
`pnpm build` clean, `pnpm test:e2e -- prepare-panel` passes.

## Open questions

None. Multi-select revert (drag or shift-click a range) is out; row-click
"undo N" covers the need.
