/**
 * In-memory virtual file system backing folder browsing in a plain browser,
 * where Tauri's fs plugin is unavailable. A folder picked via
 * <input webkitdirectory> yields a flat FileList whose webkitRelativePath
 * values ("root/sub/part.stl") become the virtual paths. All path-based
 * consumers (grid listing, directory tree, model loading) resolve those
 * paths here before falling back to Tauri IPC.
 */

const registry = new Map<string, File>()
let browserRoot: string | null = null

/** Root folder name of the registered browser folder, or null. */
export function getBrowserRoot(): string | null {
  return browserRoot
}

/** True when `path` is a file or directory inside the registered browser folder. */
export function isBrowserPath(path: string): boolean {
  if (browserRoot === null) return false
  return path === browserRoot || path.startsWith(browserRoot + '/')
}

/** The File registered under a virtual path, or undefined. */
export function getBrowserFile(path: string): File | undefined {
  return registry.get(path)
}

/**
 * Replace the registry with the given folder selection.
 * Returns the root folder name, or null when the list is empty.
 */
export function registerBrowserFolder(files: File[]): string | null {
  registry.clear()
  browserRoot = null
  for (const f of files) {
    const rel = f.webkitRelativePath
    if (!rel) continue
    registry.set(rel, f)
    if (browserRoot === null) browserRoot = rel.split('/')[0]
  }
  return browserRoot
}

/** Clear the registry (test helper). */
export function clearBrowserFolder(): void {
  registry.clear()
  browserRoot = null
}

export interface BrowserDirEntry {
  name: string
  path: string
  isDirectory: boolean
  /** File-only fields */
  size?: number
  mtime?: number
}

/**
 * List one level of a virtual directory: immediate subdirectories (derived
 * from deeper paths) and immediate files. No extension filtering — callers
 * filter against SUPPORTED_EXTENSIONS themselves.
 */
export function listBrowserDir(dir: string): BrowserDirEntry[] {
  const prefix = dir + '/'
  const dirs = new Set<string>()
  const entries: BrowserDirEntry[] = []

  for (const [path, file] of registry) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) {
      entries.push({
        name: rest,
        path,
        isDirectory: false,
        size: file.size,
        mtime: file.lastModified,
      })
    } else {
      dirs.add(rest.slice(0, slash))
    }
  }

  for (const name of dirs) {
    entries.push({ name, path: prefix + name, isDirectory: true })
  }

  return entries
}

/** All file entries under a virtual directory, recursively. */
export function listBrowserDirRecursive(dir: string): BrowserDirEntry[] {
  const prefix = dir + '/'
  const entries: BrowserDirEntry[] = []
  for (const [path, file] of registry) {
    if (!path.startsWith(prefix)) continue
    entries.push({
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      isDirectory: false,
      size: file.size,
      mtime: file.lastModified,
    })
  }
  return entries
}

/**
 * Open a browser folder picker via <input webkitdirectory>. Resolves with the
 * selected files, or null when the user cancels. Works in Chrome, Firefox,
 * Edge, and Safari — no File System Access API required.
 */
export function pickBrowserFolder(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.webkitdirectory = true
    input.onchange = () => resolve(input.files ? Array.from(input.files) : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
