# 3D File Previewer — Claude Code Project Plan

## Project: `forge-view`
A cross-platform 3D CAD file previewer built with **Tauri v2 + React + Three.js**

---

## Architecture Overview

```
forge-view/
├── src-tauri/               # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   ├── lib.rs           # Tauri app setup
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── file_ops.rs  # File open/read commands
│   │       └── parser.rs    # Native file parsing helpers
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                     # React + Three.js frontend
│   ├── main.tsx             # React entry
│   ├── App.tsx              # Root component
│   ├── components/
│   │   ├── Viewer3D.tsx     # Three.js canvas component
│   │   ├── Sidebar.tsx      # File info + controls panel
│   │   ├── Toolbar.tsx      # Top toolbar (open, view modes)
│   │   └── DropZone.tsx     # Drag-and-drop file area
│   ├── loaders/
│   │   ├── index.ts         # Loader registry (maps ext → loader)
│   │   ├── stlLoader.ts     # STL loader wrapper
│   │   ├── threemfLoader.ts # 3MF loader wrapper
│   │   ├── objLoader.ts     # OBJ/MTL loader wrapper
│   │   ├── gltfLoader.ts    # GLTF/GLB loader wrapper
│   │   └── plyLoader.ts     # PLY loader wrapper
│   ├── hooks/
│   │   ├── useViewer.ts     # Three.js scene state
│   │   └── useFileOpen.ts   # Tauri file dialog hook
│   ├── store/
│   │   └── viewerStore.ts   # Zustand global state
│   └── styles/
│       └── index.css
├── package.json
├── vite.config.ts
├── tsconfig.json
└── CLAUDE.md                # This file
```

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Desktop shell | Tauri | **2.10.3** | Native window, file dialogs, OS integration |
| Frontend framework | React + TypeScript | **19.2.4** | UI components |
| 3D rendering | Three.js | **0.162.0** (r162) | WebGL engine; last release with automatic WebGL1 fallback (r163+ requires WebGL2) |
| State management | Zustand | **5.0.11** | Lightweight global state |
| Build tool | Vite | **7.3.1** | Fast dev server + bundler |
| Styling | Tailwind CSS | **4.2.1** | Utility-first CSS |
| Scaffolding | create-tauri-app | **latest** | Project bootstrapper |

---

## Supported File Formats

| Format | Extension | Loader |
|---|---|---|
| STL (ASCII + Binary) | `.stl` | Three.js STLLoader |
| 3D Manufacturing Format | `.3mf` | Three.js ThreeMFLoader |
| Wavefront OBJ | `.obj` | Three.js OBJLoader + MTLLoader |
| GL Transmission Format | `.gltf`, `.glb` | Three.js GLTFLoader |
| Stanford PLY | `.ply` | Three.js PLYLoader |
| Collada | `.dae` | Three.js ColladaLoader |

---

## Phase 1 — Project Bootstrapping

### Steps for Claude Code:

```bash
# 1. Install prerequisites (if not present)
cargo install tauri-cli  # installs Tauri CLI 2.x
npm install -g pnpm

# 2. Create Tauri + React project
pnpm create tauri-app@latest forge-view \
  --template react-ts \
  --manager pnpm

cd forge-view

# 3. Install frontend dependencies (pinned to verified latest versions)
pnpm add three@0.162.0
pnpm add zustand@5.0.11
pnpm add -D @types/three@0.162.0

# 4. Install Tailwind CSS v4 (new CSS-first approach — no tailwind.config.js needed)
pnpm add -D tailwindcss@4.2.1 @tailwindcss/vite@4.2.1

# 5. Install Tauri plugins for file system and dialog
pnpm add @tauri-apps/plugin-dialog@2
pnpm add @tauri-apps/plugin-fs@2
```

---

## Phase 2 — Rust Backend (src-tauri)

### `Cargo.toml` dependencies to add:
```toml
[dependencies]
tauri = { version = "2.10", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

### Key Tauri commands to implement in `src/commands/file_ops.rs`:

```rust
// Command 1: Open native file picker dialog
#[tauri::command]
async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String>

