import { describe, it, expect, beforeEach } from 'vitest'
import { thumbCacheGet, thumbCachePut, resetThumbCacheForTests } from './thumbCache'

// jsdom has no indexedDB — the cache must degrade to a silent no-op so the
// in-memory queue cache still drives thumbnails.

describe('thumbCache without IndexedDB', () => {
  beforeEach(() => {
    resetThumbCacheForTests()
  })

  it('get resolves undefined', async () => {
    await expect(thumbCacheGet('a:1:2')).resolves.toBeUndefined()
  })

  it('put resolves without throwing', async () => {
    await expect(thumbCachePut('a:1:2', 'data:image/png;base64,x')).resolves.toBeUndefined()
  })
})
