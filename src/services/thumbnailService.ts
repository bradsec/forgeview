import type { GridFile } from './gridFiles'
import * as THREE from 'three'
import { loadModel, disposeModel } from '../loaders'

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

  // Returns the cached entry (ready or error), or undefined if not yet rendered.
  const get = (f: GridFile): ThumbEntry | undefined => cache.get(cacheKey(f))

  return { request, get }
}

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
