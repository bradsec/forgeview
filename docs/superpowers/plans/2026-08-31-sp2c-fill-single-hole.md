# SP-2c: Fill Single Hole On Click — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user arm a viewport pick mode from the Prepare panel, see every open boundary loop on an eligible mesh drawn as a translucent cap outline, and click one to fill just that hole as a single undo step.

**Architecture:** Pure topology helpers move to `src/services/meshTopology.ts`. A new pure `src/services/boundaryLoops.ts` walks a geometry's directed boundary edges into ordered loops and builds a centroid-fan cap for a loop. `src/services/repairStages.ts` `fillHoles` is refactored onto that extractor and gains `fillLoop(geo, points)`. A new pure `src/services/holeFillOverlay.ts` turns loops into taggable overlay objects (a translucent cap `Mesh` plus a `LineLoop` outline, baked in world space) and picks one from a raycaster. `Viewer3D` holds a scene-level overlay group, an effect keyed on a new store flag, pointer/click/Esc listeners, and an `applyLoopFill` that swaps the hit mesh's geometry and pushes one `UndoEntry`. `RepairSection` gains the toggle button and status line.

**Tech Stack:** React 19, Three 0.185, Zustand 5, Vitest, Playwright, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-30-sp2c-fill-single-hole-design.md`

### Refinements vs the spec (carry into the spec on completion)

1. **Spec §1 helper reuse.** The spec says export `triModel` / `vertexTable` /
   `KEY` from `repairStages.ts`. This plan instead moves them (plus
   `nonIndexedPositions`, `fromPositions`, `rebuild`) to a new
   `src/services/meshTopology.ts` so `boundaryLoops.ts` and `repairStages.ts`
   share them with no import cycle. Pure move, no behaviour change.
2. **Spec §4 overlay = outline only.** Picking a thin `LineLoop` by raycast
   fails when the user clicks the open area inside the loop rather than the
   line itself. This plan draws, per loop, a translucent cap `Mesh` (the exact
   centroid fan `fillLoop` would append) as the hover + pick target, with the
   `LineLoop` outline on top for definition. Clicking anywhere over the opening
   hits the cap.
3. **Spec §4 overlay parented to the mesh.** This plan parents overlays to a
   scene-level `Group` instead, with each loop's points pre-multiplied by the
   mesh's `matrixWorld` at build time. `modelMeshes()` only traverses
   `modelRoots()`, so a scene-level group is invisible to every existing
   traversal (repair, triangle/geometry details, exporters, selection raycast)
   with no new filter. Safe while models have no runtime transform (pre SP-3).
4. **Spec §4 Viewer3D unit tests.** jsdom has no WebGL, so `Viewer3D`'s
   renderer-dependent effects cannot run in Vitest (the component error-guards
   instead). Overlay build / dispose / pick logic is therefore tested in
   `holeFillOverlay.test.ts` against plain THREE objects; the `Viewer3D`
   integration is covered by the Task 8 e2e and the `verify` recipe.

## Global Constraints

- **No new npm dependency.** Reuse `three`, the SP-2a undo stack, and
  `THREE.Raycaster`. Copied verbatim from the spec.
- **No worker, no redo.** Loop extraction is a synchronous main-thread pass.
- **Eligibility:** overlays only for meshes passing `isRepairable` —
  `!Array.isArray(m.material) && geometry.groups.length <= 1 &&
  !geometry.getAttribute('uv') && !geometry.getAttribute('color')`.
- **Cap winding:** for each consecutive loop pair `a -> b` (wrapping), the cap
  triangle is `(centroid, b, a)` — the surface is to the left of the directed
  boundary edge, the cap winds the other way.
- **Undo label:** each single-hole fill pushes one `UndoEntry` labelled exactly
  `Fill hole`. It does not touch `sealApplied`.
- **Loop simplicity:** only closed, non-pinched loops with `>= 3` vertices are
  offered. A pinched boundary component (any vertex with boundary in- or
  out-degree > 1) is counted, not drawn.
- Verification gate for the whole plan: `pnpm test` green, `pnpm exec tsc
  --noEmit` clean, `pnpm build` clean, `pnpm test:e2e -- prepare-panel`
  passes.

---

### Task 1: Extract mesh-topology helpers to `meshTopology.ts`

Pure refactor. `repairStages.ts` currently defines `nonIndexedPositions`,
`fromPositions`, `KEY`, `triModel`, `rebuild`, `vertexTable` as module-local
functions. Move them unchanged into a new module both `repairStages.ts` and
`boundaryLoops.ts` (Task 2) can import.

**Files:**
- Create: `src/services/meshTopology.ts`
- Create: `src/services/meshTopology.test.ts`
- Modify: `src/services/repairStages.ts` (delete the six local helpers, add one import)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `nonIndexedPositions(geo: THREE.BufferGeometry): Float32Array`
  - `fromPositions(positions: Float32Array): THREE.BufferGeometry` — sets a
    non-indexed `position` attribute and runs `computeVertexNormals()`.
  - `KEY(x: number, y: number, z: number): string` — rounds each coord to 1e6.
  - `triModel(geo: THREE.BufferGeometry): { positions: Float32Array; tris: number[][]; vertexCount: number }`
    — `positions` is the non-indexed soup, `tris` are merged-vertex-id triples,
    `vertexCount` is the distinct id count.
  - `vertexTable(positions: Float32Array, tris: number[][], vertexCount: number): [number, number, number][]`
    — first-seen `[x,y,z]` per merged id.
  - `rebuild(tris: number[][], vertexKeyOf: (id: number) => [number, number, number]): THREE.BufferGeometry`

- [ ] **Step 1: Create `src/services/meshTopology.ts` with the moved helpers**

Cut these exact definitions out of `src/services/repairStages.ts` (they sit
between the `STAGE_LABEL` constant and `weldVertices`, plus `triModel` /
`rebuild` / `vertexTable` which sit just before `unifyNormals`) and paste them
into the new file, adding `export` to each:

```ts
import * as THREE from 'three'

export function nonIndexedPositions(geo: THREE.BufferGeometry): Float32Array {
  const src = geo.index ? geo.toNonIndexed() : geo
  const attr = src.getAttribute('position') as THREE.BufferAttribute
  const out = new Float32Array(attr.array as ArrayLike<number>)
  if (src !== geo) src.dispose()
  return out
}

export function fromPositions(positions: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.computeVertexNormals()
  return g
}

export const KEY = (x: number, y: number, z: number) =>
  `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`

