import { useRef, useEffect } from 'react'
import { Toolbar } from './components/Toolbar'
import { Viewer3D } from './components/Viewer3D'
import type { Viewer3DHandle } from './components/Viewer3D'
import { Sidebar } from './components/Sidebar'
import { DirectoryPanel } from './components/DirectoryPanel'
import { DropZone } from './components/DropZone'
import { SceneControls } from './components/SceneControls'
import { PreviewGrid } from './components/PreviewGrid'
import { SettingsModal } from './components/SettingsModal'
import { MobileDrawer } from './components/MobileDrawer'
import { useSettingsPersistence } from './hooks/useSettings'
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

  useEffect(() => {
    const colors = getTheme(theme)
    applyThemeCssVars(document.documentElement, colors)
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  }, [theme])
  const viewerRef = useRef<Viewer3DHandle>(null)
  useSettingsPersistence()

  return (
    <div className="flex flex-col h-[100dvh] bg-[var(--bg-app)] text-[var(--text-primary)]">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — Explorer */}
        <DirectoryPanel />
        <div className="flex-1 relative min-w-0 overflow-hidden">
          {dirPath && mainView === 'grid' ? (
            <PreviewGrid />
          ) : filePath || loadedModels.length > 0 ? (
            <Viewer3D ref={viewerRef} filePath={filePath} fileExtension={fileExtension} viewMode={viewMode} />
          ) : (
            <DropZone />
          )}

          {!(dirPath && mainView === 'grid') && (filePath || loadedModels.length > 0) && (
            <SceneControls viewerRef={viewerRef} />
          )}

          {isLoading && (
            <div className="absolute inset-0 bg-[var(--scrim)] flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
                <span className="text-sm text-[var(--text-primary)]">Loading...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute bottom-0 left-0 right-0 border-l-2 border-[var(--error)] bg-[color-mix(in_srgb,var(--error)_22%,var(--bg-toolbar))] text-[var(--text-bright)] px-4 py-2 flex justify-between items-center z-10">
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
        </div>
        <Sidebar />
        {/* Mobile-only overlay drawers */}
        <MobileDrawer side="left" open={mobileDrawer === 'explorer'} onClose={() => setMobileDrawer('none')}>
          <DirectoryPanel mobile />
        </MobileDrawer>
        <MobileDrawer side="right" open={mobileDrawer === 'details'} onClose={() => setMobileDrawer('none')}>
          <Sidebar mobile />
        </MobileDrawer>
      </div>
      <SettingsModal />
    </div>
  )
}
