import { useEffect, useId, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { useFileOpen } from '../hooks/useFileOpen'
import { useDirOpen } from '../hooks/useDirOpen'

type ViewMode = 'solid' | 'wireframe' | 'points'

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'solid', label: 'Solid' },
  { mode: 'wireframe', label: 'Wireframe' },
  { mode: 'points', label: 'Points' },
]

function FileMenu({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const { openFile } = useFileOpen()
  const { openDir } = useDirOpen()
  const dirPath = useViewerStore((state) => state.dirPath)
  const theme = useViewerStore((state) => state.theme)

  useEffect(() => {
    if (open) firstItemRef.current?.focus()
  }, [open])

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const openFolder = async () => {
    close()
    await openDir()
    useViewerStore.getState().setExplorerVisible(true)
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="h-8 px-3 rounded text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
      >
        {compact ? 'More' : 'File'} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => close()} aria-hidden="true" />
          <div
            id={menuId}
            role="menu"
            data-testid="toolbar-menu"
            onKeyDown={handleMenuKeyDown}
            className="absolute left-0 top-full mt-1 z-50 min-w-48 rounded border border-[var(--border)] bg-[var(--bg-dialog)] py-1 shadow-[0_10px_40px_var(--shadow-color)]"
          >
            <button
              ref={firstItemRef}
              type="button"
              role="menuitem"
              onClick={() => { close(); void openFile() }}
              className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
            >
              Open
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void openFolder()}
              className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
            >
              Open Folder
            </button>
            {compact && (
              <>
                <div role="separator" className="my-1 border-t border-[var(--border)]" />
                {VIEW_MODES.map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    role="menuitem"
                    onClick={() => { close(); useViewerStore.getState().setViewMode(mode) }}
                    className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
                  >
                    {label}
                  </button>
                ))}
                {dirPath && (
                  <>
                    <div role="separator" className="my-1 border-t border-[var(--border)]" />
                    <button type="button" role="menuitem" onClick={() => { close(); useViewerStore.getState().setMainView('grid') }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Grid</button>
                    <button type="button" role="menuitem" onClick={() => { close(); useViewerStore.getState().setMainView('3d') }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">3D</button>
                  </>
                )}
                <div role="separator" className="my-1 border-t border-[var(--border)]" />
                <button type="button" role="menuitem" onClick={() => { close(); useViewerStore.getState().toggleTheme() }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
                <button type="button" role="menuitem" onClick={() => { close(); useViewerStore.getState().setSettingsOpen(true) }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Settings</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-label)]">{label}</span>
      <div className="flex rounded overflow-hidden border border-[var(--border-input)]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={[
              'h-8 px-3 text-xs transition-colors',
              value === option.value
                ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
                : 'bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Toolbar() {
  const viewMode = useViewerStore((state) => state.viewMode)
  const dirPath = useViewerStore((state) => state.dirPath)
  const fileName = useViewerStore((state) => state.fileName)
  const mainView = useViewerStore((state) => state.mainView)
  const explorerVisible = useViewerStore((state) => state.explorerVisible)
  const sidebarVisible = useViewerStore((state) => state.sidebarVisible)
  const theme = useViewerStore((state) => state.theme)
  const mobileDrawer = useViewerStore((state) => state.mobileDrawer)

  return (
    <header className="shrink-0 bg-[var(--bg-toolbar)] border-b border-[var(--border)]">
      <div data-testid="toolbar-mobile" className="h-12 flex md:hidden items-center gap-2 px-2">
        <button
          type="button"
          onClick={() => useViewerStore.getState().setMobileDrawer(mobileDrawer === 'explorer' ? 'none' : 'explorer')}
          aria-label="Toggle Explorer"
          aria-expanded={mobileDrawer === 'explorer'}
          aria-controls="mobile-explorer-drawer"
          className="min-w-10 min-h-10 px-2 text-[var(--text-primary)] hover:text-[var(--text-bright)]"
        >
          Explorer
        </button>
        <span className="font-semibold text-[var(--text-bright)]">Forge View</span>
        <div className="ml-auto flex items-center gap-1">
          <FileMenu compact />
          <button
            type="button"
            onClick={() => useViewerStore.getState().setMobileDrawer(mobileDrawer === 'details' ? 'none' : 'details')}
            aria-expanded={mobileDrawer === 'details'}
            aria-controls="mobile-details-drawer"
            className="min-h-10 px-3 text-sm rounded bg-[var(--bg-button)] text-[var(--text-primary)]"
          >
            Details
          </button>
        </div>
      </div>

      <div data-testid="toolbar-desktop" className="hidden md:flex h-10 items-center gap-2 px-3 border-b border-[var(--border)]">
        <span className="font-semibold text-[var(--text-bright)] pr-2">Forge View</span>
        <FileMenu />
        {dirPath && (
          <button
            type="button"
            aria-pressed={explorerVisible}
            onClick={() => useViewerStore.getState().setExplorerVisible(!explorerVisible)}
            className="h-8 px-3 rounded text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
          >
            Explorer
          </button>
        )}
        <span className="ml-2 min-w-0 truncate text-xs text-[var(--text-muted)]" title={fileName ?? undefined}>
          {fileName ?? 'No file loaded'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => useViewerStore.getState().toggleTheme()}
            aria-label={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            className="h-8 px-3 rounded text-xs text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button
            type="button"
            onClick={() => useViewerStore.getState().setSettingsOpen(true)}
            className="h-8 px-3 rounded text-xs text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
          >
            Settings
          </button>
          <button
            type="button"
            aria-pressed={sidebarVisible}
            onClick={() => useViewerStore.getState().setSidebarVisible(!sidebarVisible)}
            className={[
              'h-8 px-3 rounded text-xs',
              sidebarVisible
                ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]',
            ].join(' ')}
          >
            Details
          </button>
        </div>
      </div>

      <div className="hidden md:flex h-12 items-center gap-5 px-3">
        <span className="h-8 px-3 flex items-center border-b-2 border-[var(--accent)] text-sm font-semibold text-[var(--text-bright)]">
          View
        </span>
        {dirPath && (
          <SegmentedControl
            label="Layout"
            value={mainView}
            options={[{ value: 'grid', label: 'Grid' }, { value: '3d', label: '3D' }]}
            onChange={(value) => useViewerStore.getState().setMainView(value)}
          />
        )}
        <SegmentedControl
          label="Display"
          value={viewMode}
          options={VIEW_MODES.map(({ mode, label }) => ({ value: mode, label }))}
          onChange={(value) => useViewerStore.getState().setViewMode(value)}
        />
      </div>
    </header>
  )
}