/** merged-vertex triangle model shared by normals / smallShells / holeFill / boundary loops */
export function triModel(geo: THREE.BufferGeometry) {
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

export function rebuild(
  tris: number[][],
  vertexKeyOf: (id: number) => [number, number, number],
): THREE.BufferGeometry {
  const out = new Float32Array(tris.length * 9)
  let o = 0
  for (const tri of tris) for (const id of tri) {
    const [x, y, z] = vertexKeyOf(id)
    out[o++] = x; out[o++] = y; out[o++] = z
  }
  return fromPositions(out)
}

/** first-seen XYZ for each merged vertex id, read back from the raw position soup */
export function vertexTable(
  positions: Float32Array,
  tris: number[][],
  vertexCount: number,
): [number, number, number][] {
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
```

Confirm against the current `repairStages.ts` that the bodies match byte for
byte (only `export` is added). If `repairStages.ts` had any of these `const`
rather than `function`, keep that form.

- [ ] **Step 2: Re-point `repairStages.ts` at the new module**

At the top of `src/services/repairStages.ts`, next to the existing imports:

```ts
import {
  KEY, nonIndexedPositions, fromPositions, triModel, rebuild, vertexTable,
} from './meshTopology'
```

Delete the now-moved local definitions. Leave everything else
(`weldVertices` ... `runStages`, `REPAIR_STAGE_IDS`, `STAGE_LABEL`) untouched.

- [ ] **Step 3: Write `src/services/meshTopology.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { KEY, triModel, vertexTable, rebuild, fromPositions, nonIndexedPositions } from './meshTopology'

describe('KEY', () => {
  it('rounds coincident-within-1e6 coords to the same key', () => {
    expect(KEY(1, 2, 3)).toBe(KEY(1 + 1e-8, 2 - 1e-8, 3))
    expect(KEY(1, 0, 0)).not.toBe(KEY(1.001, 0, 0))
  })
})

describe('triModel', () => {
  it('merges the split cube to 8 distinct vertices and 12 triangles', () => {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()
    const { tris, vertexCount } = triModel(g)
    expect(tris.length).toBe(12)
    expect(vertexCount).toBe(8)
  })
})

describe('vertexTable + rebuild round-trip', () => {
  it('rebuilds an equivalent geometry from the merged model', () => {
    const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed()
    const { positions, tris, vertexCount } = triModel(g)
    const table = vertexTable(positions, tris, vertexCount)
    const back = rebuild(tris, (id) => table[id])
    expect(back.getAttribute('position').count).toBe(36)
    // same bounding box
    g.computeBoundingBox(); back.computeBoundingBox()
    expect(back.boundingBox!.min.toArray()).toEqual(g.boundingBox!.min.toArray())
    expect(back.boundingBox!.max.toArray()).toEqual(g.boundingBox!.max.toArray())
  })
})

describe('fromPositions', () => {
  it('produces a non-indexed geometry with vertex normals', () => {
    const geo = fromPositions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    expect(geo.index).toBeNull()
    expect(geo.getAttribute('normal')).toBeTruthy()
  })
})

describe('nonIndexedPositions', () => {
  it('expands an indexed geometry to a flat soup copy', () => {
    const g = new THREE.BoxGeometry(1, 1, 1) // indexed
    const soup = nonIndexedPositions(g)
    expect(soup.length).toBe(36 * 3)
    expect(soup).toBeInstanceOf(Float32Array)
  })
})
```

- [ ] **Step 4: Run the topology test and the full repairStages suite**

Run: `pnpm exec vitest run src/services/meshTopology.test.ts src/services/repairStages.test.ts`
Expected: all PASS. The `repairStages` suite is the regression guard that the
move changed nothing.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/meshTopology.ts src/services/meshTopology.test.ts src/services/repairStages.ts
git commit -m "refactor: extract mesh-topology helpers into meshTopology.ts"
```

---

### Task 2: `boundaryLoops.ts` — extract loops and build caps

**Files:**
- Create: `src/services/boundaryLoops.ts`
- Create: `src/services/boundaryLoops.test.ts`

**Interfaces:**
- Consumes: `triModel`, `vertexTable` from `./meshTopology` (Task 1).
- Produces:
  - `interface BoundaryLoop { points: [number, number, number][]; vertexCount: number }`
    — `points` ordered so consecutive pairs (wrapping) are the directed
    boundary edges; the surface lies to the left of that direction.
  - `interface BoundaryLoopResult { loops: BoundaryLoop[]; skippedPinched: number }`
  - `extractBoundaryLoops(geo: THREE.BufferGeometry): BoundaryLoopResult`
    — simple loops only (closed, `vertexCount >= 3`, non-pinched).
  - `centroidFan(points: [number, number, number][]): Float32Array`
    — `points.length` triangles, 9 floats each; triangle `i` is
    `(centroid, points[(i+1)%n], points[i])`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { extractBoundaryLoops, centroidFan } from './boundaryLoops'
import { analyzeGeometry } from './meshHealth'

/** unit cube missing the +Z face: 10 triangles, one square hole */
function openCube(): THREE.BufferGeometry {
  const full = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
  const keep = new Float32Array([...full.slice(0, 18 * 4), ...full.slice(18 * 5, 18 * 6)])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(keep, 3))
  return g
}

/** two unit cubes side by side (x and x+2), each missing its +Z face */
function twoOpenCubes(): THREE.BufferGeometry {
  const one = openCube().getAttribute('position').array as Float32Array
  const shifted = Float32Array.from(one)
  for (let i = 0; i < shifted.length; i += 3) shifted[i] += 4
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...one, ...shifted]), 3))
  return g
}

/** two triangle fans sharing one apex: pinched, non-simple boundary */
function figureEightBoundary(): THREE.BufferGeometry {
  const P = [0, 0, 0]
  const a0 = [1, 0, 0], a1 = [1, 1, 0], a2 = [0, 1, 0]
  const b0 = [-1, 0, 0], b1 = [-1, -1, 0], b2 = [0, -1, 0]
  const faces = [[P, a0, a1], [P, a1, a2], [P, b0, b1], [P, b1, b2]]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(faces.flat(2)), 3))
  return g
}

describe('extractBoundaryLoops', () => {
  it('finds one 4-vertex loop for an open cube', () => {
    const { loops, skippedPinched } = extractBoundaryLoops(openCube())
    expect(loops.length).toBe(1)
    expect(loops[0].vertexCount).toBe(4)
    expect(skippedPinched).toBe(0)
    // every loop point sits on the +Z rim
    for (const [, , z] of loops[0].points) expect(z).toBeCloseTo(0.5)
  })

  it('finds two separate loops for two open cubes', () => {
    const { loops } = extractBoundaryLoops(twoOpenCubes())
    expect(loops.length).toBe(2)
    expect(loops.every((l) => l.vertexCount === 4)).toBe(true)
  })

  it('returns no loops and counts the pinched component', () => {
    const { loops, skippedPinched } = extractBoundaryLoops(figureEightBoundary())
    expect(loops.length).toBe(0)
    expect(skippedPinched).toBe(1)
  })

  it('returns nothing for a closed cube', () => {
    const { loops, skippedPinched } = extractBoundaryLoops(new THREE.BoxGeometry(1, 1, 1))
    expect(loops.length).toBe(0)
    expect(skippedPinched).toBe(0)
  })
})

describe('centroidFan', () => {
  it('caps a square loop with 4 triangles that seal it watertight', () => {
    const src = openCube()
    const { loops } = extractBoundaryLoops(src)
    const fan = centroidFan(loops[0].points)
    expect(fan.length).toBe(4 * 9)
    const soup = src.toNonIndexed().getAttribute('position').array as Float32Array
    const sealed = new THREE.BufferGeometry()
    sealed.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...soup, ...fan]), 3))
    const after = analyzeGeometry(sealed)
    expect(after.boundaryEdges).toBe(0)
    expect(after.watertight).toBe(true)
    expect(after.triangles).toBe(14)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run src/services/boundaryLoops.test.ts`
Expected: FAIL — `boundaryLoops` module not found / exports undefined.

- [ ] **Step 3: Implement `src/services/boundaryLoops.ts`**

Port the directed-edge walk from the current `fillHoles` body verbatim, minus
the fan step. `centroidFan` is the fan step, standalone.

```ts
import * as THREE from 'three'
import { triModel, vertexTable } from './meshTopology'

export interface BoundaryLoop {
  points: [number, number, number][]
  vertexCount: number
}

export interface BoundaryLoopResult {
  loops: BoundaryLoop[]
  skippedPinched: number
}

