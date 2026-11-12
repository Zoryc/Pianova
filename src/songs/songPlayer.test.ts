/**
 * The song player, driven by a clock and a timer that the tests move by hand:
 * nothing here waits for real time. The property checked over and over is the
 * one a listener would notice first: every note the player presses is released
 * again, whatever is done to the player and in whatever order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteBus } from '../core/noteBus'
import type { Midi, NoteSource } from '../core/types'
import { MAX_SPEED, MIN_SPEED } from './song'
import type { Arrangement, PlayableNote } from './song'
import { createSongPlayer } from './songPlayer'
import type { PlayerState, SongPlayer } from './songPlayer'

const TICK_MS = 5
const SONG = { id: 'song-1', title: 'A test tune' }
const OTHER_SONG = { id: 'song-2', title: 'Another tune' }

function note(midi: Midi, time: number, duration: number, velocity = 0.8): PlayableNote {
  return { midi, time, duration, velocity }
}

function arrangementOf(notes: readonly PlayableNote[]): Arrangement {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi)
  const duration = sorted.reduce((end, each) => Math.max(end, each.time + each.duration), 0)
  return { notes: sorted, duration, offPianoCount: 0 }
}

/** 2.5 seconds: two long notes that overlap, a short one, a late one. */
const TUNE = arrangementOf([note(60, 0, 1), note(64, 0.5, 1), note(67, 1.2, 0.3), note(72, 2, 0.5)])
/** 2 seconds, on other notes. */
const OTHER_TUNE = arrangementOf([
  note(48, 0, 2),
  note(50, 0.6, 1),
  note(52, 0.9, 0.5),
  note(55, 1.6, 0.4),
])
/** 1 second. */
const SHORT_TUNE = arrangementOf([note(60, 0, 0.5), note(62, 0.5, 0.5)])
/** 10 seconds of one note, for tests that are about the clock. */
const LONG_NOTE = arrangementOf([note(60, 0, 10)])

interface FakeTimer {
  handler(): void
  every: number
  due: number
}

/** A clock and a timer that only move when the test says so. */
function fakeTime() {
  let time = 10_000
  const timers = new Set<FakeTimer>()
  let made = 0
  let lastHandler: (() => void) | null = null
  let afterTick: (() => void) | null = null

  function nextDue(until: number): FakeTimer | null {
    let next: FakeTimer | null = null
    for (const timer of timers) {
      if (timer.due <= until && (next === null || timer.due < next.due)) next = timer
    }
    return next
  }

  function run(timer: FakeTimer): void {
    timer.due = time + timer.every
    timer.handler()
    afterTick?.()
  }

  return {
    now: (): number => time,
    setInterval(handler: () => void, ms: number): unknown {
      const timer: FakeTimer = { handler, every: ms, due: time + ms }
      timers.add(timer)
      made += 1
      lastHandler = handler
      return timer
    },
    clearInterval(handle: unknown): void {
      timers.delete(handle as FakeTimer)
    },
    /** Lets `ms` go by, running the timer every time it is due, as a healthy browser tab does. */
    advance(ms: number): void {
      const end = time + ms
      for (let timer = nextDue(end); timer !== null; timer = nextDue(end)) {
        time = timer.due
        run(timer)
      }
      time = end
    },
    /** Lets `ms` go by with the timer held back: a tab the browser put to sleep. */
    stall(ms: number): void {
      time += ms
    },
    /** Runs the timer once, late, and puts it back on schedule. */
    wake(): void {
      for (const timer of [...timers]) run(timer)
    },
    /** Runs the handler of the last timer made, even when that timer has been cleared since. */
    lateTick(): void {
      lastHandler?.()
    },
    timerCount: (): number => timers.size,
    timersMade: (): number => made,
    tickLengths: (): number[] => [...timers].map((timer) => timer.every),
    /** `check` runs after every tick of the timer. */
    onTick(check: () => void): void {
      afterTick = check
    },
  }
}

type FakeTime = ReturnType<typeof fakeTime>

/** A note event, with where the song and the clock were when it was heard. */
interface Heard {
  type: 'on' | 'off'
  midi: Midi
  position: number
  at: number
  velocity: number | null
  source: NoteSource
}

interface Session {
  bus: NoteBus
  time: FakeTime
  player: SongPlayer
  heard: Heard[]
  /** What a listener such as the sound engine believes is sounding. */
  sounding: Set<Midi>
  /** The notes the player was last given. */
  loaded: readonly PlayableNote[]
  /** Where the song was when its notes were last cut off: notes that start later must all play. */
  since: number
}

function newPlayer(bus: NoteBus, time: FakeTime): SongPlayer {
  return createSongPlayer({
    bus,
    now: time.now,
    setInterval: time.setInterval,
    clearInterval: time.clearInterval,
  })
}

/** A bus with only the song player on it, so everything heard on it was sent by the player. */
function setUp(): Session {
  const bus = new NoteBus()
  const time = fakeTime()
  const session: Session = {
    bus,
    time,
    player: newPlayer(bus, time),
    heard: [],
    sounding: new Set<Midi>(),
    loaded: [],
    since: 0,
  }
  bus.subscribe((event) => {
    session.heard.push({
      type: event.type,
      midi: event.midi,
      position: session.player.getPosition(),
      at: time.now(),
      velocity: event.type === 'on' ? event.velocity : null,
      source: event.source,
    })
    if (event.type === 'on') session.sounding.add(event.midi)
    else session.sounding.delete(event.midi)
  })
  return session
}

function load(session: Session, arrangement: Arrangement, options?: { keepPlace?: boolean }): void {
  session.player.load(SONG, arrangement, options)
  session.loaded = arrangement.notes
}

/** A session with `arrangement` loaded and playing from the start. */
function playing(arrangement: Arrangement): Session {
  const session = setUp()
  load(session, arrangement)
  session.player.play()
  return session
}

function names(heard: readonly Heard[]): string[] {
  return heard.map((event) => `${event.type} ${event.midi}`)
}

function soundingNow(session: Session): Midi[] {
  return [...session.sounding].sort((a, b) => a - b)
}

function count(heard: readonly Heard[], type: 'on' | 'off'): number {
  return heard.filter((event) => event.type === type).length
}

/** Counts how many times the player tells its subscribers that something changed. */
function countNews(player: SongPlayer): () => number {
  let news = 0
  player.subscribe(() => {
    news += 1
  })
  return () => news
}

