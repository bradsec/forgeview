# SP-1: Prepare Panel Shell + Readiness Score Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Edit menu with a tabbed Prepare panel in the right sidebar, and turn the raw mesh-health numbers into a print-readiness score card with per-check Fix shortcuts.

**Architecture:** A pure `prepChecks(details)` function maps `GeometryDetails` to an ordered list of check rows. New `src/components/prepare/` components render those rows plus a Repair section that hosts the existing Make solid launcher and the moved Undo action. The right `Sidebar` gains a two-tab strip (`Details | Prepare`) driven by a new `rightPanelTab` store field. The `Edit` toolbar menu is deleted; a `Prepare` toolbar button opens and focuses the tab. No geometry algorithms and no new dependencies.

**Tech Stack:** React 19, Three.js 0.185, Zustand 5, Tailwind (v4, CSS-var theme tokens), Vitest + Testing Library + `@testing-library/user-event`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30-sp1-prepare-panel-design.md` (roadmap context: `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`)

## Global Constraints

- No new dependencies. Nothing added to `package.json`.
- No changes to mesh processing logic in `meshHealth.ts` `analyzeGeometry`, `solidRepair.ts`, or `exteriorShell.ts`. Adding a pure aggregation helper next to `analyzeGeometry` is allowed.
- No multi-step undo. `Viewer3D`'s single `undoRef` stays as-is.
- `pnpm build` (runs `tsc` then `vite build`) must pass: all type changes complete, no `any`.
- `pnpm test` (Vitest) must pass. `pnpm test:e2e` must pass, including the new `e2e/prepare-panel.spec.ts`, which is the completion gate for this sub-project.
- Follow existing conventions: Tailwind classes with `var(--token)` colors, `data-testid` in kebab-case, components as named exports, tests co-located as `*.test.tsx` beside the component.
- Commit after every task with a `feat:` / `refactor:` / `test:` prefixed message. Do not push, tag, or open PRs.
- Author commits under the repo's configured git identity only. No AI attribution or co-author trailers.

---

## File Structure

New files:

- `src/services/prepChecks.ts` — pure `prepChecks(details: GeometryDetails | null): PrepCheck[]`. Owns the check list, order, and pass/warn/fail/unavailable rules.
- `src/services/prepChecks.test.ts` — unit tests for the above.
- `src/components/prepare/PreparePanel.tsx` — the Prepare tab body: empty state when no model, otherwise the section list (`ReadinessCard`, `RepairSection`) and the Fix handler map.
- `src/components/prepare/PreparePanel.test.tsx`
- `src/components/prepare/ReadinessCard.tsx` — renders one row per `PrepCheck`, with a Fix button when a handler exists.
- `src/components/prepare/ReadinessCard.test.tsx`
- `src/components/prepare/RepairSection.tsx` — Make solid launcher + Undo last model edit button. No test file of its own; covered by `PreparePanel.test.tsx`.
- `e2e/prepare-panel.spec.ts` — end-to-end: drop a leaky model, open Prepare, Fix, Make solid, Undo.

Modified files:

- `src/store/viewerStore.ts` — add `rightPanelTab` + `setRightPanelTab`; add `degenerateFaces` / `duplicateFaces` to `GeometryDetails`.
- `src/store/viewerStore.test.ts` — cover the new field default + setter.
- `src/services/meshHealth.ts` — add exported `summariseHealth(healths: MeshHealth[])` aggregation helper.
- `src/services/meshHealth.test.ts` — cover `summariseHealth`.
- `src/components/Viewer3D.tsx` — `updateGeometryDetails` uses `summariseHealth` and passes the two new fields.
- `src/components/Sidebar.tsx` — tab strip, body switch on `rightPanelTab`, new `onUndoEdit` prop.
- `src/components/Sidebar.test.tsx` — tab switching, Prepare body renders.
- `src/components/Toolbar.tsx` — remove `Edit` menu, remove `onUndoEdit` prop and `canUndoEdit` subscription, add `Prepare` button.
- `src/components/Toolbar.test.tsx` — drop the Edit-menu test, add a Prepare-button test.
- `src/App.tsx` — move `onUndoEdit` from `<Toolbar>` to both `<Sidebar>` instances.
- `e2e/make-solid-large.spec.ts` — launch Make solid from the Prepare panel instead of the Edit menu.
- `README.md` — Features list and "Editing and export": Edit menu -> Prepare panel.
- `CHANGELOG.md` — entry under an unreleased/next section.

---

## Task 1: Store — `rightPanelTab` and new `GeometryDetails` fields

**Files:**
- Modify: `src/store/viewerStore.ts` (`GeometryDetails` interface ~line 8-18; `ViewerState` interface; `create(...)` body)
- Test: `src/store/viewerStore.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `GeometryDetails` gains `degenerateFaces: number` and `duplicateFaces: number`.
  - Store field `rightPanelTab: 'details' | 'prepare'` (initial `'details'`).
  - Store action `setRightPanelTab: (tab: 'details' | 'prepare') => void`.

- [ ] **Step 1: Write the failing test**

Add to `src/store/viewerStore.test.ts` (new `describe` block, place near other store-field tests):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useViewerStore } from './viewerStore'

