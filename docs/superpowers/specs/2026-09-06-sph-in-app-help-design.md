# SP-H: In-app feature help

Status: approved design, 2026-09-06. Not a numbered roadmap sub-project; a
cross-cutting addition prompted by the user ("ensure help pages and
information is being included in web ui regarding any new features"). Slots
in before SP-4b. Every subsequent SP adds its own entry to the help content
as a plan task.

## Purpose

The Prepare panel has grown a lot of tools (SP-1 readiness card, SP-2 Repair
/ Split, SP-3 Measure / Scale / Transform, SP-4a Overhang heatmap) with no
in-app explanation of what any of them do. Add a single, scannable
feature-guide modal reachable from the existing Help menu, plus the
convention that each future SP appends its section.

## Current state (relevant slice)

- `src/components/Toolbar.tsx` already has a `Menu label="Help"` with a
  "File support" heading/note and an "About Forgeview" item that opens an
  inline `role="dialog"` "about-dialog" (`aboutOpen` local state, backdrop
  mousedown + `Escape` close, `autoFocus` on the Close button).
- `src/App.tsx` renders `<SettingsModal />`, `<ExportDialog />`,
  `<RepairDialog />` and sets `inert` on the main content while
  `settingsOpen || repairDialogOpen` (and the mobile drawer) is true.
- `src/store/viewerStore.ts` holds `settingsOpen` / `setSettingsOpen` and
  `repairDialogOpen` / `setRepairDialogOpen` as the established modal-toggle
  pattern.
- No jest-dom in this repo. Component tests use vitest/RTL-core.

## Decisions (locked 2026-09-06)

### One static guide modal, opened from the Help menu

- New `src/components/HelpModal.tsx`: a `role="dialog" aria-modal="true"`
  overlay, same lightweight shape as the About dialog (backdrop click +
  `Escape` close, `autoFocus` on a Close button), rendered from `App.tsx`
  alongside the other modals. Not a route, not a separate page, no markdown
  renderer, no search.
- New store state `helpOpen: boolean` (default `false`) + `setHelpOpen`,
  mirroring `settingsOpen`. `App.tsx` adds `helpOpen` to its `inert`
  condition so the modal behaves like the others.
- `Toolbar.tsx` Help menu gains a `<MenuItem>` "Feature guide" above "About
  Forgeview" that calls `setHelpOpen(true)`.

### Content is a data array, one entry per tool

`HelpModal.tsx` renders from a local `const HELP_SECTIONS: { title: string;
body: string }[]` array, each entry a short `<section>` with an `<h3>` and
one or two plain sentences. Initial entries, in Prepare-panel order:

1. **Readiness checks** - the card at the top of the Prepare panel runs
   each check against the open model and shows pass / warn / needs-fix.
   Rows with a Fix button open the tool that resolves them.
2. **Repair** - fills the model into one sealed solid, or runs individual
   stages (weld, drop bad faces, unify normals, remove small shells, fill
   holes). "Fill a single hole" lets you pick one open loop in the
   viewport.
3. **Split into parts** - separates a multi-body model into individually
   named, toggleable, separately exportable parts. Undo recombines them.
4. **Measure** - click two points on the model to read the straight-line
   distance in the current display unit.
5. **Scale** - resize the model so one dimension hits a target length, or
   so the whole model fits a configured build volume.
6. **Transform** - nudge the model by an offset, angle, or per-axis factor;
   mirror it; drop it to the floor; or center it on the plate. Each is one
   undoable step.
7. **Overhang heatmap** - highlights faces that point steeply downward past
   the overhang angle, the surfaces that would need print supports. The
   Overhangs readiness row reflects the same threshold.

Every future SP adds one `{ title, body }` entry here as part of its own
plan (SP-4b: wall thickness; SP-4c: X-ray / clipping; etc.).

### No per-widget tooltips this cycle

The guide modal is the whole feature. Inline `?` affordances next to each
section are a possible later enhancement and are out of scope.

## Architecture

### New files

| File | Responsibility |
|------|----------------|
| `src/components/HelpModal.tsx` | The feature-guide dialog. Renders `HELP_SECTIONS`. Closes on backdrop / Escape / Close button. Returns `null` when `!helpOpen`. |

### Modified files

| File | Change |
|------|--------|
| `src/store/viewerStore.ts` | `helpOpen: boolean` (default `false`), `setHelpOpen(open: boolean)`. |
| `src/components/Toolbar.tsx` | Help menu: add `<MenuItem onClick={() => { close(); useViewerStore.getState().setHelpOpen(true) }}>Feature guide</MenuItem>` above "About Forgeview". |
| `src/App.tsx` | Import + render `<HelpModal />`; add `helpOpen` to the `inert` expression on the main content wrapper. |

No change to `viewerStore`'s `setFile` reset list - `helpOpen` is a
UI-chrome flag unrelated to the loaded model, same as `settingsOpen`.

### Data flow

```
Toolbar Help menu -> "Feature guide" -> store.setHelpOpen(true)
  -> App re-renders, main content goes inert, <HelpModal> mounts its dialog
  -> user reads HELP_SECTIONS
  -> Close button / Escape / backdrop mousedown -> setHelpOpen(false) -> unmounts
```

### Error handling

None specific. The modal has no inputs, no async, no dependency on a loaded
model (the guide is useful before opening anything).

## Testing

- `HelpModal.test.tsx` (vitest / RTL-core, no jest-dom):
  - returns nothing when `helpOpen` is false (`screen.queryByRole('dialog')`
    is null).
  - when `helpOpen` is true: renders a `role="dialog"`, shows every
    `HELP_SECTIONS` title as a heading, and the Close button calls
    `setHelpOpen(false)`.
  - `Escape` key calls `setHelpOpen(false)`.
- `Toolbar.test.tsx` (extend): the Help menu contains a "Feature guide" item
  that calls `setHelpOpen(true)`.
- E2e `e2e/help-modal.spec.ts` (hard gate, style of the other panel specs):
  open the Help menu, click "Feature guide", assert the dialog is visible
  and contains the "Overhang heatmap" and "Repair" headings, press `Escape`,
  assert it is gone.

## Non-goals / carry-forward

- Per-section inline `?` popovers.
- Any content beyond short prose (no images, no animated demos, no
  markdown).
- Persisting "seen the guide" state / first-run auto-open.
- A dedicated `/help` route or standalone page.
- **Convention going forward:** each SP's implementation plan includes a
  task to append its `{ title, body }` entry to `HELP_SECTIONS`, so the
  guide never lags the shipped feature set. SP-4b is the first to carry
  this.
