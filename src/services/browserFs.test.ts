import { describe, it, expect, beforeEach, vi } from 'vitest'

// readDirTree lives in useDirOpen, which imports Tauri APIs — mock them so
// the module loads outside a Tauri webview
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readDir: vi.fn(), stat: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import {
  registerBrowserFolder,
  clearBrowserFolder,
  isBrowserPath,
  getBrowserFile,
  listBrowserDir,
  listBrowserDirRecursive,
} from './browserFs'
import { listGridFiles } from './gridFiles'
import { readDirTree } from '../hooks/useDirOpen'

/** Minimal stand-in for a File picked via <input webkitdirectory>. */
function fakeFile(relPath: string, size = 100, lastModified = 1000): File {
  return {
    name: relPath.slice(relPath.lastIndexOf('/') + 1),
    size,
    lastModified,
    webkitRelativePath: relPath,
  } as unknown as File
}

beforeEach(() => {
  clearBrowserFolder()
})

describe('registerBrowserFolder', () => {
  it('returns the root folder name and registers files by relative path', () => {
    const root = registerBrowserFolder([
      fakeFile('models/cube.stl'),
      fakeFile('models/sub/gear.obj'),
    ])
    expect(root).toBe('models')
    expect(getBrowserFile('models/cube.stl')).toBeDefined()
    expect(isBrowserPath('models')).toBe(true)
    expect(isBrowserPath('models/sub')).toBe(true)
    expect(isBrowserPath('modelsother')).toBe(false)
    expect(isBrowserPath('/native/path')).toBe(false)
  })

  it('returns null for an empty selection', () => {
    expect(registerBrowserFolder([])).toBeNull()
    expect(isBrowserPath('anything')).toBe(false)
  })
})

describe('listBrowserDir', () => {
  it('returns one level: immediate files plus derived subdirectories', () => {
    registerBrowserFolder([
      fakeFile('models/cube.stl', 5, 42),
      fakeFile('models/notes.txt'),
      fakeFile('models/sub/gear.obj'),
      fakeFile('models/sub/deep/part.ply'),
    ])
    const entries = listBrowserDir('models')
    const files = entries.filter((e) => !e.isDirectory).map((e) => e.name).sort()
    const dirs = entries.filter((e) => e.isDirectory).map((e) => e.name)
    expect(files).toEqual(['cube.stl', 'notes.txt'])
    expect(dirs).toEqual(['sub'])
    const cube = entries.find((e) => e.name === 'cube.stl')!
    expect(cube.path).toBe('models/cube.stl')
    expect(cube.size).toBe(5)
    expect(cube.mtime).toBe(42)
  })
})

describe('listBrowserDirRecursive', () => {
  it('flattens all files under the directory', () => {
    registerBrowserFolder([
      fakeFile('models/cube.stl'),
      fakeFile('models/sub/gear.obj'),
      fakeFile('models/sub/deep/part.ply'),
    ])
    const names = listBrowserDirRecursive('models').map((e) => e.name).sort()
    expect(names).toEqual(['cube.stl', 'gear.obj', 'part.ply'])
  })
})

describe('listGridFiles (browser registry)', () => {
  it('serves current-folder listing with extension filtering and folder tiles', async () => {
    registerBrowserFolder([
      fakeFile('models/cube.stl', 5, 42),
      fakeFile('models/notes.txt'),
      fakeFile('models/sub/gear.obj'),
    ])
    const out = await listGridFiles('models', false)
    expect(out.folders.map((f) => f.name)).toEqual(['sub'])
    expect(out.files.map((f) => f.name)).toEqual(['cube.stl'])
    expect(out.files[0]).toMatchObject({ path: 'models/cube.stl', extension: '.stl', size: 5, mtime: 42 })
  })

  it('serves recursive listing without folder tiles', async () => {
    registerBrowserFolder([
      fakeFile('models/cube.stl'),
      fakeFile('models/sub/gear.obj'),
      fakeFile('models/sub/skip.txt'),
    ])
    const out = await listGridFiles('models', true)
    expect(out.folders).toEqual([])
    expect(out.files.map((f) => f.name).sort()).toEqual(['cube.stl', 'gear.obj'])
  })
})

describe('readDirTree (browser registry)', () => {
  it('builds one tree level, directories first, files filtered to supported', async () => {
    registerBrowserFolder([
      fakeFile('models/cube.stl', 7),
      fakeFile('models/readme.md'),
      fakeFile('models/sub/gear.obj'),
    ])
    const tree = await readDirTree('models')
    expect(tree.map((e) => e.name)).toEqual(['sub', 'cube.stl'])
    expect(tree[0]).toMatchObject({ isDirectory: true, fullPath: 'models/sub', isExpanded: false, isLoaded: false })
    expect(tree[1]).toMatchObject({ isDirectory: false, extension: '.stl', sizeBytes: 7 })
  })
})