/** Small deterministic random generator, so a failure can be reproduced. */
function randomSource(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** A song that keeps the arranger's promise: sorted, and no two notes of one pitch overlap. */
function randomArrangement(random: () => number, minNoteLength = 0.001): Arrangement {
  const length = 0.5 + random() * 5
  const notes: PlayableNote[] = []
  for (const midi of [43, 48, 55, 60, 62, 64, 67, 72]) {
    let time = random() * 0.5
    while (time < length) {
      const duration = minNoteLength + random() * 0.6
      notes.push(note(midi, time, duration, 0.2 + random() * 0.8))
      // One time in three the same note is struck again the moment it ends.
      time += duration + (random() < 0.33 ? 0 : random() * 0.5)
    }
  }
  return arrangementOf(notes)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('a new player', () => {
  it('is empty and silent, with no timer', () => {
    const { player, time, heard } = setUp()

    expect(player.getState()).toEqual({
      status: 'empty',
      songId: null,
      title: '',
      position: 0,
      duration: 0,
      speed: 1,
    })
    expect(player.getPosition()).toBe(0)
    expect(time.timerCount()).toBe(0)
    expect(heard).toEqual([])
  })

  it('ignores play, pause, stop, seek and unload while nothing is loaded', () => {
    const { player, time, heard } = setUp()
    const before = player.getState()
    const news = countNews(player)

    player.play()
    player.pause()
    player.stop()
    player.seek(3)
    player.unload()
    time.advance(1000)

    expect(player.getState()).toBe(before)
    expect(news()).toBe(0)
    expect(time.timersMade()).toBe(0)
    expect(heard).toEqual([])
  })

  it('shows a loaded song stopped at its start, and plays nothing until asked', () => {
    const session = setUp()

    load(session, arrangementOf([note(60, 0, 1), note(64, 0.5, 1)]))
    session.time.advance(1000)

    expect(session.player.getState()).toEqual({
      status: 'stopped',
      songId: 'song-1',
      title: 'A test tune',
      position: 0,
      duration: 1.5,
      speed: 1,
    })
    expect(session.time.timersMade()).toBe(0)
    expect(session.heard).toEqual([])
  })
})

describe.each([0.5, 1, 1.5])('playing at speed %s', (speed) => {
  /** How far the song moves in one tick. */
  const tickOfSong = (TICK_MS / 1000) * speed

  function expectWithinOneTick(actual: number | undefined, wanted: number): void {
    expect(actual).toBeGreaterThanOrEqual(wanted - 1e-9)
    expect(actual).toBeLessThan(wanted + tickOfSong + 1e-9)
  }

  it('starts and stops every note at its place in the song', () => {
    const tune = [
      note(60, 0, 0.4),
      note(64, 0.2, 0.5, 0.3),
      note(67, 0.7, 0.1, 1),
      note(60, 0.9, 0.6, 0.55),
      note(72, 1.2, 0.3),
    ]
    const session = setUp()
    load(session, arrangementOf(tune))
    session.player.setSpeed(speed)
    session.player.play()
    const startedAt = session.time.now()

    session.time.advance(1600 / speed)

    for (const pitch of new Set(tune.map((each) => each.midi))) {
      const wanted = tune.filter((each) => each.midi === pitch)
      const starts = session.heard.filter((event) => event.type === 'on' && event.midi === pitch)
      const stops = session.heard.filter((event) => event.type === 'off' && event.midi === pitch)
      expect(starts).toHaveLength(wanted.length)
      expect(stops).toHaveLength(wanted.length)
      wanted.forEach((each, index) => {
        expectWithinOneTick(starts[index]?.position, each.time)
        expectWithinOneTick(stops[index]?.position, each.time + each.duration)
        expect(starts[index]?.velocity).toBe(each.velocity)
      })
    }
    expect(session.heard.every((event) => event.source === 'playback')).toBe(true)
    // The song moves at `speed` seconds of music for every second of the clock.
    for (const start of session.heard.filter((event) => event.type === 'on')) {
      expect(start.position).toBeCloseTo(((start.at - startedAt) / 1000) * speed, 9)
    }
    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(soundingNow(session)).toEqual([])
  })

  it('sounds exactly the notes the song has at every moment', () => {
    // Every note is longer than a tick, so after each tick exactly the notes of the song sound.
    const tune = randomArrangement(randomSource(7 + speed * 100), 0.02)
    const session = setUp()
    load(session, tune)
    session.player.setSpeed(speed)
    session.player.play()

    let ticks = 0
    while (ticks < 5000) {
      session.time.advance(TICK_MS)
      if (session.player.getState().status !== 'playing') break
      ticks += 1
      const position = session.player.getPosition()
      const wanted = tune.notes
        .filter((each) => each.time <= position && position < each.time + each.duration)
        .map((each) => each.midi)
        .sort((a, b) => a - b)
      expect(soundingNow(session)).toEqual(wanted)
    }

    expect(ticks).toBeGreaterThan(tune.duration / tickOfSong - 3)
    expect(ticks).toBeLessThan(tune.duration / tickOfSong + 3)
    expect(count(session.heard, 'on')).toBe(tune.notes.length)
    expect(count(session.heard, 'off')).toBe(tune.notes.length)
    expect(soundingNow(session)).toEqual([])
  })
})

describe('the order of notes within one tick', () => {
  it('lets go of a note before pressing the same note again', () => {
    // The bus ignores a press of a note that is still held: the other order would lose the note.
    const session = playing(arrangementOf([note(60, 0, 0.5), note(60, 0.5, 0.5)]))

    session.time.advance(750)

    expect(names(session.heard)).toEqual(['on 60', 'off 60', 'on 60'])
    expect(session.heard[1]?.at).toBe(session.heard[2]?.at)
    expect(soundingNow(session)).toEqual([60])
  })

  it('lets go of the notes that ended before pressing the ones that start', () => {
    const session = playing(
      arrangementOf([note(60, 0, 0.5), note(62, 0.5, 0.5), note(64, 0.5, 0.5), note(65, 0, 0.5)]),
    )

    session.time.advance(750)

    expect(names(session.heard)).toEqual(['on 60', 'on 65', 'off 60', 'off 65', 'on 62', 'on 64'])
  })

  it('after a gap, lets go in the order notes ended, then presses in the order they start', () => {
    const session = playing(
      arrangementOf([
        note(64, 0, 0.1),
        note(60, 0, 0.2),
        note(72, 0.05, 1),
        note(67, 0.15, 1),
        note(76, 0.2, 1),
      ]),
    )
    session.time.advance(TICK_MS)
    expect(names(session.heard)).toEqual(['on 60', 'on 64'])
    session.heard.length = 0

    session.time.stall(1000)
    session.time.wake()

    expect(names(session.heard)).toEqual(['off 64', 'off 60', 'on 72', 'on 67', 'on 76'])
    expect(new Set(session.heard.map((event) => event.at)).size).toBe(1)
  })

  it('starts a note that begins exactly where a tick lands', () => {
    const session = playing(arrangementOf([note(60, 0.25, 1)]))

    session.time.stall(1000)
    session.time.wake()

    expect(session.player.getPosition()).toBe(0.25)
    expect(soundingNow(session)).toEqual([60])
  })

  it('keeps a note that starts and ends inside one tick until the next tick', () => {
    const session = playing(arrangementOf([note(60, 0.1, 0.001), note(64, 0.1, 2)]))
    session.time.stall(1000)

    session.time.wake()
    expect(soundingNow(session)).toEqual([60, 64])

    session.time.advance(TICK_MS)
    expect(soundingNow(session)).toEqual([64])
  })
})

describe('a long gap between two ticks', () => {
  it.each([
    [0.5, 0.125],
    [1, 0.25],
    [1.5, 0.375],
  ])('counts as 250 ms only (speed %s)', (speed, wanted) => {
    const session = setUp()
    load(session, arrangementOf([note(60, 0, 0.1), note(64, 5, 1), note(67, 19, 1)]))
    session.player.setSpeed(speed)
    session.player.play()

    session.time.stall(10_000)
    session.time.wake()

    expect(session.player.getPosition()).toBeCloseTo(wanted, 9)
    expect(names(session.heard)).toEqual(['on 60'])
    expect(session.player.getState().status).toBe('playing')
  })

  it('does not let the exact position run ahead while the timer is held back', () => {
    const session = playing(LONG_NOTE)
    session.time.advance(1000)

    session.time.stall(200)
    expect(session.player.getPosition()).toBeCloseTo(1.2, 9)
    session.time.stall(5000)
    expect(session.player.getPosition()).toBeCloseTo(1.25, 9)

    session.time.wake()
    expect(session.player.getPosition()).toBeCloseTo(1.25, 9)
  })

  it('then carries on at the normal pace', () => {
    const session = playing(LONG_NOTE)

    session.time.stall(60_000)
    session.time.wake()
    session.time.advance(1000)

    expect(session.player.getPosition()).toBeCloseTo(1.25, 9)
  })

  it('does not move the song backwards when the clock does not move or steps back', () => {
    const session = playing(LONG_NOTE)
    session.time.advance(1000)

    session.time.wake()
    expect(session.player.getPosition()).toBeCloseTo(1, 9)

    session.time.stall(-400)
    expect(session.player.getPosition()).toBeCloseTo(1, 9)
    session.time.wake()
    expect(session.player.getPosition()).toBeCloseTo(1, 9)
  })
})

describe('reaching the end', () => {
  it('stops, goes back to the start and holds nothing', () => {
    const session = playing(arrangementOf([note(60, 0, 0.3), note(64, 0.3, 0.3)]))
    const news = countNews(session.player)

    session.time.advance(700)

    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(session.player.getPosition()).toBe(0)
    expect(names(session.heard)).toEqual(['on 60', 'off 60', 'on 64', 'off 64'])
    expect(soundingNow(session)).toEqual([])
    expect(session.time.timerCount()).toBe(0)
    expect(news()).toBeGreaterThanOrEqual(1)
  })

  it('lets the last note ring to its end', () => {
    const session = playing(arrangementOf([note(60, 0, 0.3), note(64, 0.3, 0.3)]))

    session.time.advance(700)

    const last = session.heard.at(-1)
    expect(last?.type).toBe('off')
    expect(last?.position).toBeCloseTo(0.6, 9)
    expect(last?.at).toBeGreaterThanOrEqual(10_600)
  })

  it('waits for the end of the song, also when the last note ends before it', () => {
    const session = setUp()
    load(session, { notes: [note(60, 0, 0.2)], duration: 1, offPianoCount: 0 })
    session.player.play()

    session.time.advance(900)
    expect(session.player.getState().status).toBe('playing')
    expect(soundingNow(session)).toEqual([])

    session.time.advance(200)
    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
  })

  it('plays the whole song again when asked to play', () => {
    const session = playing(arrangementOf([note(60, 0, 0.3), note(64, 0.3, 0.3)]))
    session.time.advance(700)
    session.heard.length = 0

    session.player.play()
    session.time.advance(700)

    expect(names(session.heard)).toEqual(['on 60', 'off 60', 'on 64', 'off 64'])
    expect(session.player.getState().status).toBe('stopped')
  })
})

describe('pause', () => {
  it('lets go of every note and keeps the place', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    expect(soundingNow(session)).toEqual([60, 64])

    session.player.pause()

    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState().status).toBe('paused')
    expect(session.player.getState().position).toBeCloseTo(0.7, 9)
    expect(session.time.timerCount()).toBe(0)

    session.time.advance(5000)
    expect(session.player.getPosition()).toBeCloseTo(0.7, 9)
    expect(names(session.heard)).toEqual(['on 60', 'on 64', 'off 60', 'off 64'])
  })

  it('keeps the exact place, also between two ticks', () => {
    const session = playing(TUNE)
    session.time.advance(702)

    session.player.pause()

    expect(session.player.getState().position).toBeCloseTo(0.702, 9)
    expect(session.player.getPosition()).toBeCloseTo(0.702, 9)
  })

  it('then play carries on with the next note, without restarting the ones that were cut', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.player.pause()
    session.heard.length = 0

    session.player.play()
    session.time.advance(400)
    expect(soundingNow(session)).toEqual([])
    session.time.advance(200)
    expect(soundingNow(session)).toEqual([67])
    session.time.advance(1300)

    expect(names(session.heard)).toEqual(['on 67', 'off 67', 'on 72', 'off 72'])
    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
  })
})