/**
 * Walk a geometry's open boundary into ordered loops. An edge used by exactly
 * one triangle is a boundary edge, kept in that triangle's traversal
 * direction; the surface lies to the left of that direction. Boundary edges
 * are grouped into connected components; a component with any vertex whose
 * boundary in- or out-degree exceeds one is pinched (e.g. a figure-eight
 * sharing an apex) and every chain in it is skipped, counted once in
 * `skippedPinched`. Simple components are walked into closed cycles; a chain
 * that fails to close or is shorter than three vertices is dropped silently
 * (degenerate input, not reachable from real meshes). Pure: the input is not
 * mutated.
 */
export function extractBoundaryLoops(geo: THREE.BufferGeometry): BoundaryLoopResult {
  const { positions, tris, vertexCount } = triModel(geo)
  const table = vertexTable(positions, tris, vertexCount)

  const edgeUse = new Map<string, number>()
  for (const tri of tris) {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1)
    }
  }
  const dirEdges: [number, number][] = []
  for (const tri of tris) {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3]
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      if (edgeUse.get(k) === 1) dirEdges.push([a, b])
    }
  }
  if (dirEdges.length === 0) return { loops: [], skippedPinched: 0 }

  const outDeg = new Map<number, number>()
  const inDeg = new Map<number, number>()
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    const p = parent.get(x)
    if (p === undefined) { parent.set(x, x); return x }
    if (p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }
  const union = (x: number, y: number) => { parent.set(find(x), find(y)) }
  for (const [a, b] of dirEdges) {
    outDeg.set(a, (outDeg.get(a) ?? 0) + 1)
    inDeg.set(b, (inDeg.get(b) ?? 0) + 1)
    union(a, b)
  }
  const pinchedRoots = new Set<number>()
  for (const [v, d] of outDeg) if (d > 1) pinchedRoots.add(find(v))
  for (const [v, d] of inDeg) if (d > 1) pinchedRoots.add(find(v))

  const boundaryNext = new Map<number, number>()
  const startNodesSeed: number[] = []
  let boundaryCount = 0
  for (const [a, b] of dirEdges) {
    if (pinchedRoots.has(find(a))) continue
    boundaryNext.set(a, b)
    startNodesSeed.push(a)
    boundaryCount++
  }

  const loops: BoundaryLoop[] = []
  const startNodes = new Set(startNodesSeed)
  while (startNodes.size) {
    const start = startNodes.values().next().value as number
    const loopIds: number[] = []
    let cur = start
    let ok = true
    for (let guard = 0; guard <= boundaryCount + 1; guard++) {
      loopIds.push(cur)
      startNodes.delete(cur)
      const nxt = boundaryNext.get(cur)
      if (nxt === undefined) { ok = false; break }
      if (nxt === start) break
      if (loopIds.includes(nxt)) { ok = false; break }
      cur = nxt
    }
    if (!ok || loopIds.length < 3) continue
    const points = loopIds.map((id) => [...table[id]] as [number, number, number])
    loops.push({ points, vertexCount: points.length })
  }

  return { loops, skippedPinched: pinchedRoots.size }
}

/**
 * Triangle fan from the loop centroid. For consecutive loop points a -> b
 * (wrapping) the triangle is (centroid, b, a): the boundary is directed with
 * the surface on its left, so the cap winds the other way and faces outward.
 * Returns a flat non-indexed position array (points.length triangles).
 */
export function centroidFan(points: [number, number, number][]): Float32Array {
  const n = points.length
  const c: [number, number, number] = [0, 0, 0]
  for (const [x, y, z] of points) { c[0] += x; c[1] += y; c[2] += z }
  c[0] /= n; c[1] /= n; c[2] /= n
  const out = new Float32Array(n * 9)
  let o = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    out[o++] = c[0]; out[o++] = c[1]; out[o++] = c[2]
    out[o++] = b[0]; out[o++] = b[1]; out[o++] = b[2]
    out[o++] = a[0]; out[o++] = a[1]; out[o++] = a[2]
  }
  return out
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm exec vitest run src/services/boundaryLoops.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/boundaryLoops.ts src/services/boundaryLoops.test.ts
git commit -m "feat: boundaryLoops — extract open loops and build centroid-fan caps"
```

---

### Task 3: Refactor `fillHoles` onto the extractor and add `fillLoop`

**Files:**
- Modify: `src/services/repairStages.ts`
- Modify: `src/services/repairStages.test.ts`

**Interfaces:**
- Consumes: `extractBoundaryLoops`, `centroidFan` from `./boundaryLoops`;
  `nonIndexedPositions`, `fromPositions`, `KEY` from `./meshTopology`.
- Produces:
  - `fillHoles(geo: THREE.BufferGeometry): StageResult` — unchanged signature
    and observable behaviour (regression-guarded by the existing suite).
  - `fillLoop(geo: THREE.BufferGeometry, loop: [number, number, number][]): StageResult`
    — appends one centroid fan for `loop` to a copy of `geo`. If any loop point
    does not `KEY`-match a vertex of `geo`, returns `geo.clone()` with
    `note: 'skipped: loop not on geometry'` and no geometry change.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/repairStages.test.ts`. `openCube` already exists in that
file — reuse it.

```ts
import { fillLoop } from './repairStages'
import { extractBoundaryLoops } from './boundaryLoops'

describe('fillLoop', () => {
  it('caps exactly the passed loop and seals the open cube', () => {
    const src = openCube()
    const before = analyzeGeometry(src)
    const { loops } = extractBoundaryLoops(src)
    const { geometry, note } = fillLoop(src, loops[0].points)
    const after = analyzeGeometry(geometry)
    expect(after.boundaryEdges).toBe(0)
    expect(after.watertight).toBe(true)
    expect(after.triangles).toBe(before.triangles + 4)
    expect(note).toBeUndefined()
    // input untouched
    expect(src.getAttribute('position').count).toBe(30)
  })

  it('faces the cap outward for the convex open cube', () => {
    const src = openCube()
    const originalTris = src.getAttribute('position').count / 3
    const { loops } = extractBoundaryLoops(src)
    const { geometry } = fillLoop(src, loops[0].points)
    const p = geometry.getAttribute('position')
    const triCount = p.count / 3
    const mesh = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) mesh.add(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)))
    mesh.divideScalar(p.count)
    let checked = 0
    for (let t = originalTris; t < triCount; t++) {
      const a = new THREE.Vector3(p.getX(t * 3), p.getY(t * 3), p.getZ(t * 3))
      const b = new THREE.Vector3(p.getX(t * 3 + 1), p.getY(t * 3 + 1), p.getZ(t * 3 + 1))
      const c = new THREE.Vector3(p.getX(t * 3 + 2), p.getY(t * 3 + 2), p.getZ(t * 3 + 2))
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
      const outward = a.clone().add(b).add(c).divideScalar(3).sub(mesh)
      expect(n.dot(outward)).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBe(4)
  })

  it('no-ops with a note when a loop point is not on the geometry', () => {
    const src = openCube()
    const before = analyzeGeometry(src).triangles
    const { geometry, note } = fillLoop(src, [[99, 99, 99], [98, 99, 99], [98, 98, 99]])
    expect(analyzeGeometry(geometry).triangles).toBe(before)
    expect(note).toMatch(/not on geometry/)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run src/services/repairStages.test.ts -t fillLoop`
Expected: FAIL — `fillLoop` is not exported.

- [ ] **Step 3: Refactor `fillHoles` and add `fillLoop`**

Replace the entire current `fillHoles` body (the block from `export function
fillHoles(geo: THREE.BufferGeometry): StageResult {` through its closing brace)
with:

