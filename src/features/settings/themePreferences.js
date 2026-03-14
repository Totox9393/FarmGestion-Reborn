import { supabase } from '../authentification/supabaseClient'

export const THEME_STORAGE_KEY = 'farmgestion_theme'
export const THEME_SETTING_NAME = 'theme'
export const DEFAULT_THEME = 'light'

const ALLOWED_THEMES = new Set(['dark', 'pastel', 'galactic', 'multicolor', 'light'])
const LEGACY_THEME_MAP = {
  dark_mode: 'dark',
  light_mode: 'light',
}

const parseThemeSettingValue = (value) => {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object') {
    if (typeof value.theme === 'string') return value.theme
    if (typeof value.value === 'string') return value.value
    if (typeof value.name === 'string') return value.name
  }

  return ''
}

export const normalizeThemeValue = (value) => {
  const raw = String(value || '').trim().toLowerCase()
  const mapped = LEGACY_THEME_MAP[raw] || raw
  return ALLOWED_THEMES.has(mapped) ? mapped : DEFAULT_THEME
}

export const getLocalThemePreference = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME
  }

  try {
    return normalizeThemeValue(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

export const applyLocalThemePreference = (theme) => {
  const normalizedTheme = normalizeThemeValue(theme)

  if (typeof window === 'undefined') {
    return normalizedTheme
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme)
  } catch {
    // ignore localStorage write errors
  }

  window.dispatchEvent(new Event('farmgestion-theme-change'))
  return normalizedTheme
}

export const fetchUserThemePreference = async (userId) => {
  if (!userId) {
    return { theme: null, error: null }
  }

  const { data, error } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_name', THEME_SETTING_NAME)
    .maybeSingle()

  if (error) {
    return { theme: null, error }
  }

  if (!data) {
    return { theme: null, error: null }
  }

  return {
    theme: normalizeThemeValue(parseThemeSettingValue(data.setting_value)),
    error: null,
  }
}

export const saveUserThemePreference = async ({ userId, theme }) => {
  if (!userId) {
    return { error: new Error('Utilisateur manquant') }
  }

  const normalizedTheme = normalizeThemeValue(theme)
  const { error } = await supabase
    .from('user_settings')
    .upsert(
      {
        user_id: userId,
        setting_name: THEME_SETTING_NAME,
        setting_value: normalizedTheme,
      },
      { onConflict: 'user_id,setting_name' },
    )

  return { error: error || null }
}