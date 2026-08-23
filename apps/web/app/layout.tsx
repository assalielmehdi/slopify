import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import { AppShell } from '@/components/app-shell'
import { cn } from '@/lib/utils'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })
const themeScript = `(function(){try{var key='slopify-theme';var saved=localStorage.getItem(key);var preference=saved==='dark'||saved==='system'?saved:'light';var theme=preference==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.colorScheme=theme;}catch(_){}})();`

export const metadata: Metadata = {
  title: {
    default: 'Slopify',
    template: '%s | Slopify',
  },
  description: 'Local agent workflow orchestrator',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn('font-sans', geist.variable, geistMono.variable)}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
