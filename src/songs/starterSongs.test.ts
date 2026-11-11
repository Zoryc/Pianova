import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE_OCTAVE, midiToSlot } from '../core/layout'
import { noteName } from '../core/notes'
import { DEFAULT_BINDINGS } from '../input/keymap'
import { summarize } from './song'
import type { Song, SongNote } from './song'
import { STARTER_SONGS, STARTER_TUNES, isStarterSong, tuneToSong } from './starterSongs'

const C4 = 60
const F5 = 77

function notesOf(song: Song): readonly SongNote[] {
  return song.tracks.flatMap((track) => track.notes)
}

/** The number of beats between each pair of bar lines of a tune. */
function barLengths(tune: string): number[] {
  return tune.split('|').map((bar) =>
    bar
      .trim()
      .split(/\s+/)
      .reduce((beats, token) => beats + Number(token.split('/')[1]), 0),
  )
}

describe('tuneToSong', () => {
  it('reads notes, sharps and rests, and counts time in beats', () => {
    const song = tuneToSong('test:one', 'One', 60, 'C4/1 D#5/.25 R/.5 E4/2')
    const [first, second, third] = notesOf(song)

    expect(notesOf(song)).toHaveLength(3)
    expect(first).toEqual({ midi: 60, time: 0, duration: 0.9, velocity: expect.any(Number) })
    expect(second?.midi).toBe(75)
    expect(second?.time).toBeCloseTo(1, 10)
    expect(second?.duration).toBeCloseTo(0.225, 10)
    expect(third?.midi).toBe(64)
    expect(third?.time).toBeCloseTo(1.75, 10)
    expect(third?.duration).toBeCloseTo(1.8, 10)
  })

  it('makes a song with one piano part', () => {
    const song = tuneToSong('test:shape', 'Shape', 90, 'G4/1 A4/1')

    expect(song.id).toBe('test:shape')
    expect(song.title).toBe('Shape')
    expect(song.tracks).toHaveLength(1)
    expect(song.tracks[0]).toMatchObject({ id: 0, name: '', isPercussion: false, program: 0 })
    expect(Number.isFinite(song.createdAt)).toBe(true)
    for (const note of notesOf(song)) {
      expect(note.velocity).toBeGreaterThan(0)
      expect(note.velocity).toBeLessThanOrEqual(1)
    }
  })

  it('plays faster when there are more beats a minute', () => {
    const slow = notesOf(tuneToSong('test:slow', 'Slow', 60, 'C4/1 D4/1 E4/2'))
    const fast = notesOf(tuneToSong('test:fast', 'Fast', 120, 'C4/1 D4/1 E4/2'))

    expect(fast.map((note) => note.time)).toEqual(slow.map((note) => note.time / 2))
    expect(fast.map((note) => note.duration)).toEqual(slow.map((note) => note.duration / 2))
  })

  it('sounds each note for 90% of its length and ends the song with the last note', () => {
    const song = tuneToSong('test:gap', 'Gap', 60, 'C4/2 C4/2 R/4')
    const [first, second] = notesOf(song)

    expect(first?.duration).toBeCloseTo(1.8, 10)
    expect(second?.time).toBe(2)
    expect(song.duration).toBeCloseTo(3.8, 10)
  })

  it('ignores bar lines and any amount of space between tokens', () => {
    const plain = tuneToSong('test:bars', 'Bars', 100, 'C4/1 D4/1 E4/1 F4/1')
    const barred = tuneToSong('test:bars', 'Bars', 100, '  C4/1 D4/1 |\n\tE4/1   F4/1 |  ')

    expect(barred).toEqual(plain)
  })

  it('reads the whole piano, from A0 to C8', () => {
    const notes = notesOf(tuneToSong('test:range', 'Range', 60, 'A0/1 C8/1 B#3/1'))

    expect(notes.map((note) => note.midi)).toEqual([21, 108, 60])
  })

  it('says which token it cannot read, and in which tune', () => {
    const unreadable = [
      'H4/1',
      'c4/1',
      'C4',
      'C4/',
      'C/1',
      'C4/0',
      'C4/-1',
      'C4/1/2',
      'C4/one',
      'C4/1.',
      'Cb4/1',
      'C##4/1',
      'r/1',
      'R4/1',
      'R/0',
      '||',
      'G#0/1',
      'C9/1',
    ]
    for (const token of unreadable) {
      expect(() => tuneToSong('test:bad', 'Bad tune', 100, `C4/1 ${token} D4/1`)).toThrow(
        `Cannot read "${token}" in the tune "Bad tune".`,
      )
    }
  })

  it('refuses a speed that is not above zero', () => {
    for (const speed of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => tuneToSong('test:speed', 'Still', speed, 'C4/1')).toThrow(/"Still"/)
    }
  })

  it('refuses a tune with no notes in it', () => {
    for (const tune of ['', '   ', '| |', 'R/1 R/2']) {
      expect(() => tuneToSong('test:empty', 'Empty', 100, tune)).toThrow(
        'The tune "Empty" has no notes.',
      )
    }
  })
})

