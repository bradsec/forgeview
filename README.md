# Forge View

A cross-platform 3D CAD file previewer built with Tauri 2, React 19, TypeScript,
and Three.js.

## Supported formats

STL (ASCII and binary), 3MF, OBJ, GLTF, GLB, PLY, DAE.

## Features

The interface uses copper accents, readable light and dark themes, and a wider
resizable inspector. Prepare keeps checks and Repair visible, with the remaining
tools under expandable section headings in their existing order.

- Native file open dialog and drag-and-drop loading (drops work any time, including over an open model)
- Paged directory explorer and preview grid with multi-model "add to scene" assembly view
- Grid breadcrumbs, name/size/modified sorting, and persistent thumbnail cache (IndexedDB)
- Export the scene as STL, 3MF, OBJ, PLY, or GLB (File > Export model as)
- Prepare panel (right sidebar) with a print-readiness score card and a worker-backed Repair modal of individually runnable mesh-repair stages, live progress, and up to 5 steps of undo
- **Fill a single hole** — arm from the Repair section, then click a highlighted open loop in the viewport to cap just that hole. Each fill is a separate entry in the undo history. Eligible meshes only (single material, no textures); ineligible meshes are reported as a count.
- **Split by shell** — separate a multi-body model into individually named
  parts, each with its own visibility toggle and Export. Tiny disconnected
  fragments are dropped. Undo "Split by shell" from the history to recombine.
  Works on a single-mesh preview model (not multi-model mode, not textured or
  multi-material meshes).
- **Units and measure** — import unit prompt for unitless formats (STL/OBJ/PLY),
  bounding-box dimensions in mm/cm/in, point-to-point distance measure on the
  model, scale to target length, scale to fit configurable build volume.
- **Transform panel**: move, rotate, free scale per axis, mirror, drop to floor,
  and center on plate. Each action is one undoable edit.
- **Auto-orient**: search rest orientations and rotate the model to the one
  with the least downward-facing overhang area, then drop it to the floor and
  center it on the plate as a single undoable step. Large models are skipped.
- **Arrange on plate**: shelf-pack every model in the scene into a grid on the
  plate within the build-volume footprint and drop each in one undoable step.
  Models too large for the footprint are left alone and reported.
- **Overhang heatmap** — analyse and highlight faces past a configurable overhang
  angle (default 45 degrees), directly in the viewport. Adjustable threshold in
  the Prepare panel.
- **Wall thickness heatmap**: analyse and highlight faces thinner than a configurable
  minimum (default 1.0 mm), using an inward ray per face. Adjustable threshold in
  the Prepare panel. Large models are skipped for speed.
- **X-ray and clip plane**: make the model translucent to inspect interiors, and adjust an axis-aligned clipping plane to hide one side of an X, Y, or Z cut for a live cross-section. Both tools are mutually exclusive with the overhang and wall-thickness heatmaps and hole-fill.
- **Build volume**: show the configured printer volume as a wireframe box on the plate, a fixed reference that does not move or scale the model.
- Stage-by-stage progress feedback while reading and parsing large files and while serializing and saving exports
- Details include vertices, mesh count, boundary edges, and non-manifold edges
- Compact app menu, left Explorer, right tabbed Details / Prepare panel, and bottom camera navigation
- In-app format help, About information, and repository/version status footer
- Help > Feature guide: an in-app summary of every Prepare-panel tool
- Orbit, pan, zoom controls plus a view cube and keyboard-accessible standard view snaps
- Solid, wireframe, and points view modes
- Perspective and orthographic projection
- Dark and light themes
- Quality presets (low, medium, high) with advanced overrides, persisted to disk

## Editing and export

Export preserves static mesh transforms, instances, material groups, vertex
colors, and other geometry attributes supported by the target format. Bake
skinned poses and active morph deformation into static geometry before export.

