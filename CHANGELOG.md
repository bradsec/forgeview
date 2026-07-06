# Changelog

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

- Native file commands validate paths against the runtime fs scope and the
  user's home directory (canonicalized, traversal-safe)
- Content-Security-Policy enabled for the webview
