import { describe, it, expect, beforeEach } from 'vitest'
import { useViewerStore, LoadedModel, DirFileEntry } from './viewerStore'

describe('viewerStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useViewerStore.setState({
      filePath: null,
      fileName: null,
      fileExtension: null,
      fileSize: null,
      viewMode: 'solid',
      isLoading: false,
      error: null,
      triangleCount: null,
      recentFiles: [],
      // New multi-model fields
      loadedModels: [],
      pendingModelLoads: 0,
      activeFilePath: null,
      dirPath: null,
      dirFiles: [],
      mainView: 'grid',
      gridScope: 'current',
      gridFolder: null,
    })
  })

  it('should have correct initial state', () => {
    const state = useViewerStore.getState()
    expect(state.filePath).toBeNull()
    expect(state.fileName).toBeNull()
    expect(state.fileExtension).toBeNull()
    expect(state.fileSize).toBeNull()
    expect(state.viewMode).toBe('solid')
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.triangleCount).toBeNull()
    expect(state.recentFiles).toEqual([])
    expect(state.loadedModels).toEqual([])
    expect(state.activeFilePath).toBeNull()
    expect(state.dirPath).toBeNull()
    expect(state.dirFiles).toEqual([])
  })

  it('setFile() populates all file fields and clears error', () => {
    const { setFile } = useViewerStore.getState()
    useViewerStore.setState({ error: 'previous error', viewMode: 'points' })
    setFile('/path/to/model.stl', 'model.stl', '.stl', 1234567)
    const state = useViewerStore.getState()
    expect(state.filePath).toBe('/path/to/model.stl')
    expect(state.fileName).toBe('model.stl')
    expect(state.fileExtension).toBe('.stl')
    expect(state.fileSize).toBe(1234567)
    expect(state.error).toBeNull()
    expect(state.mainView).toBe('3d')
    expect(state.viewMode).toBe('solid')
  })

  it('setLoading() toggles isLoading', () => {
    const { setLoading } = useViewerStore.getState()
    setLoading(true)
    expect(useViewerStore.getState().isLoading).toBe(true)
    setLoading(false)
    expect(useViewerStore.getState().isLoading).toBe(false)
  })

  it('setError() sets and clears error', () => {
    const { setError } = useViewerStore.getState()
    setError('Failed to load file')
    expect(useViewerStore.getState().error).toBe('Failed to load file')
    setError(null)
    expect(useViewerStore.getState().error).toBeNull()
  })

  it('setTriangleCount() sets triangle count', () => {
    const { setTriangleCount } = useViewerStore.getState()
    setTriangleCount(1000)
    expect(useViewerStore.getState().triangleCount).toBe(1000)
    setTriangleCount(null)
    expect(useViewerStore.getState().triangleCount).toBeNull()
  })

  it('setViewMode() changes viewMode', () => {
    const { setViewMode } = useViewerStore.getState()
    setViewMode('wireframe')
    expect(useViewerStore.getState().viewMode).toBe('wireframe')
    setViewMode('points')
    expect(useViewerStore.getState().viewMode).toBe('points')
    setViewMode('solid')
    expect(useViewerStore.getState().viewMode).toBe('solid')
  })

  it('addRecentFile() prepends and deduplicates', () => {
    const { addRecentFile } = useViewerStore.getState()
    addRecentFile('/path/a.stl')
    addRecentFile('/path/b.stl')
    addRecentFile('/path/a.stl') // should deduplicate and move to front
    const state = useViewerStore.getState()
    expect(state.recentFiles).toEqual(['/path/a.stl', '/path/b.stl'])
  })

  it('addRecentFile() caps at 10 files', () => {
    const { addRecentFile } = useViewerStore.getState()
    for (let i = 0; i < 12; i++) {
      addRecentFile(`/path/file${i}.stl`)
    }
    expect(useViewerStore.getState().recentFiles).toHaveLength(10)
    // Most recently added should be first
    expect(useViewerStore.getState().recentFiles[0]).toBe('/path/file11.stl')
  })

  // --- New multi-model tests ---

  it('addModel() appends to loadedModels without clearing existing', () => {
    const { addModel } = useViewerStore.getState()
    const model1: LoadedModel = {
      id: 'id-1',
      path: '/path/a.stl',
      name: 'a.stl',
      extension: '.stl',
      sizeBytes: 1000,
      triangleCount: 100,
    }
    const model2: LoadedModel = {
      id: 'id-2',
      path: '/path/b.stl',
      name: 'b.stl',
      extension: '.stl',
      sizeBytes: 2000,
      triangleCount: 200,
    }
    addModel(model1)
    expect(useViewerStore.getState().loadedModels).toHaveLength(1)
    addModel(model2)
    const models = useViewerStore.getState().loadedModels
    expect(models).toHaveLength(2)
    expect(models[0]).toEqual(model1)
    expect(models[1]).toEqual(model2)
  })

  it('addModel() clears a retained preview before building an assembly', () => {
    useViewerStore.setState({
      filePath: '/path/preview.stl',
      fileName: 'preview.stl',
      fileExtension: '.stl',
      fileSize: 100,
      fileBuffer: new ArrayBuffer(1),
      triangleCount: 2,
    })
    useViewerStore.getState().addModel({
      id: 'assembly', path: '/path/assembly.stl', name: 'assembly.stl',
      extension: '.stl', sizeBytes: 200, triangleCount: 0,
    })

    const state = useViewerStore.getState()
    expect(state.filePath).toBeNull()
    expect(state.fileBuffer).toBeNull()
    expect(state.triangleCount).toBeNull()
    expect(state.loadedModels).toHaveLength(1)
  })

  it('removeModel() removes only the entry with matching id', () => {
    const { addModel, removeModel } = useViewerStore.getState()
    const model1: LoadedModel = {
      id: 'id-1',
      path: '/path/a.stl',
      name: 'a.stl',
      extension: '.stl',
      sizeBytes: 1000,
      triangleCount: 100,
    }
    const model2: LoadedModel = {
      id: 'id-2',
      path: '/path/b.stl',
      name: 'b.stl',
      extension: '.stl',
      sizeBytes: 2000,
      triangleCount: 200,
    }
    addModel(model1)
    addModel(model2)
    removeModel('id-1')
    const models = useViewerStore.getState().loadedModels
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('id-2')
  })

  it('clearModels() empties the loadedModels array', () => {
    const { addModel, clearModels } = useViewerStore.getState()
    const model: LoadedModel = {
      id: 'id-1',
      path: '/path/a.stl',
      name: 'a.stl',
      extension: '.stl',
      sizeBytes: 1000,
      triangleCount: 100,
    }
    addModel(model)
    expect(useViewerStore.getState().loadedModels).toHaveLength(1)
    clearModels()
    expect(useViewerStore.getState().loadedModels).toHaveLength(0)
  })

  it('setActiveFile() sets activeFilePath', () => {
    const { setActiveFile } = useViewerStore.getState()
    setActiveFile('/path/a.stl')
    expect(useViewerStore.getState().activeFilePath).toBe('/path/a.stl')
    setActiveFile(null)
    expect(useViewerStore.getState().activeFilePath).toBeNull()
  })

  it('setDir() sets dirPath and dirFiles', () => {
    const { setDir } = useViewerStore.getState()
    const files: DirFileEntry[] = [
      { name: 'a.stl', fullPath: '/dir/a.stl', extension: '.stl', sizeBytes: 1000 },
      { name: 'b.ply', fullPath: '/dir/b.ply', extension: '.ply', sizeBytes: 2000 },
    ]
    setDir('/dir', files)
    const state = useViewerStore.getState()
    expect(state.dirPath).toBe('/dir')
    expect(state.dirFiles).toEqual(files)
  })

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

  describe('mobileDrawer', () => {
    beforeEach(() => {
      useViewerStore.setState({ mobileDrawer: 'none' })
    })

    it('defaults to none', () => {
      expect(useViewerStore.getState().mobileDrawer).toBe('none')
    })

    it('setMobileDrawer sets the value', () => {
      useViewerStore.getState().setMobileDrawer('explorer')
      expect(useViewerStore.getState().mobileDrawer).toBe('explorer')
    })

    it('opening one drawer replaces the other', () => {
      useViewerStore.getState().setMobileDrawer('explorer')
      useViewerStore.getState().setMobileDrawer('details')
      expect(useViewerStore.getState().mobileDrawer).toBe('details')
    })
  })
})