The Prepare panel's Repair modal runs mesh-repair stages against the open model,
each on its own or as one pipeline. The dialog keeps its actions visible on short
screens while the stage list scrolls. Escape closes an idle dialog; during a run,
Cancel or Escape requests cancellation and waits for restoration to finish. The individual stages are weld vertices,
remove degenerate faces, remove duplicate faces, unify normals, remove small
shells, and fill holes; each updates the model in place and adds an undo entry.
The individual stages currently apply only to single-material, untextured
meshes. A mesh that uses multiple materials, UV coordinates, or vertex colours
is left unchanged and the dialog reports how many meshes it skipped; Make solid
still seals those meshes.
Make solid is the final sealing stage: internal geometry that is not part of the
outside surface, enclosed cavities and parts hidden inside other parts, is
deleted, touching parts join under one skin, and every open edge left on the
outer surface is sealed, so the result has no holes. The kept exterior triangles
are unchanged, so the outer appearance stays exactly as loaded and triangle and
vertex counts drop. Materials collapse to a single solid material. Draft,
Standard, and Fine detection detail trade processing cost against how finely
interior geometry is separated from the outside surface. Repair all runs every
stage in order, ending with Make solid, in a single pass. Sealing reports its
welding, crack-closing, and final geometry-check phases. Final geometry checks
run in the worker so Cancel remains available during that work. Large meshes
can spend substantial time in the final sealing phases. Stage names and elapsed
time describe ongoing work without presenting a time estimate. The Prepare panel
keeps the last 5 model edits, and each entry in the undo list steps the geometry
and materials back to that point.

The Prepare panel's readiness card summarises watertightness, manifold and open
edges, and degenerate or duplicate faces, with a Fix shortcut that opens the
Repair modal. Wall-thickness, overhang, and build-volume fit checks are also
active; wall-thickness sampling is limited for large models. Once a seal has
run, the watertight and manifold rows
are marked informational: any residual edges are inherited from the original
skin and the rows no longer offer a Fix.

The result is a sealed shell, hollow inside; slicers and CAD tools treat a
closed surface as a solid body. Details reports boundary and non-manifold edge
counts without interpreting them as model damage. Non-manifold edges inherited
from the original skin are kept deliberately, because rewriting them would
change the visible surface, so a sealed result can still report a non-zero
non-manifold count.

Remove internal walls (optional) additionally deletes internal partitions and
doubled surfaces by keeping only triangles that are actually seen from outside
in the GPU visibility pass or sit on the outermost skin. It needs WebGL and can
trim deep recesses that face away from every sampled view, so it is off by
default.

3MF export includes an explicit physical-unit selector and defaults to
millimetres. STL, OBJ, and PLY do not encode physical units.

## Roadmap status

Print-preparation SP-1 through SP-9 and the feature guide are implemented with
the limits below. Optional alignment-pin holes remain outside the SP-6 design.
See the [print-preparation roadmap](docs/superpowers/specs/2026-08-30-print-prep-roadmap.md).

### Solid and mesh operations

Show and position the clip plane under Analysis, then press **Cut at plane**
under Solid operations. Both sides become capped parts; delete an unwanted
part or export it separately. At least one part must remain. Undo restores
parts and the original model.

For booleans, add two models from the folder grid and choose A and B. Both
must use the same assigned units. Subtract removes B from A; the result
occupies A and consumes B geometry. Undo restores both. Empty results leave
both inputs unchanged.

Hollow requires one closed mesh. Set wall thickness in mm and resolution
(16 to 64 samples along the longest dimension). The inner surface is sampled;
wall thickness must be at least one grid cell. An optional cylindrical drain
passes through the model on a scene axis at a center entered in scene mm.
Radius 0 leaves a sealed cavity. Drains that miss the cavity are rejected.

Solid operations require static, untextured meshes with one material. Repair
open surfaces first. Decimate/remesh also requires a single eligible mesh:
edge-collapse decimation accepts up to 10,000 input triangles and targets an
approximate count; uniform voxel remesh accepts up to 100,000 triangles and
grid resolution 8 to 64. Voxel output is stepped and subcell details can vanish.
Neither mode guarantees topology preservation. Inspect results before export.
All operations are undoable. Cancellation and failures preserve input geometry.
Inspection overlays refresh after edits.

### Batch preparation

In the folder grid, open **Batch prepare**, choose units for unitless files,
then **Prepare files**. Each eligible model receives six repair stages and
auto-orientation. **Export ZIP** saves mm, Z-up binary STLs and a manifest of
successes, failures, and skips. This does not run Make solid or guarantee
watertight output. Source files stay untouched.

Limits: 100 files, 32 MiB per source, 200,000 triangles per model, 256 MiB ZIP.
Animated/deformed models and textured or externally referenced glTF/Collada
are skipped. Other failures are recorded while processing continues. Cancel
terminates geometry processing without saving. Parsing and ZIP packaging run
on the main thread; repair/orientation run in workers.

## Prerequisites

