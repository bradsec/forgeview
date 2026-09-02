# SP-2d: Split By Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split a multi-body preview model into individually named, toggleable, exportable in-memory parts as one undoable edit, from a new Prepare-panel "Split" section.

**Architecture:** A pure `splitByShell.ts` service labels connected components (union-find over merged vertex ids, the same labelling `removeSmallShells` uses) and emits each kept component as its own `BufferGeometry`, dropping sub-threshold fragments. `Viewer3D` gets a scene-level `splitPartsGroupRef` of real part meshes, a `splitByShell()` handle method that swaps the preview object for the parts group and pushes one `UndoEntry`, and a `getSplitPart(id)` accessor. A store `splitParts: SplitPart[]` carries the list; `PartsSection.tsx` renders the button + rows with visibility checkboxes and per-part Export. `ExportDialog` gains an `exportTargetId` so a part row's Export runs the existing export flow scoped to one part object.

**Tech Stack:** React 19, Three 0.185, Zustand 5, Vitest, Playwright, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-31-sp2d-split-by-shell-design.md`

## Global Constraints

- **No new npm dependency.** Reuse `three`, `meshTopology.ts` (`triModel` /
  `vertexTable` / `rebuild`), the SP-2a undo stack, `collectExportMeshes` /
  `exportMeshes`.
- **No redo, no rename, no per-part delete, no re-split.** The Split button is
  disabled while `splitParts.length > 0`; undo recombines.
- **Split targets the single-file preview only**, and exactly one
  `isRepairable` mesh (`!Array.isArray(m.material) && geometry.groups.length
  <= 1 && !geometry.getAttribute('uv') && !geometry.getAttribute('color')` —
  the exported `isRepairable` from `Viewer3D.tsx`). 0 or >1 repairable meshes,
  or `loadedModels.length > 0`, blocks with a thrown message string.
- **The original preview object is retained (not disposed) for undo** when
  split; its disposal happens exactly once, in the `UndoEntry.discard`.
- **`sealApplied` is never touched** by a split.
- **Undo label is exactly `'Split by shell'`.**
- **`minFraction` default `0.001`**, a function parameter, not surfaced in UI.
- **Part naming:** `` `${baseName} — part ${n}` `` (1-based), `baseName` =
  store `fileName` with a trailing extension stripped, or `'model'` when null.
- Verification gate for the whole plan: `pnpm test` green, `pnpm exec tsc
  --noEmit` clean, `pnpm build` clean, `pnpm test:e2e -- prepare-panel`
  passes.

---

### Task 1: `splitByShell.ts` — connected-component split service

**Files:**
- Create: `src/services/splitByShell.ts`
- Create: `src/services/splitByShell.test.ts`

**Interfaces:**
- Consumes: `triModel`, `vertexTable`, `rebuild` from `./meshTopology`.
- Produces:
  - `interface ShellSplitResult { parts: THREE.BufferGeometry[]; droppedFragments: number; droppedTriangles: number }`
  - `splitByShell(geo: THREE.BufferGeometry, minFraction?: number): ShellSplitResult`
    — `parts` ordered by descending triangle count, largest always kept,
    components below `minFraction * totalTriangles` dropped and counted. Input
    geometry never mutated. Single component in → `parts.length === 1`,
    `droppedFragments === 0`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { splitByShell } from './splitByShell'
import { analyzeGeometry } from './meshHealth'

/** N unit cubes as one non-indexed mesh, each offset +4 on X from the last */
function cubes(n: number): THREE.BufferGeometry {
  const unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
  const out = new Float32Array(unit.length * n)
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < unit.length; i += 3) {
      out[k * unit.length + i] = unit[i] + k * 4
      out[k * unit.length + i + 1] = unit[i + 1]
      out[k * unit.length + i + 2] = unit[i + 2]
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(out, 3))
  return g
}

/** one cube plus a 2-triangle speck far away */
function cubePlusSpeck(): THREE.BufferGeometry {
  const cube = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
  const speck = new Float32Array([
    50, 50, 50, 51, 50, 50, 50, 51, 50,
    51, 50, 50, 51, 51, 50, 50, 51, 50,
  ])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...cube, ...speck]), 3))
  return g
}

describe('splitByShell', () => {
  it('splits two separated cubes into two parts of equal size', () => {
    const src = cubes(2)
    const { parts, droppedFragments, droppedTriangles } = splitByShell(src)
    expect(parts.length).toBe(2)
    expect(droppedFragments).toBe(0)
    expect(droppedTriangles).toBe(0)
    const t0 = analyzeGeometry(parts[0]).triangles
    const t1 = analyzeGeometry(parts[1]).triangles
    expect(t0).toBe(12)
    expect(t1).toBe(12)
    // input untouched
    expect(src.getAttribute('position').count).toBe(72)
  })

  it('drops a sub-threshold speck and keeps the cube', () => {
    const { parts, droppedFragments, droppedTriangles } = splitByShell(cubePlusSpeck())
    expect(parts.length).toBe(1)
    expect(analyzeGeometry(parts[0]).triangles).toBe(12)
    expect(droppedFragments).toBe(1)
    expect(droppedTriangles).toBe(2)
  })

  it('returns a single part for one connected shell', () => {
    const { parts, droppedFragments } = splitByShell(new THREE.BoxGeometry(1, 1, 1))
    expect(parts.length).toBe(1)
    expect(droppedFragments).toBe(0)
  })

  it('orders parts largest first', () => {
    // cube (12 tris) at x=0, bigger cube (12 tris but scaled -> still 12) ...
    // use three cubes then remove the middle by making it a speck:
    const big = cubes(1).getAttribute('position').array as Float32Array           // 12 tris at x0
    const big2 = new Float32Array(big.length)
    for (let i = 0; i < big.length; i += 3) { big2[i] = big[i] + 20; big2[i + 1] = big[i + 1]; big2[i + 2] = big[i + 2] }
    const speck = new Float32Array([80,80,80, 81,80,80, 80,81,80])                // 1 tri, dropped
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...big, ...big2, ...speck]), 3))
    const { parts, droppedFragments } = splitByShell(g)
    expect(parts.length).toBe(2)
    expect(droppedFragments).toBe(1)
    expect(analyzeGeometry(parts[0]).triangles).toBeGreaterThanOrEqual(analyzeGeometry(parts[1]).triangles)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm exec vitest run src/services/splitByShell.test.ts`
