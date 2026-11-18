import { describe, it, expect } from 'vitest'
import { playbackErrorMessage } from '../src/shared/playbackError'

describe('playback error message', () => {
  it('describes the media error instead of failing silently', () => {
    expect(playbackErrorMessage(2)).toBe('Playback failed: network error')
    expect(playbackErrorMessage(3)).toBe('Playback failed: the audio could not be decoded')
    expect(playbackErrorMessage(4)).toBe('Playback failed: unsupported audio')
    expect(playbackErrorMessage(null)).toBe('Playback failed')
  })
})