describe('stop', () => {
  it('lets go of every note and goes back to the start', () => {
    const session = playing(TUNE)
    session.time.advance(700)

    session.player.stop()

    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(session.player.getPosition()).toBe(0)
    expect(session.time.timerCount()).toBe(0)
  })

  it('works on a paused song too', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.player.pause()

    session.player.stop()

    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
  })

  it('then play starts the song from its first note', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.player.stop()
    session.heard.length = 0

    session.player.play()
    session.time.advance(100)

    expect(names(session.heard)).toEqual(['on 60'])
  })
})

describe('seek', () => {
  it('stays inside the song', () => {
    const session = setUp()
    load(session, TUNE)
    const { player } = session

    player.seek(-3)
    expect(player.getPosition()).toBe(0)
    player.seek(99)
    expect(player.getPosition()).toBe(2.5)
    player.seek(1.25)
    expect(player.getPosition()).toBe(1.25)
    player.seek(Number.NaN)
    expect(player.getPosition()).toBe(1.25)
    player.seek(Number.POSITIVE_INFINITY)
    expect(player.getPosition()).toBe(2.5)
    player.seek(Number.NEGATIVE_INFINITY)
    expect(player.getPosition()).toBe(0)
  })

  it('moves a stopped song without playing it', () => {
    const session = setUp()
    load(session, TUNE)

    session.player.seek(0.7)
    session.time.advance(1000)

    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0.7 })
    expect(session.time.timersMade()).toBe(0)
    expect(session.heard).toEqual([])
  })

  it('moves a paused song without playing it', () => {
    const session = playing(TUNE)
    session.time.advance(100)
    session.player.pause()
    session.heard.length = 0

    session.player.seek(1.25)
    session.time.advance(1000)

    expect(session.player.getState()).toMatchObject({ status: 'paused', position: 1.25 })
    expect(session.time.timerCount()).toBe(0)
    expect(session.heard).toEqual([])
  })

  it('while playing, lets go of every note and carries on with the next one that starts', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    expect(soundingNow(session)).toEqual([60, 64])

    session.player.seek(1)

    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState()).toMatchObject({ status: 'playing', position: 1 })
    expect(session.time.timerCount()).toBe(1)

    // The note that is in the middle of sounding at 1.0 in the song is not restarted.
    session.time.advance(100)
    expect(soundingNow(session)).toEqual([])
    session.time.advance(200)
    expect(soundingNow(session)).toEqual([67])
  })

  it('puts the song exactly where asked, also between two ticks', () => {
    const session = playing(TUNE)
    session.time.advance(703)

    session.player.seek(1)
    expect(session.player.getPosition()).toBe(1)

    session.time.advance(2)
    expect(session.player.getPosition()).toBeCloseTo(1.002, 9)
  })

  it('plays a note that starts exactly where the song was put', () => {
    const session = setUp()
    load(session, TUNE)

    session.player.seek(1.2)
    session.player.play()
    session.time.advance(TICK_MS)

    expect(soundingNow(session)).toEqual([67])
  })

  it('going back plays the notes again', () => {
    const session = playing(TUNE)
    session.time.advance(700)

    session.player.seek(0)
    session.time.advance(100)

    expect(names(session.heard)).toEqual(['on 60', 'on 64', 'off 60', 'off 64', 'on 60'])
  })

  it('to the very end while playing ends the song', () => {
    const session = playing(TUNE)
    session.time.advance(100)

    session.player.seek(2.5)
    expect(soundingNow(session)).toEqual([])
    session.time.advance(TICK_MS)

    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(session.time.timerCount()).toBe(0)
  })
})