// Command 2: Read raw file bytes (for large files)
#[tauri::command]
async fn read_file_bytes(path: String) -> Result<Vec<u8>, String>

// Command 3: Get file metadata (size, format, modified date)  
#[tauri::command]
async fn get_file_metadata(path: String) -> Result<FileMetadata, String>

// Command 4: Get recent files list
#[tauri::command]
async fn get_recent_files() -> Result<Vec<String>, String>
```

### `FileMetadata` struct:
```rust
#[derive(serde::Serialize)]
pub struct FileMetadata {
    pub path: String,
    pub filename: String,
    pub extension: String,
    pub size_bytes: u64,
    pub modified: String,
}
```

---

## Phase 3 — Three.js Viewer Component

### `src/components/Viewer3D.tsx` — Core implementation:

```tsx
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { getLoaderForExtension } from '../loaders'

interface Viewer3DProps {
  filePath: string | null
  fileExtension: string | null
  viewMode: 'solid' | 'wireframe' | 'points'
}

export function Viewer3D({ filePath, fileExtension, viewMode }: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene>()
  const rendererRef = useRef<THREE.WebGLRenderer>()
  const cameraRef = useRef<THREE.PerspectiveCamera>()
  const controlsRef = useRef<OrbitControls>()

  // Scene setup
  useEffect(() => {
    if (!mountRef.current) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)

    const camera = new THREE.PerspectiveCamera(
      75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 10000
    )
    camera.position.set(0, 0, 100)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    renderer.shadowMap.enabled = true
    mountRef.current.appendChild(renderer.domElement)

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1)
    dirLight.position.set(5, 10, 5)
    scene.add(dirLight)

    // Grid helper
    scene.add(new THREE.GridHelper(200, 20, 0x444466, 0x333355))

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    sceneRef.current = scene
    rendererRef.current = renderer
    cameraRef.current = camera
    controlsRef.current = controls

    // Animation loop
    let animId: number
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      renderer.dispose()
      mountRef.current?.removeChild(renderer.domElement)
    }
  }, [])

  // Load model when filePath changes
  useEffect(() => {
    if (!filePath || !fileExtension || !sceneRef.current) return
    loadModel(filePath, fileExtension, sceneRef.current, cameraRef.current!)
  }, [filePath, fileExtension])

  return <div ref={mountRef} className="w-full h-full" />
}
```

---

## Phase 4 — Loader Registry

### `src/loaders/index.ts`:

```typescript
// ⚠️ Three.js r152+: use 'three/addons/' NOT 'three/examples/jsm/'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import * as THREE from 'three'

export const SUPPORTED_EXTENSIONS = ['.stl', '.3mf', '.obj', '.gltf', '.glb', '.ply', '.dae']

export function getLoaderForExtension(ext: string) {
  const map: Record<string, any> = {
    '.stl': STLLoader,
    '.3mf': ThreeMFLoader,
    '.obj': OBJLoader,
    '.gltf': GLTFLoader,
    '.glb': GLTFLoader,
    '.ply': PLYLoader,
    '.dae': ColladaLoader,
  }
  const LoaderClass = map[ext.toLowerCase()]
  return LoaderClass ? new LoaderClass() : null
}

// Auto-center and scale model to fit view
export function fitModelToView(object: THREE.Object3D, camera: THREE.PerspectiveCamera) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  object.position.sub(center)
  camera.position.set(0, maxDim * 0.5, maxDim * 2)
  camera.near = maxDim * 0.01
  camera.far = maxDim * 100
  camera.updateProjectionMatrix()
}
```

---

## Phase 5 — Global State (Zustand)

### `src/store/viewerStore.ts`:

```typescript
import { create } from 'zustand'

type ViewMode = 'solid' | 'wireframe' | 'points'

interface ViewerState {
  filePath: string | null
  fileName: string | null
  fileExtension: string | null
  fileSize: number | null
  viewMode: ViewMode
  isLoading: boolean
  error: string | null
  recentFiles: string[]

