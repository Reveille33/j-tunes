/** Saved settings must be loaded before a default can be written back. */
export function canPersistSetting(hydrated: boolean): boolean {
  return hydrated
}
