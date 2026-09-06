# SP-5a: Build-volume box

**Status:** design approved (autonomous cycle, decisions recorded as rulings)
**Roadmap:** SP-5 decomposition, first cycle. SP-5 (auto-orient + build
volume) splits into SP-5a build-volume box, SP-5b auto-orient, SP-5c bed
layout.
**Depends on:** nothing new. SP-3 (mm scale, `buildVolumeMm` store field,
`onPlate` readiness row) and SP-4 are shipped.

## Goal

Draw the configured printer build volume as a wireframe box plus a footprint
grid, sitting on the world plate (base at y=0, centred on x=z=0), toggled
from the Prepare panel. It is a fixed real-world reference: it does not move
or scale the model. The user brings the model onto it with the existing
Transform tools (Center on plate, Drop to floor, SP-3b), and the existing
`onPlate` readiness row (SP-3a) already reports whether the model fits
`buildVolumeMm`.

## Non-goals (no task, deliberate)

- Auto-orient. That is SP-5b.
- Bed layout / multi-part packing. That is SP-5c.
- Moving, scaling, or auto-centring the model when the box is shown.
- An editable box origin / offset, clearance margins, or a printer-model
  preset dropdown. The box is `buildVolumeMm` at the origin, nothing more.
- Persisting the toggle per file. `showBuildVolume` is a sticky view
  preference (not reset by `setFile`), matching `clipAxis` in SP-4c.
- A filled / shaded bed surface. Line geometry only, so nothing in the
  group is a `THREE.Mesh` the exporter could pick up.

## Architecture

### Store (`src/store/viewerStore.ts`)

One field next to the SP-4c inspect flags:

| field | type | default |
|-------|------|---------|
| `showBuildVolume` | `boolean` | `false` |

Setter `setShowBuildVolume(on: boolean)`. NOT added to the `setFile` /
`setFileFromBuffer` reset objects (sticky). No `GeometryDetails` /
`prepChecks` change: `onPlate` already covers fit.

### Overlay builder (`src/services/buildVolumeOverlay.ts`) - new file

Pure three.js, mirrors the shape of `src/services/overhangOverlay.ts`
(module with a `build*` and a `dispose*` function, group tagged in
`userData`), but far simpler: no meshes, no world-bake, no eligibility.

```ts
import * as THREE from 'three'

export interface BuildVolumeColors {
  edge: number   // wireframe box edges
  grid: number   // footprint grid lines
}

/**
 * A wireframe box for a printer build volume: footprint `x` by `z`
 * millimetres, height `y`, base on the plane y=0, centred on x=z=0. Plus a
 * footprint grid on y=0. Line geometry only. The returned group is tagged
 * `userData.buildVolumeOverlay = true` so exporters skip it.
 */
export function buildBuildVolumeOverlay(
  volumeMm: { x: number; y: number; z: number },
  colors: BuildVolumeColors,
): THREE.Group {
  const group = new THREE.Group()
  group.userData.buildVolumeOverlay = true

  const { x, y, z } = volumeMm
  const safeX = x > 0 ? x : 1
  const safeY = y > 0 ? y : 1
  const safeZ = z > 0 ? z : 1

  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(safeX, safeY, safeZ)),
    new THREE.LineBasicMaterial({ color: colors.edge }),
  )
  box.position.set(0, safeY / 2, 0)
  group.add(box)

  // Footprint grid: divisions scaled so cells are ~10 mm, clamped to a sane range.
  const divisions = Math.min(60, Math.max(4, Math.round(Math.max(safeX, safeZ) / 10)))
  const grid = new THREE.GridHelper(Math.max(safeX, safeZ), divisions, colors.grid, colors.grid)
  // GridHelper is square; scale X/Z so it matches a non-square footprint.
  grid.scale.set(safeX / Math.max(safeX, safeZ), 1, safeZ / Math.max(safeX, safeZ))
  grid.position.set(0, 0, 0)
  group.add(grid)

  return group
}

export function disposeBuildVolumeOverlay(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      ;(child.material as THREE.Material).dispose()
    }
  })
  group.parent?.remove(group)
}
```

