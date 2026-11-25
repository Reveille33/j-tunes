import type { PlaylistRepo } from '../db/repositories/playlistRepo'
import type { PlaylistAddInput } from '@shared/validation'
import type { PlaylistAddResult } from '@shared/types'

/**
 * Adds episodes to an existing playlist, or creates one and then adds them.
 *
 * Episodes already in the playlist are skipped. The returned summary includes
 * the rows this call inserted.
 */
export function addEpisodesToPlaylist(
  playlists: PlaylistRepo,
  input: PlaylistAddInput
): PlaylistAddResult {
  const playlistId =
    input.target === 'new' ? playlists.create(input.name).id : input.playlistId
  const counts = playlists.addEpisodes(playlistId, input.episodeIds)
  const playlist = playlists.getById(playlistId)
  if (!playlist) throw new Error('Playlist not found')
  return { playlist, ...counts }
}
