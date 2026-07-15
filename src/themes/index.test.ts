import { describe, expect, it } from 'vitest'
import { darkTheme, lightTheme } from './index'

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((value) => parseInt(value, 16) / 255)
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('theme contrast', () => {
  it.each([darkTheme, lightTheme])('keeps accent button text at WCAG AA contrast', (theme) => {
    expect(contrast(theme.textOnAccent, theme.accentButton)).toBeGreaterThanOrEqual(4.5)
  })
})
