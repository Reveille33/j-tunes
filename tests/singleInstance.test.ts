import { describe, it, expect, vi } from 'vitest'
import { bindSingleInstance } from '../src/main/singleInstance'

describe('single instance lock', () => {
  it('quits a second process without registering startup handlers', () => {
    const quit = vi.fn()
    const on = vi.fn()
    const whenReady = vi.fn()

    bindSingleInstance({
      gotLock: false,
      quit,
      on,
      whenReady,
      onSecondInstance: () => undefined,
      onReady: () => undefined,
      onWindowAllClosed: () => undefined
    })

    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
    expect(whenReady).not.toHaveBeenCalled()
  })

  it('registers startup only for the lock holder', () => {
    const quit = vi.fn()
    const on = vi.fn()
    const whenReady = vi.fn()
    const onSecondInstance = vi.fn()
    const onReady = vi.fn()
    const onWindowAllClosed = vi.fn()

    bindSingleInstance({
      gotLock: true,
      quit,
      on,
      whenReady,
      onSecondInstance,
      onReady,
      onWindowAllClosed
    })

    expect(quit).not.toHaveBeenCalled()
    expect(on).toHaveBeenCalledWith('second-instance', onSecondInstance)
    expect(whenReady).toHaveBeenCalledWith(onReady)
    expect(on).toHaveBeenCalledWith('window-all-closed', onWindowAllClosed)
  })
})