describe('play', () => {
  it('at the very end starts again from the beginning', () => {
    const session = setUp()
    load(session, TUNE)
    session.player.seek(99)
    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 2.5 })

    session.player.play()

    expect(session.player.getState()).toMatchObject({ status: 'playing', position: 0 })
    session.time.advance(TICK_MS)
    expect(soundingNow(session)).toEqual([60])
  })

  it('twice is the same as once', () => {
    const session = playing(TUNE)
    session.time.advance(703)
    const news = countNews(session.player)

    session.player.play()
    expect(news()).toBe(0)
    session.time.advance(2)

    expect(session.time.timersMade()).toBe(1)
    expect(session.player.getPosition()).toBeCloseTo(0.705, 9)
    expect(names(session.heard)).toEqual(['on 60', 'on 64'])
  })
})

describe('speed', () => {
  it('stays between the slowest and the fastest', () => {
    const { player } = setUp()

    player.setSpeed(0.1)
    expect(player.getState().speed).toBe(MIN_SPEED)
    player.setSpeed(9)
    expect(player.getState().speed).toBe(MAX_SPEED)
    player.setSpeed(0.75)
    expect(player.getState().speed).toBe(0.75)
    player.setSpeed(Number.NaN)
    expect(player.getState().speed).toBe(0.75)
    player.setSpeed(Number.NEGATIVE_INFINITY)
    expect(player.getState().speed).toBe(MIN_SPEED)
    player.setSpeed(Number.POSITIVE_INFINITY)
    expect(player.getState().speed).toBe(MAX_SPEED)
  })

  it('takes effect at once', () => {
    const session = playing(LONG_NOTE)

    session.time.advance(1000)
    expect(session.player.getPosition()).toBeCloseTo(1, 9)
    session.player.setSpeed(0.5)
    session.time.advance(1000)
    expect(session.player.getPosition()).toBeCloseTo(1.5, 9)
    session.player.setSpeed(1.5)
    session.time.advance(1000)
    expect(session.player.getPosition()).toBeCloseTo(3, 9)
  })

  it('counts the time since the last tick at the old speed', () => {
    const session = playing(LONG_NOTE)
    session.time.advance(1003)

    session.player.setSpeed(0.5)
    expect(session.player.getPosition()).toBeCloseTo(1.003, 9)
    expect(session.player.getState().position).toBeCloseTo(1.003, 9)

    session.time.advance(2)
    expect(session.player.getPosition()).toBeCloseTo(1.004, 9)
  })

  it('set to what it already is, changes nothing and tells nobody', () => {
    const session = playing(LONG_NOTE)
    session.time.advance(703)
    const before = session.player.getState()
    const news = countNews(session.player)

    session.player.setSpeed(1)

    expect(session.player.getState()).toBe(before)
    expect(news()).toBe(0)
  })

  it('does not cut the notes that are sounding', () => {
    const session = playing(TUNE)
    session.time.advance(700)

    session.player.setSpeed(1.5)

    expect(soundingNow(session)).toEqual([60, 64])
    expect(session.time.timersMade()).toBe(1)
  })

  it('can be set before a song is loaded, and is kept from one song to the next', () => {
    const session = setUp()

    session.player.setSpeed(1.5)
    load(session, TUNE)
    expect(session.player.getState().speed).toBe(1.5)

    session.player.unload()
    session.player.load(OTHER_SONG, OTHER_TUNE)
    expect(session.player.getState().speed).toBe(1.5)
  })
})

describe('load', () => {
  it('stops the song that was playing and shows the new one', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.heard.length = 0

    session.player.load(OTHER_SONG, OTHER_TUNE)

    expect(names(session.heard)).toEqual(['off 60', 'off 64'])
    expect(session.player.getState()).toEqual({
      status: 'stopped',
      songId: 'song-2',
      title: 'Another tune',
      position: 0,
      duration: 2,
      speed: 1,
    })
    expect(session.time.timerCount()).toBe(0)

    session.time.advance(1000)
    expect(soundingNow(session)).toEqual([])
  })

  it('with keepPlace, carries on from the same place with the new notes', () => {
    const session = playing(TUNE)
    session.time.advance(700)

    load(session, OTHER_TUNE, { keepPlace: true })

    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState()).toMatchObject({ status: 'playing', duration: 2 })
    expect(session.player.getPosition()).toBeCloseTo(0.7, 9)
    expect(session.time.timerCount()).toBe(1)
    expect(session.time.timersMade()).toBe(1)

    // The new notes that are in the middle of sounding at this place are not started.
    session.time.advance(100)
    expect(soundingNow(session)).toEqual([])
    session.time.advance(200)
    expect(soundingNow(session)).toEqual([52])
  })

  it('with keepPlace, does not lose time between two ticks', () => {
    const session = playing(LONG_NOTE)
    session.time.advance(703)

    load(session, OTHER_TUNE, { keepPlace: true })
    expect(session.player.getPosition()).toBeCloseTo(0.703, 9)

    session.time.advance(2)
    expect(session.player.getPosition()).toBeCloseTo(0.705, 9)
  })

  it('with keepPlace, a paused song stays paused where it was', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.player.pause()

    session.player.load({ id: SONG.id, title: 'A new name' }, OTHER_TUNE, { keepPlace: true })

    expect(session.player.getState().status).toBe('paused')
    expect(session.player.getState().title).toBe('A new name')
    expect(session.player.getState().position).toBeCloseTo(0.7, 9)
    expect(session.time.timerCount()).toBe(0)
  })

  it('with keepPlace, a stopped song stays stopped, then plays the new notes', () => {
    const session = setUp()
    load(session, TUNE)

    load(session, OTHER_TUNE, { keepPlace: true })
    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0, duration: 2 })

    session.player.play()
    session.time.advance(TICK_MS)
    expect(soundingNow(session)).toEqual([48])
  })

  it('with keepPlace and a shorter song, a paused song is put at the new end', () => {
    const session = playing(TUNE)
    session.time.advance(2000)
    session.player.pause()

    load(session, SHORT_TUNE, { keepPlace: true })
    expect(session.player.getState()).toMatchObject({ status: 'paused', position: 1, duration: 1 })

    session.player.play()
    expect(session.player.getState()).toMatchObject({ status: 'playing', position: 0 })
  })

  it('with keepPlace and a shorter song, a song playing past the new end is over', () => {
    const session = playing(TUNE)
    session.time.advance(2000)

    load(session, SHORT_TUNE, { keepPlace: true })
    expect(soundingNow(session)).toEqual([])
    session.time.advance(TICK_MS)

    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(session.time.timerCount()).toBe(0)
    expect(soundingNow(session)).toEqual([])
  })

  it('with keepPlace and the notes it already has, only takes the new name', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.heard.length = 0
    const news = countNews(session.player)

    session.player.load({ id: SONG.id, title: 'A new name' }, TUNE, { keepPlace: true })

    // A name is not a note: nothing is let go, nothing is struck again.
    expect(session.heard).toEqual([])
    expect(soundingNow(session)).toEqual([60, 64])
    expect(session.player.getState()).toMatchObject({
      status: 'playing',
      songId: 'song-1',
      title: 'A new name',
      duration: 2.5,
    })
    expect(session.player.getPosition()).toBeCloseTo(0.7, 9)
    expect(news()).toBe(1)
    expect(session.time.timersMade()).toBe(1)

    // The notes that were sounding end where the song says, and the rest of it follows.
    session.time.advance(305)
    expect(soundingNow(session)).toEqual([64])
    session.time.advance(2000)
    expect(names(session.heard)).toEqual(['off 60', 'on 67', 'off 64', 'off 67', 'on 72', 'off 72'])
    expect(session.player.getState()).toMatchObject({ status: 'stopped', title: 'A new name' })
  })

  it('with keepPlace and the notes it already has, a paused song only takes the new name', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.player.pause()
    session.heard.length = 0

    session.player.load({ id: SONG.id, title: 'A new name' }, TUNE, { keepPlace: true })

    expect(session.heard).toEqual([])
    expect(session.player.getState()).toMatchObject({ status: 'paused', title: 'A new name' })
    expect(session.player.getState().position).toBeCloseTo(0.7, 9)
    expect(session.time.timerCount()).toBe(0)
  })

  it('with keepPlace and a copy of the notes it has, lets go of the notes it is playing', () => {
    const session = playing(TUNE)
    session.time.advance(700)

    load(session, { ...TUNE, notes: [...TUNE.notes] }, { keepPlace: true })

    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState().status).toBe('playing')
    expect(session.player.getPosition()).toBeCloseTo(0.7, 9)
  })

  it('with keepPlace, the notes it already has and another length, takes the new length', () => {
    const session = playing(TUNE)
    session.time.advance(700)

    load(session, { ...TUNE, duration: 1 }, { keepPlace: true })

    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState()).toMatchObject({ status: 'playing', duration: 1 })

    session.time.advance(400)
    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(soundingNow(session)).toEqual([])
  })

  it('without keepPlace, stops and lets go of the notes even when they are the ones it has', () => {
    const session = playing(TUNE)
    session.time.advance(700)

    load(session, TUNE)

    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(session.time.timerCount()).toBe(0)
  })

  it('with keepPlace on an empty player, simply loads the song', () => {
    const session = setUp()

    load(session, TUNE, { keepPlace: true })

    expect(session.player.getState()).toMatchObject({
      status: 'stopped',
      position: 0,
      songId: 'song-1',
    })
  })
})

