'use client'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { useThemePreference, type ThemePreference } from '@/components/theme-preference'

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

export function PreferencesScreen() {
  const { preference, setPreference } = useThemePreference()

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-10 sm:px-8 sm:py-12">
      <section aria-labelledby="interface-group-title" className="mt-8">
        <h2 id="interface-group-title" className="mb-3 text-[14px]/5 font-semibold">
          Interface
        </h2>
        <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
          <div className="flex flex-col items-start gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 id="theme-preference-label" className="text-[14px]/5 font-medium">
                Theme
              </h3>
              <p className="mt-0.5 text-[12px]/4 text-muted-foreground">
                Choose how Slopify appears on this device.
              </p>
            </div>
            <SegmentedControl
              ariaLabelledBy="theme-preference-label"
              className="w-full shrink-0 sm:w-auto"
              indicatorTestId="theme-selection-indicator"
              onValueChange={(value) => setPreference(value as ThemePreference)}
              options={themeOptions}
              value={preference}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
