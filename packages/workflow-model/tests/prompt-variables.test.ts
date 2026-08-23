import { describe, expect, it } from 'vitest'

import { renderPromptVariables } from '../src/index.js'

describe('prompt variables', () => {
  it('renders only workflow-declared variables and leaves undeclared placeholders literal', () => {
    expect(
      renderPromptVariables(
        'Task {{ taskId }}: {{ payload }} / {{ typo }}',
        ['taskId', 'payload'],
        {
          taskId: 42,
          payload: { ready: true },
          typo: 'must not be used',
        },
      ),
    ).toBe('Task 42: {"ready":true} / {{ typo }}')
  })

  it('unescapes a literal placeholder without interpreting the substituted value again', () => {
    expect(
      renderPromptVariables('Literal \\{{ taskId }}; value {{ value }}', ['taskId', 'value'], {
        taskId: 'ignored',
        value: '{{ taskId }}',
      }),
    ).toBe('Literal {{ taskId }}; value {{ taskId }}')
  })
})
