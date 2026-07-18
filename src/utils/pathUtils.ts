/**
 * Cross-platform path helpers. File paths from Tauri use the native separator:
 * '/' on Unix, '\\' on Windows. These helpers handle both so the app works on
 * every target platform.
 */

/** Index of the last path separator ('/' or '\\'), or -1 if none. */
function lastSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
}

/** Return the final path segment (file or directory name). */
export function basename(path: string): string {
  const sep = lastSeparatorIndex(path)
  return sep >= 0 ? path.slice(sep + 1) : path
}

/** Return the parent directory, or undefined when the path has no separator. */
export function dirname(path: string): string | undefined {
  const sep = lastSeparatorIndex(path)
  return sep >= 0 ? path.slice(0, sep) : undefined
}

/**
 * Return the lowercased extension including the leading dot (e.g. ".stl"),
 * or "" when the basename has no extension. A leading-dot dotfile is treated
 * as having no extension.
 */
export function extname(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export interface Breadcrumb {
  name: string
  path: string
}

/**
 * Breadcrumb trail from a workspace root down to the current folder.
 * `current` must be `root` itself or a descendant; anything else collapses
 * to just the root crumb. Handles both '/' and '\\' separators.
 */
export function breadcrumbsFor(root: string, current: string): Breadcrumb[] {
  const trimmedRoot = root.replace(/[/\\]+$/, '')
  const rootCrumb: Breadcrumb = { name: basename(trimmedRoot) || trimmedRoot, path: trimmedRoot }
  if (current === trimmedRoot || current === root) return [rootCrumb]

  const sep = current.includes('\\') ? '\\' : '/'
  if (!current.startsWith(trimmedRoot + sep)) return [rootCrumb]

  const crumbs = [rootCrumb]
  let acc = trimmedRoot
  for (const segment of current.slice(trimmedRoot.length + 1).split(/[/\\]/)) {
    if (!segment) continue
    acc = acc + sep + segment
    crumbs.push({ name: segment, path: acc })
  }
  return crumbs
}
