import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PlaylistRepo } from '../src/main/db/repositories/playlistRepo'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { SearchRepo } from '../src/main/db/repositories/searchRepo'
import { addEpisodesToPlaylist, readPlaylist } from '../src/main/services/playlistAdd'
import {
  episodeContextMenuSchema,
  playlistAddSchema,
  playlistIdSchema,
  playlistRemoveSchema
} from '../src/shared/validation'
import {
  addToPlaylistMenu,
  episodeMenuTargets,
  playlistAddedMessage
} from '../src/shared/playlistMenu'
import type { ParsedEpisode } from '../src/shared/types'

function episode(guid: string): ParsedEpisode {
  return {
    guid,
    title: guid,
    description: null,
    descriptionHtml: null,
    mediaUrl: 'https://example.com/ep.mp3',
    mediaType: 'audio/mpeg',
    mediaLength: 1000,
    durationSecs: 60,
    releaseDate: 1,
    episodeNumber: null,
    seasonNumber: null,
    artworkUrl: null
  }
}

describe('playlists', () => {
  let db: Db
  let playlists: PlaylistRepo
  let episodeIds: number[]

  beforeEach(() => {
    db = createInMemoryDb()
    playlists = new PlaylistRepo(db)
    const podcasts = new PodcastRepo(db)
    const episodes = new EpisodeRepo(db)
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    episodeIds = episodes.insertMany(podcast.id, [episode('a'), episode('b'), episode('c')])
  })

  it('creates the playlist tables', () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name)
    expect(names).toContain('playlists')
    expect(names).toContain('playlist_episodes')
  })

  it('appends episodes and skips ones already in the playlist', () => {
    const playlist = playlists.create('Road trips')
    const first = playlists.addEpisodes(playlist.id, [episodeIds[1], episodeIds[0]])
    expect(first).toEqual({ added: 2, skipped: 0 })
    expect(playlists.episodeIds(playlist.id)).toEqual([episodeIds[1], episodeIds[0]])

    const second = playlists.addEpisodes(playlist.id, [episodeIds[0], episodeIds[2], episodeIds[0]])
    expect(second).toEqual({ added: 1, skipped: 2 })
    expect(playlists.episodeIds(playlist.id)).toEqual([episodeIds[1], episodeIds[0], episodeIds[2]])
    expect(playlists.getById(playlist.id)?.episodeCount).toBe(3)
  })

  it('skips unknown episodes and drops membership when an episode is deleted', () => {
    const playlist = playlists.create('Keepers')
    const result = playlists.addEpisodes(playlist.id, [episodeIds[0], 999999])
    expect(result).toEqual({ added: 1, skipped: 1 })

    db.prepare('DELETE FROM episodes WHERE id = ?').run(episodeIds[0])
    expect(playlists.episodeIds(playlist.id)).toEqual([])
    expect(playlists.getById(playlist.id)?.episodeCount).toBe(0)
  })

  it('rejects an unknown playlist', () => {
    expect(() => playlists.addEpisodes(404, [episodeIds[0]])).toThrow('Playlist not found')
  })

  it('removes one episode and keeps the remaining order', () => {
    const playlist = playlists.create('Road trips')
    playlists.addEpisodes(playlist.id, episodeIds)
    playlists.removeEpisode(playlist.id, episodeIds[1])
    playlists.removeEpisode(playlist.id, 999999)
    expect(playlists.episodeIds(playlist.id)).toEqual([episodeIds[0], episodeIds[2]])
    expect(playlists.getById(playlist.id)?.episodeCount).toBe(2)
    expect(() => playlists.removeEpisode(404, episodeIds[0])).toThrow('Playlist not found')
  })

  it('reads a playlist in saved order', () => {
    const created = addEpisodesToPlaylist(playlists, {
      target: 'new',
      name: 'Morning',
      episodeIds: [episodeIds[2], episodeIds[0]]
    })
    const detail = readPlaylist(playlists, new SearchRepo(db), created.playlist.id)
    expect(detail.playlist.name).toBe('Morning')
    expect(detail.episodes.map((episode) => episode.guid)).toEqual(['c', 'a'])
    expect(() => readPlaylist(playlists, new SearchRepo(db), 404)).toThrow('Playlist not found')
  })

  it('creates a playlist from the add call and reports skips on a second add', () => {
    const created = addEpisodesToPlaylist(playlists, {
      target: 'new',
      name: 'Morning',
      episodeIds: [episodeIds[0], episodeIds[1]]
    })
    expect(created.playlist.name).toBe('Morning')
    expect(created.added).toBe(2)
    expect(created.skipped).toBe(0)
    expect(playlists.list().map((playlist) => playlist.name)).toEqual(['Morning'])

    const again = addEpisodesToPlaylist(playlists, {
      target: 'existing',
      playlistId: created.playlist.id,
      episodeIds: [episodeIds[1]]
    })
    expect(again).toMatchObject({ added: 0, skipped: 1 })
    expect(again.playlist.episodeCount).toBe(2)
  })
})

describe('playlist add schema', () => {
  it('accepts an existing playlist and a new name', () => {
    expect(
      playlistAddSchema.parse({ target: 'existing', playlistId: 3, episodeIds: [1, 2] })
    ).toMatchObject({ target: 'existing', playlistId: 3 })
    const created = playlistAddSchema.parse({ target: 'new', name: '  Sunday  ', episodeIds: [4] })
    expect(created.target).toBe('new')
    if (created.target === 'new') expect(created.name).toBe('Sunday')
  })

  it('rejects a blank name, an empty episode list, and a non-numeric id', () => {
    expect(() => playlistAddSchema.parse({ target: 'new', name: '   ', episodeIds: [1] })).toThrow()
    expect(() =>
      playlistAddSchema.parse({ target: 'existing', playlistId: 1, episodeIds: [] })
    ).toThrow()
    expect(() => episodeContextMenuSchema.parse({ episodeIds: ['nope'] })).toThrow()
    expect(() => playlistIdSchema.parse({ playlistId: 0 })).toThrow()
    expect(() => playlistRemoveSchema.parse({ playlistId: 1, episodeId: 'x' })).toThrow()
    expect(playlistRemoveSchema.parse({ playlistId: 2, episodeId: 5 })).toEqual({
      playlistId: 2,
      episodeId: 5
    })
  })
})

describe('playlist menu', () => {
  it('lists saved playlists and then New playlist', () => {
    expect(addToPlaylistMenu([{ id: 2, name: 'Sunday' }])).toEqual([
      { label: 'Sunday', playlistId: 2 },
      { label: 'New playlist…', playlistId: null }
    ])
  })

  it('uses the selection only when the clicked episode is part of it', () => {
    expect(episodeMenuTargets(4, [1, 4, 9])).toEqual([1, 4, 9])
    expect(episodeMenuTargets(4, [1, 9])).toEqual([4])
    expect(episodeMenuTargets(4, [])).toEqual([4])
  })

  it('describes a successful add and an all-duplicate add', () => {
    expect(playlistAddedMessage('Sunday', 1, 0)).toBe('Added 1 episode to Sunday')
    expect(playlistAddedMessage('Sunday', 2, 1)).toBe('Added 2 episodes to Sunday (1 already there)')
    expect(playlistAddedMessage('Sunday', 0, 2)).toBe('Already in Sunday')
  })
})
