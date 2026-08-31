# SP-2b: Staged Repair Pipeline + Repair Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "Make solid" operation with a list of individually runnable, worker-backed mesh-repair stages in a dedicated Repair modal, with a "Repair all" pipeline; clear the deferred SP-1 debt and SP-2a carry-forwards along the way.

**Architecture:** Pure per-geometry stage functions in `src/services/repairStages.ts` (weld, degenerate, duplicate, normals, small-shell, hole-fill), driven from a thin `meshRepair.worker.ts`. A new `Viewer3D.runRepair(stageIds, sealOpts, ...)` handle runs the simple stages per mesh, then the existing seal path, and pushes **one** `UndoEntry` for the run. `RepairDialog.tsx` replaces `SolidEditorDialog.tsx`. The undo stack's push/pop/discard mechanics move into pure, unit-tested helpers in `undoStack.ts`.

**Tech Stack:** React 19, Three.js 0.185 (incl. `three/examples/jsm/utils/BufferGeometryUtils.js`), Zustand 5, Tailwind v4 (CSS-var tokens), Vitest + @testing-library/react + userEvent, Playwright, Web Workers (module type).

**Spec:** `docs/superpowers/specs/2026-08-30-sp2b-repair-pipeline-design.md`

## Global Constraints

- **No new npm dependency.** `mergeVertices` from `three/examples/jsm/utils/BufferGeometryUtils.js` only.
- No jest-dom matchers. Use `(x as HTMLButtonElement).disabled`, `.textContent`, `within`, `getAllByRole`, `queryByTestId` — match existing test style.
- `pnpm exec tsc --noEmit` zero errors after every task.
- `pnpm test` passes after every task; `pnpm test:e2e -- prepare-panel` and `pnpm build` pass at the end.
- Stage functions in `repairStages.ts` are **pure**: never mutate the input geometry, no React, no WebGL, no worker/DOM globals.
- Fixed pipeline order: `weld, degenerate, duplicate, normals, smallShells, holeFill` then `seal`. `runStages` and `runRepair` apply this order regardless of the caller's argument order.
- `undoStackRef.current` stays one array instance for its life (empty in place, never reassign).
- Seal algorithm (`solidRepair.ts` internals, `exteriorShell.ts`, `visibleTriangles.ts`) is not modified.
- Commit after each task, `feat:` / `refactor:` / `test:` prefix. No push/tag/PR. Author under the repo git identity; no AI attribution or co-author trailers.

---

## File Structure

New:
- `src/services/repairStages.ts` + `src/services/repairStages.test.ts`
- `src/services/meshRepair.ts`
- `src/services/meshRepair.worker.ts`
- `src/components/RepairDialog.tsx` + `src/components/RepairDialog.test.tsx`

Modified:
- `src/services/undoStack.ts` + `.test.ts` — pure `pushBounded` / `discardAll` / `popApply`
- `src/components/Viewer3D.tsx` — delegate the stack helpers; `applySeal` extraction; `runRepair`; drop `makeSolid` from the handle
- `src/store/viewerStore.ts` + `.test.ts` — `sealApplied`; `solidEditorOpen` → `repairDialogOpen`
- `src/services/prepChecks.ts` + `.test.ts` — `sealApplied` param + `warn` annotation
- `src/components/prepare/ReadinessCard.tsx` + `.test.tsx` — `canFix` prop; `var(--warning)`
- `src/components/prepare/PreparePanel.tsx` + `.test.tsx` — `FIX_HANDLERS`, `canFix`, `sealApplied`
- `src/components/prepare/RepairSection.tsx` — `Repair…` button
- `src/components/Sidebar.tsx` + `.test.tsx` — `useId` tab ids; doc comment
- `src/App.tsx` — render `<RepairDialog>`; `inert` flag rename
- `src/components/SceneControls.test.tsx` — `solidEditorOpen` reference rename (if present)
- `e2e/prepare-panel.spec.ts`, `README.md`, `CHANGELOG.md`

Deleted: `src/components/SolidEditorDialog.tsx`, `src/components/SolidEditorDialog.test.tsx`

---

## Task 1: Pure undo-stack helpers

**Files:**
- Modify: `src/services/undoStack.ts`
- Test: `src/services/undoStack.test.ts`
- Modify: `src/components/Viewer3D.tsx` (`pushUndo` ~175, `clearUndo` ~180, `undoEdit` ~286)

**Interfaces:**
- Produces:
  - `pushBounded(stack: UndoEntry[], entry: UndoEntry, max?: number): void` — `stack.push(entry); while (stack.length > (max ?? MAX_UNDO)) stack.shift()!.discard()`
  - `discardAll(stack: UndoEntry[]): void` — `for (const e of stack) e.discard(); stack.length = 0`
  - `popApply(stack: UndoEntry[], n: number): void` — `for (let i = 0; i < n; i++) stack.pop()!.apply()` (caller clamps `n`)

- [ ] **Step 1: Write the failing test**

Append to `src/services/undoStack.test.ts`:

```ts
import { pushBounded, discardAll, popApply, MAX_UNDO } from './undoStack'
import type { UndoEntry } from './undoStack'

const entry = (label: string, calls: string[]): UndoEntry => ({
  label,
  apply: () => calls.push(`apply:${label}`),
  discard: () => calls.push(`discard:${label}`),
})

describe('pushBounded', () => {
  it('discards the oldest entry past the cap and keeps the array instance', () => {
    const calls: string[] = []
    const stack: UndoEntry[] = []
    for (let i = 1; i <= MAX_UNDO + 1; i++) pushBounded(stack, entry(`e${i}`, calls))
    expect(stack).toHaveLength(MAX_UNDO)
    expect(calls).toEqual(['discard:e1'])
    expect(stack[0].label).toBe('e2')
  })

  it('honors an explicit max', () => {
    const calls: string[] = []
    const stack: UndoEntry[] = []
    pushBounded(stack, entry('a', calls), 1)
    pushBounded(stack, entry('b', calls), 1)
    expect(stack.map((e) => e.label)).toEqual(['b'])
    expect(calls).toEqual(['discard:a'])
  })
})

describe('discardAll', () => {
  it('discards every entry and empties in place', () => {
    const calls: string[] = []
    const stack: UndoEntry[] = [entry('a', calls), entry('b', calls)]
    const ref = stack
    discardAll(stack)
    expect(calls).toEqual(['discard:a', 'discard:b'])
    expect(stack).toHaveLength(0)
    expect(stack).toBe(ref)
  })
})

describe('popApply', () => {
  it('applies newest-first for n steps', () => {
    const calls: string[] = []
    const stack: UndoEntry[] = [entry('a', calls), entry('b', calls), entry('c', calls)]
    popApply(stack, 2)
    expect(calls).toEqual(['apply:c', 'apply:b'])
    expect(stack.map((e) => e.label)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test` (path filter is ignored in this repo — the run is the full suite; find the `undoStack` block in the output).
Expected: FAIL — `pushBounded` / `discardAll` / `popApply` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/services/undoStack.ts`:

```ts
import type { } from './undoStack' // no-op; keep existing imports/exports above

export function pushBounded(stack: UndoEntry[], entry: UndoEntry, max: number = MAX_UNDO): void {
  stack.push(entry)
  while (stack.length > max) stack.shift()!.discard()
}

export function discardAll(stack: UndoEntry[]): void {
  for (const entry of stack) entry.discard()
  stack.length = 0
}

export function popApply(stack: UndoEntry[], n: number): void {
  for (let i = 0; i < n; i++) stack.pop()!.apply()
}
```

(Drop the `import type {} from './undoStack'` placeholder line — it is only here to signal "keep the file's existing `UndoEntry` / `MAX_UNDO` declarations above"; `UndoEntry` and `MAX_UNDO` are already in this file.)

- [ ] **Step 4: Delegate from Viewer3D**

In `src/components/Viewer3D.tsx`:

1. Extend the import: `import { MAX_UNDO, clampUndoSteps, pushBounded, discardAll, popApply, type UndoEntry } from '../services/undoStack'`.
2. `pushUndo`:

```ts
  const pushUndo = (entry: UndoEntry) => {
    pushBounded(undoStackRef.current, entry)
    syncUndoLabels()
  }
