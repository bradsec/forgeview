# Forge View Architecture and Conventions

Forge View is a Tauri 2 desktop application whose React frontend also runs as a
static browser application. Use `package.json`, `pnpm-lock.yaml`,
`src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` as the authoritative dependency
versions.

## Architecture

- `src/main.tsx` mounts the React application, and `src/App.tsx` composes the
  application shell, viewer, explorer, grid, dialogs, and responsive drawers.
- `src/components/Viewer3D.tsx` owns the Three.js scene, cameras, controls, render
  lifecycle, and loaded model objects. UI components read and update shared state
  through `src/store/viewerStore.ts`.
- `src/loaders/index.ts` is the loader registry and parsing boundary for STL, 3MF,
  OBJ, GLTF/GLB, PLY, and DAE files.
- `src/hooks/` coordinates file and directory opening, global drops, and settings
  persistence. Browser filesystem compatibility lives in `src/services/browserFs.ts`.
- `src/services/` contains thumbnail generation and caching, directory grid data,
  export serialization, browser/native save dispatch, and solid-model processing.
- `src/themes/` and `src/styles/index.css` define theme tokens and application
  styling.
- `src-tauri/src/lib.rs` registers the dialog and filesystem plugins plus the Rust
  commands in `src-tauri/src/commands/`. Native commands validate scoped file
  access and perform native export saves.
- `src-tauri/capabilities/default.json` is the desktop permission boundary, and
  `src-tauri/tauri.conf.json` defines application and bundle configuration.

## Runtime Boundaries

Check `src/utils/isTauri.ts` before calling native-only APIs. Desktop file access
uses Tauri dialog/filesystem scopes and Rust commands. Browser mode uses local
file and directory picker data held in memory; it does not upload selected files.
Browser exports download directly, while desktop exports use the native save
dialog and Rust-side writes.

Keep untrusted model data bounded and validated before parsing or rendering. Do
not bypass Tauri capabilities or the path and file checks in the Rust commands.

## Development Conventions

- Use pnpm for frontend commands and Cargo for Rust commands. Do not hand-edit
  either lockfile.
- Keep loaders consolidated in `src/loaders/index.ts` unless a real separation is
  needed. Three.js add-ons use `three/addons/...` imports.
- Put cross-component application state in the Zustand store and keep transient,
  component-owned UI state local.
- Preserve both desktop and browser behavior when changing file, directory,
  settings, or export flows.
- Match the existing TypeScript style and CSS token system. Avoid unrelated
  refactors in focused changes.
- Add focused tests beside the affected source as `*.test.ts` or `*.test.tsx`.
  Browser workflows belong in `e2e/`.

## Verification

```bash
pnpm test
pnpm build
pnpm test:e2e
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --locked --all-targets -- -D warnings
cd src-tauri && cargo test --locked
```

Run the smallest relevant subset during development, then the applicable full
checks before handing off. Native packaging uses `.github/workflows/publish.yml`;
the browser deployment uses `.github/workflows/pages.yml`.
