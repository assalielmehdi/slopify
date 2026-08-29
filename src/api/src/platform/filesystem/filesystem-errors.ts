export type FilesystemResourceErrorCode =
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_TOO_LARGE'
  | 'RESOURCE_MALFORMED'
  | 'RESOURCE_VALIDATION_FAILED'
  | 'RESOURCE_REVISION_CONFLICT'
  | 'RESOURCE_SYMLINK_NOT_ALLOWED'
  | 'RESOURCE_NOT_FILE'
  | 'RESOURCE_READ_FAILED'
  | 'RESOURCE_WRITE_FAILED'

export class FilesystemResourceError extends Error {
  readonly code: FilesystemResourceErrorCode
  readonly path: string

  constructor(
    code: FilesystemResourceErrorCode,
    message: string,
    input: Readonly<{ path: string; cause?: unknown }>,
  ) {
    super(message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'FilesystemResourceError'
    this.code = code
    this.path = input.path
  }
}
