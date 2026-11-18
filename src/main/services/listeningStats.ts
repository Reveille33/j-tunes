/** Jumps larger than this are seeks, not listened time. */
export const LISTENED_SEEK_CAP_SECONDS = 90

/**
 * Seconds of real listening between two saved playheads.
 *
 * Marking an episode played clears `play_position` to 0 while the playhead
 * is still near the end. That jump must not be added again: the time was
 * already counted as playback advanced. A short step from 0 still counts,
 * so replaying a finished episode from the start is recorded.
 */
export function listeningIncrement(
  previousPosition: number,
  position: number,
  alreadyPlayed: boolean
): number {
  const delta = position - previousPosition
  if (!(delta > 0 && delta <= LISTENED_SEEK_CAP_SECONDS)) return 0
  if (alreadyPlayed && previousPosition === 0 && delta > 10) return 0
  return delta
}
