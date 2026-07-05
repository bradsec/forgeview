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

  it('caches an errored file and does not re-render it', async () => {
    const render = vi.fn(async () => { throw new Error('fail') })
    const q = createThumbnailQueue({ render })
    await q.request(file('/bad.stl'))
    const second = await q.request(file('/bad.stl'))
    expect(second.status).toBe('error')
    expect(render).toHaveBeenCalledTimes(1)
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
