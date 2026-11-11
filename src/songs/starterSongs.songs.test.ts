/**
 * The six built-in tunes, checked against the tunes as they are commonly
 * written. Each is written out here a second time, in another notation (the
 * steps of the scale, as beginners' books number them), and the two must give
 * the same notes at the same moments.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE_OCTAVE, pianoRange } from '../core/layout'
import { DEFAULT_BINDINGS } from '../input/keymap'
import { DEFAULT_ARRANGE_OPTIONS, arrange, bestBaseOctave } from './arrange'
import { MAX_SPEED } from './song'
import type { Song } from './song'
import { STARTER_SONGS, isStarterSong, tuneToSong } from './starterSongs'

const C4 = 60
const F5 = 77
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]

/**
 * A tune in numbers: "1" is the first step of a major scale that starts on
 * `tonic`, "5," the fifth step an octave lower, "3:2" a third step that lasts
 * two beats (one beat when no length is given). "|" is only for the eye.
 */
function fromSteps(tonic: number, tune: string): [midi: number, beat: number, beats: number][] {
  const notes: [number, number, number][] = []
  let beat = 0
  for (const token of tune.split(/\s+/)) {
    if (token === '' || token === '|') continue
    const match = /^([1-7])(,?)(?::([\d.]+))?$/.exec(token)
    if (!match) throw new Error(`Cannot read "${token}".`)
    const step = MAJOR_SCALE[Number(match[1]) - 1] ?? 0
    const beats = match[3] === undefined ? 1 : Number(match[3])
    notes.push([tonic + step - (match[2] === ',' ? 12 : 0), beat, beats])
    beat += beats
  }
  return notes
}

/** A tune as MIDI note numbers of `unit` beats each; "69:2" lasts two units, "r" is silent. */
function fromNumbers(unit: number, tune: string): [midi: number, beat: number, beats: number][] {
  const notes: [number, number, number][] = []
  let beat = 0
  for (const token of tune.split(/\s+/)) {
    if (token === '' || token === '|') continue
    const [pitch, units = '1'] = token.split(':')
    const beats = Number(units) * unit
    if (pitch !== 'r') notes.push([Number(pitch), beat, beats])
    beat += beats
  }
  return notes
}

const G4 = 67

/** The tunes as they are commonly written, with the speed and the first note of each. */
type WrittenNote = [midi: number, beat: number, beats: number]

const AS_COMMONLY_WRITTEN: Readonly<
  Record<string, { beatsPerMinute: number; notes: WrittenNote[] }>
> = {
  'Twinkle, Twinkle, Little Star': {
    beatsPerMinute: 100,
    notes: fromSteps(
      C4,
      '1 1 5 5 | 6 6 5:2 | 4 4 3 3 | 2 2 1:2 | 5 5 4 4 | 3 3 2:2 | ' +
        '5 5 4 4 | 3 3 2:2 | 1 1 5 5 | 6 6 5:2 | 4 4 3 3 | 2 2 1:2',
    ),
  },
  'Mary Had a Little Lamb': {
    beatsPerMinute: 110,
    notes: fromSteps(
      C4,
      '3 2 1 2 | 3 3 3:2 | 2 2 2:2 | 3 5 5:2 | 3 2 1 2 | 3 3 3 3 | 2 2 3 2 | 1:4',
    ),
  },
  'Ode to Joy': {
    beatsPerMinute: 110,
    notes: fromSteps(
      G4,
      '3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3:1.5 2:.5 2:2 | ' +
        '3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2:1.5 1:.5 1:2 | ' +
        '2 2 3 1 | 2 3:.5 4:.5 3 1 | 2 3:.5 4:.5 3 2 | 1 2 5,:2 | ' +
        '3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2:1.5 1:.5 1:2',
    ),
  },
  'Frère Jacques': {
    beatsPerMinute: 110,
    notes: fromSteps(
      G4,
      '1 2 3 1 | 1 2 3 1 | 3 4 5:2 | 3 4 5:2 | ' +
        '5:.5 6:.5 5:.5 4:.5 3 1 | 5:.5 6:.5 5:.5 4:.5 3 1 | 1 5, 1:2 | 1 5, 1:2',
    ),
  },
  'Jingle Bells': {
    beatsPerMinute: 120,
    notes: fromSteps(
      C4,
      '3 3 3:2 | 3 3 3:2 | 3 5 1:1.5 2:.5 | 3:4 | ' +
        '4 4 4:1.5 4:.5 | 4 3 3 3:.5 3:.5 | 3 2 2 3 | 2:2 5:2 | ' +
        '3 3 3:2 | 3 3 3:2 | 3 5 1:1.5 2:.5 | 3:4 | ' +
        '4 4 4:1.5 4:.5 | 4 3 3 3:.5 3:.5 | 5 5 4 2 | 1:4',
    ),
  },
  // Not in a major key: written as the keys of the piano, 76 = E5, in sixteenth notes.
  'Für Elise (opening)': {
    beatsPerMinute: 66,
    notes: fromNumbers(
      0.25,
      '76 75 | 76 75 76 71 74 72 | 69:2 r 60 64 69 | 71:2 r 64 68 71 | 72:2 r 64 76 75 | ' +
        '76 75 76 71 74 72 | 69:2 r 60 64 69 | 71:2 r 64 72 71 | 69:4',
    ),
  },
}

