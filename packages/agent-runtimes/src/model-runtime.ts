import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

export type ModelRuntimeErrorCode =
  | 'MODEL_CONFIGURATION_INVALID'
  | 'MODEL_CREDENTIAL_MISSING'
  | 'MODEL_CREDENTIAL_SOURCE_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_RUNTIME_INITIALIZATION_FAILED'

const messages: Readonly<Record<ModelRuntimeErrorCode, string>> = {
  MODEL_CONFIGURATION_INVALID: 'Model runtime configuration is invalid',
  MODEL_CREDENTIAL_MISSING: 'Selected model-provider credentials are unavailable',
  MODEL_CREDENTIAL_SOURCE_FAILED: 'Model-provider credentials could not be read',
  MODEL_NOT_FOUND: 'Selected model is unavailable',
  MODEL_RUNTIME_INITIALIZATION_FAILED: 'Model runtime could not be initialized',
}

export class ModelRuntimeError extends Error {
  override readonly name = 'ModelRuntimeError'

  constructor(readonly code: ModelRuntimeErrorCode) {
    super(messages[code])
  }
}

export interface ModelApiKeyCredential {
  readonly type: 'api-key'
  readonly key: string
}

export interface ModelCredentialSource {
  read(provider: string): Promise<ModelApiKeyCredential | undefined>
}

export interface CreateEnvironmentModelCredentialSourceOptions {
  readonly providerEnvironmentVariables: Readonly<Record<string, string>>
  readonly readEnvironmentVariable: (name: string) => string | undefined
}

export const createEnvironmentModelCredentialSource = (
  options: CreateEnvironmentModelCredentialSourceOptions,
): ModelCredentialSource => ({
  async read(provider) {
    const variableName = options.providerEnvironmentVariables[provider]
    if (variableName === undefined) return undefined
    const key = options.readEnvironmentVariable(variableName)
    if (key === undefined || key.trim().length === 0) return undefined
    return { type: 'api-key', key }
  },
})

export interface CreateScopedModelRuntimeOptions {
  readonly provider: string
  readonly model: string
  readonly credentialSource: ModelCredentialSource
}

export const createScopedModelRuntime = async (options: CreateScopedModelRuntimeOptions) => {
  if (
    options.provider.trim().length === 0 ||
    options.provider !== options.provider.trim() ||
    options.model.trim().length === 0 ||
    options.model !== options.model.trim()
  ) {
    throw new ModelRuntimeError('MODEL_CONFIGURATION_INVALID')
  }

  let credential: ModelApiKeyCredential | undefined
  try {
    credential = await options.credentialSource.read(options.provider)
  } catch {
    throw new ModelRuntimeError('MODEL_CREDENTIAL_SOURCE_FAILED')
  }
  if (credential === undefined || credential.key.trim().length === 0) {
    throw new ModelRuntimeError('MODEL_CREDENTIAL_MISSING')
  }

  const credentials = new InMemoryCredentialStore()
  await credentials.modify(options.provider, async () => ({
    type: 'api_key',
    key: credential.key,
  }))

  let runtime: ModelRuntime
  try {
    runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
  } catch {
    throw new ModelRuntimeError('MODEL_RUNTIME_INITIALIZATION_FAILED')
  }

  const model = runtime.getModel(options.provider, options.model)
  if (model === undefined) throw new ModelRuntimeError('MODEL_NOT_FOUND')
  return { runtime, model }
}