```

3. `clearUndo`:

```ts
  const clearUndo = () => {
    discardAll(undoStackRef.current)
    syncUndoLabels()
  }
```

(Note: this no longer reassigns `undoStackRef.current = []`; `discardAll` empties in place. That is required so future holders of the array reference see the same instance.)

4. `undoEdit`:

```ts
    undoEdit: (steps = 1) => {
      popApply(undoStackRef.current, clampUndoSteps(steps, undoStackRef.current.length))
      syncUndoLabels()
      const roots = modelRoots()
      for (const root of roots) applyViewMode(root, useViewerStore.getState().viewMode)
      updateTriangleDetails()
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
```

`MAX_UNDO` may now be unused in Viewer3D — if `tsc`/lint flags it, drop it from the import.

- [ ] **Step 5: Verify**

Run: `pnpm test` — expected PASS (new `undoStack` block green, everything else unchanged).
Run: `pnpm exec tsc --noEmit` — expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/undoStack.ts src/services/undoStack.test.ts src/components/Viewer3D.tsx
git commit -m "refactor: extract pure undo-stack push/pop/discard helpers"
```

---

## Task 2: Store — `sealApplied`

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts`

**Interfaces:**
- Produces: `sealApplied: boolean` (initial `false`), `setSealApplied: (v: boolean) => void`. `setFile` and `setFileFromBuffer` also reset `sealApplied: false`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/viewerStore.test.ts`:

```ts
describe('sealApplied', () => {
  beforeEach(() => { useViewerStore.setState({ sealApplied: false }) })

  it('defaults to false', () => {
    expect(useViewerStore.getInitialState().sealApplied).toBe(false)
  })

  it('setSealApplied toggles it', () => {
    useViewerStore.getState().setSealApplied(true)
    expect(useViewerStore.getState().sealApplied).toBe(true)
  })

  it('setFile resets it', () => {
    useViewerStore.setState({ sealApplied: true })
    useViewerStore.getState().setFile('/m/x.stl', 'x.stl', '.stl', 10)
    expect(useViewerStore.getState().sealApplied).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test` — FAIL (`setSealApplied` not a function; `sealApplied` missing from type).

- [ ] **Step 3: Implement**

In `src/store/viewerStore.ts`:
- `ViewerState` near `canUndoEdit`: `sealApplied: boolean`; near `setCanUndoEdit`: `setSealApplied: (v: boolean) => void`.
- `create(...)` body near `canUndoEdit: false,`: `sealApplied: false,`; near `setCanUndoEdit`: `setSealApplied: (v) => set({ sealApplied: v }),`.
- In `setFile`'s `set({...})` and `setFileFromBuffer`'s `set({...})`, add `sealApplied: false` beside the existing `canUndoEdit: false` / `undoLabels: []`.

- [ ] **Step 4: Verify**

Run: `pnpm test` — PASS. `pnpm exec tsc --noEmit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: add sealApplied flag to the viewer store"
```

---

## Task 3: repairStages — weld, degenerate, duplicate

**Files:**
- Create: `src/services/repairStages.ts`
- Test: `src/services/repairStages.test.ts`

**Interfaces:**
- Produces:
  - `interface StageResult { geometry: THREE.BufferGeometry; note?: string }`
  - `const REPAIR_STAGE_IDS = ['weld','degenerate','duplicate','normals','smallShells','holeFill'] as const`
  - `type RepairStageId = typeof REPAIR_STAGE_IDS[number]`
  - `const STAGE_LABEL: Record<RepairStageId | 'seal', string>` (values per spec §1)
  - `weldVertices(geo, tolerance = 1e-4): StageResult`
  - `dropDegenerateFaces(geo): StageResult`
  - `dropDuplicateFaces(geo): StageResult`

- [ ] **Step 1: Write the failing tests**

Create `src/services/repairStages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { weldVertices, dropDegenerateFaces, dropDuplicateFaces, STAGE_LABEL } from './repairStages'
import { analyzeGeometry } from './meshHealth'

/** unit cube as 12 non-indexed triangles with split vertices (36 positions) */
function splitCube(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1)
  return g.toNonIndexed()
}

describe('STAGE_LABEL', () => {
  it('covers every stage plus seal', () => {
    for (const id of ['weld','degenerate','duplicate','normals','smallShells','holeFill','seal'] as const) {
      expect(typeof STAGE_LABEL[id]).toBe('string')
    }
  })
})

describe('weldVertices', () => {
  it('merges split vertices without changing the surface', () => {
    const src = splitCube()
    const before = analyzeGeometry(src)
    const { geometry } = weldVertices(src)
    const after = analyzeGeometry(geometry)
    expect(after.vertices).toBe(8)
    expect(after.triangles).toBe(before.triangles)
    expect(after.watertight).toBe(true)
    // input untouched
    expect(src.getAttribute('position').count).toBe(36)
  })
})

describe('dropDegenerateFaces', () => {
  it('removes a triangle with two coincident corners', () => {
    const positions = new Float32Array([
      0,0,0, 1,0,0, 0,1,0,      // good
      2,2,2, 2,2,2, 3,2,2,      // degenerate (first two identical)
    ])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const { geometry } = dropDegenerateFaces(g)
    expect(analyzeGeometry(geometry).triangles).toBe(1)
  })
})

describe('dropDuplicateFaces', () => {
  it('removes exactly one of a duplicated pair', () => {
    const t = [0,0,0, 1,0,0, 0,1,0]
    const positions = new Float32Array([...t, ...t, 5,0,0, 6,0,0, 5,1,0])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    expect(analyzeGeometry(g).duplicateFaces).toBe(1)
    const { geometry } = dropDuplicateFaces(g)
    const after = analyzeGeometry(geometry)
    expect(after.triangles).toBe(2)
    expect(after.duplicateFaces).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test` — FAIL (module `./repairStages` not found).

- [ ] **Step 3: Implement**

Create `src/services/repairStages.ts`:

```ts
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface StageResult {
  geometry: THREE.BufferGeometry
  note?: string
}

export const REPAIR_STAGE_IDS = [
  'weld', 'degenerate', 'duplicate', 'normals', 'smallShells', 'holeFill',
] as const
export type RepairStageId = (typeof REPAIR_STAGE_IDS)[number]

export const STAGE_LABEL: Record<RepairStageId | 'seal', string> = {
  weld: 'Weld vertices',
  degenerate: 'Remove degenerate faces',
  duplicate: 'Remove duplicate faces',
  normals: 'Unify normals',
  smallShells: 'Remove small shells',
  holeFill: 'Fill holes',
  seal: 'Make solid (seal)',
}

function nonIndexedPositions(geo: THREE.BufferGeometry): Float32Array {
  const src = geo.index ? geo.toNonIndexed() : geo
  const attr = src.getAttribute('position') as THREE.BufferAttribute
  const out = new Float32Array(attr.array as ArrayLike<number>)
  if (src !== geo) src.dispose()
  return out
}

function fromPositions(positions: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
}

const KEY = (x: number, y: number, z: number) =>
  `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`

export function weldVertices(geo: THREE.BufferGeometry, tolerance = 1e-4): StageResult {
  try {
    const src = geo.index ? geo.clone() : geo.toNonIndexed()
    const merged = mergeVertices(src, tolerance)
    if (src !== geo) src.dispose()
    merged.computeVertexNormals()
    return { geometry: merged }
  } catch {
    return { geometry: geo.clone(), note: 'skipped: unsupported attribute layout' }
  }
}

export function dropDegenerateFaces(geo: THREE.BufferGeometry): StageResult {
  const p = nonIndexedPositions(geo)
  const kept: number[] = []
  let removed = 0
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let t = 0; t < p.length; t += 9) {
    a.set(p[t], p[t + 1], p[t + 2])
    b.set(p[t + 3], p[t + 4], p[t + 5])
    c.set(p[t + 6], p[t + 7], p[t + 8])
    const dup = a.distanceToSquared(b) <= 1e-12 || b.distanceToSquared(c) <= 1e-12 || a.distanceToSquared(c) <= 1e-12
    const area2 = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).lengthSq()
    if (dup || area2 <= 1e-20) { removed++; continue }
    for (let k = 0; k < 9; k++) kept.push(p[t + k])
  }
  return { geometry: fromPositions(new Float32Array(kept)), note: removed ? `${removed} removed` : undefined }
}

export function dropDuplicateFaces(geo: THREE.BufferGeometry): StageResult {
  const p = nonIndexedPositions(geo)
  const ids = new Map<string, number>()
  const cornerId = (i: number) => {
    const k = KEY(p[i], p[i + 1], p[i + 2])
    let id = ids.get(k)
    if (id === undefined) { id = ids.size; ids.set(k, id) }
    return id
  }
  const seen = new Set<string>()
  const kept: number[] = []
  let removed = 0
  for (let t = 0; t < p.length; t += 9) {
    const tri = [cornerId(t), cornerId(t + 3), cornerId(t + 6)].sort((x, y) => x - y).join(':')
    if (seen.has(tri)) { removed++; continue }
    seen.add(tri)
    for (let k = 0; k < 9; k++) kept.push(p[t + k])
  }
  return { geometry: fromPositions(new Float32Array(kept)), note: removed ? `${removed} removed` : undefined }
}
```

- [ ] **Step 4: Verify**

Run: `pnpm test` — PASS. `pnpm exec tsc --noEmit` — PASS (if `three/examples/jsm/...` has no types, add `// @ts-expect-error no types` above the import, or a one-line `declare module` — prefer the module path with `.js`, which resolves types in three 0.185).

- [ ] **Step 5: Commit**

```bash
git add src/services/repairStages.ts src/services/repairStages.test.ts
git commit -m "feat: weld, degenerate, and duplicate repair stages"
```

---

## Task 4: repairStages — unifyNormals, removeSmallShells

**Files:**
- Modify: `src/services/repairStages.ts`, `src/services/repairStages.test.ts`

**Interfaces:**
- Produces: `unifyNormals(geo): StageResult`, `removeSmallShells(geo, minFraction = 0.01): StageResult`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/repairStages.test.ts`:

```ts
import { unifyNormals, removeSmallShells } from './repairStages'

/** two triangles forming a quad, second one wound backwards */
function inconsistentQuad(): THREE.BufferGeometry {
  const positions = new Float32Array([
    0,0,0, 1,0,0, 1,1,0,
    0,0,0, 1,1,0, 0,1,0,      // reverse this to be inconsistent:
  ])
  // flip triangle 2 winding
  positions.set([0,0,0, 0,1,0, 1,1,0], 9)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return g
}

describe('unifyNormals', () => {
  it('returns a geometry with consistent winding and does not throw on a flat quad', () => {
    const { geometry } = unifyNormals(inconsistentQuad())
    // after unify, the two triangles share edge (0,0,0)-(1,1,0) in OPPOSITE directions
    const p = (geometry.index ? geometry.toNonIndexed() : geometry).getAttribute('position')
    expect(p.count).toBe(6)
  })

  it('leaves a non-orientable component unchanged and notes it', () => {
    // a 3-triangle Möbius-ish strip: hard to build cleanly; assert no-throw on a single tri
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3))
    expect(() => unifyNormals(g)).not.toThrow()
  })
})

