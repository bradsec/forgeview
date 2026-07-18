# Changelog

## 1.5.0 - 2026-07-18

- Rework Edit > Make solid into a solid fill that preserves the outer
  appearance exactly: internal geometry not visible from outside air is
  deleted, touching parts join under one continuous skin, the openings left
  behind are sealed, and the result collapses to one STL-style solid with a
  single material. Triangle and vertex counts drop instead of growing.
- Keep a two-voxel safety margin around outside-reachable air so recessed
  visible detail such as grooves and panel gaps is never deleted.
- Remove the voxel remesh and voxel core modes, whose reconstructed surfaces
  replaced the original skin with blocky geometry.
- Show stage-by-stage progress while reading and parsing large model files and
  while serializing and saving exports.
- Skip empty placeholder meshes during export and in Details, fixing an export
  crash and a stale "Needs repair" status after Make solid.
- Remove Edit > Resize.

## 1.4.5 - 2026-07-18

- Reset the view mode to Solid when opening a model, and use the browser Save As
  picker for export naming and location where the browser supports it.
- Export the open scene as STL, 3MF, OBJ, PLY, or GLB from File > Export
  model as. Browser mode downloads the file; the desktop app saves through
  the native dialog on the Rust side.
- Add Edit > Make solid with a dependency-free volumetric remesher, selectable
  resolution, watertight validation, mesh-health results, and one-level undo.
- Add Edit > Resize with linked proportions and selectable display units, plus
  vertex count, mesh count, and topology health in Details.
- Automatically refit the camera and grid after resizing.
- Correct scene-wide shell removal, preserve export attributes and material
  groups, expand instances, and keep reflected geometry winding outward.
- Prevent incomplete assembly exports while models are loading and reject live
  skinned or morph-deformed meshes until their displayed shape is baked.
- Bound recursive folder and thumbnail work, cancel obsolete queued previews,
  and preserve settings changed during startup hydration.
- Bound native export payloads and reject invalid native file metadata and
  cross-platform filename suggestions before filesystem operations.
- Add explicit 3MF unit selection, replace exports through a synced temporary
  file, use portable PWA manifest paths, and lazy-load export serializers.
- Accept dropped model files at any time, not only on the empty start
  screen, with a drop highlight over the viewer and grid.
- Add breadcrumb navigation and name/size/modified sorting to the preview
  grid, and persist rendered thumbnails in IndexedDB so revisited folders
  load instantly.
- Explain the browser folder-picker fallback with an in-app dialog before
  the browser shows its upload-style confirmation.
- Fix the preview model staying visible in the scene after removing it
  while other models were loaded, stale triangle counts while a new model
  loads, and camera jumps when removing a model from the scene.
- Validate persisted settings before applying them so a corrupt
  settings.json cannot break the renderer.
- Derive the version asserted by end-to-end tests from package.json.

## 1.4.3 - 2026-07-18

- Add a scene context menu for common camera, standard view, projection, and
  display actions.
- Use the browser's read-only directory picker where supported, avoiding
  misleading bulk-upload language while retaining a compatible fallback.

## 1.4.0 - 2026-07-15

- Redesign the web interface around a compact application menu, responsive
  workspace, refined panels, and clearer loading and empty states.
- Give Forgeview a distinct ember-orange identity across both themes, active
  controls, links, focus states, favicons, app icons, and social previews.
- Add Help and About information, creator support details, and a repository and
  version status footer.
- Add Playwright coverage for desktop and mobile layouts, application menus,
  browser console errors, theme colors, support links, and SEO assets.

## 1.3.0 - 2026-07-15

- Constrain native reads and writes to paths granted by the runtime file scope,
  and reject oversized or non-regular files before parsing.
- Bound viewer and thumbnail resource lifetimes, preserve camera clipping planes
  when switching projections, and reject models with invalid geometry bounds.
- Page large explorer directories and preview grids, cap the thumbnail cache,
  and batch file metadata reads.
- Refine the workspace around a Fusion-inspired command bar, Explorer, Details
  panel, view cube, and bottom camera navigation.
- Add keyboard navigation, dialog focus management, visible focus states, and
  WCAG AA accent contrast.
- Gate native packaging on frontend tests, Rust tests, formatting, and linting.

## 1.2.1 - 2026-07-12

- Add source-visible fallback content for crawlers and no-JavaScript visitors.
- Add social and structured data image metadata.

## 1.2.0 - 2026-07-12

- Folder browsing and the preview grid now work in plain browsers without
  the Tauri backend: Open Folder falls back to a browser directory picker
  and serves the explorer tree, grid, and thumbnails from memory
- Render on demand: the 3D viewer and view cube skip GPU work while the
  scene is idle, keeping the browser responsive on weak or
  software-rendered GPUs; initial pixel ratio is capped at 2 on HiDPI
- Clearer error message when WebGL2 is unavailable, with Chrome/Edge
  hardware acceleration guidance

## 1.1.1 - 2026-07-12

- Add static SEO metadata, canonical URL, social preview image, favicons,
  robots.txt, sitemap.xml, web manifest, and SoftwareApplication structured data
  for the GitHub Pages web build.

## 1.1.0 - 2026-07-06

- Upgrade the full stack to latest: three.js 0.185, React 19.2.7,
  TypeScript 6, Vite 8, Tailwind 4.3, Zustand 5.0.14, vitest 4.1,
  Tauri CLI/plugins 2.11
- three.js is now WebGL2-only again (r163+ dropped WebGL1); browsers
  without WebGL2 see the WebGL2 error banner. Enable hardware
  acceleration / allow WebGL2 for your GPU to render.

## 1.0.1 - 2026-07-06

- Handle WebGL context creation failure gracefully: clear error banner
  instead of an uncaught crash when WebGL is unavailable
- Pin three.js to 0.162.0, the last release that falls back to WebGL1
  automatically, so the web build renders in browsers without WebGL2

## 1.0.0 - 2026-07-05

Initial release.

### Viewer

- STL (ASCII and binary), 3MF, OBJ, GLTF, GLB, PLY, DAE support
- Native file dialog and drag-and-drop loading
- Directory explorer with multi-model "add to scene" assembly view
- Thumbnail preview grid for folders (current or recursive scope)
- Orbit, pan, zoom controls, view cube, standard view snaps
- Solid, wireframe, and points view modes
- Perspective and orthographic projection
- Dark and light themes, quality presets with overrides, persisted settings
- Responsive layout with mobile drawers

### Web build

- Browser fallback: drag-and-drop and file-picker model viewing without the
  Tauri backend, deployed to GitHub Pages via CI

### Security

- Native file commands validate canonical paths against the runtime fs scope
- Content-Security-Policy enabled for the webview