describe('unload and dispose', () => {
  it('unload goes back to empty and lets go of every note', () => {
    const session = playing(TUNE)
    session.player.setSpeed(1.5)
    session.time.advance(500)

    session.player.unload()

    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState()).toEqual({
      status: 'empty',
      songId: null,
      title: '',
      position: 0,
      duration: 0,
      speed: 1.5,
    })
    expect(session.time.timerCount()).toBe(0)

    session.player.play()
    session.time.advance(1000)
    expect(session.time.timerCount()).toBe(0)
    expect(count(session.heard, 'on')).toBe(count(session.heard, 'off'))
  })

  it('dispose lets go of every note, removes the timer and tells subscribers one last time', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    const news = countNews(session.player)

    session.player.dispose()

    expect(soundingNow(session)).toEqual([])
    expect(session.time.timerCount()).toBe(0)
    expect(session.player.getState().status).toBe('empty')
    expect(news()).toBe(1)
  })

  it('a disposed player ignores everything', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    const news = countNews(session.player)
    session.player.dispose()
    const after = session.player.getState()
    const heardBefore = session.heard.length
    const lateNews = countNews(session.player)

    load(session, OTHER_TUNE)
    load(session, OTHER_TUNE, { keepPlace: true })
    session.player.play()
    session.player.seek(1)
    session.player.setSpeed(1.5)
    session.player.pause()
    session.player.stop()
    session.player.unload()
    session.player.dispose()
    session.time.advance(1000)

    expect(session.player.getState()).toBe(after)
    expect(session.player.getPosition()).toBe(0)
    expect(session.time.timersMade()).toBe(1)
    expect(session.heard).toHaveLength(heardBefore)
    expect(news()).toBe(1)
    expect(lateNews()).toBe(0)
  })

  it('a disposed player leaves the notes of another player on the same bus alone', () => {
    const session = playing(TUNE)
    session.player.dispose()
    const second = newPlayer(session.bus, session.time)
    second.load(SONG, TUNE)
    second.play()
    session.time.advance(700)

    session.player.stop()
    session.player.unload()
    session.player.seek(0)

    expect(soundingNow(session)).toEqual([60, 64])
  })

  it('a subscriber told about the dispose cannot bring the player back', () => {
    const session = playing(TUNE)
    session.player.subscribe(() => {
      session.player.load(SONG, TUNE)
      session.player.play()
    })

    session.player.dispose()
    session.time.advance(1000)

    expect(session.player.getState().status).toBe('empty')
    expect(session.time.timerCount()).toBe(0)
    expect(soundingNow(session)).toEqual([])
  })
})

describe('other things on the bus', () => {
  it('carries on when someone else silences the bus in the middle of a note', () => {
    const session = playing(arrangementOf([note(60, 0, 1), note(64, 1, 0.5)]))
    session.time.advance(500)

    session.bus.allOff()
    expect(soundingNow(session)).toEqual([])

    // The silenced note is not pressed again, and letting go of it later disturbs nothing.
    session.time.advance(400)
    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState().status).toBe('playing')
    session.time.advance(200)
    expect(soundingNow(session)).toEqual([64])

    session.time.advance(600)
    expect(names(session.heard)).toEqual(['on 60', 'off 60', 'on 64', 'off 64'])
    expect(session.player.getState().status).toBe('stopped')
  })

  it('plays a note again after it was silenced by someone else', () => {
    const session = playing(arrangementOf([note(60, 0, 1), note(60, 1, 0.5)]))
    session.time.advance(500)
    session.bus.allOff()

    session.time.advance(600)

    expect(soundingNow(session)).toEqual([60])
  })

  it('leaves alone the notes the person is holding on the computer keyboard', () => {
    const session = setUp()
    load(session, arrangementOf([note(60, 0, 0.5), note(64, 0.2, 2)]))
    session.bus.noteOn(60, 'keyboard')
    session.bus.noteOn(72, 'keyboard')
    session.player.play()

    // The song lets go of its own 60: the key is still down, so the note still sounds.
    session.time.advance(700)
    expect(soundingNow(session)).toEqual([60, 64, 72])

    session.player.pause()
    expect(soundingNow(session)).toEqual([60, 72])
    session.player.stop()
    session.player.unload()
    expect(soundingNow(session)).toEqual([60, 72])

    session.bus.allOff('keyboard')
    expect(soundingNow(session)).toEqual([])
  })
})

describe('the notes the player keeps track of', () => {
  it('lets go of a note once, not again at every tick', () => {
    const session = playing(
      arrangementOf([note(60, 0, 0.1), note(64, 0.2, 0.1), note(67, 0.4, 10)]),
    )
    const letGo = vi.spyOn(session.bus, 'noteOff')

    session.time.advance(1000)

    expect(letGo.mock.calls).toEqual([
      [60, 'playback'],
      [64, 'playback'],
    ])
  })

  it('forgets the notes that a seek cut off', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.player.seek(0.9)
    const letGo = vi.spyOn(session.bus, 'noteOff')

    // In the song the first note ends at 1.0, but the player is no longer holding it.
    session.time.advance(200)

    expect(letGo).not.toHaveBeenCalled()
  })
})

