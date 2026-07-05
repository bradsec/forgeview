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
    expect(out.files.every((f) => f.size === 1024)).toBe(true)
    expect(out.files.every((f) => f.mtime === 1000)).toBe(true)
  })
})
