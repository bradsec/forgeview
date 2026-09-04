# SP-3a: Real-world units + measure

Status: approved design, 2026-09-04. Part of the print-prep roadmap
(`2026-08-30-print-prep-roadmap.md`). SP-3 (units + measure + transform) is
split into two cycles like SP-2:

- **SP-3a (this spec):** real-world units, mm dimensions readout, point-to-point
  measure, scale-to-target, scale-to-build-volume.
- **SP-3b (later):** transform panel (move / rotate / free scale / mirror /
  drop-to-floor / center-on-plate).

Builds on SP-1 (Prepare panel) and SP-2a (undo stack). Independent of the
SP-2b/c/d repair code paths; reuses the SP-2c viewport-pick overlay pattern
(`holeFillOverlay.ts`) and the SP-2a `UndoEntry` contract.

## Purpose

Give Forge View a real-world scale. Today `geometryDetails.width/height/depth`
are computed in raw model units and never shown, and the `measurementUnit`
store field is unused. After SP-3a a user can:

1. Confirm or correct the import unit for formats that carry no scale
   (STL / OBJ / PLY).
2. Read the model's bounding box in mm / cm / in.
3. Measure a straight-line distance between two picked surface points.
4. Scale the model so one dimension hits a target length.
5. Scale the model to fit a configurable build volume.

## Current state (relevant slice)

- `src/loaders/index.ts` `parseModelBuffer` sets `object.userData.modelUnitInMm`
  for `.3mf` (`threeMFUnitScale`), `.dae` and `.gltf/.glb` (`1000`, metres to
  mm). `.stl`, `.obj`, `.ply` leave it unset.
- `src/components/Viewer3D.tsx` `updateGeometryDetails()` reads
  `root.userData.modelUnitInMm` off every root; if all roots agree it stores
  that number on `GeometryDetails.modelUnitInMm`, else `null`. It also stores
  `width/height/depth` from the union `Box3` size (raw model units).
- `src/store/viewerStore.ts`: `GeometryDetails.modelUnitInMm: number | null`,
  `measurementUnit: MeasurementUnit` (`'mm' | 'cm' | 'm' | 'in'`, default
  `'mm'`, currently no reader), `setMeasurementUnit`.
- `Sidebar.tsx` Details tab renders Name / Format / Size / Triangles and a
  Geometry grid (Vertices / Meshes / Boundary edges / Non-manifold). No
  dimensions shown.
- `Viewer3DHandle` already exposes `getModelDimensions(): THREE.Vector3 | null`
  (raw units), `undoEdit`, `getScene`, `getCamera`.
- `collectExportMeshes` (exporters) calls `root.updateMatrixWorld(true)`, then
  per mesh `geometry.clone().applyMatrix4(matrixWorld)` and reverses winding
  when `determinant() < 0`. A scale applied to the model root is therefore
  baked correctly on export.
- SP-2c precedent: `holeFillMode` store flag, a `useEffect` in `Viewer3D` keyed
  on the flag that builds a scene-level overlay group and runs a pointer pick
  loop, an HTML badge positioned from projected NDC (`Viewer3D` ~line 1440),
  auto-off when `repairDialogOpen` turns on.
- SP-2d precedent: `splitParts.length > 0` disables Repair actions; a
  scene-swap edit builds a bespoke `UndoEntry`.

## Decisions (locked, from brainstorming 2026-09-04)

### Unit model

- `modelUnitInMm` stays the single source of truth: millimetres per one unit of
  model space. It lives on each model root's `userData` and is surfaced on
  `GeometryDetails`.
- **Assumed unit for unitless formats is mm** (`modelUnitInMm = 1`). STL / OBJ /
  PLY for 3D printing are almost always authored in mm. The model loads and
  renders immediately at that assumption; the prompt is a non-blocking
  correction, never a modal.
- `measurementUnit` is the **display** unit for every readout and the measure
  result. UI offers `mm`, `cm`, `in`. The `'m'` member stays in the type
  (harmless) but is not offered.
- No persistence in SP-3a: the assumed unit resets to mm on each import, the
  display unit and build volume are in-memory store state with defaults. A
  persisted per-format preference and a persisted plate size are deferred (the
  SP-5 build-volume box may own plate config).

### Import unit prompt

- Rendered inline in the **Details tab**, directly above the new Dimensions
  block, only when `geometryDetails.modelUnitInMm === null`.
- Content: short text "Unit not specified, assuming millimetres.", a
  `mm / cm / in` select defaulting to `mm`, and an **Apply** button.
- Apply calls a new handle method `setModelUnit(mm: number)` that writes
  `userData.modelUnitInMm = mm` on **every root whose value is currently
  unset**, then re-runs `updateGeometryDetails()`. After Apply
  `modelUnitInMm` is no longer `null` and the prompt disappears.
