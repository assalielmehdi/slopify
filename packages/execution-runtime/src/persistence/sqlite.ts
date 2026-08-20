import { Database as BunDatabase, type Changes, type DatabaseOptions } from 'bun:sqlite'

type StatementMethod = (...parameters: readonly unknown[]) => unknown

export interface Statement {
  all(...parameters: readonly unknown[]): unknown[]
  get(...parameters: readonly unknown[]): unknown
  run(...parameters: readonly unknown[]): Changes
  pluck(): Statement
}

type Transaction<Parameters extends readonly unknown[], Result> = ((
  ...parameters: Parameters
) => Result) & {
  deferred(...parameters: Parameters): Result
  immediate(...parameters: Parameters): Result
  exclusive(...parameters: Parameters): Result
}

class StatementAdapter implements Statement {
  constructor(
    private readonly statement: ReturnType<BunDatabase['prepare']>,
    private readonly plucked = false,
  ) {}

  all(...parameters: readonly unknown[]): unknown[] {
    if (this.plucked) {
      const rows = (this.statement.values as StatementMethod)(...parameters) as unknown[][]
      return rows.map((row) => row[0])
    }
    return (this.statement.all as StatementMethod)(...parameters) as unknown[]
  }

  get(...parameters: readonly unknown[]): unknown {
    if (this.plucked) {
      const rows = (this.statement.values as StatementMethod)(...parameters) as unknown[][]
      return rows[0]?.[0]
    }
    return (this.statement.get as StatementMethod)(...parameters) ?? undefined
  }

  run(...parameters: readonly unknown[]): Changes {
    return (this.statement.run as StatementMethod)(...parameters) as Changes
  }

  pluck(): Statement {
    return new StatementAdapter(this.statement, true)
  }
}

export class Database {
  private readonly database: BunDatabase
  private closed = false

  constructor(filename: string, options?: number | DatabaseOptions) {
    this.database = new BunDatabase(filename, options)
  }

  get open(): boolean {
    return !this.closed
  }

  close(): void {
    if (this.closed) return
    this.database.close()
    this.closed = true
  }

  exec(sql: string): Changes {
    return this.database.exec(sql)
  }

  prepare(sql: string): Statement {
    return new StatementAdapter(this.database.prepare(sql))
  }

  pragma(source: string, options?: { readonly simple?: boolean }): unknown {
    const statement = this.database.prepare(`PRAGMA ${source}`)
    if (options?.simple === true) return statement.values()[0]?.[0]
    return statement.all()
  }

  transaction<Parameters extends readonly unknown[], Result>(
    callback: (...parameters: Parameters) => Result,
  ): Transaction<Parameters, Result> {
    return this.database.transaction(callback) as Transaction<Parameters, Result>
  }
}
