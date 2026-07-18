import { open } from '@tauri-apps/plugin-dialog'
import { readDir, stat } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { SUPPORTED_EXTENSIONS } from '../loaders'
import { useViewerStore } from '../store/viewerStore'
import type { DirTreeEntry } from '../store/viewerStore'
import { dirname, extname } from '../utils/pathUtils'
import { isTauri } from '../utils/isTauri'
import { isBrowserPath, listBrowserDir, pickBrowserFolder, registerBrowserFolderSelection } from '../services/browserFs'

const METADATA_CONCURRENCY = 16

/** Tree entries (one level) served from the in-memory browser folder registry. */
function readBrowserDirTree(dirPath: string): DirTreeEntry[] {
  const results: DirTreeEntry[] = []
  for (const e of listBrowserDir(dirPath)) {
    if (e.isDirectory) {
      results.push({
        name: e.name,
        fullPath: e.path,
        isDirectory: true,
        isExpanded: false,
        isLoaded: false,
        children: [],
      })
    } else {
      const ext = extname(e.name)
      if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
        results.push({
          name: e.name,
          fullPath: e.path,
          isDirectory: false,
          extension: ext,
          sizeBytes: e.size!,
        })
      }
    }
  }
  results.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
  return results
}

/**
 * Read a directory and build tree entries (one level).
 * Directories are included, files are filtered to supported extensions.
 */
export async function readDirTree(dirPath: string): Promise<DirTreeEntry[]> {
  if (isBrowserPath(dirPath)) return readBrowserDirTree(dirPath)

  const entries = await readDir(dirPath)
  const results: DirTreeEntry[] = []
  const files: Array<{ name: string; fullPath: string; extension: string }> = []

  for (const entry of entries) {
    if (!entry.name) continue
    const fullPath = await join(dirPath, entry.name)
    if (entry.isDirectory) {
      results.push({
        name: entry.name,
        fullPath,
        isDirectory: true,
        isExpanded: false,
        isLoaded: false,
        children: [],
      })
    } else if (entry.isFile) {
      const extension = extname(entry.name)
      if (extension && SUPPORTED_EXTENSIONS.includes(extension)) {
        files.push({ name: entry.name, fullPath, extension })
      }
    }
  }

  for (let index = 0; index < files.length; index += METADATA_CONCURRENCY) {
    const batch = files.slice(index, index + METADATA_CONCURRENCY)
    const metadata = await Promise.all(
      batch.map(async (file): Promise<DirTreeEntry | null> => {
        try {
          const info = await stat(file.fullPath)
          return {
            name: file.name,
            fullPath: file.fullPath,
            isDirectory: false,
            extension: file.extension,
            sizeBytes: info.size,
          } satisfies DirTreeEntry
        } catch {
          return null
        }
      })
    )
    results.push(...metadata.filter((entry): entry is DirTreeEntry => entry !== null))
  }

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
  const applyDir = async (dirPath: string): Promise<void> => {
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
  }

  const openDir = async (): Promise<void> => {
    try {
      if (!isTauri()) {
        const picked = await pickBrowserFolder()
        if (picked === null) return
        const root = registerBrowserFolderSelection(picked)
        if (root === null) return
        await applyDir(root)
        return
      }

      const { dirPath: lastDir, filePath } = useViewerStore.getState()
      const defaultPath = lastDir ?? (filePath ? dirname(filePath) : undefined)
      // recursive: true adds the whole subtree to the fs scope so files in
      // nested folders (recursive grid, tree expansion) stay readable
      const dirPath = await open({ directory: true, recursive: true, defaultPath: defaultPath || undefined })
      if (dirPath === null) return

      await applyDir(dirPath)
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
