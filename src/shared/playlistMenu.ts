import type { PlaylistSummary } from './types'

/** One row in the "Add to playlist" submenu. `playlistId` is null for "New playlist…". */
export interface PlaylistMenuEntry {
  label: string
  playlistId: number | null
}

/**
 * Episodes a context-menu action applies to.
 *
 * When the clicked episode is part of the current selection, every selected
 * episode is included. Otherwise only the clicked episode is.
 */
export function episodeMenuTargets(clickedId: number, selectedIds: Iterable<number>): number[] {
  const selected: number[] = []
  const seen = new Set<number>()
  for (const id of selectedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    selected.push(id)
  }
  if (seen.has(clickedId)) return selected
  return [clickedId]
}

/** Existing playlists, then the command that names a new one. */
export function addToPlaylistMenu(playlists: Pick<PlaylistSummary, 'id' | 'name'>[]): PlaylistMenuEntry[] {
  return [
    ...playlists.map((playlist) => ({ label: playlist.name, playlistId: playlist.id })),
    { label: 'New playlist…', playlistId: null }
  ]
}

/** Toast copy for an add. Duplicates are reported as skipped, not as a failure. */
export function playlistAddedMessage(name: string, added: number, skipped: number): string {
  if (added === 0) return `Already in ${name}`
  const noun = added === 1 ? 'episode' : 'episodes'
  if (skipped === 0) return `Added ${added} ${noun} to ${name}`
  return `Added ${added} ${noun} to ${name} (${skipped} already there)`
}