- Not an undo-stack entry. It is trivially reversible by picking a different
  value and Apply again (the prompt reappears only on the next import).
- Multi-model mode: the prompt shows if any root is unset; Apply sets all unset
  roots. Roots that already carry a unit (a glTF added to an STL scene) are
  left alone, which is why `updateGeometryDetails` may still report `null`
  (mixed) afterwards; that is acceptable and documented.

### Dimensions readout

- New `DimensionsReadout` block in the Details tab under the prompt: `W x H x D`
  plus the longest edge, each formatted in `measurementUnit`, and a
  `mm / cm / in` segmented control bound to `setMeasurementUnit`.
- Values: `dimMm = geometryDetails.<axis> * (modelUnitInMm ?? 1)`, then
  `fromMm(dimMm, measurementUnit)`, formatted with `unitConversion.formatLength`
  (up to 2 decimals, trailing zeros trimmed).
- No volume or surface-area row in SP-3a (needs a watertight guarantee; a later
  analysis cycle owns it).

### Point-to-point measure

- New `measureMode` store flag, toggled from a new **Measure** section in the
  Prepare panel (mirrors the SP-2c hole-fill toggle placement).
- A `useEffect` in `Viewer3D` keyed on `measureMode` (and the renderer
  generation, as hole-fill does):
  - builds a scene-level `THREE.Group` (`userData.measureOverlay = true`)
    holding two point markers (small spheres) and one line segment;
  - installs a `pointerdown` handler on the canvas that raycasts against the
    model meshes (`modelMeshes()`), ignoring misses;
  - first hit places marker A; second hit places marker B, draws the line, and
    sets `measureDistanceMm = A.distanceTo(B) * (modelUnitInMm ?? 1)`
    (distances taken in **world space**, so a root `.scale` is included);
  - a third hit clears B and the line and restarts from a fresh A;
  - a DOM badge (same projection math as the split-count badge) shows the live
    distance in `measurementUnit` near the segment midpoint.
- Teardown on toggle-off, on `repairDialogOpen` turning true (auto-off, like
  hole-fill), and on model unload / `setFile`: dispose the group, remove the
  handler, `setMeasureDistanceMm(null)`.
- One measurement at a time. No multi-segment, no angle, no saved list, no
  dimension annotations (all deferred).
- Vertex/edge snapping is out of scope for the first cut: pick the raw surface
  hit. If the e2e proves click precision flaky, add nearest-vertex snap within
  a small screen-space radius as a follow-up task, not a redesign.

### Scale operations

- New **Scale** section in the Prepare panel with two independent actions.
- **Scale to target:** an axis select (`Width / Height / Depth / Longest edge`)
  and a target value in `measurementUnit`. Computes
  `factor = targetMm / currentAxisMm` and applies it uniformly.
- **Scale to build volume:** three plate inputs `X / Y / Z` in mm
  (`buildVolumeMm` store field, default `{ x: 220, y: 220, z: 250 }`, a
  common i3-class bed) with a "Reset to default" affordance. Computes
  `factor = min(plateX / wMm, plateY / hMm, plateZ / dMm)` and applies it
  uniformly (scales up or down to best fit).
- **Application:** a new handle method `scaleModelBy(factor: number)` multiplies
  each model root's `.scale` by `factor`, pushes one `UndoEntry`, then re-runs
  `updateGeometryDetails()` and `refreshSceneEnvironment()` (so the grid and
  camera fit follow). Geometry positions are **not** mutated; the export path
  already bakes `matrixWorld`.
- **UndoEntry:** `label` `"Scale to target"` or `"Scale to fit build volume"`;
  `apply` restores each root's captured pre-scale `.scale` vector and re-runs
  the two refresh functions; `discard` is a no-op (no retained geometry). Built
  bespoke per the SP-2a note that the Make-solid entry shape is wrong to reuse.
- **Guards:** the whole Scale section is disabled, with a reason, when
  `splitParts.length > 0` (mirrors the Repair lock), when `measureMode` is on,
  or when `geometryDetails === null`. Scale to target is additionally disabled
  when the target is not a finite number `> 0`, when `currentAxisMm` is `0`, or
  when the resulting `factor` falls outside `[1e-4, 1e4]` (shown as an inline
  warning). Scale to build volume is disabled when any plate input is not a
  finite number `> 0`.
- Non-uniform / free scale is SP-3b.

### Off-plate readiness row

