# SP-1: Prepare panel shell + readiness score card

Status: approved design, 2026-08-30. Part of the print-prep roadmap
(`2026-08-30-print-prep-roadmap.md`). First sub-project; later sub-projects
(SP-2 auto-repair, SP-3 transforms, ...) dock their UI into the panel this
sub-project builds.

## Purpose

Replace the flat `Edit` menu with a dedicated Prepare panel and turn the raw
`meshHealth` numbers into a print-readiness score card: one row per check,
pass / warn / fail state, and a Fix shortcut that jumps to the tool. Ships no
new geometry algorithms. Establishes the surface every later sub-project plugs
into.

## Non-goals

- No new mesh processing. `meshHealth.ts`, `solidRepair.ts`, `exteriorShell.ts`
  are untouched.
- No multi-step undo. `Viewer3D`'s single `undoRef` stays. SP-2 builds the stack.
- No Transform / Orient / Modify sections. Those arrive with SP-3+.
- No thin-wall / overhang / off-plate analysis. Those rows render as
  "not yet available" and are wired by SP-4 / SP-5.
- No new dependencies.

## Current state this builds on

- `src/components/Toolbar.tsx`: `Menu label="Edit"` with `Make solid...`
  (`setSolidEditorOpen(true)`) and `Undo last model edit` (`onUndoEdit`, gated
  on `canUndoEdit`). `desktop-actions` holds segmented controls + a `Details`
  toggle button.
- `src/components/Sidebar.tsx`: right `<aside>`, resizable via left-edge handle,
  `sidebarVisible` gate, mobile variant. Body = "Scene Models" (`ModelList`) +
  "File Info" + "Geometry" (`geometryDetails`: vertices, meshes, boundaryEdges,
  nonManifoldEdges).
- `src/components/SolidEditorDialog.tsx`: modal driven by `solidEditorOpen`,
  calls `viewerRef.current.makeSolid(...)`.
- `src/store/viewerStore.ts`: `sidebarVisible`, `setSidebarVisible`,
  `solidEditorOpen`, `setSolidEditorOpen`, `canUndoEdit`, `setCanUndoEdit`,
  `mobileDrawer` (`'none' | 'explorer' | 'details'`), `setMobileDrawer`,
  `geometryDetails: GeometryDetails | null`.
- `GeometryDetails`: `{ width, height, depth, vertices, meshes, boundaryEdges,
  nonManifoldEdges, watertight, modelUnitInMm }`. Note: it does NOT currently
  carry `degenerateFaces` / `duplicateFaces`, though `meshHealth` produces them
  (see Data model change below).
- `src/App.tsx`: renders `<Toolbar onUndoEdit={...} />`, `<Sidebar />`,
  `<SolidEditorDialog viewerRef={viewerRef} />`, and two `<MobileDrawer>`s. The
  `inert` on the main region already includes `solidEditorOpen`.
- `src/components/Viewer3D.tsx`: `updateGeometryDetails()` runs on model load and
  at the end of `makeSolid` / `undoEdit`, calling
  `useViewerStore.getState().setGeometryDetails(...)` with the summed
  `analyzeGeometry` result.

## Data model change

`meshHealth.analyzeGeometry` already returns `degenerateFaces` and
`duplicateFaces`. `GeometryDetails` and `Viewer3D.updateGeometryDetails` drop
them today. The score card needs them.

- Add `degenerateFaces: number` and `duplicateFaces: number` to
  `GeometryDetails` in `viewerStore.ts`.
- In `Viewer3D.tsx` where the per-mesh `analyzeGeometry` results are summed into
  the object passed to `setGeometryDetails`, include those two fields in the
  reduce and the final object.
- `Sidebar` "Geometry" readout: unchanged (still shows the existing four). The
  card is the consumer of the new fields.

## Architecture

### New module: `src/services/prepChecks.ts`

Pure, no React, no Three (a `type`-only import of `GeometryDetails` from the
store is fine).

