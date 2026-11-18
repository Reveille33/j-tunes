import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../src/main/db/migrations.ts'
import { artworkDataUrl } from './demoArtwork.ts'

const FEATURED = 'Glass Orchard'

interface DemoEpisode {
  title: string
  description: string
  daysAgo: number
  duration: number
}

interface DemoShow {
  title: string
  author: string
  color: [number, number, number]
  mark: 'ring' | 'bars' | 'diamond' | 'cross'
  episodes: DemoEpisode[]
}

const SHOWS: DemoShow[] = [
  {
    title: 'Lantern Hours',
    author: 'Mira Sol',
    color: [196, 92, 42],
    mark: 'ring',
    episodes: [
      {
        title: FEATURED,
        description: 'A walk through an orchard that only appears after dusk.',
        daysAgo: 2,
        duration: 40
      },
      {
        title: 'The Spare Key',
        description: 'What the night desk keeps in the drawer nobody labels.',
        daysAgo: 16,
        duration: 28 * 60
      },
      {
        title: 'Low Tide Letters',
        description: 'Notes washed up where the path used to be.',
        daysAgo: 40,
        duration: 34 * 60
      }
    ]
  },
  {
    title: 'Copper & Static',
    author: 'The Night Desk',
    color: [46, 92, 138],
    mark: 'bars',
    episodes: [
      {
        title: 'Wire Shed',
        description: 'A short history of a radio that only worked in the rain.',
        daysAgo: 5,
        duration: 51 * 60
      },
      {
        title: 'Call Sign Nowhere',
        description: 'Invented frequencies and the people who answered them.',
        daysAgo: 22,
        duration: 46 * 60
      }
    ]
  },
  {
    title: 'Field Notes from Nowhere',
    author: 'Juniper Hale',
    color: [42, 122, 86],
    mark: 'diamond',
    episodes: [
      {
        title: 'Map Without a North',
        description: 'How to get lost on purpose and still come home.',
        daysAgo: 9,
        duration: 37 * 60
      },
      {
        title: 'Pocket Survey',
        description: 'Measuring a kitchen with a piece of string.',
        daysAgo: 31,
        duration: 24 * 60
      }
    ]
  },
  {
    title: 'Kitchen Table Physics',
    author: 'Leo Park',
    color: [122, 72, 160],
    mark: 'cross',
    episodes: [
      {
        title: 'Boiling Point, Approximately',
        description: 'A kettle, a timer, and a very patient argument.',
        daysAgo: 12,
        duration: 29 * 60
      },
      {
        title: 'The Spoon Experiment',
        description: 'Why the handle is hot and the bowl is not.',
        daysAgo: 48,
        duration: 33 * 60
      }
    ]
  }
]

/** Fills `userDataDir` with a fake library. Nothing here is a real podcast. */
export function seedDemoLibrary(userDataDir: string): void {
  const downloadDir = join(userDataDir, 'downloads')
  mkdirSync(downloadDir, { recursive: true })

  const db = new Database(join(userDataDir, 'jtunes.db'))
  db.pragma('foreign_keys = ON')
  applyMigrations(db)

  const now = Date.now()
  const insertPodcast = db.prepare(
    `INSERT INTO podcasts
       (feed_url, title, author, description, artwork_url, category, language,
        subscribed_at, auto_download, is_active, sort_order, episode_count, last_episode_at)
     VALUES (?, ?, ?, ?, ?, 'Demo', 'en', ?, 0, 1, ?, ?, ?)`
  )
  const insertEpisode = db.prepare(
    `INSERT INTO episodes
       (podcast_id, guid, title, description, media_url, media_type, duration_secs,
        release_date, episode_number, season_number, download_state, played,
        play_position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'audio/wav', ?, ?, ?, 1, 'none', 0, 0, ?, ?)`
  )

  let featuredId: number | null = null
  const queued: number[] = []
  let sort = 0

  const seed = db.transaction(() => {
    for (const show of SHOWS) {
      const latest = Math.max(...show.episodes.map((episode) => now - episode.daysAgo * 86_400_000))
      const podcast = insertPodcast.run(
        `https://demo.invalid/${slug(show.title)}`,
        show.title,
        show.author,
        `A made-up show by ${show.author}, used only for screenshots.`,
        artworkDataUrl(show.color[0], show.color[1], show.color[2], show.mark),
        now,
        sort,
        show.episodes.length,
        latest
      )
      sort += 1
      const podcastId = Number(podcast.lastInsertRowid)

      show.episodes.forEach((episode, index) => {
        const created = insertEpisode.run(
          podcastId,
          `${slug(show.title)}-${index + 1}`,
          episode.title,
          episode.description,
          `https://demo.invalid/${slug(show.title)}/${slug(episode.title)}.wav`,
          episode.duration,
          now - episode.daysAgo * 86_400_000,
          show.episodes.length - index,
          now,
          now
        )
        const id = Number(created.lastInsertRowid)
        if (episode.title === FEATURED) featuredId = id
        else if (queued.length < 2) queued.push(id)
      })
    }
  })
  seed()

  if (featuredId === null) throw new Error('Demo library is missing the featured episode')

  const audioPath = join(downloadDir, 'glass-orchard.wav')
  writeSilenceWav(audioPath, 40)
  db.prepare(
    `UPDATE episodes
     SET file_path = ?, file_size = ?, download_state = 'done', play_position = 18, updated_at = ?
     WHERE id = ?`
  ).run(audioPath, 40 * 8000 * 2 + 44, now, featuredId)

  const insertChapter = db.prepare(
    'INSERT INTO chapters (episode_id, start_secs, title) VALUES (?, ?, ?)'
  )
  for (const chapter of [
    [0, 'Cold open'],
    [12, 'The gate'],
    [26, 'What the lantern shows']
  ] as const) {
    insertChapter.run(featuredId, chapter[0], chapter[1])
  }

  const insertQueue = db.prepare(
    'INSERT INTO play_queue (episode_id, position, added_at) VALUES (?, ?, ?)'
  )
  queued.forEach((id, index) => {
    insertQueue.run(id, index + 1, now)
    db.prepare('UPDATE episodes SET played = 1, play_position = 0 WHERE id = ?').run(id)
  })

  const insertStat = db.prepare('INSERT INTO listening_stats (day, seconds) VALUES (?, ?)')
  for (let ago = 0; ago < 10; ago += 1) {
    const date = new Date(now - ago * 86_400_000)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    insertStat.run(key, 20 * 60 + ((ago * 17) % 50) * 60)
  }

  const put = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
  for (const [key, value] of [
    ['theme', 'dark'],
    ['downloadDir', downloadDir],
    ['checkUpdatesOnStartup', 'false'],
    ['notifyOnNewEpisodes', 'false'],
    ['autoDownloadDefault', 'false'],
    ['globalDescriptionsVisible', 'true']
  ] as const) {
    put.run(key, value, now)
  }

  db.close()
}

function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
  for (const migration of MIGRATIONS) {
    if (applied.get(migration.version)) continue
    db.transaction(() => {
      db.exec(migration.sql)
      record.run(migration.version, Date.now())
    })()
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function writeSilenceWav(file: string, seconds: number): void {
  const sampleRate = 8000
  const dataBytes = sampleRate * seconds * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataBytes, 40)
  writeFileSync(file, wav)
}
