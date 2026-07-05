import { open } from '@tauri-apps/plugin-dialog'
import { readDir, stat } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { SUPPORTED_EXTENSIONS } from '../loaders'
import { useViewerStore } from '../store/viewerStore'
import type { DirTreeEntry } from '../store/viewerStore'
import { dirname, extname } from '../utils/pathUtils'

/**
 * Read a directory and build tree entries (one level).
 * Directories are included, files are filtered to supported extensions.
 */
export async function readDirTree(dirPath: string): Promise<DirTreeEntry[]> {
  const entries = await readDir(dirPath)
  const results: DirTreeEntry[] = []

  await Promise.all(
    entries.map(async (e) => {
      if (!e.name) return
      const fullPath = await join(dirPath, e.name)

      if (e.isDirectory) {
        results.push({
          name: e.name,
          fullPath,
          isDirectory: true,
          isExpanded: false,
          isLoaded: false,
          children: [],
        })
      } else if (e.isFile) {
        const ext = extname(e.name)
        if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
          const info = await stat(fullPath)
          results.push({
            name: e.name,
            fullPath,
            isDirectory: false,
            extension: ext,
            sizeBytes: info.size,
          })
        }
      }
    })
  )

  // Sort: directories first, then alphabetical
  results.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })

  return results
}

/**
 * Hook providing openDir (folder picker) and expandDir (lazy load sub-directory).
 */
export function useDirOpen() {
  const openDir = async (): Promise<void> => {
    try {
      const { dirPath: lastDir, filePath } = useViewerStore.getState()
      const defaultPath = lastDir ?? (filePath ? dirname(filePath) : undefined)
      // recursive: true adds the whole subtree to the fs scope so files in
      // nested folders (recursive grid, tree expansion) stay readable
      const dirPath = await open({ directory: true, recursive: true, defaultPath: defaultPath || undefined })
      if (dirPath === null) return

      const tree = await readDirTree(dirPath)
      useViewerStore.getState().setDirTree(dirPath, tree)

      // Also populate flat dirFiles for compatibility
      const files = tree
        .filter((e) => !e.isDirectory)
        .map((e) => ({
          name: e.name,
          fullPath: e.fullPath,
          extension: e.extension!,
          sizeBytes: e.sizeBytes!,
        }))
      useViewerStore.getState().setDir(dirPath, files)
      useViewerStore.getState().setGridFolder(dirPath)
      useViewerStore.getState().setMainView('grid')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useViewerStore.getState().setError(message)
    }
  }

  const expandDir = async (fullPath: string): Promise<void> => {
    try {
      const children = await readDirTree(fullPath)
      useViewerStore.getState().updateTreeNode(fullPath, {
        children,
        isExpanded: true,
        isLoaded: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useViewerStore.getState().setError(message)
    }
  }

  const collapseDir = (fullPath: string): void => {
    useViewerStore.getState().updateTreeNode(fullPath, { isExpanded: false })
  }

  return { openDir, expandDir, collapseDir }
}
