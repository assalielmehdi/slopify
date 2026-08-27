import { describe, expect, it, vi } from 'vitest'

import {
  createCodexHarnessInspector,
  parseCodexModelCatalog,
} from '../src/codex-harness-inspector.js'
import type { HostCommandInput, HostCommandRunner } from '../src/host-command.js'

const runner = (implementation: (input: HostCommandInput) => unknown): HostCommandRunner => ({
  run: vi.fn(async (input) => implementation(input)) as HostCommandRunner['run'],
})

const modelCatalog = JSON.stringify({
  models: [
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6-Sol',
      visibility: 'list',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'ultra' }],
      instructions_template: 'private implementation metadata must not escape discovery',
    },
    {
      slug: 'codex-auto-review',
      display_name: 'Codex Auto Review',
      visibility: 'hide',
      supported_reasoning_levels: [{ effort: 'high' }],
    },
  ],
})

describe('Codex harness inspector', () => {
  it('reports the host executable, version, visible models, and reasoning levels', async () => {
    const commandRunner = runner((input) =>
      input.args[0] === '--version'
        ? { exitCode: 0, stdout: 'codex-cli 0.149.1\n', stderr: '' }
        : { exitCode: 0, stdout: modelCatalog, stderr: '' },
    )
    const inspector = createCodexHarnessInspector({
      commandRunner,
      resolveExecutable: async () => '/opt/homebrew/bin/codex',
    })

    await expect(inspector.inspect()).resolves.toEqual({
      harnessId: 'codex',
      name: 'Codex',
      description:
        'Runs workflow agents through the Codex CLI installed and configured on this machine.',
      installHref: 'https://developers.openai.com/codex/cli/',
      installLabel: 'Install Codex',
      availability: 'AVAILABLE',
      executablePath: '/opt/homebrew/bin/codex',
      version: '0.149.1',
      models: [
        {
          id: 'gpt-5.6-sol',
          name: 'GPT-5.6-Sol',
          thinkingLevels: ['low', 'high', 'ultra'],
        },
      ],
    })
    expect(commandRunner.run).toHaveBeenNthCalledWith(1, {
      executable: '/opt/homebrew/bin/codex',
      args: ['--version'],
    })
    expect(commandRunner.run).toHaveBeenNthCalledWith(2, {
      executable: '/opt/homebrew/bin/codex',
      args: ['debug', 'models'],
    })
  })

  it('does not expose hidden models or unrelated catalog fields', () => {
    expect(parseCodexModelCatalog(modelCatalog)).toEqual([
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6-Sol',
        thinkingLevels: ['low', 'high', 'ultra'],
      },
    ])
    expect(JSON.stringify(parseCodexModelCatalog(modelCatalog))).not.toContain(
      'private implementation metadata',
    )
  })

  it('reports an unavailable harness when Codex is not on PATH', async () => {
    const commandRunner = runner(() => {
      throw new Error('must not run')
    })
    const inspector = createCodexHarnessInspector({
      commandRunner,
      resolveExecutable: async () => undefined,
    })

    await expect(inspector.inspect()).resolves.toMatchObject({
      harnessId: 'codex',
      availability: 'UNAVAILABLE',
      unavailableReason: 'Codex is not installed or is not available on PATH.',
      models: [],
    })
    expect(commandRunner.run).not.toHaveBeenCalled()
  })

  it('does not present malformed model metadata as an available harness', async () => {
    const commandRunner = runner((input) =>
      input.args[0] === '--version'
        ? { exitCode: 0, stdout: 'codex-cli 0.149.1\n', stderr: '' }
        : { exitCode: 0, stdout: '{"models":"invalid"}', stderr: '' },
    )
    const inspector = createCodexHarnessInspector({
      commandRunner,
      resolveExecutable: async () => '/opt/homebrew/bin/codex',
    })

    await expect(inspector.inspect()).resolves.toMatchObject({
      harnessId: 'codex',
      availability: 'UNAVAILABLE',
      unavailableReason: 'Codex could not list its available models.',
    })
  })
})
