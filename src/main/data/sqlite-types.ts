export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDatabase {
  pragma(source: string, options?: { simple?: boolean }): unknown
  exec(source: string): this
  prepare(source: string): SqliteStatement
  transaction<T>(fn: () => T): () => T
  close(): void
}
