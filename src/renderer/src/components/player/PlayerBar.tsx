import { useEffect, useState } from 'react'
import { usePlayerStore } from '../../state/playerStore'
import { formatDuration } from '../../utils/format'
import { PLAYBACK_SPEEDS, SKIP_SECONDS, SLEEP_TIMER_MINUTES } from '@shared/constants'
import type { Chapter } from '@shared/types'

interface PlayerBarProps {
  onTogglePlay: () => void
  onSkip: (seconds: number) => void
  onSeek: (position: number) => void
  onSetRate: (rate: number) => void
  onSetVolume: (volume: number) => void
  onToggleMute: () => void
}

/**
 * The persistent player bar.
 *
 * Provides play/pause, 30 second skip in both directions, the playback speed
 * menu (1x, 1.2x, 1.5x, 2x), a seek bar and volume control.
 */
export function PlayerBar({
  onTogglePlay,
  onSkip,
  onSeek,
  onSetRate,
  onSetVolume,
  onToggleMute
}: PlayerBarProps): React.JSX.Element {
  const playing = usePlayerStore((s) => s.playing)
  const position = usePlayerStore((s) => s.position)
  const duration = usePlayerStore((s) => s.duration)
  const rate = usePlayerStore((s) => s.rate)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const loading = usePlayerStore((s) => s.loading)
  const error = usePlayerStore((s) => s.error)
  const episodeTitle = usePlayerStore((s) => s.episodeTitle)
  const podcastTitle = usePlayerStore((s) => s.podcastTitle)

  const [showSpeeds, setShowSpeeds] = useState(false)
  const [showSleep, setShowSleep] = useState(false)
  const [showChapters, setShowChapters] = useState(false)
  const [chapters, setChapters] = useState<Chapter[]>([])

  const sleepAt = usePlayerStore((s) => s.sleepAt)
  const setSleepAt = usePlayerStore((s) => s.setSleepAt)
  const currentEpisodeId = usePlayerStore((s) => s.episodeId)

  const hasEpisode = episodeTitle.length > 0
  const progress = duration > 0 ? (position / duration) * 100 : 0

  // Load chapters lazily the first time the chapter menu is opened.
  useEffect(() => {
    if (!showChapters || currentEpisodeId === null) return
    let cancelled = false
    void (async () => {
      try {
        const list = await window.api.getChapters(currentEpisodeId)
        if (!cancelled) setChapters(list)
      } catch {
        if (!cancelled) setChapters([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showChapters, currentEpisodeId])

  // Chapters belong to a single episode, so clear them when it changes.
  useEffect(() => {
    setChapters([])
    setShowChapters(false)
  }, [currentEpisodeId])

  const setSleepMinutes = (minutes: number | null) => {
    setSleepAt(minutes === null ? null : Date.now() + minutes * 60_000)
    setShowSleep(false)
  }

  const sleepRemaining = sleepAt !== null ? Math.max(0, sleepAt - Date.now()) : 0

  return (
    <div className="player-bar">
      {error ? <div className="player-error">{error}</div> : null}

      <div className="player-bar-track">
        <div className="player-now-playing">
          <div className="player-title truncate" title={episodeTitle}>
            {episodeTitle || 'Nothing playing'}
          </div>
          <div className="player-podcast truncate">{podcastTitle}</div>
        </div>

        <div className="player-controls">
          <button
            className="player-skip"
            onClick={() => onSkip(-SKIP_SECONDS)}
            disabled={!hasEpisode}
            title={`Back ${SKIP_SECONDS} seconds`}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
          >
            ⟲{SKIP_SECONDS}
          </button>

          <button
            className="player-play"
            onClick={onTogglePlay}
            disabled={!hasEpisode || loading}
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {loading ? '⏳' : playing ? '❚❚' : '▶'}
          </button>

          <button
            className="player-skip"
            onClick={() => onSkip(SKIP_SECONDS)}
            disabled={!hasEpisode}
            title={`Forward ${SKIP_SECONDS} seconds`}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
          >
            ⟳{SKIP_SECONDS}
          </button>
        </div>

        <div className="player-time">
          <span>{formatDuration(position)}</span>
          <span className="dot">/</span>
          <span>{formatDuration(duration)}</span>
        </div>

        <div className="player-seek">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(position, duration || 0)}
            onChange={(event) => onSeek(Number(event.target.value))}
            disabled={!hasEpisode || duration === 0}
            aria-label="Seek"
            style={{ '--progress': `${progress}%` } as React.CSSProperties}
          />
        </div>

        <div className="player-extras">
          <div className="player-speed">
            <button
              className="player-speed-button"
              onClick={() => setShowSpeeds((v) => !v)}
              title="Playback speed"
              aria-label="Playback speed"
            >
              {rate}x
            </button>
            {showSpeeds ? (
              <div className="player-speed-menu">
                {PLAYBACK_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    className={speed === rate ? 'is-active' : ''}
                    onClick={() => {
                      onSetRate(speed)
                      setShowSpeeds(false)
                    }}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="player-sleep">
            <button
              className={`player-speed-button${sleepAt !== null ? ' is-on' : ''}`}
              onClick={() => setShowSleep((value) => !value)}
              title="Sleep timer"
              aria-label="Sleep timer"
            >
              ☾{sleepAt !== null ? ` ${Math.ceil(sleepRemaining / 60_000)}m` : ''}
            </button>
            {showSleep ? (
              <div className="player-speed-menu">
                {SLEEP_TIMER_MINUTES.map((minutes) => (
                  <button key={minutes} onClick={() => setSleepMinutes(minutes)}>
                    {minutes} min
                  </button>
                ))}
                <button
                  className={sleepAt === null ? 'is-active' : ''}
                  onClick={() => setSleepMinutes(null)}
                >
                  Off
                </button>
              </div>
            ) : null}
          </div>

          <div className="player-chapters">
            <button
              className="player-speed-button"
              onClick={() => setShowChapters((value) => !value)}
              disabled={!hasEpisode}
              title="Chapters"
              aria-label="Chapters"
            >
              ☰
            </button>
            {showChapters ? (
              <div className="player-speed-menu player-chapter-menu">
                {chapters.length === 0 ? (
                  <div className="chapter-empty">No chapters available</div>
                ) : (
                  chapters.map((chapter) => (
                    <button
                      key={chapter.id}
                      onClick={() => {
                        onSeek(chapter.startSecs)
                        setShowChapters(false)
                      }}
                    >
                      <span className="chapter-time">{formatDuration(chapter.startSecs)}</span>
                      <span className="chapter-title">{chapter.title}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="player-volume">
            <button
              className="icon-button"
              onClick={onToggleMute}
              title={muted ? 'Unmute' : 'Mute'}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => onSetVolume(Number(event.target.value))}
              aria-label="Volume"
              style={{ '--progress': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
