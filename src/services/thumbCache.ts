/**
 * Persistent thumbnail cache backed by IndexedDB. Keys are
 * `path:mtime:size`, so an edited file naturally misses and re-renders.
 * Everything degrades to a no-op where IndexedDB is unavailable (jsdom,
 * private browsing with storage disabled) — the in-memory queue cache in
 * thumbnailService still works there.
 */

const DB_NAME = 'forgeview-thumbs'
const STORE = 'thumbs'
const DB_VERSION = 1
/** Prune to this many entries (oldest first) after each write. */
const MAX_ENTRIES = 500

interface ThumbRecord {
  key: string
  dataUrl: string
  at: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' })
          store.createIndex('at', 'at')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

export async function thumbCacheGet(key: string): Promise<string | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as ThumbRecord | undefined)?.dataUrl)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export async function thumbCachePut(key: string, dataUrl: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put({ key, dataUrl, at: Date.now() } satisfies ThumbRecord)
      const countReq = store.count()
      countReq.onsuccess = () => {
        let excess = countReq.result - MAX_ENTRIES
        if (excess <= 0) return
        const cursorReq = store.index('at').openCursor()
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result
          if (!cursor || excess <= 0) return
          cursor.delete()
          excess--
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Test helper — forget the cached connection so a fresh open occurs. */
export function resetThumbCacheForTests(): void {
  dbPromise = null
}