describe('the timer', () => {
  it('ticks every 5 ms', () => {
    const session = playing(TUNE)

    expect(session.time.tickLengths()).toEqual([5])
  })

  it('exists only while the song is playing', () => {
    const session = setUp()
    const { player, time } = session
    const expectTimers = (wanted: number): void => {
      expect(time.timerCount()).toBe(wanted)
      expect(player.getState().status === 'playing').toBe(wanted === 1)
    }

    expectTimers(0)
    load(session, TUNE)
    expectTimers(0)
    player.play()
    expectTimers(1)
    player.seek(1)
    player.setSpeed(1.5)
    load(session, OTHER_TUNE, { keepPlace: true })
    time.advance(100)
    expectTimers(1)
    player.pause()
    expectTimers(0)
    player.play()
    expectTimers(1)
    player.stop()
    expectTimers(0)
    player.play()
    time.advance(5000)
    expectTimers(0)
    player.play()
    expectTimers(1)
    load(session, TUNE)
    expectTimers(0)
    player.play()
    expectTimers(1)
    player.unload()
    expectTimers(0)

    // One timer for each time the song was set playing, and none left running.
    expect(time.timersMade()).toBe(5)
  })

  it('uses the clock and the timers of the browser when it is given none', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const bus = new NoteBus()
    const player = createSongPlayer({ bus })
    player.load(SONG, TUNE)
    player.play()

    vi.advanceTimersByTime(700)
    expect([...bus.getActiveNotes()]).toEqual([60, 64])
    expect(player.getPosition()).toBeCloseTo(0.7, 9)
    expect(vi.getTimerCount()).toBe(1)

    player.pause()
    expect(vi.getTimerCount()).toBe(0)
    expect([...bus.getActiveNotes()]).toEqual([])
  })

  it('plays nothing when a tick arrives late, after the song was stopped', () => {
    const session = playing(arrangementOf([note(60, 0, 1)]))
    session.time.advance(100)
    session.player.stop()
    const stopped = session.player.getState()
    session.heard.length = 0

    session.time.stall(50)
    session.time.lateTick()

    expect(session.heard).toEqual([])
    expect(session.player.getState()).toBe(stopped)
    expect(session.player.getPosition()).toBe(0)
  })
})

describe('getState and getPosition', () => {
  it('getState hands out the same object until something changes', () => {
    const session = setUp()
    load(session, TUNE)
    const stopped = session.player.getState()

    session.player.pause()
    session.player.stop()
    session.player.seek(0)
    session.player.setSpeed(1)
    load(session, TUNE)
    expect(session.player.getState()).toBe(stopped)

    session.player.play()
    const started = session.player.getState()
    expect(started).not.toBe(stopped)
    expect(started.status).toBe('playing')
    expect(session.player.getState()).toBe(started)
  })

  it('never changes a snapshot it has handed out', () => {
    const session = playing(TUNE)
    const started = session.player.getState()

    session.time.advance(700)
    session.player.setSpeed(1.5)
    session.player.pause()

    expect(started).toEqual({
      status: 'playing',
      songId: 'song-1',
      title: 'A test tune',
      position: 0,
      duration: 2.5,
      speed: 1,
    })
    expect(Object.isFrozen(started)).toBe(true)
  })

  it('refreshes the position in the snapshot about ten times a second while playing', () => {
    const session = playing(LONG_NOTE)
    const snapshots = new Set<PlayerState>([session.player.getState()])

    for (let tick = 0; tick < 200; tick++) {
      session.time.advance(TICK_MS)
      const snapshot = session.player.getState()
      snapshots.add(snapshot)
      const behind = session.player.getPosition() - snapshot.position
      expect(behind).toBeGreaterThanOrEqual(0)
      expect(behind).toBeLessThan(0.1)
    }

    // One second of playing: the first snapshot, then about ten more.
    expect(snapshots.size).toBeGreaterThanOrEqual(10)
    expect(snapshots.size).toBeLessThanOrEqual(12)
  })

  it('getPosition is exact between two ticks, while the snapshot waits', () => {
    const session = playing(LONG_NOTE)
    session.player.setSpeed(1.5)
    session.time.advance(1000)
    const snapshot = session.player.getState()

    session.time.advance(3)

    expect(session.player.getPosition()).toBeCloseTo(1.5045, 9)
    expect(session.player.getState()).toBe(snapshot)
  })

  it('getPosition stops at the end of the song', () => {
    const session = playing(SHORT_TUNE)
    session.time.advance(995)

    session.time.stall(200)

    expect(session.player.getPosition()).toBe(1)
  })
})

describe('subscribers', () => {
  it('are told at once about the song, the status, the speed and a seek', () => {
    const session = setUp()
    const { player } = session
    const news: PlayerState[] = []
    player.subscribe(() => news.push(player.getState()))

    load(session, TUNE)
    expect(news).toHaveLength(1)
    expect(news.at(-1)).toMatchObject({ status: 'stopped', songId: 'song-1', duration: 2.5 })
    player.play()
    expect(news).toHaveLength(2)
    expect(news.at(-1)?.status).toBe('playing')
    player.setSpeed(1.5)
    expect(news).toHaveLength(3)
    expect(news.at(-1)?.speed).toBe(1.5)
    player.seek(1)
    expect(news).toHaveLength(4)
    expect(news.at(-1)?.position).toBe(1)
    player.pause()
    expect(news).toHaveLength(5)
    expect(news.at(-1)?.status).toBe('paused')
    player.seek(2)
    expect(news).toHaveLength(6)
    expect(news.at(-1)?.position).toBe(2)
    player.stop()
    expect(news).toHaveLength(7)
    expect(news.at(-1)).toMatchObject({ status: 'stopped', position: 0 })
    player.load(OTHER_SONG, OTHER_TUNE)
    expect(news).toHaveLength(8)
    expect(news.at(-1)?.songId).toBe('song-2')
    player.unload()
    expect(news).toHaveLength(9)
    expect(news.at(-1)?.status).toBe('empty')
  })

  it('are told about the position at most about ten times a second', () => {
    const session = playing(LONG_NOTE)
    const news = countNews(session.player)

    session.time.advance(1000)

    expect(news()).toBeGreaterThanOrEqual(9)
    expect(news()).toBeLessThanOrEqual(11)
  })

  it('are told when the song reaches its end', () => {
    const session = playing(SHORT_TUNE)
    const seen: string[] = []
    session.player.subscribe(() => seen.push(session.player.getState().status))

    session.time.advance(1100)

    expect(seen.at(-1)).toBe('stopped')
    expect(seen.filter((status) => status === 'stopped')).toHaveLength(1)
  })

  it('are told nothing when nothing changes', () => {
    const session = setUp()
    load(session, TUNE)
    const news = countNews(session.player)

    session.player.pause()
    session.player.stop()
    session.player.seek(0)
    session.player.seek(-5)
    session.player.setSpeed(1)
    session.player.setSpeed(Number.NaN)
    session.player.seek(Number.NaN)
    load(session, TUNE)
    load(session, TUNE, { keepPlace: true })
    session.time.advance(1000)

    expect(news()).toBe(0)
  })

  it('are no longer told once they have left', () => {
    const session = setUp()
    let news = 0
    const leave = session.player.subscribe(() => {
      news += 1
    })
    load(session, TUNE)
    expect(news).toBe(1)

    leave()
    leave()
    session.player.play()

    expect(news).toBe(1)
  })

  it('who join while the others are being told hear about the next change, not this one', () => {
    const session = setUp()
    let lateNews = 0
    let joined = false
    session.player.subscribe(() => {
      if (joined) return
      joined = true
      session.player.subscribe(() => {
        lateNews += 1
      })
    })

    load(session, TUNE)
    expect(lateNews).toBe(0)

    session.player.play()
    expect(lateNews).toBe(1)
  })

  it('keep being told when one of them fails', () => {
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = setUp()
    session.player.subscribe(() => {
      throw new Error('a broken subscriber')
    })
    const news = countNews(session.player)

    load(session, TUNE)
    session.player.play()
    session.time.advance(700)

    expect(news()).toBeGreaterThanOrEqual(2)
    expect(soundingNow(session)).toEqual([60, 64])
    expect(complaints).toHaveBeenCalled()
  })
})