```ts
export type PrepCheckState = 'pass' | 'warn' | 'fail' | 'unavailable'

export interface PrepCheck {
  id: string            // stable, e.g. 'watertight'
  label: string         // 'Watertight'
  state: PrepCheckState
  detail: string        // one short line: the number or why unavailable
  fixId?: string        // key into the panel's handler map; omitted when none
}

export function prepChecks(details: GeometryDetails | null): PrepCheck[]
```

Order and rules (details === null -> every row `state: 'unavailable'`,
detail `'Open a model'`, no fixId):

| id | label | pass | warn | fail | fixId |
|----|-------|------|------|------|-------|
| `watertight` | Watertight | `watertight === true` | - | `watertight === false` | `seal` |
| `nonManifold` | Manifold edges | `nonManifoldEdges === 0` | - | `> 0` | `seal` |
| `boundary` | Open edges | `boundaryEdges === 0` | - | `> 0` | `seal` |
| `degenerate` | Degenerate faces | `=== 0` | - | `> 0` | `seal` |
| `duplicate` | Duplicate faces | `=== 0` | - | `> 0` | `seal` |
| `thickness` | Thin walls | - | - | - | - |
| `overhangs` | Overhangs | - | - | - | - |
| `onPlate` | On build plate | - | - | - | - |

`thickness`, `overhangs`, `onPlate` always return
`state: 'unavailable'`, detail `'Available in a later update'`, no fixId, for
this sub-project. They stay in the list so the card's shape is final and later
sub-projects only change the row's computation.

`detail` strings for computed rows: the count, e.g.
`'12 non-manifold edges'`, `'0 degenerate faces'`, `'Sealed'` /
`'Not watertight'` for `watertight`.

Note on Make solid's known false alarm (see roadmap / memory
make-solid-expectations): a sealed result can still report non-zero
non-manifold edges inherited from the original skin. SP-1 does not try to
special-case this; the row reflects the raw count. SP-2, which owns the repair
pipeline, decides how to annotate it.

### New store field

`viewerStore.ts`:

- `rightPanelTab: 'details' | 'prepare'` (initial `'details'`).
- `setRightPanelTab: (tab: 'details' | 'prepare') => void`.

No other store changes beyond the `GeometryDetails` fields above.

### New components: `src/components/prepare/`

- `PreparePanel.tsx` - the Prepare tab body. Renders an ordered list of
  sections. SP-1 list: `[<ReadinessCard/>, <RepairSection/>]`. Later
  sub-projects insert entries. If `geometryDetails === null`, render the empty
  state ("Open a model to run checks") instead of the sections; the tab itself
  stays selectable.
- `ReadinessCard.tsx` - subscribes to `geometryDetails`, calls
  `prepChecks(details)`, renders one row per check: state pip (colour +
  text/icon, not colour alone - a11y), label, detail, and a `Fix` button when
  `fixId` is set and a handler exists. Button calls `handlers[fixId]()`.
- `RepairSection.tsx` - SP-1 content: a `Make solid...` button
  (`setSolidEditorOpen(true)`) with the one-line description, and an
  `Undo last model edit` button (`props.onUndoEdit`, `disabled={!canUndoEdit}`).
  This is the new home of the action removed from the Edit menu.

Handler map lives in `PreparePanel.tsx` (or a small `prepHandlers.ts` if it
reads cleaner), passed to `ReadinessCard`:

```ts
const handlers: Record<string, () => void> = {
  seal: () => useViewerStore.getState().setSolidEditorOpen(true),
}
```

### Sidebar becomes tabbed

`Sidebar.tsx`:

- Add a tab strip at the top of the panel body: two buttons, `Details` and
  `Prepare`, `role="tab"` in a `role="tablist"`, `aria-selected` bound to
  `rightPanelTab`, click -> `setRightPanelTab(...)`. Keyboard: Left/Right arrows
  move between tabs (standard tablist pattern).
- Body: `rightPanelTab === 'details'` -> existing "Scene Models" + "File Info" +
  "Geometry" block. `rightPanelTab === 'prepare'` -> `<PreparePanel onUndoEdit={...} />`.
  "Scene Models" (`ModelList`): keep it visible under Details only. (It is scene
  state, not prep state.)
