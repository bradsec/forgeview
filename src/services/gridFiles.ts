import { readDir, stat } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { SUPPORTED_EXTENSIONS } from '../loaders'
import { extname } from '../utils/pathUtils'

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
    await Promise.all(
      fileEntries.map(async ({ name, full, ext }) => {
        files.push(await toGridFile(name, full, ext))
      })
    )
  }

  await walk(dir, true)
  // Folders and files are each sorted alphabetically; the grid renders them as separate groups.
  folders.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { folders, files }
}