Expected: FAIL — module not found / `splitByShell` undefined.

- [ ] **Step 3: Implement `src/services/splitByShell.ts`**

Mirror `removeSmallShells` in `src/services/repairStages.ts` — same
union-find, same keep rule — but emit one geometry per kept component.

```ts
import * as THREE from 'three'
import { triModel, vertexTable, rebuild } from './meshTopology'

export interface ShellSplitResult {
  parts: THREE.BufferGeometry[]
  droppedFragments: number
  droppedTriangles: number
}

/**
 * Label connected components by shared merged-vertex id (union-find, the same
 * labelling `removeSmallShells` uses) and emit each kept component as its own
 * non-indexed geometry. A component is kept when its triangle count is at
 * least `minFraction` of the total; the single largest component is always
 * kept. Dropped components are counted, not emitted. `parts` is ordered by
 * descending triangle count. The input geometry is never mutated.
 */
export function splitByShell(
  geo: THREE.BufferGeometry,
  minFraction = 0.001,
): ShellSplitResult {
  const { positions, tris, vertexCount } = triModel(geo)
  const table = vertexTable(positions, tris, vertexCount)

  const parent = Array.from({ length: vertexCount }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const union = (x: number, y: number) => { parent[find(x)] = find(y) }
  for (const tri of tris) { union(tri[0], tri[1]); union(tri[1], tri[2]) }

  const compTris = new Map<number, number[]>()
  tris.forEach((tri, ti) => {
    const r = find(tri[0])
    let list = compTris.get(r)
    if (!list) { list = []; compTris.set(r, list) }
    list.push(ti)
  })

  const groups = [...compTris.values()]
  const total = tris.length
  const maxLen = Math.max(...groups.map((g) => g.length))

  const kept: number[][] = []
  let droppedFragments = 0
  let droppedTriangles = 0
  for (const g of groups) {
    if (g.length === maxLen || g.length >= minFraction * total) kept.push(g)
    else { droppedFragments++; droppedTriangles += g.length }
  }

  kept.sort((a, b) => b.length - a.length)
  const parts = kept.map((g) => rebuild(g.map((ti) => tris[ti]), (id) => table[id]))

  return { parts, droppedFragments, droppedTriangles }
}
```

- [ ] **Step 4: Run the test, confirm pass**

Run: `pnpm exec vitest run src/services/splitByShell.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/splitByShell.ts src/services/splitByShell.test.ts
git commit -m "feat: splitByShell — connected-component split into part geometries"
```

---

### Task 2: Store — `splitParts` and `exportTargetId`

**Files:**
- Modify: `src/store/viewerStore.ts`
- Modify: `src/store/viewerStore.test.ts`

**Interfaces:**
- Produces (on `ViewerState`):
  - `interface SplitPart { id: string; name: string; triangleCount: number; visible: boolean }`
    (export it from `viewerStore.ts`)
  - `splitParts: SplitPart[]` (initial `[]`)
  - `setSplitParts: (parts: SplitPart[]) => void`
  - `setSplitPartVisible: (id: string, visible: boolean) => void`
  - `exportTargetId: string | null` (initial `null`)
  - `setExportTargetId: (id: string | null) => void`
  - `setFile` and `setFileFromBuffer` additionally reset `splitParts: []` and
    `exportTargetId: null`.

- [ ] **Step 1: Write the failing test**

Add to `src/store/viewerStore.test.ts` (match the file's `getState()` /
`setState()` / `beforeEach` reset style):

```ts
describe('split parts', () => {
  it('defaults empty with no export target', () => {
    const s = useViewerStore.getState()
    expect(s.splitParts).toEqual([])
    expect(s.exportTargetId).toBeNull()
  })

  it('setSplitPartVisible flips exactly the matching id', () => {
    useViewerStore.getState().setSplitParts([
      { id: 'a', name: 'A', triangleCount: 10, visible: true },
      { id: 'b', name: 'B', triangleCount: 20, visible: true },
    ])
    useViewerStore.getState().setSplitPartVisible('b', false)
    const parts = useViewerStore.getState().splitParts
    expect(parts.find((p) => p.id === 'a')!.visible).toBe(true)
    expect(parts.find((p) => p.id === 'b')!.visible).toBe(false)
  })

  it('setExportTargetId sets and clears', () => {
    useViewerStore.getState().setExportTargetId('x')
    expect(useViewerStore.getState().exportTargetId).toBe('x')
    useViewerStore.getState().setExportTargetId(null)
    expect(useViewerStore.getState().exportTargetId).toBeNull()
  })

  it('setFile resets split parts and export target', () => {
    useViewerStore.getState().setSplitParts([{ id: 'a', name: 'A', triangleCount: 1, visible: true }])
    useViewerStore.getState().setExportTargetId('a')
    useViewerStore.getState().setFile('/tmp/x.stl', 'x.stl', 'stl', 10)
    expect(useViewerStore.getState().splitParts).toEqual([])
    expect(useViewerStore.getState().exportTargetId).toBeNull()
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm exec vitest run src/store/viewerStore.test.ts -t "split parts"`
Expected: FAIL — properties undefined.

