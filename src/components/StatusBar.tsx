import { useEffect } from 'react'
import packageJson from '../../package.json'
import { useViewerStore } from '../store/viewerStore'

const NOTICE_TIMEOUT_MS = 6000

export function StatusBar() {
  const notice = useViewerStore((s) => s.notice)

  // Transient notices (e.g. "Exported …") clear themselves
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => useViewerStore.getState().setNotice(null), NOTICE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <footer className="status-bar" aria-label="Application status">
      <span role="status" className={notice ? 'text-[var(--success)]' : undefined} title={notice ?? undefined}>
        {notice ?? 'Ready'}
      </span>
      <div>
        <a href="https://github.com/bradsec/forgeview" target="_blank" rel="noreferrer">
          github.com/bradsec/forgeview
        </a>
        <span>v{packageJson.version}</span>
      </div>
    </footer>
  )
}
