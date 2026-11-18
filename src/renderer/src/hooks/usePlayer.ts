import { useCallback, useEffect, useRef } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { useUiStore } from '../state/uiStore'
import { useEpisodeStore } from '../state/episodeStore'
import { playbackErrorMessage } from '@shared/playbackError'
import {
  PLAYBACK_SPEEDS,
  POSITION_SAVE_INTERVAL_MS,
  RESUME_MIN_SECONDS,
  RESUME_TAIL_SECONDS
} from '@shared/constants'
import type { Episode } from '@shared/types'

/**
 * Drives the persistent `<audio>` element.
 *
 * Handles loading a source, remembering the last playback position (both in
 * memory and in the database), the 30 second skip buttons and the playback
 * speed presets.
 */
export function usePlayer(
  audio: HTMLAudioElement | null,
  options: { onEnded?: (episodeId: number) => void } = {}
): {
  playEpisode: (episode: Episode) => Promise<void>
  togglePlay: () => void
  skip: (seconds: number) => void
  setRate: (rate: number) => void
  cycleRate: (direction: -1 | 1) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  seek: (position: number) => void
} {
  const episodeIdRef = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  const autoMarkedRef = useRef(false)
  const onEnded = options.onEnded

  /** Persists the current position for the episode being played. */
  const savePosition = useCallback(() => {
    if (!audio) return
    const id = episodeIdRef.current
    if (id === null) return
    void window.api.savePlaybackPosition(id, audio.currentTime, audio.duration || 0)
  }, [audio])

  // Keep the store in step with the element's actual playback state.
  useEffect(() => {
    if (!audio) return

    const store = usePlayerStore.getState()

    const onTimeUpdate = () => {
      store.setPosition(audio.currentTime)

      // Mark the episode played once we are within the resume tail of the end,
      // so skipping the final seconds still counts as finished.
      const id = episodeIdRef.current
      const total = audio.duration
      if (
        id !== null &&
        !autoMarkedRef.current &&
        Number.isFinite(total) &&
        total > 0 &&
        audio.currentTime >= total - RESUME_TAIL_SECONDS
      ) {
        autoMarkedRef.current = true
        const position = audio.currentTime
        const duration = audio.duration || 0
        // Save the playhead before mark-played clears it, so the tail is
        // counted once and the following save is not a jump from zero.
        void window.api.savePlaybackPosition(id, position, duration).then(() => {
          void window.api.setPlayed(id, true)
        })
        const current = useEpisodeStore.getState().episodes.find((e) => e.id === id)
        if (current && !current.played) {
          useEpisodeStore.getState().updateEpisode({ ...current, played: true })
        }
      }
    }
    const onDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        store.setDuration(audio.duration)
      }
    }
    const onProgress = () => {
      if (audio.buffered.length > 0) {
        store.setBuffered(audio.buffered.end(audio.buffered.length - 1))
      }
    }
    const onPlay = () => store.setPlaying(true)
    const onPause = () => store.setPlaying(false)
    const onWaiting = () => store.setLoading(true)
    const onPlaying = () => store.setLoading(false)
    const onError = () => {
      const message = playbackErrorMessage(audio.error?.code)
      usePlayerStore.getState().setError(message)
      usePlayerStore.getState().setPlaying(false)
      usePlayerStore.getState().setLoading(false)
      useUiStore.getState().showToast(message, 'error')
    }
    const onEndedHandler = () => {
      store.setPlaying(false)
      store.setPosition(audio.duration || 0)
      savePosition()
      const id = episodeIdRef.current
      if (id !== null) onEnded?.(id)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('loadedmetadata', onDurationChange)
    audio.addEventListener('progress', onProgress)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('ended', onEndedHandler)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('loadedmetadata', onDurationChange)
      audio.removeEventListener('progress', onProgress)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('ended', onEndedHandler)
      audio.removeEventListener('error', onError)
    }
  }, [audio, savePosition, onEnded])


  // Flush the position regularly while playing, and when the app closes.
  useEffect(() => {
    if (saveTimer.current !== null) window.clearInterval(saveTimer.current)
    saveTimer.current = window.setInterval(() => {
      if (audio && !audio.paused) savePosition()
    }, POSITION_SAVE_INTERVAL_MS)

    const onBeforeUnload = () => savePosition()
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      if (saveTimer.current !== null) window.clearInterval(saveTimer.current)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [audio, savePosition])

  // Sleep timer: pause playback once the deadline passes.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const { sleepAt } = usePlayerStore.getState()
      if (sleepAt === null || Date.now() < sleepAt) return
      usePlayerStore.getState().setSleepAt(null)
      if (audio && !audio.paused) {
        audio.pause()
        savePosition()
      }
      useUiStore.getState().showToast('Sleep timer ended — playback paused', 'info')
    }, 5000)
    return () => window.clearInterval(timer)
  }, [audio, savePosition])

  /** Loads an episode and starts playback. */
  const playEpisode = useCallback(
    async (episode: Episode) => {
      if (!audio) return

      const player = usePlayerStore.getState()

      // Save the outgoing episode's position before switching.
      if (episodeIdRef.current !== null && episodeIdRef.current !== episode.id) {
        savePosition()
      }

      player.setEpisode(episode.id, episode.title, episode.podcastTitle)
      player.setLoading(true)
      player.setError(null)
      episodeIdRef.current = episode.id
      autoMarkedRef.current = false

      try {
        const source = await window.api.getMediaSource(episode.id)

        // The user may have selected a different episode while loading.
        if (usePlayerStore.getState().episodeId !== episode.id) return

        if (source.duration && source.duration > 0) {
          player.setDuration(source.duration)
        }

        audio.src = source.url
        audio.playbackRate = player.rate
        audio.volume = player.volume

        // Resume from the last known position when it makes sense.
        const stored = episode.playPosition
        const nearEnd = source.duration !== null && stored > source.duration - RESUME_TAIL_SECONDS
        const shouldResume = stored > RESUME_MIN_SECONDS && !nearEnd

        if (shouldResume) {
          if (audio.readyState >= 1) {
            audio.currentTime = stored
            player.setPosition(stored)
          } else {
            const onLoaded = () => {
              if (episodeIdRef.current === episode.id) {
                audio.currentTime = stored
                player.setPosition(stored)
              }
            }
            audio.addEventListener('loadedmetadata', onLoaded, { once: true })
          }
        }

        await audio.play()
        audio.playbackRate = player.rate
        player.setPlaying(true)
      } catch (error) {
        const message = (error as Error).message
        usePlayerStore.getState().setError(message)
        usePlayerStore.getState().setPlaying(false)
        useUiStore.getState().showToast(message, 'error')
      } finally {
        usePlayerStore.getState().setLoading(false)
      }
    },
    [audio, savePosition]
  )

  const togglePlay = useCallback(() => {
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => undefined)
    } else {
      audio.pause()
      savePosition()
    }
  }, [audio, savePosition])

  const skip = useCallback(
    (seconds: number) => {
      if (!audio) return
      const target = audio.currentTime + seconds
      audio.currentTime = Math.max(0, Math.min(target, audio.duration || target))
    },
    [audio]
  )

  const setRate = useCallback(
    (rate: number) => {
      if (audio) audio.playbackRate = rate
      usePlayerStore.getState().setRate(rate)
      void window.api.setSetting('lastPlaybackSpeed', rate)
    },
    [audio]
  )

  const cycleRate = useCallback(
    (direction: -1 | 1) => {
      const currentRate = usePlayerStore.getState().rate
      const idx = PLAYBACK_SPEEDS.indexOf(currentRate as (typeof PLAYBACK_SPEEDS)[number])
      const nextIdx = Math.max(
        0,
        Math.min(PLAYBACK_SPEEDS.length - 1, (idx >= 0 ? idx : 0) + direction)
      )
      const nextRate = PLAYBACK_SPEEDS[nextIdx]
      if (nextRate !== currentRate) {
        setRate(nextRate)
      }
    },
    [setRate]
  )

  const setVolume = useCallback(
    (volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume))
      if (audio) {
        audio.volume = clamped
        audio.muted = clamped === 0
      }
      usePlayerStore.getState().setVolume(clamped)
      void window.api.setSetting('defaultVolume', clamped)
    },
    [audio]
  )

  const toggleMute = useCallback(() => {
    if (!audio) return
    audio.muted = !audio.muted
    usePlayerStore.getState().setMuted(audio.muted)
  }, [audio])

  const seek = useCallback(
    (position: number) => {
      if (!audio) return
      const maxDuration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : usePlayerStore.getState().duration || position
      audio.currentTime = Math.max(0, Math.min(position, maxDuration))
      usePlayerStore.getState().setPosition(audio.currentTime)
    },
    [audio]
  )

  return { playEpisode, togglePlay, skip, setRate, cycleRate, setVolume, toggleMute, seek }
}
