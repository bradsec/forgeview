import { afterEach, describe, expect, it, vi } from 'vitest'
import { isIOS, pickBrowserFile } from './browserFile'

function stubNavigator(userAgent: string, maxTouchPoints: number) {
  vi.stubGlobal('navigator', { ...navigator, userAgent, maxTouchPoints })
}

function pickerInput(): HTMLInputElement {
  const created: HTMLInputElement[] = []
  const original = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const element = original(tag)
    if (tag === 'input') created.push(element as HTMLInputElement)
    return element
  })
  void pickBrowserFile()
  return created[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isIOS', () => {
  it('detects iPhone and iPad user agents', () => {
    stubNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)
    expect(isIOS()).toBe(true)
  })

  it('detects iPadOS reporting a Mac user agent with touch', () => {
    stubNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)
    expect(isIOS()).toBe(true)
  })

  it('does not flag desktop browsers', () => {
    stubNavigator('Mozilla/5.0 (X11; Linux x86_64)', 0)
    expect(isIOS()).toBe(false)
  })
})

describe('pickBrowserFile', () => {
  it('filters by extension on non-iOS browsers', () => {
    stubNavigator('Mozilla/5.0 (X11; Linux x86_64)', 0)
    expect(pickerInput().accept).toContain('.stl')
  })

  it('leaves the picker unfiltered on iOS so files stay selectable', () => {
    // iOS greys out extensions it cannot map to system types (e.g. .stl)
    stubNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)
    expect(pickerInput().accept).toBe('')
  })
})
