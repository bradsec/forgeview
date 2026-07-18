import { useEffect, useRef, useState } from 'react'

type Resolver = (proceed: boolean) => void

let openNotice: ((resolve: Resolver) => void) | null = null

/**
 * Ask the user to proceed before triggering the webkitdirectory fallback
 * picker. Browsers without showDirectoryPicker (Firefox, Safari) present
 * that picker with an alarming "upload" confirmation; this in-app dialog
 * explains beforehand that files never leave the device. Resolves false
 * when the user cancels.
 */
export function confirmFolderFallback(): Promise<boolean> {
  if (!openNotice) return Promise.resolve(true)
  return new Promise((resolve) => openNotice!(resolve))
}

export function FolderAccessNotice() {
  const [resolver, setResolver] = useState<Resolver | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    openNotice = (resolve) => setResolver(() => resolve)
    return () => {
      openNotice = null
    }
  }, [])

  useEffect(() => {
    if (!resolver) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    continueRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [resolver])

  if (!resolver) return null

  const finish = (proceed: boolean) => {
    resolver(proceed)
    setResolver(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-[var(--scrim)] z-40" onClick={() => finish(false)} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="folder-notice-title"
          onKeyDown={handleKeyDown}
          className="bg-[var(--bg-dialog)] border border-[var(--border)] rounded shadow-[0_10px_40px_var(--shadow-color)] w-full max-w-sm"
        >
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 id="folder-notice-title" className="text-base font-semibold text-[var(--text-bright)]">
              Open a local folder
            </h2>
          </div>
          <div className="px-5 py-4 flex flex-col gap-2 text-sm text-[var(--text-primary)]">
            <p>
              Your browser may describe the next step as an upload. Forgeview only reads the folder
              locally to show your models — nothing leaves your device.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Re-pick the folder any time to refresh its contents.
            </p>
          </div>
          <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
            <button
              type="button"
              onClick={() => finish(false)}
              className="px-4 py-1.5 text-sm rounded bg-[var(--bg-button)] text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              ref={continueRef}
              type="button"
              onClick={() => finish(true)}
              className="px-4 py-1.5 bg-[var(--accent-button)] hover:bg-[var(--accent-button-hover)] text-[var(--text-on-accent)] text-sm rounded transition-colors"
            >
              Choose folder
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
