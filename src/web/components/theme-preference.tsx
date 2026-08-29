'use client'

import { ThemePreferenceSchema, type ThemePreference } from '@slopify/shared'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  ApiClientError,
  createApiClient,
  type ApiClient,
  type SettingsSnapshot,
} from '@/lib/api-client'

type EffectiveTheme = Exclude<ThemePreference, 'system'>

export type ThemeSettingsClient = Pick<ApiClient, 'getSettings' | 'updateSettings'>

interface ThemePreferenceValue {
  readonly effectiveTheme: EffectiveTheme
  readonly error: string | undefined
  readonly isSaving: boolean
  readonly preference: ThemePreference
  readonly refreshPreference: () => Promise<void>
  readonly setPreference: (preference: ThemePreference) => Promise<void>
  readonly toggleTheme: () => Promise<void>
}

const missingSettings: SettingsSnapshot = {
  value: {
    schemaVersion: 1,
    appearance: { theme: 'system' },
    git: { connections: [] },
  },
  etag: '"missing"',
}
const defaultClient = createApiClient()
const ThemePreferenceContext = createContext<ThemePreferenceValue | undefined>(undefined)

function resolveTheme(
  preference: ThemePreference,
  systemAppearance: EffectiveTheme,
): EffectiveTheme {
  return preference === 'system' ? systemAppearance : preference
}

function applyTheme(theme: EffectiveTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

export function ThemePreferenceProvider({
  children,
  client = defaultClient,
  initialSettings = missingSettings,
}: Readonly<{
  children: ReactNode
  client?: ThemeSettingsClient | undefined
  initialSettings?: SettingsSnapshot | undefined
}>) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    initialSettings.value.appearance.theme,
  )
  const [systemAppearance, setSystemAppearance] = useState<EffectiveTheme>('light')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string>()
  const mountedRef = useRef(false)
  const savingRef = useRef(false)
  const settingsRef = useRef(initialSettings)
  const preferenceRef = useRef(initialSettings.value.appearance.theme)
  const systemAppearanceRef = useRef<EffectiveTheme>('light')
  const refreshSequenceRef = useRef(0)

  const acceptSettings = useCallback((settings: SettingsSnapshot) => {
    settingsRef.current = settings
    preferenceRef.current = settings.value.appearance.theme
    if (mountedRef.current) setPreferenceState(settings.value.appearance.theme)
    applyTheme(resolveTheme(settings.value.appearance.theme, systemAppearanceRef.current))
  }, [])

  const refreshSettings = useCallback(
    async (force = false) => {
      if (savingRef.current && !force) return false
      const sequence = ++refreshSequenceRef.current
      try {
        const settings = await client.getSettings()
        if (!mountedRef.current || sequence !== refreshSequenceRef.current) return false
        acceptSettings(settings)
        setError(undefined)
        return true
      } catch (cause) {
        if (mountedRef.current && sequence === refreshSequenceRef.current) {
          setError(cause instanceof Error ? cause.message : 'Theme settings could not be loaded.')
        }
        return false
      }
    },
    [acceptSettings, client],
  )

  useEffect(() => {
    mountedRef.current = true
    settingsRef.current = initialSettings
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const initialSystemAppearance = colorScheme.matches ? 'dark' : 'light'
    systemAppearanceRef.current = initialSystemAppearance
    setSystemAppearance(initialSystemAppearance)

    const initialPreference = initialSettings.value.appearance.theme
    preferenceRef.current = initialPreference
    setPreferenceState(initialPreference)
    applyTheme(resolveTheme(initialPreference, initialSystemAppearance))

    const updateSystemAppearance = () => {
      const nextAppearance = colorScheme.matches ? 'dark' : 'light'
      systemAppearanceRef.current = nextAppearance
      setSystemAppearance(nextAppearance)
      applyTheme(resolveTheme(preferenceRef.current, nextAppearance))
    }
    const handleFocus = () => void refreshSettings()

    colorScheme.addEventListener?.('change', updateSystemAppearance)
    window.addEventListener('focus', handleFocus)

    return () => {
      mountedRef.current = false
      colorScheme.removeEventListener?.('change', updateSystemAppearance)
      window.removeEventListener('focus', handleFocus)
    }
  }, [acceptSettings, client, initialSettings, refreshSettings])

  const persistPreference = useCallback(
    async (preferenceInput: ThemePreference) => {
      if (savingRef.current) return

      const nextPreference = ThemePreferenceSchema.parse(preferenceInput)
      const previousSettings = settingsRef.current
      savingRef.current = true
      setIsSaving(true)
      setError(undefined)
      preferenceRef.current = nextPreference
      setPreferenceState(nextPreference)
      applyTheme(resolveTheme(nextPreference, systemAppearanceRef.current))

      try {
        const settings = await client.updateSettings(
          { appearance: { theme: nextPreference } },
          previousSettings.etag,
        )
        if (!mountedRef.current) return
        acceptSettings(settings)
      } catch (cause) {
        if (!mountedRef.current) return
        if (cause instanceof ApiClientError && cause.code === 'SETTINGS_REVISION_CONFLICT') {
          const refreshed = await refreshSettings(true)
          if (mountedRef.current && refreshed) {
            setError('Theme changed outside Slopify. The latest value has been loaded.')
          }
        } else {
          acceptSettings(previousSettings)
          setError(cause instanceof Error ? cause.message : 'Theme preference could not be saved.')
        }
      } finally {
        savingRef.current = false
        if (mountedRef.current) setIsSaving(false)
      }
    },
    [acceptSettings, client, refreshSettings],
  )

  const toggleTheme = useCallback(async () => {
    const effectiveTheme = resolveTheme(preferenceRef.current, systemAppearanceRef.current)
    await persistPreference(effectiveTheme === 'dark' ? 'light' : 'dark')
  }, [persistPreference])

  const effectiveTheme = resolveTheme(preference, systemAppearance)
  const refreshPreference = useCallback(async () => {
    await refreshSettings()
  }, [refreshSettings])
  const value = useMemo<ThemePreferenceValue>(
    () => ({
      effectiveTheme,
      error,
      isSaving,
      preference,
      refreshPreference,
      setPreference: persistPreference,
      toggleTheme,
    }),
    [
      effectiveTheme,
      error,
      isSaving,
      persistPreference,
      preference,
      refreshPreference,
      toggleTheme,
    ],
  )

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext)
  if (context === undefined) {
    throw new Error('useThemePreference must be used inside ThemePreferenceProvider')
  }
  return context
}
