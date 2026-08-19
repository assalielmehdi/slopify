import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'

import './globals.css'
import { AppShell } from '@/components/app-shell'
import { cn } from '@/lib/utils'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Slopify',
  description: 'Local software delivery workbench',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={cn('font-sans', inter.variable)}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
