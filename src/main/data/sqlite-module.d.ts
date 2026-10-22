declare module 'better-sqlite3-multiple-ciphers' {
  interface Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }

  interface Database {
    pragma(source: string, options?: { simple?: boolean }): unknown
    exec(source: string): this
    prepare(source: string): Statement
    transaction<T>(fn: () => T): () => T
    close(): void
  }

  interface DatabaseConstructor {
    new (filename: string): Database
  }

  const Database: DatabaseConstructor
  export default Database
}
