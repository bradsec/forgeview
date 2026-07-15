import { readDir, stat } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { SUPPORTED_EXTENSIONS } from '../loaders'
import { extname } from '../utils/pathUtils'
import { isBrowserPath, listBrowserDir, listBrowserDirRecursive } from './browserFs'

const METADATA_CONCURRENCY = 16

export interface GridFile {
  name: string
  path: string
  extension: string
  size: number
  mtime: number
}

export interface GridFolder {
  name: string
  path: string
}

export interface GridListing {
  folders: GridFolder[]
  files: GridFile[]
}

async function toGridFile(name: string, path: string, extension: string): Promise<GridFile> {
  const info = await stat(path)
  return {
    name,
    path,
    extension,
    size: info.size,
    mtime: info.mtime ? info.mtime.getTime() : 0,
  }
}

/**
 * Resolve a folder into grid entries. Current mode returns one level with
 * subfolder tiles; recursive mode walks all descendants and returns files only.
 */
export async function listGridFiles(dir: string, recursive: boolean): Promise<GridListing> {
  if (isBrowserPath(dir)) return listBrowserGridFiles(dir, recursive)

  const folders: GridFolder[] = []
  const files: GridFile[] = []

  const walk = async (d: string, topLevel: boolean): Promise<void> => {
    const entries = await readDir(d)
    const fileEntries: Array<{ name: string; full: string; ext: string }> = []
    for (const e of entries) {
      if (!e.name) continue
      const full = await join(d, e.name)
      if (e.isDirectory) {
        if (recursive) {
          await walk(full, false)
        } else if (topLevel) {
          folders.push({ name: e.name, path: full })
        }
      } else if (e.isFile) {
        const ext = extname(e.name)
        if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
          fileEntries.push({ name: e.name, full, ext })
        }
      }
    }
    for (let index = 0; index < fileEntries.length; index += METADATA_CONCURRENCY) {
      const batch = fileEntries.slice(index, index + METADATA_CONCURRENCY)
      const metadata = await Promise.all(
        batch.map(async ({ name, full, ext }) => {
          try {
            return await toGridFile(name, full, ext)
          } catch {
            return null
          }
        })
      )
      files.push(...metadata.filter((file): file is GridFile => file !== null))
    }
  }

  await walk(dir, true)
  // Folders and files are each sorted alphabetically; the grid renders them as separate groups.
  folders.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { folders, files }
}

/** Grid listing served from the in-memory browser folder registry. */
function listBrowserGridFiles(dir: string, recursive: boolean): GridListing {
  const folders: GridFolder[] = []
  const files: GridFile[] = []

  const entries = recursive ? listBrowserDirRecursive(dir) : listBrowserDir(dir)
  for (const e of entries) {
    if (e.isDirectory) {
      folders.push({ name: e.name, path: e.path })
      continue
    }
    const ext = extname(e.name)
    if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
      files.push({ name: e.name, path: e.path, extension: ext, size: e.size!, mtime: e.mtime! })
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { folders, files }
}
