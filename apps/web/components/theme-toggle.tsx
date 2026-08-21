'use client'

import { MoonIcon, SunIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const themeStorageKey = 'slopify-theme'

type Theme = 'light' | 'dark'

const preferredTheme = (): Theme => {
  const stored = window.localStorage.getItem(themeStorageKey)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const applyTheme = (theme: Theme, persist = false) => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  if (persist) window.localStorage.setItem(themeStorageKey, theme)
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const initialTheme = preferredTheme()
    applyTheme(initialTheme)
    setTheme(initialTheme)
  }, [])

  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <Button
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === 'dark'}
      onClick={() => {
        applyTheme(nextTheme, true)
        setTheme(nextTheme)
      }}
      size="icon-sm"
      title={`Switch to ${nextTheme} mode`}
      variant="ghost"
    >
      <span className="relative size-4" aria-hidden="true">
        <SunIcon
          className={cn(
            'absolute inset-0 size-4 transition-[opacity,transform] duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
            theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-75 opacity-0',
          )}
        />
        <MoonIcon
          className={cn(
            'absolute inset-0 size-4 transition-[opacity,transform] duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
            theme === 'dark' ? 'rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100',
          )}
        />
      </span>
    </Button>
  )
}
