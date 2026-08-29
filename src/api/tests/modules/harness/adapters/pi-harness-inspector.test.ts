import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPiHarnessInspector,
  resolveExecutableOnPath,
  type HostCommandInput,
  type HostCommandRunner,
} from '../../../../src/modules/harness/adapters/pi-harness-inspector.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

const runner = (implementation: (input: HostCommandInput) => unknown): HostCommandRunner => ({
  run: vi.fn(async (input) => implementation(input)) as HostCommandRunner['run'],
})

describe('Pi harness inspector', () => {
  it('ignores dependency-bin executables and resolves Pi from the host PATH', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slopify-pi-path-'))
    temporaryDirectories.push(root)
    const dependencyBin = join(root, 'node_modules', '.bin')
    const hostBin = join(root, 'host', 'bin')
    mkdirSync(dependencyBin, { recursive: true })
    mkdirSync(hostBin, { recursive: true })
    const dependencyPi = join(dependencyBin, 'pi')
    const hostPi = join(hostBin, 'pi')
    for (const executable of [dependencyPi, hostPi]) {
      writeFileSync(executable, '#!/bin/sh\n')
      chmodSync(executable, 0o755)
    }

    await expect(
      resolveExecutableOnPath('pi', [dependencyBin, hostBin].join(delimiter)),
    ).resolves.toBe(realpathSync(hostPi))
  })

  it('does not treat a dependency-bin Pi as a host installation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slopify-pi-path-'))
    temporaryDirectories.push(root)
    const dependencyBin = join(root, 'node_modules', '.bin')
    mkdirSync(dependencyBin, { recursive: true })
    const dependencyPi = join(dependencyBin, 'pi')
    writeFileSync(dependencyPi, '#!/bin/sh\n')
    chmodSync(dependencyPi, 0o755)

    await expect(resolveExecutableOnPath('pi', dependencyBin)).resolves.toBeUndefined()
  })

  it('reports the executable, version, models, and supported thinking levels', async () => {
    const commandRunner = runner((input) => {
      if (input.args[0] === '--version') {
        return { exitCode: 0, stdout: '0.84.2\n', stderr: '' }
      }
      return {
        exitCode: 0,
        stdout:
          'source        model                 context  max-out  thinking  images\n' +
          'anthropic     claude-sonnet-4-5     200K     64K      yes       yes\n' +
          'openai-codex  gpt-5.4               272K     128K     yes       yes\n',
        stderr: '',
      }
    })
    const inspector = createPiHarnessInspector({
      commandRunner,
      resolveExecutable: async () => '/opt/homebrew/bin/pi',
    })

    await expect(inspector.inspect()).resolves.toEqual({
      harnessId: 'pi',
      name: 'Pi',
      description:
        'Runs workflow agents through the Pi CLI installed and configured on this machine.',
      installHref: 'https://pi.dev/',
      installLabel: 'Install Pi',
      availability: 'AVAILABLE',
      executablePath: '/opt/homebrew/bin/pi',
      version: '0.84.2',
      models: [
        {
          id: 'anthropic/claude-sonnet-4-5',
          name: 'anthropic/claude-sonnet-4-5',
          thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        },
        {
          id: 'openai-codex/gpt-5.4',
          name: 'openai-codex/gpt-5.4',
          thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        },
      ],
    })
    expect(commandRunner.run).toHaveBeenNthCalledWith(1, {
      executable: '/opt/homebrew/bin/pi',
      args: ['--version'],
    })
    expect(commandRunner.run).toHaveBeenNthCalledWith(2, {
      executable: '/opt/homebrew/bin/pi',
      args: ['--list-models'],
    })
  })

  it('reports an unavailable harness when Pi is not on PATH', async () => {
    const commandRunner = runner(() => {
      throw new Error('must not run')
    })
    const inspector = createPiHarnessInspector({
      commandRunner,
      resolveExecutable: async () => undefined,
    })

    await expect(inspector.inspect()).resolves.toEqual({
      harnessId: 'pi',
      name: 'Pi',
      description:
        'Runs workflow agents through the Pi CLI installed and configured on this machine.',
      installHref: 'https://pi.dev/',
      installLabel: 'Install Pi',
      availability: 'UNAVAILABLE',
      models: [],
      unavailableReason: 'Pi is not installed or is not available on PATH.',
    })
    expect(commandRunner.run).not.toHaveBeenCalled()
  })

  it('does not present a broken Pi installation as available', async () => {
    const commandRunner = runner(() => ({ exitCode: 1, stdout: '', stderr: 'broken config' }))
    const inspector = createPiHarnessInspector({
      commandRunner,
      resolveExecutable: async () => '/usr/local/bin/pi',
    })

    await expect(inspector.inspect()).resolves.toMatchObject({
      harnessId: 'pi',
      availability: 'UNAVAILABLE',
      unavailableReason: 'Pi could not report its version.',
    })
  })
})
