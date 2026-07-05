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
  bgApp: '#2D2D2D',
  bgToolbar: '#383838',
  bgPanel: '#323232',
  bgDialog: '#3B3B3B',
  bgButton: '#424447',
  bgButtonHover: '#4A4D51',
  bgButtonActive: '#354F85',
  bgInput: '#424447',
  border: '#2C2C2C',
  borderInput: '#505050',
  textPrimary: '#C0C0C6',
  textBright: '#EEEEEE',
  textMuted: '#9A9AA0',
  textLabel: '#A5A5AA',
  accent: '#0696D7',
  accentHover: '#42B6DF',
  accentButton: '#354F85',
  accentButtonHover: '#3D5A96',
  error: '#EB5555',
  warning: '#FBB549',
  success: '#669653',

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
  bgApp: '#E8E8E8',
  bgToolbar: '#F0F0F0',
  bgPanel: '#F5F5F5',
  bgDialog: '#FFFFFF',
  bgButton: '#E0E0E0',
  bgButtonHover: '#D0D0D0',
  bgButtonActive: '#0696D7',
  bgInput: '#FFFFFF',
  border: '#D5D5D5',
  borderInput: '#C9C9C9',
  textPrimary: '#333333',
  textBright: '#1A1A1A',
  textMuted: '#6E6E6E',
  textLabel: '#666666',
  accent: '#0696D7',
  accentHover: '#007FC6',
  accentButton: '#0696D7',
  accentButtonHover: '#007FC6',
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