describe('rightPanelTab', () => {
  beforeEach(() => {
    useViewerStore.setState({ rightPanelTab: 'details' })
  })

  it('defaults to details', () => {
    expect(useViewerStore.getState().rightPanelTab).toBe('details')
  })

  it('setRightPanelTab switches the active tab', () => {
    useViewerStore.getState().setRightPanelTab('prepare')
    expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
    useViewerStore.getState().setRightPanelTab('details')
    expect(useViewerStore.getState().rightPanelTab).toBe('details')
  })

  it('GeometryDetails carries degenerate and duplicate face counts', () => {
    useViewerStore.getState().setGeometryDetails({
      width: 1, height: 1, depth: 1, vertices: 3, meshes: 1,
      boundaryEdges: 3, nonManifoldEdges: 0, degenerateFaces: 2, duplicateFaces: 1,
      watertight: false, modelUnitInMm: null,
    })
    const details = useViewerStore.getState().geometryDetails
    expect(details?.degenerateFaces).toBe(2)
    expect(details?.duplicateFaces).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: FAIL — `setRightPanelTab` is not a function; TypeScript also errors that `degenerateFaces` / `duplicateFaces` are not in `GeometryDetails`.

- [ ] **Step 3: Write minimal implementation**

In `src/store/viewerStore.ts`:

1. Extend the `GeometryDetails` interface:

```ts
export interface GeometryDetails {
  width: number
  height: number
  depth: number
  vertices: number
  meshes: number
  boundaryEdges: number
  nonManifoldEdges: number
  degenerateFaces: number
  duplicateFaces: number
  watertight: boolean
  modelUnitInMm: number | null
}
```

2. In the `ViewerState` interface, next to `mainView` / `mobileDrawer` fields, add:

```ts
  rightPanelTab: 'details' | 'prepare'
```

and next to `setMainView` / `setMobileDrawer` add:

```ts
  setRightPanelTab: (tab: 'details' | 'prepare') => void
```

3. In the `create<ViewerState>(...)` object, add the initial value near `mainView: 'grid' as const,`:

```ts
  rightPanelTab: 'details' as const,
```

and the action near `setMainView`:

```ts
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL only in `src/components/Viewer3D.tsx` (the `setGeometryDetails` call there does not yet supply `degenerateFaces` / `duplicateFaces`). That is fixed in Task 2. No other files should error.

- [ ] **Step 6: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: add rightPanelTab and degenerate/duplicate face counts to store"
```

---

## Task 2: `summariseHealth` helper and Viewer3D wiring

**Files:**
- Modify: `src/services/meshHealth.ts` (add export at end of file)
- Test: `src/services/meshHealth.test.ts`
- Modify: `src/components/Viewer3D.tsx` (`updateGeometryDetails`, ~line 113-141)

**Interfaces:**
- Consumes: `GeometryDetails` fields from Task 1; existing `MeshHealth` interface and `analyzeGeometry` from `meshHealth.ts`.
- Produces:
  - `summariseHealth(healths: MeshHealth[]): { vertices: number; boundaryEdges: number; nonManifoldEdges: number; degenerateFaces: number; duplicateFaces: number; watertight: boolean }` — sums counts across meshes; `watertight` is the logical AND, and is `false` for an empty array.

- [ ] **Step 1: Write the failing test**

Add to `src/services/meshHealth.test.ts`:

```ts
import { summariseHealth } from './meshHealth'
import type { MeshHealth } from './meshHealth'

const h = (over: Partial<MeshHealth>): MeshHealth => ({
  triangles: 0, vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0,
  duplicateFaces: 0, degenerateFaces: 0, watertight: true, ...over,
})

describe('summariseHealth', () => {
  it('sums counts across meshes', () => {
    const result = summariseHealth([
      h({ vertices: 10, boundaryEdges: 3, nonManifoldEdges: 1, degenerateFaces: 2, duplicateFaces: 0 }),
      h({ vertices: 5, boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 4 }),
    ])
    expect(result).toEqual({
      vertices: 15, boundaryEdges: 3, nonManifoldEdges: 1,
      degenerateFaces: 2, duplicateFaces: 4, watertight: true,
    })
  })

  it('watertight is the AND of every mesh', () => {
    expect(summariseHealth([h({ watertight: true }), h({ watertight: false })]).watertight).toBe(false)
  })

  it('watertight is false for no meshes', () => {
    expect(summariseHealth([]).watertight).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/meshHealth.test.ts`
Expected: FAIL — `summariseHealth` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/services/meshHealth.ts`:

```ts
/** Sum health counts across scene meshes. watertight is the logical AND and is
 * false when there are no meshes, matching "nothing loaded is not a solid". */
export function summariseHealth(healths: MeshHealth[]): {
  vertices: number
  boundaryEdges: number
  nonManifoldEdges: number
  degenerateFaces: number
  duplicateFaces: number
  watertight: boolean
} {
  return healths.reduce(
    (sum, item) => ({
      vertices: sum.vertices + item.vertices,
      boundaryEdges: sum.boundaryEdges + item.boundaryEdges,
      nonManifoldEdges: sum.nonManifoldEdges + item.nonManifoldEdges,
      degenerateFaces: sum.degenerateFaces + item.degenerateFaces,
      duplicateFaces: sum.duplicateFaces + item.duplicateFaces,
      watertight: sum.watertight && item.watertight,
    }),
    {
      vertices: 0, boundaryEdges: 0, nonManifoldEdges: 0,
      degenerateFaces: 0, duplicateFaces: 0, watertight: healths.length > 0,
    }
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/meshHealth.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into Viewer3D**

In `src/components/Viewer3D.tsx`:

1. Extend the import (currently `import { analyzeGeometry } from '../services/meshHealth'`):

```ts
import { analyzeGeometry, summariseHealth } from '../services/meshHealth'
```

2. Replace the inline `health` reduce inside `updateGeometryDetails` (the `const health = meshes.map(...).reduce(...)` statement) with:

```ts
    const health = summariseHealth(meshes.map((mesh) => analyzeGeometry(mesh.geometry)))
```

3. The `setGeometryDetails({ ... , ...health })` call now spreads the five count fields plus `watertight`; no further change is needed there because `...health` already carries `degenerateFaces` and `duplicateFaces`.

- [ ] **Step 6: Typecheck and run the affected suites**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (Task 1's remaining error is now resolved).

Run: `pnpm test -- src/components/Viewer3D.test.tsx src/services/meshHealth.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/meshHealth.ts src/services/meshHealth.test.ts src/components/Viewer3D.tsx
git commit -m "feat: aggregate degenerate and duplicate face counts into geometry details"
```

---

## Task 3: `prepChecks` pure function

**Files:**
- Create: `src/services/prepChecks.ts`
- Test: `src/services/prepChecks.test.ts`

**Interfaces:**
- Consumes: `GeometryDetails` type from `../store/viewerStore` (type-only import).
- Produces:
  - `type PrepCheckState = 'pass' | 'warn' | 'fail' | 'unavailable'`
  - `interface PrepCheck { id: string; label: string; state: PrepCheckState; detail: string; fixId?: string }`
  - `function prepChecks(details: GeometryDetails | null): PrepCheck[]` — always returns 8 rows in this fixed order: `watertight`, `nonManifold`, `boundary`, `degenerate`, `duplicate`, `thickness`, `overhangs`, `onPlate`.

Rules:
- `details === null`: every row `state: 'unavailable'`, `detail: 'Open a model'`, no `fixId`.
- `watertight`: `pass` + `'Sealed'` when `details.watertight`; else `fail` + `'Not watertight'`, `fixId: 'seal'`.
- `nonManifold`: `pass` + `'0 non-manifold edges'` when `nonManifoldEdges === 0`; else `fail` + `` `${n} non-manifold edges` ``, `fixId: 'seal'`.
- `boundary`: `pass` + `'0 open edges'` when `boundaryEdges === 0`; else `fail` + `` `${n} open edges` ``, `fixId: 'seal'`.
- `degenerate`: `pass` + `'0 degenerate faces'` when `degenerateFaces === 0`; else `fail` + `` `${n} degenerate faces` ``, `fixId: 'seal'`.
- `duplicate`: `pass` + `'0 duplicate faces'` when `duplicateFaces === 0`; else `fail` + `` `${n} duplicate faces` ``, `fixId: 'seal'`.
- `thickness` / `overhangs` / `onPlate` (model loaded or not): `state: 'unavailable'`, `detail: 'Available in a later update'`, no `fixId`.

- [ ] **Step 1: Write the failing test**

Create `src/services/prepChecks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prepChecks } from './prepChecks'
import type { GeometryDetails } from '../store/viewerStore'

const clean: GeometryDetails = {
  width: 10, height: 10, depth: 10, vertices: 100, meshes: 1,
  boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: true, modelUnitInMm: null,
}

const ORDER = ['watertight', 'nonManifold', 'boundary', 'degenerate', 'duplicate', 'thickness', 'overhangs', 'onPlate']

describe('prepChecks', () => {
  it('returns the fixed row order', () => {
    expect(prepChecks(clean).map((c) => c.id)).toEqual(ORDER)
    expect(prepChecks(null).map((c) => c.id)).toEqual(ORDER)
  })

  it('marks every row unavailable with no model', () => {
    for (const check of prepChecks(null)) {
      expect(check.state).toBe('unavailable')
      expect(check.detail).toBe('Open a model')
      expect(check.fixId).toBeUndefined()
    }
  })

  it('passes a clean watertight model on every computed row', () => {
    const byId = Object.fromEntries(prepChecks(clean).map((c) => [c.id, c]))
    for (const id of ['watertight', 'nonManifold', 'boundary', 'degenerate', 'duplicate']) {
      expect(byId[id].state).toBe('pass')
      expect(byId[id].fixId).toBeUndefined()
    }
  })

  it('keeps analysis rows unavailable even with a model', () => {
    const byId = Object.fromEntries(prepChecks(clean).map((c) => [c.id, c]))
    for (const id of ['thickness', 'overhangs', 'onPlate']) {
      expect(byId[id].state).toBe('unavailable')
      expect(byId[id].detail).toBe('Available in a later update')
      expect(byId[id].fixId).toBeUndefined()
    }
  })

  it('fails and offers seal for a leaky non-manifold model', () => {
    const leaky: GeometryDetails = {
      ...clean, watertight: false, boundaryEdges: 6, nonManifoldEdges: 3,
      degenerateFaces: 2, duplicateFaces: 1,
    }
    const byId = Object.fromEntries(prepChecks(leaky).map((c) => [c.id, c]))
    expect(byId.watertight.state).toBe('fail')
    expect(byId.watertight.detail).toBe('Not watertight')
    expect(byId.watertight.fixId).toBe('seal')
    expect(byId.boundary.detail).toBe('6 open edges')
    expect(byId.nonManifold.detail).toBe('3 non-manifold edges')
    expect(byId.degenerate.detail).toBe('2 degenerate faces')
    expect(byId.duplicate.detail).toBe('1 duplicate faces')
    for (const id of ['boundary', 'nonManifold', 'degenerate', 'duplicate']) {
      expect(byId[id].state).toBe('fail')
      expect(byId[id].fixId).toBe('seal')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/prepChecks.test.ts`
Expected: FAIL — module `./prepChecks` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/prepChecks.ts`:

```ts
import type { GeometryDetails } from '../store/viewerStore'

export type PrepCheckState = 'pass' | 'warn' | 'fail' | 'unavailable'

export interface PrepCheck {
  id: string
  label: string
  state: PrepCheckState
  detail: string
  fixId?: string
}

const ANALYSIS_ROWS: { id: string; label: string }[] = [
  { id: 'thickness', label: 'Thin walls' },
  { id: 'overhangs', label: 'Overhangs' },
  { id: 'onPlate', label: 'On build plate' },
]

function countRow(
  id: string,
  label: string,
  count: number,
  noun: string
): PrepCheck {
  return count === 0
    ? { id, label, state: 'pass', detail: `0 ${noun}` }
    : { id, label, state: 'fail', detail: `${count} ${noun}`, fixId: 'seal' }
}

/** Ordered print-readiness rows derived from mesh health. Rows whose analysis
 * ships in a later sub-project always return 'unavailable' here. */
export function prepChecks(details: GeometryDetails | null): PrepCheck[] {
  if (!details) {
    return [
      { id: 'watertight', label: 'Watertight' },
      { id: 'nonManifold', label: 'Manifold edges' },
      { id: 'boundary', label: 'Open edges' },
      { id: 'degenerate', label: 'Degenerate faces' },
      { id: 'duplicate', label: 'Duplicate faces' },
      ...ANALYSIS_ROWS,
    ].map((row) => ({ ...row, state: 'unavailable' as const, detail: 'Open a model' }))
  }

  return [
    details.watertight
      ? { id: 'watertight', label: 'Watertight', state: 'pass', detail: 'Sealed' }
      : { id: 'watertight', label: 'Watertight', state: 'fail', detail: 'Not watertight', fixId: 'seal' },
    countRow('nonManifold', 'Manifold edges', details.nonManifoldEdges, 'non-manifold edges'),
    countRow('boundary', 'Open edges', details.boundaryEdges, 'open edges'),
    countRow('degenerate', 'Degenerate faces', details.degenerateFaces, 'degenerate faces'),
    countRow('duplicate', 'Duplicate faces', details.duplicateFaces, 'duplicate faces'),
    ...ANALYSIS_ROWS.map((row) => ({
      ...row,
      state: 'unavailable' as const,
      detail: 'Available in a later update',
    })),
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/prepChecks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/prepChecks.ts src/services/prepChecks.test.ts
git commit -m "feat: add prepChecks readiness-row derivation"
```

---

## Task 4: Prepare panel components

**Files:**
- Create: `src/components/prepare/ReadinessCard.tsx`
- Create: `src/components/prepare/RepairSection.tsx`
- Create: `src/components/prepare/PreparePanel.tsx`
- Test: `src/components/prepare/ReadinessCard.test.tsx`
- Test: `src/components/prepare/PreparePanel.test.tsx`

**Interfaces:**
- Consumes: `prepChecks`, `PrepCheck` from `../../services/prepChecks`; `useViewerStore` (`geometryDetails`, `canUndoEdit`, `setSolidEditorOpen`).
- Produces:
  - `ReadinessCard(props: { checks: PrepCheck[]; onFix: (fixId: string) => void }): JSX.Element` — one row per check, `data-testid={`check-${id}`}` and `data-state={state}` on each row; a `Fix` button (`type="button"`) inside a row only when `check.fixId` is set.
  - `RepairSection(props: { onUndoEdit?: () => void }): JSX.Element` — a `Make solid…` button calling `setSolidEditorOpen(true)`, and an `Undo last model edit` button calling `props.onUndoEdit`, `disabled` unless `canUndoEdit`.
  - `PreparePanel(props: { onUndoEdit?: () => void }): JSX.Element` — reads `geometryDetails`; when `null` renders an empty state (`data-testid="prepare-empty"`, text "Open a model to run checks"); otherwise renders `ReadinessCard` (fed `prepChecks(details)` and an `onFix` that dispatches through a handler map) followed by `RepairSection`.

Handler map (inside `PreparePanel`):

```ts
const FIX_HANDLERS: Record<string, () => void> = {
  seal: () => useViewerStore.getState().setSolidEditorOpen(true),
}
```

- [ ] **Step 1: Write the failing tests**

Create `src/components/prepare/ReadinessCard.test.tsx`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadinessCard } from './ReadinessCard'
import type { PrepCheck } from '../../services/prepChecks'

const checks: PrepCheck[] = [
  { id: 'watertight', label: 'Watertight', state: 'fail', detail: 'Not watertight', fixId: 'seal' },
  { id: 'thickness', label: 'Thin walls', state: 'unavailable', detail: 'Available in a later update' },
]

describe('ReadinessCard', () => {
  it('renders a row per check with its state and detail', () => {
    render(<ReadinessCard checks={checks} onFix={vi.fn()} />)
    expect(screen.getByTestId('check-watertight').getAttribute('data-state')).toBe('fail')
    expect(screen.getByText('Not watertight')).toBeTruthy()
    expect(screen.getByTestId('check-thickness').getAttribute('data-state')).toBe('unavailable')
  })

  it('shows a Fix button only when the check has a fixId and calls onFix with it', async () => {
    const onFix = vi.fn()
    render(<ReadinessCard checks={checks} onFix={onFix} />)
    const rows = screen.getByTestId('check-watertight')
    await userEvent.click(within(rows).getByRole('button', { name: 'Fix' }))
    expect(onFix).toHaveBeenCalledWith('seal')
    expect(within(screen.getByTestId('check-thickness')).queryByRole('button', { name: 'Fix' })).toBeNull()
  })
})
```

Add the missing import at the top of that file:

```ts
import { within } from '@testing-library/react'
```

Create `src/components/prepare/PreparePanel.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreparePanel } from './PreparePanel'
import { useViewerStore } from '../../store/viewerStore'

const details = {
  width: 1, height: 1, depth: 1, vertices: 3, meshes: 1,
  boundaryEdges: 6, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
  watertight: false, modelUnitInMm: null,
}

beforeEach(() => {
  useViewerStore.setState({ geometryDetails: null, canUndoEdit: false, solidEditorOpen: false })
})

describe('PreparePanel', () => {
  it('shows the empty state when no model is loaded', () => {
    render(<PreparePanel />)
    expect(screen.getByTestId('prepare-empty')).toBeTruthy()
    expect(screen.queryByTestId('check-watertight')).toBeNull()
  })

  it('renders the readiness card and repair section when a model is loaded', () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<PreparePanel />)
    expect(screen.getByTestId('check-watertight').getAttribute('data-state')).toBe('fail')
    expect(screen.getByRole('button', { name: 'Make solid…' })).toBeTruthy()
  })

  it('a Fix on a seal row opens the Make solid dialog', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<PreparePanel />)
    await userEvent.click(within(screen.getByTestId('check-watertight')).getByRole('button', { name: 'Fix' }))
    expect(useViewerStore.getState().solidEditorOpen).toBe(true)
  })

  it('the Make solid button opens the dialog', async () => {
    useViewerStore.setState({ geometryDetails: details })
    render(<PreparePanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Make solid…' }))
    expect(useViewerStore.getState().solidEditorOpen).toBe(true)
  })

  it('Undo is disabled until an edit can be undone, then calls onUndoEdit', async () => {
    useViewerStore.setState({ geometryDetails: details })
    const onUndoEdit = vi.fn()
    const { rerender } = render(<PreparePanel onUndoEdit={onUndoEdit} />)
    expect(screen.getByRole('button', { name: 'Undo last model edit' })).toBeDisabled()
    useViewerStore.setState({ canUndoEdit: true })
    rerender(<PreparePanel onUndoEdit={onUndoEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Undo last model edit' }))
    expect(onUndoEdit).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/components/prepare/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

Create `src/components/prepare/ReadinessCard.tsx`:

```tsx
import type { PrepCheck, PrepCheckState } from '../../services/prepChecks'

const STATE_LABEL: Record<PrepCheckState, string> = {
  pass: 'OK',
  warn: 'Check',
  fail: 'Fix needed',
  unavailable: 'Not yet',
}

const STATE_CLASS: Record<PrepCheckState, string> = {
  pass: 'text-[var(--success,#15803d)]',
  warn: 'text-[var(--text-warning,#b45309)]',
  fail: 'text-[var(--error)]',
  unavailable: 'text-[var(--text-muted)]',
}

export function ReadinessCard({
  checks,
  onFix,
}: {
  checks: PrepCheck[]
  onFix: (fixId: string) => void
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Print readiness
      </h3>
      <ul className="mt-3 flex flex-col gap-2">
        {checks.map((check) => (
          <li
            key={check.id}
            data-testid={`check-${check.id}`}
            data-state={check.state}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex flex-col">
              <span className="text-[var(--text-primary)]">{check.label}</span>
              <span className="text-xs text-[var(--text-muted)]">{check.detail}</span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className={`text-xs font-medium ${STATE_CLASS[check.state]}`}>
                {STATE_LABEL[check.state]}
              </span>
              {check.fixId && (
                <button
                  type="button"
                  onClick={() => onFix(check.fixId!)}
                  className="px-2 py-0.5 rounded bg-[var(--bg-button)] text-xs"
                >
                  Fix
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Create `src/components/prepare/RepairSection.tsx`:

```tsx
import { useViewerStore } from '../../store/viewerStore'

export function RepairSection({ onUndoEdit }: { onUndoEdit?: () => void }) {
  const canUndoEdit = useViewerStore((s) => s.canUndoEdit)
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Repair
      </h3>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Fill the model into one sealed solid: interior geometry is removed, touching
        parts join under one skin, open edges on the outer surface are closed.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => useViewerStore.getState().setSolidEditorOpen(true)}
          className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start"
        >
          Make solid…
        </button>
        <button
          type="button"
          disabled={!canUndoEdit}
          onClick={() => onUndoEdit?.()}
          className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm self-start disabled:opacity-50"
        >
          Undo last model edit
        </button>
      </div>
    </div>
  )
}
```

Create `src/components/prepare/PreparePanel.tsx`:

```tsx
import { useViewerStore } from '../../store/viewerStore'
import { prepChecks } from '../../services/prepChecks'
import { ReadinessCard } from './ReadinessCard'
import { RepairSection } from './RepairSection'

const FIX_HANDLERS: Record<string, () => void> = {
  seal: () => useViewerStore.getState().setSolidEditorOpen(true),
}

export function PreparePanel({ onUndoEdit }: { onUndoEdit?: () => void }) {
  const details = useViewerStore((s) => s.geometryDetails)

  if (!details) {
    return (
      <p data-testid="prepare-empty" className="text-sm text-[var(--text-muted)]">
        Open a model to run checks.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <ReadinessCard
        checks={prepChecks(details)}
        onFix={(fixId) => FIX_HANDLERS[fixId]?.()}
      />
      <RepairSection onUndoEdit={onUndoEdit} />
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/components/prepare/`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/prepare/
git commit -m "feat: add Prepare panel with readiness card and repair section"
```

---

## Task 5: Tabbed Sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Test: `src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `PreparePanel` from `./prepare/PreparePanel`; store `rightPanelTab` / `setRightPanelTab` from Task 1.
- Produces: `Sidebar` accepts a new optional prop `onUndoEdit?: () => void`, forwarded to `PreparePanel`. A `role="tablist"` with two `role="tab"` buttons named `Details` and `Prepare`; the Details tab body keeps the current "Scene Models" + "File Info" + "Geometry" content, the Prepare tab body is `<PreparePanel onUndoEdit={onUndoEdit} />`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/Sidebar.test.tsx` a new `describe`:

```ts
describe('Sidebar tabs', () => {
  beforeEach(() => {
    useViewerStore.setState({
      sidebarVisible: true, mobileDrawer: 'none', rightPanelTab: 'details',
      fileName: 'model.stl', fileExtension: '.stl', fileSize: 10, triangleCount: 4,
      isLoading: false, error: null, loadedModels: [], filePath: '/m/model.stl',
      geometryDetails: null, canUndoEdit: false,
    })
  })

  it('shows the Details body by default', () => {
    render(<Sidebar />)
    expect(screen.getByText('File Info')).toBeTruthy()
    expect(screen.queryByTestId('prepare-empty')).toBeNull()
  })

  it('switches to the Prepare body when the Prepare tab is clicked', async () => {
    render(<Sidebar />)
    await userEvent.click(screen.getByRole('tab', { name: 'Prepare' }))
    expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
    expect(screen.getByTestId('prepare-empty')).toBeTruthy()
    expect(screen.queryByText('File Info')).toBeNull()
  })

  it('marks the active tab with aria-selected', async () => {
    render(<Sidebar />)
    expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true')
    await userEvent.click(screen.getByRole('tab', { name: 'Prepare' }))
    expect(screen.getByRole('tab', { name: 'Prepare' }).getAttribute('aria-selected')).toBe('true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/Sidebar.test.tsx`
Expected: FAIL — no `tab` role elements.

- [ ] **Step 3: Write minimal implementation**

In `src/components/Sidebar.tsx`:

1. Add imports:

```ts
import { useViewerStore } from '../store/viewerStore'
import { PreparePanel } from './prepare/PreparePanel'
```

2. Change the signature:

```ts
export function Sidebar({ mobile = false, onUndoEdit }: { mobile?: boolean; onUndoEdit?: () => void } = {}) {
```

3. Add a subscription near the other `useViewerStore` calls:

```ts
  const rightPanelTab = useViewerStore((s) => s.rightPanelTab)
```

4. Directly below the resize-handle block and above `{/* Scene Models section */}`, insert the tab strip:

```tsx
      <div role="tablist" aria-label="Right panel" className="flex border-b border-[var(--border)] px-2 pt-2 gap-1">
        {(['details', 'prepare'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={rightPanelTab === tab}
            onClick={() => useViewerStore.getState().setRightPanelTab(tab)}
            className={`px-3 py-1.5 text-sm rounded-t ${
              rightPanelTab === tab
                ? 'bg-[var(--bg-app)] text-[var(--text-bright)]'
                : 'text-[var(--text-label)]'
            }`}
          >
            {tab === 'details' ? 'Details' : 'Prepare'}
          </button>
        ))}
      </div>
```

5. Wrap the existing content. The current body is the "Scene Models" block, the separator, and the `File Info` / `Geometry` `<div className="p-4 ...">`. Wrap all three in:

```tsx
      {rightPanelTab === 'details' ? (
        <>
          {/* existing Scene Models block, separator, and File Info / Geometry div unchanged */}
        </>
      ) : (
        <div className="p-4 flex-1 overflow-y-auto">
          <PreparePanel onUndoEdit={onUndoEdit} />
        </div>
      )}
```

Leave the `close` button, resize handle, `aside` wrapper, width logic untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/components/Sidebar.test.tsx`
Expected: PASS (including the pre-existing mobile/geometry/desktop tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat: split the right sidebar into Details and Prepare tabs"
```

---

## Task 6: Toolbar — remove Edit menu, add Prepare button; App wiring

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/Toolbar.test.tsx`

**Interfaces:**
- Consumes: store `rightPanelTab` / `setRightPanelTab`, `sidebarVisible` / `setSidebarVisible`, `setMobileDrawer`; `Sidebar`'s new `onUndoEdit` prop from Task 5.
- Produces: `Toolbar` no longer takes `onUndoEdit` (signature becomes `Toolbar()` with no props). A `Prepare` button in `desktop-actions`; on click it opens the Prepare tab (desktop: `setRightPanelTab('prepare')` + `setSidebarVisible(true)`; narrow viewport: `setRightPanelTab('prepare')` + `setMobileDrawer('details')`).

- [ ] **Step 1: Update the failing test**

In `src/components/Toolbar.test.tsx`:

1. Delete the test `'opens model editing tools and invokes undo from the Edit menu'` entirely.

2. Add:

```ts
it('has no Edit menu', () => {
  render(<Toolbar />)
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
})

it('Prepare button opens the Prepare tab on a wide viewport', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  useViewerStore.setState({ filePath: '/m/model.stl', sidebarVisible: false, rightPanelTab: 'details' })
  render(<Toolbar />)
  await userEvent.click(screen.getByRole('button', { name: 'Prepare' }))
  expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
  expect(useViewerStore.getState().sidebarVisible).toBe(true)
})

it('Prepare button opens the details drawer on a narrow viewport', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  useViewerStore.setState({ filePath: '/m/model.stl', mobileDrawer: 'none', rightPanelTab: 'details' })
  render(<Toolbar />)
  await userEvent.click(screen.getByRole('button', { name: 'Prepare' }))
  expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
  expect(useViewerStore.getState().mobileDrawer).toBe('details')
})
```

3. In the top `beforeEach`, add `rightPanelTab: 'details'` to the `setState` call and add `sidebarVisible: true`already present — keep as is.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/Toolbar.test.tsx`
Expected: FAIL — `Prepare` button not found; and TypeScript error because the deleted test referenced `onUndoEdit` (already removed).

- [ ] **Step 3: Write minimal implementation**

In `src/components/Toolbar.tsx`:

1. Change the signature and drop the `canUndoEdit` subscription:

```ts
export function Toolbar() {
```

Remove the line `const canUndoEdit = useViewerStore((state) => state.canUndoEdit)`.

2. Delete the entire `<Menu label="Edit"> ... </Menu>` block from the `<nav className="app-menus">` list.

3. Add a `openPrepare` helper next to `togglePanel`:

```ts
  const openPrepare = () => {
    useViewerStore.getState().setRightPanelTab('prepare')
    if (window.matchMedia('(max-width: 767px)').matches) {
      useViewerStore.getState().setMobileDrawer('details')
      return
    }
    useViewerStore.getState().setSidebarVisible(true)
  }
```

4. In `<div className="desktop-actions">`, directly before the existing `Details` button, add:

```tsx
        <button
          type="button"
          aria-pressed={sidebarVisible && rightPanelTab === 'prepare'}
          onClick={openPrepare}
          className={`toolbar-action ${sidebarVisible && rightPanelTab === 'prepare' ? 'is-active' : ''}`}
        >
          Prepare
        </button>
```

5. Add the `rightPanelTab` subscription near the other `useViewerStore` calls:

```ts
  const rightPanelTab = useViewerStore((state) => state.rightPanelTab)
```

6. Update the existing `Details` button so the two are predictable: change its `onClick` to also set the tab:

```tsx
          onClick={() => {
            useViewerStore.getState().setRightPanelTab('details')
            useViewerStore.getState().setSidebarVisible(!sidebarVisible || rightPanelTab === 'prepare')
          }}
```

(Leave the `View` menu's `Details` item untouched.)

In `src/App.tsx`:

7. Change `<Toolbar onUndoEdit={() => viewerRef.current?.undoEdit()} />` to `<Toolbar />`.

8. Change `<Sidebar />` to `<Sidebar onUndoEdit={() => viewerRef.current?.undoEdit()} />`.

9. In the right `MobileDrawer`, change `<Sidebar mobile />` to `<Sidebar mobile onUndoEdit={() => viewerRef.current?.undoEdit()} />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/components/Toolbar.test.tsx`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `pnpm test`
Expected: PASS. If `App.test.tsx` or another suite referenced the Edit menu or `Toolbar`'s `onUndoEdit` prop, update those call sites the same way (search: `onUndoEdit`, `toolbar-edit-menu`, `Make solid` in `src/**/*.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/components/Toolbar.tsx src/components/Toolbar.test.tsx src/App.tsx
git commit -m "refactor: replace the Edit menu with a Prepare panel button"
```

---

## Task 7: End-to-end spec, existing e2e fix, and docs

**Files:**
- Create: `e2e/prepare-panel.spec.ts`
- Modify: `e2e/make-solid-large.spec.ts` (lines ~37-38 and ~74-75)
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the `Prepare` button, `check-*` rows, and `Make solid…` panel button from Tasks 4-6.
- Produces: no code interface; this task is the completion gate.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/prepare-panel.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

/** ASCII STL of a 20mm cube with the top (+Z) face removed: 10 triangles,
 * 4 open boundary edges, not watertight. Deterministic, no fixture file. */
function openBoxStl(): string {
  const s = 20
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ]
  const tris = [
    [0, 1, 2], [0, 2, 3],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ]
  let out = 'solid box\n'
  for (const [a, b, c] of tris) {
    out += 'facet normal 0 0 0\nouter loop\n'
    for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
    out += 'endloop\nendfacet\n'
  }
  return out + 'endsolid box\n'
}

async function dropOpenBox(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate((stl) => {
    const file = new File([stl], 'box.stl', { type: 'model/stl' })
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    window.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
  }, openBoxStl())
  await expect(page.getByRole('banner')).toContainText('box.stl')
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test.describe('Prepare panel', () => {
  test('reports a leak, fixes it with Make solid, and undoes', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Prepare flow verified on desktop')
    test.setTimeout(120_000)

    await dropOpenBox(page)

    await page.getByRole('button', { name: 'Prepare' }).click()
    const watertight = page.getByTestId('check-watertight')
    await expect(watertight).toHaveAttribute('data-state', 'fail')
    await expect(page.getByTestId('check-boundary')).toHaveAttribute('data-state', 'fail')

    await watertight.getByRole('button', { name: 'Fix' }).click()
    const dialog = page.getByRole('dialog', { name: 'Make solid' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Interior detection detail').selectOption('96')
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog.getByRole('definition').first()).toBeVisible({ timeout: 90_000 })
    await dialog.getByRole('button', { name: 'Close' }).click()

    await expect(page.getByTestId('check-boundary')).toHaveAttribute('data-state', 'pass')

    await page.getByRole('button', { name: 'Undo last model edit' }).click()
    await expect(page.getByTestId('check-boundary')).toHaveAttribute('data-state', 'fail')
  })
})
```

- [ ] **Step 2: Run the new e2e spec**

Run: `pnpm test:e2e -- prepare-panel`
Expected: PASS on the desktop project. If the Make solid completion wait is flaky, raise the `toBeVisible` timeout; do not weaken the `data-state` assertions.

- [ ] **Step 3: Fix the existing Make solid e2e**

In `e2e/make-solid-large.spec.ts`, both tests open the dialog with:

```ts
await page.getByRole('button', { name: 'Edit', exact: true }).click()
await page.getByRole('menuitem', { name: 'Make solid…' }).click()
```

Replace each occurrence with:

```ts
await page.getByRole('button', { name: 'Prepare' }).click()
await page.getByRole('button', { name: 'Make solid…' }).click()
```

- [ ] **Step 4: Run the existing e2e spec**

Run: `pnpm test:e2e -- make-solid-large`
Expected: PASS, or SKIP if there is no `test.stl` fixture at repo root (that is the pre-existing opt-in behavior).

- [ ] **Step 5: Update the docs**

In `README.md`:

- In the Features list, change
  `- Edit models in place with worker-backed Make solid processing, live progress, and one-level undo`
  to
  `- Prepare panel (right sidebar) with a print-readiness score card and worker-backed Make solid processing, live progress, and one-level undo`

- In the "Editing and export" section, change the sentence
  `Edit > Make solid fills the scene into one STL-style solid.`
  to
  `Prepare > Repair > Make solid fills the scene into one STL-style solid.`

- Add one sentence after that paragraph:
  `The Prepare panel's readiness card summarises watertightness, manifold and open edges, and degenerate or duplicate faces, with a Fix shortcut to Make solid; wall-thickness, overhang, and build-plate checks are listed but arrive in a later release.`

In `CHANGELOG.md`, add under the top (matching the file's existing format):

```
- Prepare panel replaces the Edit menu: a tabbed right sidebar with a
  print-readiness score card and the Make solid / undo actions.
```

- [ ] **Step 6: Full verification**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm build`
Expected: PASS (tsc clean, vite build succeeds).

Run: `pnpm test:e2e -- prepare-panel`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add e2e/prepare-panel.spec.ts e2e/make-solid-large.spec.ts README.md CHANGELOG.md
git commit -m "test: cover the Prepare panel end-to-end and update docs"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| `degenerateFaces` / `duplicateFaces` on `GeometryDetails` | Task 1 |
| Viewer3D feeds the new fields | Task 2 (`summariseHealth` + wiring) |
| `prepChecks.ts` pure function, 8 rows, order, null handling, unavailable analysis rows | Task 3 |
| `PreparePanel` / `ReadinessCard` / `RepairSection`, Fix handler map (`seal`) | Task 4 |
| Empty state when no model | Task 4 (`prepare-empty`) |
| `rightPanelTab` store field | Task 1 |
| Tabbed Sidebar, `onUndoEdit` prop, Details body unchanged | Task 5 |
| Remove Edit menu, add Prepare button (desktop + narrow), drop `onUndoEdit`/`canUndoEdit` from Toolbar | Task 6 |
| App.tsx moves `onUndoEdit` to both Sidebar instances | Task 6 |
| Undo stays single-level (`undoRef` untouched) | (no task touches it — constraint honored) |
| Unit tests: prepChecks, ReadinessCard, PreparePanel, Sidebar tabs, Toolbar | Tasks 3-6 |
| e2e `prepare-panel.spec.ts` | Task 7 |
| README + CHANGELOG | Task 7 |
| `make-solid-large.spec.ts` launch path fix (implied by menu removal) | Task 7 |

No gaps.

**2. Placeholder scan:** No TBD/TODO. Every code step has literal code. Test steps include full test bodies.

**3. Type consistency:**
- `PrepCheck` / `PrepCheckState` defined in Task 3, imported unchanged in Task 4.
- `prepChecks(details)` signature identical across Tasks 3, 4.
- `summariseHealth` return shape in Task 2 matches the fields spread into `setGeometryDetails` and the `GeometryDetails` additions in Task 1 (`vertices`, `boundaryEdges`, `nonManifoldEdges`, `degenerateFaces`, `duplicateFaces`, `watertight`).
- `rightPanelTab` union `'details' | 'prepare'` identical in Tasks 1, 5, 6.
- `Sidebar` prop `onUndoEdit?: () => void` defined in Task 5, supplied in Task 6.
- Fix id string `'seal'` consistent between `prepChecks` (Task 3) and `FIX_HANDLERS` (Task 4).
- e2e selectors (`check-watertight`, `check-boundary`, button names `Prepare`, `Make solid…`, `Undo last model edit`, `Fix`) match the `data-testid` and button text in Tasks 4-6.

One note for the executor: Task 6 Step 1 item 3 mentions the `beforeEach` already sets `sidebarVisible: true`; only add `rightPanelTab: 'details'`. If `src/App.test.tsx` exists and imports `Toolbar` with `onUndoEdit`, fix it in Task 6 Step 5.
