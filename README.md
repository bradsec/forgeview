# Forge View

A cross-platform 3D CAD file previewer built with Tauri 2, React 19, TypeScript,
and Three.js.

## Supported formats

STL (ASCII and binary), 3MF, OBJ, GLTF, GLB, PLY, DAE.

## Features

- Native file open dialog and drag-and-drop loading
- Paged directory explorer and preview grid with multi-model "add to scene" assembly view
- Fusion-inspired command bar, left Explorer, right Details panel, and bottom camera navigation
- Orbit, pan, zoom controls plus a view cube and keyboard-accessible standard view snaps
- Solid, wireframe, and points view modes
- Perspective and orthographic projection
- Dark and light themes
- Quality presets (low, medium, high) with advanced overrides, persisted to disk

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

## Web demo (GitHub Pages)

The frontend also runs as a static site without the Tauri backend. In browser
mode you can drag and drop a model file (or use Open / Open Folder, which fall
back to browser pickers) and view it with all camera, view mode, and theme
controls. Open Folder loads a snapshot of the selected folder into the
explorer and preview grid; re-pick the folder to refresh it. Settings
persistence needs native file system access and is disabled in the browser.
The explorer initially shows 100 entries per directory and the preview grid
shows 60 files, with Load more controls for larger folders.

Note: WebGL2 is required. Chrome and Edge disable WebGL entirely when
hardware acceleration is off (chrome://settings/system) and no longer fall
back to software rendering; Firefox falls back automatically.

`.github/workflows/pages.yml` builds and deploys the web bundle to GitHub
Pages on push to `main`. One-time setup: repository Settings > Pages >
Build and deployment > Source: "GitHub Actions".

## Test

```bash
pnpm test                      # frontend unit tests (vitest)
cd src-tauri && cargo test     # backend unit tests
```

## Project layout

- `src/` React + Three.js frontend (components, loaders, hooks, store, themes)
- `src-tauri/` Rust backend (file IO commands, app setup)
- `CLAUDE.md` architecture and conventions reference
