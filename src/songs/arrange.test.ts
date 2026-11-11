import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_OCTAVE,
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  PIANO_SIZES,
  SLOT_COUNT,
  isInRange,
  midiToSlot,
  pianoRange,
} from '../core/layout'
import type { PianoRange } from '../core/layout'
import { DEFAULT_ARRANGE_OPTIONS, arrange, bestBaseOctave, selectedTracks } from './arrange'
import type { ArrangeOptions, Arrangement, PlayableNote } from './arrange'
import { DEFAULT_ARRANGE_OPTIONS as SONG_DEFAULT_ARRANGE_OPTIONS } from './song'
import type { Song, SongNote, SongTrack } from './song'

/** The full piano, A0..C8: no note of a song is off it. */
const FULL_PIANO = pianoRange(88, DEFAULT_BASE_OCTAVE)
/** The smallest piano at its usual place, C3..C6 (48..84). */
const SMALL_PIANO = pianoRange(37, DEFAULT_BASE_OCTAVE)

function note(midi: number, time: number, duration = 0.5, velocity = 0.8): SongNote {
  return { midi, time, duration, velocity }
}

function byTimeThenMidi(a: SongNote, b: SongNote): number {
  return a.time - b.time || a.midi - b.midi
}

function track(id: number, notes: SongNote[], extra: Partial<SongTrack> = {}): SongTrack {
  return {
    id,
    name: '',
    isPercussion: false,
    program: 0,
    notes: [...notes].sort(byTimeThenMidi),
    ...extra,
  }
}

function songOf(...tracks: SongTrack[]): Song {
  const ends = tracks.flatMap((part) => part.notes.map((each) => each.time + each.duration))
  return { id: 'test', title: 'Test', duration: Math.max(0, ...ends), tracks, createdAt: 0 }
}

/** A song with one part. */
function tune(...notes: SongNote[]): Song {
  return songOf(track(0, notes))
}

function options(patch: Partial<ArrangeOptions> = {}): ArrangeOptions {
  return { ...DEFAULT_ARRANGE_OPTIONS, ...patch }
}

const MELODY = options({ melodyOnly: true })
const FIT = options({ fitToPiano: true })