- SP-1 already renders a disabled "off-plate" row in the readiness card. SP-3a
  wires it: given `buildVolumeMm` and the mm dimensions, the row passes when
  `wMm <= x && hMm <= y && dMm <= z`, otherwise it fails with a "Scale to fit"
  fix that focuses the Scale section. This is cheap and uses data SP-3a
  already introduces; deeper build-volume UI (ghost box, overflow highlight)
  stays with SP-5.

## Architecture

### New files

| File | Responsibility |
|------|----------------|
| `src/services/unitConversion.ts` | Pure. `UNIT_IN_MM` table, `toMm(value, unit)`, `fromMm(mm, unit)`, `formatLength(mm, unit)`. No Three. |
| `src/services/scaleMath.ts` | Pure. `scaleToTargetFactor(currentMm, targetMm)`, `scaleToFitFactor(dimsMm, plateMm)`, `SCALE_FACTOR_BOUNDS`, `isFactorInBounds`. No Three. |
| `src/services/measureOverlay.ts` | Three. `buildMeasureOverlay()`, `setPointA/B`, `updateLine`, `disposeMeasureOverlay`, `pickSurfacePoint(meshes, raycaster)`. Mirrors `holeFillOverlay.ts` structure. |
| `src/components/prepare/UnitPrompt.tsx` | Inline "unit not specified" prompt. Renders only when `modelUnitInMm === null`. |
| `src/components/prepare/DimensionsReadout.tsx` | W/H/D/longest block + `mm/cm/in` control. |
| `src/components/prepare/MeasureSection.tsx` | Measure toggle + live distance text. |
| `src/components/prepare/ScaleSection.tsx` | Scale-to-target + scale-to-build-volume forms. |

### Modified files

| File | Change |
|------|--------|
| `src/store/viewerStore.ts` | Add `measureMode: boolean`, `measureDistanceMm: number \| null`, `buildVolumeMm: { x: number; y: number; z: number }`, and setters `setMeasureMode`, `setMeasureDistanceMm`, `setBuildVolumeMm`, `resetBuildVolumeMm`. Reset `measureMode`/`measureDistanceMm` in the same place `holeFillMode` is reset on `setFile`. `DEFAULT_BUILD_VOLUME_MM` constant. |
| `src/components/Viewer3D.tsx` | `Viewer3DHandle`: add `setModelUnit(mm: number)`, `scaleModelBy(factor: number)`, `getModelDimensionsMm(): THREE.Vector3 \| null`, `resetMeasure(): void`. Add the `measureMode` pick-loop effect + badge. Wire the scale undo entries. |
| `src/components/Sidebar.tsx` | Render `<UnitPrompt />` + `<DimensionsReadout />` in the Details tab after the Geometry grid. |
| `src/components/prepare/PreparePanel.tsx` | Mount `<MeasureSection />` and `<ScaleSection />` (below `PartsSection`). Pass `viewerRef` through. |
| `src/services/prepChecks.ts` | Wire the off-plate row from `buildVolumeMm` + mm dimensions; register its `fixId`. |
| `src/components/prepare/ReadinessCard`/`PreparePanel` fix map | Add the off-plate fix handler (focus Scale section). |

### Data flow

**Unit correction**

```
import (STL/OBJ/PLY)
  -> loader leaves userData.modelUnitInMm unset
  -> Viewer3D.updateGeometryDetails -> GeometryDetails.modelUnitInMm = null
  -> Sidebar renders <UnitPrompt>
  -> user picks unit, clicks Apply
  -> viewerRef.setModelUnit(mm): write userData on all unset roots, updateGeometryDetails()
  -> GeometryDetails.modelUnitInMm = mm -> prompt hidden, readouts populated
```

**Measure**

```
MeasureSection toggle -> store.setMeasureMode(true)
  -> Viewer3D effect: build overlay group, add pointerdown handler
  -> click 1 (mesh hit): marker A
  -> click 2 (mesh hit): marker B + line; setMeasureDistanceMm(|A-B| * (modelUnitInMm ?? 1))
     badge shows fromMm(distance, measurementUnit)
  -> click 3: reset to fresh A
toggle off / repairDialogOpen / setFile -> dispose group, remove handler, setMeasureDistanceMm(null)
```

**Scale**

```
ScaleSection: axis + target (or plate inputs)
  -> currentAxisMm from getModelDimensionsMm()
  -> factor = scaleToTargetFactor(...) | scaleToFitFactor(...)
  -> guard isFactorInBounds(factor)
  -> viewerRef.scaleModelBy(factor):
       capture prevScales = roots.map(r => r.scale.clone())
       roots.forEach(r => r.scale.multiplyScalar(factor))
       pushBounded(undoStack, { label, apply: restore prevScales + refresh, discard: noop })
       updateGeometryDetails(); refreshSceneEnvironment()
  -> store undoLabels updates; readouts + grid follow
```

