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
  bgPanel: '#252C35',
  bgDialog: '#252C35',
  bgButton: '#303946',
  bgButtonHover: '#3B4654',
  bgButtonActive: '#4A2D24',
  bgInput: '#171C23',
  border: '#414A56',
  borderInput: '#8491A1',
  textPrimary: '#F0F3F7',
  textBright: '#F0F3F7',
  textMuted: '#AAB2BE',
  textLabel: '#AAB2BE',
  textOnAccent: '#FFFFFF',
  accent: '#E68A4E',
  accentHover: '#F0A873',
  accentButton: '#984622',
  accentButtonHover: '#B5572B',
  error: '#F1737B',
  warning: '#E7B85C',
  success: '#63B58B',

  sceneBgTop: 0x343A42,
  sceneBgBottom: 0x343A42,
  gridPrimary: 0x515A65,
  gridSecondary: 0x424B56,
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
  borderInput: '#738093',
  textPrimary: '#18202A',
  textBright: '#18202A',
  textMuted: '#596575',
  textLabel: '#505C6B',
  textOnAccent: '#FFFFFF',
  accent: '#A94720',
  accentHover: '#8D3918',
  accentButton: '#98401C',
  accentButtonHover: '#7F3417',
  error: '#AF2821',
  warning: '#785300',
  success: '#176C35',

  sceneBgTop: 0xD0D4DA,
  sceneBgBottom: 0xD0D4DA,
  gridPrimary: 0x9CA4AF,
  gridSecondary: 0xB5BDC7,
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
