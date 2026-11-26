import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

let instance: Db | null = null

/**
 * Applies the performance pragmas. WAL lets the renderer keep reading while
 * the main process writes, which matters during a bulk import.
 */
function applyPragmas(db: Db): void {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('cache_size = -64000') // 64 MB
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 268435456') // 256 MB
}

/**
 * Runs the ordered migration files inside a transaction each, recording
 * applied versions in `schema_migrations` so re-running is a no-op.
 */
export function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')

  // 006 rebuilds podcasts. With foreign keys on, dropping that table would
  // cascade-delete every episode. The pragma cannot change inside a transaction.
  const foreignKeys = db.pragma('foreign_keys', { simple: true })
  db.pragma('foreign_keys = OFF')
  try {
    for (const migration of MIGRATIONS) {
      if (isApplied.get(migration.version)) continue

      db.transaction(() => {
        db.exec(migration.sql)
        record.run(migration.version, Date.now())
      })()
    }
  } finally {
    if (foreignKeys) db.pragma('foreign_keys = ON')
  }
}

/** Opens (and memoises) the application database. */
export function getDb(): Db {
  if (instance) return instance

  const dbPath = join(app.getPath('userData'), 'jtunes.db')
  mkdirSync(dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  applyPragmas(db)
  runMigrations(db)
  instance = db
  return db
}

/** Opens an in-memory database with the full schema applied (used by tests). */
export function createInMemoryDb(): Db {
  const db = new Database(':memory:')
  applyPragmas(db)
  runMigrations(db)
  return db
}

export function closeDb(): void {
  if (instance) {
    instance.close()
    instance = null
  }
}
