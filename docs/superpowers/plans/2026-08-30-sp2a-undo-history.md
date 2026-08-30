# SP-2a: Undo History Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Viewer3D's single-slot model-edit undo with a bounded 5-entry history, surfaced as a clickable list in the Prepare panel.

**Architecture:** `Viewer3D` keeps `undoStackRef: UndoEntry[]` (label + apply + discard closures, same closure style as today). Applying an edit pushes; over 5, the oldest is shifted and disposed. `undoEdit(steps)` pops and applies `steps` entries. Labels sync to a new `undoLabels: string[]` store field that drives the panel list; `canUndoEdit` stays and is kept in sync. No new worker, algorithm, or persistence.

**Tech Stack:** React 19, Three.js 0.185, Zustand 5, Tailwind v4 (CSS-var tokens), Vitest + @testing-library/react + userEvent, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30-sp2a-undo-history-design.md`

## Global Constraints

- No new dependencies.
- No jest-dom matchers (`toBeDisabled`, `toBeInTheDocument`, ...). Use plain assertions / store reads, as existing tests do.
- `pnpm exec tsc --noEmit` zero errors after every task.
- `pnpm test` (Vitest) passes; `pnpm test:e2e -- prepare-panel` passes at the end; `pnpm build` clean at the end.
- `MAX_UNDO = 5` (module constant in Viewer3D).
- `undoLabels` is newest-edit-first.
- Match existing conventions: named exports, Tailwind `var(--token)` classes, `data-testid` kebab-case, tests co-located `*.test.tsx`.
- Commit after each task, `feat:` / `refactor:` / `test:` prefix. No push/tag/PR. Author under the repo git identity only; no AI attribution or co-author trailers.

---

## File Structure

Modified:

- `src/store/viewerStore.ts` — `undoLabels: string[]` + `setUndoLabels`.
- `src/store/viewerStore.test.ts` — new field default + setter.
- `src/services/undoStack.ts` — NEW, tiny: pure `clampUndoSteps(steps, length)` helper so the clamp math is unit-testable without WebGL.
- `src/services/undoStack.test.ts` — NEW.
- `src/components/Viewer3D.tsx` — `undoStackRef`, `MAX_UNDO`, `pushUndo`, `syncUndoLabels`, `clearUndo` over all entries, `undoEdit(steps)`, `Viewer3DHandle.undoEdit` type, `makeSolid` pushes instead of assigning the single slot.
- `src/components/prepare/RepairSection.tsx` — undo history list; prop type `onUndoEdit?: (steps?: number) => void`.
- `src/components/prepare/PreparePanel.tsx` — prop type only.
- `src/components/prepare/PreparePanel.test.tsx` — undo list render + click step-count.
- `src/components/Sidebar.tsx` — prop type only.
- `src/App.tsx` — pass `steps` through on both `<Sidebar>` instances.
- `e2e/prepare-panel.spec.ts` — undo-history row after Make solid, click reverts.
- `README.md`, `CHANGELOG.md` — undo wording.

---

## Task 1: Store — `undoLabels`

**Files:**
- Modify: `src/store/viewerStore.ts` (`ViewerState` interface near `canUndoEdit`; `create(...)` body)
- Test: `src/store/viewerStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: store field `undoLabels: string[]` (initial `[]`), action `setUndoLabels: (labels: string[]) => void`. `canUndoEdit` unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/store/viewerStore.test.ts`:

```ts
describe('undoLabels', () => {
  beforeEach(() => {
    useViewerStore.setState({ undoLabels: [], canUndoEdit: false })
  })

  it('defaults to an empty array', () => {
    expect(useViewerStore.getState().undoLabels).toEqual([])
  })

  it('setUndoLabels replaces the list', () => {
    useViewerStore.getState().setUndoLabels(['Make solid'])
    expect(useViewerStore.getState().undoLabels).toEqual(['Make solid'])
    useViewerStore.getState().setUndoLabels(['Weld vertices', 'Make solid'])
    expect(useViewerStore.getState().undoLabels).toEqual(['Weld vertices', 'Make solid'])
  })

  it('setUndoLabels does not touch canUndoEdit', () => {
    useViewerStore.setState({ canUndoEdit: true })
    useViewerStore.getState().setUndoLabels([])
    expect(useViewerStore.getState().canUndoEdit).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: FAIL — `setUndoLabels` is not a function; TS error that `undoLabels` is missing.

- [ ] **Step 3: Write minimal implementation**

In `src/store/viewerStore.ts`:

1. In `ViewerState`, next to `canUndoEdit: boolean`:

```ts
  undoLabels: string[]
```

next to `setCanUndoEdit`:

```ts
  setUndoLabels: (labels: string[]) => void
```

2. In `create<ViewerState>(...)`, next to `canUndoEdit: false,`:

```ts
  undoLabels: [],
```

next to `setCanUndoEdit: (canUndo) => set({ canUndoEdit: canUndo }),`:

```ts
  setUndoLabels: (labels) => set({ undoLabels: labels }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/store/viewerStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no consumer requires the field yet).

- [ ] **Step 6: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: add undoLabels to the viewer store"
```

---

## Task 2: Viewer3D — bounded undo stack

**Files:**
- Create: `src/services/undoStack.ts`
- Test: `src/services/undoStack.test.ts`
- Modify: `src/components/Viewer3D.tsx`

**Interfaces:**
- Consumes: `undoLabels` / `setUndoLabels` (Task 1); `setCanUndoEdit`.
- Produces:
  - `src/services/undoStack.ts`: `export const MAX_UNDO = 5` and
    `export function clampUndoSteps(steps: number, length: number): number` —
    returns `0` when `length <= 0`; otherwise `Math.min(Math.max(1, Math.floor(steps)), length)`.
  - `Viewer3DHandle.undoEdit: (steps?: number) => void`.
  - Internal (not exported): `undoStackRef`, `pushUndo`, `syncUndoLabels`, revised `clearUndo`.

- [ ] **Step 1: Write the failing test (pure helper)**

Create `src/services/undoStack.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { clampUndoSteps, MAX_UNDO } from './undoStack'

describe('clampUndoSteps', () => {
  it('MAX_UNDO is 5', () => {
    expect(MAX_UNDO).toBe(5)
  })

  it('returns 0 for an empty stack regardless of steps', () => {
    expect(clampUndoSteps(1, 0)).toBe(0)
    expect(clampUndoSteps(3, 0)).toBe(0)
  })

  it('clamps to at least 1 when the stack is non-empty', () => {
    expect(clampUndoSteps(0, 3)).toBe(1)
    expect(clampUndoSteps(-2, 3)).toBe(1)
  })

  it('clamps to the stack length', () => {
    expect(clampUndoSteps(9, 3)).toBe(3)
    expect(clampUndoSteps(2, 3)).toBe(2)
  })

  it('floors fractional steps', () => {
    expect(clampUndoSteps(2.9, 5)).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/services/undoStack.test.ts`
Expected: FAIL — module `./undoStack` not found.

- [ ] **Step 3: Write the helper**

Create `src/services/undoStack.ts`:

```ts
/** Deepest undo history kept in memory. Each entry retains the pre-edit
 * geometry, so the ceiling bounds worst-case memory on large models. */
export const MAX_UNDO = 5

/** Number of edits an undo request should actually roll back: 0 when nothing
 * is stacked, otherwise the request floored into [1, length]. */
export function clampUndoSteps(steps: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(1, Math.floor(steps)), length)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/services/undoStack.test.ts`
Expected: PASS.

- [ ] **Step 5: Rework Viewer3D's undo**

In `src/components/Viewer3D.tsx`:

1. Add to the imports near the other `../services/*` imports:

```ts
import { MAX_UNDO, clampUndoSteps } from '../services/undoStack'
```

2. Change the handle type (line ~33 in the `Viewer3DHandle` interface):

```ts
  undoEdit: (steps?: number) => void
```

3. Replace the ref declaration (line ~104):

```ts
  const undoStackRef = useRef<{ label: string; apply: () => void; discard: () => void }[]>([])
```

4. Replace `clearUndo` (lines ~169-173) with:

```ts
  const syncUndoLabels = () => {
    const labels = undoStackRef.current.map((entry) => entry.label).reverse()
    useViewerStore.getState().setUndoLabels(labels)
    useViewerStore.getState().setCanUndoEdit(labels.length > 0)
  }
  const pushUndo = (entry: { label: string; apply: () => void; discard: () => void }) => {
    undoStackRef.current.push(entry)
    while (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift()!.discard()
    syncUndoLabels()
  }
  const clearUndo = () => {
    for (const entry of undoStackRef.current) entry.discard()
    undoStackRef.current = []
    syncUndoLabels()
  }
```

5. In `makeSolid` (lines ~239-274): DELETE the `clearUndo()` call at the top of
   the try block (stacking replaces clearing on a new edit). Keep building
   `originals` / `originalMaterial` / `solidMaterial` and the geometry+material
   swap exactly as now. Replace:

```ts
      undoRef.current = {
        apply: () => { ... },
        discard: () => { ... },
      }
      useViewerStore.getState().setCanUndoEdit(true)
```

   with:

```ts
      pushUndo({
        label: 'Make solid',
        apply: () => {
          meshes.forEach((mesh, index) => { mesh.geometry.dispose(); mesh.geometry = originals[index] })
          meshes[0].material = originalMaterial
          solidMaterial.dispose()
        },
        discard: () => {
          originals.forEach((geometry) => geometry.dispose())
          for (const material of Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial]) material.dispose()
        },
      })
```

   (The two closures are the same bodies that were in `undoRef.current`.)

6. Replace `undoEdit` (lines ~276-289):

```ts
    undoEdit: (steps = 1) => {
      const n = clampUndoSteps(steps, undoStackRef.current.length)
      for (let i = 0; i < n; i++) undoStackRef.current.pop()!.apply()
      syncUndoLabels()
      const roots = modelRoots()
      for (const root of roots) applyViewMode(root, useViewerStore.getState().viewMode)
      updateTriangleDetails()
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
```

7. The other two `clearUndo()` call sites (preview load ~498, scene-id change
   ~662) are unchanged — `clearUndo` still exists with the same name and
   no-arg signature.

- [ ] **Step 6: Typecheck and run the unit suite**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm test -- src/services/undoStack.test.ts src/components/Viewer3D.test.tsx src/store/viewerStore.test.ts`
Expected: PASS. (Existing Viewer3D tests target exported pure helpers and the no-WebGL error path; none touch the undo ref.)

- [ ] **Step 7: Commit**

```bash
git add src/services/undoStack.ts src/services/undoStack.test.ts src/components/Viewer3D.tsx
git commit -m "feat: bounded undo history stack in Viewer3D"
```

---

## Task 3: Prop threading + RepairSection undo list

**Files:**
- Modify: `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/prepare/PreparePanel.tsx`, `src/components/prepare/RepairSection.tsx`
- Test: `src/components/prepare/PreparePanel.test.tsx`

**Interfaces:**
- Consumes: `undoEdit(steps?)` handle (Task 2); `undoLabels` store field (Task 1).
- Produces: `onUndoEdit?: (steps?: number) => void` prop threaded App -> Sidebar -> PreparePanel -> RepairSection. RepairSection renders `data-testid="undo-history"` list when `undoLabels.length > 0`; row `k` (newest = 0) button calls `onUndoEdit(k + 1)`.

- [ ] **Step 1: Write the failing tests**

In `src/components/prepare/PreparePanel.test.tsx` add:

```ts
describe('PreparePanel undo history', () => {
  const details = {
    width: 1, height: 1, depth: 1, vertices: 3, meshes: 1,
    boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, duplicateFaces: 0,
    watertight: true, modelUnitInMm: null,
  }
  beforeEach(() => {
    useViewerStore.setState({
      geometryDetails: details, filePath: '/m/model.stl', loadedModels: [],
      canUndoEdit: false, undoLabels: [],
    })
  })

  it('shows no undo history list when there are no entries', () => {
    render(<PreparePanel />)
    expect(screen.queryByTestId('undo-history')).toBeNull()
    expect((screen.getByRole('button', { name: 'Undo last model edit' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders one row per undo label, newest first, and reverts to that depth on click', async () => {
    const onUndoEdit = vi.fn()
    useViewerStore.setState({ canUndoEdit: true, undoLabels: ['Weld vertices', 'Make solid'] })
    render(<PreparePanel onUndoEdit={onUndoEdit} />)
    const list = screen.getByTestId('undo-history')
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Weld vertices')
    expect(rows[1]).toHaveTextContent('Make solid')
    await userEvent.click(rows[0])
    expect(onUndoEdit).toHaveBeenLastCalledWith(1)
    await userEvent.click(rows[1])
    expect(onUndoEdit).toHaveBeenLastCalledWith(2)
  })

  it('the Undo last model edit button undoes one step', async () => {
    const onUndoEdit = vi.fn()
    useViewerStore.setState({ canUndoEdit: true, undoLabels: ['Make solid'] })
    render(<PreparePanel onUndoEdit={onUndoEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Undo last model edit' }))
    expect(onUndoEdit).toHaveBeenCalledWith(1)
  })
})
```

Ensure `within` is imported from `@testing-library/react` in that file (SP-1 merged it into the first import — keep that).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/components/prepare/PreparePanel.test.tsx`
Expected: FAIL — no `undo-history` testid; button currently calls `onUndoEdit?.()` with no arg so `toHaveBeenCalledWith(1)` fails.

- [ ] **Step 3: Implement**

`src/components/prepare/RepairSection.tsx` — full new content:

```tsx
import { useViewerStore } from '../../store/viewerStore'

export function RepairSection({ onUndoEdit }: { onUndoEdit?: (steps?: number) => void }) {
  const canUndoEdit = useViewerStore((s) => s.canUndoEdit)
  const undoLabels = useViewerStore((s) => s.undoLabels)
  const hasModel = useViewerStore((s) => s.filePath !== null || s.loadedModels.length > 0)
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
          disabled={!hasModel}
          onClick={() => useViewerStore.getState().setSolidEditorOpen(true)}
          className="px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
        >
          Make solid…
        </button>
        <button
          type="button"
          disabled={!canUndoEdit}
          onClick={() => onUndoEdit?.(1)}
          className="px-3 py-1.5 rounded bg-[var(--bg-button)] text-sm self-start disabled:opacity-50"
        >
          Undo last model edit
        </button>
      </div>
      {undoLabels.length > 0 && (
        <ol data-testid="undo-history" className="mt-3 flex flex-col gap-1">
          {undoLabels.map((label, index) => (
            <li key={`${index}-${label}`}>
              <button
                type="button"
                onClick={() => onUndoEdit?.(index + 1)}
                aria-label={`Undo ${index + 1} step${index === 0 ? '' : 's'}: ${label}`}
                className="w-full text-left px-2 py-1 rounded text-xs text-[var(--text-primary)] hover:bg-[var(--bg-button)]"
              >
                {label}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
```

`src/components/prepare/PreparePanel.tsx` — change the prop type only:

```tsx
export function PreparePanel({ onUndoEdit }: { onUndoEdit?: (steps?: number) => void }) {
```

`src/components/Sidebar.tsx` line ~20 — prop type only:

```tsx
export function Sidebar({ mobile = false, onUndoEdit }: { mobile?: boolean; onUndoEdit?: (steps?: number) => void } = {}) {
```

`src/App.tsx` lines ~105, ~112 — both `<Sidebar>`:

```tsx
        <Sidebar onUndoEdit={(steps) => viewerRef.current?.undoEdit(steps)} />
```

```tsx
        <Sidebar mobile onUndoEdit={(steps) => viewerRef.current?.undoEdit(steps)} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/components/prepare/PreparePanel.test.tsx`
Expected: PASS. Then `pnpm test` (full unit suite) — expected PASS; if a pre-existing PreparePanel/RepairSection test asserted `onUndoEdit` called with no args, update it to `.toHaveBeenCalledWith(1)` (the button now passes an explicit `1`).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx src/components/prepare/PreparePanel.tsx src/components/prepare/RepairSection.tsx src/components/prepare/PreparePanel.test.tsx
git commit -m "feat: undo history list in the Repair section"
```

---

## Task 4: e2e + docs

**Files:**
- Modify: `e2e/prepare-panel.spec.ts`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the `undo-history` list and step-click behavior from Task 3, the stack from Task 2.
- Produces: none.

- [ ] **Step 1: Extend the e2e spec**

In `e2e/prepare-panel.spec.ts`, in the existing test that drops the open box and runs Make solid via the card `Fix`: after the block that closes the Make solid dialog and asserts `check-boundary` is `pass`, and BEFORE (or replacing) the current `Undo last model edit` button click, add:

```ts
    // Undo history now has exactly one entry for the seal.
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await expect(history.getByRole('button')).toHaveText(['Make solid'])

    // Clicking the entry reverts the seal.
    await history.getByRole('button', { name: /Make solid/ }).click()
    await expect(page.getByTestId('check-boundary').filter({ visible: true }))
      .toHaveAttribute('data-state', 'fail')
    await expect(page.getByTestId('undo-history').filter({ visible: true })).toHaveCount(0)
```

If the test already has a trailing "click Undo last model edit -> row returns to fail" section, replace that section with the block above (it asserts the same revert, through the list). Keep the `.filter({ visible: true })` convention the spec already uses for the double-mounted sidebar.

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm test:e2e -- prepare-panel`
Expected: PASS on desktop. If the history locator matches two nodes (double-mount), confirm `.filter({ visible: true })` is applied to every `getByTestId('undo-history')` in the new block.

- [ ] **Step 3: Update docs**

`README.md`: find the undo wording. The Features list bullet added in SP-1 reads
`Prepare panel (right sidebar) with a print-readiness score card and worker-backed Make solid processing, live progress, and one-level undo`.
Change `one-level undo` to `up to 5 steps of undo`. In "Editing and export", if a sentence says "one-level undo" or "Undo restores the original geometry", change it to note the Prepare panel keeps the last 5 model edits and each can be stepped back from the undo list.

`CHANGELOG.md`: under the existing `## Unreleased` heading, add:

```
- Undo history: the Prepare panel keeps the last 5 model edits; click any entry
  in the undo list to step back to that point.
```

- [ ] **Step 4: Full verification**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm build`
Expected: PASS.

Run: `pnpm test:e2e -- prepare-panel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/prepare-panel.spec.ts README.md CHANGELOG.md
git commit -m "test: cover the undo history list end-to-end and update docs"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item | Task |
|-----------|------|
| `undoLabels` + `setUndoLabels`, newest first | Task 1 |
| `UndoEntry` stack, `MAX_UNDO = 5`, `pushUndo` with shift+discard over the cap | Task 2 |
| `clearUndo` disposes all entries | Task 2 |
| `undoEdit(steps)` pop+apply with clamp, then refresh | Task 2 |
| `clampUndoSteps` pure + tested | Task 2 |
| `makeSolid` pushes `"Make solid"` instead of assigning one slot; no pre-clear | Task 2 |
| `Viewer3DHandle.undoEdit` type -> `(steps?: number) => void` | Task 2 |
| Prop threading App -> Sidebar -> PreparePanel -> RepairSection as `(steps?: number) => void` | Task 3 |
| RepairSection `undo-history` list, newest first, row `k` -> `onUndoEdit(k+1)` | Task 3 |
| "Undo last model edit" button -> `onUndoEdit(1)` | Task 3 |
| Unit tests: store, clamp helper, panel list + click depth | Tasks 1-3 |
| e2e: one row after Make solid, click reverts, list empties | Task 4 |
| README + CHANGELOG undo wording | Task 4 |

No gaps.

**2. Placeholder scan:** No TBD/TODO. Every code step has literal code; every test step a full body.

**3. Type consistency:**
- `UndoEntry` shape `{ label: string; apply: () => void; discard: () => void }` identical in `undoStackRef`, `pushUndo` param, and the `makeSolid` push (Task 2).
- `onUndoEdit?: (steps?: number) => void` identical across App, Sidebar, PreparePanel, RepairSection (Task 3).
- `clampUndoSteps(steps: number, length: number): number` — same signature in `undoStack.ts`, its test, and the `undoEdit` call site.
- `undoLabels: string[]` — same in store, `syncUndoLabels`, and `RepairSection`'s selector.
- Row index convention: newest = 0 in `undoLabels` (Task 1 spec), consumed as `onUndoEdit(index + 1)` in Task 3, asserted the same in Task 3 tests and Task 4 e2e.
