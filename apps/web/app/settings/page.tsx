import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Preferences',
}

export default function SettingsPage() {
  redirect('/preferences')
}
