import { describe, expect, it, vi } from 'vitest'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'

import {
  createEnvironmentModelCredentialSource,
  createScopedModelRuntime,
  ModelRuntimeError,
} from '../src/model-runtime.js'

describe('model runtime', () => {
  it('reads only the selected provider credential into an isolated runtime', async () => {
    const readEnvironmentVariable = vi.fn((name: string) =>
      name === 'ANTHROPIC_API_KEY' ? 'test-anthropic-key' : 'test-openai-key',
    )
    const credentialSource = createEnvironmentModelCredentialSource({
      providerEnvironmentVariables: {
        anthropic: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
      },
      readEnvironmentVariable,
    })

    const selection = await createScopedModelRuntime({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      credentialSource,
    })

    expect(readEnvironmentVariable).toHaveBeenCalledTimes(1)
    expect(readEnvironmentVariable).toHaveBeenCalledWith('ANTHROPIC_API_KEY')
    expect(selection.model.provider).toBe('anthropic')
    expect(selection.model.id).toBe('claude-sonnet-4-5')
    await expect(selection.runtime.listCredentials()).resolves.toEqual([
      { providerId: 'anthropic', type: 'api_key' },
    ])
  })

  it('fails closed when the approved source has no selected-provider credential', async () => {
    const credentialSource = createEnvironmentModelCredentialSource({
      providerEnvironmentVariables: { anthropic: 'ANTHROPIC_API_KEY' },
      readEnvironmentVariable: () => '   ',
    })

    await expect(
      createScopedModelRuntime({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        credentialSource,
      }),
    ).rejects.toMatchObject<ModelRuntimeError>({ code: 'MODEL_CREDENTIAL_MISSING' })
  })

  it('does not expose credential-source failures', async () => {
    const credential = 'credential-that-must-not-escape'
    const credentialSource = createEnvironmentModelCredentialSource({
      providerEnvironmentVariables: { anthropic: 'ANTHROPIC_API_KEY' },
      readEnvironmentVariable: () => {
        throw new Error(credential)
      },
    })

    const error = await createScopedModelRuntime({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      credentialSource,
    }).catch((cause: unknown) => cause)

    expect(error).toMatchObject<ModelRuntimeError>({ code: 'MODEL_CREDENTIAL_SOURCE_FAILED' })
    expect(String(error)).not.toContain(credential)
  })

  it('rejects an unknown model without network discovery', async () => {
    const credentialSource = createEnvironmentModelCredentialSource({
      providerEnvironmentVariables: { anthropic: 'ANTHROPIC_API_KEY' },
      readEnvironmentVariable: () => 'test-key',
    })

    await expect(
      createScopedModelRuntime({
        provider: 'anthropic',
        model: 'not-a-real-model',
        credentialSource,
      }),
    ).rejects.toMatchObject<ModelRuntimeError>({ code: 'MODEL_NOT_FOUND' })
  })

  it('supports a provider-scoped OAuth store for ChatGPT subscription inference', async () => {
    const credentials = new InMemoryCredentialStore()
    await credentials.modify('openai-codex', async () => ({
      type: 'oauth',
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
    }))
    await credentials.modify('anthropic', async () => ({ type: 'api_key', key: 'not-selected' }))

    const selection = await createScopedModelRuntime({
      provider: 'openai-codex',
      model: 'gpt-5.4',
      credentialStore: credentials,
    })

    expect(selection.model.provider).toBe('openai-codex')
    await expect(selection.runtime.listCredentials()).resolves.toEqual([
      { providerId: 'openai-codex', type: 'oauth' },
    ])
  })
})
