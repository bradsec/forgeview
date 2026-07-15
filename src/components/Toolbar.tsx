import { useEffect, useId, useRef, useState } from 'react'
import { useViewerStore } from '../store/viewerStore'
import { useFileOpen } from '../hooks/useFileOpen'
import { useDirOpen } from '../hooks/useDirOpen'
import packageJson from '../../package.json'

type ViewMode = 'solid' | 'wireframe' | 'points'

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'solid', label: 'Solid' },
  { mode: 'wireframe', label: 'Wireframe' },
  { mode: 'points', label: 'Points' },
]

function Menu({
  label,
  children,
}: {
  label: string
  children: (close: (restoreFocus?: boolean) => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'))
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
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
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
        className="app-menu-trigger"
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => close()} aria-hidden="true" />
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            data-testid={`toolbar-${label.toLowerCase()}-menu`}
            onKeyDown={handleKeyDown}
            className="app-menu-popover"
          >
            {children(close)}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  selected,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  selected?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="app-menu-item"
    >
      <span>{children}</span>
      {selected && <span aria-hidden="true" className="menu-check">✓</span>}
    </button>
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
    <div className="toolbar-segment" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={value === option.value ? 'is-active' : ''}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Toolbar() {
  const [aboutOpen, setAboutOpen] = useState(false)
  const { openFile } = useFileOpen()
  const { openDir } = useDirOpen()
  const viewMode = useViewerStore((state) => state.viewMode)
  const dirPath = useViewerStore((state) => state.dirPath)
  const fileName = useViewerStore((state) => state.fileName)
  const mainView = useViewerStore((state) => state.mainView)
  const explorerVisible = useViewerStore((state) => state.explorerVisible)
  const sidebarVisible = useViewerStore((state) => state.sidebarVisible)
  const theme = useViewerStore((state) => state.theme)

  const openFolder = async () => {
    await openDir()
    useViewerStore.getState().setExplorerVisible(true)
  }

  const togglePanel = (panel: 'explorer' | 'details') => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      useViewerStore.getState().setMobileDrawer(panel)
      return
    }
    if (panel === 'explorer') useViewerStore.getState().setExplorerVisible(!explorerVisible)
    else useViewerStore.getState().setSidebarVisible(!sidebarVisible)
  }

  return (
    <header className="app-bar" data-testid="toolbar">
      <div className="brand-lockup" aria-label="Forgeview">
        <span className="brand-mark" aria-hidden="true">fv</span>
        <span className="brand-name">forgeview</span>
      </div>

      <nav className="app-menus" aria-label="Application menu">
        <Menu label="File">
          {(close) => (
            <>
              <MenuItem onClick={() => { close(); void openFile() }}>Open file</MenuItem>
              <MenuItem onClick={() => { close(); void openFolder() }}>Open folder</MenuItem>
            </>
          )}
        </Menu>
        <Menu label="View">
          {(close) => (
            <>
              {dirPath && (
                <>
                  <div className="menu-heading">Workspace</div>
                  <MenuItem onClick={() => { close(); useViewerStore.getState().setMainView('grid') }} selected={mainView === 'grid'}>Grid</MenuItem>
                  <MenuItem onClick={() => { close(); useViewerStore.getState().setMainView('3d') }} selected={mainView === '3d'}>3D view</MenuItem>
                  <div className="menu-separator" role="separator" />
                </>
              )}
              <div className="menu-heading">Display</div>
              {VIEW_MODES.map(({ mode, label }) => (
                <MenuItem key={mode} onClick={() => { close(); useViewerStore.getState().setViewMode(mode) }} selected={viewMode === mode}>{label}</MenuItem>
              ))}
              <div className="menu-separator" role="separator" />
              <MenuItem disabled={!dirPath} onClick={() => { close(); togglePanel('explorer') }} selected={Boolean(dirPath && explorerVisible)}>Explorer</MenuItem>
              <MenuItem onClick={() => { close(); togglePanel('details') }} selected={sidebarVisible}>Details</MenuItem>
              <div className="menu-separator" role="separator" />
              <MenuItem onClick={() => { close(); useViewerStore.getState().toggleTheme() }}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</MenuItem>
              <MenuItem onClick={() => { close(); useViewerStore.getState().setSettingsOpen(true) }}>Settings</MenuItem>
            </>
          )}
        </Menu>
        <Menu label="Help">
          {(close) => (
            <>
              <div className="menu-heading">File support</div>
              <div className="menu-note">STL, 3MF, OBJ, GLTF, GLB, PLY and DAE</div>
              <div className="menu-separator" role="separator" />
              <MenuItem onClick={() => { close(); setAboutOpen(true) }}>About Forgeview</MenuItem>
            </>
          )}
        </Menu>
      </nav>

      <div className="file-context" title={fileName ?? undefined}>
        {fileName ?? 'No model open'}
      </div>

      <div className="desktop-actions">
        {dirPath && (
          <SegmentedControl
            label="Workspace layout"
            value={mainView}
            options={[{ value: 'grid', label: 'Grid' }, { value: '3d', label: '3D' }]}
            onChange={(value) => useViewerStore.getState().setMainView(value)}
          />
        )}
        <SegmentedControl
          label="Model display"
          value={viewMode}
          options={VIEW_MODES.map(({ mode, label }) => ({ value: mode, label }))}
          onChange={(value) => useViewerStore.getState().setViewMode(value)}
        />
        <button
          type="button"
          aria-pressed={sidebarVisible}
          onClick={() => useViewerStore.getState().setSidebarVisible(!sidebarVisible)}
          className={`toolbar-action ${sidebarVisible ? 'is-active' : ''}`}
        >
          Details
        </button>
      </div>

      {aboutOpen && (
        <div
          className="about-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAboutOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setAboutOpen(false)
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="about-title" className="about-dialog">
            <div className="about-mark" aria-hidden="true">fv</div>
            <h2 id="about-title">Forgeview</h2>
            <p>Fast, local 3D model inspection for the browser and desktop.</p>
            <dl>
              <div><dt>Version</dt><dd>{packageJson.version}</dd></div>
              <div><dt>Formats</dt><dd>STL, 3MF, OBJ, GLTF, GLB, PLY, DAE</dd></div>
            </dl>
            <div className="about-links">
              <a href="https://github.com/bradsec/forgeview" target="_blank" rel="noreferrer">github.com/bradsec/forgeview</a>
              <p>Found Forgeview useful? Support the creator.</p>
              <a className="about-support-link" href="https://buymeacoffee.com/markbradley" target="_blank" rel="noreferrer">Buy me a coffee</a>
            </div>
            <button type="button" onClick={() => setAboutOpen(false)} autoFocus>Done</button>
          </section>
        </div>
      )}
    </header>
  )
}
