import { useRef, useEffect } from 'react'
import { Toolbar } from './components/Toolbar'
import { Viewer3D } from './components/Viewer3D'
import type { Viewer3DHandle } from './components/Viewer3D'
import { Sidebar } from './components/Sidebar'
import { DirectoryPanel } from './components/DirectoryPanel'
import { DropZone } from './components/DropZone'
import { SceneControls } from './components/SceneControls'
import { SceneContextMenu } from './components/SceneContextMenu'
import { PreviewGrid } from './components/PreviewGrid'
import { SettingsModal } from './components/SettingsModal'
import { ExportDialog } from './components/ExportDialog'
import { FolderAccessNotice } from './components/FolderAccessNotice'
import { MobileDrawer } from './components/MobileDrawer'
import { StatusBar } from './components/StatusBar'
import { useSettingsPersistence } from './hooks/useSettings'
import { useGlobalFileDrop } from './hooks/useGlobalFileDrop'
import { useViewerStore } from './store/viewerStore'
import { getTheme, applyThemeCssVars } from './themes'

export default function App() {
  const filePath = useViewerStore((s) => s.filePath)
  const fileExtension = useViewerStore((s) => s.fileExtension)
  const viewMode = useViewerStore((s) => s.viewMode)
  const isLoading = useViewerStore((s) => s.isLoading)
  const error = useViewerStore((s) => s.error)
  const setError = useViewerStore((s) => s.setError)
  const loadedModels = useViewerStore((s) => s.loadedModels)
  const theme = useViewerStore((s) => s.theme)
  const dirPath = useViewerStore((s) => s.dirPath)
  const mainView = useViewerStore((s) => s.mainView)
  const mobileDrawer = useViewerStore((s) => s.mobileDrawer)
  const setMobileDrawer = useViewerStore((s) => s.setMobileDrawer)
  const settingsOpen = useViewerStore((s) => s.settingsOpen)

  useEffect(() => {
    const colors = getTheme(theme)
    applyThemeCssVars(document.documentElement, colors)
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  }, [theme])
  const viewerRef = useRef<Viewer3DHandle>(null)
  useSettingsPersistence()
  useGlobalFileDrop()
  const isDragOver = useViewerStore((s) => s.isDragOver)

  return (
    <div className="flex flex-col h-[100dvh] bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="flex flex-col flex-1 min-h-0" inert={mobileDrawer !== 'none' || settingsOpen}>
        <Toolbar />
        <div className="flex flex-1 overflow-hidden">
        {/* Left panel — Explorer */}
        <DirectoryPanel />
        <main className="flex-1 relative min-w-0 overflow-hidden bg-[var(--bg-app)]" aria-busy={isLoading}>
          {dirPath && mainView === 'grid' ? (
            <PreviewGrid />
          ) : filePath || loadedModels.length > 0 ? (
            <SceneContextMenu viewerRef={viewerRef}>
              <Viewer3D ref={viewerRef} filePath={filePath} fileExtension={fileExtension} viewMode={viewMode} />
              <SceneControls viewerRef={viewerRef} />
            </SceneContextMenu>
          ) : (
            <DropZone />
          )}

          {isDragOver && (filePath || loadedModels.length > 0 || (dirPath && mainView === 'grid')) && (
            <div
              aria-hidden="true"
              className="absolute inset-0 z-10 pointer-events-none ring-2 ring-[var(--accent)] ring-inset bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] flex items-center justify-center"
            >
              <span className="px-3 py-1.5 rounded bg-[var(--bg-panel)] text-sm text-[var(--text-bright)] shadow-[0_4px_18px_var(--shadow-color)]">
                Drop to open
              </span>
            </div>
          )}

          {isLoading && (
            <div role="status" aria-live="polite" className="absolute inset-0 bg-[var(--scrim)] flex items-center justify-center z-10">
              <div className="loading-card">
                <div aria-hidden="true" className="loading-line loading-line-wide" />
                <div aria-hidden="true" className="loading-line" />
                <span>Preparing model</span>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="absolute bottom-0 left-0 right-0 border-l-2 border-[var(--error)] bg-[color-mix(in_srgb,var(--error)_22%,var(--bg-toolbar))] text-[var(--text-bright)] px-4 py-2 flex justify-between items-center z-10">
              <span className="text-sm">{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-4 text-[var(--text-label)] hover:text-[var(--text-bright)] text-lg leading-none"
                aria-label="Dismiss error"
              >
                &times;
              </button>
            </div>
          )}
        </main>
        <Sidebar />
        </div>
      </div>
      <MobileDrawer side="left" open={mobileDrawer === 'explorer'} onClose={() => setMobileDrawer('none')}>
        <DirectoryPanel mobile />
      </MobileDrawer>
      <MobileDrawer side="right" open={mobileDrawer === 'details'} onClose={() => setMobileDrawer('none')}>
        <Sidebar mobile />
      </MobileDrawer>
      <SettingsModal />
      <ExportDialog viewerRef={viewerRef} />
      <FolderAccessNotice />
      <StatusBar />
    </div>
  )
}