  setFile: (path: string, name: string, ext: string, size: number) => void
  setViewMode: (mode: ViewMode) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  addRecentFile: (path: string) => void
}

export const useViewerStore = create<ViewerState>((set) => ({
  filePath: null,
  fileName: null,
  fileExtension: null,
  fileSize: null,
  viewMode: 'solid',
  isLoading: false,
  error: null,
  recentFiles: [],

  setFile: (path, name, ext, size) =>
    set({ filePath: path, fileName: name, fileExtension: ext, fileSize: size, error: null }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  addRecentFile: (path) =>
    set((state) => ({
      recentFiles: [path, ...state.recentFiles.filter((f) => f !== path)].slice(0, 10),
    })),
}))
```

---

## Phase 6 — App Layout (`src/App.tsx`)

```tsx
import { Toolbar } from './components/Toolbar'
import { Viewer3D } from './components/Viewer3D'
import { Sidebar } from './components/Sidebar'
import { DropZone } from './components/DropZone'
import { useViewerStore } from './store/viewerStore'

export default function App() {
  const { filePath, fileExtension, viewMode } = useViewerStore()

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          {filePath ? (
            <Viewer3D filePath={filePath} fileExtension={fileExtension} viewMode={viewMode} />
          ) : (
            <DropZone />
          )}
        </div>
        <Sidebar />
      </div>
    </div>
  )
}
```

---

## Phase 7 — Build & Package

### Development:
```bash
pnpm tauri dev
```

### Production builds:
```bash
# Linux (.deb, .AppImage)
pnpm tauri build

# Windows (.msi, .exe) — run on Windows or use cross-compilation
pnpm tauri build --target x86_64-pc-windows-msvc

# macOS (.dmg, .app) — must run on macOS
pnpm tauri build --target universal-apple-darwin
```

### CI/CD with GitHub Actions:
- Use `tauri-apps/tauri-action` for automated builds on all 3 platforms
- Matrix strategy: `ubuntu-latest`, `windows-latest`, `macos-latest`

---

## UI Features Checklist for Claude Code

### Must Have (Phase 1-3):
- [ ] Drag-and-drop file loading
- [ ] Native file open dialog (Tauri)
- [ ] Orbit/pan/zoom controls (mouse + touch)
- [ ] Auto-center and fit model to view
- [ ] Solid / Wireframe / Points view modes
- [ ] File info panel (name, size, format, triangle count)
- [ ] Dark theme UI

### Nice to Have (Phase 4+):
- [ ] Measurement tool (distance between points)
- [ ] Cross-section / clipping plane
- [ ] Screenshot export (PNG)
- [ ] Model color/material picker
- [ ] Multi-file loading (assembly view)
- [ ] Recent files list
- [ ] Exploded view animation
- [ ] Print bed size overlay (for 3D printing use)

---

## Known Gotchas for Claude Code

1. **Tauri file URLs**: Use `convertFileSrc()` from `@tauri-apps/api/core` (v2 API — NOT `@tauri-apps/api/tauri` which was v1).

2. **Tauri v2 permissions**: Permissions go in `src-tauri/capabilities/default.json` — NOT in `tauri.conf.json`. Missing this is the #1 cause of blank screens. Use the capability file shown above.

3. **Tauri v2 plugin registration**: Plugins must be registered in `lib.rs`:
   ```rust
   tauri::Builder::default()
     .plugin(tauri_plugin_dialog::init())
     .plugin(tauri_plugin_fs::init())
   ```

4. **Three.js r152+ import paths**: Use `three/addons/` NOT `three/examples/jsm/`. All imports in this doc use the correct path already.

5. **Tailwind v4 is CSS-first**: No `tailwind.config.js`, no `@tailwind` directives. Just `@import "tailwindcss"` in CSS + `@tailwindcss/vite` plugin. Using v3 syntax produces no output.

6. **Large STL files**: Binary STL can be 100MB+. Read as `ArrayBuffer` on frontend rather than base64.

7. **3MF format**: ThreeMFLoader requires a `.zip`-like internal structure. Test with PrusaSlicer exports.

8. **GLTF external assets**: `.gltf` may reference external `.bin`/texture files — use GLB (self-contained binary) when possible.

9. **React 19**: `ReactDOM.render` is removed — use `createRoot` from `react-dom/client`. Tauri templates likely already handle this.

### Tailwind CSS v4 Setup (CSS-first — no `tailwind.config.js`):

In `vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

