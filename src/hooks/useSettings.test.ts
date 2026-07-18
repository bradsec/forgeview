import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewerStore } from '../store/viewerStore'

const fsMocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
const pathMocks = vi.hoisted(() => ({ appConfigDir: vi.fn(), join: vi.fn() }))

vi.mock('../utils/isTauri', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-fs', () => fsMocks)
vi.mock('@tauri-apps/api/path', () => pathMocks)

import { useSettingsPersistence } from './useSettings'

describe('useSettingsPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useViewerStore.setState({
      performancePreset: 'high',
      performanceOverrides: {},
      theme: 'dark',
    })
    pathMocks.appConfigDir.mockResolvedValue('/config/forgeview')
    pathMocks.join.mockResolvedValue('/config/forgeview/settings.json')
  })

  it('joins the settings path through the platform API', async () => {
    fsMocks.readTextFile.mockRejectedValue(new Error('missing'))
    renderHook(() => useSettingsPersistence())

    await waitFor(() => expect(pathMocks.join).toHaveBeenCalledWith('/config/forgeview', 'settings.json'))
  })

  it('does not overwrite a theme changed while settings load', async () => {
    let resolveRead!: (value: string) => void
    fsMocks.readTextFile.mockReturnValue(new Promise<string>((resolve) => { resolveRead = resolve }))
    renderHook(() => useSettingsPersistence())
    act(() => useViewerStore.getState().setTheme('light'))
    resolveRead(JSON.stringify({ performance: { preset: 'low', overrides: {} }, theme: 'dark' }))

    await waitFor(() => expect(pathMocks.join).toHaveBeenCalled())
    await waitFor(() => expect(useViewerStore.getState().performancePreset).toBe('low'))
    expect(useViewerStore.getState().theme).toBe('light')
  })
})
