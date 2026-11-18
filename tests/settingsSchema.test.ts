import { describe, it, expect } from 'vitest'
import { settingsSetSchema } from '../src/shared/validation'

describe('settings:set schema', () => {
  it('accepts a value that matches the key', () => {
    expect(settingsSetSchema.parse({ key: 'theme', value: 'light' })).toEqual({
      key: 'theme',
      value: 'light'
    })
    expect(settingsSetSchema.parse({ key: 'defaultVolume', value: 0.5 }).value).toBe(0.5)
    expect(
      settingsSetSchema.parse({ key: 'globalDescriptionsVisible', value: true }).value
    ).toBe(true)
  })

  it('rejects a value of the wrong type for that key', () => {
    expect(() => settingsSetSchema.parse({ key: 'theme', value: 'blue' })).toThrow()
    expect(() => settingsSetSchema.parse({ key: 'autoDownloadDefault', value: 'yes' })).toThrow()
    expect(() => settingsSetSchema.parse({ key: 'defaultVolume', value: 2 })).toThrow()
    expect(() => settingsSetSchema.parse({ key: 'downloadDir', value: 12 })).toThrow()
  })
})