```ts
export function fillHoles(geo: THREE.BufferGeometry): StageResult {
  const { loops, skippedPinched } = extractBoundaryLoops(geo)
  if (loops.length === 0) {
    return {
      geometry: geo.clone(),
      note: skippedPinched ? `0 filled, ${skippedPinched} skipped` : undefined,
    }
  }
  const soup = nonIndexedPositions(geo)
  const fans = loops.map((l) => centroidFan(l.points))
  const total = soup.length + fans.reduce((s, f) => s + f.length, 0)
  const out = new Float32Array(total)
  out.set(soup, 0)
  let off = soup.length
  for (const f of fans) { out.set(f, off); off += f.length }
  return {
    geometry: fromPositions(out),
    note: `${loops.length} loop${loops.length === 1 ? '' : 's'} filled${
      skippedPinched ? `, ${skippedPinched} skipped` : ''
    }`,
  }
}

/**
 * Cap one already-identified boundary loop. `loop` is an ordered vertex ring
 * from `extractBoundaryLoops` for THIS geometry; each point must KEY-match a
 * vertex of `geo`. Appends `centroidFan(loop)` to a non-indexed copy. Pure.
 */
export function fillLoop(
  geo: THREE.BufferGeometry,
  loop: [number, number, number][],
): StageResult {
  const soup = nonIndexedPositions(geo)
  const present = new Set<string>()
  for (let i = 0; i < soup.length; i += 3) present.add(KEY(soup[i], soup[i + 1], soup[i + 2]))
  for (const [x, y, z] of loop) {
    if (!present.has(KEY(x, y, z))) {
      return { geometry: geo.clone(), note: 'skipped: loop not on geometry' }
    }
  }
  const fan = centroidFan(loop)
  const out = new Float32Array(soup.length + fan.length)
  out.set(soup, 0)
  out.set(fan, soup.length)
  return { geometry: fromPositions(out) }
}
```

Add the imports at the top of `repairStages.ts`:

```ts
import { extractBoundaryLoops, centroidFan } from './boundaryLoops'
```

(`nonIndexedPositions`, `fromPositions`, `KEY` are already imported from
`./meshTopology` after Task 1.) Remove any now-unused local symbols the old
`fillHoles` relied on that nothing else references (check `rebuild` /
`vertexTable` are still used by `unifyNormals` / `removeSmallShells` — they
are; leave them).

- [ ] **Step 4: Run the full repairStages suite**

Run: `pnpm exec vitest run src/services/repairStages.test.ts`
Expected: all PASS — the pre-existing `fillHoles` describe block (seals a
single square hole / faces outward / skips a pinched figure-eight) passes
unchanged, plus the new `fillLoop` block.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/repairStages.ts src/services/repairStages.test.ts
git commit -m "feat: fillLoop + refactor fillHoles onto extractBoundaryLoops"
```

---

### Task 4: Store flag and status

**Files:**
- Modify: `src/store/viewerStore.ts`
- Modify: `src/store/viewerStore.test.ts`

**Interfaces:**
- Produces (on `ViewerState`):
  - `holeFillMode: boolean` (initial `false`)
  - `setHoleFillMode: (on: boolean) => void`
  - `holeFillStatus: { loops: number; skippedMeshes: number } | null` (initial `null`)
  - `setHoleFillStatus: (s: { loops: number; skippedMeshes: number } | null) => void`
  - `setFile` and `setFileFromBuffer` additionally reset `holeFillMode` to
    `false` and `holeFillStatus` to `null`.

- [ ] **Step 1: Write the failing test**

Add to `src/store/viewerStore.test.ts` (match the file's existing style —
`useViewerStore.getState()` / `.setState()` / `beforeEach` reset):

```ts
describe('hole-fill mode', () => {
  it('defaults off with no status', () => {
    const s = useViewerStore.getState()
    expect(s.holeFillMode).toBe(false)
    expect(s.holeFillStatus).toBeNull()
  })

  it('setters update the fields', () => {
    useViewerStore.getState().setHoleFillMode(true)
    useViewerStore.getState().setHoleFillStatus({ loops: 3, skippedMeshes: 1 })
    expect(useViewerStore.getState().holeFillMode).toBe(true)
    expect(useViewerStore.getState().holeFillStatus).toEqual({ loops: 3, skippedMeshes: 1 })
  })

  it('setFile clears mode and status', () => {
    useViewerStore.getState().setHoleFillMode(true)
    useViewerStore.getState().setHoleFillStatus({ loops: 2, skippedMeshes: 0 })
    useViewerStore.getState().setFile('/tmp/x.stl', 'x.stl', 'stl', 10)
    expect(useViewerStore.getState().holeFillMode).toBe(false)
    expect(useViewerStore.getState().holeFillStatus).toBeNull()
  })
})
```

Check the real `setFile` signature in `viewerStore.ts` and match the argument
list in the test call.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run src/store/viewerStore.test.ts -t "hole-fill mode"`
Expected: FAIL — properties undefined.

- [ ] **Step 3: Implement**

In `src/store/viewerStore.ts`:

Add to the `ViewerState` interface, near `sealApplied` / `repairDialogOpen`:

```ts
  holeFillMode: boolean
  setHoleFillMode: (on: boolean) => void
  holeFillStatus: { loops: number; skippedMeshes: number } | null
  setHoleFillStatus: (s: { loops: number; skippedMeshes: number } | null) => void
```

In the `create<ViewerState>(...)` body, near the other initial values:

```ts
  holeFillMode: false,
  setHoleFillMode: (on) => set({ holeFillMode: on }),
  holeFillStatus: null,
  setHoleFillStatus: (s) => set({ holeFillStatus: s }),
```

In `setFile` and `setFileFromBuffer`, add to the object passed to `set({...})`:

