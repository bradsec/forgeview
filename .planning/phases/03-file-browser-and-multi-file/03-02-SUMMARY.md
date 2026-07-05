---
phase: 03-file-browser-and-multi-file
plan: 02
subsystem: directory-browser
tags: [directory, file-browser, hooks, components, tdd, zustand]
dependency_graph:
  requires: [03-01]
  provides: [directory-browsing, dir-file-listing, click-to-preview, active-highlight]
  affects: [src/components/Toolbar.tsx, src/components/Sidebar.tsx]
tech_stack:
  added: ["@testing-library/react@16.3.2", "@testing-library/user-event@14.6.1"]
  patterns: [TDD, Zustand-imperative-getState, parallel-Promise.all-for-stat]
key_files:
  created:
    - src/hooks/useDirOpen.ts
    - src/hooks/useDirOpen.test.ts
    - src/components/DirectoryPanel.tsx
    - src/components/DirectoryPanel.test.tsx
  modified:
    - src/components/Toolbar.tsx
    - src/components/Sidebar.tsx
decisions:
  - useDirOpen uses Promise.all to parallelize join+stat calls for all directory entries (performance)
  - DirectoryPanel reads store directly (no props) — consistent with existing hook pattern
  - Sidebar wraps file info section in inner div to allow DirectoryPanel to sit above it with separator
  - Open Folder button uses gray styling (bg-gray-700) to visually distinguish from primary blue Open button
metrics:
  duration: 3 min
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_changed: 6
---

# Phase 03 Plan 02: Directory Browser Summary

**One-liner:** Native folder picker with filtered file listing, click-to-preview, and active file highlight using useDirOpen hook and DirectoryPanel component.

## Objective

Implement directory browsing so users can select a folder and quickly preview any supported 3D file from the resulting list without reopening the file dialog each time.

## What Was Built

### useDirOpen hook (`src/hooks/useDirOpen.ts`)
- Calls `open({ directory: true })` from `@tauri-apps/plugin-dialog` for native folder picker
- On cancel (null return), exits early without touching the store
- Reads directory with `readDir()` from `@tauri-apps/plugin-fs`
- Filters entries to `isFile === true` AND extension in `SUPPORTED_EXTENSIONS`
- Uses `Promise.all` to parallelize `join()` + `stat()` calls for all matching files
- Builds `DirFileEntry[]` and calls `useViewerStore.getState().setDir()`
- Wraps in try/catch, calls `setError` on failure

### DirectoryPanel component (`src/components/DirectoryPanel.tsx`)
- Returns null when `dirPath` is null (no folder selected)
- Shows directory path as truncated breadcrumb label
- Shows "No supported files found" when dir is selected but no supported files
- Renders scrollable `ul` of files with:
  - Format badge (extension uppercase, no dot, monospaced)
  - File name (truncated, title for full name)
  - File size (formatted via `formatBytes`)
- Click handler calls `setFile` + `setActiveFile` imperatively via `getState()`
- Active file highlighted with `bg-blue-700 text-white`; others have `hover:bg-gray-700`

### Toolbar updates (`src/components/Toolbar.tsx`)
- Added "Open Folder" button (gray styling) next to the existing "Open" button
- Wired to `openDir` from `useDirOpen` hook

### Sidebar updates (`src/components/Sidebar.tsx`)
- DirectoryPanel rendered at top of sidebar (handles null internally)
- Thin `border-t border-gray-700` separator shown only when a directory is active
- Existing file info section preserved inside an inner scrollable div

## Tests

| File | Tests | Coverage |
|------|-------|---------|
| useDirOpen.test.ts | 3 tests | Cancelled dialog, file filtering + setDir, readDir error |
| DirectoryPanel.test.tsx | 5 tests | Null dirPath, empty dir, file rendering, click handlers, active highlight |

All 51 tests pass (4 test files including pre-existing store and loaders tests).

## Requirements Addressed

- DIR-01: useDirOpen reads directory and calls setDir with DirFileEntry[] of supported files
- DIR-02: DirectoryPanel click calls setFile + setActiveFile to load file in viewport
- DIR-03: Active file highlighted with bg-blue-700 class
- DIR-04: Each file entry shows name, format badge, and formatted file size

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED
