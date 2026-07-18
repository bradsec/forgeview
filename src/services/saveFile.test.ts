import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/isTauri', () => ({ isTauri: () => false }))

import { saveExportedFile } from './saveFile'

describe('saveExportedFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker
  })

  it('uses the browser Save As picker and writes only the addressed bytes', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const showSaveFilePicker = vi.fn().mockResolvedValue({
      name: 'chosen-name.stl',
      createWritable: vi.fn().mockResolvedValue({ write, close }),
    })
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: showSaveFilePicker,
    })
    const backing = new Uint8Array([9, 1, 2, 3, 8])

    const saved = await saveExportedFile(backing.subarray(1, 4), 'model.stl')

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'model.stl',
      types: [{
        description: '3D model',
        accept: { 'application/octet-stream': ['.stl'] },
      }],
    })
    expect([...write.mock.calls[0][0]]).toEqual([1, 2, 3])
    expect(close).toHaveBeenCalledOnce()
    expect(saved).toBe('chosen-name.stl')
  })

  it('returns null when the browser Save As picker is cancelled', async () => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn().mockRejectedValue({ name: 'AbortError' }),
    })

    await expect(saveExportedFile(new Uint8Array([1]), 'model.stl')).resolves.toBeNull()
  })

  it('saves only the addressed Uint8Array bytes', async () => {
    const backing = new Uint8Array([9, 1, 2, 3, 8])
    const view = backing.subarray(1, 4)
    let savedPart: Uint8Array | undefined
    class TestBlob {
      constructor(parts: BlobPart[]) {
        savedPart = parts[0] as Uint8Array
      }
    }
    vi.stubGlobal('Blob', TestBlob)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await saveExportedFile(view, 'model.stl')

    expect([...savedPart!]).toEqual([1, 2, 3])
  })
})
