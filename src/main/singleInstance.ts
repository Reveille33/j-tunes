/**
 * Only the process that holds the single-instance lock may start the app.
 * A second process quits. The lock holder focuses its window when that happens.
 */
export function bindSingleInstance(options: {
  gotLock: boolean
  quit: () => void
  on: (event: 'second-instance' | 'window-all-closed', handler: () => void) => void
  whenReady: (handler: () => void) => void
  onSecondInstance: () => void
  onReady: () => void
  onWindowAllClosed: () => void
}): void {
  if (!options.gotLock) {
    options.quit()
    return
  }

  options.on('second-instance', options.onSecondInstance)
  options.whenReady(options.onReady)
  options.on('window-all-closed', options.onWindowAllClosed)
}