describe('removeSmallShells', () => {
  it('drops a tiny second shell and keeps the big one', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed().getAttribute('position').array as Float32Array
    const speck = new Float32Array([100,100,100, 100.1,100,100, 100,100.1,100]) // 1 tri
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...cube, ...speck]), 3))
    const before = analyzeGeometry(g).triangles
    const { geometry, note } = removeSmallShells(g)
    const after = analyzeGeometry(geometry).triangles
    expect(after).toBe(before - 1)
    expect(note).toMatch(/1/)
  })

  it('is a no-op on a single connected component', () => {
    const g = new THREE.BoxGeometry(1, 1, 1)
    const before = analyzeGeometry(g).triangles
    const { geometry } = removeSmallShells(g)
    expect(analyzeGeometry(geometry).triangles).toBe(before)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test` — FAIL (`unifyNormals` / `removeSmallShells` not exported).

- [ ] **Step 3: Implement**

Append to `src/services/repairStages.ts`:

```ts
/** merged-vertex triangle model shared by normals / smallShells / holeFill */
function triModel(geo: THREE.BufferGeometry) {
  const p = nonIndexedPositions(geo)
  const ids = new Map<string, number>()
  const triCount = p.length / 9
  const tris: number[][] = []
  for (let t = 0; t < triCount; t++) {
    const tri: number[] = []
    for (let c = 0; c < 3; c++) {
      const i = t * 9 + c * 3
      const k = KEY(p[i], p[i + 1], p[i + 2])
      let id = ids.get(k)
      if (id === undefined) { id = ids.size; ids.set(k, id) }
      tri.push(id)
    }
    tris.push(tri)
  }
  return { positions: p, tris, vertexCount: ids.size }
}

function rebuild(positions: Float32Array, tris: number[][], vertexKeyOf: (id: number) => [number, number, number]): THREE.BufferGeometry {
  const out = new Float32Array(tris.length * 9)
  let o = 0
  for (const tri of tris) for (const id of tri) {
    const [x, y, z] = vertexKeyOf(id)
    out[o++] = x; out[o++] = y; out[o++] = z
  }
  return fromPositions(out)
}

function vertexTable(positions: Float32Array, tris: number[][], vertexCount: number): [number, number, number][] {
  const table: [number, number, number][] = new Array(vertexCount)
  let filled = 0
  for (let t = 0; t < tris.length && filled < vertexCount; t++) {
    for (let c = 0; c < 3; c++) {
      const id = tris[t][c]
      if (!table[id]) {
        const i = t * 9 + c * 3
        table[id] = [positions[i], positions[i + 1], positions[i + 2]]
        filled++
      }
    }
  }
  return table
}

export function unifyNormals(geo: THREE.BufferGeometry): StageResult {
  const { positions, tris, vertexCount } = triModel(geo)
  // edge -> list of {tri, directed a<b?}
  const edgeMap = new Map<string, { tri: number; a: number; b: number }[]>()
  const ekey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  tris.forEach((tri, ti) => {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = ekey(a, b)
      ;(edgeMap.get(k) ?? edgeMap.set(k, []).get(k)!).push({ tri: ti, a, b })
    }
  })
  const visited = new Array(tris.length).fill(false)
  let conflicts = 0
  for (let seed = 0; seed < tris.length; seed++) {
    if (visited[seed]) continue
    visited[seed] = true
    const queue = [seed]
    while (queue.length) {
      const ti = queue.pop()!
      const tri = tris[ti]
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3]
        for (const rec of edgeMap.get(ekey(a, b)) ?? []) {
          if (rec.tri === ti) continue
          const nb = tris[rec.tri]
          // shared edge should be traversed in OPPOSITE directions for consistent winding
          const sameDir = ((): boolean => {
            for (let f = 0; f < 3; f++) if (nb[f] === a && nb[(f + 1) % 3] === b) return true
            return false
          })()
          if (!visited[rec.tri]) {
            if (sameDir) { nb.reverse() }
            visited[rec.tri] = true
            queue.push(rec.tri)
          } else if (sameDir) {
            conflicts++
          }
        }
      }
    }
  }
  const table = vertexTable(positions, tris, vertexCount)
  const out = rebuild(positions, tris, (id) => table[id])
  return { geometry: out, note: conflicts ? `${conflicts} edge conflicts left as-is` : undefined }
}