```ts
    holeFillMode: false,
    holeFillStatus: null,
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm exec vitest run src/store/viewerStore.test.ts`
Expected: all PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: holeFillMode + holeFillStatus store fields"
```

---

### Task 5: `holeFillOverlay.ts` — overlay objects and picking

Pure module over plain THREE objects (no renderer), so it is fully
unit-testable in jsdom.

**Files:**
- Create: `src/services/holeFillOverlay.ts`
- Create: `src/services/holeFillOverlay.test.ts`

**Interfaces:**
- Consumes: `extractBoundaryLoops`, `centroidFan`, `BoundaryLoop` from
  `./boundaryLoops`.
- Produces:
  - `interface OverlayEntry { mesh: THREE.Mesh; loop: BoundaryLoop; cap: THREE.Mesh; outline: THREE.LineLoop; group: THREE.Group }`
    — `cap` and `outline` are children of `group`; `group.userData.holeOverlay = true`.
  - `interface OverlayMaterials { cap: THREE.Material; capHover: THREE.Material; outline: THREE.Material }`
  - `makeOverlayMaterials(color?: number): OverlayMaterials` — cap is a
    double-side transparent `MeshBasicMaterial` (`opacity` ~0.18,
    `depthWrite:false`), `capHover` same at ~0.4, `outline` a
    `LineBasicMaterial` (`depthTest:false`, `transparent:true`).
  - `buildLoopOverlays(meshes: THREE.Mesh[], isEligible: (m: THREE.Mesh) => boolean, materials: OverlayMaterials): { entries: OverlayEntry[]; skippedMeshes: number }`
    — for each eligible mesh, `updateWorldMatrix(true,false)`, `extractBoundaryLoops`
    on its geometry, and for each loop build a `Group` holding a cap `Mesh`
    (`centroidFan` positions transformed by `mesh.matrixWorld`) and a
    `LineLoop` (loop points transformed likewise). `skippedMeshes` counts
    meshes where `isEligible` returned false.
  - `disposeLoopOverlays(entries: OverlayEntry[]): void` — dispose every cap /
    outline geometry, remove each group from its parent. Materials are shared,
    not disposed here.
  - `pickOverlay(entries: OverlayEntry[], raycaster: THREE.Raycaster): number`
    — index of the entry whose `cap` is the nearest raycaster intersection, or
    `-1`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  makeOverlayMaterials, buildLoopOverlays, disposeLoopOverlays, pickOverlay,
} from './holeFillOverlay'

function openCubeMesh(offset = 0): THREE.Mesh {
  const full = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array
  const keep = new Float32Array([...full.slice(0, 18 * 4), ...full.slice(18 * 5, 18 * 6)])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(keep, 3))
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial())
  m.position.x = offset
  return m
}

const eligibleAll = () => true

describe('buildLoopOverlays', () => {
  it('creates one overlay group per open loop, tagged and world-placed', () => {
    const mesh = openCubeMesh(10)
    const mats = makeOverlayMaterials()
    const { entries, skippedMeshes } = buildLoopOverlays([mesh], eligibleAll, mats)
    expect(entries.length).toBe(1)
    expect(skippedMeshes).toBe(0)
    expect(entries[0].group.userData.holeOverlay).toBe(true)
    expect(entries[0].cap.geometry.getAttribute('position').count).toBe(12) // 4 fan tris
    // world-placed: cap centroid near x=10
    entries[0].cap.geometry.computeBoundingBox()
    const c = new THREE.Vector3()
    entries[0].cap.geometry.boundingBox!.getCenter(c)
    expect(c.x).toBeCloseTo(10, 1)
  })

  it('counts ineligible meshes and skips them', () => {
    const a = openCubeMesh(0)
    const b = openCubeMesh(10)
    const mats = makeOverlayMaterials()
    const { entries, skippedMeshes } = buildLoopOverlays([a, b], (m) => m === a, mats)
    expect(entries.length).toBe(1)
    expect(skippedMeshes).toBe(1)
  })
})

describe('disposeLoopOverlays', () => {
  it('disposes geometries and detaches groups', () => {
    const mesh = openCubeMesh(0)
    const parent = new THREE.Group()
    const mats = makeOverlayMaterials()
    const { entries } = buildLoopOverlays([mesh], eligibleAll, mats)
    for (const e of entries) parent.add(e.group)
    const capDispose = vi.spyOn(entries[0].cap.geometry, 'dispose')
    disposeLoopOverlays(entries)
    expect(capDispose).toHaveBeenCalledOnce()
    expect(parent.children.length).toBe(0)
  })
})

describe('pickOverlay', () => {
  it('returns the entry whose cap the ray hits, else -1', () => {
    const mesh = openCubeMesh(0)
    const mats = makeOverlayMaterials()
    const { entries } = buildLoopOverlays([mesh], eligibleAll, mats)
    const scene = new THREE.Group()
    for (const e of entries) scene.add(e.group)
    // ray straight down the -Z axis from above the +Z hole (cap sits at z=0.5)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    expect(pickOverlay(entries, ray)).toBe(0)
    const miss = new THREE.Raycaster(new THREE.Vector3(50, 50, 5), new THREE.Vector3(0, 0, -1))
    expect(pickOverlay(entries, miss)).toBe(-1)
  })
})
```

Add `import { vi } from 'vitest'` to the test imports.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run src/services/holeFillOverlay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/services/holeFillOverlay.ts`**

```ts
import * as THREE from 'three'
import { extractBoundaryLoops, centroidFan, type BoundaryLoop } from './boundaryLoops'

export interface OverlayEntry {
  mesh: THREE.Mesh
  loop: BoundaryLoop
  cap: THREE.Mesh
  outline: THREE.LineLoop
  group: THREE.Group
}

export interface OverlayMaterials {
  cap: THREE.Material
  capHover: THREE.Material
  outline: THREE.Material
}

export function makeOverlayMaterials(color = 0x4c9ffe): OverlayMaterials {
  return {
    cap: new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
    }),
    capHover: new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
    }),
    outline: new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false }),
  }
}

function transformedFlat(points: [number, number, number][], m: THREE.Matrix4): Float32Array {
  const out = new Float32Array(points.length * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < points.length; i++) {
    v.set(points[i][0], points[i][1], points[i][2]).applyMatrix4(m)
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z
  }
  return out
}

function transformedFan(loop: [number, number, number][], m: THREE.Matrix4): Float32Array {
  const fan = centroidFan(loop) // local space
  const v = new THREE.Vector3()
  for (let i = 0; i < fan.length; i += 3) {
    v.set(fan[i], fan[i + 1], fan[i + 2]).applyMatrix4(m)
    fan[i] = v.x; fan[i + 1] = v.y; fan[i + 2] = v.z
  }
  return fan
}

export function buildLoopOverlays(
  meshes: THREE.Mesh[],
  isEligible: (m: THREE.Mesh) => boolean,
  materials: OverlayMaterials,
): { entries: OverlayEntry[]; skippedMeshes: number } {
  const entries: OverlayEntry[] = []
  let skippedMeshes = 0
  for (const mesh of meshes) {
    if (!isEligible(mesh)) { skippedMeshes++; continue }
    mesh.updateWorldMatrix(true, false)
    const { loops } = extractBoundaryLoops(mesh.geometry as THREE.BufferGeometry)
    for (const loop of loops) {
      const capGeo = new THREE.BufferGeometry()
      capGeo.setAttribute('position', new THREE.BufferAttribute(transformedFan(loop.points, mesh.matrixWorld), 3))
      capGeo.computeVertexNormals()
      const cap = new THREE.Mesh(capGeo, materials.cap)
      cap.renderOrder = 999

      const outGeo = new THREE.BufferGeometry()
      outGeo.setAttribute('position', new THREE.BufferAttribute(transformedFlat(loop.points, mesh.matrixWorld), 3))
      const outline = new THREE.LineLoop(outGeo, materials.outline)
      outline.renderOrder = 1000

      const group = new THREE.Group()
      group.userData.holeOverlay = true
      group.add(cap, outline)
      entries.push({ mesh, loop, cap, outline, group })
    }
  }
  return { entries, skippedMeshes }
}

export function disposeLoopOverlays(entries: OverlayEntry[]): void {
  for (const e of entries) {
    e.cap.geometry.dispose()
    e.outline.geometry.dispose()
    e.group.parent?.remove(e.group)
  }
}

export function pickOverlay(entries: OverlayEntry[], raycaster: THREE.Raycaster): number {
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < entries.length; i++) {
    const hit = raycaster.intersectObject(entries[i].cap, false)[0]
    if (hit && hit.distance < bestDist) { bestDist = hit.distance; best = i }
  }
  return best
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm exec vitest run src/services/holeFillOverlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/holeFillOverlay.ts src/services/holeFillOverlay.test.ts
git commit -m "feat: holeFillOverlay — build, dispose, and pick loop overlays"
```

---

### Task 6: Wire pick mode into `Viewer3D`

No jsdom coverage (renderer-dependent). Verification is `tsc` clean +
`pnpm build` + the Task 8 e2e + the `verify` recipe. Keep this task's diff
tight; all reusable logic already lives in Tasks 2 and 5.

**Files:**
- Modify: `src/components/Viewer3D.tsx`

**Interfaces:**
- Consumes: `buildLoopOverlays`, `disposeLoopOverlays`, `pickOverlay`,
  `makeOverlayMaterials`, `OverlayEntry` from `../services/holeFillOverlay`;
  `fillLoop` from `../services/repairStages`; store `holeFillMode`,
  `setHoleFillMode`, `setHoleFillStatus`, `repairDialogOpen`; existing
  `pushUndo`, `undoStackRef`, `modelMeshes`, `withGeometry`, `modelRoots`,
  `applyViewMode`, `updateTriangleDetails`, `updateGeometryDetails`,
  `invalidate`, `raycaster`, `cameraRef`, `rendererRef`, `sceneRef`.
- Produces: no new `Viewer3DHandle` member. Behaviour only.

- [ ] **Step 1: Lift `isRepairable` to module scope**

Find the `isRepairable` arrow declared inside the `runRepair` handle (around
line 303). Cut it out and add, at module scope near `modelLoadKey`:

```ts
/** A mesh whose geometry the simple repair stages / hole-fill overlay can
 *  safely rewrite: single draw group, non-array material, no uv/color that a
 *  position-only rebuild would strip. */
