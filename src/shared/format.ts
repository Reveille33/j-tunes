/** Formats a duration in seconds as `H:MM:SS` or `M:SS`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}

/** Formats a duration in seconds as a compact human string, e.g. `1h 12m`. */
export function formatDurationLong(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.floor(seconds)
  let hours = Math.floor(total / 3600)
  let minutes = Math.round((total % 3600) / 60)
  if (minutes === 60) {
    hours += 1
    minutes = 0
  }

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

/** Formats a byte count as a human-readable size. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

/** Formats a release date as `MMM D, YYYY`, or an em dash when unknown. */
export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '--'
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

/** Formats a release date as `YYYY-MM-DD`, used for sorting comparisons. */
export function formatIsoDate(timestamp: number | null | undefined): string {
  if (!timestamp) return ''
  return new Date(timestamp).toISOString().slice(0, 10)
}