/** Makes any later change to `value`, however deep, throw. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
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

function endOf(played: SongNote): number {
  return played.time + played.duration
}

describe('DEFAULT_ARRANGE_OPTIONS', () => {
  it('is the one from song.ts: every part, all the notes, where they are', () => {
    expect(DEFAULT_ARRANGE_OPTIONS).toBe(SONG_DEFAULT_ARRANGE_OPTIONS)
    expect(DEFAULT_ARRANGE_OPTIONS).toEqual({
      trackIds: 'auto',
      melodyOnly: false,
      fitToPiano: false,
    })
  })
})

describe('selectedTracks', () => {
  const right = track(0, [note(72, 0)], { name: 'Right hand' })
  const drums = track(1, [note(36, 0)], { name: 'Drums', isPercussion: true })
  const left = track(4, [note(48, 0)], { name: 'Left hand' })
  const song = songOf(right, drums, left)

  it("gives every part that is not percussion for 'auto', in the song's order", () => {
    expect(selectedTracks(song, options())).toEqual([right, left])
  })

  it('gives only the listed parts', () => {
    expect(selectedTracks(song, options({ trackIds: [4] }))).toEqual([left])
    expect(selectedTracks(song, options({ trackIds: [4, 0] }))).toEqual([right, left])
  })

  it('never includes percussion, even when it is listed', () => {
    expect(selectedTracks(song, options({ trackIds: [1] }))).toEqual([])
    expect(selectedTracks(song, options({ trackIds: [0, 1, 4] }))).toEqual([right, left])
  })

  it('ignores ids of parts the song does not have, and ids listed twice', () => {
    expect(selectedTracks(song, options({ trackIds: [0, 7, -1, 0] }))).toEqual([right])
  })

  it('gives nothing for an empty list', () => {
    expect(selectedTracks(song, options({ trackIds: [] }))).toEqual([])
  })

  it('gives the parts of the song themselves, not copies', () => {
    expect(selectedTracks(song, options())[0]).toBe(right)
  })
})

describe('bestBaseOctave', () => {
  /** How many of the notes the keys can play with the keyboard zone at `baseOctave`. */
  function playable(
    notes: readonly { midi: number }[],
    baseOctave: number,
    slots?: ReadonlySet<number>,
  ): number {
    return notes.filter(({ midi }) => {
      const slot = midiToSlot(midi, baseOctave)
      return slot !== null && (slots === undefined || slots.has(slot))
    }).length
  }

  /** The slots of the default "Home row" keys. */
  const HOME_ROW_SLOTS = new Set(Array.from({ length: 18 }, (_, index) => 12 + index))

  it('is the default for no notes', () => {
    expect(bestBaseOctave([])).toBe(DEFAULT_BASE_OCTAVE)
    expect(bestBaseOctave([], HOME_ROW_SLOTS)).toBe(DEFAULT_BASE_OCTAVE)
  })

  it('needs nothing of a note but its pitch', () => {
    expect(bestBaseOctave([{ midi: 24 }, { midi: 30 }])).toBe(1)
  })

  it('goes where most of the notes are', () => {
    const low = [24, 26, 28, 31, 35].map((midi) => note(midi, 0))
    const high = [100, 103, 105, 108].map((midi) => note(midi, 0))

    expect(bestBaseOctave(low)).toBe(1)
    expect(bestBaseOctave(high)).toBe(5)
    expect(bestBaseOctave([...low, ...high])).toBe(1)
    expect(bestBaseOctave([...low.slice(0, 3), ...high])).toBe(5)
  })

  it('stays at the default when the default shows as much as any other place', () => {
    // C4..F5 fits in the zone that starts at C3 and in the one that starts at C4.
    const tuneNotes = [60, 62, 64, 65, 67, 69, 71, 72, 77].map((midi) => note(midi, 0))
    expect(playable(tuneNotes, 2)).toBe(tuneNotes.length - 1)
    expect(playable(tuneNotes, 3)).toBe(tuneNotes.length)
    expect(playable(tuneNotes, 4)).toBe(tuneNotes.length)
    expect(bestBaseOctave(tuneNotes)).toBe(DEFAULT_BASE_OCTAVE)
  })

  it('of equally good places takes the one nearest the default', () => {
    // C2 can be played from the zones starting at C1 and C2, C8 only from the one starting at C5.
    expect(bestBaseOctave([note(36, 0), note(108, 0)])).toBe(2)
  })

  it('of equally good places equally near the default takes the lower one', () => {
    // C2: zones starting at C1 and C2. C7: zones starting at C4 and C5.
    expect(bestBaseOctave([note(36, 0), note(96, 0)])).toBe(2)
    expect(bestBaseOctave([note(96, 0), note(36, 0)])).toBe(2)
  })

  it('counts only the notes that have a key when it is told which slots have one', () => {
    const lowOctave = [48, 50, 52, 53, 55, 57, 59].map((midi) => note(midi, 0))

    // Any zone that shows C3..B3 will do when every slot counts: the default wins the tie.
    expect(bestBaseOctave(lowOctave)).toBe(DEFAULT_BASE_OCTAVE)
    // With the Home row keys those notes have keys only when the zone starts at C2.
    expect(bestBaseOctave(lowOctave, HOME_ROW_SLOTS)).toBe(2)
  })

  it('leaves the zone where it is for a tune made for the default keys', () => {
    const starterRange = [60, 62, 64, 65, 67, 69, 71, 72, 74, 75, 76, 77]
    expect(bestBaseOctave(starterRange.map((midi) => note(midi, 0)), HOME_ROW_SLOTS)).toBe(
      DEFAULT_BASE_OCTAVE,
    )
  })

  it('is the default when no key can play anything', () => {
    expect(bestBaseOctave([note(24, 0), note(25, 0)], new Set())).toBe(DEFAULT_BASE_OCTAVE)
  })

  it('on random notes: no other place is better, and ties go to the nearest, then the lower', () => {
    const random = createRandom(2024)
    for (let round = 0; round < 400; round += 1) {
      const centre = 21 + whole(random, 88)
      const notes = Array.from({ length: whole(random, 40) }, () => ({
        midi: Math.min(108, Math.max(21, centre + whole(random, 50) - 25)),
      }))
      const slots =
        random() < 0.5
          ? undefined
          : new Set(Array.from({ length: whole(random, 30) }, () => whole(random, SLOT_COUNT)))

      const best = bestBaseOctave(notes, slots)

      expect(Number.isInteger(best)).toBe(true)
      expect(best).toBeGreaterThanOrEqual(MIN_BASE_OCTAVE)
      expect(best).toBeLessThanOrEqual(MAX_BASE_OCTAVE)
      for (let other = MIN_BASE_OCTAVE; other <= MAX_BASE_OCTAVE; other += 1) {
        const lead = playable(notes, best, slots) - playable(notes, other, slots)
        expect(lead).toBeGreaterThanOrEqual(0)
        if (lead > 0 || other === best) continue
        const nearer = Math.abs(best - DEFAULT_BASE_OCTAVE) - Math.abs(other - DEFAULT_BASE_OCTAVE)
        expect(nearer).toBeLessThanOrEqual(0)
        if (nearer === 0) expect(best).toBeLessThan(other)
      }
    }
  })
})