export function isRepairable(m: THREE.Mesh): boolean {
  const g = m.geometry as THREE.BufferGeometry
  if (Array.isArray(m.material) || g.groups.length > 1) return false
  return !g.getAttribute('uv') && !g.getAttribute('color')
}
```

Leave the `runRepair` call site as `repairable = allMeshes.filter(isRepairable)`
(now the module function).

- [ ] **Step 2: Add refs and the overlay lifecycle**

Near the other `useRef`s in the component body:

```ts
const holeOverlayRef = useRef<{
  group: THREE.Group
  entries: OverlayEntry[]
  hovered: number
  materials: ReturnType<typeof makeOverlayMaterials>
  badge: HTMLDivElement
} | null>(null)
```

Add two helpers inside the component (they close over `sceneRef`, `raycaster`,
`cameraRef`, `rendererRef`, `mountRef`, `invalidate`, `modelMeshes`,
`withGeometry`):

```ts
const rebuildHoleOverlays = () => {
  const scene = sceneRef.current
  if (!scene) return
  const existing = holeOverlayRef.current
  if (existing) {
    disposeLoopOverlays(existing.entries)
    scene.remove(existing.group)
  }
  const materials = existing?.materials ?? makeOverlayMaterials(0x4c9ffe)
  const badge = existing?.badge ?? (() => {
    const el = document.createElement('div')
    el.className =
      'pointer-events-none absolute z-20 px-1.5 py-0.5 rounded text-[11px] ' +
      'bg-[var(--bg-elevated,#1e1e28)] text-[var(--text-primary,#fff)] shadow'
    el.style.display = 'none'
    mountRef.current?.appendChild(el)
    return el
  })()
  const group = new THREE.Group()
  group.userData.holeOverlay = true
  const meshes = withGeometry(modelMeshes())
  const { entries, skippedMeshes } = buildLoopOverlays(meshes, isRepairable, materials)
  for (const e of entries) group.add(e.group)
  scene.add(group)
  holeOverlayRef.current = { group, entries, hovered: -1, materials, badge }
  useViewerStore.getState().setHoleFillStatus({ loops: entries.length, skippedMeshes })
  invalidate()
}