describe('listeners that call the player back', () => {
  it('a note listener that pauses the song in the middle of a chord leaves silence', () => {
    const session = setUp()
    load(session, arrangementOf([note(60, 0.1, 1), note(64, 0.1, 1), note(67, 0.1, 1)]))
    let pausedOnce = false
    session.bus.subscribe((event) => {
      if (event.type !== 'on' || pausedOnce) return
      pausedOnce = true
      session.player.pause()
    })
    session.player.play()

    session.time.advance(200)

    expect(session.player.getState().status).toBe('paused')
    expect(soundingNow(session)).toEqual([])
    expect(session.time.timerCount()).toBe(0)

    // The rest of the chord was not lost: it sounds when the song carries on.
    session.player.play()
    session.time.advance(50)
    expect(soundingNow(session)).toEqual([64, 67])
  })

  it('a note listener that moves the song leaves nothing sounding', () => {
    const session = setUp()
    load(
      session,
      arrangementOf([note(60, 0, 0.5), note(64, 0.3, 0.5), note(67, 0.3, 0.5), note(72, 1, 0.5)]),
    )
    let movedOnce = false
    session.bus.subscribe((event) => {
      if (event.type !== 'on' || event.midi !== 64 || movedOnce) return
      movedOnce = true
      session.player.seek(0.9)
    })
    session.player.play()

    for (let tick = 0; tick < 100 && !movedOnce; tick++) session.time.advance(TICK_MS)

    expect(movedOnce).toBe(true)
    expect(soundingNow(session)).toEqual([])
    expect(session.player.getState().status).toBe('playing')
    expect(session.player.getPosition()).toBeCloseTo(0.9, 9)
    expect(names(session.heard)).not.toContain('on 67')

    session.time.advance(200)
    expect(soundingNow(session)).toEqual([72])
  })

  it('a note listener that replaces the song leaves nothing of the old one sounding', () => {
    const session = setUp()
    load(session, arrangementOf([note(60, 0.1, 1), note(64, 0.1, 1), note(67, 0.1, 1)]))
    let replacedOnce = false
    session.bus.subscribe((event) => {
      if (event.type !== 'on' || replacedOnce) return
      replacedOnce = true
      load(session, OTHER_TUNE, { keepPlace: true })
    })
    session.player.play()

    session.time.advance(105)
    expect(soundingNow(session)).toEqual([])

    session.time.advance(500)
    expect(soundingNow(session)).toEqual([50])
  })

  it('a note listener that unloads the song leaves nothing sounding and no timer', () => {
    const session = setUp()
    load(session, arrangementOf([note(60, 0.1, 1), note(64, 0.1, 1)]))
    session.bus.subscribe((event) => {
      if (event.type === 'on') session.player.unload()
    })
    session.player.play()

    session.time.advance(1000)

    expect(session.player.getState().status).toBe('empty')
    expect(names(session.heard)).toEqual(['on 60', 'off 60'])
    expect(session.time.timerCount()).toBe(0)
  })

  it('a note listener that stops the song when a note ends leaves nothing sounding', () => {
    const session = setUp()
    load(session, arrangementOf([note(60, 0, 0.5), note(62, 0, 0.5), note(64, 0.5, 1)]))
    session.bus.subscribe((event) => {
      if (event.type === 'off' && session.player.getState().status === 'playing') {
        session.player.stop()
      }
    })
    session.player.play()

    session.time.advance(1000)

    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(soundingNow(session)).toEqual([])
    expect(names(session.heard)).not.toContain('on 64')
  })

  it('a note listener that pauses the song as its last note ends leaves it paused', () => {
    const session = setUp()
    load(session, arrangementOf([note(60, 0, 0.5)]))
    session.bus.subscribe((event) => {
      if (event.type === 'off') session.player.pause()
    })
    session.player.play()

    session.time.advance(1000)

    expect(session.player.getState()).toMatchObject({ status: 'paused', position: 0.5 })
    expect(session.time.timerCount()).toBe(0)
  })

  it('a note listener that stops the song while it is being paused has the last word', () => {
    const session = playing(TUNE)
    session.time.advance(700)
    session.bus.subscribe((event) => {
      if (event.type === 'off') session.player.stop()
    })

    session.player.pause()

    expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(soundingNow(session)).toEqual([])
  })

  it('a subscriber that plays the song again each time it ends', () => {
    const session = setUp()
    load(session, SHORT_TUNE)
    let replays = 0
    session.player.subscribe(() => {
      if (session.player.getState().status !== 'stopped' || replays === 2) return
      replays += 1
      session.player.play()
    })
    session.player.play()

    session.time.advance(5000)

    expect(replays).toBe(2)
    expect(count(session.heard, 'on')).toBe(6)
    expect(count(session.heard, 'off')).toBe(6)
    expect(session.player.getState().status).toBe('stopped')
    expect(session.time.timerCount()).toBe(0)
  })
})

