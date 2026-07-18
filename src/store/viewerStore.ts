import { create } from 'zustand'
import type { QualityPreset, PerformanceOverrides } from '../utils/performancePresets'
import type { ThemeMode } from '../themes'

type ViewMode = 'solid' | 'wireframe' | 'points'

export interface LoadedModel {
  id: string
  path: string
  name: string
  extension: string
  sizeBytes: number
  triangleCount: number
}

export interface DirFileEntry {
  name: string
  fullPath: string
  extension: string
  sizeBytes: number
}

export interface DirTreeEntry {
  name: string
  fullPath: string
  isDirectory: boolean
  extension?: string
  sizeBytes?: number
  children?: DirTreeEntry[]
  isExpanded?: boolean
  isLoaded?: boolean
}

interface ViewerState {
  filePath: string | null
  fileName: string | null
  fileExtension: string | null
  fileSize: number | null
  /** Raw model bytes for browser-supplied files (drag-and-drop / file input).
   *  When set, the viewer parses these instead of reading filePath via Tauri. */
  fileBuffer: ArrayBuffer | null
  viewMode: ViewMode
  isLoading: boolean
  /** True while a file drag hovers the window (drives drop highlight). */
  isDragOver: boolean
  error: string | null
  triangleCount: number | null
  projectionMode: 'perspective' | 'orthographic'
  mainView: 'grid' | '3d'
  mobileDrawer: 'none' | 'explorer' | 'details'
  gridScope: 'current' | 'recursive'
  gridFolder: string | null
  recentFiles: string[]

  // Multi-model state
  loadedModels: LoadedModel[]
  activeFilePath: string | null
  dirPath: string | null
  dirFiles: DirFileEntry[]
  dirTree: DirTreeEntry[]

  setFile: (path: string, name: string, ext: string, size: number) => void
  setFileFromBuffer: (name: string, ext: string, size: number, buffer: ArrayBuffer) => void
  setViewMode: (mode: ViewMode) => void
  setLoading: (loading: boolean) => void
  setDragOver: (over: boolean) => void
  setError: (error: string | null) => void
  setProjectionMode: (mode: 'perspective' | 'orthographic') => void
  setMainView: (v: 'grid' | '3d') => void
  setMobileDrawer: (d: 'none' | 'explorer' | 'details') => void
  setGridScope: (s: 'current' | 'recursive') => void
  setGridFolder: (path: string | null) => void
  setTriangleCount: (count: number | null) => void
  addRecentFile: (path: string) => void

  // Multi-model actions
  addModel: (model: LoadedModel) => void
  removeModel: (id: string) => void
  clearModels: () => void
  explorerVisible: boolean
  sidebarVisible: boolean

  // Performance settings
  performancePreset: QualityPreset
  performanceOverrides: PerformanceOverrides
  settingsOpen: boolean
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void

  setPerformancePreset: (preset: QualityPreset) => void
  setPerformanceOverride: <K extends keyof PerformanceOverrides>(
    key: K,
    value: Exclude<PerformanceOverrides[K], undefined>
  ) => void
  resetPerformanceOverrides: () => void
  setSettingsOpen: (open: boolean) => void
  setExplorerVisible: (visible: boolean) => void
  setSidebarVisible: (visible: boolean) => void
  setActiveFile: (path: string | null) => void
  setDir: (path: string, files: DirFileEntry[]) => void
  setDirTree: (path: string, tree: DirTreeEntry[]) => void
  updateTreeNode: (fullPath: string, updates: Partial<DirTreeEntry>) => void
  updateModelTriangles: (id: string, count: number) => void
}

function updateNodeInTree(
  tree: DirTreeEntry[],
  fullPath: string,
  updates: Partial<DirTreeEntry>
): DirTreeEntry[] {
  return tree.map((node) => {
    if (node.fullPath === fullPath) {
      return { ...node, ...updates }
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, fullPath, updates) }
    }
    return node
  })
}

export const useViewerStore = create<ViewerState>((set) => ({
  filePath: null,
  fileName: null,
  fileExtension: null,
  fileSize: null,
  fileBuffer: null,
  viewMode: 'solid',
  isLoading: false,
  isDragOver: false,
  error: null,
  triangleCount: null,
  projectionMode: 'perspective' as const,
  mainView: 'grid' as const,
  mobileDrawer: 'none' as const,
  gridScope: 'current' as const,
  gridFolder: null,
  recentFiles: [],

  // Multi-model initial state
  loadedModels: [],
  activeFilePath: null,
  dirPath: null,
  dirFiles: [],
  dirTree: [],
  explorerVisible: true,
  sidebarVisible: true,

  // Performance settings
  performancePreset: 'high' as QualityPreset,
  performanceOverrides: {} as PerformanceOverrides,
  settingsOpen: false,
  theme: 'dark' as ThemeMode,
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

  setPerformancePreset: (preset) =>
    set({ performancePreset: preset, performanceOverrides: {} }),
  setPerformanceOverride: (key, value) =>
    set((state) => ({
      performanceOverrides: { ...state.performanceOverrides, [key]: value },
    })),
  resetPerformanceOverrides: () =>
    set({ performancePreset: 'high', performanceOverrides: {} }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  setFile: (path, name, ext, size) =>
    set({ filePath: path, fileName: name, fileExtension: ext, fileSize: size, fileBuffer: null, error: null, mainView: '3d', triangleCount: null }),
  setFileFromBuffer: (name, ext, size, buffer) =>
    set({ filePath: name, fileName: name, fileExtension: ext, fileSize: size, fileBuffer: buffer, error: null, mainView: '3d', triangleCount: null }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setLoading: (loading) => set({ isLoading: loading }),
  setDragOver: (over) => set({ isDragOver: over }),
  setError: (error) => set({ error }),
  setProjectionMode: (mode) => set({ projectionMode: mode }),
  setMainView: (v) => set({ mainView: v }),
  setMobileDrawer: (d) => set({ mobileDrawer: d }),
  setGridScope: (s) => set({ gridScope: s }),
  setGridFolder: (path) => set({ gridFolder: path }),
  setTriangleCount: (count) => set({ triangleCount: count }),
  addRecentFile: (path) =>
    set((state) => ({
      recentFiles: [path, ...state.recentFiles.filter((f) => f !== path)].slice(0, 10),
    })),

  // Multi-model actions
  addModel: (model) =>
    set((state) => ({ loadedModels: [...state.loadedModels, model] })),
  removeModel: (id) =>
    set((state) => ({ loadedModels: state.loadedModels.filter((m) => m.id !== id) })),
  clearModels: () => set({ loadedModels: [] }),
  setExplorerVisible: (visible) => set({ explorerVisible: visible }),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  setActiveFile: (path) => set({ activeFilePath: path }),
  setDir: (path, files) => set({ dirPath: path, dirFiles: files }),
  setDirTree: (path, tree) => set({ dirPath: path, dirTree: tree }),
  updateTreeNode: (fullPath, updates) =>
    set((state) => ({
      dirTree: updateNodeInTree(state.dirTree, fullPath, updates),
    })),
  updateModelTriangles: (id, count) =>
    set((state) => ({
      loadedModels: state.loadedModels.map((m) =>
        m.id === id ? { ...m, triangleCount: count } : m
      ),
    })),
}))