- [ ] **Step 3: Implement**

In `src/store/viewerStore.ts`:

Near `LoadedModel` (line ~22), add and export:

```ts
export interface SplitPart {
  id: string
  name: string
  triangleCount: number
  visible: boolean
}
```

In the `ViewerState` interface, next to `holeFillStatus`:

```ts
  splitParts: SplitPart[]
  setSplitParts: (parts: SplitPart[]) => void
  setSplitPartVisible: (id: string, visible: boolean) => void
  exportTargetId: string | null
  setExportTargetId: (id: string | null) => void
```

In the `create<ViewerState>` body, near the other initial values + setters:

```ts
  splitParts: [],
  setSplitParts: (parts) => set({ splitParts: parts }),
  setSplitPartVisible: (id, visible) =>
    set((state) => ({
      splitParts: state.splitParts.map((p) => (p.id === id ? { ...p, visible } : p)),
    })),
  exportTargetId: null,
  setExportTargetId: (id) => set({ exportTargetId: id }),
```

In `setFile`'s `set({...})` object, append: `splitParts: [], exportTargetId: null`.
In `setFileFromBuffer`'s `set({...})` object, append the same two.

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm exec vitest run src/store/viewerStore.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: splitParts + exportTargetId store fields"
```

---

### Task 3: Viewer3D — split, undo, part group, teardown

No dedicated unit test — jsdom has no WebGL, so `Viewer3D`'s renderer effects
cannot run (same as SP-2c Task 6). Verification = `pnpm exec tsc --noEmit`
clean + `pnpm build` clean + `Viewer3D.test.tsx` still green + Task 6 e2e.

**Files:**
- Modify: `src/components/Viewer3D.tsx`

**Interfaces:**
- Consumes: `splitByShell` from `../services/splitByShell`; store `splitParts`,
  `setSplitParts`, `fileName`; existing `modelGroupRef`, `modelMapRef`,
  `modelMeshes`, `withGeometry`, `isRepairable`, `pushUndo`, `applyViewMode`,
  `updateTriangleDetails`, `updateGeometryDetails`, `invalidate`,
  `rendererRef` / `sceneRef` / `cameraRef`, `disposeModel`, `getTheme`,
  `viewMode`.
- Produces (on `Viewer3DHandle`):
  - `splitByShell: () => { parts: number; droppedFragments: number }`
    — throws an `Error` with a user-facing message when not applicable.
  - `getSplitPart: (id: string) => THREE.Mesh | undefined`

- [ ] **Step 1: Add refs and extend `modelRoots()`**

Near `modelGroupRef` / `modelMapRef` (line ~110):

```ts
const splitPartsGroupRef = useRef<THREE.Group | undefined>(undefined)
const splitPartsRef = useRef<Map<string, THREE.Mesh>>(new Map())
```

`modelRoots()` (line ~148) — add the split group as a third source:

```ts
const modelRoots = () =>
  [modelGroupRef.current, ...modelMapRef.current.values(), splitPartsGroupRef.current]
    .filter((r): r is THREE.Object3D => Boolean(r))
```

- [ ] **Step 2: Add a local `applySplit` and the two handle methods**

Import at top: `import { splitByShell as splitGeometryByShell } from '../services/splitByShell'`.

Inside the component, a local helper (closes over the refs and store):

```ts
const baseModelName = () => {
  const n = useViewerStore.getState().fileName
  if (!n) return 'model'
  return n.replace(/\.[^./\\]+$/, '')
}

const teardownSplitParts = () => {
  const scene = sceneRef.current
  const group = splitPartsGroupRef.current
  if (group) {
    for (const m of splitPartsRef.current.values()) {
      m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat.dispose()
    }
    if (scene) scene.remove(group)
    group.clear()
    splitPartsGroupRef.current = undefined
  }
  splitPartsRef.current.clear()
}
```

Add to the `useImperativeHandle` object:

```ts
getSplitPart: (id: string) => splitPartsRef.current.get(id),