describe('a song that breaks the promises of the arranger', () => {
  it('leaves nothing stuck when two notes of the same pitch overlap', () => {
    const session = playing(
      arrangementOf([note(60, 0, 1), note(60, 0.2, 0.2), note(60, 0.5, 2), note(64, 0.1, 0.3)]),
    )

    session.time.advance(4000)

    expect(session.player.getState().status).toBe('stopped')
    expect(soundingNow(session)).toEqual([])
    expect(count(session.heard, 'on')).toBe(count(session.heard, 'off'))
  })

  it.each([Number.NaN, -3, Number.POSITIVE_INFINITY])(
    'treats a length of %s as a song with nothing in it',
    (duration) => {
      const session = setUp()
      session.player.load(SONG, { notes: [], duration, offPianoCount: 0 })
      expect(session.player.getState()).toMatchObject({ status: 'stopped', duration: 0 })

      session.player.play()
      session.time.advance(100)

      expect(session.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
      expect(session.time.timerCount()).toBe(0)
    },
  )
})

/*
 * From here on: the player is put through sequences of operations, and after
 * every single step and every single tick the tests check that nothing is stuck.
 */

/** One thing done to the player (or to the clock). */
interface Step {
  name: string
  /**
   * 'cut': must leave no note sounding. 'time': only lets time go by.
   * 'other': neither (play, speed).
   */
  kind: 'cut' | 'time' | 'other'
  run(session: Session): void
}

const play: Step = { name: 'play', kind: 'other', run: (session) => session.player.play() }
const pause: Step = { name: 'pause', kind: 'cut', run: (session) => session.player.pause() }
const stop: Step = { name: 'stop', kind: 'cut', run: (session) => session.player.stop() }
const unload: Step = { name: 'unload', kind: 'cut', run: (session) => session.player.unload() }
const dispose: Step = { name: 'dispose', kind: 'cut', run: (session) => session.player.dispose() }
const hush: Step = { name: 'bus.allOff', kind: 'cut', run: (session) => session.bus.allOff() }

function seek(seconds: number): Step {
  return { name: `seek ${seconds}`, kind: 'cut', run: (session) => session.player.seek(seconds) }
}

function speed(value: number): Step {
  return { name: `speed ${value}`, kind: 'other', run: (session) => session.player.setSpeed(value) }
}

function loadSong(name: string, arrangement: Arrangement): Step {
  return { name: `load ${name}`, kind: 'cut', run: (session) => load(session, arrangement) }
}

function reload(name: string, arrangement: Arrangement): Step {
  return {
    name: `reload ${name}`,
    kind: 'cut',
    run: (session) => load(session, arrangement, { keepPlace: true }),
  }
}

function wait(ms: number): Step {
  return { name: `wait ${ms}`, kind: 'time', run: (session) => session.time.advance(ms) }
}

function sleep(ms: number): Step {
  return {
    name: `sleep ${ms}`,
    kind: 'time',
    run: (session) => {
      session.time.stall(ms)
      session.time.wake()
    },
  }
}

function pressedInThisTick(session: Session, midi: Midi): boolean {
  const now = session.time.now()
  for (let index = session.heard.length - 1; index >= 0; index--) {
    const event = session.heard[index]
    if (event === undefined || event.at !== now) return false
    if (event.type === 'on' && event.midi === midi) return true
  }
  return false
}

/**
 * Run after every tick. While the song plays, a note sounds if and only if
 * the song has it at this position, with two exceptions that are both
 * intended: a note cut off by a pause, a seek or a load is not started again,
 * and a note pressed in this very tick is kept until the next one.
 */
function expectWhatTheSongSays(session: Session): void {
  const { player, sounding, loaded, since } = session
  if (player.getState().status !== 'playing') {
    if (sounding.size > 0) throw new Error(`sounding after the song stopped: ${[...sounding]}`)
    return
  }
  const position = player.getPosition()
  const inTheSong = (each: PlayableNote): boolean =>
    each.time <= position && position < each.time + each.duration

  for (const midi of sounding) {
    const wanted = loaded.some((each) => each.midi === midi && inTheSong(each))
    if (!wanted && !pressedInThisTick(session, midi)) {
      throw new Error(`note ${midi} is stuck at ${position}`)
    }
  }
  for (const each of loaded) {
    if (each.time > since && inTheSong(each) && !sounding.has(each.midi)) {
      throw new Error(`note ${each.midi} (at ${each.time}) is missing at ${position}`)
    }
  }
}

/** Runs one step, then checks what must hold whatever the step was. */
function perform(session: Session, step: Step): void {
  step.run(session)
  if (step.kind !== 'time') session.since = session.player.getPosition()

  const state = session.player.getState()
  const silent = step.kind === 'cut' || state.status !== 'playing'
  if (silent) expect(soundingNow(session), `after ${step.name}`).toEqual([])
  expect(session.time.timerCount(), `after ${step.name}`).toBe(state.status === 'playing' ? 1 : 0)
  expect(count(session.heard, 'on') - count(session.heard, 'off')).toBe(session.sounding.size)
  expect(state.position).toBeGreaterThanOrEqual(0)
  expect(state.position).toBeLessThanOrEqual(state.duration)
  expect(session.player.getPosition()).toBeLessThanOrEqual(state.duration)
  expect(state.speed).toBeGreaterThanOrEqual(MIN_SPEED)
  expect(state.speed).toBeLessThanOrEqual(MAX_SPEED)
}

function expectEveryPressReleased(session: Session): void {
  session.player.stop()
  expect(soundingNow(session)).toEqual([])
  expect(count(session.heard, 'on')).toBe(count(session.heard, 'off'))
  expect(session.time.timerCount()).toBe(0)
}

const loadTune = loadSong('the tune', TUNE)
const loadOther = loadSong('the other tune', OTHER_TUNE)
const reloadTune = reload('the tune', TUNE)
const reloadOther = reload('the other tune', OTHER_TUNE)
const reloadShort = reload('the short tune', SHORT_TUNE)

/** Each list starts with the tune loaded and stopped. */
const ORDERS: readonly (readonly Step[])[] = [
  [play, wait(300), pause, play, wait(300), stop],
  [play, wait(300), stop, play, wait(300), pause, stop, play, wait(3000)],
  [play, wait(700), seek(1), wait(300), seek(0.1), wait(200), pause, seek(2), play, wait(300)],
  [play, wait(300), speed(1.5), wait(300), speed(0.5), wait(300), pause, speed(1), play, wait(300)],
  [play, wait(700), loadOther, play, wait(700), reloadTune, wait(300), reloadShort, wait(300)],
  [play, wait(700), pause, reloadOther, play, wait(300), unload, play, wait(100)],
  [play, wait(700), unload, loadTune, seek(1.5), play, wait(5000), play, wait(100)],
  [play, wait(700), dispose, play, wait(300), loadTune, play, seek(1), wait(100)],
  [pause, stop, seek(1), play, wait(200), play, pause, pause, stop, stop, unload, unload],
  [play, sleep(3000), wait(100), sleep(400), seek(0.5), sleep(1000), pause, sleep(1000), play],
  [play, wait(700), hush, wait(300), seek(0.2), wait(400), hush, pause, play, wait(5000)],
  [seek(1), play, wait(100), stop, seek(2.5), play, wait(100), speed(1.5), reloadOther, wait(900)],
  [play, wait(703), seek(0.5), wait(1), pause, wait(1), play, wait(1), speed(0.5), wait(1), stop],
  [play, wait(2400), reloadShort, play, wait(500), seek(99), wait(5), play, wait(5)],
]

describe('operations in many orders', () => {
  it.each(ORDERS.map((steps) => [steps.map((step) => step.name).join(', '), steps] as const))(
    'nothing stuck after: %s',
    (_name, steps) => {
      const session = setUp()
      session.time.onTick(() => expectWhatTheSongSays(session))
      load(session, TUNE)

      for (const step of steps) perform(session, step)

      expectEveryPressReleased(session)
    },
  )
})

describe('a long random session', () => {
  function randomStep(session: Session, random: () => number): Step {
    const { status, duration } = session.player.getState()
    const anotherSong = (): Arrangement => randomArrangement(random)
    if (status === 'empty') return random() < 0.8 ? loadSong('a song', anotherSong()) : play
    if (status !== 'playing' && random() < 0.5) return play

    const roll = random()
    if (roll < 0.4) return wait(1 + Math.floor(random() * 400))
    if (roll < 0.45) return sleep(260 + Math.floor(random() * 3000))
    if (roll < 0.53) return pause
    if (roll < 0.57) return stop
    if (roll < 0.7) return seek(random() * (duration + 1) - 0.5)
    if (roll < 0.78) return speed(0.3 + random() * 1.4)
    if (roll < 0.83) return loadSong('a song', anotherSong())
    if (roll < 0.91) return reload('a song', anotherSong())
    if (roll < 0.94) return hush
    if (roll < 0.96) return unload
    if (roll < 0.98) return dispose
    return play
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('never leaves a note stuck (seed %s)', (seed) => {
    const random = randomSource(seed * 7919)
    const session = setUp()
    session.time.onTick(() => expectWhatTheSongSays(session))
    let presses = 0
    session.bus.subscribe((event) => {
      if (event.type === 'on') presses += 1
    })

    for (let index = 0; index < 600; index++) {
      const step = randomStep(session, random)
      perform(session, step)
      if (step === dispose) {
        // A disposed player is finished: the session carries on with a new one on the same bus.
        session.player = newPlayer(session.bus, session.time)
        session.loaded = []
        session.since = 0
      }
    }

    // The session really played music: this is not a test of a silent player.
    expect(presses).toBeGreaterThan(200)
    expectEveryPressReleased(session)
  })
})
