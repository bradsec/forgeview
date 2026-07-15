# Changelog

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
