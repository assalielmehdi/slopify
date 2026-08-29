// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Textarea } from '../components/ui/textarea'

afterEach(cleanup)

describe('Textarea', () => {
  it('stays constrained to its container when content has no wrapping opportunities', () => {
    render(<Textarea aria-label="Prompt" defaultValue={'unbroken'.repeat(100)} />)

    const textarea = screen.getByRole('textbox', { name: 'Prompt' })
    expect([...textarea.classList]).toEqual(
      expect.arrayContaining(['field-sizing-fixed', 'min-w-0', 'w-full', 'max-w-full']),
    )
    expect(textarea.classList.contains('field-sizing-content')).toBe(false)
  })
})
