import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageLike } from '../state/settings'
import {
  DEFAULT_PLAY_OPTIONS as SONG_DEFAULT_PLAY_OPTIONS,
  MAX_SPEED as SONG_MAX_SPEED,
  MIN_SPEED as SONG_MIN_SPEED,
} from './song'
import type { Song, SongNote, SongSummary, SongTrack } from './song'
import {
  DEFAULT_PLAY_OPTIONS,
  MAX_SPEED,
  MIN_SPEED,
  SongStorageError,
  createSongLibrary,
  songLibrary,
  useSongList,
} from './songLibrary'
import type { SongLibrary, SongPlayOptions } from './songLibrary'

/** Where the spec says things are kept. */
const INDEX_KEY = 'pianoapp.songs.v1'
const SONG_KEY_PREFIX = 'pianoapp.song.v1.'
const FULL_MESSAGE = 'There is no room left to save songs. Delete a song and try again.'

function songKey(id: string): string {
  return SONG_KEY_PREFIX + id
}

interface SavedIndex {
  songs: unknown[]
  options: unknown[]
}

/** A localStorage stand-in that can refuse writes or run out of room, as a real one can. */
class FakeStorage implements StorageLike {
  readonly items = new Map<string, string>()
  /** Says which keys cannot be written right now. */
  refuses: (key: string) => boolean = () => false
  /** How many characters fit in all, like a browser's quota. */
  capacity = Infinity
  /** Makes every read, write and removal throw, like a storage the browser has locked away. */
  locked = false
  reads = 0
  /** How many times something tried to write or remove an entry. */
  changes = 0

  getItem(key: string): string | null {
    if (this.locked) throw new DOMException('Access is denied.', 'SecurityError')
    this.reads += 1
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.changes += 1
    if (this.locked) throw new DOMException('Access is denied.', 'SecurityError')
    const sizeAfter = this.used() - (this.items.get(key)?.length ?? 0) + value.length
    if (this.refuses(key) || sizeAfter > this.capacity) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.changes += 1
    if (this.locked) throw new DOMException('Access is denied.', 'SecurityError')
    this.items.delete(key)
  }

  used(): number {
    let size = 0
    for (const value of this.items.values()) size += value.length
    return size
  }

  /** Everything that is saved, to compare a before with an after. */
  contents(): Record<string, string> {
    return Object.fromEntries(this.items)
  }

  /** The saved index, as a later visit would parse it. */
  index(): SavedIndex {
    return JSON.parse(this.items.get(INDEX_KEY) ?? 'null') as SavedIndex
  }

  /** Puts anything under the index key: an object is saved as JSON, a string as it is. */
  plantIndex(value: unknown): void {
    this.items.set(INDEX_KEY, typeof value === 'string' ? value : JSON.stringify(value))
  }

  plantSong(id: string, value: unknown): void {
    this.items.set(songKey(id), typeof value === 'string' ? value : JSON.stringify(value))
  }
}

function note(midi: number, time: number, duration = 0.5, loudness = 100): SongNote {
  return { midi, time, duration, velocity: loudness / 127 }
}

function byTimeThenMidi(a: SongNote, b: SongNote): number {
  return a.time - b.time || a.midi - b.midi
}

/**
 * A small song with two parts. Its times are whole milliseconds and its
 * velocities whole steps of 127, so it comes back from storage exactly as it went in.
 */
function sampleSong(id: string, patch: Partial<Song> = {}): Song {
  const tracks: SongTrack[] = [
    {
      id: 0,
      name: 'Right hand',
      isPercussion: false,
      program: 0,
      notes: [note(60, 0, 0.5), note(64, 0.5, 0.25, 64), note(67, 1, 1, 127)],
    },
    {
      id: 3,
      name: '',
      isPercussion: true,
      program: null,
      notes: [note(36, 0, 0.1), note(38, 0.5, 0.1, 1)],
    },
  ]
  return { id, title: `Song ${id}`, duration: 2, tracks, createdAt: 1000, ...patch }
}

function summaryOf(song: Song): SongSummary {
  const { id, title, duration, createdAt } = song
  const noteCount = song.tracks.reduce((count, part) => count + part.notes.length, 0)
  return { id, title, duration, noteCount, createdAt }
}

/** The saved form of `sampleSong`, written by hand: whole milliseconds, velocity 0..127. */
const SAMPLE_SAVED = {
  tracks: [
    {
      id: 0,
      name: 'Right hand',
      percussion: false,
      program: 0,
      notes: [
        [60, 0, 500, 100],
        [64, 500, 250, 64],
        [67, 500, 1000, 127],
      ],
    },
    {
      id: 3,
      name: '',
      percussion: true,
      program: null,
      notes: [
        [36, 0, 100, 100],
        [38, 500, 100, 1],
      ],
    },
  ],
}

/** A storage that already holds the given songs, as an earlier visit left them. */
function storageWith(...songs: Song[]): FakeStorage {
  const storage = new FakeStorage()
  const library = createSongLibrary(storage)
  for (const song of songs) library.add(song)
  return storage
}

function ids(library: SongLibrary): string[] {
  return library.list().map((song) => song.id)
}

/** Small seeded generator, so the random tests are the same on every run. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** A whole number from 0 up to, not including, `limit`. */
function whole(random: () => number, limit: number): number {
  return Math.floor(random() * limit)
}

function pick<T>(random: () => number, choices: readonly T[]): T {
  return choices[whole(random, choices.length)] as T
}

/** A long song with awkward times (not whole milliseconds), chords and two parts. */
function bigSong(id: string, noteCount: number, seed: number): Song {
  const random = createRandom(seed)
  const tracks = [0, 1].map((trackId): SongTrack => {
    const notes: SongNote[] = []
    let time = random()
    for (let index = 0; index < noteCount / 2; index += 1) {
      if (random() > 0.3) time += random() * 0.4
      notes.push(note(21 + whole(random, 88), time, 0.05 + random() * 1.5, 1 + whole(random, 127)))
    }
    return {
      id: trackId,
      name: trackId === 0 ? 'Right hand' : 'Left hand',
      isPercussion: false,
      program: trackId,
      notes: notes.sort(byTimeThenMidi),
    }
  })
  const ends = tracks.flatMap((part) => part.notes.map((each) => each.time + each.duration))
  return { id, title: `Big song ${id}`, duration: Math.max(...ends), tracks, createdAt: seed }
}

/** Throws when `summary` breaks a promise of its type. */
function expectValidSummary(summary: SongSummary): void {
  expect(Object.keys(summary).sort()).toEqual(['createdAt', 'duration', 'id', 'noteCount', 'title'])
  expect(typeof summary.id).toBe('string')
  expect(typeof summary.title).toBe('string')
  expect(summary.title.trim()).toBe(summary.title)
  expect(summary.title.length).toBeGreaterThan(0)
  expect(Array.from(summary.title).length).toBeLessThanOrEqual(80)
  expect(Number.isFinite(summary.duration) && summary.duration >= 0).toBe(true)
  expect(Number.isSafeInteger(summary.noteCount) && summary.noteCount >= 0).toBe(true)
  expect(Number.isFinite(summary.createdAt) && summary.createdAt >= 0).toBe(true)
  expect(Number.isNaN(new Date(summary.createdAt).getTime())).toBe(false)
}

/** Throws when `song` breaks a promise of its type. */
function expectValidSong(song: Song): void {
  const partIds = song.tracks.map((part) => part.id)
  expect(new Set(partIds).size).toBe(partIds.length)

  let end = 0
  for (const part of song.tracks) {
    expect(Number.isSafeInteger(part.id)).toBe(true)
    expect(typeof part.name).toBe('string')
    expect(Array.from(part.name).length).toBeLessThanOrEqual(80)
    expect(typeof part.isPercussion).toBe('boolean')
    const programIsValid =
      part.program === null ||
      (Number.isInteger(part.program) && part.program >= 0 && part.program <= 127)
    expect(programIsValid).toBe(true)

    const problems: string[] = []
    part.notes.forEach((each, index) => {
      const previous = part.notes[index - 1]
      if (!Number.isInteger(each.midi) || each.midi < 21 || each.midi > 108) problems.push('pitch')
      if (!Number.isFinite(each.time) || each.time < 0) problems.push('time')
      if (!Number.isFinite(each.duration) || each.duration < 0.001) problems.push('duration')
      if (!(each.velocity >= 0 && each.velocity <= 1)) problems.push('velocity')
      if (previous !== undefined && byTimeThenMidi(previous, each) > 0) problems.push('order')
      end = Math.max(end, each.time + each.duration)
    })
    expect(problems).toEqual([])
  }
  expect(song.duration).toBe(end)
  expect(end).toBeLessThanOrEqual(24 * 60 * 60)
}

function expectValidOptions(options: SongPlayOptions): void {
  expect(Object.keys(options).sort()).toEqual(['fitToPiano', 'melodyOnly', 'speed', 'trackIds'])
  expect(typeof options.melodyOnly).toBe('boolean')
  expect(typeof options.fitToPiano).toBe('boolean')
  expect(options.speed).toBeGreaterThanOrEqual(MIN_SPEED)
  expect(options.speed).toBeLessThanOrEqual(MAX_SPEED)
  if (options.trackIds !== 'auto') {
    expect(Array.isArray(options.trackIds)).toBe(true)
    expect(options.trackIds.every((id) => Number.isSafeInteger(id))).toBe(true)
    expect(new Set(options.trackIds).size).toBe(options.trackIds.length)
  }
}

/** Every song the library lists is valid, can be read, and matches what the list says about it. */
function expectHealthy(library: SongLibrary): void {
  const list = library.list()
  expect(new Set(list.map((summary) => summary.id)).size).toBe(list.length)
  for (const [index, summary] of list.entries()) {
    expectValidSummary(summary)
    expect(summary.createdAt).toBeLessThanOrEqual(list[index - 1]?.createdAt ?? Infinity)

    const song = library.get(summary.id)
    if (song === null) throw new Error(`"${summary.id}" is listed but cannot be read`)
    expectValidSong(song)
    expect(summaryOf(song)).toEqual(summary)
    expectValidOptions(library.getOptions(summary.id))
  }
}

