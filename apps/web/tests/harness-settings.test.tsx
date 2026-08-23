// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HarnessDescriptorSchema } from '@slopify/contracts'

import { HarnessSettings } from '../components/settings/harness-settings'

afterEach(cleanup)

describe('HarnessSettings', () => {
  it('shows the host-discovered Pi installation without exposing editable configuration', async () => {
    const descriptor = HarnessDescriptorSchema.parse({
      harnessId: 'pi',
      name: 'Pi',
      description: 'Runs the locally installed Pi coding agent.',
      availability: 'AVAILABLE',
      executablePath: '/opt/homebrew/bin/pi',
      version: '0.84.2',
      installHref: 'https://pi.dev/',
      installLabel: 'Install Pi',
      models: [{ id: 'openai/gpt-5.4', name: 'GPT-5.4', thinkingLevels: ['medium', 'high'] }],
    })
    render(<HarnessSettings client={{ listHarnesses: vi.fn(async () => [descriptor]) }} />)

    expect(await screen.findByRole('heading', { name: 'Pi' })).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.getByText('Version 0.84.2')).toBeTruthy()
    expect(screen.getByText('/opt/homebrew/bin/pi')).toBeTruthy()
    expect(screen.getByText('1 model')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Save|Connect|Configure/ })).toBeNull()
  })

  it('gives an actionable installation link when Pi is unavailable', async () => {
    const descriptor = HarnessDescriptorSchema.parse({
      harnessId: 'pi',
      name: 'Pi',
      description: 'Runs the locally installed Pi coding agent.',
      availability: 'UNAVAILABLE',
      unavailableReason: 'Pi was not found on PATH.',
      installHref: 'https://pi.dev/',
      installLabel: 'Install Pi',
      models: [],
    })
    render(<HarnessSettings client={{ listHarnesses: vi.fn(async () => [descriptor]) }} />)

    expect(await screen.findByText('Pi was not found on PATH.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Install Pi' }).getAttribute('href')).toBe(
      'https://pi.dev/',
    )
    expect(screen.getByText('Unavailable')).toBeTruthy()
  })

  it('shows a truthful unavailable state when harness discovery fails', async () => {
    render(
      <HarnessSettings
        client={{
          listHarnesses: vi.fn(async () => {
            throw new Error('Harness discovery failed.')
          }),
        }}
      />,
    )

    expect(await screen.findByText('Harness discovery failed.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Pi' })).toBeNull()
  })
})
