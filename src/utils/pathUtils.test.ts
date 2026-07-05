import { describe, it, expect } from 'vitest'
import { basename, dirname, extname } from './pathUtils'

describe('basename', () => {
  it('returns the final segment for unix paths', () => {
    expect(basename('/home/user/model.stl')).toBe('model.stl')
  })
  it('returns the final segment for windows paths', () => {
    expect(basename('C:\\Users\\me\\model.stl')).toBe('model.stl')
  })
  it('returns the input when there is no separator', () => {
    expect(basename('model.stl')).toBe('model.stl')
  })
})

describe('dirname', () => {
  it('returns the parent for unix paths', () => {
    expect(dirname('/home/user/model.stl')).toBe('/home/user')
  })
  it('returns the parent for windows paths', () => {
    expect(dirname('C:\\Users\\me\\model.stl')).toBe('C:\\Users\\me')
  })
  it('returns undefined when there is no separator', () => {
    expect(dirname('model.stl')).toBeUndefined()
  })
})

describe('extname', () => {
  it('returns the lowercased extension with dot', () => {
    expect(extname('/home/user/Model.STL')).toBe('.stl')
  })
  it('handles windows paths', () => {
    expect(extname('C:\\Users\\me\\part.OBJ')).toBe('.obj')
  })
  it('returns empty string when there is no extension', () => {
    expect(extname('/home/user/README')).toBe('')
  })
  it('treats a leading-dot dotfile as having no extension', () => {
    expect(extname('/home/user/.gitignore')).toBe('')
  })
  it('uses only the basename, not directory dots', () => {
    expect(extname('/home/my.dir/model')).toBe('')
  })
})
