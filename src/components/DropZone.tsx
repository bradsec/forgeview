import { useEffect, useRef, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from '@tauri-apps/api/core'
import { SUPPORTED_EXTENSIONS } from '../loaders'
import { useViewerStore } from '../store/viewerStore'
import { useFileOpen } from '../hooks/useFileOpen'
import { extname } from '../utils/pathUtils'
import { isTauri } from '../utils/isTauri'
import { loadBrowserFile } from '../utils/browserFile'

interface FileMetadata {
  path: string
  filename: string
  extension: string
  size_bytes: number
  modified: string
}

/**
 * Full-viewport drop target shown when no file is loaded.
 * Listens for Tauri onDragDropEvent for drag-and-drop file loading.
 * Includes debounce guard for Tauri duplicate drop events (bug #14134).
 */
export function DropZone() {
  const [isDragging, setIsDragging] = useState(false)
  const processingRef = useRef(false)
  const { openFile } = useFileOpen()

  useEffect(() => {
    // Guard: Tauri APIs are only available inside the Tauri webview.
    // In a plain browser the HTML5 drop handlers below take over.
    if (!isTauri()) return

    let unlisten: (() => void) | undefined
    let disposed = false
    let processingTimer: ReturnType<typeof setTimeout> | undefined

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const type = event.payload.type

        if (type === 'enter') {
          setIsDragging(true)
        } else if (type === 'over') {
          // Still over the window — keep isDragging true
          setIsDragging(true)
        } else if (type === 'drop') {
          setIsDragging(false)

          // Debounce guard for Tauri duplicate drop events
          if (processingRef.current) return
          processingRef.current = true
          if (processingTimer) clearTimeout(processingTimer)
          processingTimer = setTimeout(() => {
            processingRef.current = false
          }, 200)

          const paths = event.payload.paths
          if (!paths || paths.length === 0) return

          const filePath = paths[0]
          const ext = extname(filePath)

          const store = useViewerStore.getState()

          if (!SUPPORTED_EXTENSIONS.includes(ext)) {
            store.setError(`Unsupported format: ${ext}`)
            return
          }

          try {
            const metadata: FileMetadata = await invoke('get_file_metadata', { path: filePath })
            store.setFile(metadata.path, metadata.filename, metadata.extension, metadata.size_bytes)
            store.addRecentFile(metadata.path)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            store.setError(message)
          }
        } else if (type === 'leave') {
          setIsDragging(false)
        }
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })

    return () => {
      disposed = true
      if (processingTimer) clearTimeout(processingTimer)
      unlisten?.()
    }
  }, [])

  // HTML5 drag-and-drop fallback for browser hosting (e.g. GitHub Pages);
  // inside Tauri the native onDragDropEvent above handles drops instead
  const browserDropProps = isTauri()
    ? {}
    : {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault()
          setIsDragging(true)
        },
        onDragLeave: () => setIsDragging(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault()
          setIsDragging(false)
          const file = e.dataTransfer.files?.[0]
          if (file) void loadBrowserFile(file)
        },
      }

  return (
    <div
      data-testid="dropzone"
      {...browserDropProps}
      className={[
        'model-canvas w-full h-full flex flex-col items-center justify-center select-none',
        isDragging ? 'ring-2 ring-[var(--accent)] ring-inset' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="empty-workspace">
        <div className="empty-mark" aria-hidden="true">3D</div>
        <h1>Open a model to start</h1>
        <p>Choose a file, drop it here, or open a folder to browse compatible models.</p>
        <button
          type="button"
          onClick={openFile}
          className="empty-primary-action"
        >
          Open file
        </button>
        <span>STL, 3MF, OBJ, GLTF, GLB, PLY, DAE</span>
      </div>
    </div>
  )
}
