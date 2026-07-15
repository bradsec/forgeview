export type ThemeMode = 'dark' | 'light'

export interface ThemeColors {
  // UI chrome (CSS variable values)
  bgApp: string
  bgToolbar: string
  bgPanel: string
  bgDialog: string
  bgButton: string
  bgButtonHover: string
  bgButtonActive: string
  bgInput: string
  border: string
  borderInput: string
  textPrimary: string
  textBright: string
  textMuted: string
  textLabel: string
  textOnAccent: string
  accent: string
  accentHover: string
  accentButton: string
  accentButtonHover: string
  error: string
  warning: string
  success: string

  // Scene (Three.js values)
  sceneBgTop: number
  sceneBgBottom: number
  gridPrimary: number
  gridSecondary: number
  modelColor: number
  hemisphereSky: number
  hemisphereGround: number
  keyLightIntensity: number
  fillLightIntensity: number
}

export const darkTheme: ThemeColors = {
  bgApp: '#151A22',
  bgToolbar: '#1B2027',
  bgPanel: '#1D232B',
  bgDialog: '#222933',
  bgButton: '#292F38',
  bgButtonHover: '#333B46',
  bgButtonActive: '#4A2D24',
  bgInput: '#171C23',
  border: '#303741',
  borderInput: '#414A56',
  textPrimary: '#C8CED7',
  textBright: '#F0F3F7',
  textMuted: '#8993A1',
  textLabel: '#AAB2BE',
  textOnAccent: '#F4FBFF',
  accent: '#E68A4E',
  accentHover: '#F0A873',
  accentButton: '#984622',
  accentButtonHover: '#B5572B',
  error: '#F1737B',
  warning: '#E7B85C',
  success: '#63B58B',

  sceneBgTop: 0x33363B,
  sceneBgBottom: 0x232427,
  gridPrimary: 0x3F4146,
  gridSecondary: 0x303237,
  modelColor: 0xB0B0B0,
  hemisphereSky: 0xDDEEFF,
  hemisphereGround: 0x0D0D0D,
  keyLightIntensity: 1.2,
  fillLightIntensity: 0.6,
}

export const lightTheme: ThemeColors = {
  bgApp: '#E9EDF2',
  bgToolbar: '#F8F9FB',
  bgPanel: '#F3F5F8',
  bgDialog: '#FFFFFF',
  bgButton: '#E5E9EE',
  bgButtonHover: '#D8DEE6',
  bgButtonActive: '#F2D8C9',
  bgInput: '#FFFFFF',
  border: '#D7DDE5',
  borderInput: '#C3CBD5',
  textPrimary: '#39424E',
  textBright: '#18202A',
  textMuted: '#687484',
  textLabel: '#505C6B',
  textOnAccent: '#FFFFFF',
  accent: '#A94720',
  accentHover: '#8D3918',
  accentButton: '#98401C',
  accentButtonHover: '#7F3417',
  error: '#D93025',
  warning: '#E8A020',
  success: '#1E8E3E',

  sceneBgTop: 0xB8BCC8,
  sceneBgBottom: 0xD0D4DA,
  gridPrimary: 0xA0A0AA,
  gridSecondary: 0xB8B8C2,
  modelColor: 0x909090,
  hemisphereSky: 0xFFFFFF,
  hemisphereGround: 0x404040,
  keyLightIntensity: 1.0,
  fillLightIntensity: 0.4,
}

export function getTheme(mode: ThemeMode): ThemeColors {
  return mode === 'dark' ? darkTheme : lightTheme
}

/**
 * Apply UI theme colors as CSS custom properties on the given element.
 */
export function applyThemeCssVars(element: HTMLElement, theme: ThemeColors): void {
  const vars: Record<string, string> = {
    '--bg-app': theme.bgApp,
    '--bg-toolbar': theme.bgToolbar,
    '--bg-panel': theme.bgPanel,
    '--bg-dialog': theme.bgDialog,
    '--bg-button': theme.bgButton,
    '--bg-button-hover': theme.bgButtonHover,
    '--bg-button-active': theme.bgButtonActive,
    '--bg-input': theme.bgInput,
    '--border': theme.border,
    '--border-input': theme.borderInput,
    '--text-primary': theme.textPrimary,
    '--text-bright': theme.textBright,
    '--text-muted': theme.textMuted,
    '--text-label': theme.textLabel,
    '--text-on-accent': theme.textOnAccent,
    '--accent': theme.accent,
    '--accent-hover': theme.accentHover,
    '--accent-button': theme.accentButton,
    '--accent-button-hover': theme.accentButtonHover,
    '--error': theme.error,
    '--warning': theme.warning,
    '--success': theme.success,
  }
  for (const [key, value] of Object.entries(vars)) {
    element.style.setProperty(key, value)
  }
}
