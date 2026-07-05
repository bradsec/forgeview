import { open } from '@tauri-apps/plugin-dialog'
import { stat } from '@tauri-apps/plugin-fs'
import { SUPPORTED_EXTENSIONS } from '../loaders'
import { useViewerStore } from '../store/viewerStore'
import { basename, dirname, extname } from '../utils/pathUtils'
import { isTauri } from '../utils/isTauri'
import { loadBrowserFile, pickBrowserFile } from '../utils/browserFile'

/**
 * Hook providing an openFile function that triggers the native file dialog,
 * remembering the last directory, reads file metadata, and updates the store.
 * In a plain browser it falls back to an <input type=file> picker.
 */
export function useFileOpen() {
  const openFile = async (): Promise<void> => {
    if (!isTauri()) {
      const file = await pickBrowserFile()
      if (file) await loadBrowserFile(file)
      return
    }
    try {
      // Derive default path from last opened file or directory
      const { filePath, dirPath } = useViewerStore.getState()
      const defaultPath = filePath
        ? dirname(filePath)
        : dirPath ?? undefined

      const result = await open({
        defaultPath: defaultPath || undefined,
        filters: [
          {
            name: '3D Files',
            extensions: SUPPORTED_EXTENSIONS.flatMap((e) => {
              const ext = e.replace('.', '')
              return [ext, ext.toUpperCase()]
            }),
          },
        ],
      })

      // User cancelled dialog
      if (result === null) return

      const path = result as string
      const filename = basename(path)
      const ext = extname(path)
      const info = await stat(path)

      const store = useViewerStore.getState()
      store.setFile(path, filename, ext, info.size)
      store.addRecentFile(path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useViewerStore.getState().setError(message)
    }
  }

  return { openFile }
}
