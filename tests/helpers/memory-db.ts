import type { SqliteDatabase, SqliteStatement } from '../../src/main/data/sqlite-types'

type Row = Record<string, unknown>

export class MemoryDatabase implements SqliteDatabase {
  private readonly tables = new Map<string, Row[]>()
  private rowid = 1

  prepare(source: string): SqliteStatement {
    const sql = source.replace(/\s+/g, ' ').trim()
    return {
      run: (...params: unknown[]) => {
        this.run(sql, params)
        return { changes: 1, lastInsertRowid: this.rowid }
      },
      get: (...params: unknown[]) => this.query(sql, params)[0],
      all: (...params: unknown[]) => this.query(sql, params)
    }
  }

  pragma(): unknown {
    return undefined
  }

  exec(): this {
    return this
  }

  transaction<T>(fn: () => T): () => T {
    return () => fn()
  }

  close(): void {}

  private rows(name: string): Row[] {
    const key = name.toLowerCase()
    const existing = this.tables.get(key)
    if (existing) return existing
    const created: Row[] = []
    this.tables.set(key, created)
    return created
  }

  private run(sql: string, params: unknown[]): void {
    const insert = /^INSERT INTO (\w+)\(([^)]+)\) VALUES \((.+)\)(?: ON CONFLICT\((\w+)\) DO UPDATE SET .+)?$/i.exec(sql)
    if (insert) {
      const columns = insert[2].split(',').map((item) => item.trim())
      const row: Row = { _rowid: this.rowid++ }
      columns.forEach((column, index) => {
        row[column] = params[index]
      })
      const table = this.rows(insert[1])
      const key = insert[4]
      if (key) {
        const existing = table.find((item) => item[key] === row[key])
        if (existing) {
          Object.assign(existing, row)
          return
        }
      }
      table.push(row)
      return
    }
    const update = /^UPDATE (\w+) SET (.+) WHERE (\w+) = \?$/i.exec(sql)
    if (update) {
      const assignments = update[2].split(',').map((item) => item.trim())
      const id = params[assignments.length]
      const row = this.rows(update[1]).find((item) => item[update[3]] === id)
      if (!row) return
      assignments.forEach((assignment, index) => {
        const column = assignment.split('=')[0].trim()
        row[column] = params[index]
      })
      return
    }
    const remove = /^DELETE FROM (\w+)(?: WHERE (\w+) = \?)?$/i.exec(sql)
    if (remove) {
      const table = this.rows(remove[1])
      if (!remove[2]) {
        table.splice(0, table.length)
        return
      }
      const kept = table.filter((item) => item[remove[2]] !== params[0])
      table.splice(0, table.length, ...kept)
    }
  }

  private query(sql: string, params: unknown[]): Row[] {
    if (/^SELECT COUNT\(\*\) AS count /i.test(sql)) {
      const from = /FROM (\w+)/i.exec(sql)
      return [{ count: from ? this.rows(from[1]).length : 0 }]
    }
    const ordered = sql.match(/ ORDER BY (.+)$/i)?.[1] ?? ''
    const body = sql.replace(/ ORDER BY .+$/i, '')
    const match = /^SELECT (.+) FROM (\w+)(?: WHERE (.+))?$/i.exec(body)
    if (!match) return []
    let rows = [...this.rows(match[2])]
    const where = match[3]
    if (where) {
      if (/^(\w+) = \?$/i.test(where)) {
        const column = where.split('=')[0].trim()
        rows = rows.filter((row) => row[column] === params[0])
      } else if (/^lower\((\w+)\) LIKE \?$/i.test(where)) {
        const column = /lower\((\w+)\)/i.exec(where)?.[1] ?? ''
        const needle = String(params[0]).replaceAll('%', '').toLowerCase()
        rows = rows.filter((row) => String(row[column] ?? '').toLowerCase().includes(needle))
      }
    }
    if (/updated_at DESC/i.test(ordered)) {
      rows.sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
    } else if (/created_at/i.test(ordered)) {
      rows.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || Number(left._rowid) - Number(right._rowid))
    }
    return rows.map((row) => this.project(match[1], row))
  }

  private project(selectList: string, row: Row): Row {
    const projected: Row = {}
    for (const part of selectList.split(',')) {
      const matched = /^(?:lower\()?([\w*]+)\)?(?:\s+AS\s+(\w+))?$/i.exec(part.trim())
      if (!matched) continue
      const source = matched[1]
      const name = matched[2] ?? source
      projected[name] = source === '*' ? row : row[source]
    }
    return projected
  }
}