Notes:
- `EdgesGeometry(BoxGeometry)` yields the 12 box edges, no diagonals.
- `GridHelper` extends `THREE.LineSegments`, so the single `instanceof
  THREE.LineSegments` branch disposes both children (box + footprint grid).
- Non-positive dimensions are clamped to 1 so a half-typed value in the
  ScaleSection inputs cannot throw `BoxGeometry`.

### Viewer3D (`src/components/Viewer3D.tsx`)

`buildVolumeOverlayRef` + helpers next to the SP-4c `teardownClip`:

```ts
const buildVolumeOverlayRef = useRef<THREE.Group | null>(null)

const rebuildBuildVolumeOverlay = () => {
  const scene = sceneRef.current
  if (!scene) return
  teardownBuildVolumeOverlay()
  const theme = getTheme(useViewerStore.getState().theme)
  const group = buildBuildVolumeOverlay(useViewerStore.getState().buildVolumeMm, {
    edge: new THREE.Color(theme.accent).getHex(),
    grid: theme.gridPrimary,
  })
  scene.add(group)
  buildVolumeOverlayRef.current = group
  invalidate()
}

const teardownBuildVolumeOverlay = () => {
  if (buildVolumeOverlayRef.current) disposeBuildVolumeOverlay(buildVolumeOverlayRef.current)
  buildVolumeOverlayRef.current = null
  invalidate()
}
```

One effect, after the SP-4c clip effects:

```ts
// Effect 23: Build-volume box - draw the configured printer volume as a
// wireframe box on the plate while shown. Static reference geometry, no
// interlock: it never hides or edits the model.
const showBuildVolume = useViewerStore((s) => s.showBuildVolume)
const buildVolumeMm = useViewerStore((s) => s.buildVolumeMm)
useEffect(() => {
  if (!showBuildVolume) return
  rebuildBuildVolumeOverlay()
  return () => {
    teardownBuildVolumeOverlay()
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [showBuildVolume, buildVolumeMm.x, buildVolumeMm.y, buildVolumeMm.z, rendererGen])
```

No interlock effect, no repair auto-disarm (the box is inert line geometry:
it does not hide the model, swap geometry, or attach listeners). A theme
change already triggers the existing renderer/grid rebuild path; keying on
`rendererGen` is enough to pick a new theme colour up on the next
context/settings swap, and a live theme toggle can rebuild via the same
`buildVolumeMm` identity if needed - out of scope to chase here, the box
colour refreshing on the next rebuild is acceptable.

`buildVolumeMm` is an object; React compares it by reference and the store
replaces it wholesale on every `setBuildVolumeMm`, so `[..., buildVolumeMm.x,
buildVolumeMm.y, buildVolumeMm.z, ...]` is the precise trigger (primitive
deps, no needless rebuilds).

### Exporters (`src/services/exporters.ts`)

The overlay is line geometry only, so `collectExportMeshes`'s `node
instanceof THREE.Mesh` filter already skips it. Still, add the tag to the
existing skip guard for defence and consistency with the other overlays:

```ts
if (node.userData.measureOverlay || node.userData.holeOverlay || node.userData.overhangOverlay || node.userData.wallThicknessOverlay || node.userData.buildVolumeOverlay) return
```

Update the comment above it. Mirror the existing `wallThicknessOverlay`
exclusion test for `buildVolumeOverlay`.

### ScaleSection (`src/components/prepare/ScaleSection.tsx`)

A toggle directly under the "Scale to build volume (mm)" input row (the
three `Build volume x/y/z` inputs + Reset), so the box control sits with the
box dimensions:

```tsx
<button
  type="button"
  aria-pressed={showBuildVolume}
  onClick={() => useViewerStore.getState().setShowBuildVolume(!showBuildVolume)}
  className={
    'px-3 py-1.5 rounded text-sm self-start disabled:opacity-50 ' +
    (showBuildVolume ? 'bg-[var(--accent-button)] text-white' : 'bg-[var(--bg-button)]')
  }
>
  {showBuildVolume ? 'Hide build volume' : 'Show build volume'}
