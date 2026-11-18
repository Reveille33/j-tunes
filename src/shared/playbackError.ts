/** A short message for an HTMLMediaElement error, shown in the player and a toast. */
export function playbackErrorMessage(code: number | null | undefined): string {
  switch (code) {
    case 2:
      return 'Playback failed: network error'
    case 3:
      return 'Playback failed: the audio could not be decoded'
    case 4:
      return 'Playback failed: unsupported audio'
    default:
      return 'Playback failed'
  }
}
