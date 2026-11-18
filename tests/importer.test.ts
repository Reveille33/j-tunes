import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { ImportJobRepo } from '../src/main/db/repositories/importJobRepo'
import {
  Importer,
  normaliseTitle,
  titleFromFileName,
  isSupportedAudio
} from '../src/main/services/importer'
import * as fsHelpers from '../src/main/util/fsHelpers'
import { parseFile } from 'music-metadata'

vi.mock('music-metadata', () => ({
  parseFile: vi.fn()
}))

describe('normaliseTitle, titleFromFileName, isSupportedAudio', () => {
  it('normalises titles consistently', () => {
    expect(normaliseTitle('Radiolab: Colors!')).toBe('radiolab colors')
    expect(normaliseTitle('Episode #42 - The "Best" Show')).toBe('episode 42 the best show')
    expect(normaliseTitle('   lots   of   spaces   ')).toBe('lots of spaces')
  })

  it('extracts episode titles from filenames', () => {
    expect(titleFromFileName('/music/01_My-Awesome_Episode.mp3')).toBe('01 My Awesome Episode')
  })

  it('identifies supported audio extensions', () => {
    expect(isSupportedAudio('track.mp3')).toBe(true)
    expect(isSupportedAudio('track.m4a')).toBe(true)
    expect(isSupportedAudio('track.wav')).toBe(true)
    expect(isSupportedAudio('image.jpg')).toBe(false)
    expect(isSupportedAudio('notes.pdf')).toBe(false)
  })
})

describe('Importer service', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let jobs: ImportJobRepo
  let importer: Importer

  beforeEach(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    jobs = new ImportJobRepo(db)
    importer = new Importer({ episodes, podcasts, jobs })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resets cancelled state at start of run() so subsequent runs succeed', async () => {
    vi.spyOn(fsHelpers, 'listFilesRecursive').mockResolvedValue([
      '/audio/ep1.mp3',
      '/audio/ep2.mp3'
    ])
    vi.spyOn(fsHelpers, 'fileSize').mockResolvedValue(1000)
    vi.mocked(parseFile).mockResolvedValue({
      common: { title: 'Episode One' },
      format: { duration: 120 }
    } as any)

    // Pre-cancel the importer
    importer.cancel()

    // Running should reset cancelled to false and process the files
    const result = await importer.run(['/audio'])
    expect(result.cancelled).toBe(false)
    expect(result.filesSeen).toBe(2)
  })

  it('consumes matches so duplicate files do not overwrite the same episode', async () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    const [epId] = episodes.insertMany(podcast.id, [
      {
        guid: 'guid-1',
        title: 'Special Episode',
        description: null,
        descriptionHtml: null,
        mediaUrl: 'https://example.com/1.mp3',
        mediaType: 'audio/mpeg',
        mediaLength: 1000,
        durationSecs: 300,
        releaseDate: Date.now(),
        episodeNumber: 1,
        seasonNumber: 1,
        artworkUrl: null
      }
    ])

    // Two files on disk with the same title
    vi.spyOn(fsHelpers, 'listFilesRecursive').mockResolvedValue([
      '/audio/Special Episode.mp3',
      '/audio/Special Episode duplicate.mp3'
    ])
    vi.spyOn(fsHelpers, 'fileSize').mockResolvedValue(2048)
    vi.mocked(parseFile).mockResolvedValue({
      common: { title: 'Special Episode', album: 'Show' },
      format: { duration: 300 }
    } as any)

    const result = await importer.run(['/audio'])

    // First file matches the existing episode
    expect(result.filesMatched).toBe(1)
    // Second duplicate file should not match the same episode; it creates a new imported episode
    expect(result.filesAdded).toBe(1)

    // Check that original episode has the first file attached
    const original = episodes.getById(epId)
    expect(original?.file_path).toBe('/audio/Special Episode.mp3')

    // And an additional episode was created for the second duplicate
    const all = episodes.listForPodcast(podcast.id)
    expect(all.length).toBe(2)
  })
})
