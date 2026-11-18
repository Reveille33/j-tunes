import { useEffect, useState } from 'react'
import { formatDurationLong, formatBytes } from '../../utils/format'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { LibraryStats } from '@shared/types'

interface StatsDialogProps {
  onClose: () => void
}

/** Listening and library statistics. */
export function StatsDialog({ onClose }: StatsDialogProps): React.JSX.Element {
  useEscapeKey(onClose)

  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await window.api.getStats()
        if (!cancelled) setStats(loaded)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const maxDay = stats ? Math.max(1, ...stats.recentDays.map((d) => d.seconds)) : 1

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>Listening stats</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="dialog-body">
          {error ? <div className="dialog-error">{error}</div> : null}

          {!stats ? (
            <p className="dialog-hint">Loading…</p>
          ) : (
            <>
              <div className="stats-grid">
                <div className="stat-tile">
                  <div className="stat-value">
                    {formatDurationLong(stats.totalListeningSeconds) || '0m'}
                  </div>
                  <div className="stat-label">Listened</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-value">{stats.playedEpisodes.toLocaleString()}</div>
                  <div className="stat-label">Episodes played</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-value">{stats.currentStreak}</div>
                  <div className="stat-label">Day streak</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-value">{stats.daysListened.toLocaleString()}</div>
                  <div className="stat-label">Days listened</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-value">{stats.downloadedEpisodes.toLocaleString()}</div>
                  <div className="stat-label">Downloaded</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-value">{formatBytes(stats.downloadedBytes) || '0 B'}</div>
                  <div className="stat-label">On disk</div>
                </div>
              </div>

              <div className="stats-chart">
                {stats.recentDays.map((d) => (
                  <div
                    key={d.day}
                    className="stats-bar-wrap"
                    title={`${d.day}: ${formatDurationLong(d.seconds) || '0m'}`}
                  >
                    <div
                      className="stats-bar"
                      style={{ height: `${Math.round((d.seconds / maxDay) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <p className="dialog-hint">Last 14 days</p>

              {stats.byPodcast.length > 0 ? (
                <div className="stats-list">
                  {stats.byPodcast.slice(0, 12).map((p) => (
                    <div key={p.podcastId} className="stats-list-row">
                      <span className="truncate">{p.title}</span>
                      <span className="stats-list-value">
                        {formatDurationLong(p.seconds) || '0m'} · {p.played}/{p.total}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="dialog-actions">
                <button className="button button-primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}