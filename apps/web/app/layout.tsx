import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import { AppShell } from '@/components/app-shell'
import { internalApiOrigin } from '@/lib/api-origin'
import { createApiClient, type SettingsSnapshot } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })
const missingSettings: SettingsSnapshot = {
  value: {
    schemaVersion: 1,
    appearance: { theme: 'system' },
    git: { connections: [] },
  },
  etag: '"missing"',
}

async function loadInitialSettings(): Promise<SettingsSnapshot> {
  try {
    const origin = internalApiOrigin()
    const client = createApiClient({
      fetch: (input, init) =>
        fetch(new URL(input.toString(), origin), { ...init, cache: 'no-store' }),
    })
    return await client.getSettings()
  } catch {
    return missingSettings
  }
}

function createThemeScript(settings: SettingsSnapshot): string {
  const filePreference = JSON.stringify(settings.value.appearance.theme)
  const allowLegacyPreference = settings.etag === '"missing"'
  return `(function(){try{var preference=${filePreference};if(${String(allowLegacyPreference)}){var saved=localStorage.getItem('slopify-theme');if(saved==='light'||saved==='dark'||saved==='system')preference=saved;}var theme=preference==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.colorScheme=theme;}catch(_){}})();`
}

export const metadata: Metadata = {
  title: {
    default: 'Slopify',
    template: '%s | Slopify',
  },
  description: 'Local agent workflow orchestrator',
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const initialSettings = await loadInitialSettings()

  return (
    <html
      lang="en"
      className={cn('font-sans', geist.variable, geistMono.variable)}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: createThemeScript(initialSettings) }} />
        <AppShell initialSettings={initialSettings}>{children}</AppShell>
      </body>
    </html>
  )
}
