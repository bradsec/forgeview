# Preview Grid MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse a folder of 3D files as a lazy thumbnail grid; click a thumbnail to load it in the existing 3D viewer.

**Architecture:** A singleton service owns one hidden WebGL renderer and a concurrency-1 queue that renders each model to a PNG data URL, caching results in memory by path+mtime+size. A `PreviewGrid` lists files (current folder or recursive) and renders `GridTile`s that request their thumbnail when scrolled into view. New store fields (`mainView`, `gridScope`, `gridFolder`) drive whether the main area shows the grid or the 3D viewer.

**Tech Stack:** React 19, TypeScript, Zustand 5, Three.js 0.183, Tauri 2 plugin-fs, Vitest + Testing Library.

---

## File structure

New:
- `src/services/gridFiles.ts` - resolve a folder to `{ folders, files }`, current or recursive. Test: `src/services/gridFiles.test.ts`.
- `src/services/thumbnailService.ts` - `cacheKey`, `createThumbnailQueue` (testable), and the wired singleton with the real WebGL render. Test: `src/services/thumbnailService.test.ts`.
- `src/components/PreviewGrid.tsx` - grid container, scope toggle, list resolution.
- `src/components/GridTile.tsx` - one tile: visibility-triggered request, skeleton/ready/error states, click + add. Test: `src/components/GridTile.test.tsx`.

Modified:
- `src/store/viewerStore.ts` - add `mainView`, `gridScope`, `gridFolder`, setters; `setFile` also sets `mainView:'3d'`. Test: `src/store/viewerStore.test.ts`.
- `src/hooks/useDirOpen.ts` - `openDir` sets `gridFolder` and `mainView:'grid'`.
- `src/App.tsx` - render `PreviewGrid` when a folder is loaded and `mainView==='grid'`.
- `src/components/Toolbar.tsx` - `[Grid | 3D]` toggle, shown when a folder is loaded.

---

## Task 1: Store fields for grid/view state

**Files:**
- Modify: `src/store/viewerStore.ts`
- Test: `src/store/viewerStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/store/viewerStore.test.ts` (inside the top-level `describe`, after the existing tests):

```ts
describe('grid/view state', () => {
  beforeEach(() => {
    useViewerStore.setState({
      filePath: null, fileName: null, fileExtension: null, fileSize: null,
      mainView: 'grid', gridScope: 'current', gridFolder: null,
    })
  })

  it('defaults: mainView grid, scope current, folder null', () => {
    const s = useViewerStore.getState()
    expect(s.mainView).toBe('grid')
    expect(s.gridScope).toBe('current')
    expect(s.gridFolder).toBeNull()
  })

  it('setMainView / setGridScope / setGridFolder update state', () => {
    const s = useViewerStore.getState()
    s.setMainView('3d')
    s.setGridScope('recursive')
    s.setGridFolder('/models')
    const n = useViewerStore.getState()
    expect(n.mainView).toBe('3d')
    expect(n.gridScope).toBe('recursive')
    expect(n.gridFolder).toBe('/models')
  })

  it('setFile switches mainView to 3d', () => {
    useViewerStore.setState({ mainView: 'grid' })
    useViewerStore.getState().setFile('/m/a.stl', 'a.stl', '.stl', 10)
    expect(useViewerStore.getState().mainView).toBe('3d')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/store/viewerStore.test.ts`
Expected: FAIL (`mainView` undefined / `setMainView is not a function`).

- [ ] **Step 3: Implement**

In `src/store/viewerStore.ts`, add to the `ViewerState` interface (near `projectionMode`):

```ts
  mainView: 'grid' | '3d'
  gridScope: 'current' | 'recursive'
  gridFolder: string | null
  setMainView: (v: 'grid' | '3d') => void
  setGridScope: (s: 'current' | 'recursive') => void
  setGridFolder: (path: string | null) => void
```

Add to the store initial state (near `projectionMode: 'perspective' as const,`):

```ts
  mainView: 'grid',
  gridScope: 'current',
  gridFolder: null,
```

Add the setters (near `setProjectionMode`):

```ts
  setMainView: (v) => set({ mainView: v }),
  setGridScope: (s) => set({ gridScope: s }),
  setGridFolder: (path) => set({ gridFolder: path }),
```