</button>
```

`const showBuildVolume = useViewerStore((s) => s.showBuildVolume)` selector
near the top. Not `disabled` on `!hasModel`: the box is useful as an empty
bed reference too. It is not gated by the section's `locked` (that guards
edits that mutate the model; showing a reference box mutates nothing).

### HelpModal (`src/components/HelpModal.tsx`)

Append to `HELP_SECTIONS`, after "X-ray and clip plane":

```ts
  {
    title: 'Build volume',
    body: 'Show build volume draws your configured printer volume as a wireframe box on the plate, centred on the origin with its base at Z zero. It is a fixed reference and does not move or scale the model. Set the size with the Scale to build volume fields, then use Center on plate and Drop to floor to bring the model onto it. The On plate readiness row reports whether it fits.',
  },
```

### e2e (`e2e/build-volume-box.spec.ts`)

Mirror `e2e/xray-clipping.spec.ts` conventions: inline cube STL +
`DragEvent('drop')`, `.filter({ visible: true })` on every locator,
`test.skip(isMobile, ...)`, `test.setTimeout(120_000)`.

Scenario:
1. Drop a cube, open Prepare, open the Scale section (it may be a
   collapsible; read `ScaleSection.tsx` / how other Prepare sections are
   driven in existing e2e).
2. Click "Show build volume" -> "Hide build volume" visible.
3. Change a "Build volume x" input (e.g. to `120`) -> no throw, toggle
   stays "Hide build volume" (the effect rebuilds on the dimension change).
4. Click "Hide build volume" -> "Show build volume" back.
5. Re-show, then export via the File menu -> download `cube.stl`
   (`exportSTL` on a 12-triangle cube stays 12 triangles - the box is
   excluded).

### Docs

- README: an "X-ray, clip plane, build volume" style bullet by the
  Analysis / Scale features.
- CHANGELOG under the unreleased heading: build-volume box, SP-5a, a
  wireframe reference that does not move the model.
- Roadmap: extend the SP-5 section (create it if absent) with an SP-5a
  SHIPPED row; note SP-5b (auto-orient) and SP-5c (bed layout) remain.

## Global constraints

- No new npm dependency. `THREE.BoxGeometry` / `EdgesGeometry` /
  `GridHelper` / `LineSegments` are built in.
- No em dash in prose, comments, or commit messages.
- No `@testing-library/jest-dom`; assert with vitest / RTL core.
- Every feature ships in the same cycle: code + unit tests + a passing e2e
  + a `HELP_SECTIONS` entry + README / CHANGELOG / roadmap. (feature-ship
  checklist.)

## Rulings

- **R1. SP-5a is the box only.** Auto-orient and bed layout are separate
  cycles with their own specs. This keeps each cycle a reviewable unit.
- **R2. The box is a fixed world-plate reference and never touches the
  model.** Positioning is the user's job via the shipped Transform tools;
  fit reporting is the shipped `onPlate` row. No auto-centre, no "the box
  followed the model" ambiguity.
- **R3. Line geometry only.** Wireframe box (`EdgesGeometry`) plus a
  `GridHelper` footprint. No `THREE.Mesh`, so `collectExportMeshes` skips
  it on the type check alone; the `userData` tag + skip-guard entry are
  belt-and-braces. Box edges take the theme `accent` (warm, distinct from
  the cool model grid); footprint takes `gridPrimary`.
- **R4. `showBuildVolume` is a sticky view preference**, not reset by
  `setFile`, matching SP-4c's `clipAxis` / `clipOffset` / `clipFlip`.
- **R5. No interlock, no repair auto-disarm.** The box hides nothing, edits
  nothing, listens to nothing. The single lifecycle effect keyed on
  `[showBuildVolume, buildVolumeMm.x/y/z, rendererGen]` is the whole
  Viewer3D surface.
- **R6. Non-positive dimensions clamp to 1 in the builder** so a
  mid-edit ScaleSection value (empty string parses to 0) cannot throw
  `BoxGeometry`.
- **R7. No `prepChecks` / `GeometryDetails` change.** SP-3a's `onPlate` row
  already computes model-vs-`buildVolumeMm` fit.
