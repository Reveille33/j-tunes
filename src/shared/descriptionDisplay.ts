/**
 * How an episode description is drawn.
 *
 * `brief` is the one-line clamp. `capped` is the click-to-expand view, still
 * limited in height. `full` is the whole sanitized plain-text description.
 */
export type EpisodeDescriptionDisplay = 'hidden' | 'brief' | 'capped' | 'full'

export function episodeDescriptionDisplay(
  visible: boolean,
  full: boolean,
  expanded: boolean
): EpisodeDescriptionDisplay {
  if (full) return 'full'
  if (!visible) return 'hidden'
  return expanded ? 'capped' : 'brief'
}

/** The podcast header stays clamped until full descriptions are turned on. */
export function podcastDescriptionClamped(full: boolean): boolean {
  return !full
}