Change `setFile` to also flip the view:

```ts
  setFile: (path, name, ext, size) =>
    set({ filePath: path, fileName: name, fileExtension: ext, fileSize: size, error: null, mainView: '3d' }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/store/viewerStore.test.ts`
Expected: PASS (all store tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/viewerStore.ts src/store/viewerStore.test.ts
git commit -m "feat: add grid/view store state (mainView, gridScope, gridFolder)"
```

---

## Task 2: Grid file listing (current + recursive)

**Files:**
- Create: `src/services/gridFiles.ts`
- Test: `src/services/gridFiles.test.ts`

`stat` from plugin-fs returns `{ size: number, mtime: Date | null, ... }`. `readDir` returns entries `{ name, isDirectory, isFile }`. `join` builds paths.

- [ ] **Step 1: Write the failing test**

Create `src/services/gridFiles.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
  stat: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { readDir, stat } from '@tauri-apps/plugin-fs'
import { listGridFiles } from './gridFiles'

const dirEntry = (name: string, isDirectory: boolean) => ({
  name, isDirectory, isFile: !isDirectory,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(stat).mockResolvedValue({ size: 1024, mtime: new Date(1000) } as any)
})

describe('listGridFiles (current)', () => {
  it('returns supported files and folders for one level, folders unfiltered', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([
      dirEntry('parts', true),
      dirEntry('cube.stl', false),
      dirEntry('notes.txt', false),
      dirEntry('gear.obj', false),
    ] as any)

    const out = await listGridFiles('/models', false)
    expect(out.folders.map((f) => f.name)).toEqual(['parts'])
    expect(out.files.map((f) => f.name).sort()).toEqual(['cube.stl', 'gear.obj'])
    expect(out.files[0].path).toContain('/models/')
    expect(out.files[0].mtime).toBe(1000)
    expect(out.files[0].size).toBe(1024)
  })
})

