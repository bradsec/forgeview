# Forge View

A cross-platform 3D CAD file previewer built with Tauri 2, React 19, TypeScript,
and Three.js.

## Supported formats

STL (ASCII and binary), 3MF, OBJ, GLTF, GLB, PLY, DAE.

## Features

- Native file open dialog and drag-and-drop loading (drops work any time, including over an open model)
- Paged directory explorer and preview grid with multi-model "add to scene" assembly view
- Grid breadcrumbs, name/size/modified sorting, and persistent thumbnail cache (IndexedDB)
- Export the scene as STL, 3MF, OBJ, PLY, or GLB (File > Export model as)
- Edit models in place with worker-backed Make solid processing, live progress, mesh-health results, and one-level undo
- Stage-by-stage progress feedback while reading and parsing large files and while serializing and saving exports
- Details include vertices, mesh count, and watertightness indicators
- Compact app menu, left Explorer, right Details panel, and bottom camera navigation
- In-app format help, About information, and repository/version status footer
- Orbit, pan, zoom controls plus a view cube and keyboard-accessible standard view snaps
- Solid, wireframe, and points view modes
- Perspective and orthographic projection
- Dark and light themes
- Quality presets (low, medium, high) with advanced overrides, persisted to disk

## Editing and export

Export preserves static mesh transforms, instances, material groups, vertex
colors, and other geometry attributes supported by the target format. Bake
skinned poses and active morph deformation into static geometry before export.

Edit > Make solid fills the scene into one STL-style solid. Internal geometry
that is not part of the outside surface, enclosed cavities and parts hidden
inside other parts, is deleted, touching parts join under one skin, and
triangle and vertex counts drop while the outer appearance stays exactly as
loaded. Materials collapse to a single solid material. Draft, Standard, and
Fine detection detail trade processing cost against how small an opening still
counts as sealed. Undo restores the original geometry and materials.

3MF export includes an explicit physical-unit selector and defaults to
millimetres. STL, OBJ, and PLY do not encode physical units.

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
folder to refresh it. In browsers without the native directory picker (Firefox,
Safari) an in-app dialog explains this before the browser shows its
upload-style confirmation.

Supported browsers show a Save As picker for exports, allowing the filename and
location to be selected; other browsers use their configured download behavior.
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
- `CLAUDE.md` architecture and conventions reference