- Resize handle, `MIN/MAX_WIDTH`, width clamp on resize, `sidebarVisible` gate,
  mobile variant: all unchanged. Both tabs share the one panel width.
- Mobile: the right `MobileDrawer` already renders `<Sidebar mobile />`, so the
  tab strip comes along for free. No new drawer.

`Sidebar` needs the `onUndoEdit` callback to pass down. Options: (a) thread it
from `App.tsx` as a prop like `Toolbar` gets it, or (b) have `RepairSection`
call `viewerRef` via a context. Prefer (a): `App.tsx` already holds `viewerRef`
and passes `onUndoEdit` to `Toolbar`; pass the same to `Sidebar`.

### Toolbar changes

`Toolbar.tsx`:

- Remove the entire `<Menu label="Edit">` block.
- Remove the now-unused `onUndoEdit` prop from `Toolbar` (it moves to
  `Sidebar`). `canUndoEdit` subscription also leaves `Toolbar`.
- Add a `Prepare` button. Placement: `desktop-actions`, next to the `Details`
  toggle. Click:
  - desktop: `setRightPanelTab('prepare')` + `setSidebarVisible(true)`.
  - mobile (`matchMedia('(max-width: 767px)')`): `setRightPanelTab('prepare')` +
    `setMobileDrawer('details')`.
  Mirror the existing `togglePanel` mobile branch.
- `aria-pressed` on the Prepare button reflects
  `sidebarVisible && rightPanelTab === 'prepare'`.
- Keep the `Details` button; its click should also ensure
  `rightPanelTab === 'details'` when it opens the panel, so the two buttons are
  predictable. (Set tab to `'details'` on open.)

### App.tsx

- `<Toolbar />` - drop the `onUndoEdit` prop.
- `<Sidebar onUndoEdit={() => viewerRef.current?.undoEdit()} />` - add it here.
- Mobile right drawer already renders `<Sidebar mobile />`; add the same
  `onUndoEdit` prop there.
- `inert` expression unchanged (`solidEditorOpen` already included).

## Data flow

1. Model loads or an edit finishes -> `Viewer3D.updateGeometryDetails()` ->
   `setGeometryDetails(summed analyzeGeometry incl. degenerate/duplicate)`.
2. `ReadinessCard` re-renders on the store change, recomputes
   `prepChecks(details)`, updates rows. No explicit refresh wiring.
3. Fix button -> `handlers['seal']()` -> `setSolidEditorOpen(true)` ->
   `SolidEditorDialog` (rendered from `App.tsx`, unchanged) opens.
4. Make solid applies -> `Viewer3D` re-runs `updateGeometryDetails()` -> card
   reflects new counts. Undo (from `RepairSection`) -> same path.

## Error and edge handling

- No model (`geometryDetails === null`): Prepare tab selectable; panel shows the
  empty state; no rows, no crash.
- Multi-model scene: `geometryDetails` is already the summed analysis across
  scene meshes; the card reads the sum, consistent with the current Geometry
  readout.
- Make solid failure: handled inside `SolidEditorDialog` as today; card simply
  keeps showing pre-edit numbers.
- `canUndoEdit === false`: Undo button in `RepairSection` disabled, same as the
  old menu item.
- Switching tabs while a model is loading: allowed; card shows whatever
  `geometryDetails` currently is (may be `null` mid-load, i.e. empty state).

## Files touched

New:

- `src/services/prepChecks.ts`
- `src/services/prepChecks.test.ts`
- `src/components/prepare/PreparePanel.tsx`
- `src/components/prepare/PreparePanel.test.tsx`
- `src/components/prepare/ReadinessCard.tsx`
- `src/components/prepare/ReadinessCard.test.tsx`
- `src/components/prepare/RepairSection.tsx`
- `e2e/prepare-panel.spec.ts`

Modified:

- `src/store/viewerStore.ts` - `rightPanelTab` + setter; `degenerateFaces` /
  `duplicateFaces` on `GeometryDetails`.
- `src/store/viewerStore.test.ts` - cover the new field + setter.
- `src/components/Viewer3D.tsx` - include degenerate/duplicate in the summed
  `setGeometryDetails` payload.