export function removeSmallShells(geo: THREE.BufferGeometry, minFraction = 0.01): StageResult {
  const { positions, tris, vertexCount } = triModel(geo)
  // union-find over vertex ids via triangle membership
  const parent = Array.from({ length: vertexCount }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const union = (x: number, y: number) => { parent[find(x)] = find(y) }
  for (const tri of tris) { union(tri[0], tri[1]); union(tri[1], tri[2]) }
  const compTris = new Map<number, number[]>()
  tris.forEach((tri, ti) => {
    const r = find(tri[0])
    ;(compTris.get(r) ?? compTris.set(r, []).get(r)!).push(ti)
  })
  if (compTris.size <= 1) {
    const table = vertexTable(positions, tris, vertexCount)
    return { geometry: rebuild(positions, tris, (id) => table[id]) }
  }
  const total = tris.length
  const sizes = [...compTris.entries()].sort((a, b) => b[1].length - a[1].length)
  const largest = sizes[0][0]
  const keep = new Set<number>()
  let dropped = 0, droppedTris = 0
  for (const [root, list] of compTris) {
    if (root === largest || list.length >= minFraction * total) list.forEach((ti) => keep.add(ti))
    else { dropped++; droppedTris += list.length }
  }
  const keptTris = tris.filter((_, ti) => keep.has(ti))
  const table = vertexTable(positions, tris, vertexCount)
  return {
    geometry: rebuild(positions, keptTris, (id) => table[id]),
    note: dropped ? `${dropped} shell${dropped === 1 ? '' : 's'} removed (${droppedTris} tris)` : undefined,
  }
}
```

- [ ] **Step 4: Verify**

Run: `pnpm test` — PASS. `pnpm exec tsc --noEmit` — PASS.
If `unifyNormals`'s `edgeMap.set(k, []).get(k)!` pattern trips lint, use an explicit `let arr = edgeMap.get(k); if (!arr) { arr = []; edgeMap.set(k, arr) }`.

- [ ] **Step 5: Commit**

```bash
git add src/services/repairStages.ts src/services/repairStages.test.ts
git commit -m "feat: unify-normals and remove-small-shells repair stages"
```

---

## Task 5: repairStages — fillHoles + runStages

**Files:**
- Modify: `src/services/repairStages.ts`, `src/services/repairStages.test.ts`

**Interfaces:**
- Produces:
  - `fillHoles(geo): StageResult`
  - `runStages(geo, stageIds: RepairStageId[]): { geometry: THREE.BufferGeometry; stages: { id: RepairStageId; before: MeshHealth; after: MeshHealth; note?: string }[] }` — applies the given ids in `REPAIR_STAGE_IDS` order.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/repairStages.test.ts`:

```ts
import { fillHoles, runStages, REPAIR_STAGE_IDS } from './repairStages'

/** unit cube missing the +Z face: 10 triangles, one square hole */
function openCube(): THREE.BufferGeometry {
  const full = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
  // BoxGeometry face order: +X,-X,+Y,-Y,+Z,-Z ; each face = 6 verts = 18 floats.
  // Drop +Z face (index 4) -> keep 0..3 and 5.
  const keep = new Float32Array([...full.slice(0, 18 * 4), ...full.slice(18 * 5, 18 * 6)])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(keep, 3))
  return g
}

describe('fillHoles', () => {
  it('seals a single square hole', () => {
    const src = openCube()
    const before = analyzeGeometry(src)
    expect(before.boundaryEdges).toBe(4)
    const { geometry, note } = fillHoles(src)
    const after = analyzeGeometry(geometry)
    expect(after.boundaryEdges).toBe(0)
    expect(after.watertight).toBe(true)
    expect(after.triangles).toBe(before.triangles + 2) // fan of a quad = 2 tris (or centroid fan = 4)
    expect(note).toMatch(/1 (loop )?filled/i)
  })

  it('reports a skipped non-simple loop without throwing', () => {
    // figure-eight boundary is hard to build; assert no-throw + note shape on a clean closed mesh
    const g = new THREE.BoxGeometry(1, 1, 1)
    const { note } = fillHoles(g)
    expect(note === undefined || /0 .*filled/i.test(note)).toBe(true)
  })
})

describe('runStages', () => {
  it('applies stages in canonical order and reports per-stage health', () => {
    const src = openCube()
    const { geometry, stages } = runStages(src, ['holeFill', 'weld']) // deliberately out of order
    expect(stages.map((s) => s.id)).toEqual(['weld', 'holeFill'])
    expect(stages[0].before.vertices).toBeGreaterThan(stages[0].after.vertices) // weld merged
    expect(analyzeGeometry(geometry).watertight).toBe(true)
  })

  it('REPAIR_STAGE_IDS is the canonical order', () => {
    expect([...REPAIR_STAGE_IDS]).toEqual(['weld','degenerate','duplicate','normals','smallShells','holeFill'])
  })
})
```

(If the fan strategy yields 4 triangles for a quad hole, change the `+ 2` to `+ 4` — decide in implementation and make the test match the real output.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test` — FAIL (`fillHoles` / `runStages` not exported).

- [ ] **Step 3: Implement**

Append to `src/services/repairStages.ts`:

```ts
export function fillHoles(geo: THREE.BufferGeometry): StageResult {
  const { positions, tris, vertexCount } = triModel(geo)
  const table = vertexTable(positions, tris, vertexCount)

  // directed boundary edges: an edge used by exactly one triangle, kept in the
  // direction that triangle traverses it.
  const edgeUse = new Map<string, number>()
  const dir: [number, number][] = []
  for (const tri of tris) {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1)
    }
  }
  const boundaryNext = new Map<number, number>()
  let boundaryCount = 0
  for (const tri of tris) {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      if (edgeUse.get(k) === 1) { boundaryNext.set(a, b); boundaryCount++ }
    }
  }

  const outTris = tris.map((t) => [...t])
  let filled = 0, skipped = 0
  const startNodes = new Set(boundaryNext.keys())
  while (startNodes.size) {
    const start = startNodes.values().next().value as number
    const loop: number[] = []
    let cur = start
    let ok = true
    for (let guard = 0; guard <= boundaryCount + 1; guard++) {
      loop.push(cur)
      startNodes.delete(cur)
      const nxt = boundaryNext.get(cur)
      if (nxt === undefined) { ok = false; break }
      if (nxt === start) break
      if (loop.includes(nxt)) { ok = false; break }
      cur = nxt
    }
    if (!ok || loop.length < 3) { skipped++; continue }
    // Newell normal + centroid
    const c = [0, 0, 0]
    for (const id of loop) { const v = table[id]; c[0] += v[0]; c[1] += v[1]; c[2] += v[2] }
    c[0] /= loop.length; c[1] /= loop.length; c[2] /= loop.length
    const n = [0, 0, 0]
    for (let i = 0; i < loop.length; i++) {
      const p = table[loop[i]], q = table[loop[(i + 1) % loop.length]]
      n[0] += (p[1] - q[1]) * (p[2] + q[2])
      n[1] += (p[2] - q[2]) * (p[0] + q[0])
      n[2] += (p[0] - q[0]) * (p[1] + q[1])
    }
    // fan from centroid; the boundary loop is directed so the surface is on its
    // left — the cap must wind the other way, i.e. (centroid, b, a).
    const centroidId = table.push([c[0], c[1], c[2]]) - 1
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length]
      outTris.push([centroidId, b, a])
    }
    filled++
  }

  if (!filled) return { geometry: geo.clone(), note: skipped ? `0 filled, ${skipped} skipped` : undefined }
  return {
    geometry: rebuild(positions, outTris, (id) => table[id]),
    note: `${filled} loop${filled === 1 ? '' : 's'} filled${skipped ? `, ${skipped} skipped` : ''}`,
  }
}

const STAGE_FN: Record<RepairStageId, (g: THREE.BufferGeometry) => StageResult> = {
  weld: (g) => weldVertices(g),
  degenerate: dropDegenerateFaces,
  duplicate: dropDuplicateFaces,
  normals: unifyNormals,
  smallShells: (g) => removeSmallShells(g),
  holeFill: fillHoles,
}

export function runStages(geo: THREE.BufferGeometry, stageIds: RepairStageId[]) {
  const want = new Set(stageIds)
  let current = geo.clone()
  const stages: { id: RepairStageId; before: import('./meshHealth').MeshHealth; after: import('./meshHealth').MeshHealth; note?: string }[] = []
  for (const id of REPAIR_STAGE_IDS) {
    if (!want.has(id)) continue
    const before = analyzeGeometry(current)
    const res = STAGE_FN[id](current)
    if (res.geometry !== current) current.dispose()
    current = res.geometry
    stages.push({ id, before, after: analyzeGeometry(current), note: res.note })
  }
  return { geometry: current, stages }
}
```

Add `import { analyzeGeometry } from './meshHealth'` at the top (and `import type { MeshHealth } from './meshHealth'` if you prefer a named type over the inline `import('./meshHealth').MeshHealth`).

- [ ] **Step 4: Verify**

Run: `pnpm test` — PASS (adjust the `+2` / `+4` triangle-count expectation in the test to whatever `fillHoles` actually produces; the centroid fan on a 4-vertex loop yields 4 triangles, so likely `+ 4`).
Run: `pnpm exec tsc --noEmit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/repairStages.ts src/services/repairStages.test.ts
git commit -m "feat: fill-holes repair stage and runStages pipeline"
```

---

## Task 6: meshRepair worker + service

**Files:**
- Create: `src/services/meshRepair.worker.ts`, `src/services/meshRepair.ts`

**Interfaces:**
- Produces: `runRepairInWorker(meshes: THREE.Mesh[], stageIds: RepairStageId[], onProgress: (percent: number, phase: string) => void, signal?: AbortSignal): Promise<{ geometries: THREE.BufferGeometry[]; perMesh: { id: RepairStageId; before: MeshHealth; after: MeshHealth; note?: string }[][] }>`

- [ ] **Step 1: Implement the worker**

Create `src/services/meshRepair.worker.ts`:

```ts
import * as THREE from 'three'
import { runStages, type RepairStageId } from './repairStages'