describe('what songLibrary re-exports', () => {
  it('is the options and speed limits of song.ts, not copies', () => {
    expect(DEFAULT_PLAY_OPTIONS).toBe(SONG_DEFAULT_PLAY_OPTIONS)
    expect(MIN_SPEED).toBe(SONG_MIN_SPEED)
    expect(MAX_SPEED).toBe(SONG_MAX_SPEED)
    expect(DEFAULT_PLAY_OPTIONS).toEqual({
      trackIds: 'auto',
      melodyOnly: false,
      fitToPiano: false,
      speed: 1,
    })
    expect([MIN_SPEED, MAX_SPEED]).toEqual([0.5, 1.5])
  })
})

describe('SongStorageError', () => {
  it('carries its code and a plain sentence for the player', () => {
    const error = new SongStorageError('full')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(SongStorageError)
    expect(error.name).toBe('SongStorageError')
    expect(error.code).toBe('full')
    expect(error.userMessage).toBe(FULL_MESSAGE)
    expect(error.message).toBe(FULL_MESSAGE)
  })
})

describe('createSongLibrary', () => {
  describe('with no storage', () => {
    it('starts empty', () => {
      for (const library of [createSongLibrary(), createSongLibrary(null)]) {
        expect(library.list()).toEqual([])
        expect(library.get('a')).toBeNull()
        expect(library.getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)
      }
    })

    it('keeps songs until it is thrown away', () => {
      const library = createSongLibrary()
      library.add(sampleSong('a'))
      library.setOptions('a', { speed: 0.75 })

      expect(library.list()).toEqual([summaryOf(sampleSong('a'))])
      expect(library.get('a')).toEqual(sampleSong('a'))
      expect(library.getOptions('a').speed).toBe(0.75)
      expect(createSongLibrary().list()).toEqual([])
    })
  })

  describe('add and get', () => {
    it('lists what was added and gives the whole song back', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))

      expect(library.list()).toEqual([summaryOf(sampleSong('a'))])
      expect(library.get('a')).toEqual(sampleSong('a'))
    })

    it('gives null for a song it does not have', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))

      expect(library.get('b')).toBeNull()
      expect(library.get('')).toBeNull()
      expect(library.get('__proto__')).toBeNull()
      expect(library.get('constructor')).toBeNull()
    })

    it('lists the newest first, and of songs made at the same moment the one added last', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a', { createdAt: 1000 }))
      library.add(sampleSong('b', { createdAt: 3000 }))
      library.add(sampleSong('c', { createdAt: 2000 }))
      expect(ids(library)).toEqual(['b', 'c', 'a'])

      library.add(sampleSong('d', { createdAt: 3000 }))
      expect(ids(library)).toEqual(['d', 'b', 'c', 'a'])
    })

    it('adds a song twice when it is given twice under two ids', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))
      library.add(sampleSong('b'))

      expect(ids(library)).toEqual(['b', 'a'])
      expect(library.get('a')?.tracks).toEqual(library.get('b')?.tracks)
    })

    it('replaces a song that is added again under the same id', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))
      library.add(sampleSong('b', { createdAt: 500 }))
      const firstPart = sampleSong('a').tracks[0] as SongTrack
      const second = sampleSong('a', { title: 'Second', tracks: [firstPart] })
      library.add(second)

      expect(ids(library)).toEqual(['a', 'b'])
      expect(library.get('a')).toEqual(second)
      expect(library.list()[0]).toEqual(summaryOf(second))
    })

    it('cleans the title it is given', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a', { title: '  Clair \n de   lune\u0007 ' }))
      library.add(sampleSong('b', { title: '   ', createdAt: 0 }))

      expect(library.list().map((song) => song.title)).toEqual(['Clair de lune', 'Untitled song'])
      expect(library.get('a')?.title).toBe('Clair de lune')
    })

    it('keeps a song with no notes at all', () => {
      const library = createSongLibrary(new FakeStorage())
      const empty = sampleSong('a', { tracks: [], duration: 0 })
      library.add(empty)

      expect(library.list()).toEqual([{ ...summaryOf(empty), noteCount: 0, duration: 0 }])
      expect(library.get('a')).toEqual(empty)
    })

    it('copes with ids that look like trouble', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      const troubling = ['__proto__', 'constructor', 'toString', '', 'a b/c?d#e', '🎹']
      const songs = troubling.map((id, index) =>
        sampleSong(id, { title: 'Trouble', createdAt: index }),
      )
      for (const song of songs) library.add(song)

      expect(ids(library)).toEqual([...troubling].reverse())
      for (const song of songs) expect(library.get(song.id)).toEqual(song)
      expect(ids(createSongLibrary(storage))).toEqual([...troubling].reverse())

      for (const id of troubling) library.remove(id)
      expect(library.list()).toEqual([])
      expect(Object.keys(storage.contents())).toEqual([INDEX_KEY])
    })

    it('does not keep the song object it was given: later changes to it change nothing', () => {
      const library = createSongLibrary(new FakeStorage())
      const song = sampleSong('a')
      library.add(song)

      song.title = 'Changed'
      ;(song.tracks[0]?.notes[0] as SongNote).midi = 100

      expect(library.get('a')).toEqual(sampleSong('a'))
      expect(library.list()).toEqual([summaryOf(sampleSong('a'))])
    })
  })

  describe('what it hands out', () => {
    it('is frozen, all the way down', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))
      library.setOptions('a', { trackIds: [0], speed: 1.25 })
      const song = library.get('a') as Song
      const options = library.getOptions('a')

      expect(Object.isFrozen(library.list())).toBe(true)
      expect(Object.isFrozen(library.list()[0])).toBe(true)
      expect(Object.isFrozen(song)).toBe(true)
      expect(Object.isFrozen(song.tracks)).toBe(true)
      expect(Object.isFrozen(song.tracks[0])).toBe(true)
      expect(Object.isFrozen(song.tracks[0]?.notes)).toBe(true)
      expect(Object.isFrozen(song.tracks[0]?.notes[0])).toBe(true)
      expect(Object.isFrozen(options)).toBe(true)
      expect(Object.isFrozen(options.trackIds)).toBe(true)
      expect(Object.isFrozen(library.getOptions('unknown'))).toBe(true)

      library.rename('a', 'New')
      expect(Object.isFrozen(library.list())).toBe(true)
      expect(Object.isFrozen(library.list()[0])).toBe(true)
      expect(Object.isFrozen(library.get('a'))).toBe(true)
    })

    it('is the same list until something changes, then a new one', () => {
      const library = createSongLibrary(new FakeStorage())
      const empty = library.list()
      expect(library.list()).toBe(empty)

      library.add(sampleSong('a'))
      const one = library.list()
      expect(one).not.toBe(empty)
      expect(empty).toEqual([])

      library.setOptions('a', { speed: 0.6 })
      library.rename('a', 'Song a')
      library.rename('nobody', 'New')
      library.remove('nobody')
      expect(library.list()).toBe(one)

      library.rename('a', 'New')
      expect(library.list()).not.toBe(one)
      expect(one[0]?.title).toBe('Song a')
    })

    it('is the same song object while that song does not change, without reading it again', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a'))
      library.add(sampleSong('b'))
      const first = library.get('a')
      storage.reads = 0

      library.setOptions('a', { speed: 0.6 })
      library.rename('b', 'Other')
      expect(library.get('a')).toBe(first)
      expect(storage.reads).toBe(0)

      library.rename('a', 'New')
      expect(library.get('a')).not.toBe(first)
      expect(library.get('a')?.title).toBe('New')
      expect(first?.title).toBe('Song a')
    })
  })

  describe('rename', () => {
    it('changes the title in the list and in the song', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))
      library.add(sampleSong('b'))
      library.rename('a', 'Moonlight')

      expect(library.list().map((song) => song.title)).toEqual(['Song b', 'Moonlight'])
      expect(library.get('a')).toEqual(sampleSong('a', { title: 'Moonlight' }))
      expect(library.get('b')).toEqual(sampleSong('b'))
    })

    it('cleans the title: one line, no control characters, at most 80 characters, never empty', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))

      library.rename('a', '  Für \t Elise\n(opening)\u0000 ')
      expect(library.list()[0]?.title).toBe('Für Elise (opening)')

      library.rename('a', 'x'.repeat(500))
      expect(library.list()[0]?.title).toBe('x'.repeat(80))

      library.rename('a', ' \n ')
      expect(library.list()[0]?.title).toBe('Untitled song')
    })

    it('does nothing for a song it does not have, or a built-in one', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a'))
      const before = storage.contents()
      const listener = vi.fn()
      library.subscribe(listener)

      library.rename('b', 'New')
      library.rename('starter:twinkle', 'New')

      expect(listener).not.toHaveBeenCalled()
      expect(storage.contents()).toEqual(before)
    })
  })

  describe('remove', () => {
    it('takes the song, its notes and its options away, and leaves the others', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a'))
      library.add(sampleSong('b'))
      library.setOptions('a', { speed: 0.75 })
      library.setOptions('b', { speed: 1.25 })

      library.remove('a')

      expect(ids(library)).toEqual(['b'])
      expect(library.get('a')).toBeNull()
      expect(library.getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)
      expect(library.get('b')).toEqual(sampleSong('b'))
      expect(library.getOptions('b').speed).toBe(1.25)
      expect(Object.keys(storage.contents()).sort()).toEqual([songKey('b'), INDEX_KEY].sort())
      expect(storage.index().options).toEqual([{ id: 'b', ...DEFAULT_PLAY_OPTIONS, speed: 1.25 }])
    })

    it('does nothing for a song it does not have, or a built-in one', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a'))
      library.setOptions('starter:twinkle', { speed: 0.75 })
      const before = storage.contents()
      const listener = vi.fn()
      library.subscribe(listener)

      library.remove('b')
      library.remove('starter:twinkle')

      expect(listener).not.toHaveBeenCalled()
      expect(storage.contents()).toEqual(before)
      expect(library.getOptions('starter:twinkle').speed).toBe(0.75)
    })
  })

  describe('options', () => {
    it('are the defaults until some are saved', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))

      expect(library.getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)
      expect(library.getOptions('nobody')).toBe(DEFAULT_PLAY_OPTIONS)
      expect(library.getOptions('starter:twinkle')).toBe(DEFAULT_PLAY_OPTIONS)
    })

    it('change only in what the patch names', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))

      library.setOptions('a', { melodyOnly: true })
      expect(library.getOptions('a')).toEqual({ ...DEFAULT_PLAY_OPTIONS, melodyOnly: true })

      library.setOptions('a', { speed: 1.25, trackIds: [0] })
      expect(library.getOptions('a')).toEqual({
        trackIds: [0],
        melodyOnly: true,
        fitToPiano: false,
        speed: 1.25,
      })

      library.setOptions('a', { fitToPiano: true, melodyOnly: false, trackIds: 'auto' })
      expect(library.getOptions('a')).toEqual({
        trackIds: 'auto',
        melodyOnly: false,
        fitToPiano: true,
        speed: 1.25,
      })
    })

    it('are kept apart for each song', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))
      library.add(sampleSong('b'))
      library.setOptions('a', { speed: 0.5 })

      expect(library.getOptions('a').speed).toBe(0.5)
      expect(library.getOptions('b')).toBe(DEFAULT_PLAY_OPTIONS)
    })

    it('keep the speed between the slowest and the fastest', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))

      library.setOptions('a', { speed: 0.1 })
      expect(library.getOptions('a').speed).toBe(MIN_SPEED)
      library.setOptions('a', { speed: 99 })
      expect(library.getOptions('a').speed).toBe(MAX_SPEED)
      library.setOptions('a', { speed: -Infinity })
      expect(library.getOptions('a').speed).toBe(MAX_SPEED)
      library.setOptions('a', { speed: 0.85 })
      expect(library.getOptions('a').speed).toBe(0.85)
    })

    it('keep part ids as they are given, also ids of parts the song does not have', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))

      library.setOptions('a', { trackIds: [7, 0, -2, 3] })
      expect(library.getOptions('a').trackIds).toEqual([7, 0, -2, 3])

      library.setOptions('a', { trackIds: [] })
      expect(library.getOptions('a').trackIds).toEqual([])
    })

    it('ignore what is not usable in a patch and keep the value they had', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(sampleSong('a'))
      library.setOptions('a', { trackIds: [0], melodyOnly: true, fitToPiano: true, speed: 0.75 })
      const before = library.getOptions('a')
      const listener = vi.fn()
      library.subscribe(listener)

      const unusable = [
        { speed: Number.NaN },
        { speed: '1.2' },
        { speed: undefined },
        { melodyOnly: 'yes', fitToPiano: 1 },
        { trackIds: 'all' },
        { trackIds: { 0: 0, length: 1 } },
        { nonsense: true },
        JSON.parse('{"__proto__": {"speed": 1.5}}'),
        null,
        undefined,
        'speed',
        7,
      ]
      for (const patch of unusable) {
        expect(() => library.setOptions('a', patch as Partial<SongPlayOptions>)).not.toThrow()
      }

      expect(library.getOptions('a')).toBe(before)
      expect(listener).not.toHaveBeenCalled()

      const mixed = { trackIds: [3, 'x', 1.5, null, 3, 1e300, 0] }
      library.setOptions('a', mixed as unknown as SongPlayOptions)
      expect(library.getOptions('a').trackIds).toEqual([3, 0])
      expectValidOptions(library.getOptions('a'))
    })

    it('are the same object until they change, and tell no one when a patch changes nothing', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a'))
      library.setOptions('a', { speed: 0.75, trackIds: [0, 3] })
      const before = library.getOptions('a')
      const saved = storage.contents()
      const listener = vi.fn()
      library.subscribe(listener)

      library.setOptions('a', { speed: 0.75 })
      library.setOptions('a', { trackIds: [0, 3] })
      library.setOptions('a', {})
      expect(library.getOptions('a')).toBe(before)
      expect(listener).not.toHaveBeenCalled()
      expect(storage.contents()).toEqual(saved)

      library.setOptions('a', { speed: 0.8 })
      expect(library.getOptions('a')).not.toBe(before)
      expect(before.speed).toBe(0.75)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('are not kept for a song the library does not have', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      const listener = vi.fn()
      library.subscribe(listener)

      library.setOptions('nobody', { speed: 0.75 })
      library.setOptions('', { speed: 0.75 })
      library.setOptions('__proto__', { speed: 0.75 })
      library.setOptions(7 as unknown as string, { speed: 0.75 })

      expect(library.getOptions('nobody')).toBe(DEFAULT_PLAY_OPTIONS)
      expect(listener).not.toHaveBeenCalled()
      expect(storage.contents()).toEqual({})
    })

    it("are kept for the built-in songs, whose ids start with 'starter:'", () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      const listener = vi.fn()
      library.subscribe(listener)

      library.setOptions('starter:twinkle', { speed: 0.75, melodyOnly: true })

      expect(library.getOptions('starter:twinkle')).toEqual({
        ...DEFAULT_PLAY_OPTIONS,
        speed: 0.75,
        melodyOnly: true,
      })
      expect(library.getOptions('starter:ode-to-joy')).toBe(DEFAULT_PLAY_OPTIONS)
      expect(library.list()).toEqual([])
      expect(library.get('starter:twinkle')).toBeNull()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(createSongLibrary(storage).getOptions('starter:twinkle').speed).toBe(0.75)
    })

    it('take no room once they are back at the defaults', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a'))
      library.setOptions('a', { speed: 0.75 })
      expect(storage.index().options).toEqual([{ id: 'a', ...DEFAULT_PLAY_OPTIONS, speed: 0.75 }])

      library.setOptions('a', { speed: 1 })
      expect(library.getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)
      expect(storage.index().options).toEqual([])
    })
  })

  describe('subscribe', () => {
    it('tells every listener once about each change, and no longer after it left', () => {
      const library = createSongLibrary(new FakeStorage())
      const first = vi.fn()
      const second = vi.fn()
      const leave = library.subscribe(first)
      library.subscribe(second)

      library.add(sampleSong('a'))
      library.rename('a', 'New')
      library.setOptions('a', { speed: 0.75 })
      expect(first).toHaveBeenCalledTimes(3)

      leave()
      leave()
      library.remove('a')
      expect(first).toHaveBeenCalledTimes(3)
      expect(second).toHaveBeenCalledTimes(4)
    })

    it('has already made the change when it tells', () => {
      const library = createSongLibrary(new FakeStorage())
      const seen: string[][] = []
      library.subscribe(() => seen.push(ids(library)))

      library.add(sampleSong('a'))
      library.remove('a')

      expect(seen).toEqual([['a'], []])
    })

    it('still tells the others when one listener fails', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const library = createSongLibrary(new FakeStorage())
      const after = vi.fn()
      library.subscribe(() => {
        throw new Error('broken listener')
      })
      library.subscribe(after)

      expect(() => library.add(sampleSong('a'))).not.toThrow()

      expect(after).toHaveBeenCalledTimes(1)
      expect(ids(library)).toEqual(['a'])
      expect(logged).toHaveBeenCalledTimes(1)
      logged.mockRestore()
    })

    it('can be used unbound, as React uses it', () => {
      const { list, get, getOptions, add, subscribe } = createSongLibrary(new FakeStorage())
      const listener = vi.fn()
      subscribe(listener)
      add(sampleSong('a'))

      expect(list().map((song) => song.id)).toEqual(['a'])
      expect(get('a')).toEqual(sampleSong('a'))
      expect(getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('what it saves', () => {
    it('is one index entry and one entry of notes for each song', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a'))
      library.add(sampleSong('b', { createdAt: 2000 }))
      library.setOptions('a', { speed: 0.75, trackIds: [0] })

      expect(Object.keys(storage.contents()).sort()).toEqual(
        [INDEX_KEY, songKey('a'), songKey('b')].sort(),
      )
      expect(storage.index()).toEqual({
        songs: [summaryOf(sampleSong('b', { createdAt: 2000 })), summaryOf(sampleSong('a'))],
        options: [{ id: 'a', trackIds: [0], melodyOnly: false, fitToPiano: false, speed: 0.75 }],
      })
    })

    it('writes the notes as short lists of whole numbers: milliseconds, and velocity from 0 to 127', () => {
      const storage = new FakeStorage()
      createSongLibrary(storage).add(sampleSong('a'))

      expect(JSON.parse(storage.getItem(songKey('a')) ?? '')).toEqual(SAMPLE_SAVED)
    })

    it('reads that form back', () => {
      const storage = new FakeStorage()
      storage.plantIndex({ songs: [summaryOf(sampleSong('a'))], options: [] })
      storage.plantSong('a', SAMPLE_SAVED)

      const library = createSongLibrary(storage)

      expect(library.list()).toEqual([summaryOf(sampleSong('a'))])
      expect(library.get('a')).toEqual(sampleSong('a'))
    })

    it('does not write the notes again when a song is renamed or its options change', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a'))
      storage.refuses = (key) => key !== INDEX_KEY

      library.rename('a', 'New')
      library.setOptions('a', { speed: 0.75 })

      const later = createSongLibrary(storage)
      expect(later.list()[0]?.title).toBe('New')
      expect(later.getOptions('a').speed).toBe(0.75)
    })

    it('is there again at the next visit: songs, titles, order and options', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(sampleSong('a', { createdAt: 1000 }))
      library.add(sampleSong('b', { createdAt: 3000 }))
      library.add(sampleSong('c', { createdAt: 3000 }))
      library.add(sampleSong('gone', { createdAt: 2000 }))
      library.rename('a', 'Renamed')
      library.remove('gone')
      library.setOptions('b', { trackIds: [3, 0], melodyOnly: true, fitToPiano: true, speed: 1.5 })
      library.setOptions('starter:twinkle', { speed: 0.5 })

      const later = createSongLibrary(storage)

      expect(later.list()).toEqual(library.list())
      expect(ids(later)).toEqual(['c', 'b', 'a'])
      for (const id of ids(later)) expect(later.get(id)).toEqual(library.get(id))
      expect(later.get('a')?.title).toBe('Renamed')
      expect(later.get('gone')).toBeNull()
      expect(later.getOptions('b')).toEqual(library.getOptions('b'))
      expect(later.getOptions('starter:twinkle')).toEqual({ ...DEFAULT_PLAY_OPTIONS, speed: 0.5 })
      expect(later.getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)
      expectHealthy(later)
    })

    it('writes nothing when it only reads a storage that is in order', () => {
      const storage = storageWith(sampleSong('a'), sampleSong('b'))
      storage.changes = 0

      const library = createSongLibrary(storage)
      library.get('a')
      library.getOptions('a')
      library.subscribe(() => undefined)()

      expect(ids(library)).toEqual(['b', 'a'])
      expect(storage.changes).toBe(0)
    })
  })

  describe('a long song', () => {
    const NOTE_COUNT = 20_000
    const original = bigSong('big', NOTE_COUNT, 5)

    /** Both lists in the order they have once their times are whole milliseconds. */
    function inSavedOrder(notes: readonly SongNote[]): SongNote[] {
      const ms = (each: SongNote): number => Math.round(each.time * 1000)
      return [...notes].sort((a, b) => ms(a) - ms(b) || a.midi - b.midi)
    }

    it('comes back whole, with every time within a millisecond', () => {
      const storage = new FakeStorage()
      createSongLibrary(storage).add(original)
      const read = createSongLibrary(storage).get('big')
      if (read === null) throw new Error('the song could not be read back')

      expectValidSong(read)
      expect(read.tracks.map(({ notes: _notes, ...rest }) => rest)).toEqual(
        original.tracks.map(({ notes: _notes, ...rest }) => rest),
      )
      const halfAMillisecond = 0.0005 + 1e-9
      let worstStart = 0
      let worstEnd = 0
      original.tracks.forEach((part, index) => {
        const readNotes = read.tracks[index]?.notes ?? []
        const wanted = inSavedOrder(part.notes)
        expect(readNotes.length).toBe(wanted.length)
        wanted.forEach((each, at) => {
          const got = readNotes[at] as SongNote
          if (got.midi !== each.midi || got.velocity !== each.velocity) {
            throw new Error(`note ${at} of part ${index} is another note`)
          }
          worstStart = Math.max(worstStart, Math.abs(got.time - each.time))
          const endDifference = got.time + got.duration - (each.time + each.duration)
          worstEnd = Math.max(worstEnd, Math.abs(endDifference))
        })
      })
      expect(worstStart).toBeLessThanOrEqual(halfAMillisecond)
      expect(worstEnd).toBeLessThanOrEqual(halfAMillisecond)
      expect(Math.abs(read.duration - original.duration)).toBeLessThanOrEqual(halfAMillisecond)
    })

    it('is listed with the length and the number of notes it has once saved', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(original)

      const [summary] = library.list()
      expect(summary?.noteCount).toBe(NOTE_COUNT)
      expect(summary?.duration).toBe(library.get('big')?.duration)
      expect(createSongLibrary(storage).list()).toEqual(library.list())
    })

    it('reads the same from this visit and from a later one', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(original)

      expect(createSongLibrary(storage).get('big')).toEqual(library.get('big'))
    })

    it('does not change any more when it is saved a second time', () => {
      const library = createSongLibrary(new FakeStorage())
      library.add(original)
      const once = library.get('big') as Song
      library.add({ ...once, id: 'again' })

      expect(library.get('again')?.tracks).toEqual(once.tracks)
    })

    it('takes a small part of the room its plain JSON would take', () => {
      const storage = new FakeStorage()
      createSongLibrary(storage).add(original)
      const saved = storage.getItem(songKey('big'))?.length ?? Infinity

      expect(saved).toBeLessThan(18 * NOTE_COUNT)
      expect(saved).toBeLessThan(JSON.stringify(original).length / 4)
    })

    it('is tens of kilobytes for a song of a few thousand notes', () => {
      const storage = new FakeStorage()
      createSongLibrary(storage).add(bigSong('long', 5000, 9))

      expect(storage.used()).toBeLessThan(90_000)
    })
  })

  describe('a song that breaks the rules of its own type', () => {
    const STRANGE_NUMBERS = [
      Number.NaN,
      Infinity,
      -Infinity,
      -1,
      -0.0004,
      0,
      0.0004,
      1e-9,
      0.5,
      1.5,
      60.4,
      127,
      500,
      1e9,
      1e300,
    ]

    function strangeSong(id: string, random: () => number): Song {
      const strange = (): number => pick(random, STRANGE_NUMBERS)
      const sometimes = (usual: number): number => (random() < 0.3 ? strange() : usual)
      const tracks = Array.from({ length: 1 + whole(random, 4) }, (_, index): SongTrack => {
        let time = 0
        const notes = Array.from({ length: whole(random, 12) }, (): SongNote => {
          time += random()
          return {
            midi: sometimes(21 + whole(random, 88)),
            time: sometimes(time),
            duration: sometimes(random()),
            velocity: sometimes(random()),
          }
        })
        return {
          id: sometimes(random() < 0.2 ? 0 : index),
          name: random() < 0.2 ? 'n'.repeat(500) : `Part ${index}`,
          isPercussion: random() < 0.2,
          program: random() < 0.3 ? null : sometimes(whole(random, 128)),
          notes,
        }
      })
      return { id, title: `Strange ${id}`, duration: strange(), tracks, createdAt: sometimes(1000) }
    }

    it('is still saved as a song that can be read back, now and at a later visit', () => {
      const random = createRandom(31)

      for (let round = 0; round < 300; round += 1) {
        const storage = new FakeStorage()
        const library = createSongLibrary(storage)
        const song = strangeSong(`s${round}`, random)

        expect(() => library.add(song)).not.toThrow()

        expectHealthy(library)
        const saved = library.get(song.id) as Song
        expect(saved.tracks.length).toBe(song.tracks.length)
        expect(saved.tracks.map((part) => part.notes.length)).toEqual(
          song.tracks.map((part) => part.notes.length),
        )
        const later = createSongLibrary(storage)
        expect(later.list()).toEqual(library.list())
        expect(later.get(song.id)).toEqual(saved)
      }
    })

    it('keeps a note that is later than a day into the song, at the end of that day', () => {
      const library = createSongLibrary(new FakeStorage())
      const day = 24 * 60 * 60
      const firstPart = sampleSong('a').tracks[0] as SongTrack
      const late: SongTrack = { ...firstPart, notes: [note(60, 2 * day, 5)] }
      library.add(sampleSong('a', { tracks: [late] }))

      const [only] = library.get('a')?.tracks[0]?.notes ?? []
      expect(only?.time).toBeCloseTo(day - 0.001, 6)
      expect(library.get('a')?.duration).toBeCloseTo(day, 6)
    })
  })

  describe('with a storage it cannot trust', () => {
    /** Song 'good' is saved properly; the tests then put something broken next to it. */
    function storageWithGoodSong(): FakeStorage {
      return storageWith(sampleSong('good', { createdAt: 5000 }))
    }

    function goodEntry(): SongSummary {
      return summaryOf(sampleSong('good', { createdAt: 5000 }))
    }

    function expectOnlyTheGoodSong(library: SongLibrary, storage: FakeStorage): void {
      expect(library.list()).toEqual([goodEntry()])
      expect(library.get('good')).toEqual(sampleSong('good', { createdAt: 5000 }))
      // The clean-up is saved, and the next visit sees the same.
      expect(storage.index().songs).toEqual([goodEntry()])
      expect(createSongLibrary(storage).list()).toEqual([goodEntry()])
    }

    describe('an index that is not an index', () => {
      const NOT_AN_INDEX: readonly unknown[] = [
        '{"songs": [',
        'not json at all',
        '',
        'null',
        '5',
        '"songs"',
        'true',
        [],
        [summaryOf(sampleSong('a'))],
        {},
        { songs: null },
        { songs: 5, options: 'none' },
        { songs: 'a' },
        { songs: { 0: summaryOf(sampleSong('a')), length: 1 } },
        { options: [{ id: 'a', speed: 0.75 }] },
        JSON.parse(`{"__proto__": {"songs": [${JSON.stringify(summaryOf(sampleSong('a')))}]}}`),
      ]

      it.each(NOT_AN_INDEX.map((index) => [JSON.stringify(index).slice(0, 60), index]))(
        'gives an empty library that works: %s',
        (_label, index) => {
          const storage = new FakeStorage()
          storage.plantSong('a', SAMPLE_SAVED)
          storage.plantIndex(index)

          const library = createSongLibrary(storage)

          expect(library.list()).toEqual([])
          expect(library.get('a')).toBeNull()
          expect(library.getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)

          library.add(sampleSong('new'))
          library.setOptions('new', { speed: 0.75 })
          expect(library.get('new')).toEqual(sampleSong('new'))
          expectHealthy(createSongLibrary(storage))
          expect(ids(createSongLibrary(storage))).toEqual(['new'])
        },
      )
    })

    describe('an entry of the index that is broken', () => {
      const good = summaryOf(sampleSong('bad'))
      const BROKEN_ENTRIES: readonly unknown[] = [
        null,
        7,
        'bad',
        [],
        ['bad', 'Song bad', 2, 5, 1000],
        {},
        { ...good, id: undefined },
        { ...good, id: 7 },
        { ...good, id: null },
        { ...good, id: ['bad'] },
        { ...good, title: undefined },
        { ...good, title: 7 },
        { ...good, title: null },
        { ...good, title: ['Song'] },
        { ...good, createdAt: undefined },
        { ...good, createdAt: null },
        { ...good, createdAt: '2026-01-01' },
        { ...good, createdAt: true },
        JSON.parse(`{"__proto__": ${JSON.stringify(good)}}`),
      ]

      it.each(BROKEN_ENTRIES.map((entry) => [JSON.stringify(entry), entry]))(
        'is left out, and taken out of storage: %s',
        (_label, entry) => {
          for (const entries of [
            [entry, goodEntry()],
            [goodEntry(), entry],
          ]) {
            const storage = storageWithGoodSong()
            storage.plantSong('bad', SAMPLE_SAVED)
            storage.plantIndex({ songs: entries, options: [] })

            const library = createSongLibrary(storage)

            expectOnlyTheGoodSong(library, storage)
            expect(library.get('bad')).toBeNull()
          }
        },
      )

      it('takes its notes out of storage too when it says whose they are', () => {
        const storage = storageWithGoodSong()
        storage.plantSong('bad', SAMPLE_SAVED)
        storage.plantIndex({ songs: [{ ...good, title: 7 }, goodEntry()], options: [] })

        createSongLibrary(storage)

        expect(Object.keys(storage.contents()).sort()).toEqual([songKey('good'), INDEX_KEY].sort())
      })
    })

    describe('a song whose notes are missing or unreadable', () => {
      const [firstTrack, secondTrack] = SAMPLE_SAVED.tracks
      /** The saved sample with its first note replaced. */
      function withNote(replacement: unknown): unknown {
        const notes = [replacement, [64, 500, 250, 64]]
        return { tracks: [{ ...firstTrack, notes }, secondTrack] }
      }
      function withTrack(patch: Record<string, unknown>): unknown {
        return { tracks: [{ ...firstTrack, ...patch }, secondTrack] }
      }
      const day = 24 * 60 * 60 * 1000

      const inherited: unknown = JSON.parse(`{"__proto__": ${JSON.stringify(SAMPLE_SAVED)}}`)

      const UNREADABLE: readonly (readonly [string, unknown])[] = [
        ['not JSON', '{"tracks": [{"id": 0, "name": "", "notes": [[60, 0'],
        ['empty text', ''],
        ['null', 'null'],
        ['a number', '42'],
        ['a text', '"tracks"'],
        ['a list', SAMPLE_SAVED.tracks],
        ['no parts', {}],
        ['parts that are not a list', { tracks: { 0: firstTrack, length: 1 } }],
        ['parts under an inherited name', inherited],
        ['a part that is nothing', { tracks: [null] }],
        ['a part that is a list', { tracks: [[0, '', false, 0, []]] }],
        ['a part without an id', withTrack({ id: undefined })],
        ['a part whose id is a text', withTrack({ id: '0' })],
        ['a part whose id is not whole', withTrack({ id: 0.5 })],
        ['a part whose id is beyond counting', withTrack({ id: 1e300 })],
        ['two parts with one id', withTrack({ id: 3 })],
        ['a part without a name', withTrack({ name: undefined })],
        ['a part whose name is a number', withTrack({ name: 5 })],
        ['a part that does not say whether it is percussion', withTrack({ percussion: undefined })],
        ['percussion that is not yes or no', withTrack({ percussion: 'no' })],
        ['a part without an instrument entry', withTrack({ program: undefined })],
        ['an instrument below the range', withTrack({ program: -1 })],
        ['an instrument above the range', withTrack({ program: 128 })],
        ['an instrument that is not whole', withTrack({ program: 1.5 })],
        ['an instrument that is a text', withTrack({ program: '0' })],
        ['a part without notes', withTrack({ notes: undefined })],
        ['notes that are not a list', withTrack({ notes: 'none' })],
        ['notes in one flat list', withTrack({ notes: [60, 0, 500, 100] })],
        ['a note that is nothing', withNote(null)],
        ['a note that is an object', withNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.8 })],
        ['a note with three numbers', withNote([60, 0, 500])],
        ['a note with five numbers', withNote([60, 0, 500, 100, 1])],
        ['a pitch below the piano', withNote([20, 0, 500, 100])],
        ['a pitch above the piano', withNote([109, 0, 500, 100])],
        ['a pitch between two keys', withNote([60.5, 0, 500, 100])],
        ['a pitch that is a text', withNote(['60', 0, 500, 100])],
        ['a pitch that was not a number (NaN is saved as null)', withNote([null, 0, 500, 100])],
        ['a start before the note before it', withNote([60, -1, 500, 100])],
        ['a start that is not whole', withNote([60, 0.5, 500, 100])],
        ['a start that was not a number', withNote([60, null, 500, 100])],
        ['a start beyond counting', withNote([60, 1e300, 500, 100])],
        ['a start later than a day', withNote([60, day + 1, 500, 100])],
        ['a length of nothing', withNote([60, 0, 0, 100])],
        ['a length below nothing', withNote([60, 0, -5, 100])],
        ['a length that is not whole', withNote([60, 0, 2.5, 100])],
        ['a length that is true', withNote([60, 0, true, 100])],
        ['a length beyond counting', withNote([60, 0, 1e300, 100])],
        ['an end later than a day', withNote([60, day - 10, 11, 100])],
        ['a velocity below 0', withNote([60, 0, 500, -1])],
        ['a velocity above 127', withNote([60, 0, 500, 128])],
        ['a velocity that is not whole', withNote([60, 0, 500, 0.8])],
        ['a velocity that is a list', withNote([60, 0, 500, [100]])],
      ]

      it.each(UNREADABLE)('is left out and taken out of storage (%s)', (_label, saved) => {
        const storage = storageWithGoodSong()
        storage.plantSong('bad', saved)
        storage.plantIndex({
          songs: [summaryOf(sampleSong('bad', { createdAt: 9000 })), goodEntry()],
          options: [{ id: 'bad', ...DEFAULT_PLAY_OPTIONS, speed: 0.75 }],
        })

        const library = createSongLibrary(storage)

        expectOnlyTheGoodSong(library, storage)
        expect(library.get('bad')).toBeNull()
        expect(library.getOptions('bad')).toBe(DEFAULT_PLAY_OPTIONS)
        expect(storage.index().options).toEqual([])
        expect(Object.keys(storage.contents()).sort()).toEqual([songKey('good'), INDEX_KEY].sort())
      })

      it('is left out when there are no notes in storage at all', () => {
        const storage = storageWithGoodSong()
        storage.plantIndex({ songs: [goodEntry(), summaryOf(sampleSong('missing'))], options: [] })

        expectOnlyTheGoodSong(createSongLibrary(storage), storage)
      })

      it('gives null, and breaks nothing, when the notes go missing after the library was made', () => {
        const storage = storageWith(sampleSong('a'), sampleSong('b'))
        const library = createSongLibrary(storage)

        storage.items.delete(songKey('a'))
        storage.plantSong('b', 'damaged')

        expect(library.get('a')).toBeNull()
        expect(library.get('b')).toBeNull()
        expect(() => library.rename('a', 'New')).not.toThrow()
        expect(() => library.setOptions('a', { speed: 0.75 })).not.toThrow()
        expect(() => library.remove('a')).not.toThrow()
        expect(ids(library)).toEqual(['b'])
        expect(ids(createSongLibrary(storage))).toEqual([])
      })
    })

    describe('saved data with more in it than there should be', () => {
      it('ignores extra entries, at every level', () => {
        const storage = new FakeStorage()
        const [firstTrack, secondTrack] = SAMPLE_SAVED.tracks
        storage.plantSong('a', {
          version: 9,
          tracks: [{ ...firstTrack, colour: 'red', notes: firstTrack?.notes }, secondTrack],
          notes: [[60, 0, 500, 100]],
        })
        storage.plantIndex({
          version: 9,
          songs: [{ ...summaryOf(sampleSong('a')), favourite: true, tracks: [1, 2, 3] }],
          options: [{ id: 'a', speed: 0.75, loop: true, volume: 11 }],
          settings: { volume: 1 },
        })

        const library = createSongLibrary(storage)

        expect(library.list()).toEqual([summaryOf(sampleSong('a'))])
        expect(library.get('a')).toEqual(sampleSong('a'))
        expect(library.getOptions('a')).toEqual({ ...DEFAULT_PLAY_OPTIONS, speed: 0.75 })
        expectHealthy(library)
      })

      it('is not fooled by entries named __proto__, and changes no prototype', () => {
        const storage = new FakeStorage()
        const tracks = JSON.stringify(SAMPLE_SAVED.tracks)
        storage.plantSong('a', `{"__proto__": {"polluted": true}, "tracks": ${tracks}}`)
        storage.plantSong('__proto__', SAMPLE_SAVED)
        storage.plantIndex(
          `{"__proto__": {"polluted": true}, "songs": [
            {"__proto__": {"polluted": true}, "id": "a", "title": "A", "createdAt": 2},
            {"id": "__proto__", "title": "Proto", "createdAt": 1}
          ], "options": [
            {"__proto__": {"speed": 0.5, "polluted": true}, "id": "a", "melodyOnly": true},
            {"id": "__proto__", "speed": 0.75},
            {"id": "constructor", "speed": 0.75}
          ]}`,
        )

        const library = createSongLibrary(storage)

        expect(ids(library)).toEqual(['a', '__proto__'])
        expect(library.get('__proto__')).toEqual(
          sampleSong('__proto__', { title: 'Proto', createdAt: 1 }),
        )
        expect(library.getOptions('a')).toEqual({ ...DEFAULT_PLAY_OPTIONS, melodyOnly: true })
        expect(library.getOptions('__proto__').speed).toBe(0.75)
        expect(library.getOptions('constructor')).toBe(DEFAULT_PLAY_OPTIONS)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        expect(Object.getPrototypeOf(library.list()[0])).toBe(Object.prototype)
        expectHealthy(library)
      })

      it('takes nothing from a prototype that other code has added to', () => {
        const storage = storageWith(sampleSong('a'))
        storage.plantSong('bare', {})
        storage.plantIndex({
          songs: [summaryOf(sampleSong('a')), { id: 'bare', createdAt: 1 }],
          options: [{ id: 'a', melodyOnly: true }],
        })
        const prototype = Object.prototype as Record<string, unknown>
        prototype.title = 'Inherited'
        prototype.tracks = SAMPLE_SAVED.tracks
        prototype.speed = 0.5
        prototype.trackIds = [3]

        try {
          const library = createSongLibrary(storage)
          library.setOptions('a', {})

          // 'bare' has no title and no parts of its own: it is broken, whatever it inherits.
          expect(library.list()).toEqual([summaryOf(sampleSong('a'))])
          expect(library.get('bare')).toBeNull()
          expect(library.getOptions('a')).toEqual({ ...DEFAULT_PLAY_OPTIONS, melodyOnly: true })
        } finally {
          delete prototype.title
          delete prototype.tracks
          delete prototype.speed
          delete prototype.trackIds
        }
      })

      it('counts the first of two entries with the same id, and keeps the notes', () => {
        const storage = storageWith(sampleSong('a'))
        const entry = summaryOf(sampleSong('a'))
        storage.plantIndex({
          songs: [
            { ...entry, title: 'First' },
            { ...entry, title: 'Second' },
            { ...entry, title: 7 },
          ],
          options: [
            { id: 'a', speed: 0.75 },
            { id: 'a', speed: 1.25 },
          ],
        })

        const library = createSongLibrary(storage)

        expect(library.list()).toEqual([{ ...entry, title: 'First' }])
        expect(library.get('a')).toEqual(sampleSong('a', { title: 'First' }))
        expect(library.getOptions('a').speed).toBe(0.75)
        expect(storage.index().songs).toEqual([{ ...entry, title: 'First' }])
      })
    })

    describe('numbers and texts that are not to be believed', () => {
      it('takes the length and the number of notes from the notes, not from the index', () => {
        for (const lie of [
          { duration: 1e308, noteCount: -5 },
          { duration: null, noteCount: 1e99 },
          { duration: 'long', noteCount: 2.5 },
          { duration: -1 },
          {},
        ]) {
          const storage = storageWith(sampleSong('a'))
          const { id, title, createdAt } = summaryOf(sampleSong('a'))
          storage.plantIndex({ songs: [{ id, title, createdAt, ...lie }], options: [] })

          const library = createSongLibrary(storage)

          expect(library.list()).toEqual([summaryOf(sampleSong('a'))])
          expectHealthy(library)
        }
      })

      it('cleans a saved title like any other title', () => {
        const titles: readonly (readonly [string, string])[] = [
          ['x'.repeat(200_000), 'x'.repeat(80)],
          ['  A \u0000\n\t B  ', 'A B'],
          ['', 'Untitled song'],
          [' \n ', 'Untitled song'],
        ]
        for (const [saved, shown] of titles) {
          const storage = storageWith(sampleSong('a'))
          const entry = { ...summaryOf(sampleSong('a')), title: saved }
          storage.plantIndex({ songs: [entry], options: [] })

          const library = createSongLibrary(storage)

          expect(library.list()[0]?.title).toBe(shown)
          expect(library.get('a')?.title).toBe(shown)
          expectHealthy(library)
        }
      })

      it('keeps a saved date inside what a date can be', () => {
        const dates: readonly (readonly [number, number])[] = [
          [1e300, 8.64e15],
          [-5, 0],
          [1234.5, 1234.5],
        ]
        for (const [saved, kept] of dates) {
          const storage = storageWith(sampleSong('a'))
          const entry = { ...summaryOf(sampleSong('a')), createdAt: saved }
          storage.plantIndex({ songs: [entry], options: [] })

          const library = createSongLibrary(storage)

          expect(library.list()[0]?.createdAt).toBe(kept)
          expectHealthy(library)
        }
      })

      it('cuts a saved part name that is far too long', () => {
        const storage = new FakeStorage()
        const [firstTrack] = SAMPLE_SAVED.tracks
        storage.plantSong('a', { tracks: [{ ...firstTrack, name: '🎹'.repeat(50_000) }] })
        storage.plantIndex({ songs: [summaryOf(sampleSong('a'))], options: [] })

        const library = createSongLibrary(storage)

        expect(library.get('a')?.tracks[0]?.name).toBe('🎹'.repeat(80))
        expectHealthy(library)
      })
    })

    describe('saved options', () => {
      function optionsFrom(saved: Record<string, unknown>): SongPlayOptions {
        const storage = storageWith(sampleSong('a'))
        const songs = [summaryOf(sampleSong('a'))]
        storage.plantIndex({ songs, options: [{ id: 'a', ...saved }] })
        const options = createSongLibrary(storage).getOptions('a')
        expectValidOptions(options)
        return options
      }

      it('are cleaned field by field: what is unusable becomes the default', () => {
        expect(optionsFrom({ speed: 99 }).speed).toBe(MAX_SPEED)
        expect(optionsFrom({ speed: -3 }).speed).toBe(MIN_SPEED)
        expect(optionsFrom({ speed: 1e300 }).speed).toBe(MAX_SPEED)
        expect(optionsFrom({ speed: 'fast', melodyOnly: true }).speed).toBe(1)
        expect(optionsFrom({ speed: null, melodyOnly: true }).speed).toBe(1)

        expect(optionsFrom({ trackIds: 'all', speed: 0.75 }).trackIds).toBe('auto')
        expect(optionsFrom({ trackIds: { 0: 1 }, speed: 0.75 }).trackIds).toBe('auto')
        const mixed = [0, '1', 2.5, null, 3, 3, 1e300, [4], -1]
        expect(optionsFrom({ trackIds: mixed }).trackIds).toEqual([0, 3, -1])
        expect(optionsFrom({ trackIds: ['x'] }).trackIds).toEqual([])

        expect(optionsFrom({ melodyOnly: 'yes', fitToPiano: 1, speed: 0.75 })).toEqual({
          ...DEFAULT_PLAY_OPTIONS,
          speed: 0.75,
        })
        expect(optionsFrom({ melodyOnly: true, fitToPiano: true })).toEqual({
          ...DEFAULT_PLAY_OPTIONS,
          melodyOnly: true,
          fitToPiano: true,
        })
      })

      it('that are no options at all are the defaults', () => {
        const storage = storageWith(sampleSong('a'))
        storage.plantIndex({
          songs: [summaryOf(sampleSong('a'))],
          options: [null, 5, 'a', ['a'], {}, { speed: 0.75 }, { id: 5, speed: 0.75 }],
        })

        expect(createSongLibrary(storage).getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)
        expect(storage.index().options).toEqual([])
      })

      it('that are not a list are the defaults', () => {
        for (const options of [null, 5, 'none', { a: { speed: 0.75 } }, { id: 'a', speed: 0.75 }]) {
          const storage = storageWith(sampleSong('a'))
          storage.plantIndex({ songs: [summaryOf(sampleSong('a'))], options })

          expect(createSongLibrary(storage).getOptions('a')).toBe(DEFAULT_PLAY_OPTIONS)
        }
      })

      it('for songs the library does not have are dropped, except those of the built-in songs', () => {
        const storage = storageWith(sampleSong('a'))
        storage.plantIndex({
          songs: [summaryOf(sampleSong('a')), summaryOf(sampleSong('missing'))],
          options: [
            { id: 'missing', speed: 0.75 },
            { id: 'stranger', speed: 0.75 },
            { id: 'starter:twinkle', speed: 0.75, melodyOnly: true },
            { id: 'starter:no-such-tune', trackIds: [0], speed: 99 },
            { id: 'a', fitToPiano: true },
          ],
        })

        const library = createSongLibrary(storage)

        expect(library.getOptions('missing')).toBe(DEFAULT_PLAY_OPTIONS)
        expect(library.getOptions('stranger')).toBe(DEFAULT_PLAY_OPTIONS)
        expect(library.getOptions('starter:twinkle')).toEqual({
          ...DEFAULT_PLAY_OPTIONS,
          speed: 0.75,
          melodyOnly: true,
        })
        // The index was cleaned and saved again: the options of the built-in songs are still in it.
        expect(storage.index()).toEqual({
          songs: [summaryOf(sampleSong('a'))],
          options: [
            { id: 'starter:twinkle', ...DEFAULT_PLAY_OPTIONS, speed: 0.75, melodyOnly: true },
            { id: 'starter:no-such-tune', ...DEFAULT_PLAY_OPTIONS, trackIds: [0], speed: 1.5 },
            { id: 'a', ...DEFAULT_PLAY_OPTIONS, fitToPiano: true },
          ],
        })
        const later = createSongLibrary(storage)
        expect(later.getOptions('starter:twinkle')).toEqual(library.getOptions('starter:twinkle'))
        expect(later.getOptions('starter:no-such-tune').trackIds).toEqual([0])
      })

      it('of the built-in songs survive every later change', () => {
        const storage = new FakeStorage()
        const library = createSongLibrary(storage)
        library.setOptions('starter:twinkle', { speed: 0.75 })
        library.add(sampleSong('a'))
        library.rename('a', 'New')
        library.setOptions('a', { melodyOnly: true })
        library.remove('a')

        expect(library.getOptions('starter:twinkle').speed).toBe(0.75)
        expect(createSongLibrary(storage).getOptions('starter:twinkle').speed).toBe(0.75)
      })
    })

    describe('a storage that throws', () => {
      it('gives an empty library that never throws, except add', () => {
        const storage = storageWith(sampleSong('a'))
        storage.locked = true

        const library = createSongLibrary(storage)
        const listener = vi.fn()
        library.subscribe(listener)

        expect(library.list()).toEqual([])
        expect(library.get('a')).toBeNull()
        expect(() => library.rename('a', 'New')).not.toThrow()
        expect(() => library.remove('a')).not.toThrow()
        expect(() => library.setOptions('starter:twinkle', { speed: 0.75 })).not.toThrow()
        expect(library.getOptions('starter:twinkle').speed).toBe(0.75)
        expect(() => library.add(sampleSong('b'))).toThrow(SongStorageError)
        expect(library.list()).toEqual([])
        expect(listener).toHaveBeenCalledTimes(1)
      })

      it('loses nothing: the songs are there again once the storage can be read', () => {
        const storage = storageWith(sampleSong('a'))
        const before = storage.contents()
        storage.locked = true
        createSongLibrary(storage)
        storage.locked = false

        expect(storage.contents()).toEqual(before)
        expect(ids(createSongLibrary(storage))).toEqual(['a'])
      })
    })

    describe('anything at all', () => {
      const GARBAGE: readonly unknown[] = [
        null,
        true,
        false,
        0,
        -1,
        1.5,
        127,
        1e300,
        -1e300,
        '',
        'x',
        'auto',
        '__proto__',
        'starter:x',
        [],
        {},
        [[]],
        [null],
        [60, 0, 500, 100],
        { id: 'a' },
        { id: 'b', title: 'B', createdAt: 1 },
        JSON.parse('{"__proto__": {"polluted": true}}'),
      ]

      type Holder = Record<string | number, unknown>
      /** A place where something is kept: the list or object, and the key in it. */
      type Place = [Holder, string | number]

      /** Every place in `value`, however deep. */
      function placesIn(value: unknown, found: Place[] = []): Place[] {
        if (typeof value !== 'object' || value === null) return found
        const holder = value as Holder
        for (const key of Object.keys(holder)) {
          found.push([holder, Array.isArray(value) ? Number(key) : key])
          placesIn(holder[key], found)
        }
        return found
      }

      /** A copy of what `text` stands for, with one thing in it replaced by garbage. */
      function damaged(text: string, random: () => number): string {
        const value: unknown = JSON.parse(text)
        const places = placesIn(value)
        const place = places[whole(random, places.length)]
        if (place === undefined) return JSON.stringify(pick(random, GARBAGE))
        const [holder, key] = place
        holder[key] = pick(random, GARBAGE)
        return JSON.stringify(value)
      }

      function spoil(storage: FakeStorage, key: string, random: () => number): void {
        const text = storage.items.get(key) ?? ''
        const how = whole(random, 10)
        if (how === 0) storage.items.delete(key)
        else if (how === 1) storage.items.set(key, text.slice(0, whole(random, text.length)))
        else if (how === 2) storage.items.set(key, JSON.stringify(pick(random, GARBAGE)))
        else storage.items.set(key, damaged(damaged(text, random), random))
      }

      it('never throws, never lists a song that cannot be read, and leaves untouched songs alone', () => {
        const random = createRandom(99)
        const a = sampleSong('a', { createdAt: 1 })
        const b = sampleSong('b', { createdAt: 2 })
        let stillListed = 0

        for (let round = 0; round < 1500; round += 1) {
          const storage = storageWith(a, b)
          const maker = createSongLibrary(storage)
          maker.setOptions('a', { speed: 0.75, trackIds: [0] })
          maker.setOptions('starter:twinkle', { melodyOnly: true })

          const spoiled = [INDEX_KEY, songKey('a'), songKey('b')].filter(() => random() < 0.5)
          for (const key of spoiled) spoil(storage, key, random)

          const library = createSongLibrary(storage)

          expectHealthy(library)
          expectValidOptions(library.getOptions('a'))
          expectValidOptions(library.getOptions('starter:twinkle'))
          if (!spoiled.includes(INDEX_KEY)) {
            const untouched = [a, b].filter((song) => !spoiled.includes(songKey(song.id)))
            for (const song of untouched) expect(library.get(song.id)).toEqual(song)
          }
          stillListed += library.list().length

          // It still works, and what it cleaned up stays cleaned up.
          library.add(sampleSong('new', { createdAt: 3 }))
          library.rename('new', 'Renamed')
          library.setOptions('new', { speed: 1.25 })
          library.remove('a')
          expect(library.get('new')).toEqual(sampleSong('new', { createdAt: 3, title: 'Renamed' }))
          const later = createSongLibrary(storage)
          expect(later.list()).toEqual(library.list())
          expect(later.getOptions('new')).toEqual(library.getOptions('new'))
          expectHealthy(later)
        }

        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        // The damage must not have wiped everything every time: that would prove little.
        expect(stillListed).toBeGreaterThan(500)
      })
    })
  })

  describe('when the storage is full', () => {
    it('add throws SongStorageError, and nothing has changed', () => {
      const storage = storageWith(sampleSong('a'))
      const library = createSongLibrary(storage)
      library.setOptions('a', { speed: 0.75 })
      const list = library.list()
      const saved = storage.contents()
      const listener = vi.fn()
      library.subscribe(listener)
      storage.capacity = storage.used() + 10

      let thrown: unknown
      try {
        library.add(sampleSong('b'))
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(SongStorageError)
      expect((thrown as SongStorageError).code).toBe('full')
      expect((thrown as SongStorageError).userMessage).toBe(FULL_MESSAGE)
      expect(library.list()).toBe(list)
      expect(library.get('b')).toBeNull()
      expect(library.get('a')).toEqual(sampleSong('a'))
      expect(listener).not.toHaveBeenCalled()
      expect(storage.contents()).toEqual(saved)
    })

    it('add takes the notes out again when they fit but the index does not', () => {
      const storage = storageWith(sampleSong('a'))
      const library = createSongLibrary(storage)
      const saved = storage.contents()
      const notesOfB = JSON.stringify(SAMPLE_SAVED).length
      // Room for the notes of one more song, but not for a longer index as well.
      storage.capacity = storage.used() + notesOfB + 5

      expect(() => library.add(sampleSong('b'))).toThrow(SongStorageError)

      expect(storage.contents()).toEqual(saved)
      expect(ids(library)).toEqual(['a'])
      expect(ids(createSongLibrary(storage))).toEqual(['a'])
    })

    it('add takes the notes out again when only the index cannot be written', () => {
      const storage = storageWith(sampleSong('a'))
      const library = createSongLibrary(storage)
      const saved = storage.contents()
      storage.refuses = (key) => key === INDEX_KEY

      expect(() => library.add(sampleSong('b'))).toThrow(SongStorageError)
      expect(storage.contents()).toEqual(saved)
      expect(ids(library)).toEqual(['a'])

      storage.refuses = () => false
      library.add(sampleSong('b'))
      expect(ids(createSongLibrary(storage))).toEqual(['b', 'a'])
    })

    it('add puts the old notes back when a song was being replaced', () => {
      const storage = storageWith(sampleSong('a'))
      const library = createSongLibrary(storage)
      const saved = storage.contents()
      storage.refuses = (key) => key === INDEX_KEY

      const replacement = sampleSong('a', { title: 'Replacement', tracks: [] })
      expect(() => library.add(replacement)).toThrow(SongStorageError)

      expect(storage.contents()).toEqual(saved)
      expect(library.get('a')).toEqual(sampleSong('a'))
      expect(library.list()).toEqual([summaryOf(sampleSong('a'))])
    })

    it('there is room again after a song is deleted, as the message promises', () => {
      const storage = new FakeStorage()
      const library = createSongLibrary(storage)
      library.add(bigSong('first', 600, 1))
      library.add(sampleSong('small'))
      storage.capacity = storage.used() + 100

      expect(() => library.add(bigSong('second', 400, 2))).toThrow(SongStorageError)
      library.remove('first')
      expect(() => library.add(bigSong('second', 400, 2))).not.toThrow()

      expect(ids(library).sort()).toEqual(['second', 'small'])
      expectHealthy(createSongLibrary(storage))
      expect(createSongLibrary(storage).get('small')).toEqual(sampleSong('small'))
    })

    it('filling it up song by song never harms the songs that are in', () => {
      const storage = new FakeStorage()
      storage.capacity = 60_000
      const library = createSongLibrary(storage)
      const kept: Song[] = []
      let refused = 0

      for (let index = 0; index < 40; index += 1) {
        const song = bigSong(`song-${index}`, 200 + 100 * (index % 4), index)
        try {
          library.add(song)
          kept.push(library.get(song.id) as Song)
        } catch (error) {
          expect(error).toBeInstanceOf(SongStorageError)
          refused += 1
        }
        expect(ids(library).sort()).toEqual(kept.map((each) => each.id).sort())
      }

      expect(kept.length).toBeGreaterThan(3)
      expect(refused).toBeGreaterThan(3)
      const later = createSongLibrary(storage)
      expectHealthy(later)
      for (const song of kept) expect(later.get(song.id)).toEqual(song)
      // Nothing is left in storage but the index and the songs it lists.
      expect(Object.keys(storage.contents()).sort()).toEqual(
        [INDEX_KEY, ...kept.map((each) => songKey(each.id))].sort(),
      )
    })

    it('rename, remove and setOptions never throw: the change holds until the page is closed', () => {
      const storage = storageWith(sampleSong('a'), sampleSong('b'))
      const library = createSongLibrary(storage)
      const listener = vi.fn()
      library.subscribe(listener)
      storage.refuses = () => true

      expect(() => library.rename('a', 'New')).not.toThrow()
      expect(() => library.setOptions('a', { speed: 0.75 })).not.toThrow()
      expect(() => library.setOptions('starter:twinkle', { melodyOnly: true })).not.toThrow()
      expect(() => library.remove('b')).not.toThrow()

      expect(library.list()).toEqual([{ ...summaryOf(sampleSong('a')), title: 'New' }])
      expect(library.get('a')?.title).toBe('New')
      expect(library.getOptions('a').speed).toBe(0.75)
      expect(library.getOptions('starter:twinkle').melodyOnly).toBe(true)
      expect(listener).toHaveBeenCalledTimes(4)

      // Once the storage takes writes again, the next change saves all of it.
      storage.refuses = () => false
      library.setOptions('a', { speed: 0.8 })
      const later = createSongLibrary(storage)
      expect(later.list()).toEqual(library.list())
      expect(later.getOptions('a').speed).toBe(0.8)
      expect(later.getOptions('starter:twinkle').melodyOnly).toBe(true)
    })

    it('a deleted song whose removal could not be saved is gone at the next visit all the same', () => {
      const storage = storageWith(sampleSong('a'), sampleSong('b'))
      const library = createSongLibrary(storage)
      storage.refuses = () => true
      library.remove('b')
      storage.refuses = () => false

      // The index still lists 'b', but its notes are gone: the next visit drops it.
      const later = createSongLibrary(storage)
      expect(ids(later)).toEqual(['a'])
      expect(storage.index().songs).toEqual([summaryOf(sampleSong('a'))])
    })
  })
})

