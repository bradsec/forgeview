import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import type { GridFile } from '../services/gridFiles'
import { getThumbnailQueue } from '../services/thumbnailService'
import type { ThumbnailQueue, ThumbStatus } from '../services/thumbnailService'

interface GridTileProps {
  file: GridFile
  /** Injectable for tests; defaults to the singleton queue. */
  queue?: ThumbnailQueue
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function GridTile({ file, queue }: GridTileProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<ThumbStatus>('pending')
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined)
  const requested = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    requested.current = false
    const q = queue ?? getThumbnailQueue()
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || requested.current) return
      requested.current = true
      q.request(file)
        .then((entry) => {
          setStatus(entry.status)
          setDataUrl(entry.dataUrl)
        })
        .catch(() => setStatus('error'))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [file, queue])

  const badge = file.extension.toUpperCase().replace('.', '')

  const onOpen = () => {
    useViewerStore.getState().setFile(file.path, file.name, file.extension, file.size)
  }

  const addToScene = () => {
    useViewerStore.getState().addModel({
      id: crypto.randomUUID(),
      path: file.path,
      name: file.name,
      extension: file.extension,
      sizeBytes: file.size,
      triangleCount: 0,
    })
  }

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      aria-label={`Open ${file.name}`}
      title={file.name}
      className="group relative flex flex-col rounded border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden text-left hover:border-[var(--accent)] transition-colors"
    >
      <div className="relative aspect-square bg-[var(--bg-app)] flex items-center justify-center">
        {status === 'ready' && dataUrl ? (
          <img src={dataUrl} alt={file.name} className="w-full h-full object-contain" />
        ) : status === 'error' ? (
          <div className="flex flex-col items-center gap-1 text-[var(--text-muted)]">
            <span className="bg-[var(--bg-button)] text-[10px] rounded font-mono px-1 py-0.5">{badge}</span>
            <span className="text-[10px]">preview unavailable</span>
          </div>
        ) : (
          <div className="w-2/3 h-2/3 rounded bg-[var(--bg-button)] animate-pulse" />
        )}

        <button
          type="button"
          aria-label={`Add ${file.name} to scene`}
          title="Add to scene"
          onClick={(e) => { e.stopPropagation(); addToScene() }}
          className="absolute top-1 right-1 w-5 h-5 hidden group-hover:flex items-center justify-center rounded bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--accent)] text-sm font-bold leading-none"
        >
          +
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="bg-[var(--bg-button)] text-[10px] rounded font-mono px-1 py-0.5 shrink-0">{badge}</span>
        <span className="truncate text-xs text-[var(--text-primary)] flex-1">{file.name}</span>
        <span className="text-[10px] text-[var(--text-muted)] shrink-0 font-mono tabular-nums">{formatBytes(file.size)}</span>
      </div>
    </div>
  )
}
