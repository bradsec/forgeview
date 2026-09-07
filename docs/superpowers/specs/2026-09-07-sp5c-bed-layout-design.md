# SP-5c: Bed layout

**Status:** design approved (autonomous cycle, decisions recorded as rulings)
**Roadmap:** SP-5 decomposition, third and final cycle. SP-5a build-volume
box and SP-5b auto-orient shipped.
**Depends on:** SP-5a (`buildVolumeMm` store field, the box overlay). Reuses
SP-3b / SP-5b's Transform handle + undo pattern.

## Goal

One "Arrange on plate" button that lays the scene's models out in a
non-overlapping grid inside the build-volume footprint, dropping each to the
plate, as a single undoable step. It only translates; rotation is
auto-orient's job. Models that do not fit are left where they are and
reported.

## Non-goals (no task, deliberate)

- Rectangle bin-packing / nesting / MaxRects. A shelf (row) pack of
  axis-aligned footprint boxes is the first-pass arrange every slicer does;
  tighter packing is out of scope.
- Rotating a model to make it fit.
- Per-part layout of a split-by-shell model (that is one model; the button
  is disabled while split, via the existing Transform lock).
- Stacking in Z, or scaling anything down to fit.
- Keeping the arrangement stable as models are added or removed. Each press
  re-lays everything from scratch.
- A store field, a readiness row, or a `GeometryDetails` change.

## Architecture

### Layout solver (`src/services/bedLayout.ts`) - new file

Pure. No `three` needed.

```ts
export interface LayoutItem {
  id: string
  /** footprint extent on X and Z, in the same units as `bed` */
  w: number
  d: number
}

export interface LayoutPlacement {
  id: string
  /** centre of the item's footprint, relative to the plate centre (origin) */
  cx: number
  cz: number
}

export interface BedLayoutResult {
  placements: LayoutPlacement[]
  /** ids that did not fit the footprint at all */
  unplaced: string[]
}

/**
 * Shelf pack: sort by depth then width descending, fill rows left to right
 * within `bed.x`, start a new row (offset on Z by the previous row's tallest
 * footprint plus `gap`) when the next item overflows. An item wider than
 * `bed.x` or a row that overflows `bed.z` goes to `unplaced`. The packed
 * block is finally centred on the origin.
 */
export function computeBedLayout(
  items: LayoutItem[],
  bed: { x: number; z: number },
  gap: number,
): BedLayoutResult
```

**Algorithm:**

1. Sort a copy of `items` by `d` desc, then `w` desc (stable-ish rows,
   biggest first). Ties keep input order.
2. Pack into the first quadrant `[0, bed.x] x [0, bed.z]`:
   - `cursorX = 0`, `cursorZ = 0`, `rowMaxD = 0`.
   - For each item:
     - If `item.w > bed.x` -> `unplaced`, skip.
     - If `cursorX > 0 && cursorX + item.w > bed.x` -> new row:
       `cursorX = 0`, `cursorZ += rowMaxD + gap`, `rowMaxD = 0`.
     - If `cursorZ + item.d > bed.z` -> `unplaced`, skip.
     - Placement raw: `rx = cursorX + item.w / 2`, `rz = cursorZ + item.d / 2`.
       `cursorX += item.w + gap`. `rowMaxD = Math.max(rowMaxD, item.d)`.
3. Centre: from the raw placements compute the used bounding box
   `[min(rx - w/2) .. max(rx + w/2)]` on X and the same on Z; shift every
   placement by `-(usedMinX + usedMaxX) / 2` on X and the Z equivalent, so
   `cx` / `cz` are plate-centre relative. With no placements, return empty.
4. `placements` preserves the SORTED order; `unplaced` preserves it too. The
   caller maps back by `id`.

`gap` and the bed size are the caller's to supply; the solver has no
constants.

### Viewer3D (`src/components/Viewer3D.tsx`)

New handle method:

```ts
export type ArrangeOutcome =
  | { status: 'arranged'; placed: number; total: number }
  | { status: 'empty' }
```

