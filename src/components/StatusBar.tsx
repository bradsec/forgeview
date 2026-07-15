import packageJson from '../../package.json'

export function StatusBar() {
  return (
    <footer className="status-bar" aria-label="Application status">
      <span>Ready</span>
      <div>
        <a href="https://github.com/bradsec/forgeview" target="_blank" rel="noreferrer">
          github.com/bradsec/forgeview
        </a>
        <span>v{packageJson.version}</span>
      </div>
    </footer>
  )
}
