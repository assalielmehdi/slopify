import type { Credential, CredentialStore } from './credential-store.js'
import type { ConnectionCatalog } from './connection-catalog.js'

export type ConnectionType = 'gitlab' | 'clickup' | 'figma' | 'openrouter' | 'chatgpt-subscription'
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
  getByType(type: ConnectionType): ConnectionRecord | undefined
  list(): readonly ConnectionRecord[]
  save(connection: ConnectionRecord): void
  delete(connectionId: string): void
}

export interface ConnectionValidationInput {
  readonly configuration: unknown
  readonly credential?: Credential
  readonly signal?: AbortSignal
}

export interface ConnectionDriver {
  readonly type: ConnectionType
  readonly category: ConnectionCategory
  readonly credential: 'required' | 'none'
  readonly authority: string
  validate(input: ConnectionValidationInput): Promise<unknown>
}

export type ConnectionServiceErrorCode =
  | 'CONNECTION_ALREADY_EXISTS'
  | 'CONNECTION_DRIVER_NOT_FOUND'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_TYPE_UNSUPPORTED'
  | 'CONNECTION_VALIDATION_FAILED'
  | 'CREDENTIAL_NOT_FOUND'

export class ConnectionServiceError extends Error {
  override readonly name = 'ConnectionServiceError'
  constructor(
    readonly code: ConnectionServiceErrorCode,
    options?: Readonly<{ cause?: unknown; message?: string }>,
  ) {
    super(
      options?.message ?? code,
      options?.cause === undefined ? undefined : { cause: options.cause },
    )
  }
}

export interface ConnectInput {
  readonly type: ConnectionType
  readonly configuration: unknown
  readonly credential?: Credential
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
    getByType(type) {
      return [...records.values()].find((record) => record.type === type)
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
    catalog: ConnectionCatalog
    drivers: readonly ConnectionDriver[]
    now?: () => string
  }>,
): ConnectionService => {
  const drivers = new Map(options.drivers.map((driver) => [driver.type, driver]))
  if (drivers.size !== options.drivers.length)
    throw new TypeError('Connection driver types must be unique')
  const now = options.now ?? (() => new Date().toISOString())
  const catalogEntryFor = (type: ConnectionType) => {
    const entry = options.catalog.list().find((candidate) => candidate.type === type)
    if (entry === undefined) throw new ConnectionServiceError('CONNECTION_TYPE_UNSUPPORTED')
    return entry
  }
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
  const saveCredentialAndRecord = async (
    record: ConnectionRecord,
    credential: Credential | undefined,
  ) => {
    if (credential === undefined) await options.credentials.delete(record.connectionId)
    else await options.credentials.modify(record.connectionId, async () => credential)
    try {
      options.connections.save(record)
    } catch (cause) {
      if (credential !== undefined) await options.credentials.delete(record.connectionId)
      throw cause
    }
    return record
  }

  return {
    list: () => options.connections.list(),
    get,
    async connect(input) {
      const entry = catalogEntryFor(input.type)
      const driver = driverFor(input.type)
      if (entry.category !== driver.category)
        throw new ConnectionServiceError('CONNECTION_TYPE_UNSUPPORTED')
      if (options.connections.getByType(input.type) !== undefined)
        throw new ConnectionServiceError('CONNECTION_ALREADY_EXISTS')
      if (driver.credential === 'required' && input.credential === undefined)
        throw new ConnectionServiceError('CREDENTIAL_NOT_FOUND')
      if (driver.credential === 'none' && input.credential !== undefined)
        throw new ConnectionServiceError('CONNECTION_TYPE_UNSUPPORTED')
      const metadata = await validate(driver, {
        configuration: input.configuration,
        ...(input.credential === undefined ? {} : { credential: input.credential }),
      })
      const timestamp = now()
      const connectionId = `${entry.type}-default`
      return saveCredentialAndRecord(
        Object.freeze({
          connectionId,
          type: driver.type,
          category: driver.category,
          label: entry.name,
          authority: driver.authority,
          configuration: structuredClone(input.configuration),
          metadata: structuredClone(metadata),
          status: 'CONNECTED' as const,
          validatedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        input.credential,
      )
    },
    async revalidate(connectionId) {
      const connection = get(connectionId)
      const driver = driverFor(connection.type)
      let credential = await options.credentials.read(connectionId)
      if (driver.credential === 'required' && credential === undefined)
        throw new ConnectionServiceError('CREDENTIAL_NOT_FOUND')
      if (driver.credential === 'none' && credential !== undefined) {
        await options.credentials.delete(connectionId)
        credential = undefined
      }
      const metadata = await validate(driver, {
        configuration: connection.configuration,
        ...(credential === undefined ? {} : { credential }),
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
      const driver = driverFor(connection.type)
      if (driver.credential === 'none')
        throw new ConnectionServiceError('CONNECTION_TYPE_UNSUPPORTED')
      const metadata = await validate(driver, {
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
