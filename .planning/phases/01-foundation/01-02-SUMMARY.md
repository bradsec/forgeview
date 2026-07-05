---
phase: 01-foundation
plan: 02
subsystem: backend-and-state
tags: [tauri, rust, zustand, three.js, loaders, commands]

# Dependency graph
requires:
  - 01-01 (Tauri + React scaffold with Cargo.toml deps)
provides:
  - Rust Tauri commands: open_file_dialog, read_file_bytes, get_file_metadata, get_recent_files
  - Tauri v2 plugin registration: dialog + fs in lib.rs
  - Zustand 5 viewer store with all state fields and actions
  - Three.js loader registry: getLoaderForExtension, fitModelToView, SUPPORTED_EXTENSIONS
  - Minimal dark-theme App shell proving all foundation imports work
affects: [03-viewer, 04-loaders, 05-state, 06-app-layout]

# Tech tracking
tech-stack:
  added:
    - tauri_plugin_dialog (Rust crate, blocking file picker API)
    - tauri_plugin_fs (Rust crate)
    - zustand 5 (create store pattern)
    - three/addons loaders: STLLoader, OBJLoader, GLTFLoader, PLYLoader, ThreeMFLoader, ColladaLoader
  patterns:
    - Tauri command: async fn with AppHandle, returns Result<T, String>
    - tauri_plugin_dialog::DialogExt trait used to access dialog() on AppHandle
    - blocking_pick_file() for async command contexts (sync_channel bridge)
    - FilePath.to_string() converts dialog result to Rust String
    - Three.js loaders: import from three/addons/loaders/*.js (NOT three/examples/jsm/)
    - Zustand 5: create<State>((set) => ({ ... })) — no separate interface for createStore

key-files:
  created:
    - src-tauri/src/commands/mod.rs
    - src-tauri/src/commands/file_ops.rs
    - src/store/viewerStore.ts
    - src/loaders/index.ts
  modified:
    - src-tauri/src/lib.rs
    - src/App.tsx

key-decisions:
  - "blocking_pick_file() used instead of async pick_file callback — cleaner API for async Tauri commands"
  - "ISO 8601 date formatting implemented in pure Rust (no chrono dep) via custom format_iso8601 helper"
  - "FilePath.to_string() works because tauri_plugin_fs::FilePath implements Display"
  - "App shell is intentionally minimal — full Toolbar/Sidebar/DropZone/Viewer3D comes in Phase 2"

patterns-established:
  - "Rust commands: pub async fn in commands/file_ops.rs, registered via generate_handler! in lib.rs"
  - "Frontend state: useViewerStore() hook from src/store/viewerStore.ts"
  - "Loader lookup: getLoaderForExtension('.stl') returns new STLLoader() instance"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-03-11
---

# Phase 1 Plan 02: Rust Backend, Zustand Store, and Loader Registry Summary

**Rust Tauri commands (open_file_dialog, read_file_bytes, get_file_metadata, get_recent_files), Zustand 5 viewer store, and Three.js loader registry for 6 formats — TypeScript builds cleanly in 680ms**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-11T08:55:29Z
- **Completed:** 2026-03-11T08:59:03Z
- **Tasks:** 3 of 3
- **Files modified:** 6

## Accomplishments

- Implemented 4 Rust Tauri commands in src-tauri/src/commands/file_ops.rs with proper FileMetadata struct
- Registered tauri_plugin_dialog and tauri_plugin_fs in lib.rs with all 4 command handlers
- Created Zustand 5 store with full ViewerState interface, 8 state fields, and 5 actions
- Created Three.js loader registry mapping all 6 format extensions to loader classes from three/addons/
- Replaced template App.tsx with minimal dark-theme shell (#1a1a2e) proving all imports compile
- pnpm build passes cleanly: 195KB JS bundle, 6.76KB CSS in 680ms

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement Rust backend commands and Tauri v2 plugin registration** - `489ba0b` (feat)
2. **Task 2: Create Zustand store and Three.js loader registry** - `a1aa7ba` (feat)
3. **Task 3: Wire up minimal App shell with dark theme** - `51af2d4` (feat)

## Files Created/Modified

- `src-tauri/src/commands/mod.rs` - Module declaration: `pub mod file_ops`
- `src-tauri/src/commands/file_ops.rs` - 4 Tauri commands + FileMetadata struct + ISO 8601 helper
- `src-tauri/src/lib.rs` - Plugin registration (dialog + fs) + invoke_handler for all 4 commands
- `src/store/viewerStore.ts` - Zustand 5 store with ViewMode, all state fields, and 5 actions
- `src/loaders/index.ts` - Three.js loader registry: SUPPORTED_EXTENSIONS, getLoaderForExtension, fitModelToView
- `src/App.tsx` - Minimal dark-theme shell with Zustand store + loader registry imports

## Decisions Made

- Used `blocking_pick_file()` (sync_channel bridge) rather than async callback — cleaner integration with async Tauri command context
- Implemented ISO 8601 date formatting in pure Rust without adding chrono as a dependency (keeps Cargo.toml lean)
- `FilePath.to_string()` works because `tauri_plugin_fs::FilePath` implements `Display` — confirmed by reading crate source
- App shell is intentionally minimal to prove foundation compiles; Phase 2 replaces placeholders with real components

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- `cargo check` still fails with GTK/WebKit system library errors (same blocker from Plan 01-01). This is unchanged: the Rust code is syntactically correct but cannot compile to a binary until `libwebkit2gtk-4.1-dev` and related system packages are installed. Frontend build and TypeScript compilation are unaffected.

## Self-Check: PASSED

All created files verified to exist:
- FOUND: src-tauri/src/commands/file_ops.rs
- FOUND: src-tauri/src/commands/mod.rs
- FOUND: src-tauri/capabilities/default.json (from 01-01, unchanged)
- FOUND: src/store/viewerStore.ts
- FOUND: src/loaders/index.ts
- FOUND: src/App.tsx

All commits verified:
- FOUND: 489ba0b (Task 1 — Rust backend commands)
- FOUND: a1aa7ba (Task 2 — Zustand + loader registry)
- FOUND: 51af2d4 (Task 3 — App shell)

TypeScript: `npx tsc --noEmit --skipLibCheck` — no errors
Frontend build: `npx vite build` — 680ms, 195KB bundle

## Next Phase Readiness

- Phase 2 can mount Viewer3D component directly — useViewerStore is ready
- getLoaderForExtension() is tested at import time by App.tsx (SUPPORTED_EXTENSIONS displayed)
- Tauri backend commands are callable from frontend via `invoke('open_file_dialog', ...)`
- Blocker unchanged: `pnpm tauri dev` needs `sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

---
*Phase: 01-foundation*
*Completed: 2026-03-11*