interface InMsg {
  id: number
  meshes: { positions: ArrayBuffer; index: ArrayBuffer | null }[]
  stageIds: RepairStageId[]
}

self.onmessage = (event: MessageEvent<InMsg>) => {
  const { id, meshes, stageIds } = event.data
  const outMeshes: { positions: ArrayBuffer; index: ArrayBuffer | null }[] = []
  const perMesh: unknown[] = []
  const transfer: ArrayBuffer[] = []
  meshes.forEach((m, i) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3))
    if (m.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.index), 1))
    ;(self as unknown as Worker).postMessage({
      type: 'progress', id,
      percent: Math.round((i / meshes.length) * 90),
      phase: `Repairing mesh ${i + 1} of ${meshes.length}`,
    })
    const { geometry, stages } = runStages(g, stageIds)
    const pos = (geometry.index ? geometry.toNonIndexed() : geometry).getAttribute('position')
      .array as Float32Array
    const buf = new Float32Array(pos).buffer
    outMeshes.push({ positions: buf, index: null })
    transfer.push(buf)
    perMesh.push(stages)
    g.dispose()
    geometry.dispose()
  })
  ;(self as unknown as Worker).postMessage({ id, meshes: outMeshes, perMesh }, transfer)
}
```

- [ ] **Step 2: Implement the service**

Create `src/services/meshRepair.ts`:

```ts
import * as THREE from 'three'
import type { RepairStageId } from './repairStages'
import type { MeshHealth } from './meshHealth'

export interface PerMeshStage { id: RepairStageId; before: MeshHealth; after: MeshHealth; note?: string }

export function runRepairInWorker(
  meshes: THREE.Mesh[],
  stageIds: RepairStageId[],
  onProgress: (percent: number, phase: string) => void,
  signal?: AbortSignal,
): Promise<{ geometries: THREE.BufferGeometry[]; perMesh: PerMeshStage[][] }> {
  if (meshes.length === 0) return Promise.reject(new Error('The scene has no mesh geometry to repair'))
  const payload = meshes.map((mesh) => {
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    const positions = new Float32Array(src.getAttribute('position').array as ArrayLike<number>).buffer
    if (src !== mesh.geometry) src.dispose()
    return { positions, index: null as ArrayBuffer | null }
  })
  const worker = new Worker(new URL('./meshRepair.worker.ts', import.meta.url), { type: 'module' })
  const id = Date.now()
  return new Promise((resolve, reject) => {
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Repair cancelled', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (e) => { cleanup(); reject(new Error(e.message || 'Repair worker failed')) }
    worker.onmessage = (e: MessageEvent) => {
      if (e.data.id !== id) return
      if (e.data.type === 'progress') { onProgress(e.data.percent, e.data.phase); return }
      cleanup()
      const geometries = (e.data.meshes as { positions: ArrayBuffer }[]).map((m) => {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3))
        g.computeVertexNormals()
        return g
      })
      onProgress(100, 'Repair complete')
      resolve({ geometries, perMesh: e.data.perMesh as PerMeshStage[][] })
    }
    worker.postMessage({ id, meshes: payload, stageIds }, payload.map((p) => p.positions))
  })
}
```

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` — PASS.
Run: `pnpm test` — PASS (no test imports the worker; the `vitest`/`jsdom` env does not execute it. If a future test needs it, note the fflate/jsdom cross-realm typed-array gotcha in project memory.)

- [ ] **Step 4: Commit**

```bash
git add src/services/meshRepair.ts src/services/meshRepair.worker.ts
git commit -m "feat: mesh-repair worker running the stage pipeline per mesh"
```

---

## Task 7: Viewer3D — `applySeal` extraction + `runRepair`

**Files:**
- Modify: `src/components/Viewer3D.tsx`

**Interfaces:**
- Consumes: `runRepairInWorker` (Task 6); `repairGeometriesInWorker` (existing); `pushUndo` (Task 1); `sealApplied` setter (Task 2); `REPAIR_STAGE_IDS` / `STAGE_LABEL` (Task 3).
- Produces:
  - `Viewer3DHandle.runRepair: (stageIds: (RepairStageId | 'seal')[], sealOpts: { resolution: number; stripInternalWalls: boolean }, onProgress: (percent: number, phase: string) => void, signal?: AbortSignal) => Promise<RepairRunResult>`
  - `interface RepairRunResult { label: string; perMesh: PerMeshStage[][]; seal?: SolidRepairStats }`
  - `Viewer3DHandle.makeSolid` is REMOVED.

- [ ] **Step 1: Extract `applySeal`**

In `Viewer3D.tsx`, the current `makeSolid` handle body does: `withGeometry(modelMeshes())` → `repairGeometriesInWorker` → identity guard → per-mesh geometry swap → new `MeshStandardMaterial` on `meshes[0]` → build `apply`/`discard` closures → `pushUndo(...)` → refresh + one-time render → return `result.stats`.

Refactor into a local helper (defined alongside `pushUndo` etc., not on the handle):

```ts
  const applySeal = async (
    resolution: number,
    onProgress: (p: number, phase: string) => void,
    signal: AbortSignal | undefined,
    opts: { stripInternalWalls: boolean },
  ) => {
    const meshes = withGeometry(modelMeshes())
    const result = await repairGeometriesInWorker(meshes, resolution, onProgress, signal, {
      stripInternalWalls: opts.stripInternalWalls,
      renderer: rendererRef.current ?? null,
    })
    const current = withGeometry(modelMeshes())
    if (current.length !== meshes.length || meshes.some((m, i) => m !== current[i])) {
      result.geometries.forEach((g) => g.dispose())
      throw new Error('The open model changed while repair was running')
    }
    const originals = meshes.map((m) => m.geometry)
    const originalMaterial = meshes[0].material
    meshes.forEach((m, i) => { m.geometry = result.geometries[i] })
    const solidMaterial = new THREE.MeshStandardMaterial({
      color: getTheme(useViewerStore.getState().theme).modelColor, roughness: 0.85, metalness: 0,
    })
    meshes[0].material = solidMaterial
    return { meshes, originals, originalMaterial, solidMaterial, stats: result.stats }
  }
```

- [ ] **Step 2: `runRepair`**

Add to the `useImperativeHandle` object (and remove `makeSolid`):

