# SP-6a: manifold-3d integration + plane cut

**Status:** implemented 2026-09-09. The original design below is historical; implementation adds undoable part deletion, cancellation, exact vertex welding, and stale-result rejection.
**Roadmap:** SP-6 decomposition, first cycle. SP-6b (booleans) reuses this
cycle's worker and geometry bridge.
**Depends on:** SP-3 (mm scale), SP-4c (the clip-plane store fields
`clipAxis` / `clipOffset` / `clipFlip` and `computeClipPlane` in Viewer3D),
SP-2d (the split-parts group machinery this feature's output plugs into).

## Goal

Bring `manifold-3d` into the app as a persistent web worker, bridge a
`THREE.BufferGeometry` to a `Manifold`, and ship an axis-aligned plane cut:
the user positions the existing visual clip plane (SP-4c), presses "Cut at
plane", and the model is sliced into two watertight shells that land in the
same split-parts group Split by shell uses. One undoable "Plane cut" edit.

## Non-goals (no task, deliberate)

- Boolean union / subtract / intersect. That is SP-6b, on top of this
  cycle's worker.
- A non-axis-aligned or draggable cut plane. The cut uses the SP-4c clip
  plane, which is axis-aligned with a slider offset.
- Alignment-pin holes in the cut face. A later cycle (catalogue 6, "boolean
  with (5)").
- Keeping only one side. The cut always produces both shells; the user
  deletes the unwanted one from the Parts section, keeping at least one part.
- Cutting a multi-model scene, a split model, or a textured / multi-material
  mesh. Same eligibility rules as Split by shell.
- A progress bar. The cut is a single worker round trip; a busy state on the
  button is enough.
- Falling back to a JS clip when the wasm fails to load. If manifold cannot
  initialise, the button reports the error and does nothing.

## Architecture

### Dependency

`manifold-3d` (exact-pinned, the version resolved at implementation time),
in `dependencies`. It ships `manifold.js` + `manifold.wasm`. Roadmap
preauthorises it for SP-6.

### wasm asset under Vite

The Emscripten loader fetches `manifold.wasm` relative to itself; under Vite
that path does not survive bundling, so pass an explicit URL:

```ts
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import Module from 'manifold-3d'

const wasm = await Module({ locateFile: () => wasmUrl })
wasm.setup()
```

`?url` works the same inside a module worker. No `vite.config.ts` change is
needed for this (Vite serves `?url` assets from `node_modules`); if the
build warns about the wasm asset size, that is expected and fine.

### Worker (`src/services/manifold.worker.ts`) - new file

Module worker, mirrors the message shape of `meshRepair.worker.ts` but
keeps its wasm instance across calls (init is ~100 ms and ~1 MB).

```ts
/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'

const scope = self as DedicatedWorkerGlobalScope
let wasmPromise: Promise<ManifoldToplevel> | null = null

const getWasm = () => {
  if (!wasmPromise) {
    wasmPromise = Module({ locateFile: () => wasmUrl }).then((w) => {
      w.setup()
      return w
    })
  }
  return wasmPromise
}

interface CutRequest {
  id: number
  /** Non-indexed world-space triangle soup, 9 floats per triangle. */
  positions: ArrayBuffer
  /** Cut plane: keep where dot(normal, p) - offset >= 0 for partA. */
  normal: [number, number, number]
  offset: number
}

scope.onmessage = async (e: MessageEvent<CutRequest>) => {
  const { id, normal, offset } = e.data
  try {
    const { Manifold, Mesh } = await getWasm()
    const soup = new Float32Array(e.data.positions)

    // Weld the soup into a manifold vertex set: quantise positions to a grid,
    // reuse the index of a coincident vertex. Manifold needs shared vertices
    // along shared edges or the input is not 2-manifold.
    const weld = weldSoup(soup) // { vertProperties: Float32Array, triVerts: Uint32Array }

    const mesh = new Mesh({ numProp: 3, vertProperties: weld.vertProperties, triVerts: weld.triVerts })
    mesh.merge()
    const solid = new Manifold(mesh)

    if (solid.status().value !== 0 || solid.isEmpty()) {
      solid.delete()
      scope.postMessage({ id, type: 'error', message: 'The model is not a closed solid. Run Repair, then try the cut again.' })
      return
    }

    const nn: [number, number, number] = [-normal[0], -normal[1], -normal[2]]
    const a = solid.trimByPlane(normal, offset)
    const b = solid.trimByPlane(nn, -offset)
    solid.delete()

    const outA = a.getMesh()
    const outB = b.getMesh()
    a.delete()
    b.delete()

    const partA = meshToSoup(outA) // Float32Array, 9 floats / tri, from vertProperties + triVerts
    const partB = meshToSoup(outB)
    scope.postMessage({ id, type: 'result', partA, partB }, [partA.buffer, partB.buffer])
  } catch (err) {
    scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
```

`weldSoup` and `meshToSoup` are small pure helpers in the worker file (or a
shared `manifoldBridge.ts` that the worker imports - keep them out of the
main bundle). `meshToSoup` expands `vertProperties` (stride `numProp`, first
3 = position) through `triVerts` into a flat non-indexed `Float32Array`, so
the result drops straight into a `BufferGeometry` the way the rest of the
app expects.

### Service (`src/services/planeCut.ts`) - new file

A lazy module-singleton worker (unlike `meshRepair`, which spawns per call -
here the wasm init cost makes a persistent worker worthwhile).

```ts
export interface PlaneCutResult {
  partA: Float32Array
  partB: Float32Array
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: PlaneCutResult) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./manifold.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const { id, type } = e.data
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (type === 'result') p.resolve({ partA: e.data.partA, partB: e.data.partB })
      else p.reject(new Error(e.data.message ?? 'Plane cut failed'))
    }
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Plane cut worker crashed'))
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

/** `positions` is a non-indexed world-space triangle soup. The plane keeps
 *  `dot(normal, p) - offset >= 0` for `partA`. */
export function cutByPlane(
  positions: Float32Array,
  normal: [number, number, number],
  offset: number,
): Promise<PlaneCutResult> {
  const id = nextId++
  const buf = positions.slice().buffer
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, positions: buf, normal, offset }, [buf])
  })
}
```

### Viewer3D (`src/components/Viewer3D.tsx`)

New handle method, ASYNC (the worker round trip), mirroring `splitByShell`'s
guards and its split-parts assembly, plus `runRepair`'s async shape.

```ts
export type PlaneCutOutcome =
  | { status: 'cut' }
  | { status: 'ineligible'; reason: string }
  | { status: 'empty' }
```

```ts
cutAtPlane: async () => {
  const scene = sceneRef.current
  if (!scene) return { status: 'ineligible' as const, reason: 'Plane cut needs an open 3D view' }
  if (useViewerStore.getState().loadedModels.length > 0)
    return { status: 'ineligible' as const, reason: 'Plane cut works on a single open model' }
  const original = modelGroupRef.current
  if (!original) return { status: 'ineligible' as const, reason: 'Plane cut works on a single open model' }
  if (splitPartsGroupRef.current)
    return { status: 'ineligible' as const, reason: 'Undo the current split first' }

  const meshes = withGeometry(modelMeshes()).filter(isRepairable)
  if (meshes.length !== 1)
    return { status: 'ineligible' as const, reason: 'Plane cut needs a single-mesh model with one material' }

  const plane = computeClipPlane()
  if (!plane) return { status: 'ineligible' as const, reason: 'Set a cut plane first' }

  const mesh = meshes[0]
  mesh.updateWorldMatrix(true, false)
  const g = mesh.geometry as THREE.BufferGeometry
  const wg = g.index ? g.toNonIndexed() : g.clone()
  wg.applyMatrix4(mesh.matrixWorld)
  const soup = (wg.getAttribute('position') as THREE.BufferAttribute).array as Float32Array

  // THREE.Plane keeps normal.dot(p) + constant >= 0; manifold keeps
  // normal.dot(p) - offset >= 0, so offset = -constant.
  const n: [number, number, number] = [plane.normal.x, plane.normal.y, plane.normal.z]
  let res: { partA: Float32Array; partB: Float32Array }
  try {
    res = await cutByPlane(soup, n, -plane.constant)
  } catch (err) {
    wg.dispose()
    return { status: 'ineligible' as const, reason: err instanceof Error ? err.message : 'Plane cut failed' }
  }
  wg.dispose()

  if (res.partA.length < 9 || res.partB.length < 9) {
    return { status: 'empty' as const }   // the plane missed the model or shaved nothing
  }

  teardownXray()
  teardownClip()

  // Build the two parts into the split-parts group, exactly like splitByShell
  // (world-baked geometry -> a Mesh at identity, since the soup is already
  // world-space; name "<base> - part 1/2"; register in splitPartsRef; set
  // partMeta with triangleCount = length / 9).
  // ... (identical assembly to splitByShell, see that method) ...

  pushUndo({
    label: 'Plane cut',
    apply: () => {
      teardownSplitParts()
      scene.add(original)
      modelGroupRef.current = original
      useViewerStore.getState().setSplitParts([])
      updateTriangleDetails(); updateGeometryDetails(); refreshSceneEnvironment(); invalidate()
    },
    discard: () => { disposeModel(original, scene) },
  })

  useViewerStore.getState().setXrayMode(false)
  useViewerStore.getState().setClipMode(false)
  for (const root of modelRoots()) applyViewMode(root, useViewerStore.getState().viewMode)
  updateTriangleDetails(); updateGeometryDetails(); refreshSceneEnvironment(); invalidate()
  return { status: 'cut' as const }
},
```

Because the soup is world-baked, the two part meshes are added at identity
(position 0, quaternion identity, scale 1) - unlike `splitByShell`, which
re-applies the source mesh's decomposed transform because it splits the
*local* geometry. Confirm this in the plan against how `splitByShell`'s
parts render.

`Viewer3DHandle` gains `cutAtPlane: () => Promise<PlaneCutOutcome>`. The
`SceneControls.test.tsx` full mock gets `cutAtPlane: vi.fn()` (the required
member ripple, same as SP-5b / SP-5c).

### AnalysisSection (`src/components/prepare/AnalysisSection.tsx`)

`AnalysisSection` currently takes no props. Add `viewerRef` (threaded from
`PreparePanel`, which already holds it), and update the `render(<AnalysisSection />)`
calls in `AnalysisSection.test.tsx` to pass `viewerRef={{ current: null }}`
or a mock.

Inside the existing `{clipMode && ( ... )}` block, after the "Flip side"
button, add a "Cut at plane" button plus a note:

```tsx
const [cutBusy, setCutBusy] = useState(false)
const [cutNote, setCutNote] = useState<string | null>(null)
const multiModel = useViewerStore((s) => s.loadedModels.length > 0)
const isSplit = useViewerStore((s) => s.splitParts.length > 0)

const runCut = async () => {
  setCutBusy(true)
  setCutNote(null)
  try {
    const r = await viewerRef.current?.cutAtPlane()
    if (!r) return
    if (r.status === 'ineligible') setCutNote(r.reason)
    else if (r.status === 'empty') setCutNote('The cut plane does not pass through the model')
    // 'cut' -> the Parts section takes over; no note needed
  } finally {
    setCutBusy(false)
  }
}
```

Button: `disabled={!hasModel || multiModel || isSplit || cutBusy}`, text
`cutBusy ? 'Cutting…' : 'Cut at plane'`. Note `<p>` when `cutNote`.

### HelpModal (`src/components/HelpModal.tsx`)

Append after "X-ray and clip plane":

```ts
  {
    title: 'Plane cut',
    body: 'With the clip plane shown, Cut at plane slices the model into two watertight shells along that plane. The pieces appear in the Parts section, where you can hide, export, or delete each one. It needs a single-mesh model; run Repair first if the model is not a closed solid. One undoable step.',
  },
```

### e2e (`e2e/plane-cut.spec.ts`)

Mirror `e2e/xray-clipping.spec.ts` + `e2e/split-by-shell` conventions.
Fixture: a simple box STL. Scenario:
1. Drop the box, open Prepare, open the Analysis section.
2. Click "Show clip plane", set the offset to `0.5` (mid model).
3. Click "Cut at plane".
4. The Parts section (`data-testid="split-parts"` or its heading) shows two
   parts.
5. Undo the "Plane cut" entry, assert the parts list is gone.

The wasm loads in the real browser, so this genuinely exercises the worker.
Allow the default `test.setTimeout(120_000)`; the first cut pays the wasm
init.

### Docs

- README: a "Plane cut" bullet by the Repair / Split by shell entries.
- CHANGELOG: plane cut, SP-6a, `manifold-3d` wasm.
- Roadmap SP-6 table: SP-6a to SHIPPED. Note SP-6b remains.

## Global constraints

- `manifold-3d` is the only new dependency (roadmap-preauthorised), exact
  pinned in `dependencies`, lockfile specifier exact.
- No em dash in prose, comments, or commit messages.
- No `@testing-library/jest-dom`; assert with vitest / RTL core.
- The worker and its wasm are dynamically loaded, so unit tests do not touch
  them; `planeCut.ts`'s pure helpers (`weldSoup`, `meshToSoup` if extracted
  to `manifoldBridge.ts`) get direct unit tests, the worker round trip is
  covered only by the e2e.
- Every feature ships in the same cycle: code + unit tests + a passing e2e +
  a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap.

## Rulings

- **R1. `manifold-3d` in a persistent module-singleton worker.** The wasm
  init cost (~1 MB, ~100 ms) makes spawn-per-call wasteful; unlike
  `meshRepair` / `solidRepair` the worker stays alive between cuts. It is
  never terminated except on its own `onerror`.
- **R2. The cut plane is the SP-4c clip plane** (`computeClipPlane()` from
  the `clipAxis` / `clipOffset` / `clipFlip` store fields). No new plane UI.
  The button lives in the clip-controls block, so `clipMode` is on in
  practice, but the handle reads the store fields directly and does not
  require it.
- **R3. Always split into two shells**, both landing in the existing
  split-parts group (`splitPartsGroupRef` / `setSplitParts`), so the Parts
  section manages visibility / export; this implementation adds undoable delete UI.
  One undo entry "Plane cut" restoring the original, identical in shape to
  Split by shell's undo.
- **R4. World-baked soup in, world-space parts out.** The worker receives
  the mesh already transformed to world space and returns world-space
  triangle soups, so the part meshes are added at identity (no transform
  re-apply, unlike Split by shell which splits local geometry).
- **R5. Weld the input in the worker before building the `Manifold`.**
  Quantise positions to a grid and reuse coincident vertex indices, then
  `mesh.merge()`. A raw triangle soup is not 2-manifold.
- **R6. Manifold rejects a non-solid input.** If `solid.status()` is
  non-zero or `isEmpty()`, the handle returns `ineligible` with "Run Repair,
  then try the cut again." No JS-clip fallback.
- **R7. Same eligibility as Split by shell.** Single open model, single
  mesh, `isRepairable` (one material, no textures), not already split. A
  cut that shaves nothing off (plane outside the model) returns `empty`.
- **R8. `.delete()` every Manifold and Mesh in the worker**, in `finally`
  paths too. Manifold has no GC.
- **R9. `AnalysisSection` gains a `viewerRef` prop.** It is where the clip
  controls live; threading the ref through `PreparePanel` (which already
  has it) is cleaner than moving the button.