describe('songLibrary (the app-wide library)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('can be imported and used where there is no browser', () => {
    expect(typeof window).toBe('undefined')
    expect(songLibrary.list()).toEqual([])

    songLibrary.add(sampleSong('a'))
    songLibrary.setOptions('a', { speed: 0.75 })
    expect(songLibrary.get('a')).toEqual(sampleSong('a'))
    expect(songLibrary.getOptions('a').speed).toBe(0.75)

    songLibrary.remove('a')
    expect(songLibrary.list()).toEqual([])
  })

  it('reads from and saves to window.localStorage when the browser has it', async () => {
    const localStorage = storageWith(sampleSong('a'))
    vi.stubGlobal('window', { localStorage })
    vi.resetModules()
    const fresh = await import('./songLibrary')

    expect(fresh.songLibrary.get('a')).toEqual(sampleSong('a'))
    fresh.songLibrary.add(sampleSong('b'))
    expect(ids(createSongLibrary(localStorage))).toEqual(['b', 'a'])
  })

  it('works in memory when touching window.localStorage throws', async () => {
    const privateWindow = {
      get localStorage(): never {
        throw new Error('SecurityError: access is denied')
      },
    }
    vi.stubGlobal('window', privateWindow)
    vi.resetModules()
    const fresh = await import('./songLibrary')

    expect(fresh.songLibrary.list()).toEqual([])
    fresh.songLibrary.add(sampleSong('a'))
    expect(fresh.songLibrary.get('a')).toEqual(sampleSong('a'))
  })

  it('works in memory when the browser has no localStorage', async () => {
    for (const localStorage of [undefined, null]) {
      vi.stubGlobal('window', { localStorage })
      vi.resetModules()
      const fresh = await import('./songLibrary')

      fresh.songLibrary.add(sampleSong('a'))
      expect(fresh.songLibrary.get('a')).toEqual(sampleSong('a'))
    }
  })

  describe('with the app open in another tab as well', () => {
    /**
     * This tab: a fresh copy of the module over a window that has a storage
     * (or none) and can be sent events, as a browser window can.
     */
    async function openTab(localStorage: FakeStorage | null) {
      const tabWindow = Object.assign(new EventTarget(), { localStorage })
      vi.stubGlobal('window', tabWindow)
      vi.resetModules()
      const { songLibrary: library } = await import('./songLibrary')
      const listener = vi.fn()
      library.subscribe(listener)

      return {
        library,
        listener,
        /**
         * The browser tells this tab that another tab changed what is saved
         * under `key` (null: everything was cleared).
         */
        hearAbout(key: string | null): void {
          tabWindow.dispatchEvent(Object.assign(new Event('storage'), { key }))
        },
      }
    }

    it('lists the song the other tab added, and tells its listeners once', async () => {
      const localStorage = storageWith(sampleSong('a'))
      const tab = await openTab(localStorage)
      const otherTab = createSongLibrary(localStorage)

      otherTab.add(sampleSong('b'))
      tab.hearAbout(INDEX_KEY)

      expect(ids(tab.library)).toEqual(['b', 'a'])
      expect(tab.library.get('b')).toEqual(sampleSong('b'))
      expect(tab.listener).toHaveBeenCalledTimes(1)
    })

    it('keeps the song the other tab added when it adds one of its own afterwards', async () => {
      const localStorage = new FakeStorage()
      const tab = await openTab(localStorage)
      const otherTab = createSongLibrary(localStorage)

      otherTab.add(sampleSong('theirs', { createdAt: 1 }))
      tab.hearAbout(INDEX_KEY)
      tab.library.add(sampleSong('mine', { createdAt: 2 }))

      expect(ids(createSongLibrary(localStorage))).toEqual(['mine', 'theirs'])
    })

    it('follows a rename, a removal and new options made in the other tab', async () => {
      const localStorage = storageWith(sampleSong('a'), sampleSong('b'))
      const tab = await openTab(localStorage)
      const otherTab = createSongLibrary(localStorage)
      const before = tab.library.get('a')

      otherTab.rename('a', 'New')
      otherTab.remove('b')
      otherTab.setOptions('a', { speed: 0.75 })
      otherTab.setOptions('starter:twinkle', { melodyOnly: true })
      tab.hearAbout(INDEX_KEY)

      expect(tab.library.list()).toEqual(otherTab.list())
      expect(Object.isFrozen(tab.library.list())).toBe(true)
      expect(Object.isFrozen(tab.library.list()[0])).toBe(true)
      expect(tab.library.get('a')).toEqual({ ...before, title: 'New' })
      expect(tab.library.get('b')).toBeNull()
      expect(tab.library.getOptions('a').speed).toBe(0.75)
      expect(tab.library.getOptions('starter:twinkle').melodyOnly).toBe(true)
      expect(tab.listener).toHaveBeenCalledTimes(1)
    })

    it('tells no one, and keeps its list and options, when the other tab saved what it already has', async () => {
      const localStorage = new FakeStorage()
      const tab = await openTab(localStorage)
      tab.library.add(sampleSong('a'))
      tab.library.setOptions('a', { speed: 0.75 })
      const list = tab.library.list()
      const options = tab.library.getOptions('a')
      const song = tab.library.get('a')
      tab.listener.mockClear()

      tab.hearAbout(INDEX_KEY)

      expect(tab.library.list()).toBe(list)
      expect(tab.library.getOptions('a')).toBe(options)
      expect(tab.library.get('a')).toBe(song)
      expect(tab.listener).not.toHaveBeenCalled()
    })

    it('keeps the same list when the other tab only changed options, and does not read the notes again', async () => {
      const localStorage = storageWith(sampleSong('a'), sampleSong('b'))
      const tab = await openTab(localStorage)
      const list = tab.library.list()
      const otherTab = createSongLibrary(localStorage)
      otherTab.setOptions('a', { speed: 0.75 })
      localStorage.reads = 0

      tab.hearAbout(INDEX_KEY)

      expect(tab.library.list()).toBe(list)
      expect(tab.library.getOptions('a').speed).toBe(0.75)
      expect(tab.listener).toHaveBeenCalledTimes(1)
      // Only the index was read.
      expect(localStorage.reads).toBe(1)
    })

    it('cleans what the other tab saved like anything else read from storage', async () => {
      const localStorage = storageWith(sampleSong('a'))
      const tab = await openTab(localStorage)

      localStorage.plantIndex({
        songs: [summaryOf(sampleSong('a')), summaryOf(sampleSong('missing')), 'nonsense'],
        options: [{ id: 'a', speed: 99 }],
      })
      tab.hearAbout(INDEX_KEY)
      expect(ids(tab.library)).toEqual(['a'])
      expect(tab.library.getOptions('a').speed).toBe(MAX_SPEED)

      localStorage.plantIndex('{"songs": [')
      tab.hearAbout(INDEX_KEY)
      expect(tab.library.list()).toEqual([])
    })

    it('is empty when everything the site saved is cleared', async () => {
      const localStorage = storageWith(sampleSong('a'))
      const tab = await openTab(localStorage)

      localStorage.items.clear()
      tab.hearAbout(null)

      expect(tab.library.list()).toEqual([])
      expect(tab.library.get('a')).toBeNull()
      expect(tab.listener).toHaveBeenCalledTimes(1)
    })

    it('does not read the storage again when the site saved something else', async () => {
      const localStorage = storageWith(sampleSong('a'))
      const tab = await openTab(localStorage)
      const list = tab.library.list()
      localStorage.reads = 0

      tab.hearAbout('pianoapp.settings.v1')
      tab.hearAbout(songKey('a'))

      expect(localStorage.reads).toBe(0)
      expect(tab.library.list()).toBe(list)
      expect(tab.listener).not.toHaveBeenCalled()
    })

    it('keeps its songs when it has no storage to read them from', async () => {
      const tab = await openTab(null)
      tab.library.add(sampleSong('a'))
      tab.library.setOptions('a', { speed: 0.75 })
      const list = tab.library.list()
      tab.listener.mockClear()

      tab.hearAbout(INDEX_KEY)
      tab.hearAbout(null)

      expect(tab.library.list()).toBe(list)
      expect(tab.library.get('a')).toEqual(sampleSong('a'))
      expect(tab.library.getOptions('a').speed).toBe(0.75)
      expect(tab.listener).not.toHaveBeenCalled()
    })
  })
})

describe('useSongList', () => {
  it('gives the list of the app-wide library, also when rendered without a browser', () => {
    songLibrary.add(sampleSong('a'))
    const listed = songLibrary.list()
    const seen: (readonly SongSummary[])[] = []
    function Probe(): null {
      seen.push(useSongList())
      return null
    }

    renderToString(createElement(Probe))
    songLibrary.remove('a')

    expect(seen).toEqual([[summaryOf(sampleSong('a'))]])
    expect(seen[0]).toBe(listed)
  })
})
