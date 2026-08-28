// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HarnessDescriptorSchema } from '@slopify/contracts'

import { HarnessSettings } from '../components/settings/harness-settings'

afterEach(cleanup)

describe('HarnessSettings', () => {
  it('shows discovered harnesses as repository-style cards with details in a dialog', async () => {
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

    const piCard = await screen.findByRole('button', { name: 'Pi, Available' })
    expect(screen.getByTestId('harness-grid').className).toContain(
      'sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]',
    )
    expect(screen.getByRole('img', { name: 'Pi' }).getAttribute('src')).toContain('/pi-badge.svg')
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.queryByText('Version 0.84.2')).toBeNull()
    expect(screen.queryByText('/opt/homebrew/bin/pi')).toBeNull()
    expect(
      screen.queryByText(
        'Slopify discovers supported agent harnesses from this machine. Manage harness setup outside Slopify.',
      ),
    ).toBeNull()

    fireEvent.click(piCard)

    const panel = await screen.findByRole('dialog', { name: 'Pi' })
    expect(panel.getAttribute('data-layout')).toBe('floating')
    expect(screen.getByText('Version 0.84.2')).toBeTruthy()
    expect(screen.getByText('/opt/homebrew/bin/pi')).toBeTruthy()
    expect(screen.getByText('1 model')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Save|Connect|Configure/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close harness details' }))
    await waitFor(() => expect(panel.getAttribute('data-open')).toBe('false'))
  })

  it('renders Codex with its own harness identity', async () => {
    const descriptor = HarnessDescriptorSchema.parse({
      harnessId: 'codex',
      name: 'Codex',
      description: 'Runs workflow agents through the Codex CLI.',
      availability: 'AVAILABLE',
      executablePath: '/opt/homebrew/bin/codex',
      version: '0.149.1',
      installHref: 'https://developers.openai.com/codex/cli/',
      installLabel: 'Install Codex',
      models: [{ id: 'gpt-5.6-sol', name: 'gpt-5.6-sol', thinkingLevels: ['high', 'ultra'] }],
    })
    render(<HarnessSettings client={{ listHarnesses: vi.fn(async () => [descriptor]) }} />)

    const codexCard = await screen.findByRole('button', { name: 'Codex, Available' })
    const codexLogo = within(codexCard).getByRole('img', { name: 'Codex' })
    expect(codexLogo.getAttribute('src')).toContain('/codex-logo.svg')

    fireEvent.click(codexCard)
    const panel = await screen.findByRole('dialog', { name: 'Codex' })
    expect(within(panel).getByRole('img', { name: 'Codex' })).toBeTruthy()
    expect(within(panel).getByText('Version 0.149.1')).toBeTruthy()
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

    fireEvent.click(await screen.findByRole('button', { name: 'Pi, Unavailable' }))

    const panel = await screen.findByRole('dialog', { name: 'Pi' })
    expect(within(panel).getByText('Pi was not found on PATH.')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Install Pi' }).getAttribute('href')).toBe(
      'https://pi.dev/',
    )
    expect(within(panel).getByText('Unavailable')).toBeTruthy()
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
