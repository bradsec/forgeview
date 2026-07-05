import { SUPPORTED_EXTENSIONS } from '../loaders'
import { useViewerStore } from '../store/viewerStore'
import { extname } from './pathUtils'

/**
 * Load a browser File (from drag-and-drop or an <input type=file>) into the
 * viewer store. Validates the extension and reads the bytes in memory —
 * no Tauri backend required.
 */
export async function loadBrowserFile(file: File): Promise<void> {
  const store = useViewerStore.getState()
  const ext = extname(file.name)

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    store.setError(`Unsupported format: ${ext || file.name}`)
    return
  }

  try {
    const buffer = await file.arrayBuffer()
    store.setFileFromBuffer(file.name, ext, file.size, buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    store.setError(message)
  }
}

/** Open a native browser file picker for supported 3D formats. */
export function pickBrowserFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = SUPPORTED_EXTENSIONS.join(',')
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
