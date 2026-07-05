import { useViewerStore } from '../store/viewerStore'

/**
 * Scene model list — shows all models visible in the viewport:
 * - Multi-model entries (loadedModels array)
 * - Single-file preview entry (filePath / fileName store fields)
 *
 * Renders a "Clear All" button when 1+ models are visible.
 */
export function ModelList() {
  const loadedModels = useViewerStore((s) => s.loadedModels)
  const removeModel = useViewerStore((s) => s.removeModel)
  const clearModels = useViewerStore((s) => s.clearModels)

  // Single-file preview fields
  const filePath = useViewerStore((s) => s.filePath)
  const fileName = useViewerStore((s) => s.fileName)
  const fileExtension = useViewerStore((s) => s.fileExtension)
  const fileSize = useViewerStore((s) => s.fileSize)
  const triangleCount = useViewerStore((s) => s.triangleCount)

  // Determine whether the single-file preview is active and not already in loadedModels
  const previewIsUnique =
    filePath !== null && !loadedModels.some((m) => m.path === filePath)

  const hasAny = loadedModels.length > 0 || previewIsUnique

  if (!hasAny) {
    return (
      <p className="text-sm text-[var(--text-muted)] px-4 py-2">No models in scene</p>
    )
  }

  const clearPreview = () => {
    useViewerStore.setState({
      filePath: null,
      fileName: null,
      fileExtension: null,
      fileSize: null,
      triangleCount: null,
    })
  }

  const clearAll = () => {
    clearModels()
    clearPreview()
  }

  return (
    <div className="flex flex-col">
      {/* Model list */}
      <ul className="overflow-y-auto max-h-48">
        {/* Single-file preview entry (shown only when not already in loadedModels) */}
        {previewIsUnique && (
          <li className="flex items-center gap-2 px-4 py-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]">
            {/* Format badge */}
            <span className="bg-[var(--bg-button)] text-xs rounded font-mono px-1 py-0.5 shrink-0">
              {fileExtension?.toUpperCase().replace('.', '') ?? '?'}
            </span>

            {/* Model name */}
            <span className="truncate text-sm flex-1" title={fileName ?? ''}>
              {fileName}
            </span>

            {/* Triangle count */}
            <span className="text-xs text-[var(--text-muted)] shrink-0 font-mono tabular-nums">
              {triangleCount != null && triangleCount > 0
                ? `${triangleCount.toLocaleString()} tris`
                : fileSize != null
                ? `${(fileSize / 1024).toFixed(0)} KB`
                : '…'}
            </span>

            {/* Remove button */}
            <button
              onClick={clearPreview}
              className="text-[var(--text-muted)] hover:text-[var(--error)] shrink-0 leading-none"
              aria-label={`Remove ${fileName}`}
              title="Remove from scene"
            >
              &times;
            </button>
          </li>
        )}

        {/* Multi-model entries */}
        {loadedModels.map((model) => (
          <li
            key={model.id}
            className="flex items-center gap-2 px-4 py-1.5 text-[var(--text-primary)] hover:bg-[var(--bg-button-hover)]"
          >
            {/* Format badge */}
            <span className="bg-[var(--bg-button)] text-xs rounded font-mono px-1 py-0.5 shrink-0">
              {model.extension.toUpperCase().replace('.', '')}
            </span>

            {/* Model name */}
            <span className="truncate text-sm flex-1" title={model.name}>
              {model.name}
            </span>

            {/* Triangle count */}
            <span className="text-xs text-[var(--text-muted)] shrink-0 font-mono tabular-nums">
              {model.triangleCount > 0
                ? `${model.triangleCount.toLocaleString()} tris`
                : '…'}
            </span>

            {/* Remove button */}
            <button
              onClick={() => removeModel(model.id)}
              className="text-[var(--text-muted)] hover:text-[var(--error)] shrink-0 leading-none"
              aria-label={`Remove ${model.name}`}
              title="Remove from scene"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>

      {/* Clear All — visible when 1+ models are loaded */}
      <div className="px-4 py-2">
        <button
          onClick={clearAll}
          className="text-sm text-[var(--text-primary)] hover:text-[var(--error)]"
        >
          Clear All
        </button>
      </div>
    </div>
  )
}
