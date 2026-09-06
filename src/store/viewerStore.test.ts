import { describe, it, expect, beforeEach } from 'vitest'
import { useViewerStore, LoadedModel, DirFileEntry, DEFAULT_BUILD_VOLUME_MM } from './viewerStore'

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

describe('rightPanelTab', () => {
  beforeEach(() => {
    useViewerStore.setState({ rightPanelTab: 'details' })
  })

  it('defaults to details', () => {
    expect(useViewerStore.getState().rightPanelTab).toBe('details')
  })

  it('setRightPanelTab switches the active tab', () => {
    useViewerStore.getState().setRightPanelTab('prepare')
    expect(useViewerStore.getState().rightPanelTab).toBe('prepare')
    useViewerStore.getState().setRightPanelTab('details')
    expect(useViewerStore.getState().rightPanelTab).toBe('details')
  })

  it('GeometryDetails carries degenerate and duplicate face counts', () => {
    useViewerStore.getState().setGeometryDetails({
      width: 1, height: 1, depth: 1, vertices: 3, meshes: 1,
      boundaryEdges: 3, nonManifoldEdges: 0, degenerateFaces: 2, duplicateFaces: 1,
      watertight: false, modelUnitInMm: null, overhangFaceCount: 0,
    })
    const details = useViewerStore.getState().geometryDetails
    expect(details?.degenerateFaces).toBe(2)
    expect(details?.duplicateFaces).toBe(1)
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

describe('undoLabels', () => {
  beforeEach(() => {
    useViewerStore.setState({ undoLabels: [], canUndoEdit: false })
  })

  it('defaults to an empty array', () => {
    expect(useViewerStore.getInitialState().undoLabels).toEqual([])
  })

  it('setUndoLabels replaces the list', () => {
    useViewerStore.getState().setUndoLabels(['Make solid'])
    expect(useViewerStore.getState().undoLabels).toEqual(['Make solid'])
    useViewerStore.getState().setUndoLabels(['Weld vertices', 'Make solid'])
    expect(useViewerStore.getState().undoLabels).toEqual(['Weld vertices', 'Make solid'])
  })

  it('setUndoLabels does not touch canUndoEdit', () => {
    useViewerStore.setState({ canUndoEdit: true })
    useViewerStore.getState().setUndoLabels([])
    expect(useViewerStore.getState().canUndoEdit).toBe(true)
  })
})

describe('sealApplied', () => {
  beforeEach(() => { useViewerStore.setState({ sealApplied: false }) })

  it('defaults to false', () => {
    expect(useViewerStore.getInitialState().sealApplied).toBe(false)
  })

  it('setSealApplied toggles it', () => {
    useViewerStore.getState().setSealApplied(true)
    expect(useViewerStore.getState().sealApplied).toBe(true)
  })

  it('setFile resets it', () => {
    useViewerStore.setState({ sealApplied: true })
    useViewerStore.getState().setFile('/m/x.stl', 'x.stl', '.stl', 10)
    expect(useViewerStore.getState().sealApplied).toBe(false)
  })
})

describe('hole-fill mode', () => {
  it('defaults off with no status', () => {
    const s = useViewerStore.getState()
    expect(s.holeFillMode).toBe(false)
    expect(s.holeFillStatus).toBeNull()
  })

  it('setters update the fields', () => {
    useViewerStore.getState().setHoleFillMode(true)
    useViewerStore.getState().setHoleFillStatus({ loops: 3, skippedMeshes: 1 })
    expect(useViewerStore.getState().holeFillMode).toBe(true)
    expect(useViewerStore.getState().holeFillStatus).toEqual({ loops: 3, skippedMeshes: 1 })
  })

  it('setFile clears mode and status', () => {
    useViewerStore.getState().setHoleFillMode(true)
    useViewerStore.getState().setHoleFillStatus({ loops: 2, skippedMeshes: 0 })
    useViewerStore.getState().setFile('/tmp/x.stl', 'x.stl', '.stl', 10)
    expect(useViewerStore.getState().holeFillMode).toBe(false)
    expect(useViewerStore.getState().holeFillStatus).toBeNull()
  })
})

describe('split parts', () => {
  it('defaults empty with no export target', () => {
    const s = useViewerStore.getState()
    expect(s.splitParts).toEqual([])
    expect(s.exportTargetId).toBeNull()
  })

  it('setSplitPartVisible flips exactly the matching id', () => {
    useViewerStore.getState().setSplitParts([
      { id: 'a', name: 'A', triangleCount: 10, visible: true },
      { id: 'b', name: 'B', triangleCount: 20, visible: true },
    ])
    useViewerStore.getState().setSplitPartVisible('b', false)
    const parts = useViewerStore.getState().splitParts
    expect(parts.find((p) => p.id === 'a')!.visible).toBe(true)
    expect(parts.find((p) => p.id === 'b')!.visible).toBe(false)
  })

  it('setExportTargetId sets and clears', () => {
    useViewerStore.getState().setExportTargetId('x')
    expect(useViewerStore.getState().exportTargetId).toBe('x')
    useViewerStore.getState().setExportTargetId(null)
    expect(useViewerStore.getState().exportTargetId).toBeNull()
  })

  it('setFile resets split parts and export target', () => {
    useViewerStore.getState().setSplitParts([{ id: 'a', name: 'A', triangleCount: 1, visible: true }])
    useViewerStore.getState().setExportTargetId('a')
    useViewerStore.getState().setFile('/tmp/x.stl', 'x.stl', 'stl', 10)
    expect(useViewerStore.getState().splitParts).toEqual([])
    expect(useViewerStore.getState().exportTargetId).toBeNull()
  })
})

describe('units + measure state', () => {
  beforeEach(() => {
    useViewerStore.setState({
      measureMode: false,
      measureDistanceMm: null,
      buildVolumeMm: { ...DEFAULT_BUILD_VOLUME_MM },
    })
  })

  it('defaults', () => {
    const s = useViewerStore.getState()
    expect(s.measureMode).toBe(false)
    expect(s.measureDistanceMm).toBeNull()
    expect(s.buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 })
  })

  it('turning measure off clears the distance', () => {
    useViewerStore.getState().setMeasureMode(true)
    useViewerStore.getState().setMeasureDistanceMm(42)
    useViewerStore.getState().setMeasureMode(false)
    expect(useViewerStore.getState().measureDistanceMm).toBeNull()
  })

  it('build volume set + reset', () => {
    useViewerStore.getState().setBuildVolumeMm({ x: 300, y: 300, z: 400 })
    expect(useViewerStore.getState().buildVolumeMm).toEqual({ x: 300, y: 300, z: 400 })
    useViewerStore.getState().resetBuildVolumeMm()
    expect(useViewerStore.getState().buildVolumeMm).toEqual({ x: 220, y: 220, z: 250 })
  })

  it('setFile clears measure state', () => {
    useViewerStore.getState().setMeasureMode(true)
    useViewerStore.getState().setMeasureDistanceMm(9)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    expect(useViewerStore.getState().measureMode).toBe(false)
    expect(useViewerStore.getState().measureDistanceMm).toBeNull()
  })
})

describe('overhang heatmap state', () => {
  beforeEach(() =>
    useViewerStore.setState({ overhangMode: false, overhangThresholdDeg: 45, overhangOverlayStatus: null }),
  )

  it('defaults', () => {
    const s = useViewerStore.getState()
    expect(s.overhangMode).toBe(false)
    expect(s.overhangThresholdDeg).toBe(45)
    expect(s.overhangOverlayStatus).toBeNull()
  })

  it('set actions', () => {
    useViewerStore.getState().setOverhangMode(true)
    expect(useViewerStore.getState().overhangMode).toBe(true)
    useViewerStore.getState().setOverhangThresholdDeg(30)
    expect(useViewerStore.getState().overhangThresholdDeg).toBe(30)
    useViewerStore.getState().setOverhangOverlayStatus({ meshCount: 2, skippedMeshes: 1 })
    expect(useViewerStore.getState().overhangOverlayStatus).toEqual({ meshCount: 2, skippedMeshes: 1 })
  })

  it('setFile clears overhangMode', () => {
    useViewerStore.getState().setOverhangMode(true)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    expect(useViewerStore.getState().overhangMode).toBe(false)
  })
})

describe('help modal state', () => {
  beforeEach(() => useViewerStore.setState({ helpOpen: false }))

  it('defaults to closed', () => {
    expect(useViewerStore.getState().helpOpen).toBe(false)
  })

  it('setHelpOpen toggles it', () => {
    useViewerStore.getState().setHelpOpen(true)
    expect(useViewerStore.getState().helpOpen).toBe(true)
    useViewerStore.getState().setHelpOpen(false)
    expect(useViewerStore.getState().helpOpen).toBe(false)
  })

  it('is not cleared by setFile', () => {
    useViewerStore.getState().setHelpOpen(true)
    useViewerStore.getState().setFile('/m.stl', 'm.stl', '.stl', 1)
    expect(useViewerStore.getState().helpOpen).toBe(true)
  })
})