- Node.js and pnpm
- Rust toolchain (stable) and the Tauri 2 system dependencies for your platform

## Development

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

Bundle targets are configured in `src-tauri/tauri.conf.json` (`"all"`: every
installer format valid for the host platform, e.g. deb/AppImage/rpm on Linux,
msi/nsis on Windows, dmg/app on macOS). CI (`.github/workflows/publish.yml`)
builds installers for all three platforms on push to `main`.

## Brand icons

`public/icon.svg` is the source for the in-app mark, browser icons, and desktop
bundle icons. After changing it, regenerate the Tauri assets with:

```bash
pnpm tauri icon public/icon.svg
```

The browser PNGs can be regenerated with ImageMagick:

```bash
magick -background none public/icon.svg -resize 16x16 public/favicon-16x16.png
magick -background none public/icon.svg -resize 32x32 public/favicon-32x32.png
magick -background none public/icon.svg -resize 180x180 public/apple-touch-icon.png
magick -background none public/icon.svg -resize 192x192 public/icon-192.png
magick -background none public/icon.svg -resize 512x512 public/icon-512.png
magick -background none public/icon.svg -define icon:auto-resize=64,48,32,16 public/favicon.ico
```

## Web demo (GitHub Pages)

The frontend also runs as a static site without the Tauri backend. In browser
mode you can drag and drop a model file (or use Open / Open Folder, which fall
back to browser pickers) and view it with all camera, view mode, and theme
controls.

Open Folder loads a local, read-only snapshot of the selected folder into the
explorer and preview grid; Forge View does not upload those files. Re-pick the
folder to refresh it. Chromium browsers refuse to grant sites access to
top-level system folders (Documents, Downloads, Desktop, the home folder) and
show a "contains system files" message; pick a subfolder inside them instead. In browsers without the native directory picker (Firefox,
Safari) an in-app dialog explains this before the browser shows its
upload-style confirmation.

Supported browsers show a Save As picker before export processing, allowing
the filename and location to be selected while the browser recognizes the click; other browsers use their configured download behavior.
On iOS the file picker lists all files, because iOS greys out extensions it
cannot map to system types (such as .stl); unsupported picks are rejected after
selection instead.
Settings persistence needs native file system access and is disabled in the
browser. The explorer initially shows 100 entries per directory and the preview
grid shows 60 files, with Load more controls for larger folders.

Note: WebGL2 is required. Chrome and Edge disable WebGL entirely when hardware
acceleration is off (chrome://settings/system) and no longer fall back to
software rendering; Firefox falls back automatically.

`.github/workflows/pages.yml` builds and deploys the web bundle to GitHub
Pages on push to `main`. One-time setup: repository Settings > Pages >
Build and deployment > Source: "GitHub Actions".

## Test

```bash
pnpm test                      # frontend unit tests (vitest)
pnpm test:e2e                  # desktop and mobile app-shell tests (Playwright)
cd src-tauri && cargo test     # backend unit tests
```

## Project layout

- `src/` React + Three.js frontend (components, loaders, hooks, store, themes)
- `src-tauri/` Rust backend (file IO commands, app setup)

## Acknowledgements

Forge View is built on these open-source projects:

- [Three.js](https://threejs.org/) (MIT) — 3D rendering, model loaders
  (STL, 3MF, OBJ, GLTF, PLY, DAE), exporters, and the bundled
  [fflate](https://github.com/101arrowz/fflate) zip library used for 3MF
- [Tauri 2](https://tauri.app/) (MIT/Apache-2.0) — desktop shell, dialog and
  filesystem plugins, and the Rust backend framework
- [React](https://react.dev/) (MIT) — user interface
- [Zustand](https://github.com/pmndrs/zustand) (MIT) — application state
- [Tailwind CSS](https://tailwindcss.com/) (MIT) — styling
- [Serde](https://serde.rs/) (MIT/Apache-2.0) — Rust serialization
- [Vite](https://vite.dev/), [Vitest](https://vitest.dev/),
  [Playwright](https://playwright.dev/), and
  [TypeScript](https://www.typescriptlang.org/) (MIT/Apache-2.0) — build and
  test tooling

Thanks to the maintainers and contributors of these projects.

### Export feedback

Export keeps format and units fixed while serialization and saving run. Failures
appear inside the dialog so the same selections can be retried. The background
workspace is unavailable while a dialog is open; keyboard focus returns to the
trigger when it closes. Mobile keeps status notices visible at the bottom.
