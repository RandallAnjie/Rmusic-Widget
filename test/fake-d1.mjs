import { DatabaseSync } from 'node:sqlite'

export class FakeD1 {
  constructor () {
    this.database = new DatabaseSync(':memory:')
    this.database.exec('PRAGMA foreign_keys = ON')
  }

  async exec (sql) {
    this.database.exec(sql)
    return { count: 0, duration: 0 }
  }

  prepare (sql) {
    return new FakeD1Statement(this.database, sql)
  }

  async batch (statements) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((statement) => statement.execute())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

class FakeD1Statement {
  constructor (database, sql, values = []) {
    this.database = database
    this.sql = sql
    this.values = values
  }

  bind (...values) {
    return new FakeD1Statement(this.database, this.sql, values)
  }

  async first () {
    return this.database.prepare(this.sql).get(...this.values)
  }

  async all () {
    return { results: this.database.prepare(this.sql).all(...this.values) }
  }

  async run () {
    return this.execute()
  }

  execute () {
    const result = this.database.prepare(this.sql).run(...this.values)
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0)
      }
    }
  }
}