splitByShell: () => {
  const scene = sceneRef.current
  if (!scene) throw new Error('Split by shell needs an open 3D view')
  if (useViewerStore.getState().loadedModels.length > 0)
    throw new Error('Split by shell works on a single open model')
  const original = modelGroupRef.current
  if (!original) throw new Error('Split by shell works on a single open model')
  if (splitPartsGroupRef.current) throw new Error('Already split — undo Split by shell first')

  const meshes = withGeometry(modelMeshes()).filter(isRepairable)
  if (meshes.length === 0)
    throw new Error('No splittable mesh: the model uses textures or multiple materials')
  if (meshes.length > 1)
    throw new Error('Split by shell needs a single-mesh model')

  const mesh = meshes[0]
  const res = splitGeometryByShell(mesh.geometry as THREE.BufferGeometry)
  if (res.parts.length < 2) {
    res.parts.forEach((g) => g.dispose())
    throw new Error('Nothing to split: the model is a single connected shell')
  }

  mesh.updateWorldMatrix(true, false)
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3()
  mesh.matrixWorld.decompose(pos, quat, scl)

  const theme = getTheme(useViewerStore.getState().theme)
  const vm = useViewerStore.getState().viewMode
  const base = baseModelName()
  const group = new THREE.Group()
  group.userData.splitGroup = true

  const partMeta: { id: string; name: string; triangleCount: number; visible: boolean }[] = []
  res.parts.forEach((geo, i) => {
    const srcMat = mesh.material as THREE.Material
    const mat = srcMat.clone() as THREE.Material & { color?: THREE.Color }
    if (mat.color instanceof THREE.Color && mat.color.getHex() === 0xB0B0B0) mat.color.setHex(theme.modelColor)
    const partMesh = new THREE.Mesh(geo, mat)
    partMesh.position.copy(pos)
    partMesh.quaternion.copy(quat)
    partMesh.scale.copy(scl)
    const id = crypto.randomUUID()
    partMesh.userData.splitPartId = id
    partMesh.name = `${base} — part ${i + 1}`
    group.add(partMesh)
    splitPartsRef.current.set(id, partMesh)
    partMeta.push({
      id, name: partMesh.name,
      triangleCount: (geo.getAttribute('position') as THREE.BufferAttribute).count / 3,
      visible: true,
    })
  })

  scene.remove(original)                 // retain the object + ref for undo
  scene.add(group)
  splitPartsGroupRef.current = group
  applyViewMode(group, vm)
  useViewerStore.getState().setSplitParts(partMeta)

  pushUndo({
    label: 'Split by shell',
    apply: () => {
      teardownSplitParts()
      scene.add(original)
      modelGroupRef.current = original
      useViewerStore.getState().setSplitParts([])
    },
    discard: () => { disposeModel(original, scene) },
  })

  for (const root of modelRoots()) applyViewMode(root, useViewerStore.getState().viewMode)
  updateTriangleDetails()
  updateGeometryDetails()
  invalidate()
  if (rendererRef.current && sceneRef.current && cameraRef.current) {
    rendererRef.current.render(sceneRef.current, cameraRef.current)
  }
  return { parts: res.parts.length, droppedFragments: res.droppedFragments }
},
```

> If `getTheme` / `disposeModel` are imported under different local names in
> this file, use the existing names. Confirm `crypto.randomUUID` is available
> (it is in the app's browser + jsdom test targets; `Viewer3D.tsx` runs only
> in the browser).

- [ ] **Step 3: Visibility effect**

Add a `useEffect` keyed on the store `splitParts` (read it via a selector at
the top of the component, like `holeFillMode` is read):

```ts
const splitParts = useViewerStore((s) => s.splitParts)
useEffect(() => {
  let changed = false
  for (const p of splitParts) {
    const m = splitPartsRef.current.get(p.id)
    if (m && m.visible !== p.visible) { m.visible = p.visible; changed = true }
  }
  if (changed) invalidate()
}, [splitParts])
```

- [ ] **Step 4: Teardown wiring**

Where the preview-teardown path and the multi-model-id-change path already
call `clearUndo()` + `setHoleFillMode(false)` (search for
`setHoleFillMode(false)` — two call sites from SP-2c), add right after each:

```ts
teardownSplitParts()
useViewerStore.getState().setSplitParts([])
```

Rationale (spec §3): `clearUndo()` drains the stack and fires the split
entry's `discard` (disposing `original`); if the entry had already been
bounded out, its `discard` ran then. `teardownSplitParts()` only frees the
live part meshes + group, never `original`.

In the Effect 1 cleanup (the renderer/scene teardown return function), call
`teardownSplitParts()` before `disposeViewerResources(...)` so the split
group's geometries/materials are freed on unmount.

- [ ] **Step 5: Raycast targets + selection guard**

- The `dblclick` recenter handler (~line 598) and the multi-model selection
  raycast (~line 1093) both build a `targets` array from `modelGroupRef.current`
  + `modelMapRef` values. Add `if (splitPartsGroupRef.current)
  targets.push(splitPartsGroupRef.current)` in both.
- In the multi-model selection handler, after a hit, if the hit object (or an
  ancestor) has `userData.splitPartId` and there is no matching `loadedModels`
  entry, treat it as no selection (return / do nothing) rather than looking up
  a model by id. Read the handler first; if it already no-ops on an unknown
  id, no change needed — note that in the report.

- [ ] **Step 6: Typecheck + existing suite + build**

Run: `pnpm exec tsc --noEmit` → clean.
Run: `pnpm exec vitest run src/components/Viewer3D.test.tsx` → still green.
Run: `pnpm build` → clean.
Run: `pnpm test` → full suite green (no new tests this task; expect the Task 2
count).

- [ ] **Step 7: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: Viewer3D splitByShell — part group, undo entry, teardown"
```

---

### Task 4: ExportDialog — scoped per-part export

**Files:**
- Modify: `src/components/ExportDialog.tsx`
- Modify: `src/components/ExportDialog.test.tsx`

**Interfaces:**
- Consumes: store `exportTargetId`, `setExportTargetId`, `splitParts`;
  `viewerRef.current.getSplitPart(id)` (Task 3); existing `getScene`,
  `collectExportMeshes`, `exportMeshes`, `exportFileName`.
- Produces: no new exports. Behaviour: when `exportTargetId` is set, the
  dialog title reads `Export — {partName}`, `runExport` collects meshes from
  the part object instead of the whole scene, and the default filename uses
  the part name. The dialog's `close()` clears `exportTargetId`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/ExportDialog.test.tsx` (match its existing render +
store-seed + stub-viewerRef style):

