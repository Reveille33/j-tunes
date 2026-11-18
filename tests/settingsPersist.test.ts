import { describe, it, expect } from 'vitest'
import { canPersistSetting } from '../src/shared/settingsPersist'

describe('settings persistence', () => {
  it('does not write a setting before hydration', () => {
    expect(canPersistSetting(false)).toBe(false)
    expect(canPersistSetting(true)).toBe(true)
  })
})