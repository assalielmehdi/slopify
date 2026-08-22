import { describe, expect, it } from 'vitest'

import {
  findMissingPromptVariables,
  getPromptVariableNames,
  renderPromptVariables,
} from '../src/index.js'

describe('prompt variables', () => {
  it('extracts unique exact keys in first-use order and ignores escaped placeholders', () => {
    expect(
      getPromptVariableNames(
        'Work on {{ task ID }} for {{count}} items. Repeat {{ task ID }}. Literal: \\{{count}}.',
      ),
    ).toEqual(['task ID', 'count'])
  })

  it('finds only variables whose keys were not supplied', () => {
    expect(
      findMissingPromptVariables(['Use {{ taskId }}', 'Compare {{ baseline }} with {{ taskId }}'], {
        taskId: '86abc',
        extra: true,
      }),
    ).toEqual(['baseline'])
  })

  it('renders JSON-compatible values once and renders confirmed missing values as empty text', () => {
    expect(
      renderPromptVariables('Task {{ taskId }}: {{ payload }} / {{ missing }}', {
        taskId: 42,
        payload: { ready: true },
      }),
    ).toBe('Task 42: {"ready":true} / ')
  })

  it('unescapes a literal placeholder without interpreting the substituted value again', () => {
    expect(
      renderPromptVariables('Literal \\{{ taskId }}; value {{ value }}', {
        taskId: 'ignored',
        value: '{{ taskId }}',
      }),
    ).toBe('Literal {{ taskId }}; value {{ taskId }}')
  })
})