In `src/styles/index.css`:
```css
@import "tailwindcss";
```

That's it — no `tailwind.config.js`, no `postcss.config.js`, no `autoprefixer` needed in v4.

---

## `tauri.conf.json` Key Settings

```json
{
  "app": {
    "windows": [{
      "title": "Forge View",
      "width": 1280,
      "height": 800,
      "minWidth": 800,
      "minHeight": 600,
      "decorations": true
    }],
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost; font-src 'self'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
```

The identifier (`com.forgeview.app`) and build hooks live at the top level of
the real `src-tauri/tauri.conf.json`. Fs sandboxing is defined by the
capability file below, not a `plugins.fs.scope` block.

### Tauri v2 Capability file (`src-tauri/capabilities/default.json`):
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "fs:allow-read-file",
    "fs:allow-read-dir",
    "fs:allow-stat",
    "fs:scope-home-recursive",
    "fs:scope-desktop-recursive",
    "fs:scope-download-recursive",
    "fs:scope-document-recursive",
    "fs:allow-write-file",
    "fs:allow-mkdir",
    "fs:scope-appconfig-recursive"
  ]
}
```

The write/mkdir/appconfig permissions back settings persistence
(`src/hooks/useSettings.ts`). The custom Rust commands (`read_file_bytes`,
`get_file_metadata`) additionally validate paths against the runtime fs scope
plus the user's home directory in `src-tauri/src/commands/file_ops.rs`.

---

## Getting Started Commands for Claude Code

Paste this into Claude Code to begin:

```
Build a cross-platform 3D file previewer app called "forge-view" using Tauri 2.10 + React 19 + TypeScript + Three.js 0.162.

Follow the architecture in CLAUDE.md exactly. Use these exact versions:
- tauri: 2.10.3, tauri-plugin-dialog: 2, tauri-plugin-fs: 2
- react + react-dom: 19.2.4
- three: 0.162.0, @types/three: 0.162.0 (pinned: last WebGL1-fallback release)
- zustand: 5.0.11
- vite: 7.3.1
- tailwindcss: 4.2.1 + @tailwindcss/vite: 4.2.1

CRITICAL import paths:
- Three.js loaders: 'three/addons/loaders/STLLoader.js' (NOT three/examples/jsm)
- Three.js controls: 'three/addons/controls/OrbitControls.js'
- Tauri API: '@tauri-apps/api/core' for convertFileSrc (NOT @tauri-apps/api/tauri)
- Tailwind: @import "tailwindcss" in CSS only, no tailwind.config.js

Steps:
1. Bootstrap with: pnpm create tauri-app@latest forge-view --template react-ts --manager pnpm
2. Install all dependencies at the pinned versions above
3. Set up Tailwind v4 via @tailwindcss/vite plugin in vite.config.ts
4. Implement Rust commands (open dialog, read file, get metadata) using tauri-plugin-dialog and tauri-plugin-fs
5. Register both plugins in src-tauri/src/lib.rs
6. Create src-tauri/capabilities/default.json with correct v2 permissions (core:default, dialog:allow-open, fs:allow-read-file, fs:scope-*-recursive)
7. Implement Three.js Viewer3D component with OrbitControls using three/addons/ paths
8. Implement the loader registry for STL, 3MF, OBJ, GLTF, PLY using three/addons/ paths
9. Implement the Zustand 5 store and App layout
10. Implement the DropZone component for drag-and-drop
11. Wire up the Tauri file dialog using convertFileSrc from @tauri-apps/api/core

Use a dark theme (#1a1a2e background).
```