function notesOf(song: Song) {
  const part = song.tracks[0]
  if (!part) throw new Error(`"${song.title}" has no part.`)
  return part.notes
}

describe('the six built-in tunes', () => {
  it('are these six, in this order', () => {
    expect(STARTER_SONGS.map((song) => song.title)).toEqual(Object.keys(AS_COMMONLY_WRITTEN))
  })

  for (const song of STARTER_SONGS) {
    const written = AS_COMMONLY_WRITTEN[song.title]

    it(`"${song.title}" has the notes of the tune as it is commonly written`, () => {
      if (!written) throw new Error('A tune that is not one of the six.')
      expect(notesOf(song).map((note) => note.midi)).toEqual(written.notes.map(([midi]) => midi))
    })

    it(`"${song.title}" has every note at its moment, at the speed the tune is given`, () => {
      if (!written) throw new Error('A tune that is not one of the six.')
      const secondsPerBeat = 60 / written.beatsPerMinute
      const notes = notesOf(song)
      expect(notes).toHaveLength(written.notes.length)
      notes.forEach((note, index) => {
        const [, beat, beats] = written.notes[index] ?? [0, 0, 0]
        expect(note.time, `note ${index}`).toBeCloseTo(beat * secondsPerBeat, 9)
        // Each note sounds for nine tenths of its length.
        expect(note.duration, `note ${index}`).toBeCloseTo(beats * 0.9 * secondsPerBeat, 9)
      })
      const last = notes[notes.length - 1]
      expect(song.duration).toBeCloseTo((last?.time ?? 0) + (last?.duration ?? 0), 9)
    })
  }

  it('all lie between middle C and the F an octave and a half above', () => {
    for (const song of STARTER_SONGS) {
      for (const note of notesOf(song)) {
        expect(note.midi, song.title).toBeGreaterThanOrEqual(C4)
        expect(note.midi, song.title).toBeLessThanOrEqual(F5)
      }
    }
  })

  it('are played at speeds a beginner can follow, and none is over in a blink or drags on', () => {
    for (const song of STARTER_SONGS) {
      const notes = notesOf(song)
      const shortest = Math.min(
        ...notes.map((note, index) => (notes[index + 1]?.time ?? Infinity) - note.time),
      )
      // Even the quickest notes are a fifth of a second apart; no note is held over four seconds.
      expect(shortest, song.title).toBeGreaterThanOrEqual(0.2)
      expect(Math.max(...notes.map((note) => note.duration)), song.title).toBeLessThanOrEqual(4)
      expect(song.duration, song.title).toBeGreaterThan(8)
      expect(song.duration, song.title).toBeLessThan(45)
    }
  })

  it('have one part each, a piano, with nothing in it the app could not play', () => {
    for (const song of STARTER_SONGS) {
      expect(isStarterSong(song.id), song.title).toBe(true)
      expect(song.tracks).toHaveLength(1)
      expect(song.tracks[0]).toMatchObject({ isPercussion: false, program: 0 })
      const notes = notesOf(song)
      notes.forEach((note, index) => {
        expect(note.velocity > 0 && note.velocity <= 1).toBe(true)
        const next = notes[index + 1]
        // One note at a time, in order.
        if (!next) return
        expect(note.time + note.duration, `${song.title}, note ${index}`).toBeLessThan(next.time)
      })
    }
  })

  it('have ids that are all different and are not the id of an imported song', () => {
    const idsSeen = new Set(STARTER_SONGS.map((song) => song.id))
    expect(idsSeen.size).toBe(STARTER_SONGS.length)
    expect(isStarterSong('8d0c9d5e-0f7e-4b5e-9c1a-1d2f3a4b5c6d')).toBe(false)
    expect(isStarterSong('')).toBe(false)
    expect(isStarterSong('a starter: song')).toBe(false)
  })
})

