# Code Review Remediation Plan

## Context
Senior code review identified memory leaks, race conditions, missing error handling, and edge cases across the codebase. All fixes are surgical — no refactors, no new abstractions. Each tier gets its own commit.

---

## Tier 1: Critical (memory leaks, crashes)

### 1.1 ViewCube texture/geometry disposal
**File:** `src/components/ViewCube.tsx`
**Problem:** `createFaceTexture()` creates 6 `CanvasTexture` objects that are never disposed. 6 `PlaneGeometry` and 6 `MeshBasicMaterial` also leak on unmount.
**Fix:** Store all disposables in refs and dispose them in the cleanup function:
```tsx
// Add refs to track disposables
const disposablesRef = useRef<{ textures: THREE.CanvasTexture[], geometries: THREE.PlaneGeometry[], materials: THREE.MeshBasicMaterial[] }>({ textures: [], geometries: [], materials: [] })

// In the setup loop, push each created object:
// disposablesRef.current.textures.push(texture)
// disposablesRef.current.geometries.push(geometry)
// disposablesRef.current.materials.push(material)

// In cleanup return:
// disposablesRef.current.textures.forEach(t => t.dispose())
// disposablesRef.current.geometries.forEach(g => g.dispose())
// disposablesRef.current.materials.forEach(m => m.dispose())
```

### 1.2 File size guard in Rust
**File:** `src-tauri/src/commands/file_ops.rs`
**Problem:** `read_file_bytes` does `std::fs::read(&path)` with no size check. A 2GB file crashes the app.
**Fix:** Check metadata before reading:
```rust
const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500MB

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({:.0} MB). Maximum supported size is 500 MB.",
            metadata.len() as f64 / (1024.0 * 1024.0)
        ));
    }
    std::fs::read(&path).map_err(|e| e.to_string())
}
```

### 1.3 Camera near/far clamping
**File:** `src/loaders/index.ts`
**Problem:** `fitModelToView` sets `camera.near = maxDim * 0.01` — tiny models get floating-point z-fighting, huge models get numeric instability.
**Fix:** Clamp in both `fitModelToView` and `fitAllModels`:
```ts
camera.near = Math.max(0.001, maxDim * 0.01)
camera.far = Math.min(maxDim * 100, 1e7)
```
Note: `fitAllModels` already has `Math.max(0.01, ...)` for near but no far clamp — add the far clamp there too.

### 1.4 Settings load error handling
**File:** `src/hooks/useSettings.ts`
**Problem:** If `loadSettings()` rejects, `initializedRef.current` never becomes `true`, so the debounced save never fires.
**Fix:** Move `initializedRef.current = true` into `.finally()`:
```ts
useEffect(() => {
    loadSettings()
      .then((data) => {
        if (data?.performance) {
          const store = useViewerStore.getState()
          store.setPerformancePreset(data.performance.preset)
          if (data.performance.overrides && Object.keys(data.performance.overrides).length > 0) {
            useViewerStore.setState({ performanceOverrides: data.performance.overrides })
          }
        }
      })
      .catch(() => {
        // Settings file doesn't exist yet or is corrupt — OK, use defaults
      })
      .finally(() => {
        initializedRef.current = true
      })
  }, [])
```

---

## Tier 2: High (race conditions, async issues)

### 2.1 Multi-model load cancellation
**File:** `src/components/Viewer3D.tsx` (Effect 5, ~line 331)
**Problem:** When `loadedModels` changes rapidly, `Promise.all()` resolves with stale data. No cancellation mechanism.
**Fix:** Use an `effectVersion` counter pattern. Increment on each effect run; ignore results if version has changed:
```ts
const effectVersionRef = useRef(0)

useEffect(() => {
    const version = ++effectVersionRef.current
    // ... existing add/remove logic ...

    Promise.all(addPromises).then(() => {
        if (effectVersionRef.current !== version) return  // stale — skip
        // ... fitAllModels, grid update ...
    })
}, [loadedModels])
```

### 2.2 Blocking file dialog → async
**File:** `src-tauri/src/commands/file_ops.rs`
**Problem:** `blocking_pick_file()` blocks the Tokio runtime thread.
**Fix:** Replace with async version:
```rust
let file_path = app
    .dialog()
    .file()
    .add_filter("3D Files", &[...])
    .pick_file()
    .await;
```
Note: The return type from async `pick_file()` may differ slightly — verify it returns `Option<FilePath>` same as blocking version.

---

## Tier 3: Medium (perf, robustness)

### 3.1 ResizeObserver debounce
**File:** `src/components/Viewer3D.tsx` (Effect 4, ~line 296)
**Problem:** `setSize()` called on every pixel during window drag.
**Fix:** Coalesce with `requestAnimationFrame`:
```ts
let resizeScheduled = false
const handleResize = () => {
    if (resizeScheduled) return
    resizeScheduled = true
    requestAnimationFrame(() => {
        resizeScheduled = false
        // actual resize logic here
        if (!mountRef.current || !rendererRef.current || !cameraRef.current) return
        const width = mountRef.current.clientWidth
        const height = mountRef.current.clientHeight
        if (width === 0 || height === 0) return
        rendererRef.current.setSize(width, height)
        // ... camera update ...
    })
}
```

### 3.2 Extension parsing safety
**Files:** `src/hooks/useFileOpen.ts` (line 37), `src/hooks/useDirOpen.ts` (line 31)
**Problem:** `filename.split('.').pop()!` — unsafe for files with no extension or multiple dots.
**Fix:** Use `lastIndexOf`:
```ts
// useFileOpen.ts
const lastDot = filename.lastIndexOf('.')
const ext = lastDot > 0 ? filename.substring(lastDot).toLowerCase() : ''

// useDirOpen.ts — same pattern for e.name
const lastDot = e.name.lastIndexOf('.')
const ext = lastDot > 0 ? e.name.substring(lastDot).toLowerCase() : ''
if (ext && SUPPORTED_EXTENSIONS.includes(ext)) { ... }
```

### 3.3 countTriangles null safety
**File:** `src/loaders/index.ts` (line 263)
**Problem:** `geo.attributes.position` could theoretically be undefined on malformed models.
**Fix:** Add optional chaining:
```ts
} else if (geo.attributes.position?.count) {
    count += geo.attributes.position.count / 3
}
```

---

## Out of Scope (intentionally deferred)
- **Vec<u8> IPC serialization redesign** — architecture change, file size guard mitigates the crash case
- **Directory lazy loading / virtualization** — separate feature work
- **Sidebar width persistence** — nice-to-have, not a bug
- **Symlink loop protection** — Tauri readDir doesn't follow symlinks recursively
- **TreeNode re-render optimization** — perf polish, not a bug

## Commit Strategy
- Commit 1: `fix: critical memory leaks, file size guard, camera clamping, settings error handling` (Tier 1)
- Commit 2: `fix: multi-model load race condition and async file dialog` (Tier 2)
- Commit 3: `fix: resize debounce, extension parsing safety, triangle count null check` (Tier 3)