describe('setFileFromBuffer (browser files)', () => {
  beforeEach(() => {
    useViewerStore.setState({
      filePath: null,
      fileName: null,
      fileExtension: null,
      fileSize: null,
      fileBuffer: null,
      error: 'stale error',
      mainView: 'grid',
      viewMode: 'wireframe',
    })
  })

  it('sets file fields, buffer, and switches to 3d view', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer
    useViewerStore.getState().setFileFromBuffer('cube.stl', '.stl', 3, buffer)
    const state = useViewerStore.getState()
    expect(state.filePath).toBe('cube.stl')
    expect(state.fileName).toBe('cube.stl')
    expect(state.fileExtension).toBe('.stl')
    expect(state.fileSize).toBe(3)
    expect(state.fileBuffer).toBe(buffer)
    expect(state.error).toBeNull()
    expect(state.mainView).toBe('3d')
    expect(state.viewMode).toBe('solid')
  })

  it('setFile clears any previous browser buffer', () => {
    const buffer = new Uint8Array([1]).buffer
    useViewerStore.getState().setFileFromBuffer('cube.stl', '.stl', 1, buffer)
    useViewerStore.getState().setFile('/models/part.stl', 'part.stl', '.stl', 42)
    expect(useViewerStore.getState().fileBuffer).toBeNull()
  })
})