describe('STARTER_SONGS', () => {
  it('has the six tunes, in order', () => {
    expect(STARTER_SONGS.map((song) => song.title)).toEqual([
      'Twinkle, Twinkle, Little Star',
      'Mary Had a Little Lamb',
      'Ode to Joy',
      'Frère Jacques',
      'Jingle Bells',
      'Für Elise (opening)',
    ])
    expect(STARTER_TUNES.map((starter) => starter.beatsPerMinute)).toEqual([
      100, 110, 110, 110, 120, 66,
    ])
  })

  it('is every written tune, read without an error', () => {
    expect(STARTER_SONGS).toHaveLength(STARTER_TUNES.length)
    STARTER_TUNES.forEach((starter, index) => {
      const song = tuneToSong(starter.id, starter.title, starter.beatsPerMinute, starter.tune)
      expect(STARTER_SONGS[index]).toEqual(song)
    })
  })

  it('has the right number of notes in each tune', () => {
    expect(STARTER_SONGS.map((song) => summarize(song).noteCount)).toEqual([42, 26, 62, 32, 51, 35])
  })

  it('keeps every note between C4 and F5', () => {
    for (const song of STARTER_SONGS) {
      const outside = notesOf(song)
        .filter((note) => note.midi < C4 || note.midi > F5)
        .map((note) => noteName(note.midi))
      expect(outside, song.title).toEqual([])
    }
  })

  it('can be played with the default keys without moving the piano', () => {
    const slotsWithAKey = new Set(Object.values(DEFAULT_BINDINGS))
    for (const song of STARTER_SONGS) {
      for (const note of notesOf(song)) {
        const slot = midiToSlot(note.midi, DEFAULT_BASE_OCTAVE)
        expect(slot !== null && slotsWithAKey.has(slot), `${song.title}: ${note.midi}`).toBe(true)
      }
    }
  })

  it('has bars of equal length in every tune (the last bar makes up for a short first)', () => {
    const beatsInABar: Readonly<Record<string, number>> = {
      'starter:twinkle-twinkle-little-star': 4,
      'starter:mary-had-a-little-lamb': 4,
      'starter:ode-to-joy': 4,
      'starter:frere-jacques': 4,
      'starter:jingle-bells': 4,
      'starter:fur-elise': 1.5,
    }
    for (const starter of STARTER_TUNES) {
      const full = beatsInABar[starter.id]
      const bars = barLengths(starter.tune)
      const first = bars[0] ?? 0
      const last = bars[bars.length - 1] ?? 0
      const startsWithAPickup = first !== full

      const inner = startsWithAPickup ? bars.slice(1, -1) : bars
      expect(inner, starter.title).toEqual(inner.map(() => full))
      if (startsWithAPickup) expect(first + last, starter.title).toBe(full)
    }
  })

  it('plays one note at a time, each starting after the one before has ended', () => {
    for (const song of STARTER_SONGS) {
      const notes = notesOf(song)
      for (let index = 1; index < notes.length; index++) {
        const before = notes[index - 1]
        const note = notes[index]
        if (before === undefined || note === undefined) continue
        expect(note.time, song.title).toBeGreaterThan(before.time + before.duration)
      }
      const lastNote = notes[notes.length - 1]
      expect(song.duration).toBe((lastNote?.time ?? 0) + (lastNote?.duration ?? 0))
    }
  })

  it('lasts as long as its beats say', () => {
    const [twinkle] = STARTER_SONGS
    // 48 beats at 100 beats a minute; the last note (2 beats) sounds for 90% of its length.
    expect(twinkle?.duration).toBeCloseTo((46 + 2 * 0.9) * 0.6, 10)
  })

  it('gives each song its own id, starting with "starter:"', () => {
    const ids = STARTER_SONGS.map((song) => song.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('starter:')).toBe(true)
    expect(new Set(STARTER_SONGS.map((song) => song.title)).size).toBe(ids.length)
  })
})

describe('isStarterSong', () => {
  it('is true for every built-in song', () => {
    for (const song of STARTER_SONGS) expect(isStarterSong(song.id)).toBe(true)
  })

  it('is false for the id of an imported song', () => {
    const imported = ['', 'abc', '3f2c9a1e-7d44-4c0b-9b1e-2a5d6c7e8f90', 'my-starter:song']
    for (const id of [...imported, 'Starter:x', ' starter:x']) {
      expect(isStarterSong(id)).toBe(false)
    }
  })

  it('is false for something that is not an id at all', () => {
    expect(isStarterSong(undefined as unknown as string)).toBe(false)
    expect(isStarterSong(7 as unknown as string)).toBe(false)
  })
})