describe('listGridFiles (recursive)', () => {
  it('flattens supported files from nested folders, no folder tiles', async () => {
    vi.mocked(readDir)
      .mockResolvedValueOnce([dirEntry('sub', true), dirEntry('a.stl', false)] as any)
      .mockResolvedValueOnce([dirEntry('b.ply', false), dirEntry('skip.txt', false)] as any)

    const out = await listGridFiles('/models', true)
    expect(out.folders).toEqual([])
    expect(out.files.map((f) => f.name).sort()).toEqual(['a.stl', 'b.ply'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/services/gridFiles.test.ts`
Expected: FAIL (`listGridFiles` not found).

- [ ] **Step 3: Implement**

Create `src/services/gridFiles.ts`:

```ts
import { readDir, stat } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { SUPPORTED_EXTENSIONS } from '../loaders'
import { extname } from '../utils/pathUtils'

export interface GridFile {
  name: string
  path: string
  extension: string
  size: number
  mtime: number
}

export interface GridFolder {
  name: string
  path: string
}

export interface GridListing {
  folders: GridFolder[]
  files: GridFile[]
}

async function toGridFile(name: string, path: string, extension: string): Promise<GridFile> {
  const info = await stat(path)
  return {
    name,
    path,
    extension,
    size: info.size,
    mtime: info.mtime ? info.mtime.getTime() : 0,
  }
}

/**
 * Resolve a folder into grid entries. Current mode returns one level with
 * subfolder tiles; recursive mode walks all descendants and returns files only.
 */
export async function listGridFiles(dir: string, recursive: boolean): Promise<GridListing> {
  const folders: GridFolder[] = []
  const files: GridFile[] = []

  const walk = async (d: string, topLevel: boolean): Promise<void> => {
    const entries = await readDir(d)
    for (const e of entries) {
      if (!e.name) continue
      const full = await join(d, e.name)
      if (e.isDirectory) {
        if (recursive) {
          await walk(full, false)
        } else if (topLevel) {
          folders.push({ name: e.name, path: full })
        }
      } else if (e.isFile) {
        const ext = extname(e.name)
        if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
          files.push(await toGridFile(e.name, full, ext))
        }
      }
    }
  }

  await walk(dir, true)
  folders.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { folders, files }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/services/gridFiles.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/gridFiles.ts src/services/gridFiles.test.ts
git commit -m "feat: listGridFiles for current and recursive folder listing"
```

---

## Task 3: Thumbnail cache key + queue (testable core)

**Files:**
- Create: `src/services/thumbnailService.ts`
- Test: `src/services/thumbnailService.test.ts`

This task builds only the pure pieces: `cacheKey` and `createThumbnailQueue`. The WebGL render function is injected, so it is fully unit-testable. The wired singleton is added in Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/services/thumbnailService.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { cacheKey, createThumbnailQueue } from './thumbnailService'
import type { GridFile } from './gridFiles'

const file = (path: string, mtime = 1, size = 10): GridFile => ({
  name: path.split('/').pop()!, path, extension: '.stl', size, mtime,
})

describe('cacheKey', () => {
  it('combines path, mtime, size', () => {
    expect(cacheKey(file('/a.stl', 5, 20))).toBe('/a.stl:5:20')
  })
  it('changes when mtime or size changes (invalidation)', () => {
    expect(cacheKey(file('/a.stl', 5, 20))).not.toBe(cacheKey(file('/a.stl', 6, 20)))
    expect(cacheKey(file('/a.stl', 5, 20))).not.toBe(cacheKey(file('/a.stl', 5, 21)))
  })
})

describe('createThumbnailQueue', () => {
  it('renders a file and caches the data url', async () => {
    const render = vi.fn(async (f: GridFile) => `data:${f.path}`)
    const q = createThumbnailQueue({ render })
    const entry = await q.request(file('/a.stl'))
    expect(entry).toEqual({ status: 'ready', dataUrl: 'data:/a.stl' })
    expect(q.get(file('/a.stl'))).toEqual({ status: 'ready', dataUrl: 'data:/a.stl' })
  })

  it('dedups concurrent requests for the same key (render called once)', async () => {
    const render = vi.fn(async (f: GridFile) => `data:${f.path}`)
    const q = createThumbnailQueue({ render })
    const [a, b] = await Promise.all([q.request(file('/a.stl')), q.request(file('/a.stl'))])
    expect(a).toEqual(b)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('an erroring item is stored as error and the queue keeps going', async () => {
    const render = vi.fn(async (f: GridFile) => {
      if (f.path === '/bad.stl') throw new Error('parse fail')
      return `data:${f.path}`
    })
    const q = createThumbnailQueue({ render })
    const bad = await q.request(file('/bad.stl'))
    const good = await q.request(file('/good.stl'))
    expect(bad.status).toBe('error')
    expect(good).toEqual({ status: 'ready', dataUrl: 'data:/good.stl' })
  })

  it('honors concurrency 1 (no two renders in flight at once)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const render = vi.fn(async (f: GridFile) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return `data:${f.path}`
    })
    const q = createThumbnailQueue({ render })
    await Promise.all([
      q.request(file('/a.stl')),
      q.request(file('/b.stl')),
      q.request(file('/c.stl')),
    ])
    expect(maxInFlight).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/services/thumbnailService.test.ts`
Expected: FAIL (`cacheKey`/`createThumbnailQueue` not found).

- [ ] **Step 3: Implement**

Create `src/services/thumbnailService.ts`:

```ts
import type { GridFile } from './gridFiles'

export type ThumbStatus = 'pending' | 'ready' | 'error'

export interface ThumbEntry {
  status: ThumbStatus
  dataUrl?: string
}

export function cacheKey(f: GridFile): string {
  return `${f.path}:${f.mtime}:${f.size}`
}

export interface ThumbnailQueue {
  request: (f: GridFile) => Promise<ThumbEntry>
  get: (f: GridFile) => ThumbEntry | undefined
}

/**
 * Queue that runs `render` one file at a time and memoizes results by cache
 * key. A render failure is stored as an error entry and never blocks the
 * queue. Concurrent requests for the same key share one render.
 */
export function createThumbnailQueue(opts: {
  render: (f: GridFile) => Promise<string>
  concurrency?: number
}): ThumbnailQueue {
  const concurrency = opts.concurrency ?? 1
  const cache = new Map<string, ThumbEntry>()
  const inflight = new Map<string, Promise<ThumbEntry>>()
  const pending: Array<{ file: GridFile; key: string; resolve: (e: ThumbEntry) => void }> = []
  let active = 0

  const pump = () => {
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift()!
      active++
      opts
        .render(job.file)
        .then((dataUrl): ThumbEntry => ({ status: 'ready', dataUrl }))
        .catch((): ThumbEntry => ({ status: 'error' }))
        .then((entry) => {
          cache.set(job.key, entry)
          inflight.delete(job.key)
          active--
          job.resolve(entry)
          pump()
        })
    }
  }

  const request = (f: GridFile): Promise<ThumbEntry> => {
    const key = cacheKey(f)
    const cached = cache.get(key)
    if (cached) return Promise.resolve(cached)
    const existing = inflight.get(key)
    if (existing) return existing
    const p = new Promise<ThumbEntry>((resolve) => {
      pending.push({ file: f, key, resolve })
    })
    inflight.set(key, p)
    pump()
    return p
  }

  const get = (f: GridFile): ThumbEntry | undefined => cache.get(cacheKey(f))

  return { request, get }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/services/thumbnailService.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/thumbnailService.ts src/services/thumbnailService.test.ts
git commit -m "feat: thumbnail cache key + concurrency-limited render queue"
```

---

## Task 4: Wire the singleton thumbnail renderer (WebGL)

**Files:**
- Modify: `src/services/thumbnailService.ts`

WebGL is not exercisable in jsdom (same limit as the existing loader tests), so this is verified manually in Task 9, not unit tested. `preserveDrawingBuffer: true` is required for `toDataURL` to capture the frame.

- [ ] **Step 1: Add the wired singleton**

Append to `src/services/thumbnailService.ts`:

```ts
import * as THREE from 'three'
import { loadModel, disposeModel } from '../loaders'

const THUMB_SIZE = 256

let queueSingleton: ThumbnailQueue | null = null

function buildRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(THUMB_SIZE, THUMB_SIZE)
  renderer.setClearColor(0x000000, 0) // transparent; tiles sit on --bg-app

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xddeeff, 0x0d0d0d, 0.9))
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(5, 10, 7)
  scene.add(key)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1e7)

  const render = async (f: GridFile): Promise<string> => {
    const obj = await loadModel(f.path, f.extension, scene, camera, { center: true })
    try {
      renderer.render(scene, camera)
      return renderer.domElement.toDataURL('image/png')
    } finally {
      disposeModel(obj, scene)
    }
  }

  return createThumbnailQueue({ render, concurrency: 1 })
}

/** Lazily-built process-wide thumbnail queue backed by one hidden renderer. */
export function getThumbnailQueue(): ThumbnailQueue {
  if (!queueSingleton) queueSingleton = buildRenderer()
  return queueSingleton
}
```

- [ ] **Step 2: Verify the existing suite still passes**

Run: `pnpm test src/services/thumbnailService.test.ts`
Expected: PASS (the 6 existing tests; the singleton is not invoked by them).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/services/thumbnailService.ts
git commit -m "feat: singleton WebGL thumbnail renderer behind getThumbnailQueue"
```

---

## Task 5: GridTile component

**Files:**
- Create: `src/components/GridTile.tsx`
- Test: `src/components/GridTile.test.tsx`

The tile requests its thumbnail when it first becomes visible. The test stubs `IntersectionObserver` to fire immediately and injects a fake queue via props so no WebGL runs.

- [ ] **Step 1: Write the failing test**

Create `src/components/GridTile.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GridTile } from './GridTile'
import { useViewerStore } from '../store/viewerStore'
import type { GridFile } from '../services/gridFiles'
import type { ThumbnailQueue, ThumbEntry } from '../services/thumbnailService'

const file: GridFile = { name: 'cube.stl', path: '/m/cube.stl', extension: '.stl', size: 2048, mtime: 1 }

beforeEach(() => {
  // Fire IntersectionObserver immediately as "intersecting"
  ;(globalThis as any).IntersectionObserver = class {
    cb: (entries: any[]) => void
    constructor(cb: (entries: any[]) => void) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }]) }
    unobserve() {}
    disconnect() {}
  }
  useViewerStore.setState({
    filePath: null, fileName: null, fileExtension: null, fileSize: null,
    mainView: 'grid', loadedModels: [],
  })
})

const makeQueue = (entry: ThumbEntry): ThumbnailQueue => ({
  request: vi.fn(async () => entry),
  get: vi.fn(() => undefined),
})

describe('GridTile', () => {
  it('shows the image when the thumbnail resolves', async () => {
    render(<GridTile file={file} queue={makeQueue({ status: 'ready', dataUrl: 'data:abc' })} />)
    await waitFor(() => {
      const img = screen.getByRole('img') as HTMLImageElement
      expect(img.src).toContain('data:abc')
    })
  })

  it('shows a placeholder on error', async () => {
    render(<GridTile file={file} queue={makeQueue({ status: 'error' })} />)
    await waitFor(() => expect(screen.getByText(/preview unavailable/i)).toBeTruthy())
  })

  it('click loads the file as preview and switches to 3d', async () => {
    render(<GridTile file={file} queue={makeQueue({ status: 'ready', dataUrl: 'data:abc' })} />)
    await userEvent.click(screen.getByRole('button', { name: /open cube\.stl/i }))
    const s = useViewerStore.getState()
    expect(s.filePath).toBe('/m/cube.stl')
    expect(s.mainView).toBe('3d')
  })

  it('add button adds the file to the scene', async () => {
    render(<GridTile file={file} queue={makeQueue({ status: 'ready', dataUrl: 'data:abc' })} />)
    await userEvent.click(screen.getByRole('button', { name: /add cube\.stl to scene/i }))
    expect(useViewerStore.getState().loadedModels.map((m) => m.path)).toContain('/m/cube.stl')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/GridTile.test.tsx`
Expected: FAIL (`GridTile` not found).

- [ ] **Step 3: Implement**

Create `src/components/GridTile.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import type { GridFile } from '../services/gridFiles'
import { getThumbnailQueue } from '../services/thumbnailService'
import type { ThumbnailQueue, ThumbStatus } from '../services/thumbnailService'

interface GridTileProps {
  file: GridFile
  /** Injectable for tests; defaults to the singleton queue. */
  queue?: ThumbnailQueue
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function GridTile({ file, queue }: GridTileProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [status, setStatus] = useState<ThumbStatus>('pending')
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined)
  const requested = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const q = queue ?? getThumbnailQueue()
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || requested.current) return
      requested.current = true
      q.request(file).then((entry) => {
        setStatus(entry.status)
        setDataUrl(entry.dataUrl)
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [file, queue])

  const badge = file.extension.toUpperCase().replace('.', '')

  const onOpen = () => {
    useViewerStore.getState().setFile(file.path, file.name, file.extension, file.size)
  }

  const onAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    useViewerStore.getState().addModel({
      id: crypto.randomUUID(),
      path: file.path,
      name: file.name,
      extension: file.extension,
      sizeBytes: file.size,
      triangleCount: 0,
    })
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={`Open ${file.name}`}
      title={file.name}
      className="group relative flex flex-col rounded border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden text-left hover:border-[var(--accent)] transition-colors"
    >
      <div className="relative aspect-square bg-[var(--bg-app)] flex items-center justify-center">
        {status === 'ready' && dataUrl ? (
          <img src={dataUrl} alt={file.name} className="w-full h-full object-contain" />
        ) : status === 'error' ? (
          <div className="flex flex-col items-center gap-1 text-[var(--text-muted)]">
            <span className="bg-[var(--bg-button)] text-[10px] rounded font-mono px-1 py-0.5">{badge}</span>
            <span className="text-[10px]">preview unavailable</span>
          </div>
        ) : (
          <div className="w-2/3 h-2/3 rounded bg-[var(--bg-button)] animate-pulse" />
        )}

        <span
          role="button"
          tabIndex={0}
          aria-label={`Add ${file.name} to scene`}
          title="Add to scene"
          onClick={onAdd}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdd(e as unknown as React.MouseEvent) }}
          className="absolute top-1 right-1 w-5 h-5 hidden group-hover:flex items-center justify-center rounded bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--accent)] text-sm font-bold leading-none"
        >
          +
        </span>
      </div>

      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="bg-[var(--bg-button)] text-[10px] rounded font-mono px-1 py-0.5 shrink-0">{badge}</span>
        <span className="truncate text-xs text-[var(--text-primary)] flex-1">{file.name}</span>
        <span className="text-[10px] text-[var(--text-muted)] shrink-0 font-mono tabular-nums">{formatBytes(file.size)}</span>
      </div>
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/GridTile.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/GridTile.tsx src/components/GridTile.test.tsx
git commit -m "feat: GridTile with lazy thumbnail, preview click, add-to-scene"
```

---

## Task 6: PreviewGrid component

**Files:**
- Create: `src/components/PreviewGrid.tsx`

This component resolves the file list for `gridFolder` + `gridScope` and renders the grid. Listing depends on Tauri fs at runtime, so it is verified manually (Task 9); the tile logic it composes is already tested.

- [ ] **Step 1: Implement**

Create `src/components/PreviewGrid.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { listGridFiles } from '../services/gridFiles'
import type { GridListing } from '../services/gridFiles'
import { GridTile } from './GridTile'

export function PreviewGrid() {
  const gridFolder = useViewerStore((s) => s.gridFolder)
  const gridScope = useViewerStore((s) => s.gridScope)
  const [listing, setListing] = useState<GridListing>({ folders: [], files: [] })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!gridFolder) return
    let cancelled = false
    setLoading(true)
    listGridFiles(gridFolder, gridScope === 'recursive')
      .then((res) => { if (!cancelled) setListing(res) })
      .catch((err) => {
        if (!cancelled) {
          setListing({ folders: [], files: [] })
          useViewerStore.getState().setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [gridFolder, gridScope])

  const setScope = (s: 'current' | 'recursive') => useViewerStore.getState().setGridScope(s)
  const total = listing.files.length

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-app)] overflow-hidden">
      {/* Toolbar row: scope toggle + count */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
        <div className="flex rounded overflow-hidden border border-[var(--border-input)]">
          {(['current', 'recursive'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={[
                'px-2.5 py-1 text-xs transition-colors',
                gridScope === s
                  ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
                  : 'bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              ].join(' ')}
            >
              {s === 'current' ? 'This folder' : 'All subfolders'}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
          {loading ? 'scanning...' : `${total} file${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {!loading && total === 0 && listing.folders.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No supported 3D files in this folder.</p>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {listing.folders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                onClick={() => useViewerStore.getState().setGridFolder(folder.path)}
                aria-label={folder.name}
                title={folder.name}
                className="flex flex-col items-center justify-center gap-2 aspect-square rounded border border-[var(--border)] bg-[var(--bg-panel)] hover:border-[var(--accent)] transition-colors text-[var(--text-label)]"
              >
                <svg className="w-8 h-8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
                  <path strokeLinejoin="round" d="M1.75 4.25a1 1 0 011-1h3l1.5 1.5h5.5a1 1 0 011 1v6a1 1 0 01-1 1H2.75a1 1 0 01-1-1v-7.5z" />
                </svg>
                <span className="truncate max-w-full px-2 text-xs text-[var(--text-primary)]">{folder.name}</span>
              </button>
            ))}
            {listing.files.map((file) => (
              <GridTile key={file.path} file={file} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/PreviewGrid.tsx
git commit -m "feat: PreviewGrid with scope toggle, folder tiles, file grid"
```

---

## Task 7: Folder open sets grid state

**Files:**
- Modify: `src/hooks/useDirOpen.ts`

- [ ] **Step 1: Update openDir**

In `src/hooks/useDirOpen.ts`, inside `openDir`, after `useViewerStore.getState().setDir(dirPath, files)` (the last store write in the success path), add:

```ts
      useViewerStore.getState().setGridFolder(dirPath)
      useViewerStore.getState().setMainView('grid')
```

- [ ] **Step 2: Verify existing hook tests still pass**

Run: `pnpm test src/hooks/useDirOpen.test.ts`
Expected: PASS (3 tests; they assert tree/dir state, unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDirOpen.ts
git commit -m "feat: opening a folder lands on the preview grid"
```

---

## Task 8: App + Toolbar wiring

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Toolbar.tsx`

- [ ] **Step 1: Render PreviewGrid in App**

In `src/App.tsx`, add imports near the other component imports:

```tsx
import { PreviewGrid } from './components/PreviewGrid'
```

Add selectors alongside the existing ones in the component body:

```tsx
  const dirPath = useViewerStore((s) => s.dirPath)
  const mainView = useViewerStore((s) => s.mainView)
```

Replace the main-area conditional block. Current:

```tsx
          {filePath || loadedModels.length > 0 ? (
            <Viewer3D ref={viewerRef} filePath={filePath} fileExtension={fileExtension} viewMode={viewMode} />
          ) : (
            <DropZone />
          )}

          {(filePath || loadedModels.length > 0) && (
            <SceneControls viewerRef={viewerRef} />
          )}
```

New:

```tsx
          {dirPath && mainView === 'grid' ? (
            <PreviewGrid />
          ) : filePath || loadedModels.length > 0 ? (
            <Viewer3D ref={viewerRef} filePath={filePath} fileExtension={fileExtension} viewMode={viewMode} />
          ) : (
            <DropZone />
          )}

          {!(dirPath && mainView === 'grid') && (filePath || loadedModels.length > 0) && (
            <SceneControls viewerRef={viewerRef} />
          )}
```

- [ ] **Step 2: Add the Grid/3D toggle to the Toolbar**

In `src/components/Toolbar.tsx`, add a store selector with the others near the top of `Toolbar`:

```tsx
  const mainView = useViewerStore((s) => s.mainView)
```

Then, immediately after the "Explorer" toggle button block (the `{dirPath && !explorerVisible && ( ... )}` block), add:

```tsx
      {dirPath && (
        <div className="flex rounded overflow-hidden border border-[var(--border-input)]">
          {(['grid', '3d'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => useViewerStore.getState().setMainView(v)}
              className={[
                'px-3 py-1.5 text-sm transition-colors',
                mainView === v
                  ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
                  : 'bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              ].join(' ')}
              title={v === 'grid' ? 'Show preview grid' : 'Show 3D view'}
            >
              {v === 'grid' ? 'Grid' : '3D'}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit && pnpm test`
Expected: tsc exit 0; all tests pass.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: builds, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/Toolbar.tsx
git commit -m "feat: wire preview grid into App layout and toolbar toggle"
```

---

## Task 9: Manual verification (Tauri runtime)

**Files:** none (verification only). WebGL thumbnail rendering and Tauri fs cannot run in jsdom.

- [ ] **Step 1: Launch**

Run: `pnpm tauri dev`

- [ ] **Step 2: Verify the grid**

Confirm, in the window:
- Open Folder -> main area shows the thumbnail grid; tiles render rendered previews (skeleton then image).
- "This folder" shows subfolder tiles; clicking one descends and lists that folder.
- "All subfolders" flattens supported files; subfolder tiles disappear.
- Clicking a thumbnail loads it in the 3D viewer and the toolbar shows `3D` active; `[Grid]` returns to the grid.
- Hovering a tile shows `+`; clicking it adds the model to the scene (Sidebar scene list grows) without leaving the grid.
- A file that fails to parse shows the "preview unavailable" placeholder and does not stall other tiles.
- Dark and light themes both render the grid cleanly; reduced-motion stops the skeleton pulse.

- [ ] **Step 3: Record the result**

Note any failures here, then stop for review.

---

## Self-review notes

- Spec coverage: Full Gallery mode (Task 8), folder-open lands on grid (Task 7), lazy on-visible thumbnails (Task 5), current/recursive scope (Tasks 2, 6), in-memory cache keyed path+mtime+size (Task 3), click=preview + hover-[+]=add (Task 5), folder tiles in current mode (Task 6), error placeholder + queue advance (Tasks 3, 5), theme/reduced-motion reuse (Tasks 5, 6). All covered.
- Type consistency: `GridFile`/`GridFolder`/`GridListing` (gridFiles.ts) used by thumbnailService, GridTile, PreviewGrid. `ThumbnailQueue`/`ThumbEntry`/`ThumbStatus` (thumbnailService.ts) used by GridTile. `setFile` signature unchanged for callers; it now also sets `mainView`. `addModel` shape matches the existing store `LoadedModel`.
- No placeholders: every code step is complete.
```