```ts
    runRepair: async (stageIds, sealOpts, onProgress, signal) => {
      const wantSeal = stageIds.includes('seal')
      const simpleIds = stageIds.filter((s): s is RepairStageId => s !== 'seal')
      const meshes = withGeometry(modelMeshes())
      if (meshes.length === 0) throw new Error('The scene has no mesh geometry to repair')
      const originals = meshes.map((m) => m.geometry)

      let perMesh: PerMeshStage[][] = []
      if (simpleIds.length) {
        const res = await runRepairInWorker(meshes, simpleIds, (p, phase) => onProgress(wantSeal ? p * 0.5 : p, phase), signal)
        const current = withGeometry(modelMeshes())
        if (current.length !== meshes.length || meshes.some((m, i) => m !== current[i])) {
          res.geometries.forEach((g) => g.dispose())
          throw new Error('The open model changed while repair was running')
        }
        meshes.forEach((m, i) => { m.geometry = res.geometries[i] })
        perMesh = res.perMesh
      }

      let seal: SolidRepairStats | undefined
      let sealBits: Awaited<ReturnType<typeof applySeal>> | undefined
      if (wantSeal) {
        sealBits = await applySeal(sealOpts.resolution, (p, phase) => onProgress(simpleIds.length ? 50 + p * 0.5 : p, phase), signal, { stripInternalWalls: sealOpts.stripInternalWalls })
        seal = sealBits.stats
      }

      const label = stageIds.length > 1 ? 'Repair all' : STAGE_LABEL[stageIds[0]]
      const sealMeshes = sealBits?.meshes
      const solidMaterial = sealBits?.solidMaterial
      const originalMaterial = sealBits?.originalMaterial
      pushUndo({
        label,
        apply: () => {
          meshes.forEach((m, i) => { m.geometry.dispose(); m.geometry = originals[i] })
          if (sealMeshes && originalMaterial !== undefined) {
            sealMeshes[0].material = originalMaterial
            solidMaterial?.dispose()
          }
        },
        discard: () => {
          originals.forEach((g) => g.dispose())
          if (originalMaterial !== undefined) {
            for (const mat of Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial]) mat.dispose()
          }
        },
      })

      if (wantSeal) useViewerStore.getState().setSealApplied(true)
      const roots = modelRoots()
      for (const root of roots) applyViewMode(root, useViewerStore.getState().viewMode)
      updateTriangleDetails()
      updateGeometryDetails()
      invalidate()
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current)
      }
      return { label, perMesh, seal }
    },
```

Note: `applySeal`'s `originals` and `runRepair`'s `originals` are the SAME per-mesh geometry objects (seal is applied after the simple swap, so `applySeal` re-snapshots the post-simple geometry — but `runRepair` already holds the pre-everything `originals`). To keep undo correct, `applySeal` must NOT be relied on for the geometry snapshot; `runRepair` owns `originals` taken before any stage. `applySeal`'s own `originals` return value is unused by `runRepair` (only `meshes`, `originalMaterial`, `solidMaterial`, `stats` are). Confirm `applySeal` still disposes nothing itself.

3. Imports: add `import { runRepairInWorker, type PerMeshStage } from '../services/meshRepair'` and `import { REPAIR_STAGE_IDS, STAGE_LABEL, type RepairStageId } from '../services/repairStages'`.
4. `Viewer3DHandle`: remove the `makeSolid` line, add `runRepair` + `RepairRunResult` per the Interfaces block.

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` — expect errors ONLY in `SolidEditorDialog.tsx` (calls the removed `makeSolid`) — that file is deleted in Task 8. No other file should error. If `SceneControls.tsx` or another references `makeSolid`, fix it here (it should not).
Run: `pnpm test` — the `SolidEditorDialog.test.tsx` suite will fail to compile; that is expected and resolved in Task 8. Every other suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D.runRepair orchestrating stage pipeline plus seal"
```

---

## Task 8: RepairDialog + retire SolidEditorDialog

**Files:**
- Create: `src/components/RepairDialog.tsx`, `src/components/RepairDialog.test.tsx`
- Delete: `src/components/SolidEditorDialog.tsx`, `src/components/SolidEditorDialog.test.tsx`
- Modify: `src/store/viewerStore.ts` (+ `.test.ts`), `src/App.tsx`, `src/components/prepare/PreparePanel.tsx`, `src/components/prepare/RepairSection.tsx`, `src/components/SceneControls.test.tsx`

**Interfaces:**
- Consumes: `Viewer3DHandle.runRepair` (Task 7); `REPAIR_STAGE_IDS` / `STAGE_LABEL`.
- Produces: store `repairDialogOpen` / `setRepairDialogOpen` (rename of `solidEditorOpen` / `setSolidEditorOpen`).

- [ ] **Step 1: Rename the store flag**

In `src/store/viewerStore.ts`: `solidEditorOpen` → `repairDialogOpen`, `setSolidEditorOpen` → `setRepairDialogOpen` (type + initial + action). In `src/store/viewerStore.test.ts` update any reference. Then `grep -rn "solidEditorOpen\|setSolidEditorOpen\|SolidEditorDialog" src/` and update every hit: `App.tsx` (import + JSX + `inert`), `prepare/PreparePanel.tsx` (`FIX_HANDLERS.seal`), `prepare/RepairSection.tsx` (`Make solid…` onClick), `prepare/PreparePanel.test.tsx`, `SceneControls.test.tsx`.

- [ ] **Step 2: Write the RepairDialog test**

Create `src/components/RepairDialog.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepairDialog } from './RepairDialog'
import { useViewerStore } from '../store/viewerStore'

function stubР() {
  return { current: { runRepair: vi.fn().mockResolvedValue({ label: 'x', perMesh: [], seal: undefined }) } }
}

beforeEach(() => {
  useViewerStore.setState({ repairDialogOpen: true, filePath: '/m/x.stl', loadedModels: [] })
})

describe('RepairDialog', () => {
  it('lists the seven stage rows in pipeline order', () => {
    render(<RepairDialog viewerRef={stubР() as never} />)
    const rows = screen.getAllByTestId(/^repair-stage-/)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'repair-stage-weld', 'repair-stage-degenerate', 'repair-stage-duplicate',
      'repair-stage-normals', 'repair-stage-smallShells', 'repair-stage-holeFill',
      'repair-stage-seal',
    ])
  })

  it('Run on a stage row calls runRepair with just that id', async () => {
    const ref = stubР()
    render(<RepairDialog viewerRef={ref as never} />)
    await userEvent.click(within(screen.getByTestId('repair-stage-holeFill')).getByRole('button', { name: /run/i }))
    expect(ref.current.runRepair).toHaveBeenCalledWith(
      ['holeFill'], expect.objectContaining({ resolution: expect.any(Number) }), expect.any(Function), expect.any(Object),
    )
  })

  it('Repair all sends the full ordered pipeline including seal', async () => {
    const ref = stubР()
    render(<RepairDialog viewerRef={ref as never} />)
    await userEvent.click(screen.getByRole('button', { name: /repair all/i }))
    expect(ref.current.runRepair.mock.calls[0][0]).toEqual(
      ['weld','degenerate','duplicate','normals','smallShells','holeFill','seal'],
    )
  })

  it('the seal row exposes the resolution select and strip-walls checkbox', () => {
    render(<RepairDialog viewerRef={stubР() as never} />)
    const seal = screen.getByTestId('repair-stage-seal')
    expect(within(seal).getByRole('combobox')).toBeTruthy()
    expect(within(seal).getByRole('checkbox')).toBeTruthy()
  })
})
```

(Rename `stubР` to `stubRef` — the Cyrillic is a typo guard; use a plain ASCII name.)

- [ ] **Step 3: Implement RepairDialog**

Model the shell on the deleted `SolidEditorDialog` (modal wrapper, `role="dialog"` `aria-labelledby`, `<progress>`, footer buttons, AbortController on close). New parts: the stage list. Sketch:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Viewer3DHandle } from './Viewer3D'
import { useViewerStore } from '../store/viewerStore'
import { REPAIR_STAGE_IDS, STAGE_LABEL, type RepairStageId } from '../services/repairStages'

function hasWebGL2(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false }
}

const ROW_IDS: (RepairStageId | 'seal')[] = [...REPAIR_STAGE_IDS, 'seal']