const teardownHoleOverlays = () => {
  const scene = sceneRef.current
  const cur = holeOverlayRef.current
  if (cur && scene) {
    disposeLoopOverlays(cur.entries)
    scene.remove(cur.group)
    cur.materials.cap.dispose()
    cur.materials.capHover.dispose()
    cur.materials.outline.dispose()
    cur.badge.remove()
  }
  holeOverlayRef.current = null
  useViewerStore.getState().setHoleFillStatus(null)
  invalidate()
}
```

- [ ] **Step 3: Add the pointer / click / key handlers and the mode effect**

Add a dedicated effect (after the main renderer effect so `rendererRef` /
`cameraRef` are populated):

```ts
useEffect(() => {
  if (!holeFillMode) return
  const el = rendererRef.current?.domElement
  const mount = mountRef.current
  if (!el || !mount) return

  rebuildHoleOverlays()

  const ndc = new THREE.Vector2()
  const setRay = (e: PointerEvent | MouseEvent) => {
    const rect = el.getBoundingClientRect()
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, cameraRef.current!)
  }

  let downX = 0, downY = 0
  const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY }

  const onMove = (e: PointerEvent) => {
    const st = holeOverlayRef.current
    if (!st) return
    setRay(e)
    const hit = pickOverlay(st.entries, raycaster)
    if (hit !== st.hovered) {
      if (st.hovered >= 0) st.entries[st.hovered].cap.material = st.materials.cap
      if (hit >= 0) st.entries[hit].cap.material = st.materials.capHover
      st.hovered = hit
      invalidate()
    }
    if (hit >= 0) {
      const c = new THREE.Vector3()
      st.entries[hit].cap.geometry.computeBoundingBox()
      st.entries[hit].cap.geometry.boundingBox!.getCenter(c)
      c.project(cameraRef.current!)
      const rect = el.getBoundingClientRect()
      st.badge.textContent = `${st.entries[hit].loop.vertexCount} vertices`
      st.badge.style.left = `${(c.x * 0.5 + 0.5) * rect.width}px`
      st.badge.style.top = `${(-c.y * 0.5 + 0.5) * rect.height}px`
      st.badge.style.display = ''
    } else {
      st.badge.style.display = 'none'
    }
  }

  const onClick = (e: MouseEvent) => {
    const st = holeOverlayRef.current
    if (!st || st.hovered < 0) return
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return // was a drag
    applyLoopFill(st.entries[st.hovered])
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') useViewerStore.getState().setHoleFillMode(false)
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('click', onClick)
  window.addEventListener('keydown', onKey)
  return () => {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('click', onClick)
    window.removeEventListener('keydown', onKey)
    teardownHoleOverlays()
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [holeFillMode])
```

`applyLoopFill`, also inside the component:

```ts
const applyLoopFill = (entry: OverlayEntry) => {
  const mesh = entry.mesh
  const before = withGeometry(modelMeshes())
  if (!before.includes(mesh)) return
  const original = mesh.geometry as THREE.BufferGeometry
  // entry.loop.points are world-space; fillLoop needs THIS geometry's local
  // coords. Transform back through the mesh's inverse world matrix.
  mesh.updateWorldMatrix(true, false)
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert()
  const localPts = entry.loop.points.map((p) => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(inv)
    return [v.x, v.y, v.z] as [number, number, number]
  })
  const res = fillLoop(original, localPts)
  if (res.geometry === original || res.note) { res.geometry.dispose?.(); return }
  mesh.geometry = res.geometry
  pushUndo({
    label: 'Fill hole',
    apply: () => {
      if (mesh.geometry !== original) { (mesh.geometry as THREE.BufferGeometry).dispose(); mesh.geometry = original }
    },
    discard: () => original.dispose(),
  })
  rebuildHoleOverlays()
  for (const root of modelRoots()) applyViewMode(root, useViewerStore.getState().viewMode)
  updateTriangleDetails()
  updateGeometryDetails()
  invalidate()
  if (rendererRef.current && sceneRef.current && cameraRef.current) {
    rendererRef.current.render(sceneRef.current, cameraRef.current)
  }
}
```

> Note on the world/local round trip: `buildLoopOverlays` bakes loop points to
> world space so the scene-level overlay group needs no transform. `fillLoop`
> works in the mesh's local space and matches points by `KEY`. The inverse
> transform above returns exact local coords (no new rounding beyond the
> matrix multiply); if a fixture ever shows a `KEY` miss here, switch
> `buildLoopOverlays` to also return the untransformed local `loop` (add
> `localPoints` to `OverlayEntry`) and use that directly. Prefer that if the
> e2e in Task 8 is flaky.

- [ ] **Step 4: Auto-disarm hooks**

- Where the store `repairDialogOpen` is set true (the Repair modal open path in
  `App.tsx` / wherever `setRepairDialogOpen(true)` is called from a control),
  no change needed — instead add to the `holeFillMode` effect's guard: a
  second effect in `Viewer3D`:

  ```ts
  useEffect(() => {
    if (repairDialogOpen && holeFillMode) useViewerStore.getState().setHoleFillMode(false)
  }, [repairDialogOpen, holeFillMode])
  ```

- Next to the existing `clearUndo()` call on multi-model id change (~line 674)
  and on preview teardown (~line 493), add `useViewerStore.getState().setHoleFillMode(false)`.
  (`setFile` / `setFileFromBuffer` already reset the flag from Task 4; these
  two paths do not go through `setFile`.)

- [ ] **Step 5: Import and typecheck**

Add to the `Viewer3D.tsx` imports:

```ts
import {
  buildLoopOverlays, disposeLoopOverlays, pickOverlay, makeOverlayMaterials,
  type OverlayEntry,
} from '../services/holeFillOverlay'
import { fillLoop } from '../services/repairStages'
```

Add `holeFillMode` and `repairDialogOpen` to the component's store selectors
(match how `sealApplied` / other flags are read).

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Existing Viewer3D suite still green + build**

Run: `pnpm exec vitest run src/components/Viewer3D.test.tsx`
Expected: PASS (unchanged — no renderer path exercised).

Run: `pnpm build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/Viewer3D.tsx
git commit -m "feat: viewport pick mode wiring for single-hole fill"
```

---

### Task 7: `RepairSection` toggle and status line

**Files:**
- Modify: `src/components/prepare/RepairSection.tsx`
- Create: `src/components/prepare/RepairSection.test.tsx`

**Interfaces:**
- Consumes: store `holeFillMode`, `holeFillStatus`, `setHoleFillMode`;
  existing `hasModel` derivation.
- Produces: a `button` with accessible name `Fill a single hole`,
  `aria-pressed` bound to `holeFillMode`, `disabled` when `!hasModel`; when
  `holeFillMode` a `<p>` with the Esc hint and, when `holeFillStatus` is set,
  `"{loops} open loop(s)[ · {n} mesh(es) not eligible]"`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepairSection } from './RepairSection'
import { useViewerStore } from '../../store/viewerStore'

beforeEach(() => {
  useViewerStore.setState({
    filePath: '/tmp/x.stl', loadedModels: [], canUndoEdit: false, undoLabels: [],
    holeFillMode: false, holeFillStatus: null,
  })
})

describe('RepairSection — fill a single hole', () => {
  it('toggles holeFillMode and reflects it on aria-pressed', async () => {
    render(<RepairSection />)
    const btn = screen.getByRole('button', { name: 'Fill a single hole' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(btn)
    expect(useViewerStore.getState().holeFillMode).toBe(true)
  })

  it('is disabled with no model', () => {
    useViewerStore.setState({ filePath: null, loadedModels: [] })
    render(<RepairSection />)
    expect(screen.getByRole('button', { name: 'Fill a single hole' })).toBeDisabled()
  })

  it('shows the loop count and eligibility note when armed', () => {
    useViewerStore.setState({ holeFillMode: true, holeFillStatus: { loops: 3, skippedMeshes: 1 } })
    render(<RepairSection />)
    expect(screen.getByText(/3 open loops · 1 mesh not eligible/)).toBeInTheDocument()
  })

  it('shows a singular count with no note when nothing is skipped', () => {
    useViewerStore.setState({ holeFillMode: true, holeFillStatus: { loops: 1, skippedMeshes: 0 } })
    render(<RepairSection />)
    expect(screen.getByText(/1 open loop\b/)).toBeInTheDocument()
    expect(screen.queryByText(/not eligible/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run src/components/prepare/RepairSection.test.tsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement**

In `src/components/prepare/RepairSection.tsx`, add the store reads at the top
of the component:

```tsx
const holeFillMode = useViewerStore((s) => s.holeFillMode)
const holeFillStatus = useViewerStore((s) => s.holeFillStatus)
```

Inside the `<div className="mt-3 flex flex-col gap-2">` that holds the
`Repair…` and `Undo last model edit` buttons, add the toggle between them:

```tsx
<button
  type="button"
  disabled={!hasModel}
  aria-pressed={holeFillMode}
  onClick={() => useViewerStore.getState().setHoleFillMode(!holeFillMode)}
  className={
    'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
    (holeFillMode
      ? 'bg-[var(--accent-button)] text-white'
      : 'bg-[var(--bg-button)]')
  }
>
  Fill a single hole
</button>
{holeFillMode && (
  <p className="text-xs text-[var(--text-muted)]">
    Click a highlighted loop in the viewport. Press Esc to stop.
    {holeFillStatus && (
      <>
        {' '}
        {holeFillStatus.loops} open loop{holeFillStatus.loops === 1 ? '' : 's'}
        {holeFillStatus.skippedMeshes > 0 &&
          ` · ${holeFillStatus.skippedMeshes} mesh${
            holeFillStatus.skippedMeshes === 1 ? '' : 'es'
          } not eligible`}
      </>
    )}
  </p>
)}
```

(Conditional `className` string rather than an `aria-pressed:` Tailwind
variant, which is not configured in this project.)

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm exec vitest run src/components/prepare/RepairSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: PreparePanel suite still green + typecheck**

Run: `pnpm exec vitest run src/components/prepare/PreparePanel.test.tsx`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/prepare/RepairSection.tsx src/components/prepare/RepairSection.test.tsx
git commit -m "feat: Fill a single hole toggle in the Repair section"
```

---

### Task 8: End-to-end — fill one hole from the viewport

**Files:**
- Modify: `e2e/prepare-panel.spec.ts`

**Interfaces:**
- Consumes: the app end to end. The `openBoxStl` / `dropOpenBox` helpers
  already in this file. `check(id)` visible-scoped locator pattern already in
  this file.

- [ ] **Step 1: Add the test**

Append inside the `test.describe('Prepare panel', ...)` block:

```ts
test('fills one open loop picked in the viewport', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Viewport pick verified on desktop')
  test.setTimeout(120_000)

  await dropOpenBox(page)
  const check = (id: string) => page.getByTestId(`check-${id}`).filter({ visible: true })

  await page.getByRole('button', { name: 'Prepare' }).click()
  await expect(check('boundary')).toHaveAttribute('data-state', 'fail')

  // Look straight down the +Z hole so its cap projects to the canvas centre.
  await page.getByRole('navigation', { name: 'Camera navigation' })
    .getByRole('button', { name: 'Top' }).click()

  await page.getByRole('button', { name: 'Fill a single hole' }).click()
  await expect(page.getByText(/1 open loop\b/)).toBeVisible()

  // Click the centre of the canvas — over the open top face, on the cap overlay.
  await page.locator('canvas').first().click()

  await expect(check('boundary')).toHaveAttribute('data-state', 'pass')

  const history = page.getByTestId('undo-history').filter({ visible: true })
  await expect(history.getByRole('button')).toHaveText(['Fill hole'])

  await history.getByRole('button', { name: 'Fill hole' }).click()
  await expect(check('boundary')).toHaveAttribute('data-state', 'fail')
})
```

