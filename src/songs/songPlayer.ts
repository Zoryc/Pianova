/**
 * Plays the notes of a song onto the note bus, as one more input next to the
 * computer keyboard and the mouse. The player knows nothing about sound or
 * the screen: the piano sounds and lights up because both listen to the bus.
 */
import type { NoteBus } from '../core/noteBus'
import type { Midi, NoteSource } from '../core/types'
import { MAX_SPEED, MIN_SPEED } from './song'
import type { Arrangement, PlayableNote } from './song'

export type PlayerStatus = 'empty' | 'stopped' | 'playing' | 'paused'

export interface PlayerState {
  status: PlayerStatus
  songId: string | null
  title: string
  /** Seconds into the song (song time, not wall time). */
  position: number
  duration: number
  /** MIN_SPEED..MAX_SPEED, where 1 is the song's own speed. */
  speed: number
}

export interface PlayerDeps {
  bus: NoteBus
  /** Milliseconds, monotonic. Defaults to performance.now. */
  now?(): number
  /** Default to the global timers. */
  setInterval?(handler: () => void, ms: number): unknown
  clearInterval?(handle: unknown): void
}

export interface SongPlayer {
  /**
   * Replaces what is loaded. Stops first, unless `keepPlace` is true: then
   * position and playing/paused state are kept (used when the options of the
   * current song change).
   */
  load(
    song: { id: string; title: string },
    arrangement: Arrangement,
    options?: { keepPlace?: boolean },
  ): void
  /** Back to 'empty'. */
  unload(): void
  play(): void
  pause(): void
  /** Stops and goes back to the start. */
  stop(): void
  seek(seconds: number): void
  setSpeed(speed: number): void
  /**
   * Same object until something changes. While playing, `position` in this
   * snapshot is refreshed about 10 times a second.
   */
  getState(): PlayerState
  /** The exact position right now. */
  getPosition(): number
  subscribe(listener: () => void): () => void
  dispose(): void
}

const SOURCE: NoteSource = 'playback'

/** How often the song moves forward while it plays. */
const TICK_MS = 5

/**
 * The most real time one tick counts. After a longer gap (a tab the browser
 * slowed down, a debugger pause) the song waits instead of dumping a burst of notes.
 */
const MAX_TICK_GAP_MS = 250

/** How often subscribers hear about the position while the song plays. */
const POSITION_NEWS_MS = 100

const STATE_KEYS = ['status', 'songId', 'title', 'position', 'duration', 'speed'] as const

