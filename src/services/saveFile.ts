import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../utils/isTauri'

interface BrowserSaveHandle {
  name: string
  createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>
    close(): Promise<void>
  }>
}

type BrowserSavePicker = (options: {
  suggestedName: string
  types: Array<{ description: string; accept: Record<string, string[]> }>
}) => Promise<BrowserSaveHandle>

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

/**
 * Deliver exported bytes to the user.
 *
 * Tauri: one IPC call — the Rust side opens the native save dialog and
 * writes the bytes, so no filesystem path ever crosses from JS.
 * Browser: use the browser Save As picker when available, otherwise download
 * through an object URL.
 *
 * Returns the saved path (Tauri), the filename (browser), or null when the
 * user cancelled the save dialog.
 */
export async function saveExportedFile(bytes: Uint8Array, filename: string): Promise<string | null> {
  if (isTauri()) {
    // Header values must be ASCII-safe; Rust percent-decodes
    const encoded = encodeURIComponent(filename)
    const body = new Uint8Array(bytes) // ensure a tight, transferable copy
    const savedPath = await invoke<string | null>('export_model_file', body, {
      headers: { 'x-forgeview-filename': encoded },
    })
    return savedPath
  }

  const savePicker = (window as Window & { showSaveFilePicker?: BrowserSavePicker }).showSaveFilePicker
  if (savePicker) {
    const extensionIndex = filename.lastIndexOf('.')
    const extension = extensionIndex >= 0 ? filename.slice(extensionIndex).toLowerCase() : ''
    try {
      const handle = await savePicker.call(window, {
        suggestedName: filename,
        types: [{
          description: '3D model',
          accept: { 'application/octet-stream': extension ? [extension] : [] },
        }],
      })
      const writable = await handle.createWritable()
      await writable.write(new Uint8Array(bytes))
      await writable.close()
      return handle.name
    } catch (error) {
      if (isAbortError(error)) return null
      throw error
    }
  }

  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // Give the click a tick to start the download before revoking
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return filename
}