If the `Camera navigation` nav has no button literally named `Top`, open
`src/components/SceneControls.tsx`, read the actual accessible names, and use
the one that looks down `-Z` (top view). If no single-click top view exists,
replace that step with a `page.mouse` click positioned where the loop cap
renders in the default view — compute it once by logging
`entries[0].cap.geometry.boundingBox` centre projected, or fall back to
driving the fill through the `Fill holes` stage is NOT acceptable here (this
test must exercise the viewport pick path).

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e -- prepare-panel`
Expected: the new test plus the three existing Prepare-panel tests PASS.

- [ ] **Step 3: If flaky on the world/local `KEY` round trip**

Symptom: `check('boundary')` stays `fail` after the click, no `Fill hole`
undo row. Cause: `fillLoop` returned the `not on geometry` note because the
inverse-world-matrix points did not `KEY`-match. Fix per the Task 6 Step 3
note: add `localPoints: [number, number, number][]` to `OverlayEntry` in
`holeFillOverlay.ts` (the untransformed `loop.points` before `transformedFan`),
and in `Viewer3D.applyLoopFill` pass `entry.localPoints` straight to
`fillLoop` instead of inverse-transforming. Re-run.

- [ ] **Step 4: Commit**

```bash
git add e2e/prepare-panel.spec.ts src/services/holeFillOverlay.ts src/components/Viewer3D.tsx
git commit -m "test: e2e single-hole fill from the viewport"
```

(Include the last two paths only if Step 3 was needed.)

---

### Task 9: Docs and roadmap status

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`
- Modify: `docs/superpowers/specs/2026-08-30-sp2c-fill-single-hole-design.md`

- [ ] **Step 1: README**

In the Prepare panel / Repair section of `README.md`, add:

```md
- **Fill a single hole** — arm from the Repair section, then click a
  highlighted open loop in the viewport to cap just that hole. Each fill is a
  separate entry in the undo history. Eligible meshes only (single material,
  no textures); ineligible meshes are reported as a count.
```

- [ ] **Step 2: CHANGELOG**

Under the Unreleased heading of `CHANGELOG.md`:

```md
- Prepare > Repair: **Fill a single hole** — pick one open boundary loop in
  the viewport and cap just it, as its own undo step.
```

- [ ] **Step 3: Roadmap status**

In `docs/superpowers/specs/2026-08-30-print-prep-roadmap.md`, the SP-2
decomposition table, change the SP-2c row `Status` from `Not started. ...` to:

```md
SHIPPED, branch `sp2c-fill-single-hole`, commits <first>..<last>.
`src/services/meshTopology.ts` (shared topology helpers), `boundaryLoops.ts`
(`extractBoundaryLoops` + `centroidFan`), `repairStages.fillLoop` +
`fillHoles` refactored onto the extractor, `holeFillOverlay.ts` (translucent
cap + outline overlays, `pickOverlay`), `Viewer3D` scene-level overlay group +
`holeFillMode` effect + `applyLoopFill` (one `Fill hole` undo entry),
`RepairSection` toggle. Spec:
`2026-08-30-sp2c-fill-single-hole-design.md`; plan:
`../plans/2026-08-31-sp2c-fill-single-hole.md`.
```

Fill the commit range from `git log` after Task 8.

- [ ] **Step 4: Fold the plan's spec refinements back into the spec**

In `docs/superpowers/specs/2026-08-30-sp2c-fill-single-hole-design.md`, append
a short `## Implementation notes (2026-08-31)` section recording the four
refinements listed at the top of this plan (meshTopology extraction,
translucent cap pick target, scene-level overlay group, overlay logic tested
in `holeFillOverlay.test.ts` not `Viewer3D.test.tsx`), so the spec and the
shipped code agree.

- [ ] **Step 5: Full verification gate**

Run: `pnpm test`
Expected: green.

Run: `pnpm exec tsc --noEmit`
Expected: clean.

Run: `pnpm build`
Expected: clean.

Run: `pnpm test:e2e -- prepare-panel`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md docs/superpowers/specs/2026-08-30-print-prep-roadmap.md docs/superpowers/specs/2026-08-30-sp2c-fill-single-hole-design.md
git commit -m "docs: record SP-2c fill-single-hole"
```

---

## Self-Review

**Spec coverage:**

- Spec §1 `boundaryLoops.ts` / `extractBoundaryLoops` → Task 2. Helper sharing
  → Task 1 (refined to `meshTopology.ts`, noted).
- Spec §2 `fillHoles` refactor + `fillLoop` → Task 3.
- Spec §3 store `holeFillMode` / `holeFillStatus` + `setFile` resets → Task 4.
- Spec §4 overlay build / dispose / hover / pick / `Escape` / auto-disarm /
  `applyLoopFill` + `Fill hole` undo entry / no `sealApplied` touch → Tasks 5
  (pure overlay + pick) and 6 (Viewer3D wiring, listeners, undo, disarm).
  `isRepairable` lifted to module scope → Task 6 Step 1.
- Spec §5 `RepairSection` toggle + status line copy → Task 7.
- Spec §6 README / CHANGELOG / roadmap → Task 9.
- Spec Testing list: `boundaryLoops.test.ts` → Task 2; `repairStages` `fillLoop`
  + `fillHoles` regression → Task 3; `viewerStore` → Task 4; `RepairSection`
  → Task 7; overlay unit coverage (spec put this under `Viewer3D.test.tsx`,
  refined to `holeFillOverlay.test.ts`) → Task 5; e2e `prepare-panel` → Task 8.
- Spec Risks: non-planar caps (inherent, unit-asserted outward normal in
  Tasks 2, 3), line-vs-area picking (resolved by the cap pick target, Task 5),
  badge positioning (Task 6 Step 3, with a panel-status-line fallback already
  present in Task 7), re-extraction cost (accepted), drag-vs-click (Task 6
  Step 3 `Math.hypot > 4` guard), overlay hidden from traversals (scene-level
  group, Task 6 Step 2 + refinement note).

No spec requirement is left without a task.

**Placeholder scan:** No `TBD` / `TODO` / "handle edge cases" / "similar to
Task N". Every code step carries the actual code. The one deferred decision
(inverse-world round trip vs `localPoints` on `OverlayEntry`) has both
branches written out (Task 6 Step 3 note, Task 8 Step 3).

**Type consistency:**

- `StageResult { geometry; note? }` — used identically in Tasks 3, 6.
- `BoundaryLoop { points: [number,number,number][]; vertexCount: number }` —
  Tasks 2, 5, 6 agree.
- `extractBoundaryLoops → { loops: BoundaryLoop[]; skippedPinched: number }` —
  Tasks 2, 3, 5 agree.
- `centroidFan(points) → Float32Array` — Tasks 2, 3, 5 agree.
- `buildLoopOverlays(meshes, isEligible, materials) → { entries: OverlayEntry[]; skippedMeshes: number }`
  — Tasks 5, 6 agree; `OverlayEntry` members (`mesh`, `loop`, `cap`,
  `outline`, `group`) used consistently in Task 6.
- `pickOverlay(entries, raycaster) → number` (`-1` on miss) — Tasks 5, 6 agree.
- `isRepairable(m) → boolean` — one module-scope definition (Task 6 Step 1),
  consumed by `runRepair` and `buildLoopOverlays` caller.
- Store: `holeFillMode`, `setHoleFillMode`, `holeFillStatus`,
  `setHoleFillStatus` — defined Task 4, consumed Tasks 6, 7.
- Undo label string `'Fill hole'` — identical in Task 6 (`pushUndo`) and Task 8
  (`toHaveText(['Fill hole'])`).
