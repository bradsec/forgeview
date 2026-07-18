import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../utils/isTauri'

/**
 * Deliver exported bytes to the user.
 *
 * Tauri: one IPC call — the Rust side opens the native save dialog and
 * writes the bytes, so no filesystem path ever crosses from JS.
 * Browser: a plain download via an object URL — no popups.
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
