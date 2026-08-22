import type { Credential, CredentialStore } from './credential-store.js'

export type ConnectionType = 'gitlab' | 'clickup' | 'openrouter' | 'chatgpt-subscription'
export type ConnectionCategory = 'connector' | 'inference'

export interface ConnectionRecord {
  readonly connectionId: string
  readonly type: ConnectionType
  readonly category: ConnectionCategory
  readonly label: string
  readonly authority: string
  readonly configuration: unknown
  readonly metadata: unknown
  readonly status: 'CONNECTED' | 'INVALID'
  readonly validatedAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ConnectionRepository {
  get(connectionId: string): ConnectionRecord | undefined
  list(): readonly ConnectionRecord[]
  save(connection: ConnectionRecord): void
  delete(connectionId: string): void
}

export interface ConnectionValidationInput {
  readonly configuration: unknown
  readonly credential: Credential
  readonly signal?: AbortSignal
}

export interface ConnectionDriver {
  readonly type: ConnectionType
  readonly category: ConnectionCategory
  readonly authority: string
  validate(input: ConnectionValidationInput): Promise<unknown>
}

export type ConnectionServiceErrorCode =
  | 'CONNECTION_DRIVER_NOT_FOUND'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_VALIDATION_FAILED'
  | 'CREDENTIAL_NOT_FOUND'

export class ConnectionServiceError extends Error {
  override readonly name = 'ConnectionServiceError'
  constructor(
    readonly code: ConnectionServiceErrorCode,
    options?: Readonly<{ cause?: unknown }>,
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause })
  }
}

export interface ConnectInput {
  readonly connectionId?: string
  readonly type: ConnectionType
  readonly label: string
  readonly configuration: unknown
  readonly credential: Credential
}

export interface ConnectionService {
  list(): readonly ConnectionRecord[]
  get(connectionId: string): ConnectionRecord
  connect(input: ConnectInput): Promise<ConnectionRecord>
  revalidate(connectionId: string): Promise<ConnectionRecord>
  replaceCredential(connectionId: string, credential: Credential): Promise<ConnectionRecord>
  disconnect(connectionId: string): Promise<void>
}

export const createInMemoryConnectionRepository = (): ConnectionRepository => {
  const records = new Map<string, ConnectionRecord>()
  return {
    get(connectionId) {
      return records.get(connectionId)
    },
    list() {
      return Object.freeze(
        [...records.values()].sort((left, right) => left.label.localeCompare(right.label)),
      )
    },
    save(connection) {
      records.set(connection.connectionId, Object.freeze(structuredClone(connection)))
    },
    delete(connectionId) {
      records.delete(connectionId)
    },
  }
}

export const createConnectionService = (
  options: Readonly<{
    connections: ConnectionRepository
    credentials: CredentialStore
    drivers: readonly ConnectionDriver[]
    ids?: () => string
    now?: () => string
  }>,
): ConnectionService => {
  const drivers = new Map(options.drivers.map((driver) => [driver.type, driver]))
  if (drivers.size !== options.drivers.length)
    throw new TypeError('Connection driver types must be unique')
  const ids = options.ids ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const driverFor = (type: ConnectionType) => {
    const driver = drivers.get(type)
    if (driver === undefined) throw new ConnectionServiceError('CONNECTION_DRIVER_NOT_FOUND')
    return driver
  }
  const get = (connectionId: string) => {
    const connection = options.connections.get(connectionId)
    if (connection === undefined) throw new ConnectionServiceError('CONNECTION_NOT_FOUND')
    return connection
  }
  const validate = async (driver: ConnectionDriver, input: ConnectionValidationInput) => {
    try {
      return await driver.validate(input)
    } catch (cause) {
      if (cause instanceof ConnectionServiceError) throw cause
      throw new ConnectionServiceError('CONNECTION_VALIDATION_FAILED', { cause })
    }
  }
  const saveCredentialAndRecord = async (record: ConnectionRecord, credential: Credential) => {
    await options.credentials.modify(record.connectionId, async () => credential)
    try {
      options.connections.save(record)
    } catch (cause) {
      await options.credentials.delete(record.connectionId)
      throw cause
    }
    return record
  }

  return {
    list: () => options.connections.list(),
    get,
    async connect(input) {
      const driver = driverFor(input.type)
      const metadata = await validate(driver, {
        configuration: input.configuration,
        credential: input.credential,
      })
      const timestamp = now()
      const connectionId = input.connectionId ?? ids()
      const existing = options.connections.get(connectionId)
      return saveCredentialAndRecord(
        Object.freeze({
          connectionId,
          type: driver.type,
          category: driver.category,
          label: input.label.trim(),
          authority: driver.authority,
          configuration: structuredClone(input.configuration),
          metadata: structuredClone(metadata),
          status: 'CONNECTED' as const,
          validatedAt: timestamp,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        }),
        input.credential,
      )
    },
    async revalidate(connectionId) {
      const connection = get(connectionId)
      const credential = await options.credentials.read(connectionId)
      if (credential === undefined) throw new ConnectionServiceError('CREDENTIAL_NOT_FOUND')
      const metadata = await validate(driverFor(connection.type), {
        configuration: connection.configuration,
        credential,
      })
      const timestamp = now()
      const updated = Object.freeze({
        ...connection,
        metadata: structuredClone(metadata),
        status: 'CONNECTED' as const,
        validatedAt: timestamp,
        updatedAt: timestamp,
      })
      options.connections.save(updated)
      return updated
    },
    async replaceCredential(connectionId, credential) {
      const connection = get(connectionId)
      const metadata = await validate(driverFor(connection.type), {
        configuration: connection.configuration,
        credential,
      })
      const timestamp = now()
      return saveCredentialAndRecord(
        Object.freeze({
          ...connection,
          metadata: structuredClone(metadata),
          status: 'CONNECTED' as const,
          validatedAt: timestamp,
          updatedAt: timestamp,
        }),
        credential,
      )
    },
    async disconnect(connectionId) {
      get(connectionId)
      await options.credentials.delete(connectionId)
      options.connections.delete(connectionId)
    },
  }
}