export function createSongPlayer(deps: PlayerDeps): SongPlayer {
  const { bus } = deps

  /** What is true right now. `snapshot` is the copy handed out by getState(). */
  const live: PlayerState = {
    status: 'empty',
    songId: null,
    title: '',
    position: 0,
    duration: 0,
    speed: 1,
  }
  let snapshot: PlayerState = Object.freeze({ ...live })
  let snapshotMadeAt = 0
  const listeners = new Set<() => void>()

  let notes: readonly PlayableNote[] = []
  /** Index in `notes` of the next note to start. */
  let nextIndex = 0
  /** When `live.position` was last brought up to date, on the `now` clock. */
  let advancedAt = 0
  /** The notes the player is holding on the bus: note -> when it ends, in song seconds. */
  const held = new Map<Midi, number>()
  /**
   * Goes up every time the held notes are let go (pause, stop, seek, load…).
   * A tick that sees it change knows that someone listening to a note it just
   * sent has moved the song, and stops there.
   */
  let cuts = 0
  let timer: { handle: unknown } | null = null
  let disposed = false

  function now(): number {
    return deps.now ? deps.now() : performance.now()
  }

  function startTicking(): void {
    const handle = deps.setInterval ? deps.setInterval(tick, TICK_MS) : setInterval(tick, TICK_MS)
    timer = { handle }
  }

  function stopTicking(): void {
    if (timer === null) return
    const { handle } = timer
    timer = null
    if (deps.clearInterval) deps.clearInterval(handle)
    else clearInterval(handle as number)
  }

  /** The timer exists exactly while the song is playing. */
  function setStatus(next: PlayerStatus): void {
    live.status = next
    if (next === 'playing') startTicking()
    else stopTicking()
  }

  /** Where the song is at `time`: only a song that is playing moves, and never backwards. */
  function positionAt(time: number): number {
    if (live.status !== 'playing') return live.position
    const elapsedMs = Math.min(Math.max(time - advancedAt, 0), MAX_TICK_GAP_MS)
    return Math.min(live.duration, live.position + (elapsedMs / 1000) * live.speed)
  }

  /** Puts the song at `seconds`: the notes that start there or later are still to come. */
  function moveTo(seconds: number): void {
    live.position = seconds
    nextIndex = firstNoteAtOrAfter(notes, seconds)
  }

  function releaseHeldNotes(): void {
    held.clear()
    cuts += 1
    bus.allOff(SOURCE)
  }

  /** Hands out a new snapshot and tells the subscribers, but only when something changed. */
  function publish(): void {
    if (STATE_KEYS.every((key) => snapshot[key] === live[key])) return
    snapshot = Object.freeze({ ...live })
    snapshotMadeAt = now()
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        // One broken listener must not stop the others from hearing about the change.
        console.error('[songPlayer] listener failed', error)
      }
    }
  }

  function tick(): void {
    // A tick that arrives after its timer was cleared must not play anything.
    if (live.status !== 'playing') return
    const time = now()
    live.position = positionAt(time)
    advancedAt = time

    const cutsBefore = cuts
    releaseEndedNotes()
    startDueNotes(cutsBefore)
    // Someone listening to those notes paused, moved or replaced the song: that has the last word.
    if (cuts !== cutsBefore) return

    if (live.position >= live.duration) stop()
    else if (time - snapshotMadeAt >= POSITION_NEWS_MS) publish()
  }

  /** Releases come before presses: the bus ignores a press of a note that is still held. */
  function releaseEndedNotes(): void {
    const ended = [...held].filter(([, end]) => end <= live.position).sort(byEnd)
    for (const [midi] of ended) {
      held.delete(midi)
      bus.noteOff(midi, SOURCE)
    }
  }

  function startDueNotes(cutsBefore: number): void {
    while (cuts === cutsBefore) {
      const note = notes[nextIndex]
      if (note === undefined || note.time > live.position) return
      nextIndex += 1
      held.set(note.midi, note.time + note.duration)
      bus.noteOn(note.midi, SOURCE, { velocity: note.velocity })
    }
  }

  /*
   * Every operation below changes the player's own state first, lets go of
   * the notes on the bus second and tells the subscribers last. Whoever is
   * listening to the bus or to the player may call the player straight back,
   * and then finds it in one piece.
   */

  function load(
    song: { id: string; title: string },
    arrangement: Arrangement,
    options: { keepPlace?: boolean } = {},
  ): void {
    if (disposed) return
    const keepPlace = options.keepPlace === true && live.status !== 'empty'
    if (!keepPlace) setStatus('stopped')
    notes = arrangement.notes
    live.songId = song.id
    live.title = song.title
    live.duration = usableDuration(arrangement.duration)
    moveTo(keepPlace ? Math.min(live.position, live.duration) : 0)
    releaseHeldNotes()
    publish()
  }

  function unload(): void {
    if (live.status === 'empty') return
    setStatus('empty')
    notes = []
    live.songId = null
    live.title = ''
    live.duration = 0
    moveTo(0)
    releaseHeldNotes()
    publish()
  }

  function play(): void {
    if (live.status === 'empty' || live.status === 'playing') return
    if (live.position >= live.duration) moveTo(0)
    advancedAt = now()
    setStatus('playing')
    publish()
  }

  function pause(): void {
    if (live.status !== 'playing') return
    live.position = positionAt(now())
    setStatus('paused')
    releaseHeldNotes()
    publish()
  }

  function stop(): void {
    if (live.status === 'empty') return
    setStatus('stopped')
    moveTo(0)
    releaseHeldNotes()
    publish()
  }

  function seek(seconds: number): void {
    if (live.status === 'empty' || Number.isNaN(seconds)) return
    moveTo(clamp(seconds, 0, live.duration))
    advancedAt = now()
    releaseHeldNotes()
    publish()
  }

  function setSpeed(speed: number): void {
    if (disposed || Number.isNaN(speed)) return
    const next = clamp(speed, MIN_SPEED, MAX_SPEED)
    if (next === live.speed) return
    // The time since the last tick was played at the old speed.
    const time = now()
    live.position = positionAt(time)
    advancedAt = time
    live.speed = next
    publish()
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  /** Unloads for good: from here on nothing changes, so nothing is played and nobody is told. */
  function dispose(): void {
    // Set first: a subscriber that hears about the unloading must not be able to load a song.
    disposed = true
    unload()
  }

  return {
    load,
    unload,
    play,
    pause,
    stop,
    seek,
    setSpeed,
    getState: () => snapshot,
    getPosition: () => positionAt(now()),
    subscribe,
    dispose,
  }
}

/** Index of the first note that starts at `seconds` or later (`notes.length` when none does). */
function firstNoteAtOrAfter(notes: readonly PlayableNote[], seconds: number): number {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const note = notes[middle]
    if (note !== undefined && note.time < seconds) low = middle + 1
    else high = middle
  }
  return low
}

function byEnd(a: readonly [Midi, number], b: readonly [Midi, number]): number {
  return a[1] - b[1]
}

function usableDuration(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
