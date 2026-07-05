# Forge View

## What This Is

A cross-platform desktop 3D file previewer built with Tauri v2, React 19, and Three.js r183. Users can open CAD/3D files (STL, 3MF, OBJ, GLTF/GLB, PLY, DAE), browse directories of 3D files, load multiple models into a scene, and interact with them in an interactive 3D viewport with orbit/pan/zoom controls. Designed as a lightweight, fast alternative to full CAD software when you just need to see what's in a file.

## Core Value

Open any supported 3D file and immediately see it rendered in an interactive 3D viewport — fast, cross-platform, zero friction.

## Requirements

### Validated

- ✓ Drag-and-drop file loading — v1.0
- ✓ Native file open dialog via Tauri — v1.0
- ✓ Interactive orbit/pan/zoom controls — v1.0
- ✓ Auto-center and fit model to view on load — v1.0
- ✓ Solid / Wireframe / Points view modes — v1.0
- ✓ File info panel (name, size, format, triangle count) — v1.0
- ✓ Dark theme UI (#1a1a2e background) — v1.0
- ✓ Support STL (ASCII + Binary) — v1.0
- ✓ Support 3MF — v1.0
- ✓ Support OBJ (with MTL) — v1.0
- ✓ Support GLTF/GLB — v1.0
- ✓ Support PLY — v1.0
- ✓ Support Collada DAE — v1.0
- ✓ Cross-platform builds (Linux, Windows, macOS) — v1.0
- ✓ Directory browsing sidebar — v1.0
- ✓ Click-to-preview from directory list — v1.0
- ✓ Multi-model scene management — v1.0

### Active

(None — next milestone requirements TBD)

### Out of Scope

- Measurement tools — complexity not justified for v1
- Cross-section / clipping planes — defer to v2
- Screenshot export — defer to v2
- Material/color picker — defer to v2
- Exploded view animation — defer to v2
- Print bed size overlay — defer to v2
- STEP/IGES native CAD formats — requires B-rep kernel (OpenCascade); 10x scope increase
- File format conversion — requires exporters with fidelity guarantees
- Real-time collaboration — transforms local tool into cloud product
- Model editing — changes product category from viewer to editor

## Context

Shipped v1.0 MVP with 4,003 LOC (TypeScript + Rust + CSS).
Tech stack: Tauri 2.10.3, React 19.2.4, Three.js 0.183.2, Zustand 5.0.11, Vite 7.3.1, Tailwind 4.2.1.
52 unit tests passing across store, loaders, hooks, and components.
GitHub Actions CI produces .deb, .AppImage, .msi, .exe, .dmg artifacts.

## Constraints

- **Tech stack**: Tauri 2.10.3 + React 19.2.4 + Three.js 0.183.2 + Zustand 5.0.11 + Vite 7.3.1 + Tailwind 4.2.1 — pinned versions, no substitutions
- **Package manager**: pnpm only
- **Import paths**: `three/addons/` for loaders/controls, `@tauri-apps/api/core` for Tauri API
- **Styling**: Tailwind v4 CSS-first approach only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tauri v2 over Electron | Smaller binary, lower memory, native performance | ✓ Good — fast builds, small installers |
| Three.js for rendering | Mature WebGL library with built-in loaders for all target formats | ✓ Good — all 6 formats loaded without custom parsers |
| Zustand over Redux/Context | Lightweight, minimal boilerplate, fits small app scope | ✓ Good — clean store with multi-model extension |
| Frontend-only file parsing | Three.js loaders handle all formats; no need for Rust-side parsing | ✓ Good — simplified architecture, convertFileSrc handles file access |
| modelMapRef for Three.js objects | Three.js objects must never enter Zustand store (non-serializable) | ✓ Good — clean separation of 3D state from UI state |
| ubuntu-22.04 pinned in CI | Guarantees libwebkit2gtk-4.1-dev availability | ✓ Good — avoids CI breakage from ubuntu-latest upgrades |

---
*Last updated: 2026-03-12 after v1.0 milestone*
