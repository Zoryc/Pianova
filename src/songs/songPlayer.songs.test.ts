/**
 * The song player, driven by a clock that only moves when the test moves it:
 * a long song with an uneven timer, changes in the middle of a note, a timer
 * that stalls, listeners that throw or call the player straight back, and
 * random sessions in which the player's own calls to the bus are counted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteBus } from '../core/noteBus'
import type { NoteOnOptions } from '../core/noteBus'
import type { Midi, NoteEvent, NoteSource } from '../core/types'
import type { Arrangement, PlayableNote } from './song'
import { createSongPlayer } from './songPlayer'
import type { SongPlayer } from './songPlayer'

const SONG = { id: 'one', title: 'First song' }
const OTHER = { id: 'two', title: 'Second song' }

function note(midi: Midi, time: number, duration: number, velocity = 0.7): PlayableNote {
  return { midi, time, duration, velocity }
}

function arrangementOf(notes: readonly PlayableNote[]): Arrangement {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi)
  const duration = sorted.reduce((end, each) => Math.max(end, each.time + each.duration), 0)
  return { notes: sorted, duration, offPianoCount: 0 }
}

/** A clock and one-at-a-time timers that the test runs by hand. */
function fakeClock() {
  let time = 50_000
  const timers = new Map<object, () => void>()
  let made = 0
  return {
    now: (): number => time,
    setInterval(handler: () => void): unknown {
      const handle = {}
      timers.set(handle, handler)
      made += 1
      return handle
    },
    clearInterval(handle: unknown): void {
      timers.delete(handle as object)
    },
    /** Lets `ms` pass and then runs the timer once: a tick that comes `ms` after the one before. */
    tickAfter(ms: number): void {
      time += ms
      for (const handler of [...timers.values()]) handler()
    },
    /** A healthy timer for `ms` milliseconds: a tick every `every` milliseconds. */
    run(ms: number, every = 5): void {
      for (let passed = every; passed <= ms + 1e-9; passed += every) this.tickAfter(every)
    },
    /** Time passes and the timer does not run. */
    sleep(ms: number): void {
      time += ms
    },
    running: (): number => timers.size,
    made: (): number => made,
  }
}

type Clock = ReturnType<typeof fakeClock>

/** A bus that writes down what the player itself asks of it, whoever else is holding notes. */
class WatchedBus extends NoteBus {
  /** The notes the 'playback' source holds, by what the player has asked for. */
  readonly playbackHolds = new Set<Midi>()
  presses = 0
  releases = 0

  override noteOn(midi: Midi, source: NoteSource, options?: NoteOnOptions): void {
    if (source === 'playback' && !this.playbackHolds.has(midi)) {
      this.playbackHolds.add(midi)
      this.presses += 1
    }
    super.noteOn(midi, source, options)
  }

  override noteOff(midi: Midi, source: NoteSource, time?: number): void {
    if (source === 'playback' && this.playbackHolds.delete(midi)) this.releases += 1
    super.noteOff(midi, source, time)
  }
}

interface Heard {
  type: 'on' | 'off'
  midi: Midi
  at: number
  source: NoteSource
}

interface Rig {
  bus: WatchedBus
  clock: Clock
  player: SongPlayer
  heard: Heard[]
  /** When the test began, on the clock. */
  start: number
}

function rig(): Rig {
  const bus = new WatchedBus()
  const clock = fakeClock()
  const player = createSongPlayer({
    bus,
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  })
  const heard: Heard[] = []
  bus.subscribe((event: NoteEvent) => {
    heard.push({ type: event.type, midi: event.midi, at: clock.now(), source: event.source })
  })
  return { bus, clock, player, heard, start: clock.now() }
}

function playing(arrangement: Arrangement): Rig {
  const made = rig()
  made.player.load(SONG, arrangement)
  made.player.play()
  return made
}

/** The same music in a list of notes of its own, as arranging the song again gives. */
function copyOf(arrangement: Arrangement): Arrangement {
  return { ...arrangement, notes: [...arrangement.notes] }
}

