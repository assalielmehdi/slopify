import { PersistenceError } from './errors.js'

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export const serializeJson = (value: JsonValue, field: string): string => {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new PersistenceError({
      code: 'PERSISTENCE_VALIDATION_FAILED',
      message: `${field} must be JSON serializable`,
      details: { field },
    })
  }
  return serialized
}

export const parseJson = (value: string): JsonValue => JSON.parse(value) as JsonValue