```ts
arrangeOnPlate: () => {
  // The scene's independent models: the single-file preview root plus every
  // multi-model entry. NOT the split-parts group (that is one model's pieces;
  // the Transform lock already blocks the button while split).
  const roots = [modelGroupRef.current, ...modelMapRef.current.values()]
    .filter((r): r is THREE.Object3D => Boolean(r))
    .filter((r) => {
      let has = false
      r.traverse((c) => { if (c instanceof THREE.Mesh && (c.geometry as THREE.BufferGeometry).getAttribute('position')?.count) has = true })
      return has
    })
  if (roots.length === 0) return { status: 'empty' as const }

  const unit = useViewerStore.getState().geometryDetails?.modelUnitInMm ?? 1
  const bvol = useViewerStore.getState().buildVolumeMm
  const bed = { x: bvol.x / unit, z: bvol.z / unit }
  const gap = Math.max(3 / unit, bed.x * 1e-3)   // ~3 mm between parts

  // Per-root: tight world footprint + current footprint centre + base Y.
  const info = roots.map((r) => {
    const box = new THREE.Box3().expandByObject(r, true)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    return { r, w: size.x, d: size.z, cx: centre.x, cz: centre.z, minY: box.min.y }
  })

  const { placements, unplaced } = computeBedLayout(
    info.map((i) => ({ id: i.r.uuid, w: i.w, d: i.d })),
    bed,
    gap,
  )
  const placedSet = new Set(placements.map((p) => p.id))
  const byId = new Map(info.map((i) => [i.r.uuid, i]))

  const prevPos = roots.map((r) => r.position.clone())

  for (const p of placements) {
    const i = byId.get(p.id)!
    i.r.position.x += p.cx - i.cx
    i.r.position.z += p.cz - i.cz
    i.r.position.y += -i.minY
  }
  // Unplaced roots keep their position untouched.

  pushUndo({
    label: 'Arrange on plate',
    apply: () => {
      const live = [modelGroupRef.current, ...modelMapRef.current.values()]
        .filter((r): r is THREE.Object3D => Boolean(r))
      live.forEach((r, idx) => { if (prevPos[idx]) r.position.copy(prevPos[idx]) })
      updateGeometryDetails()
      refreshSceneEnvironment()
      invalidate()
    },
    discard: () => {},
  })
  updateGeometryDetails()
  refreshSceneEnvironment()
  invalidate()

  return { status: 'arranged' as const, placed: placedSet.size, total: roots.length }
},
```

Note the undo closure re-derives the root list the same way (index-aligned
with `prevPos`). If a model was removed between the arrange and the undo the
indices could drift; this matches the existing `dropToFloor` / `centerOnPlate`
undo closures, which have the same shape, and removing a model while an undo
entry is pending is already an edge the undo stack does not guarantee.

### TransformSection (`src/components/prepare/TransformSection.tsx`)

An "Arrange on plate" button in the Drop-to-floor / Center-on-plate row
(after "Auto-orient"), `disabled={locked}`. A `layoutNote` state, separate
from `orientNote`:

```ts
const runArrange = () => {
  const r = viewerRef.current?.arrangeOnPlate()
  if (!r || r.status === 'empty') return
  if (r.placed === r.total) setLayoutNote(`Arranged ${r.total} model${r.total === 1 ? '' : 's'}`)
  else setLayoutNote(`Arranged ${r.placed} of ${r.total}, the rest do not fit`)
}
```

The note `<p>` renders after `orientNote`'s. Cleared on a manual move
(positions change) - add `setLayoutNote(null)` to `applyMove` and the drop /
centre handlers, same as `orientNote` is cleared on rotate / mirror.

### HelpModal (`src/components/HelpModal.tsx`)

Append after "Auto-orient":

```ts
  {
    title: 'Arrange on plate',
    body: 'Arrange on plate lays every model in the scene out in a grid inside the build volume footprint and drops each to the plate, as one undoable step. It only moves models, it does not rotate or scale them. Models too large for the footprint are left where they are and reported.',
  },
```

### e2e (`e2e/bed-layout.spec.ts`)

The browser drop path is single-file, and multi-model add needs the
directory browser, so the e2e exercises the wiring with one model: drop a
box authored away from the origin, open Prepare, click "Arrange on plate",
assert the note reads "Arranged 1 model", assert the undo history has an
"Arrange on plate" entry, undo it and assert the entry is gone. The
multi-item grid maths is covered by `bedLayout.test.ts`.

### Docs

- README: an "Arrange on plate" bullet by the Transform / Auto-orient lines.
- CHANGELOG under the unreleased heading: bed layout, SP-5c, a one-press
  grid arrange of the scene's models.
- Roadmap SP-5 table: SP-5c row to SHIPPED. Note SP-5 (auto-orient + build
  volume) is then complete.

## Global constraints

- No new npm dependency.
- No em dash in prose, comments, or commit messages.
- No `@testing-library/jest-dom`; assert with vitest / RTL core.
- Every feature ships in the same cycle: code + unit tests + a passing e2e
  + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap.

## Rulings

- **R1. Shelf (row) pack of axis-aligned footprint boxes, sorted
  depth-then-width descending.** Deterministic, dependency-free, and the
  standard first-pass arrange. No bin-packing, no rotation-to-fit.
- **R2. Footprint = the tight world XZ bounding box** (`expandByObject(root,
  true)`, matching SP-5b's fix), so a rotated model packs by what it
  actually occupies.
- **R3. `gap` is ~3 mm (scaled by `modelUnitInMm`), hardcoded.** Enough to
  separate parts for a slicer without a UI knob.
- **R4. Bed = `buildVolumeMm` scaled by `modelUnitInMm`** on X and Z (the
  footprint), same conversion SP-5a's box uses. Y (height) is not a layout
  constraint here.
- **R5. Only translate, one "Arrange on plate" undo entry** restoring every
  root's prior position. Rotation and scale are untouched. Unplaced models
  are not moved.
- **R6. Operates on the preview root + multi-model roots, not the
  split-parts group.** The Transform lock already disables the button while
  a model is split or a measure is in progress.
- **R7. No store field, no `prepChecks` / `GeometryDetails` change.** The
  On build plate row already reports fit for the union after the arrange.
- **R8. Each press re-lays from scratch.** No incremental / stable layout.