function log(heard: readonly Heard[]): string[] {
  return heard.map((event) => `${event.type} ${event.midi}`)
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** No two notes of one pitch overlap, as `arrange` promises the player. */
function randomTune(random: () => number, count: number, spacing: number): Arrangement {
  const notes: PlayableNote[] = []
  const freeFrom = new Map<Midi, number>()
  let time = 0
  for (let index = 0; index < count; index++) {
    time += random() * spacing
    const midi = 48 + Math.floor(random() * 30)
    const start = Math.max(time, freeFrom.get(midi) ?? 0)
    const duration = 0.03 + random() * 1.2
    notes.push(note(midi, start, duration, 0.2 + random() * 0.8))
    freeFrom.set(midi, start + duration)
  }
  return arrangementOf(notes)
}

describe('timing over a long song', () => {
  /**
   * Plays the whole tune with a timer that fires unevenly, and returns the
   * latest any note started or stopped after its time, in milliseconds.
   */
  function playThrough(
    tune: Arrangement,
    speed: number,
    gaps: () => number,
  ): { worstLate: number; worstGap: number; made: Rig } {
    const made = rig()
    made.player.load(SONG, tune)
    made.player.setSpeed(speed)
    made.player.play()
    let worstGap = 0
    const limit = made.start + (tune.duration / speed) * 1000 + 60_000
    while (made.player.getState().status === 'playing') {
      if (made.clock.now() > limit) throw new Error('The song did not end.')
      const gap = gaps()
      worstGap = Math.max(worstGap, gap)
      made.clock.tickAfter(gap)
    }

    // Every note was pressed once and released once, in the order of the song.
    const ons = made.heard.filter((event) => event.type === 'on')
    const offs = made.heard.filter((event) => event.type === 'off')
    expect(ons.map((event) => event.midi)).toEqual(tune.notes.map((each) => each.midi))
    expect(offs).toHaveLength(tune.notes.length)

    let worstLate = 0
    ons.forEach((event, index) => {
      const due = made.start + ((tune.notes[index]?.time ?? 0) / speed) * 1000
      expect(event.at).toBeGreaterThanOrEqual(due - 1e-6)
      worstLate = Math.max(worstLate, event.at - due)
    })
    // Each release, matched to the press of its pitch that came before it.
    const pending = new Map<Midi, number[]>()
    for (const each of tune.notes) {
      const ends = pending.get(each.midi) ?? []
      ends.push(made.start + ((each.time + each.duration) / speed) * 1000)
      pending.set(each.midi, ends)
    }
    for (const event of offs) {
      const due = pending.get(event.midi)?.shift()
      if (due === undefined) throw new Error(`A release of ${event.midi} that no note asked for.`)
      expect(event.at).toBeGreaterThanOrEqual(due - 1e-6)
      worstLate = Math.max(worstLate, event.at - due)
    }
    return { worstLate, worstGap, made }
  }

  it('never lets a note of an hour-long song be over a tick late', { timeout: 60_000 }, () => {
    const random = seededRandom(7)
    const tune = randomTune(random, 4000, 1.8)
    expect(tune.duration).toBeGreaterThan(3000)

    // A timer that is asked for every 5 ms and arrives every 4 to 17 ms.
    const { worstLate, worstGap, made } = playThrough(tune, 1, () => 4 + random() * 13)
    expect(worstLate).toBeLessThanOrEqual(worstGap + 1e-6)

    // The end of the song comes when the song is over, not earlier and not a tick later.
    const lastsMs = made.clock.now() - made.start
    expect(lastsMs).toBeGreaterThanOrEqual(tune.duration * 1000 - 1e-6)
    expect(lastsMs).toBeLessThanOrEqual(tune.duration * 1000 + worstGap + 1e-6)
    expect(made.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(made.bus.playbackHolds.size).toBe(0)
    expect(made.clock.running()).toBe(0)
  })

  it('keeps time as well at the slowest and at the fastest speed', () => {
    for (const speed of [0.5, 1.5]) {
      const random = seededRandom(speed * 100)
      const tune = randomTune(random, 600, 1.5)
      const { worstLate, worstGap } = playThrough(tune, speed, () => 4 + random() * 13)
      expect(worstLate, `speed ${speed}`).toBeLessThanOrEqual(worstGap + 1e-6)
    }
  })

  it('reports a position that never runs ahead of the clock or backwards', () => {
    const made = playing(arrangementOf([note(60, 0, 30)]))
    let before = 0
    const random = seededRandom(3)
    for (let step = 0; step < 4000; step++) {
      // Asked between two ticks, as the falling notes do on every frame.
      made.clock.sleep(random() * 3)
      const position = made.player.getPosition()
      expect(position).toBeGreaterThanOrEqual(before)
      expect(position).toBeLessThanOrEqual((made.clock.now() - made.start) / 1000 + 1e-9)
      expect(position).toBeGreaterThanOrEqual((made.clock.now() - made.start) / 1000 - 1e-9)
      before = position
      if (step % 3 === 0) made.clock.tickAfter(0)
    }
  })
})

describe('changes in the middle of a note', () => {
  /** One long note, a short one inside it, and a note after both. */
  const TUNE = arrangementOf([note(60, 0, 2), note(64, 0.5, 0.25), note(67, 2.5, 0.5)])

  it('pause lets go at once; play carries on with the next note, on time', () => {
    const made = playing(TUNE)
    made.clock.run(1000)
    expect(log(made.heard)).toEqual(['on 60', 'on 64', 'off 64'])

    made.player.pause()
    expect(log(made.heard)).toEqual(['on 60', 'on 64', 'off 64', 'off 60'])
    expect(made.bus.playbackHolds.size).toBe(0)
    expect(made.clock.running()).toBe(0)
    expect(made.player.getState().status).toBe('paused')
    const pausedAt = made.player.getState().position
    expect(pausedAt).toBeCloseTo(1, 9)

    // However long the pause, the song has not moved.
    made.clock.sleep(60_000)
    expect(made.player.getPosition()).toBe(pausedAt)

    made.player.play()
    const resumed = made.clock.now()
    made.clock.run(2100)
    // The long note is not struck again; the next one comes 1.5 s of song later.
    expect(log(made.heard).slice(4)).toEqual(['on 67', 'off 67'])
    const next = made.heard[4]
    expect((next?.at ?? 0) - resumed).toBeGreaterThanOrEqual(1500)
    expect((next?.at ?? 0) - resumed).toBeLessThanOrEqual(1505)
    expect(made.player.getState().status).toBe('stopped')
  })

  it('a change of speed moves the end of the note that is sounding', () => {
    const made = playing(arrangementOf([note(60, 0, 2)]))
    made.clock.run(500)
    made.player.setSpeed(0.5)
    // 1.5 s of the note are left, at half speed: 3 s.
    made.clock.run(2990)
    expect(log(made.heard)).toEqual(['on 60'])
    made.clock.run(20)
    expect(log(made.heard)).toEqual(['on 60', 'off 60'])
    // On time, or one tick later when the sums of the clock fall a hair short.
    expect(made.heard[1]?.at).toBeGreaterThanOrEqual(made.start + 3500 - 1e-6)
    expect(made.heard[1]?.at).toBeLessThanOrEqual(made.start + 3505 + 1e-6)
  })

  it('a change of speed between two ticks counts the time before it at the old speed', () => {
    const made = playing(arrangementOf([note(60, 0, 10)]))
    made.clock.run(1000)
    made.clock.sleep(3)
    made.player.setSpeed(1.5)
    expect(made.player.getPosition()).toBeCloseTo(1.003, 9)
    made.clock.sleep(2)
    expect(made.player.getPosition()).toBeCloseTo(1.006, 9)
    expect(made.player.getState()).toMatchObject({ speed: 1.5, status: 'playing' })
  })

  it('seek lets go of what sounds, and strikes no note that began before the new place', () => {
    const made = playing(TUNE)
    made.clock.run(600)
    expect(log(made.heard)).toEqual(['on 60', 'on 64'])

    // Into the long note, after the short one.
    made.player.seek(1.2)
    expect(log(made.heard)).toEqual(['on 60', 'on 64', 'off 60', 'off 64'])
    expect(made.bus.playbackHolds.size).toBe(0)
    expect(made.player.getState()).toMatchObject({ status: 'playing', position: 1.2 })

    made.clock.run(1290)
    expect(log(made.heard)).toHaveLength(4)
    made.clock.run(20)
    expect(log(made.heard).slice(4)).toEqual(['on 67'])
  })

  it('seek backwards plays again the notes that start after the new place', () => {
    const made = playing(TUNE)
    made.clock.run(2700)
    expect(log(made.heard)).toEqual(['on 60', 'on 64', 'off 64', 'off 60', 'on 67'])
    made.player.seek(0.4)
    made.clock.run(120)
    expect(log(made.heard).slice(5)).toEqual(['off 67', 'on 64'])
  })

  it('seek to the very start of a note plays that note, once', () => {
    const made = playing(TUNE)
    made.clock.run(100)
    made.player.seek(0.5)
    made.clock.run(100)
    expect(log(made.heard)).toEqual(['on 60', 'off 60', 'on 64'])
  })

  it('seek and speed changes are ignored when what is asked is not a number', () => {
    const made = playing(TUNE)
    made.clock.run(100)
    const before = made.player.getState()
    made.player.seek(Number.NaN)
    made.player.setSpeed(Number.NaN)
    expect(made.player.getState()).toBe(before)
    expect(made.bus.playbackHolds.has(60)).toBe(true)

    made.player.seek(Number.POSITIVE_INFINITY)
    expect(made.player.getState().position).toBe(TUNE.duration)
    made.player.seek(Number.NEGATIVE_INFINITY)
    expect(made.player.getState().position).toBe(0)
    made.player.setSpeed(Number.POSITIVE_INFINITY)
    expect(made.player.getState().speed).toBe(1.5)
    made.player.setSpeed(-3)
    expect(made.player.getState().speed).toBe(0.5)
  })
})

describe('a timer that stalls', () => {
  const TUNE = arrangementOf(
    [note(60, 0, 0.1), note(62, 0.2, 0.1), note(64, 0.6, 0.1), note(65, 5, 0.1), note(67, 9, 1)],
  )

  it('moves the song a quarter of a second at most, however long the stall', () => {
    const made = playing(TUNE)
    made.clock.run(50)
    made.clock.tickAfter(10_000)
    expect(made.player.getPosition()).toBeCloseTo(0.3, 9)
    // Only what was due in that quarter second is played: no burst of ten seconds of notes.
    expect(log(made.heard)).toEqual(['on 60', 'off 60', 'on 62'])
    expect(made.player.getState().status).toBe('playing')
  })

  it('does not run ahead in between: the falling notes wait with the song', () => {
    const made = playing(TUNE)
    made.clock.run(50)
    made.clock.sleep(10_000)
    expect(made.player.getPosition()).toBeCloseTo(0.3, 9)
    made.clock.sleep(10_000)
    expect(made.player.getPosition()).toBeCloseTo(0.3, 9)
  })

  it('counts a gap of exactly a quarter of a second in full', () => {
    const made = playing(TUNE)
    made.clock.tickAfter(250)
    expect(made.player.getPosition()).toBeCloseTo(0.25, 9)
    made.clock.tickAfter(251)
    expect(made.player.getPosition()).toBeCloseTo(0.5, 9)
  })

  it('crawls, and never jumps, through a timer that fires once a second', () => {
    const made = playing(TUNE)
    for (let second = 0; second < 8; second++) made.clock.tickAfter(1000)
    expect(made.player.getPosition()).toBeCloseTo(2, 9)
    // Each tick plays what was due in its quarter second, and lets go at the next one.
    expect(log(made.heard)).toEqual(['on 60', 'on 62', 'off 60', 'off 62', 'on 64', 'off 64'])
  })

  it('pausing after a stall leaves nothing sounding and loses no later note', () => {
    const made = playing(TUNE)
    made.clock.run(50)
    made.clock.sleep(5000)
    made.player.pause()
    expect(made.bus.playbackHolds.size).toBe(0)
    made.player.play()
    made.clock.run(10_000)
    const struck = made.heard.filter((event) => event.type === 'on').map((event) => event.midi)
    expect(struck).toEqual([60, 62, 64, 65, 67])
    expect(made.bus.playbackHolds.size).toBe(0)
  })

  it('a tick that arrives after its timer was cleared plays nothing', () => {
    const made = rig()
    let handler: (() => void) | null = null
    const player = createSongPlayer({
      bus: made.bus,
      now: made.clock.now,
      setInterval: (tick) => {
        handler = tick
        return 1
      },
      clearInterval: () => undefined,
    })
    player.load(SONG, TUNE)
    player.play()
    player.pause()
    made.clock.sleep(100)
    ;(handler as (() => void) | null)?.()
    player.stop()
    made.clock.sleep(100)
    ;(handler as (() => void) | null)?.()
    expect(made.heard).toEqual([])
    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
  })
})

describe('no stuck notes', () => {
  /** Three notes that sound together for a while, then one more. */
  const CHORD = arrangementOf([note(60, 0, 3), note(64, 0.1, 3), note(67, 0.2, 3), note(72, 4, 1)])
  const OTHER_TUNE = arrangementOf([note(50, 0, 1), note(52, 0.5, 1)])

  const endings: [name: string, act: (made: Rig) => void, timerAfter: number][] = [
    ['pause', (made) => made.player.pause(), 0],
    ['stop', (made) => made.player.stop(), 0],
    ['unload', (made) => made.player.unload(), 0],
    ['dispose', (made) => made.player.dispose(), 0],
    ['seek', (made) => made.player.seek(3.5), 1],
    ['load of another song', (made) => made.player.load(OTHER, OTHER_TUNE), 0],
    ['load of the same song again', (made) => made.player.load(SONG, CHORD), 0],
    // A copy of the notes, as when the options of the song change: other notes to the player.
    // (The very notes it already has are only a new name: see 'a new name for the song'.)
    [
      'load that keeps the place',
      (made) => made.player.load(SONG, copyOf(CHORD), { keepPlace: true }),
      1,
    ],
  ]

  for (const [name, act, timerAfter] of endings) {
    it(`${name} lets go of every note at once`, () => {
      const made = playing(CHORD)
      made.clock.run(500)
      expect([...made.bus.playbackHolds].sort()).toEqual([60, 64, 67])

      act(made)
      expect(made.bus.playbackHolds.size).toBe(0)
      expect([...made.bus.getActiveNotes()]).toEqual([])
      expect(made.clock.running()).toBe(timerAfter)
      expect(made.bus.presses).toBe(made.bus.releases)

      // Nothing of the old song comes back later.
      made.heard.length = 0
      made.clock.run(3000)
      if (timerAfter === 0) expect(made.heard).toEqual([])
      expect(made.heard.some((event) => [60, 64, 67].includes(event.midi))).toBe(false)
    })
  }

  it('the end of the song lets go of every note and stops the timer', () => {
    const made = playing(CHORD)
    made.clock.run(4990)
    expect(made.bus.playbackHolds.has(72)).toBe(true)
    made.clock.run(20)
    expect(made.bus.playbackHolds.size).toBe(0)
    expect(made.clock.running()).toBe(0)
    expect(made.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(made.bus.presses).toBe(4)
    expect(made.bus.releases).toBe(4)
  })

  it('a song loaded while another plays starts from its own beginning', () => {
    const made = playing(CHORD)
    made.clock.run(500)
    made.player.load(OTHER, OTHER_TUNE)
    expect(made.player.getState()).toMatchObject(
      { status: 'stopped', songId: 'two', title: 'Second song', position: 0, duration: 1.5 },
    )

    made.heard.length = 0
    made.player.play()
    made.clock.run(1600)
    expect(log(made.heard)).toEqual(['on 50', 'on 52', 'off 50', 'off 52'])
    expect(made.clock.made()).toBe(2)
  })

  it('after dispose nothing can make it play again', () => {
    const made = playing(CHORD)
    made.clock.run(500)
    made.player.dispose()
    made.heard.length = 0

    made.player.load(SONG, CHORD)
    made.player.play()
    made.player.seek(1)
    made.player.setSpeed(1.5)
    made.clock.run(1000)
    expect(made.heard).toEqual([])
    expect(made.clock.running()).toBe(0)
    expect(made.player.getState()).toMatchObject({ status: 'empty', songId: null })
  })

  it('someone else letting go of every note does not confuse the player', () => {
    const made = playing(CHORD)
    made.clock.run(500)
    // What the app does when the piano is moved lower or higher.
    made.bus.allOff()
    expect([...made.bus.getActiveNotes()]).toEqual([])

    made.clock.run(5000)
    expect(
      made.heard.filter((event) => event.type === 'on').map((event) => event.midi),
    ).toEqual([60, 64, 67, 72])
    expect([...made.bus.getActiveNotes()]).toEqual([])
    expect(made.player.getState().status).toBe('stopped')
  })
})

/*
 * When the song in the player is renamed, the app loads the very notes the
 * player already has, keeping the place, with the new name. Nothing about the
 * music changed, so nothing may be heard of it.
 */
describe('a new name for the song', () => {
  /** Three notes that sound together for a while, then one more. */
  const CHORD = arrangementOf([note(60, 0, 3), note(64, 0.1, 3), note(67, 0.2, 3), note(72, 4, 1)])
  const RENAMED = { id: SONG.id, title: 'A better name' }

  it('leaves the notes that are sounding alone, and the song plays on to its end', () => {
    const made = playing(CHORD)
    made.clock.run(500)
    made.heard.length = 0

    made.player.load(RENAMED, CHORD, { keepPlace: true })
    expect(made.heard).toEqual([])
    expect([...made.bus.playbackHolds].sort()).toEqual([60, 64, 67])
    expect(made.clock.running()).toBe(1)
    expect(made.player.getState()).toMatchObject({
      status: 'playing',
      songId: 'one',
      title: 'A better name',
      duration: 5,
    })

    // Each note still ends when the song says so: the first one three seconds in, not before.
    made.clock.run(2450)
    expect(made.heard).toEqual([])
    made.clock.run(100)
    expect(log(made.heard)).toEqual(['off 60'])
    made.clock.run(2050)
    expect(log(made.heard)).toEqual(['off 60', 'off 64', 'off 67', 'on 72', 'off 72'])
    expect(made.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(made.bus.presses).toBe(4)
    expect(made.bus.releases).toBe(4)
    expect(made.clock.running()).toBe(0)
  })

  it('is taken by a paused song too, which stays where it was, and is told once', () => {
    const made = playing(CHORD)
    made.clock.run(500)
    made.player.pause()
    const told = vi.fn()
    made.player.subscribe(told)
    made.heard.length = 0

    made.player.load(RENAMED, CHORD, { keepPlace: true })
    expect(told).toHaveBeenCalledTimes(1)
    expect(made.player.getState()).toMatchObject({ status: 'paused', title: 'A better name' })
    expect(made.player.getState().position).toBeCloseTo(0.5, 6)
    expect(made.heard).toEqual([])
    expect(made.clock.running()).toBe(0)

    // "Play" carries on from there: the notes that were sounding are not struck again.
    made.player.play()
    made.clock.run(4600)
    expect(log(made.heard)).toEqual(['on 72', 'off 72'])
    expect(made.player.getState().status).toBe('stopped')
  })

  it('needs the place to be kept: the same notes loaded afresh stop the song, as any load does', () => {
    const made = playing(CHORD)
    made.clock.run(500)

    made.player.load(RENAMED, CHORD)
    expect(made.bus.playbackHolds.size).toBe(0)
    expect(made.player.getState()).toMatchObject({
      status: 'stopped',
      title: 'A better name',
      position: 0,
    })
    expect(made.clock.running()).toBe(0)
  })
})

describe('the player and the hands of the person playing along', () => {
  const TUNE = arrangementOf([note(60, 0.1, 1), note(64, 2, 0.5)])

  it('a key the person holds keeps sounding when the song lets go of the same note', () => {
    const made = rig()
    made.bus.noteOn(60, 'keyboard')
    made.player.load(SONG, TUNE)
    made.player.play()
    made.clock.run(200)
    // The song strikes the note the person already holds: it is heard again.
    expect(
      made.heard.map((event) => `${event.type} ${event.midi} ${event.source}`),
    ).toEqual(['on 60 keyboard', 'on 60 playback'])

    made.clock.run(1000)
    // The song's note is over, the key is still down.
    expect(made.bus.isActive(60)).toBe(true)
    expect(made.bus.playbackHolds.has(60)).toBe(false)
    expect(made.heard).toHaveLength(2)

    made.bus.noteOff(60, 'keyboard')
    expect(made.bus.isActive(60)).toBe(false)
    expect(made.heard.map((event) => event.type)).toEqual(['on', 'on', 'off'])
  })

  it('a key the person taps does not cut the note the song is holding', () => {
    const made = playing(TUNE)
    made.clock.run(300)
    made.bus.noteOn(60, 'keyboard')
    made.bus.noteOff(60, 'keyboard')
    expect(made.bus.isActive(60)).toBe(true)
    made.clock.run(900)
    expect(made.bus.isActive(60)).toBe(false)
  })

  for (const [name, act] of [
    ['stop', (player: SongPlayer) => player.stop()],
    ['pause', (player: SongPlayer) => player.pause()],
    ['unload', (player: SongPlayer) => player.unload()],
    ['seek', (player: SongPlayer) => player.seek(1.5)],
    ['dispose', (player: SongPlayer) => player.dispose()],
  ] as const) {
    it(`${name} leaves the person's own notes alone`, () => {
      const made = playing(TUNE)
      made.clock.run(300)
      made.bus.noteOn(60, 'keyboard')
      made.bus.noteOn(72, 'pointer')

      act(made.player)
      expect(made.bus.playbackHolds.size).toBe(0)
      expect([...made.bus.getActiveNotes()].sort()).toEqual([60, 72])
    })
  }
})

describe('listeners that misbehave', () => {
  const TUNE = arrangementOf([note(60, 0, 0.4), note(62, 0.5, 0.4), note(64, 1, 0.4)])

  it('a listener of the player that throws does not stop the song or the other listeners', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const made = rig()
    const told: string[] = []
    made.player.subscribe(() => {
      throw new Error('a broken listener')
    })
    made.player.subscribe(() => told.push(made.player.getState().status))

    made.player.load(SONG, TUNE)
    made.player.play()
    made.clock.run(1500)
    expect(log(made.heard)).toEqual(['on 60', 'off 60', 'on 62', 'off 62', 'on 64', 'off 64'])
    expect(told[0]).toBe('stopped')
    expect(told[1]).toBe('playing')
    expect(told[told.length - 1]).toBe('stopped')
    expect(errors).toHaveBeenCalled()
  })

  it('a listener of the bus that throws does not leave a note behind', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const made = rig()
    made.bus.subscribe(() => {
      throw new Error('a broken listener')
    })
    made.player.load(SONG, TUNE)
    made.player.play()
    made.clock.run(1500)
    expect(made.bus.presses).toBe(3)
    expect(made.bus.releases).toBe(3)
    expect(made.player.getState().status).toBe('stopped')
  })

  type CallBack = [name: string, act: (player: SongPlayer) => void, status: string, timers: number]
  const callsBack: CallBack[] = [
    ['pauses', (player) => player.pause(), 'paused', 0],
    ['stops', (player) => player.stop(), 'stopped', 0],
    ['seeks', (player) => player.seek(0.9), 'playing', 1],
    ['unloads', (player) => player.unload(), 'empty', 0],
    ['disposes', (player) => player.dispose(), 'empty', 0],
    [
      'loads another song',
      (player) => player.load(OTHER, arrangementOf([note(40, 0, 1)])),
      'stopped',
      0,
    ],
    [
      'loads and keeps the place',
      (player) => player.load(SONG, copyOf(TUNE), { keepPlace: true }),
      'playing',
      1,
    ],
    ['stops and plays again', (player) => (player.stop(), player.play()), 'playing', 1],
    ['pauses and plays again', (player) => (player.pause(), player.play()), 'playing', 1],
  ]

  for (const [name, act, status, timers] of callsBack) {
    it(`a listener of the bus that ${name} when it hears the second note has the last word`, () => {
      const made = rig()
      let done = false
      made.bus.subscribe((event) => {
        if (event.type === 'on' && event.midi === 62 && !done) {
          done = true
          act(made.player)
        }
      })
      made.player.load(SONG, TUNE)
      made.player.play()
      made.clock.run(520)

      expect(done).toBe(true)
      expect(made.player.getState().status).toBe(status)
      expect(made.clock.running()).toBe(timers)
      // The note that was being struck when the listener stepped in is not left sounding.
      expect(made.bus.playbackHolds.has(62)).toBe(false)
      expect(made.bus.isActive(62)).toBe(false)

      // And whatever happens next ends with nothing held.
      made.clock.run(3000)
      made.player.stop()
      expect(made.bus.playbackHolds.size).toBe(0)
      expect([...made.bus.getActiveNotes()]).toEqual([])
      expect(made.bus.presses).toBe(made.bus.releases)
      expect(made.clock.running()).toBe(0)
    })
  }

  it('a listener that plays the song again when it ends makes it loop, with one timer', () => {
    const made = rig()
    made.player.subscribe(() => {
      const { status, position } = made.player.getState()
      const ended = status === 'stopped' && position === 0 && made.clock.now() > made.start
      if (ended) made.player.play()
    })
    made.player.load(SONG, TUNE)
    made.player.play()
    made.clock.run(1400 * 3 + 200)
    const struck = made.heard.filter((event) => event.type === 'on').map((event) => event.midi)
    expect(struck.slice(0, 9)).toEqual([60, 62, 64, 60, 62, 64, 60, 62, 64])
    expect(made.clock.running()).toBe(1)
  })

  it('a listener that lets go of a note the moment it is struck is not undone later', () => {
    const made = rig()
    made.bus.subscribe((event) => {
      if (event.type === 'on' && event.source === 'playback') made.bus.allOff()
    })
    made.player.load(SONG, TUNE)
    made.player.play()
    made.clock.run(1500)
    expect(log(made.heard)).toEqual(['on 60', 'off 60', 'on 62', 'off 62', 'on 64', 'off 64'])
    expect(made.player.getState().status).toBe('stopped')
  })
})

describe('songs with nothing, or next to nothing, in them', () => {
  it('an empty song starts and is over at the next tick, without a sound', () => {
    const made = rig()
    made.player.load(SONG, { notes: [], duration: 0, offPianoCount: 0 })
    expect(made.player.getState()).toMatchObject({ status: 'stopped', duration: 0, position: 0 })
    made.player.play()
    made.clock.run(10)
    expect(made.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(made.clock.running()).toBe(0)
    expect(made.heard).toEqual([])
    expect(made.bus.presses).toBe(0)
  })

  it('a length that is not a usable number counts as no length', () => {
    for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const made = rig()
      made.player.load(SONG, { notes: [note(60, 0, 1)], duration, offPianoCount: 0 })
      expect(made.player.getState().duration).toBe(0)
      made.player.play()
      made.clock.run(50)
      expect(made.player.getState().status).toBe('stopped')
      expect(made.bus.playbackHolds.size).toBe(0)
    }
  })

  it('nothing happens to an empty player, whatever is asked of it', () => {
    const made = rig()
    const before = made.player.getState()
    made.player.play()
    made.player.pause()
    made.player.stop()
    made.player.seek(3)
    made.player.unload()
    made.clock.run(100)
    expect(made.player.getState()).toBe(before)
    expect(made.clock.made()).toBe(0)
    expect(made.heard).toEqual([])
  })

  it('a one-note song of the shortest length is still pressed and released', () => {
    const made = playing(arrangementOf([note(60, 0, 0.001)]))
    made.clock.run(20)
    expect(log(made.heard)).toEqual(['on 60', 'off 60'])
    expect(made.player.getState().status).toBe('stopped')
  })

  it('keeping the place in a song that became shorter ends it cleanly', () => {
    const made = playing(arrangementOf([note(60, 0, 5), note(62, 5, 5)]))
    made.clock.run(4000)
    made.player.load(SONG, arrangementOf([note(60, 0, 1)]), { keepPlace: true })
    expect(made.player.getState()).toMatchObject({ status: 'playing', position: 1, duration: 1 })
    made.clock.run(10)
    expect(made.player.getState()).toMatchObject({ status: 'stopped', position: 0 })
    expect(made.bus.playbackHolds.size).toBe(0)
    expect(made.clock.running()).toBe(0)
  })

  it('keeping the place in a song that became empty ends it cleanly', () => {
    const made = playing(arrangementOf([note(60, 0, 5)]))
    made.clock.run(1000)
    made.player.load(SONG, { notes: [], duration: 0, offPianoCount: 0 }, { keepPlace: true })
    made.clock.run(10)
    expect(made.player.getState()).toMatchObject({ status: 'stopped', position: 0, duration: 0 })
    expect(made.bus.playbackHolds.size).toBe(0)
  })
})

describe('what the listeners of the player are told', () => {
  const TUNE = arrangementOf([note(60, 0, 4), note(64, 5, 4)])

  function listening(): { made: Rig; told: () => number } {
    const made = rig()
    let count = 0
    made.player.subscribe(() => {
      count += 1
    })
    return {
      made,
      /** How many times the listener was told since this was last asked. */
      told: () => {
        const sinceLast = count
        count = 0
        return sinceLast
      },
    }
  }

  it('is every change of song, state, place and speed, once and at once', () => {
    const { made, told } = listening()
    made.player.load(SONG, TUNE)
    expect(told()).toBe(1)
    expect(made.player.getState()).toEqual({
      status: 'stopped',
      songId: 'one',
      title: 'First song',
      position: 0,
      duration: 9,
      speed: 1,
    })

    made.player.seek(2)
    expect(told()).toBe(1)
    expect(made.player.getState()).toMatchObject({ status: 'stopped', position: 2 })

    made.player.setSpeed(1.25)
    expect(told()).toBe(1)
    made.player.play()
    expect(told()).toBe(1)
    made.player.pause()
    expect(told()).toBe(1)
    made.player.stop()
    expect(told()).toBe(1)
    expect(made.player.getState()).toMatchObject({ status: 'stopped', position: 0, speed: 1.25 })

    made.player.load(OTHER, TUNE)
    expect(told()).toBe(1)
    made.player.unload()
    expect(told()).toBe(1)
    expect(made.player.getState()).toEqual({
      status: 'empty',
      songId: null,
      title: '',
      position: 0,
      duration: 0,
      speed: 1.25,
    })
  })

  it('is nothing at all when what is asked changes nothing', () => {
    const { made, told } = listening()
    made.player.load(SONG, TUNE)
    told()
    const before = made.player.getState()

    made.player.pause()
    made.player.stop()
    made.player.seek(0)
    made.player.seek(-10)
    made.player.setSpeed(1)
    made.player.load(SONG, TUNE)
    made.player.load(SONG, TUNE, { keepPlace: true })
    expect(told()).toBe(0)
    expect(made.player.getState()).toBe(before)
  })

  it('is the place in the song about ten times a second while it plays, and no more', () => {
    const { made, told } = listening()
    made.player.load(SONG, TUNE)
    made.player.play()
    told()

    made.clock.run(4000)
    const inFourSeconds = told()
    expect(inFourSeconds).toBeGreaterThanOrEqual(36)
    expect(inFourSeconds).toBeLessThanOrEqual(40)
    // What the progress bar shows is never more than a tenth of a second (and a tick) behind.
    const behind = made.player.getPosition() - made.player.getState().position
    expect(behind).toBeGreaterThanOrEqual(0)
    expect(behind).toBeLessThanOrEqual(0.105)
  })

  it('is the place in the song no more often when the timer is slow and uneven', () => {
    const { made, told } = listening()
    made.player.load(SONG, TUNE)
    made.player.play()
    told()
    const random = seededRandom(11)
    const until = made.clock.now() + 4000
    while (made.clock.now() < until) made.clock.tickAfter(4 + random() * 40)
    expect(told()).toBeLessThanOrEqual(41)
  })

  it('hands out the same frozen state until something changes', () => {
    const { made } = listening()
    made.player.load(SONG, TUNE)
    made.player.play()
    made.clock.run(50)
    const state = made.player.getState()
    expect(Object.isFrozen(state)).toBe(true)
    // Less than a tenth of a second since it was made: still the same object.
    made.clock.run(40)
    expect(made.player.getState()).toBe(state)
    made.clock.run(120)
    expect(made.player.getState()).not.toBe(state)
    expect(state.position).toBeLessThan(made.player.getState().position)
  })

  it('no longer tells a listener that has left', () => {
    const made = rig()
    let count = 0
    const leave = made.player.subscribe(() => {
      count += 1
    })
    made.player.load(SONG, TUNE)
    leave()
    leave()
    made.player.play()
    made.clock.run(500)
    expect(count).toBe(1)
  })
})

describe('random sessions, with the person playing along and listeners calling back', () => {
  it('never leaves a note of the song held when it is not playing', { timeout: 60_000 }, () => {
    let pressesInAll = 0
    for (let seed = 1; seed <= 12; seed++) {
      const random = seededRandom(seed * 977)
      const made = rig()
      const tunes = [
        randomTune(random, 60, 0.3),
        randomTune(random, 25, 0.5),
        arrangementOf([]),
        randomTune(random, 5, 0.05),
      ]
      const nothing = arrangementOf([])
      const pickTune = (): Arrangement => tunes[Math.floor(random() * tunes.length)] ?? nothing
      let current = pickTune()

      // A listener of the bus that now and then calls the player back while a note is being sent.
      made.bus.subscribe((event) => {
        if (event.source !== 'playback' || random() > 0.015) return
        const roll = random()
        if (roll < 0.2) made.player.pause()
        else if (roll < 0.4) made.player.seek(random() * current.duration)
        else if (roll < 0.5) made.player.stop()
        else if (roll < 0.6) made.player.setSpeed(0.5 + random())
        else if (roll < 0.7) made.player.load(SONG, current, { keepPlace: true })
        else if (roll < 0.8) (made.player.stop(), made.player.play())
        else if (roll < 0.9) made.bus.allOff()
        else made.player.play()
      })
      // A listener of the player that sometimes starts the song again when it stops.
      made.player.subscribe(() => {
        if (made.player.getState().status === 'stopped' && random() < 0.3) made.player.play()
      })

      const check = (step: number): void => {
        const { status, position, duration, speed } = made.player.getState()
        const where = `seed ${seed}, step ${step}, ${status}`
        if (status !== 'playing') expect(made.bus.playbackHolds.size, where).toBe(0)
        expect(made.clock.running(), where).toBe(status === 'playing' ? 1 : 0)
        expect(position, where).toBeGreaterThanOrEqual(0)
        expect(position, where).toBeLessThanOrEqual(duration)
        expect(speed, where).toBeGreaterThanOrEqual(0.5)
        expect(speed, where).toBeLessThanOrEqual(1.5)
        expect(made.bus.presses - made.bus.releases, where).toBe(made.bus.playbackHolds.size)
        expect(Object.isFrozen(made.player.getState()), where).toBe(true)
      }

      for (let step = 0; step < 1500; step++) {
        const roll = random()
        if (roll < 0.3) made.clock.run(5 + Math.floor(random() * 60) * 5)
        else if (roll < 0.34) made.clock.tickAfter(random() * 2000)
        else if (roll < 0.5) made.player.play()
        else if (roll < 0.56) made.player.pause()
        else if (roll < 0.6) made.player.stop()
        else if (roll < 0.68) made.player.seek(random() * current.duration * 1.2 - 0.1)
        else if (roll < 0.74) made.player.setSpeed(0.3 + random() * 1.5)
        else if (roll < 0.8) {
          current = pickTune()
          made.player.load(random() < 0.5 ? SONG : OTHER, current, { keepPlace: random() < 0.5 })
        } else if (roll < 0.83) made.player.unload()
        else if (roll < 0.9) {
          const midi = 48 + Math.floor(random() * 30)
          made.bus.noteOn(midi, random() < 0.5 ? 'keyboard' : 'pointer')
        }
        else if (roll < 0.97) made.bus.allOff(random() < 0.5 ? 'keyboard' : 'pointer')
        else made.bus.allOff()
        check(step)
      }

      made.player.dispose()
      made.bus.allOff('keyboard')
      made.bus.allOff('pointer')
      expect(made.bus.playbackHolds.size, `seed ${seed}, at the end`).toBe(0)
      expect([...made.bus.getActiveNotes()], `seed ${seed}, at the end`).toEqual([])
      expect(made.clock.running(), `seed ${seed}, at the end`).toBe(0)
      pressesInAll += made.bus.presses
    }
    // The sessions are worth something only if the song was really playing in them.
    expect(pressesInAll).toBeGreaterThan(1500)
  })
})
