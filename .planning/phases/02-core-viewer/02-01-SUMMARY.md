---
phase: 02-core-viewer
plan: "01"
subsystem: loader-core
tags: [vitest, three.js, zustand, loaders, tdd]
dependency_graph:
  requires: [01-foundation]
  provides: [loadModel, disposeModel, applyViewMode, countTriangles, triangleCount-store]
  affects: [Viewer3D, Sidebar, Toolbar]
tech_stack:
  added: [vitest@4.0.18, "@vitest/ui@4.0.18", jsdom@28.1.0]
  patterns: [TDD red-green, Zustand store testing via getState/setState, vi.mock for Tauri IPC]
key_files:
  created:
    - src/store/viewerStore.test.ts
    - src/loaders/index.test.ts
  modified:
    - vite.config.ts
    - package.json
    - src/store/viewerStore.ts
    - src/loaders/index.ts
decisions:
  - "countTriangles uses index.count/3 for indexed geometry, position.count/3 otherwise"
  - "applyViewMode points mode hides Mesh children and adds Points companions with userData.isPointsCompanion flag"
  - "loadModel dispatches on extension via switch statement for clarity over map-based dispatch"
  - "ColladaLoader null-check added for TypeScript strict compliance"
metrics:
  duration: "3 min"
  completed_date: "2026-03-11"
  tasks_completed: 3
  files_changed: 6
---

# Phase 2 Plan 1: Test Infrastructure + Core Loader Functions Summary

Vitest configured with jsdom, Zustand store enhanced with triangleCount, and all core loader functions implemented (loadModel, disposeModel, applyViewMode, countTriangles) with 33 passing unit tests.

## What Was Built

### Task 1: Vitest test infrastructure
- Installed vitest@4.0.18, @vitest/ui, jsdom as dev dependencies
- Added `test: { environment: 'jsdom', globals: true }` to vite.config.ts
- Added `"test": "vitest run"` script to package.json
- `pnpm vitest run --passWithNoTests` exits 0

### Task 2: Zustand store enhancement (TDD)
- Added `triangleCount: number | null` field to ViewerState interface (initial: null)
- Added `setTriangleCount: (count: number | null) => void` action
- Created `src/store/viewerStore.test.ts` with 8 tests covering all state transitions

### Task 3: Core loader functions (TDD)
- `loadModel(path, ext, scene, camera)` — reads bytes via `invoke('read_file_bytes')`, dispatches to correct Three.js loader per extension, calls fitModelToView, adds to scene
- `disposeModel(object, scene)` — removes from scene, traverses disposing geometry + materials + textures (handles array materials)
- `applyViewMode(root, mode)` — solid/wireframe set material.wireframe; points hides meshes, adds Points companions
- `countTriangles(object)` — sums triangles from indexed or non-indexed geometry across all mesh descendants
- Created `src/loaders/index.test.ts` with 25 unit tests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test import of unused fitModelToView**
- **Found during:** Task 3 TypeScript check
- **Issue:** fitModelToView imported in test file but never used (TS6133 error)
- **Fix:** Removed fitModelToView from import list in index.test.ts
- **Files modified:** src/loaders/index.test.ts
- **Commit:** cc9f355

**2. [Rule 1 - Bug] Fixed ColladaLoader possibly null result**
- **Found during:** Task 3 TypeScript check
- **Issue:** TypeScript error TS18047 — ColladaLoader.parse() return typed as possibly null
- **Fix:** Added `if (!result) throw new Error('ColladaLoader failed to parse file')` guard
- **Files modified:** src/loaders/index.ts
- **Commit:** cc9f355

**3. [Rule 1 - Bug] Fixed non-indexed triangle count test expectation**
- **Found during:** Task 3 GREEN phase
- **Issue:** Test expected 9 triangles from 9 vertices, but 9 vertices / 3 per triangle = 3 triangles
- **Fix:** Corrected test expectation from 9 to 3 with clarifying comment
- **Files modified:** src/loaders/index.test.ts
- **Commit:** cc9f355

## Test Results

```
Test Files  2 passed (2)
Tests       33 passed (33)
Duration    379ms
```

## Self-Check: PASSED

All required files found:
- src/loaders/index.ts - FOUND
- src/loaders/index.test.ts - FOUND
- src/store/viewerStore.ts - FOUND
- src/store/viewerStore.test.ts - FOUND
- vite.config.ts - FOUND

All commits verified:
- 12d9d57: chore(02-01): install vitest and configure test environment
- 556d155: feat(02-01): enhance Zustand store with triangleCount and add store tests
- cc9f355: feat(02-01): implement loadModel, disposeModel, applyViewMode, countTriangles