### Error handling

- **Unit prompt:** hidden when `geometryDetails === null`. `setModelUnit` is a
  no-op when there are no roots.
- **Measure:** pointer misses a mesh -> click ignored. Effect early-returns when
  the renderer / scene / camera refs are absent (WebGL-less); `MeasureSection`
  shows the same "3D view unavailable" note the repair UI uses in that case.
  Auto-off on `repairDialogOpen`, on unload, and on toggle. `modelUnitInMm`
  null -> distance uses `1` (mm assumption) and the section notes "assuming mm".
- **Scale:** target `<= 0`, non-finite, or `currentAxisMm === 0` -> action
  disabled with inline reason. `factor` outside `[1e-4, 1e4]` -> disabled,
  "result out of range" warning. Section fully disabled while split or
  measuring. Plate input `<= 0` / non-finite -> that action disabled.
- **Off-plate check:** when `modelUnitInMm` is null the row still evaluates
  under the mm assumption; that is consistent with every other mm readout.

## Testing

Matches the existing setup (Vitest unit + component, Playwright e2e). A passing
`e2e/units-measure.spec.ts` is the hard completion gate.

### Unit

- `unitConversion.test.ts`: `toMm`/`fromMm` round-trip for mm/cm/in; known
  conversions (`1 in = 25.4 mm`); `formatLength` decimal trimming.
- `scaleMath.test.ts`: `scaleToTargetFactor(50, 100) === 2`; zero current ->
  guarded; `scaleToFitFactor` picks the limiting axis; bounds predicate.
- `measureOverlay.test.ts`: build creates group with 2 markers + 1 line;
  `pickSurfacePoint` returns the nearest hit; distance math multiplies by the
  unit scale; dispose frees geometries and detaches the group.
- `viewerStore.test.ts`: new fields default correctly; `setBuildVolumeMm` /
  `resetBuildVolumeMm`; `setFile` clears `measureMode` + `measureDistanceMm`.
- `prepChecks.test.ts`: off-plate row passes when dims within plate, fails and
  exposes the fix id when any axis exceeds it.

### Component

- `UnitPrompt.test.tsx`: renders only when `modelUnitInMm === null`; Apply
  calls the handle with the selected unit's mm value.
- `DimensionsReadout.test.tsx`: switching the unit control changes the displayed
  numbers and calls `setMeasurementUnit`; uses `modelUnitInMm` in the maths.
- `MeasureSection.test.tsx`: toggle drives `setMeasureMode`; shows
  `measureDistanceMm` formatted in `measurementUnit`; disabled note when no
  model.
- `ScaleSection.test.tsx`: invalid target disables the button; valid target
  calls `scaleModelBy` with the computed factor; section disabled when
  `splitParts.length > 0` or `measureMode`.

### E2E (`e2e/units-measure.spec.ts`, style of `prepare-panel.spec.ts`)

1. Load a unitless STL fixture -> unit prompt visible in Details, Dimensions
   readout shows a mm value.
2. Switch the readout to `in` -> numbers change; back to `mm`.
3. Open Prepare, toggle Measure, click two points on the model -> a distance
   badge/text appears with a plausible mm value.
4. Scale to target: set Width to `100 mm` -> Dimensions readout Width reads
   `100 mm` (within tolerance); grid rescales.
5. Undo -> Width returns to the original.
6. Scale to build volume with a small plate -> model shrinks to fit; off-plate
   readiness row flips to pass.

### Notes

- No worker or wasm boundary in SP-3a, so the fflate/jsdom cross-realm
  typed-array gotcha (`memory: fflate-jsdom-realm-gotcha`) does not apply here;
  called out so a later reviewer does not go looking.
- `memory: make-solid-expectations` is about seal invariants, not scale; scale
  changes every dimension by design and must not be asserted against it.

## Non-goals / carry-forward

- **SP-3b transform panel:** move, rotate, non-uniform/free scale, mirror,
  drop-to-floor (min-Z to 0), center-on-plate. SP-3a deliberately ships only
  uniform scale via two derived factors.
- **Volume / surface-area readout:** deferred to an analysis cycle with a
  watertight guarantee.
- **Measure polish:** multi-segment paths, angle measure, a saved measurement
  list, on-model dimension annotations, vertex/edge snapping (add snapping as a
  follow-up task only if e2e precision demands it).
- **Persistence:** per-format assumed-unit memory and a persisted build volume
  (settings integration; SP-5 build-volume box may take plate config).
- **Build-volume box:** ghost plate mesh, overflow highlighting, lay-flat /
  center buttons -> SP-5.
- **Scale of a split-by-shell parts group:** disabled in SP-3a; revisit if
  SP-3b makes per-part transforms a thing.
