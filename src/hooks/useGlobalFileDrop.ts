import { useEffect, useRef } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from '@tauri-apps/api/core'
import { SUPPORTED_EXTENSIONS } from '../loaders'
import { useViewerStore } from '../store/viewerStore'
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
 * App-level drag-and-drop file loading. Registered once in App so dropping a
 * model works at any time — including when a model is already open (the old
 * DropZone-scoped listener died as soon as the empty state unmounted).
 *
 * Tauri: native onDragDropEvent with a debounce guard for duplicate drop
 * events (Tauri bug #14134). Browser: window-level HTML5 drag events.
 * Both paths mirror drag state into the store (isDragOver) for UI highlight.
 */
export function useGlobalFileDrop(): void {
  const processingRef = useRef(false)

  useEffect(() => {
    const setDragOver = (v: boolean) => useViewerStore.getState().setDragOver(v)

    if (isTauri()) {
      let unlisten: (() => void) | undefined
      let disposed = false
      let processingTimer: ReturnType<typeof setTimeout> | undefined

      getCurrentWebview()
        .onDragDropEvent(async (event) => {
          const type = event.payload.type

          if (type === 'enter' || type === 'over') {
            setDragOver(true)
          } else if (type === 'drop') {
            setDragOver(false)

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
            setDragOver(false)
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
    }

    // Browser mode — window-level so drops land anywhere in the app
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      // relatedTarget is unset when the pointer leaves the window; moving
      // between elements inside the window keeps the highlight on
      if (!e.relatedTarget) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) void loadBrowserFile(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
}
