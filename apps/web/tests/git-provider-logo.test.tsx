// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { GitProviderLogo } from '../components/settings/git-provider-logo'

afterEach(cleanup)

describe('GitProviderLogo', () => {
  it('uses the official GitHub brand mark colors in light and dark modes', () => {
    render(<GitProviderLogo provider="GITHUB" />)

    const mark = screen.getByTestId('github-logo').querySelector('path')
    expect(mark?.classList.contains('fill-[#181717]')).toBe(true)
    expect(mark?.classList.contains('dark:fill-[#f0f6fc]')).toBe(true)
  })

  it('uses the official GitLab orange for its brand mark', () => {
    render(<GitProviderLogo provider="GITLAB" />)

    expect(screen.getByTestId('gitlab-logo').querySelector('path')?.getAttribute('fill')).toBe(
      '#FC6D26',
    )
  })
})