```ts
import * as THREE from 'three'

it('scopes export to a split part when exportTargetId is set', async () => {
  const part = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
  const getSplitPart = vi.fn(() => part)
  const getScene = vi.fn(() => new THREE.Scene())
  const viewerRef = { current: { getSplitPart, getScene } } as unknown as React.RefObject<Viewer3DHandle>
  useViewerStore.setState({
    exportOpen: true,
    exportTargetId: 'p1',
    splitParts: [{ id: 'p1', name: 'widget — part 1', triangleCount: 12, visible: true }],
    pendingModelLoads: 0,
  })
  render(<ExportDialog viewerRef={viewerRef} />)
  expect(screen.getByText(/widget — part 1/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^export$/i }))
  expect(getSplitPart).toHaveBeenCalledWith('p1')
})

it('clears exportTargetId on close', async () => {
  useViewerStore.setState({ exportOpen: true, exportTargetId: 'p1' })
  const viewerRef = { current: { getScene: () => new THREE.Scene(), getSplitPart: () => undefined } } as unknown as React.RefObject<Viewer3DHandle>
  render(<ExportDialog viewerRef={viewerRef} />)
  await userEvent.click(screen.getByRole('button', { name: /close/i }))
  expect(useViewerStore.getState().exportTargetId).toBeNull()
})
```

Check the real `Viewer3DHandle` import path and the existing test's helpers;
reuse them. If the existing suite already imports `userEvent` / `screen`, do
not re-import.

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm exec vitest run src/components/ExportDialog.test.tsx`
Expected: FAIL — title text absent / `getSplitPart` not called / target not cleared.

- [ ] **Step 3: Implement**

In `src/components/ExportDialog.tsx`:

Read the new store bits near the other selectors:

```ts
const exportTargetId = useViewerStore((s) => s.exportTargetId)
const splitParts = useViewerStore((s) => s.splitParts)
const targetPart = exportTargetId ? splitParts.find((p) => p.id === exportTargetId) ?? null : null
```

`close()` (line ~35) — add the reset:

```ts
const close = () => {
  if (!busy) {
    useViewerStore.getState().setExportOpen(false)
    useViewerStore.getState().setExportTargetId(null)
  }
}
```

The success path currently calls `store.setExportOpen(false)` directly (line
~102) — change that to also clear: `store.setExportOpen(false);
store.setExportTargetId(null)` (or call `close()` there if `busy` is already
false at that point — check).

`runExport()` — replace the scene lookup:

```ts
let root: import('three').Object3D | undefined
if (exportTargetId) {
  root = viewerRef.current?.getSplitPart(exportTargetId)
  if (!root) { store.setError('That part is no longer in the scene'); return }
} else {
  root = viewerRef.current?.getScene()
  if (!root) { store.setError('Export needs an open 3D view'); return }
}
// pendingModelLoads guard stays as-is
// ...
meshes = collectExportMeshes(root)
```

Filename default: where `exportFileName(fileName, format)` is used, pass
`targetPart ? targetPart.name : fileName`.

Title: the `<h2 id="export-title">` text (line ~129) becomes
`{targetPart ? `Export — ${targetPart.name}` : 'Export model'}`.

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm exec vitest run src/components/ExportDialog.test.tsx`
Expected: all PASS (new + existing).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ExportDialog.tsx src/components/ExportDialog.test.tsx
git commit -m "feat: ExportDialog scoped export for a split part"
```

---

### Task 5: PartsSection + PreparePanel / Sidebar / App wiring

**Files:**
- Create: `src/components/prepare/PartsSection.tsx`
- Create: `src/components/prepare/PartsSection.test.tsx`
- Modify: `src/components/prepare/PreparePanel.tsx`
- Modify: `src/components/prepare/PreparePanel.test.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: store `splitParts`, `setSplitPartVisible`, `setExportTargetId`,
  `setExportOpen`, `setError`, `setNotice`, `filePath`, `loadedModels`,
  `pendingModelLoads`; `viewerRef.current.splitByShell()` (Task 3).
- Produces: `PartsSection` component, prop `{ viewerRef:
  React.RefObject<Viewer3DHandle | null> }`. `PreparePanel` gains a
  `viewerRef` prop and renders `<PartsSection viewerRef={viewerRef} />` after
  `<RepairSection>`. `Sidebar` gains a `viewerRef` prop forwarded to
  `PreparePanel`. `App.tsx` passes `viewerRef` to both `<Sidebar>` mounts.

