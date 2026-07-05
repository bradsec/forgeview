import { useState, useEffect } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { useFileOpen } from '../hooks/useFileOpen'
import { useDirOpen } from '../hooks/useDirOpen'
import { isTauri } from '../utils/isTauri'

type ViewMode = 'solid' | 'wireframe' | 'points'

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'solid', label: 'Solid' },
  { mode: 'wireframe', label: 'Wireframe' },
  { mode: 'points', label: 'Points' },
]

/**
 * Top toolbar with app title, file open button, and view mode toggles.
 */
export function Toolbar() {
  const viewMode = useViewerStore((s) => s.viewMode)
  const dirPath = useViewerStore((s) => s.dirPath)
  const mainView = useViewerStore((s) => s.mainView)
  const explorerVisible = useViewerStore((s) => s.explorerVisible)
  const sidebarVisible = useViewerStore((s) => s.sidebarVisible)
  const theme = useViewerStore((s) => s.theme)
  const { openFile } = useFileOpen()
  const { openDir } = useDirOpen()

  const setMobileDrawer = useViewerStore((s) => s.setMobileDrawer)
  const mobileDrawer = useViewerStore((s) => s.mobileDrawer)

  const [menuOpen, setMenuOpen] = useState(false)
  // Folder browsing needs native fs access — hidden when hosted in a browser
  const canOpenFolder = isTauri()

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  useEffect(() => {
    if (mobileDrawer !== 'none') setMenuOpen(false)
  }, [mobileDrawer])

  const handleOpenDir = async () => {
    await openDir()
    useViewerStore.getState().setExplorerVisible(true)
  }

  return (
    <header className="h-12 bg-[var(--bg-toolbar)] border-b border-[var(--border)] flex items-center px-4 gap-3 shrink-0">
      {/* Mobile row */}
      <div data-testid="toolbar-mobile" className="flex md:hidden items-center gap-2 w-full">
        <button
          type="button"
          onClick={() => setMobileDrawer(mobileDrawer === 'explorer' ? 'none' : 'explorer')}
          aria-label="Toggle Explorer"
          title="Explorer"
          className="min-h-10 px-2 text-[var(--text-primary)] hover:text-[var(--text-bright)]"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
          </svg>
        </button>

        <span className="font-semibold text-[var(--text-bright)]">Forge View</span>

        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="More actions"
              title="More actions"
              className="min-h-10 px-3 text-lg leading-none text-[var(--text-primary)] hover:text-[var(--text-bright)]"
            >
              &#8943;
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                <div
                  data-testid="toolbar-menu"
                  className="absolute right-0 top-full mt-1 z-50 min-w-44 rounded border border-[var(--border)] bg-[var(--bg-dialog)] py-1 shadow-[0_10px_40px_var(--shadow-color)]"
                >
                  <button type="button" onClick={() => { setMenuOpen(false); openFile() }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Open</button>
                  {canOpenFolder && (
                    <button type="button" onClick={() => { setMenuOpen(false); handleOpenDir() }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Open Folder</button>
                  )}
                  <div className="my-1 border-t border-[var(--border)]" />
                  {VIEW_MODES.map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => { setMenuOpen(false); useViewerStore.getState().setViewMode(mode) }}
                      className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
                    >
                      {label}
                    </button>
                  ))}
                  {dirPath && (
                    <>
                      <div className="my-1 border-t border-[var(--border)]" />
                      <button type="button" onClick={() => { setMenuOpen(false); useViewerStore.getState().setMainView('grid') }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Grid</button>
                      <button type="button" onClick={() => { setMenuOpen(false); useViewerStore.getState().setMainView('3d') }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">3D</button>
                    </>
                  )}
                  <div className="my-1 border-t border-[var(--border)]" />
                  <button type="button" onClick={() => { setMenuOpen(false); useViewerStore.getState().toggleTheme() }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
                  <button type="button" onClick={() => { setMenuOpen(false); useViewerStore.getState().setSettingsOpen(true) }} className="block w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">Settings</button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileDrawer(mobileDrawer === 'details' ? 'none' : 'details')}
            aria-label="Toggle Details"
            title="Details"
            className="min-h-10 px-3 text-sm rounded bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Details
          </button>
        </div>
      </div>

      {/* Desktop row */}
      <div data-testid="toolbar-desktop" className="hidden md:flex md:items-center md:gap-3 md:w-full">
        {/* Left side */}
        <span className="font-semibold text-[var(--text-bright)] mr-2">Forge View</span>

      <button
        type="button"
        onClick={openFile}
        className="px-3 py-1.5 bg-[var(--accent-button)] hover:bg-[var(--accent-button-hover)] text-white text-sm rounded transition-colors"
      >
        Open
      </button>

      {canOpenFolder && (
        <button
          type="button"
          onClick={handleOpenDir}
          className="px-3 py-1.5 bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-white text-sm rounded transition-colors"
        >
          Open Folder
        </button>
      )}

      {/* Toggle explorer visibility when a folder is loaded but panel is hidden */}
      {dirPath && !explorerVisible && (
        <button
          type="button"
          onClick={() => useViewerStore.getState().setExplorerVisible(true)}
          className="px-3 py-1.5 bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-[var(--text-muted)] hover:text-[var(--text-bright)] text-sm rounded transition-colors"
          title="Show Explorer"
        >
          Explorer
        </button>
      )}

      {dirPath && (
        <div className="flex rounded overflow-hidden border border-[var(--border-input)]">
          {(['grid', '3d'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => useViewerStore.getState().setMainView(v)}
              className={[
                'px-3 py-1.5 text-sm transition-colors',
                mainView === v
                  ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
                  : 'bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              ].join(' ')}
              title={v === 'grid' ? 'Show preview grid' : 'Show 3D view'}
            >
              {v === 'grid' ? 'Grid' : '3D'}
            </button>
          ))}
        </div>
      )}

      {/* Right side — view mode toggles + panel toggles */}
      <div className="ml-auto flex items-center gap-1">
        {VIEW_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            onClick={() => useViewerStore.getState().setViewMode(mode)}
            className={[
              'px-3 py-1.5 text-sm rounded transition-colors',
              viewMode === mode
                ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
                : 'bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            ].join(' ')}
          >
            {label}
          </button>
        ))}

        {/* Theme toggle */}
        <button
          type="button"
          onClick={() => useViewerStore.getState().toggleTheme()}
          className="px-2 py-1.5 text-sm rounded transition-colors bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
          title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a.5.5 0 01.5.5v2a.5.5 0 01-1 0v-2A.5.5 0 018 1zm0 10a3 3 0 100-6 3 3 0 000 6zm0 1a4 4 0 110-8 4 4 0 010 8zm6.5-3.5a.5.5 0 010 1h-2a.5.5 0 010-1h2zM8 13a.5.5 0 01.5.5v2a.5.5 0 01-1 0v-2A.5.5 0 018 13zM3.5 8.5a.5.5 0 010-1h-2a.5.5 0 010 1h2zm10.657-5.157a.5.5 0 010 .707l-1.414 1.414a.5.5 0 11-.707-.707l1.414-1.414a.5.5 0 01.707 0zm-9.193 9.193a.5.5 0 010 .707L3.55 14.657a.5.5 0 01-.707-.707l1.414-1.414a.5.5 0 01.707 0zm9.193 2.121a.5.5 0 01-.707 0l-1.414-1.414a.5.5 0 01.707-.707l1.414 1.414a.5.5 0 010 .707zM4.464 4.465a.5.5 0 01-.707 0L2.343 3.05a.5.5 0 11.707-.707l1.414 1.414a.5.5 0 010 .708z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 .278a.77.77 0 01.08.858 7.2 7.2 0 00-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.79.79 0 01.81.316.73.73 0 01-.031.893A8.35 8.35 0 018.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 016 .278z"/>
            </svg>
          )}
        </button>

        {/* Settings gear */}
        <button
          type="button"
          onClick={() => useViewerStore.getState().setSettingsOpen(true)}
          className="px-2 py-1.5 text-sm rounded transition-colors bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-2"
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/>
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.902 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291a1.873 1.873 0 00-1.116-2.693l-.318-.094c-.835-.246-.835-1.428 0-1.674l.319-.094a1.873 1.873 0 001.115-2.692l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.116l.094-.318z"/>
          </svg>
        </button>

        {/* Toggle sidebar visibility */}
        <button
          type="button"
          onClick={() => {
            const current = useViewerStore.getState().sidebarVisible
            useViewerStore.getState().setSidebarVisible(!current)
          }}
          className={[
            'px-3 py-1.5 text-sm rounded transition-colors ml-2',
            sidebarVisible
              ? 'bg-[var(--bg-button-active)] text-[var(--text-bright)]'
              : 'bg-[var(--bg-button)] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
          ].join(' ')}
          title={sidebarVisible ? 'Hide Details' : 'Show Details'}
        >
          Details
        </button>
      </div>
      </div>
    </header>
  )
}
