'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
type EffectiveTheme = Exclude<ThemePreference, 'system'>

interface ThemePreferenceValue {
  readonly effectiveTheme: EffectiveTheme
  readonly preference: ThemePreference
  readonly setPreference: (preference: ThemePreference) => void
  readonly toggleTheme: () => void
}

const themeStorageKey = 'slopify-theme'
const ThemePreferenceContext = createContext<ThemePreferenceValue | undefined>(undefined)

function storedThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(themeStorageKey)
  return stored === 'dark' || stored === 'system' ? stored : 'light'
}

function applyTheme(theme: EffectiveTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

export function ThemePreferenceProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [preference, setPreferenceState] = useState<ThemePreference>('light')
  const [systemAppearance, setSystemAppearance] = useState<EffectiveTheme>('light')

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemAppearance = () => setSystemAppearance(colorScheme.matches ? 'dark' : 'light')

    setPreferenceState(storedThemePreference())
    updateSystemAppearance()
    colorScheme.addEventListener?.('change', updateSystemAppearance)
    return () => colorScheme.removeEventListener?.('change', updateSystemAppearance)
  }, [])

  const effectiveTheme = preference === 'system' ? systemAppearance : preference

  useEffect(() => applyTheme(effectiveTheme), [effectiveTheme])

  const value = useMemo<ThemePreferenceValue>(
    () => ({
      effectiveTheme,
      preference,
      setPreference: (nextPreference) => {
        window.localStorage.setItem(themeStorageKey, nextPreference)
        setPreferenceState(nextPreference)
      },
      toggleTheme: () => {
        const nextPreference = effectiveTheme === 'dark' ? 'light' : 'dark'
        window.localStorage.setItem(themeStorageKey, nextPreference)
        setPreferenceState(nextPreference)
      },
    }),
    [effectiveTheme, preference],
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