- [ ] **Step 1: Write the failing test — `PartsSection.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PartsSection } from './PartsSection'
import { useViewerStore } from '../../store/viewerStore'
import type { Viewer3DHandle } from '../Viewer3D'

function stubRef(over: Partial<Viewer3DHandle> = {}) {
  return { current: { splitByShell: vi.fn(() => ({ parts: 2, droppedFragments: 0 })), ...over } } as unknown as React.RefObject<Viewer3DHandle | null>
}

beforeEach(() => {
  useViewerStore.setState({
    filePath: '/tmp/x.stl', loadedModels: [], pendingModelLoads: 0,
    splitParts: [], exportTargetId: null, exportOpen: false, error: null, notice: null,
  })
})

describe('PartsSection', () => {
  it('enables the Split button with a single preview model', () => {
    render(<PartsSection viewerRef={stubRef()} />)
    expect(screen.getByRole('button', { name: 'Split by shell' })).toBeEnabled()
  })

  it('disables Split with no model, in multi-model mode, and while already split', () => {
    useViewerStore.setState({ filePath: null })
    const { rerender } = render(<PartsSection viewerRef={stubRef()} />)
    expect(screen.getByRole('button', { name: 'Split by shell' })).toBeDisabled()

    useViewerStore.setState({ filePath: '/tmp/x.stl', loadedModels: [{ id: 'm', path: '/a', name: 'a', extension: 'stl', sizeBytes: 1, triangleCount: 1 }] })
    rerender(<PartsSection viewerRef={stubRef()} />)
    expect(screen.getByRole('button', { name: 'Split by shell' })).toBeDisabled()

    useViewerStore.setState({ loadedModels: [], splitParts: [{ id: 'a', name: 'A', triangleCount: 5, visible: true }] })
    rerender(<PartsSection viewerRef={stubRef()} />)
    expect(screen.getByRole('button', { name: 'Split by shell' })).toBeDisabled()
  })

  it('calls splitByShell and routes a thrown message to setError', async () => {
    const ref = stubRef({ splitByShell: vi.fn(() => { throw new Error('Nothing to split: the model is a single connected shell') }) })
    render(<PartsSection viewerRef={ref} />)
    await userEvent.click(screen.getByRole('button', { name: 'Split by shell' }))
    expect(ref.current!.splitByShell).toHaveBeenCalled()
    expect(useViewerStore.getState().error).toMatch(/nothing to split/i)
  })

  it('renders a row per part and toggles visibility', async () => {
    useViewerStore.setState({ splitParts: [
      { id: 'a', name: 'x — part 1', triangleCount: 12340, visible: true },
      { id: 'b', name: 'x — part 2', triangleCount: 8102, visible: true },
    ] })
    render(<PartsSection viewerRef={stubRef()} />)
    expect(screen.getByText(/12,340/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show x — part 2' }))
    expect(useViewerStore.getState().splitParts.find((p) => p.id === 'b')!.visible).toBe(false)
  })

  it('Export sets exportTargetId and opens the dialog', async () => {
    useViewerStore.setState({ splitParts: [{ id: 'a', name: 'x — part 1', triangleCount: 1, visible: true }] })
    render(<PartsSection viewerRef={stubRef()} />)
    await userEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(useViewerStore.getState().exportTargetId).toBe('a')
    expect(useViewerStore.getState().exportOpen).toBe(true)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm exec vitest run src/components/prepare/PartsSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PartsSection.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useViewerStore } from '../../store/viewerStore'
import type { Viewer3DHandle } from '../Viewer3D'

export function PartsSection({ viewerRef }: { viewerRef: React.RefObject<Viewer3DHandle | null> }) {
  const splitParts = useViewerStore((s) => s.splitParts)
  const hasModel = useViewerStore((s) => s.filePath !== null)
  const multiModel = useViewerStore((s) => s.loadedModels.length > 0)
  const pending = useViewerStore((s) => s.pendingModelLoads)
  const [note, setNote] = useState<string | null>(null)

  const disabled = !hasModel || multiModel || pending > 0 || splitParts.length > 0

  useEffect(() => { if (splitParts.length === 0) setNote(null) }, [splitParts.length])

  const runSplit = () => {
    try {
      const { droppedFragments } = viewerRef.current!.splitByShell()
      setNote(droppedFragments > 0
        ? `${droppedFragments} tiny fragment${droppedFragments === 1 ? '' : 's'} removed`
        : null)
    } catch (e) {
      useViewerStore.getState().setError(e instanceof Error ? e.message : 'Split failed')
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Split
      </h3>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Separate a multi-body model into individually named parts. Tiny fragments
        are dropped. Undo &ldquo;Split by shell&rdquo; from the history to recombine.
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={runSplit}
        className="mt-3 px-3 py-1.5 rounded bg-[var(--accent-button)] text-white text-sm self-start disabled:opacity-50"
      >
        Split by shell
      </button>
      {note && <p className="mt-2 text-xs text-[var(--text-muted)]">{note}</p>}
      {splitParts.length > 0 && (
        <ul data-testid="split-parts" className="mt-3 flex flex-col gap-1">
          {splitParts.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={p.visible}
                aria-label={`Show ${p.name}`}
                onChange={(e) => useViewerStore.getState().setSplitPartVisible(p.id, e.target.checked)}
              />
              <span className="flex-1 text-[var(--text-primary)]">{p.name}</span>
              <span className="text-[var(--text-muted)]">{p.triangleCount.toLocaleString()} tris</span>
              <button
                type="button"
                onClick={() => {
                  useViewerStore.getState().setExportTargetId(p.id)
                  useViewerStore.getState().setExportOpen(true)
                }}
                className="px-2 py-0.5 rounded bg-[var(--bg-button)]"
              >
                Export
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire `PreparePanel` / `Sidebar` / `App`**

`src/components/prepare/PreparePanel.tsx`:

```tsx
import { PartsSection } from './PartsSection'
import type { Viewer3DHandle } from '../Viewer3D'