describe('arrange', () => {
  describe('step 1: the notes of the selected parts', () => {
    it('merges the parts into one list, sorted by time, then by pitch', () => {
      const song = songOf(
        track(0, [note(60, 0), note(64, 1)]),
        track(1, [note(48, 0), note(52, 0.5)]),
      )

      expect(arrange(song, options(), FULL_PIANO).notes).toEqual([
        note(48, 0),
        note(60, 0),
        note(52, 0.5),
        note(64, 1),
      ])
    })

    it('leaves out percussion and the parts that are not chosen', () => {
      const song = songOf(
        track(0, [note(60, 0)]),
        track(1, [note(36, 0)], { isPercussion: true }),
        track(2, [note(72, 0)]),
      )

      expect(arrange(song, options(), FULL_PIANO).notes).toEqual([note(60, 0), note(72, 0)])
      expect(arrange(song, options({ trackIds: [2, 1] }), FULL_PIANO).notes).toEqual([
        note(72, 0),
      ])
    })

    it('gives an empty arrangement when no part is selected', () => {
      const empty = { notes: [], duration: 0, offPianoCount: 0 }

      expect(arrange(tune(note(60, 0)), options({ trackIds: [] }), FULL_PIANO)).toEqual(empty)
      expect(arrange(tune(note(60, 0)), options({ trackIds: [9] }), FULL_PIANO)).toEqual(empty)
      expect(arrange(songOf(), options(), FULL_PIANO)).toEqual(empty)
      expect(arrange(songOf(track(0, [])), options(), FULL_PIANO)).toEqual(empty)
    })

    it('keeps how hard each note is played', () => {
      const song = tune(note(60, 0, 0.5, 0.2), note(62, 1, 0.5, 1))
      expect(arrange(song, options(), FULL_PIANO).notes.map((each) => each.velocity)).toEqual([
        0.2, 1,
      ])
    })
  })

  describe('step 2: melody only', () => {
    it('keeps only the highest note of a chord', () => {
      const song = tune(note(60, 0), note(64, 0), note(67, 0), note(55, 1), note(59, 1))
      expect(arrange(song, MELODY, FULL_PIANO).notes).toEqual([note(67, 0), note(59, 1)])
    })

    it('treats notes that start within 30 ms of each other as one chord', () => {
      const song = tune(note(60, 0), note(72, 0.02), note(64, 0.03), note(55, 2), note(50, 2.05))
      const { notes } = arrange(song, MELODY, FULL_PIANO)

      expect(notes.map((each) => [each.midi, each.time])).toEqual([
        [72, 0.02],
        [55, 2],
        [50, 2.05],
      ])
      expect(notes[1]?.duration).toBeCloseTo(0.05, 9)
    })

    it('measures the 30 ms from the first note of the chord, so a run of quick notes is not one chord', () => {
      const song = tune(note(72, 0), note(70, 0.02), note(60, 0.04), note(58, 0.06))
      const { notes } = arrange(song, MELODY, FULL_PIANO)

      expect(notes.map((each) => [each.midi, each.time])).toEqual([
        [72, 0],
        [60, 0.04],
      ])
    })

    it('cuts each note short where the next one starts', () => {
      const song = tune(note(60, 0, 2), note(62, 0.5, 2), note(64, 1.25, 2))
      expect(arrange(song, MELODY, FULL_PIANO).notes).toEqual([
        note(60, 0, 0.5),
        note(62, 0.5, 0.75),
        note(64, 1.25, 2),
      ])
    })

    it('leaves a note alone when it is over before the next one starts', () => {
      const song = tune(note(60, 0, 0.2), note(62, 1, 0.2))
      expect(arrange(song, MELODY, FULL_PIANO).notes).toEqual([note(60, 0, 0.2), note(62, 1, 0.2)])
    })

    it('keeps the longer one when the highest note of a chord is there twice', () => {
      const song = songOf(track(0, [note(60, 0, 0.2)]), track(1, [note(60, 0.01, 0.9)]))
      expect(arrange(song, MELODY, FULL_PIANO).notes).toEqual([note(60, 0.01, 0.9)])
    })

    it('takes the melody from all the selected parts together', () => {
      const song = songOf(
        track(0, [note(72, 0, 1), note(74, 1, 1)]),
        track(1, [note(48, 0, 2), note(52, 0.5, 0.25)]),
      )

      expect(arrange(song, MELODY, FULL_PIANO).notes).toEqual([
        note(72, 0, 0.5),
        note(52, 0.5, 0.25),
        note(74, 1, 1),
      ])
      expect(arrange(song, options({ melodyOnly: true, trackIds: [0] }), FULL_PIANO).notes).toEqual(
        [note(72, 0, 1), note(74, 1, 1)],
      )
    })

    it('drops a note that the cut leaves shorter than a millisecond', () => {
      // 72 is the top of the first chord and starts last in it; the next chord starts 0.5 ms later.
      const song = tune(note(60, 0, 1), note(72, 0.03, 1), note(64, 0.0305, 1))
      expect(arrange(song, MELODY, FULL_PIANO).notes).toEqual([note(64, 0.0305, 1)])
    })
  })

  describe('step 3: fit to the piano', () => {
    /** One note per second, so that no two of them can get in each other's way. */
    function oneAfterAnother(midis: readonly number[]): Song {
      return tune(...midis.map((midi, index) => note(midi, index)))
    }

    function fitted(midis: readonly number[], range: PianoRange): number[] {
      return arrange(oneAfterAnother(midis), FIT, range).notes.map((each) => each.midi)
    }

    it('moves a note that is too low up by whole octaves, as little as possible', () => {
      expect(SMALL_PIANO).toEqual({ first: 48, last: 84 })
      expect(fitted([47, 37, 36, 35, 24, 21], SMALL_PIANO)).toEqual([59, 49, 48, 59, 48, 57])
    })

    it('moves a note that is too high down by whole octaves, as little as possible', () => {
      expect(fitted([85, 95, 96, 97, 108], SMALL_PIANO)).toEqual([73, 83, 84, 73, 84])
    })

    it('leaves the notes that are on the piano where they are', () => {
      expect(fitted([48, 49, 60, 83, 84], SMALL_PIANO)).toEqual([48, 49, 60, 83, 84])
      expect(fitted([21, 60, 108], FULL_PIANO)).toEqual([21, 60, 108])
    })

    it('fits to the piano it is given, wherever that is', () => {
      const high = pianoRange(37, MAX_BASE_OCTAVE)
      expect(high).toEqual({ first: 72, last: 108 })
      expect(fitted([21, 60, 71, 72, 108], high)).toEqual([81, 72, 83, 72, 108])

      const wide = pianoRange(61, DEFAULT_BASE_OCTAVE)
      expect(wide).toEqual({ first: 36, last: 96 })
      expect(fitted([21, 35, 36, 96, 97, 108], wide)).toEqual([45, 47, 36, 96, 85, 96])
    })

    it('reports no note off the piano', () => {
      const arrangement = arrange(oneAfterAnother([21, 47, 60, 85, 108]), FIT, SMALL_PIANO)
      expect(arrangement.offPianoCount).toBe(0)
    })

    it('changes nothing but the pitch', () => {
      const song = tune(note(30, 0.25, 0.75, 0.3))
      expect(arrange(song, FIT, SMALL_PIANO).notes).toEqual([note(54, 0.25, 0.75, 0.3)])
    })

    it('is not done unless asked for: the notes stay, and are counted', () => {
      const song = oneAfterAnother([21, 47, 48, 60, 84, 85, 108])
      const arrangement = arrange(song, options(), SMALL_PIANO)

      expect(arrangement.notes.map((each) => each.midi)).toEqual([21, 47, 48, 60, 84, 85, 108])
      expect(arrangement.offPianoCount).toBe(4)
      expect(arrange(song, options(), FULL_PIANO).offPianoCount).toBe(0)
    })

    it('is done after the melody is chosen: the highest note is picked where the song has it', () => {
      // 85 is the highest note and stays the melody, although it lands below 80 once fitted.
      const song = tune(note(80, 0), note(85, 0))
      expect(arrange(song, { ...MELODY, fitToPiano: true }, SMALL_PIANO).notes).toEqual([
        note(73, 0),
      ])
    })
  })

  describe('step 4: one pitch never sounds twice at once', () => {
    it('keeps the longest of several notes of one pitch that start together', () => {
      const song = songOf(
        track(0, [note(60, 0, 0.5, 0.4)]),
        track(1, [note(60, 0.0005, 2, 0.9)]),
        track(2, [note(60, 0.001, 1, 0.6)]),
      )
      expect(arrange(song, options(), FULL_PIANO).notes).toEqual([note(60, 0.0005, 2, 0.9)])
    })

    it('keeps the first of them when they are equally long', () => {
      const song = songOf(track(0, [note(60, 0, 1, 0.4)]), track(1, [note(60, 0, 1, 0.9)]))
      expect(arrange(song, options(), FULL_PIANO).notes).toEqual([note(60, 0, 1, 0.4)])
    })

    it('cuts a note that is still sounding when the same pitch starts again', () => {
      const song = tune(note(60, 0, 2), note(60, 1, 1), note(60, 1.5, 0.25))
      expect(arrange(song, options(), FULL_PIANO).notes).toEqual([
        note(60, 0, 1),
        note(60, 1, 0.5),
        note(60, 1.5, 0.25),
      ])
    })

    it('treats notes more than a millisecond apart as two presses', () => {
      const song = tune(note(60, 0, 1), note(60, 0.0008, 0.5), note(60, 0.0016, 3))
      expect(arrange(song, options(), FULL_PIANO).notes).toEqual([
        note(60, 0, 0.0016),
        note(60, 0.0016, 3),
      ])
    })

    it('leaves notes of one pitch alone when they do not overlap', () => {
      const notes = [note(60, 0, 0.5), note(60, 0.5, 0.5), note(60, 2, 0.5)]
      expect(arrange(tune(...notes), options(), FULL_PIANO).notes).toEqual(notes)
    })

    it('lets different pitches overlap as much as they like', () => {
      const notes = [note(60, 0, 3), note(62, 1, 3), note(72, 1, 3), note(64, 2, 3)]
      expect(arrange(tune(...notes), options(), FULL_PIANO).notes).toEqual(notes)
    })

    it('also cleans up what fitting to the piano brought onto one key', () => {
      // C2 and C3 are both C3 on the small piano.
      const song = tune(note(36, 0, 2), note(48, 1, 2), note(36, 5, 1), note(48, 5, 3))
      expect(arrange(song, FIT, SMALL_PIANO).notes).toEqual([
        note(48, 0, 1),
        note(48, 1, 2),
        note(48, 5, 3),
      ])
    })

    it('never leaves a note a hair too long, where plain subtraction would', () => {
      // 0.679 + (3.275 - 0.679) is a little more than 3.275 in floating point.
      expect(0.679 + (3.275 - 0.679)).toBeGreaterThan(3.275)

      const samePitch = arrange(tune(note(60, 0.679, 5), note(60, 3.275, 1)), options(), FULL_PIANO)
      const [first, second] = samePitch.notes
      expect(endOf(first as PlayableNote)).toBeLessThanOrEqual((second as PlayableNote).time)
      expect(first?.duration).toBeCloseTo(2.596, 12)

      const melody = arrange(tune(note(60, 0.679, 5), note(62, 3.275, 1)), MELODY, FULL_PIANO)
      expect(endOf(melody.notes[0] as PlayableNote)).toBeLessThanOrEqual(3.275)
      expect(melody.notes[0]?.duration).toBeCloseTo(2.596, 12)
    })
  })

  describe('step 5: the result', () => {
    it('drops notes shorter than a millisecond', () => {
      const song = tune(note(60, 0, 0.0005), note(62, 1, 0.001), note(64, 2, 0.5))
      expect(arrange(song, options(), FULL_PIANO).notes).toEqual([
        note(62, 1, 0.001),
        note(64, 2, 0.5),
      ])
    })

    it('lasts until its last note ends, which is not always the note that starts last', () => {
      expect(arrange(tune(note(60, 0, 5), note(62, 1, 1)), options(), FULL_PIANO).duration).toBe(5)
      expect(arrange(tune(note(60, 0, 1), note(62, 2, 1.5)), options(), FULL_PIANO).duration).toBe(
        3.5,
      )
    })

    it('measures its length after the cuts', () => {
      expect(arrange(tune(note(60, 0, 9), note(62, 1, 1)), MELODY, FULL_PIANO).duration).toBe(2)
    })

    it('is sorted by time, then by pitch, also after notes were moved', () => {
      const song = tune(note(30, 0), note(50, 0), note(100, 0), note(60, 0))
      expect(arrange(song, FIT, SMALL_PIANO).notes.map((each) => each.midi)).toEqual([
        50, 54, 60, 76,
      ])
    })
  })

  describe('what it never does', () => {
    const song = deepFreeze(
      songOf(
        track(0, [note(60, 0, 2), note(60, 1, 2), note(30, 1, 1), note(64, 1.01, 1)]),
        track(1, [note(100, 0, 4), note(60, 0.0004, 3)]),
        track(2, [note(36, 0, 1)], { isPercussion: true }),
      ),
    )
    const everyChoice = [false, true].flatMap((melodyOnly) =>
      [false, true].flatMap((fitToPiano) => [
        deepFreeze<ArrangeOptions>({ trackIds: 'auto', melodyOnly, fitToPiano }),
        deepFreeze<ArrangeOptions>({ trackIds: [1, 0], melodyOnly, fitToPiano }),
      ]),
    )

    it('never changes the song or the options, which may be frozen', () => {
      const before = JSON.stringify(song)

      for (const choice of everyChoice) {
        expect(() => arrange(song, choice, SMALL_PIANO)).not.toThrow()
      }
      expect(JSON.stringify(song)).toBe(before)
    })

    it("never hands out the song's own note objects", () => {
      const own = new Set<unknown>(song.tracks.flatMap((part) => part.notes))

      for (const choice of everyChoice) {
        for (const played of arrange(song, choice, SMALL_PIANO).notes) {
          expect(own.has(played)).toBe(false)
        }
      }
    })

    it('never gives two different answers for the same question', () => {
      const twin: Song = JSON.parse(JSON.stringify(song)) as Song

      for (const choice of everyChoice) {
        const first = arrange(song, choice, SMALL_PIANO)
        expect(arrange(song, choice, SMALL_PIANO)).toEqual(first)
        expect(arrange(twin, { ...choice }, { ...SMALL_PIANO })).toEqual(first)
      }
    })
  })

  describe('on random songs', () => {
    /** Mostly on a coarse grid, with small offsets: chords, near-ties and overlaps are common. */
    function randomTime(random: () => number): number {
      const onGrid = whole(random, 24) * 0.25
      const offsets = [0, 0, 0, 0.0004, 0.0009, 0.0011, 0.01, 0.029, 0.031, random() * 0.25]
      return random() < 0.15 ? random() * 6 : onGrid + pick(random, offsets)
    }

    function randomNotes(random: () => number): SongNote[] {
      const lowest = 21 + whole(random, 70)
      const spread = 1 + whole(random, 108 - lowest)
      return Array.from({ length: whole(random, 50) }, () =>
        note(
          lowest + whole(random, spread),
          randomTime(random),
          pick(random, [0.0005, 0.002, 0.03, 0.25, 0.5, 1, 4, random() * 2]),
          0.05 + random() * 0.95,
        ),
      )
    }

    function randomSong(random: () => number): Song {
      const parts = Array.from({ length: 1 + whole(random, 4) }, (_, index) =>
        track(index * 2, randomNotes(random), { isPercussion: random() < 0.2 }),
      )
      return deepFreeze(songOf(...parts))
    }

    function randomOptions(random: () => number): ArrangeOptions {
      const someIds = Array.from({ length: whole(random, 5) }, () => whole(random, 9))
      return deepFreeze<ArrangeOptions>({
        trackIds: random() < 0.5 ? 'auto' : someIds,
        melodyOnly: random() < 0.5,
        fitToPiano: random() < 0.5,
      })
    }

    function randomRange(random: () => number): PianoRange {
      return pianoRange(pick(random, PIANO_SIZES), MIN_BASE_OCTAVE + whole(random, 5))
    }

    /**
     * True when `played` can have come from `source`: same moment, same
     * strength, and the same key or, when fitted, the nearest one of that name.
     */
    function comesFrom(
      played: PlayableNote,
      source: SongNote,
      fitToPiano: boolean,
      range: PianoRange,
    ): boolean {
      if (played.time !== source.time || played.velocity !== source.velocity) return false
      if (played.duration > source.duration) return false
      if (!fitToPiano || isInRange(source.midi, range)) return played.midi === source.midi
      const sameName = (played.midi - source.midi) % 12 === 0
      const nearEdge =
        source.midi < range.first ? played.midi - range.first < 12 : range.last - played.midi < 12
      return sameName && nearEdge
    }

    /** Everything that is wrong with an arrangement, in words. Empty when all is well. */
    function problemsOf(
      song: Song,
      choice: ArrangeOptions,
      range: PianoRange,
      arrangement: Arrangement,
    ): string[] {
      const problems: string[] = []
      const { notes } = arrangement
      const sources = selectedTracks(song, choice).flatMap((part) => part.notes)
      const endOfPitch = new Map<number, number>()
      /** True when no selected note that starts at the very same moment is higher. */
      const isTopOfItsMoment = (source: SongNote): boolean =>
        !sources.some((other) => other.time === source.time && other.midi > source.midi)

      notes.forEach((played, index) => {
        const label = `note ${index} (${played.midi} at ${played.time})`
        const previous = notes[index - 1]

        if (previous !== undefined) {
          const inOrder =
            previous.time < played.time ||
            (previous.time === played.time && previous.midi < played.midi)
          if (!inOrder) problems.push(`${label} is out of order`)
          if (choice.melodyOnly && endOf(previous) > played.time) {
            problems.push(`${label} starts while the note before it still sounds`)
          }
        }
        if ((endOfPitch.get(played.midi) ?? 0) > played.time) {
          problems.push(`${label} starts while its own pitch still sounds`)
        }
        endOfPitch.set(played.midi, endOf(played))

        if (!(played.duration >= 0.001)) problems.push(`${label} is shorter than a millisecond`)
        if (choice.fitToPiano && !isInRange(played.midi, range)) {
          problems.push(`${label} is off the piano`)
        }
        const origins = sources.filter((source) =>
          comesFrom(played, source, choice.fitToPiano, range),
        )
        if (origins.length === 0) problems.push(`${label} is not a note of the selected parts`)
        if (choice.melodyOnly && origins.length > 0 && !origins.some(isTopOfItsMoment)) {
          problems.push(`${label} is not the highest note of its chord`)
        }
      })

      const offPiano = notes.filter((played) => !isInRange(played.midi, range)).length
      if (arrangement.offPianoCount !== offPiano) {
        problems.push(`offPianoCount is ${arrangement.offPianoCount}, not ${offPiano}`)
      }
      if (choice.fitToPiano && arrangement.offPianoCount !== 0) {
        problems.push('offPianoCount is not 0 with fitToPiano')
      }
      const end = Math.max(0, ...notes.map(endOf))
      if (arrangement.duration !== end) {
        problems.push(`duration is ${arrangement.duration}, not ${end}`)
      }
      return problems
    }

    it('keeps every promise of an arrangement, whatever the song, the options and the piano', () => {
      const random = createRandom(7)
      let notesChecked = 0

      for (let round = 0; round < 1500; round += 1) {
        const song = randomSong(random)
        const choice = randomOptions(random)
        const range = randomRange(random)
        const before = JSON.stringify(song)

        const arrangement = arrange(song, choice, range)

        expect(problemsOf(song, choice, range, arrangement), `round ${round}`).toEqual([])
        expect(JSON.stringify(song)).toBe(before)
        expect(arrange(song, choice, range)).toEqual(arrangement)
        notesChecked += arrangement.notes.length
      }
      // The songs must not all have been empty: that would prove nothing.
      expect(notesChecked).toBeGreaterThan(20_000)
    })

    it('loses no pitch when nothing is taken away: the last note of each pitch is always played', () => {
      const random = createRandom(11)

      for (let round = 0; round < 300; round += 1) {
        const song = randomSong(random)
        const sources = selectedTracks(song, options())
          .flatMap((part) => part.notes)
          .sort(byTimeThenMidi)
        const lastOfPitch = new Map(sources.map((each) => [each.midi, each]))
        const expected = [...lastOfPitch.values()].filter((each) => each.duration >= 0.001)

        const { notes } = arrange(song, options(), FULL_PIANO)

        const played = new Set(notes.map((each) => each.midi))
        expect(expected.filter((each) => !played.has(each.midi))).toEqual([])
        expect(notes.length).toBeLessThanOrEqual(sources.length)
      }
    })

    it('changes nothing in a song whose notes never touch', () => {
      const random = createRandom(13)

      for (let round = 0; round < 100; round += 1) {
        // One note every half second, each over before the next: nothing to merge, cut or drop.
        const notes = Array.from({ length: 1 + whole(random, 40) }, (_, index) =>
          note(21 + whole(random, 88), index * 0.5, 0.05 + random() * 0.4, 0.1 + random() * 0.9),
        )

        for (const melodyOnly of [false, true]) {
          const arrangement = arrange(tune(...notes), options({ melodyOnly }), FULL_PIANO)
          expect(arrangement.notes).toEqual(notes)
          expect(arrangement.offPianoCount).toBe(0)
        }
      }
    })
  })
})
