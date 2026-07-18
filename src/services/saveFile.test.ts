import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/isTauri', () => ({ isTauri: () => false }))

import { saveExportedFile } from './saveFile'

describe('saveExportedFile', () => {
  afterEach(() => vi.restoreAllMocks())

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
