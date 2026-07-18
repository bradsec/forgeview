import { useViewerStore } from '../store/viewerStore'
import { useFileOpen } from '../hooks/useFileOpen'

/**
 * Full-viewport empty state shown when no file is loaded. Actual drop
 * handling (native Tauri events and browser HTML5 drops) lives at App level
 * in useGlobalFileDrop, so drops also work while a model is open; this
 * component only renders the call-to-action and the drag highlight.
 */
export function DropZone() {
  const isDragging = useViewerStore((s) => s.isDragOver)
  const { openFile } = useFileOpen()

  return (
    <div
      data-testid="dropzone"
      className={[
        'model-canvas w-full h-full flex flex-col items-center justify-center select-none',
        isDragging ? 'ring-2 ring-[var(--accent)] ring-inset' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="empty-workspace">
        <div className="empty-mark" aria-hidden="true">3D</div>
        <h1>Open a model to start</h1>
        <p>Choose a file, drop it here, or open a folder to browse compatible models.</p>
        <button
          type="button"
          onClick={openFile}
          className="empty-primary-action"
        >
          Open file
        </button>
        <span>STL, 3MF, OBJ, GLTF, GLB, PLY, DAE</span>
      </div>
    </div>
  )
}
