import { describe, it, expect } from 'vitest'
import {
  episodeDescriptionDisplay,
  podcastDescriptionClamped
} from '../src/shared/descriptionDisplay'

describe('description display', () => {
  it('keeps the current clamps unless full descriptions are on', () => {
    expect(episodeDescriptionDisplay(false, false, false)).toBe('hidden')
    expect(episodeDescriptionDisplay(true, false, false)).toBe('brief')
    expect(episodeDescriptionDisplay(true, false, true)).toBe('capped')
    expect(podcastDescriptionClamped(false)).toBe(true)
  })

  it('shows the whole description when the setting is on', () => {
    expect(episodeDescriptionDisplay(false, true, false)).toBe('full')
    expect(episodeDescriptionDisplay(true, true, false)).toBe('full')
    expect(podcastDescriptionClamped(true)).toBe(false)
  })
})