- `src/components/Sidebar.tsx` - tab strip, body switch, `onUndoEdit` prop.
- `src/components/Sidebar.test.tsx` - tab switching, Prepare body renders.
- `src/components/Toolbar.tsx` - remove Edit menu, add Prepare button, drop
  `onUndoEdit` / `canUndoEdit`.
- `src/components/Toolbar.test.tsx` - no Edit menu; Prepare button behaviour.
- `src/App.tsx` - move `onUndoEdit` from Toolbar to Sidebar (desktop + mobile).
- `README.md` - Features list and "Editing and export": Edit menu -> Prepare panel.
- `CHANGELOG.md` - entry.

## Testing

Unit (Vitest):

- `prepChecks.test.ts`:
  - `null` -> 8 rows, all `unavailable`, no `fixId`.
  - watertight clean model -> `watertight/nonManifold/boundary/degenerate/
    duplicate` all `pass`; `thickness/overhangs/onPlate` `unavailable`.
  - `watertight: false`, `boundaryEdges: 6` -> `watertight` fail,
    `boundary` fail with `'6 open edges'`, both carry `fixId: 'seal'`.
  - `nonManifoldEdges: 3` -> `nonManifold` fail.
  - `degenerateFaces: 2`, `duplicateFaces: 1` -> those rows fail with the count.
  - Row order is stable and matches the table.
- `viewerStore.test.ts`: `rightPanelTab` defaults to `'details'`;
  `setRightPanelTab('prepare')` updates; `GeometryDetails` type carries the two
  new numeric fields (compile-level + a set/read round-trip).

Component (Testing Library):

- `ReadinessCard.test.tsx`: given store `geometryDetails` with a leak, a `Fix`
  button renders on the `watertight` row; clicking it calls `setSolidEditorOpen`
  (spy). `unavailable` rows show no `Fix`. State pip exposes text, not colour
  only.
- `PreparePanel.test.tsx`: `geometryDetails === null` -> empty state, no card;
  with details -> `ReadinessCard` + `RepairSection` present. `RepairSection`
  `Make solid` button calls `setSolidEditorOpen`; `Undo` button `disabled` when
  `canUndoEdit === false`, enabled and calls `onUndoEdit` when `true`.
- `Sidebar.test.tsx` (extend): default shows Details body ("File Info"); click
  `Prepare` tab -> Prepare body ("readiness" content) shows, Details body gone;
  `aria-selected` tracks; arrow keys move tab focus.
- `Toolbar.test.tsx` (extend): no element with `data-testid="toolbar-edit-menu"`;
  `Prepare` button present; clicking it (desktop viewport) sets
  `rightPanelTab === 'prepare'` and `sidebarVisible === true`.

E2E (Playwright), `e2e/prepare-panel.spec.ts`, mirroring
`make-solid-large.spec.ts`:

- Load a known-leaky fixture model.
- Click `Prepare` -> card visible, `Watertight` row shows fail.
- Click the row's `Fix` -> Make solid dialog opens; run it.
- Dialog closes / model updates -> `Watertight` row now `pass` (or boundary 0).
- `Undo last model edit` in the panel -> row returns to fail.

Verification command before claiming done: `pnpm test` (Vitest) green, plus
`pnpm test:e2e -- prepare-panel` for the new spec. `pnpm build` (tsc) clean for
the type changes.

## Rollout / docs

- `README.md`: replace "Edit models in place ... under the Edit menu" phrasing;
  document the Prepare panel tab and the readiness card. Keep the Make solid
  description (now reached from the panel).
- `CHANGELOG.md`: "Prepare panel replaces the Edit menu; adds a print-readiness
  score card."
- Version bump handled at release time, not in this plan.

## Open questions

None blocking. One to confirm during implementation: exact placement/label of
the `Prepare` button in `desktop-actions` vs adding it as a top-level menu
alongside File / View / Help. Default: a button in `desktop-actions` next to
`Details`, no menu. Revisit if the toolbar gets cramped on narrow desktop
widths.