export function PreparePanel({
  onUndoEdit,
  viewerRef,
}: {
  onUndoEdit?: (steps?: number) => void
  viewerRef: React.RefObject<Viewer3DHandle | null>
}) {
  // ...existing body...
  //   <RepairSection onUndoEdit={onUndoEdit} />
  //   <PartsSection viewerRef={viewerRef} />
}
```

`src/components/Sidebar.tsx` — the signature (line ~19) becomes:

```tsx
export function Sidebar({ mobile = false, onUndoEdit, viewerRef }: {
  mobile?: boolean
  onUndoEdit?: (steps?: number) => void
  viewerRef: React.RefObject<Viewer3DHandle | null>
} = { viewerRef: { current: null } }) {
```

Pass `viewerRef` into `<PreparePanel onUndoEdit={onUndoEdit} viewerRef={viewerRef} />`.
Import the `Viewer3DHandle` type. (The default arg is only to satisfy the
existing `= {}` call pattern in tests; every real call passes `viewerRef`.
If the file's existing tests render `<Sidebar />` bare, update them to pass
`viewerRef={{ current: null }}` — check `Sidebar.test.tsx`.)

`src/App.tsx` — both `<Sidebar ... />` mounts (lines ~105, ~112) get
`viewerRef={viewerRef}` (the ref already exists at line 44).

- [ ] **Step 5: Update `PreparePanel.test.tsx`**

Every `render(<PreparePanel ... />)` gets `viewerRef={{ current: null }}`
added. Add one assertion: `expect(screen.getByRole('button', { name: 'Split
by shell' })).toBeInTheDocument()`. Keep all existing assertions.

- [ ] **Step 6: Run the affected suites + typecheck**

Run: `pnpm exec vitest run src/components/prepare/PartsSection.test.tsx src/components/prepare/PreparePanel.test.tsx src/components/Sidebar.test.tsx`
Expected: all PASS.
Run: `pnpm exec tsc --noEmit` → clean.
Run: `pnpm test` → full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/components/prepare/PartsSection.tsx src/components/prepare/PartsSection.test.tsx src/components/prepare/PreparePanel.tsx src/components/prepare/PreparePanel.test.tsx src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/App.tsx
git commit -m "feat: Prepare panel Split section with per-part visibility and export"
```

---

### Task 6: End-to-end — split a two-body model

**Files:**
- Modify: `e2e/prepare-panel.spec.ts`

**Interfaces:**
- Consumes: the app end to end. Reuse the `dropOpenBox`-style helper pattern
  (build an ASCII STL in-test, dispatch a `drop` DragEvent).

- [ ] **Step 1: Add a two-cube fixture + the test**

Append inside `test.describe('Prepare panel', ...)`:

```ts
/** ASCII STL of two axis-aligned 10mm cubes, the second offset +30 on X.
 *  One solid, two disconnected shells: 24 triangles total. */
function twoCubesStl(): string {
  const cube = (ox: number) => {
    const s = 10
    const v = [
      [ox, 0, 0], [ox + s, 0, 0], [ox + s, s, 0], [ox, s, 0],
      [ox, 0, s], [ox + s, 0, s], [ox + s, s, s], [ox, s, s],
    ]
    const tris = [
      [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
      [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6],
      [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4],
    ]
    let out = ''
    for (const [a, b, c] of tris) {
      out += 'facet normal 0 0 0\nouter loop\n'
      for (const i of [a, b, c]) out += `vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}\n`
      out += 'endloop\nendfacet\n'
    }
    return out
  }
  return `solid two\n${cube(0)}${cube(30)}endsolid two\n`
}

async function dropStl(page: Page, stl: string, name: string): Promise<void> {
  await page.goto('/')
  await page.evaluate(({ stl, name }) => {
    const file = new File([stl], name, { type: 'model/stl' })
    const dt = new DataTransfer()
    dt.items.add(file)
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, { stl, name })
  await expect(page.getByRole('banner')).toContainText(name)
  await expect(page.getByRole('navigation', { name: 'Camera navigation' })).toBeVisible()
}

test('splits a two-body model into parts and recombines on undo', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Split flow verified on desktop')
  test.setTimeout(120_000)

  await dropStl(page, twoCubesStl(), 'two.stl')
  await page.getByRole('button', { name: 'Prepare' }).click()

  const splitBtn = page.getByRole('button', { name: 'Split by shell' }).filter({ visible: true })
  await expect(splitBtn).toBeEnabled()
  await splitBtn.click()

  const parts = page.getByTestId('split-parts').filter({ visible: true })
  await expect(parts.getByRole('listitem')).toHaveCount(2)
  await expect(parts).toContainText('tris')
  await expect(splitBtn).toBeDisabled()

  // hide part 2
  const p2 = parts.getByRole('checkbox').nth(1)
  await p2.uncheck()
  await expect(p2).not.toBeChecked()

  // undo the split from the history list -> back to one model, list gone
  const history = page.getByTestId('undo-history').filter({ visible: true })
  await history.getByRole('button', { name: /split by shell/i }).click()
  await expect(page.getByTestId('split-parts').filter({ visible: true })).toHaveCount(0)
  await expect(splitBtn).toBeEnabled()
})
```

If the file already has a generic `dropStl`-style helper, reuse it instead of
adding another. `Page` is already imported in this spec.

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e -- prepare-panel`
Expected: the new test plus every existing Prepare-panel test pass.

- [ ] **Step 3: If the split assertion fails**

Diagnose before patching:
- `Split by shell` disabled when it should be enabled → the `disabled`
  predicate in `PartsSection` (`filePath` null? `pendingModelLoads` not back
  to 0?). Wait on `pendingModelLoads` settling, or on the button being
  enabled, before clicking.
- 2 rows not appearing → `splitByShell()` threw (the two cubes share no
  vertices, so `splitByShell` should yield 2 parts; check the fixture's cubes
  are genuinely disjoint — offset 30 vs size 10 is disjoint) or the store
  `splitParts` didn't propagate. Check `setSplitParts` is called in the
  handle method.
- Report a real Task 1-5 bug as DONE_WITH_CONCERNS / BLOCKED with specifics
  rather than loosening the assertion.

- [ ] **Step 4: Commit**

```bash
git add e2e/prepare-panel.spec.ts
git commit -m "test: e2e split-by-shell into parts and undo"
```

---

### Task 7: Docs and roadmap status

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`

- [ ] **Step 1: README**

In the Prepare panel section of `README.md`, add:

```md
- **Split by shell** — separate a multi-body model into individually named
  parts, each with its own visibility toggle and Export. Tiny disconnected
  fragments are dropped. Undo "Split by shell" from the history to recombine.
  Works on a single-mesh preview model (not multi-model mode, not textured or
  multi-material meshes).
```

- [ ] **Step 2: CHANGELOG**

Under `## Unreleased` in `CHANGELOG.md`:

```md
- Prepare > Split: **Split by shell** — break a multi-body model into named,
  toggleable, individually exportable parts, as one undoable edit.
```

- [ ] **Step 3: Roadmap status**

In `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`, the SP-2
decomposition table, change the SP-2d row `Status` from `Not started. ...` to:

```md
SHIPPED, branch `sp2d-split-by-shell`, commits <first>..<last>.
`src/services/splitByShell.ts` (union-find component split into part
geometries, sub-threshold fragments dropped), `Viewer3D.splitByShell` handle
(scene-level part group, one `Split by shell` undo entry, retained pre-split
object restored on undo), `splitParts` / `exportTargetId` store,
`PartsSection.tsx` (Split button + per-part visibility + Export),
`ExportDialog` scoped export. Spec:
`2026-08-31-sp2d-split-by-shell-design.md`; plan:
`../plans/2026-09-02-sp2d-split-by-shell.md`. **SP-2 (staged auto-repair) is
now complete** (SP-2a/b/c/d all shipped).
```

Fill the commit range from `git log` after Task 6.

- [ ] **Step 4: Full verification gate**

Run: `pnpm test` → green.
Run: `pnpm exec tsc --noEmit` → clean.
Run: `pnpm build` → clean.
Run: `pnpm test:e2e -- prepare-panel` → green.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md
git commit -m "docs: record SP-2d split-by-shell"
```

---

## Self-Review

**Spec coverage:**

- Spec §1 `splitByShell.ts` → Task 1.
- Spec §2 store `splitParts` / `setSplitParts` / `setSplitPartVisible` /
  `exportTargetId` / `setExportTargetId` + `setFile`/`setFileFromBuffer`
  resets → Task 2.
- Spec §3 Viewer3D `splitPartsGroupRef` / `splitPartsRef`, `modelRoots()`
  extension, `splitByShell()` + `getSplitPart()` handle methods, one
  `'Split by shell'` `UndoEntry` (retain original, dispose in `discard`),
  visibility effect, teardown block, Effect 1 unmount disposal → Task 3.
- Spec §4 traversal audit (raycast targets, selection guard) → Task 3 Step 5.
- Spec §5 `ExportDialog` scoped export (`exportTargetId`, `getSplitPart`,
  title, filename, close reset) → Task 4.
- Spec §6 `PartsSection.tsx` + `PreparePanel` / `Sidebar` / `App` wiring →
  Task 5.
- Spec §7 docs → Task 7.
- Spec Testing list: `splitByShell.test.ts` → Task 1; `viewerStore.test.ts`
  → Task 2; `PartsSection.test.tsx` → Task 5; `ExportDialog.test.tsx` → Task
  4; `PreparePanel.test.tsx` → Task 5; e2e → Task 6. (Viewer3D has no unit
  test by design — jsdom has no WebGL; stated in Task 3.)
- Spec Risks: retained-original disposal ordering (Task 3 `discard` +
  teardown-only-touches-parts note), `modelRoots()` third source (Task 3 Step
  5 audit), part world transform (Task 3 Step 2 decomposes `matrixWorld`),
  material cloning + disposal (Task 3 `teardownSplitParts` + `UndoEntry`),
  selection raycast guard (Task 3 Step 5), large models (accepted).

No spec requirement is left without a task.

**Placeholder scan:** No `TBD` / `TODO` / "handle edge cases" / "similar to
Task N". Every code step carries the actual code. Task 3's "confirm the
existing local import name for `getTheme` / `disposeModel`" and Task 4's
"check whether `close()` can be called on the success path" are explicit
verification instructions, not deferred work.

**Type consistency:**

- `ShellSplitResult { parts: THREE.BufferGeometry[]; droppedFragments: number; droppedTriangles: number }`
  — Task 1 defines, Task 3 consumes (`res.parts`, `res.droppedFragments`).
- `SplitPart { id: string; name: string; triangleCount: number; visible: boolean }`
  — Task 2 defines and exports from `viewerStore.ts`; Task 3 builds the array,
  Task 5 renders it. Field names identical across all three.
- Store setters `setSplitParts` / `setSplitPartVisible` / `setExportTargetId`
  — Task 2 signatures match every call in Tasks 3, 4, 5.
- `Viewer3DHandle.splitByShell: () => { parts: number; droppedFragments: number }`
  and `getSplitPart: (id: string) => THREE.Mesh | undefined` — Task 3 adds;
  Task 4 calls `getSplitPart(id)`, Task 5 calls `splitByShell()` and reads
  `.droppedFragments`.
- Undo label string `'Split by shell'` — identical in Task 3 (`pushUndo`),
  Task 6 e2e (`name: /split by shell/i`), Task 7 roadmap text.
- `exportTargetId` — Task 2 defines, Task 4 reads + clears, Task 5 sets.
- The pure service and the handle method are both named `splitByShell`; Task 3
  imports the service as `splitGeometryByShell` (spec §3 note). The plan uses
  that alias consistently in Task 3's code.
