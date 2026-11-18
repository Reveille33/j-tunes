import type { Db } from '../connection'

export interface ImportJob {
  id: number
  sourceDir: string
  startedAt: number
  finishedAt: number | null
  filesSeen: number
  filesMatched: number
  filesAdded: number
  filesSkipped: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
}

/**
 * Records legacy import runs so the outcome of each import is auditable.
 */
export class ImportJobRepo {
  constructor(private readonly db: Db) {}

  create(sourceDir: string): number {
    const info = this.db
      .prepare('INSERT INTO import_jobs (source_dir, started_at, status) VALUES (?, ?, ?)')
      .run(sourceDir, Date.now(), 'running')
    return Number(info.lastInsertRowid)
  }

  finish(
    id: number,
    counts: { seen: number; matched: number; added: number; skipped: number },
    status: ImportJob['status']
  ): void {
    this.db
      .prepare(
        `UPDATE import_jobs SET
           finished_at = ?,
           files_seen = ?,
           files_matched = ?,
           files_added = ?,
           files_skipped = ?,
           status = ?
         WHERE id = ?`
      )
      .run(
        Date.now(),
        counts.seen,
        counts.matched,
        counts.added,
        counts.skipped,
        status,
        id
      )
  }

  list(limit = 20): ImportJob[] {
    const rows = this.db
      .prepare('SELECT * FROM import_jobs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as {
      id: number
      source_dir: string
      started_at: number
      finished_at: number | null
      files_seen: number
      files_matched: number
      files_added: number
      files_skipped: number
      status: string
    }[]

    return rows.map((r) => ({
      id: r.id,
      sourceDir: r.source_dir,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      filesSeen: r.files_seen,
      filesMatched: r.files_matched,
      filesAdded: r.files_added,
      filesSkipped: r.files_skipped,
      status: r.status as ImportJob['status']
    }))
  }
}