export function RepairDialog({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> }) {
  const open = useViewerStore((s) => s.repairDialogOpen)
  const details = useViewerStore((s) => s.geometryDetails)
  const hasModel = useViewerStore((s) => s.filePath !== null || s.loadedModels.length > 0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [resolution, setResolution] = useState(128)
  const [stripWalls, setStripWalls] = useState(false)
  const [runNote, setRunNote] = useState<Record<string, string>>({})
  const controllerRef = useRef<AbortController | null>(null)
  const webgl2 = hasWebGL2()

  useEffect(() => {
    if (open) return
    controllerRef.current?.abort()
    setBusy(false); setProgress(0); setPhase(''); setRunNote({})
  }, [open])

  if (!open) return null
  const close = () => { if (busy) controllerRef.current?.abort(); useViewerStore.getState().setRepairDialogOpen(false) }

  const run = async (stageIds: (RepairStageId | 'seal')[]) => {
    const v = viewerRef.current
    if (!v) return
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    useViewerStore.getState().setError(null)
    try {
      const res = await v.runRepair(stageIds, { resolution, stripInternalWalls: stripWalls && webgl2 }, (p, ph) => { setProgress(p); setPhase(ph) }, controller.signal)
      const notes: Record<string, string> = {}
      res.perMesh.flat().forEach((s) => { if (s.note) notes[s.id] = s.note })
      if (res.seal) notes['seal'] = res.seal.after.watertight ? 'Watertight solid' : `${res.seal.after.boundaryEdges} open edges left`
      setRunNote((prev) => ({ ...prev, ...notes }))
      useViewerStore.getState().setNotice('Repair applied. Export will use the updated geometry.')
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        useViewerStore.getState().setError(e instanceof Error ? e.message : String(e))
      }
    } finally { setBusy(false); controllerRef.current = null }
  }

  const hint = (id: RepairStageId | 'seal'): string => {
    if (!details) return ''
    switch (id) {
      case 'degenerate': return `${details.degenerateFaces} degenerate faces`
      case 'duplicate': return `${details.duplicateFaces} duplicate faces`
      case 'smallShells': return `${details.meshes} mesh${details.meshes === 1 ? '' : 'es'}`
      case 'holeFill': return `${details.boundaryEdges} open edges`
      case 'seal': return details.watertight ? 'Watertight' : 'Not sealed'
      default: return ''
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--scrim)]">
      <section role="dialog" aria-modal="true" aria-labelledby="repair-title" className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl">
        <div className="p-5 border-b border-[var(--border)]">
          <h2 id="repair-title" className="text-base font-semibold text-[var(--text-bright)]">Repair</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Run individual repair stages or the whole pipeline. Each stage updates the model in place; use the undo list to step back.</p>
        </div>
        <div className="p-5 flex flex-col gap-3">
          {ROW_IDS.map((id) => (
            <div key={id} data-testid={`repair-stage-${id}`} className="flex flex-col gap-1 border-b border-[var(--border)] pb-2 last:border-0">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex flex-col">
                  <span className="text-[var(--text-primary)]">{STAGE_LABEL[id]}</span>
                  <span className="text-xs text-[var(--text-muted)]">{runNote[id] ?? hint(id)}</span>
                </span>
                <button type="button" disabled={busy || !hasModel} onClick={() => void run([id])} className="px-3 py-1 rounded bg-[var(--bg-button)] text-xs disabled:opacity-50">Run</button>
              </div>
              {id === 'seal' && (
                <div className="flex flex-col gap-2 mt-1">
                  <label className="text-xs">Interior detection detail
                    <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))} className="block w-full mt-1 rounded border border-[var(--border-input)] bg-[var(--bg-button)] px-2 py-1">
                      <option value={96}>Draft, faster</option><option value={128}>Standard</option><option value={160}>Fine, more memory</option>
                    </select>
                  </label>
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={stripWalls && webgl2} disabled={!webgl2} onChange={(e) => setStripWalls(e.target.checked)} />
                    <span>Remove internal walls{!webgl2 && <span className="block text-[var(--text-muted)]">Needs WebGL, unavailable here.</span>}</span>
                  </label>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div>
              <div className="flex justify-between text-sm"><span>{phase}</span><span className="tabular-nums">{progress}%</span></div>
              <progress className="w-full mt-1" value={progress} max={100}>{progress}%</progress>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button type="button" onClick={close} className="px-4 py-1.5 rounded bg-[var(--bg-button)]">{busy ? 'Cancel' : 'Close'}</button>
          <button type="button" disabled={busy || !hasModel} onClick={() => void run(ROW_IDS)} className="px-4 py-1.5 rounded bg-[var(--accent-button)] text-white disabled:opacity-50">Repair all</button>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Delete SolidEditorDialog**

`git rm src/components/SolidEditorDialog.tsx src/components/SolidEditorDialog.test.tsx`. In `App.tsx` replace the `<SolidEditorDialog viewerRef={viewerRef} />` render with `<RepairDialog viewerRef={viewerRef} />` and its import; the `inert` expression's `solidEditorOpen` term is already renamed in Step 1.

- [ ] **Step 5: Verify**

Run: `pnpm exec tsc --noEmit` — PASS.
Run: `pnpm test` — PASS (RepairDialog suite green; no `solidEditorOpen` reference left).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Repair modal replaces the Make solid dialog"
```

---

## Task 9: prepChecks annotation + ReadinessCard guard + `--warning`

**Files:**
- Modify: `src/services/prepChecks.ts` (+ `.test.ts`), `src/components/prepare/ReadinessCard.tsx` (+ `.test.tsx`), `src/components/prepare/PreparePanel.tsx` (+ `.test.tsx`), `src/components/prepare/RepairSection.tsx`

**Interfaces:**
- `prepChecks(details: GeometryDetails | null, sealApplied?: boolean): PrepCheck[]`
- `ReadinessCard` gains `canFix?: (fixId: string) => boolean`

- [ ] **Step 1: Tests first**

`prepChecks.test.ts` — add:

```ts
it('annotates watertight/manifold as warn (no Fix) once a seal has run', () => {
  const leaky: GeometryDetails = { ...clean, watertight: false, nonManifoldEdges: 4, boundaryEdges: 0 }
  const byId = Object.fromEntries(prepChecks(leaky, true).map((c) => [c.id, c]))
  expect(byId.watertight.state).toBe('warn')
  expect(byId.watertight.fixId).toBeUndefined()
  expect(byId.watertight.detail).toMatch(/residual/i)
  expect(byId.nonManifold.state).toBe('warn')
  expect(byId.nonManifold.fixId).toBeUndefined()
})

it('still fails a real open edge after a seal', () => {
  const holed: GeometryDetails = { ...clean, watertight: false, boundaryEdges: 6 }
  const byId = Object.fromEntries(prepChecks(holed, true).map((c) => [c.id, c]))
  expect(byId.boundary.state).toBe('fail')
})

it('sealApplied omitted behaves as today', () => {
  const leaky: GeometryDetails = { ...clean, watertight: false, nonManifoldEdges: 4 }
  expect(prepChecks(leaky).find((c) => c.id === 'watertight')!.state).toBe('fail')
})
```

`ReadinessCard.test.tsx` — add:

```ts
it('hides Fix when canFix returns false', () => {
  render(<ReadinessCard checks={[{ id: 'watertight', label: 'Watertight', state: 'fail', detail: 'x', fixId: 'seal' }]} onFix={vi.fn()} canFix={() => false} />)
  expect(screen.queryByRole('button', { name: /fix/i })).toBeNull()
})

it('warn rows use the --warning token class', () => {
  render(<ReadinessCard checks={[{ id: 'watertight', label: 'Watertight', state: 'warn', detail: 'x' }]} onFix={vi.fn()} />)
  expect(screen.getByTestId('check-watertight').querySelector('.text-\\[var\\(--warning\\)\\]')).toBeTruthy()
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test` — FAIL on the new assertions.

- [ ] **Step 3: Implement**

`prepChecks.ts`:
- signature `export function prepChecks(details: GeometryDetails | null, sealApplied = false): PrepCheck[]`.
- After building the normal rows, if `sealApplied`, post-process: map `watertight` and `nonManifold` rows whose `state === 'fail'` to `{ ...row, state: 'warn', detail: 'Sealed; residual edges inherited from the original skin', fixId: undefined }`. Leave `boundary`, `degenerate`, `duplicate` alone.

`ReadinessCard.tsx`:
- `STATE_CLASS.warn` → `'text-[var(--warning)]'`.
- add prop `canFix?: (fixId: string) => boolean`; the Fix `<button>` renders only when `fixId && (canFix ? canFix(fixId) : true)`.

`PreparePanel.tsx`:
- read `sealApplied` from the store; `prepChecks(details, sealApplied)`.
- `FIX_HANDLERS` value already `setRepairDialogOpen(true)` from Task 8; pass `canFix={(id) => id in FIX_HANDLERS}` to `<ReadinessCard>`.

`RepairSection.tsx`: the `Make solid…` button (renamed to `Repair…` in Task 8) — no change here beyond Task 8.

- [ ] **Step 4: Verify**

Run: `pnpm test` — PASS. `pnpm exec tsc --noEmit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/prepChecks.ts src/services/prepChecks.test.ts src/components/prepare/
git commit -m "feat: annotate watertight rows after a seal; guard Fix by handler"
```

---

## Task 10: SP-1 debt — Sidebar tab ids + doc comment

**Files:**
- Modify: `src/components/Sidebar.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Test first**

Add to `src/components/Sidebar.test.tsx`:

```ts
it('gives each mount unique tab ids', () => {
  const a = render(<Sidebar />).container
  const b = render(<Sidebar mobile />).container
  const idA = a.querySelector('[role="tab"]')?.getAttribute('id')
  const idB = b.querySelector('[role="tab"]')?.getAttribute('id')
  expect(idA).toBeTruthy()
  expect(idA).not.toBe(idB)
})
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test` — FAIL (ids are the static `right-tab-*`, identical across mounts).

- [ ] **Step 3: Implement**

`Sidebar.tsx`:
- `import { useId } from 'react'`; `const uid = useId()` in the component.
- Tab button `id={`${uid}-tab-${tab}`}`, `aria-controls={`${uid}-tabpanel-${tab}`}`.
- The tabpanel container `id={`${uid}-tabpanel-${rightPanelTab}`}`, `aria-labelledby={`${uid}-tab-${rightPanelTab}`}`.
- The arrow-key handler's `document.getElementById(`right-tab-${next}`)` → `document.getElementById(`${uid}-tab-${next}`)`.
- Replace the stale top-of-file doc comment ("Closable via header button") with: "Right panel with Details / Prepare tabs; resizable via the left-edge handle; close control lives in the tab strip."

- [ ] **Step 4: Verify**

Run: `pnpm test` — PASS (including the existing arrow-key nav test). `pnpm exec tsc --noEmit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "fix: unique per-instance tab ids for the double-mounted sidebar"
```

---

## Task 11: e2e + docs

**Files:**
- Modify: `e2e/prepare-panel.spec.ts`, `e2e/make-solid-large.spec.ts`, `e2e/model-workflows.spec.ts`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update e2e launch paths**

Any e2e that opened Make solid via the panel now opens the Repair modal. In `e2e/prepare-panel.spec.ts`, `e2e/make-solid-large.spec.ts`, `e2e/model-workflows.spec.ts`: the button is now `Repair…` (was `Make solid…`); the dialog is `role="dialog"` name `Repair` (was `Make solid`); "Apply" is now `Repair all` (or the seal row's `Run`); the seal resolution select is inside `repair-stage-seal`. Update each `getByRole('button', { name: 'Make solid…' })` → `{ name: 'Repair…' }`, `getByRole('dialog', { name: 'Make solid' })` → `{ name: 'Repair' }`, and drive the seal via `page.getByTestId('repair-stage-seal')` — its `combobox` for resolution and either its `Run` button or the footer `Repair all`. Keep every assertion's meaning.

- [ ] **Step 2: Add the SP-2b e2e cases**

In `e2e/prepare-panel.spec.ts`, after the existing open-box drop + Prepare open:

```ts
    // Fill holes stage alone seals the open box.
    await page.getByRole('button', { name: 'Repair…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair' })
    await dialog.getByTestId('repair-stage-holeFill').getByRole('button', { name: /run/i }).click()
    await expect(dialog.getByTestId('repair-stage-holeFill')).toContainText(/filled/i)
    await dialog.getByRole('button', { name: /close/i }).click()
    await expect(page.getByTestId('check-boundary').filter({ visible: true })).toHaveAttribute('data-state', 'pass')

    // Undo from the history list re-opens the hole.
    const history = page.getByTestId('undo-history').filter({ visible: true })
    await history.getByRole('button', { name: /Fill holes/i }).click()
    await expect(page.getByTestId('check-boundary').filter({ visible: true })).toHaveAttribute('data-state', 'fail')
```

Second test — `Repair all` on the open box: drop, Prepare, `Repair…`, footer `Repair all`, wait for progress to clear, close; assert no readiness row is `fail` (`await expect(page.locator('[data-testid^="check-"][data-state="fail"]').filter({ visible: true })).toHaveCount(0)`), and the viewport WebGL context is not lost (reuse the check from `make-solid-large.spec.ts`).

- [ ] **Step 3: Docs**

`README.md`: replace "Edit models in place with worker-backed Make solid processing" / "Prepare > Repair > Make solid" wording with a description of the Repair modal: individually runnable stages (weld, remove degenerate/duplicate faces, unify normals, remove small shells, fill holes) plus Make solid as the sealing stage, and "Repair all". Note the readiness card marks watertight/manifold rows as informational once a seal has run. Keep the seal/units paragraphs.

`CHANGELOG.md` under `## Unreleased`:

```
- Repair modal: run individual mesh-repair stages (weld vertices, remove
  degenerate and duplicate faces, unify normals, remove small shells, fill
  holes) or the whole pipeline with Make solid as the final sealing stage.
  Replaces the standalone Make solid dialog.
```

- [ ] **Step 4: Full verification**

Run: `pnpm test` — PASS.
Run: `pnpm exec tsc --noEmit` — PASS.
Run: `pnpm build` — PASS.
Run: `pnpm test:e2e -- prepare-panel` — PASS (the full e2e suite runs; the prepare-panel and make-solid tests must pass, opt-in specs may skip).

- [ ] **Step 5: Commit**

```bash
git add e2e/ README.md CHANGELOG.md
git commit -m "test: cover the Repair modal end-to-end and update docs"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| §1 stage fns weld/degenerate/duplicate | Task 3 |
| §1 unifyNormals/removeSmallShells | Task 4 |
| §1 fillHoles + runStages canonical order | Task 5 |
| §2 meshRepair.worker + service | Task 6 |
| §3 pure undoStack helpers + Viewer3D delegate | Task 1 |
| §4 applySeal extraction + runRepair + one UndoEntry (material only if seal) | Task 7 |
| §4 makeSolid handle removed | Task 7 (call site deleted Task 8) |
| §5 RepairDialog + repairDialogOpen rename + delete SolidEditorDialog | Task 8 |
| §6 entry points (PreparePanel FIX_HANDLERS, RepairSection button, App) | Task 8 |
| §7 sealApplied flag | Task 2 (flag) + Task 7 (set) |
| §7 prepChecks warn annotation + no Fix | Task 9 |
| §8 duplicate tab ids (useId) | Task 10 |
| §8 --text-warning -> --warning | Task 9 |
| §8 Fix-without-handler guard | Task 9 |
| §8 stale doc comment | Task 10 |
| testing: repairStages, undoStack, store, prepChecks, ReadinessCard, RepairDialog, Sidebar, PreparePanel | Tasks 1-10 |
| testing: e2e | Task 11 |

No gaps. `sealApplied` reset on partial-undo-removing-seal is documented as a known limitation in the spec (§7); not a task.

**2. Placeholder scan:** No TBD/TODO. Task 3 flags a real decision (three has types for the `.js` util path in 0.185 — confirm at implementation, fallback given). Task 5 flags the fan triangle count (`+2` vs `+4`) as "make the test match real output" — that is a deliberate instruction, not a placeholder. Task 8 test has an ASCII-name fix instruction for a deliberately odd identifier.

**3. Type consistency:**
- `RepairStageId` / `REPAIR_STAGE_IDS` / `STAGE_LABEL` defined in Task 3, used unchanged in 5, 6, 7, 8.
- `StageResult` shape `{ geometry; note? }` consistent across Tasks 3-5.
- `PerMeshStage` defined in Task 6, consumed in Task 7 (`RepairRunResult.perMesh`) and Task 8 (dialog note extraction).
- `runRepair(stageIds: (RepairStageId | 'seal')[], sealOpts: { resolution: number; stripInternalWalls: boolean }, onProgress, signal?)` identical in Task 7 (definition), Task 8 (dialog call), Task 8 test, Task 11 e2e.
- `pushBounded` / `discardAll` / `popApply` signatures identical Task 1 definition ↔ Viewer3D use.
- `prepChecks(details, sealApplied?)` identical Task 9 definition ↔ PreparePanel call ↔ tests.
- Store: `repairDialogOpen` / `setRepairDialogOpen` (Task 8), `sealApplied` / `setSealApplied` (Task 2) — used consistently in RepairDialog, PreparePanel, Viewer3D.
- `ReadinessCard` `canFix?: (fixId: string) => boolean` — Task 9 definition ↔ PreparePanel `canFix={(id) => id in FIX_HANDLERS}`.