describe('the built-in tunes on the piano as it starts out', () => {
  const homeRow = new Set(Object.values(DEFAULT_BINDINGS))

  it('leave the computer keys where they are: every note already has a key', () => {
    for (const song of STARTER_SONGS) {
      expect(bestBaseOctave(notesOf(song), homeRow), song.title).toBe(DEFAULT_BASE_OCTAVE)
    }
  })

  it('are played note for note, with nothing off the smallest piano', () => {
    const smallest = pianoRange(37, DEFAULT_BASE_OCTAVE)
    for (const song of STARTER_SONGS) {
      const played = arrange(song, DEFAULT_ARRANGE_OPTIONS, smallest)
      expect(played.notes, song.title).toEqual(notesOf(song))
      expect(played.offPianoCount, song.title).toBe(0)
      expect(played.duration, song.title).toBe(song.duration)
      // The other ways of playing change nothing either: one note at a time, all on the piano.
      const plain = arrange(
        song,
        { trackIds: 'auto', melodyOnly: true, fitToPiano: true },
        smallest,
      )
      expect(plain.notes, song.title).toEqual(notesOf(song))
    }
  })

  it('leave a gap the ear can hear between two notes on one key, even at the fastest speed', () => {
    for (const song of STARTER_SONGS) {
      const notes = notesOf(song)
      notes.forEach((note, index) => {
        const next = notes[index + 1]
        if (!next || next.midi !== note.midi) return
        const gap = (next.time - (note.time + note.duration)) / MAX_SPEED
        // Three ticks of the player's timer, so the key is seen to come up and go down again.
        expect(gap, `${song.title}, note ${index}`).toBeGreaterThanOrEqual(0.015)
      })
    }
  })
})

describe('writing a tune as text', () => {
  it('reads notes, sharps, rests and bar lines', () => {
    const song = tuneToSong('starter:test', 'Test', 60, 'C4/1 | D#4/.5 R/.5 | G5/2')
    expect(notesOf(song).map((note) => [note.midi, note.time, note.duration])).toEqual([
      [60, 0, 0.9],
      [63, 1, 0.45],
      [79, 2, 1.8],
    ])
    expect(song).toMatchObject({ id: 'starter:test', title: 'Test', duration: 3.8, createdAt: 0 })
  })

  it('refuses what it cannot read, and says which piece of the tune it was', () => {
    const unreadable = ['H4/1', 'C4', 'C4/', 'C/1', 'C4/0', 'C4/-1', 'Cb4/1', 'c4/1', 'C4/1/2']
    for (const bad of [...unreadable, 'C10/1', 'C9/1', 'A0/x', '4C/1']) {
      expect(() => tuneToSong('starter:test', 'Test', 100, `C4/1 ${bad}`), bad).toThrow(bad)
    }
  })

  it('refuses a tune with no notes and a speed that is not a speed', () => {
    expect(() => tuneToSong('starter:test', 'Test', 100, 'R/1 | R/2')).toThrow()
    expect(() => tuneToSong('starter:test', 'Test', 100, '')).toThrow()
    for (const speed of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => tuneToSong('starter:test', 'Test', speed, 'C4/1'), String(speed)).toThrow()
    }
  })
})
