/**
 * Arranging, checked from the outside: what must hold for any song whatever
 * the options (order, no pitch sounding twice at once, one note at a time
 * for a melody, nothing off the piano when fitting, lengths above zero), the
 * choice of parts, songs with nothing to play, and where the computer keys
 * are put for a song.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_OCTAVE,
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  PIANO_SIZES,
  pianoRange,
} from '../core/layout'
import type { PianoRange } from '../core/layout'
import { midiOfC } from '../core/notes'
import { DEFAULT_BINDINGS, KEY_PRESETS } from '../input/keymap'
import { DEFAULT_ARRANGE_OPTIONS, arrange, bestBaseOctave, selectedTracks } from './arrange'
import type { ArrangeOptions, Arrangement } from './arrange'
import type { Song, SongNote, SongTrack } from './song'

const FULL_PIANO: PianoRange = { first: 21, last: 108 }
/** The piano of the smallest size at the place it starts in: C3 to C6. */
const SMALL_PIANO: PianoRange = pianoRange(37, DEFAULT_BASE_OCTAVE)

function note(midi: number, time: number, duration: number, velocity = 0.8): SongNote {
  return { midi, time, duration, velocity }
}

function part(id: number, notes: readonly SongNote[], isPercussion = false): SongTrack {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi)
  return { id, name: '', isPercussion, program: isPercussion ? null : 0, notes: sorted }
}

function songOf(...tracks: SongTrack[]): Song {
  let duration = 0
  for (const track of tracks) {
    for (const each of track.notes) duration = Math.max(duration, each.time + each.duration)
  }
  return { id: 'song', title: 'A song', duration, tracks, createdAt: 0 }
}

function options(patch: Partial<ArrangeOptions> = {}): ArrangeOptions {
  return { ...DEFAULT_ARRANGE_OPTIONS, ...patch }
}

function shape(arrangement: Arrangement): number[][] {
  const round = (seconds: number): number => Math.round(seconds * 1e6) / 1e6
  return arrangement.notes.map((each) => [each.midi, round(each.time), round(each.duration)])
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

/**
 * A song as awkward as real ones get: chords, rolled chords a few
 * milliseconds apart, the same pitch in two parts at once, notes that last
 * 30 ms and notes that last a minute, pitches at both ends of the piano,
 * times as whole milliseconds (a saved song) or as they come (a fresh import).
 */
function awkwardSong(random: () => number): Song {
  const wholeMilliseconds = random() < 0.5
  const tidy = (seconds: number): number =>
    wholeMilliseconds ? Math.round(seconds * 1000) / 1000 : seconds
  const partCount = 1 + Math.floor(random() * 4)
  const tracks: SongTrack[] = []
  for (let id = 0; id < partCount; id++) {
    const notes: SongNote[] = []
    let time = random() * 2
    const count = Math.floor(random() * 80)
    const centre = 30 + Math.floor(random() * 60)
    for (let index = 0; index < count; index++) {
      const roll = random()
      // Same moment, a few milliseconds later, just past the chord window, or later.
      if (roll < 0.25) time += 0
      else if (roll < 0.4) time += random() * 0.004
      else if (roll < 0.55) time += 0.028 + random() * 0.004
      else time += random() * 0.7
      const midi = Math.min(108, Math.max(21, centre + Math.floor((random() - 0.5) * 50)))
      const kind = random()
      const length = kind < 0.1 ? 0.03 : kind < 0.2 ? 10 + random() * 50 : 0.05 + random() * 1.5
      notes.push(note(midi, tidy(time), Math.max(tidy(length), 0.001), 0.1 + random() * 0.9))
    }
    tracks.push(part(id * 3, notes, random() < 0.15))
  }
  return songOf(...tracks)
}

function randomOptions(random: () => number, song: Song): ArrangeOptions {
  const ids = song.tracks.map((track) => track.id)
  const roll = random()
  const trackIds: ArrangeOptions['trackIds'] =
    roll < 0.5 ? 'auto' : roll < 0.9 ? ids.filter(() => random() < 0.6) : [...ids, 999, -1]
  return { trackIds, melodyOnly: random() < 0.5, fitToPiano: random() < 0.5 }
}

function randomRange(random: () => number): PianoRange {
  const size = PIANO_SIZES[Math.floor(random() * PIANO_SIZES.length)] ?? 88
  const octave = MIN_BASE_OCTAVE + Math.floor(random() * (MAX_BASE_OCTAVE - MIN_BASE_OCTAVE + 1))
  return pianoRange(size, octave)
}

describe('what holds for any song, any options and any piano', () => {
  it('holds for 2,000 awkward songs', { timeout: 60_000 }, () => {
    const random = seededRandom(4_242)
    let checked = 0
    let melodies = 0
    let fitted = 0

    for (let round = 0; round < 2000; round++) {
      const song = awkwardSong(random)
      const chosen = randomOptions(random, song)
      const range = randomRange(random)
      const songBefore = JSON.stringify(song)
      const result = arrange(song, chosen, range)
      const sources = selectedTracks(song, chosen).flatMap((track) => track.notes)

      // Everything that is wrong with this arrangement: nothing, for a sound one.
      const problems: string[] = []
      const check = (fine: boolean, problem: string): void => {
        if (!fine) problems.push(problem)
      }

      // The song is the same song afterwards, and the same question has the same answer.
      check(JSON.stringify(song) === songBefore, 'the song was changed')
      check(
        JSON.stringify(arrange(song, chosen, range)) === JSON.stringify(result),
        'a second answer differs from the first',
      )
      check(result.notes.length <= sources.length, 'more notes than the song has')
      check(
        chosen.melodyOnly || sources.length === 0 || result.notes.length > 0,
        'nothing left of a song that has notes',
      )

      // The longest source note of each pitch at each start, to find where a played note came from.
      const written = new Map<string, number>()
      for (const given of sources) {
        const key = `${given.midi}@${given.time}`
        written.set(key, Math.max(written.get(key) ?? 0, given.duration))
      }

      let end = 0
      let off = 0
      const lastEndOfPitch = new Map<number, number>()
      let before: SongNote | undefined
      result.notes.forEach((each, index) => {
        const what = `note ${index}`
        // In order, with a length above zero, a pitch of the piano and a usable force.
        check(
          before === undefined ||
            each.time > before.time ||
            (each.time === before.time && each.midi >= before.midi),
          `${what} is out of order`,
        )
        check(each.duration >= 0.001, `${what} lasts ${each.duration}`)
        check(
          Number.isFinite(each.time + each.duration) && each.time >= 0,
          `${what} has no usable time`,
        )
        check(Number.isInteger(each.midi) && each.midi >= 21 && each.midi <= 108, `${what}: pitch`)
        check(each.velocity > 0 && each.velocity <= 1, `${what}: force ${each.velocity}`)

        // The same pitch never sounds twice at once: the note bus would lose the second press.
        const samePitchEnds = lastEndOfPitch.get(each.midi)
        check(
          samePitchEnds === undefined || each.time >= samePitchEnds,
          `${what} overlaps its own pitch`,
        )
        lastEndOfPitch.set(each.midi, each.time + each.duration)

        // One note at a time for a melody.
        check(
          !chosen.melodyOnly || before === undefined || each.time >= before.time + before.duration,
          `${what} starts before the melody note before it is over`,
        )
        // A note starts where a note of the song starts, and is never longer than it was written.
        if (!chosen.fitToPiano) {
          const longest = written.get(`${each.midi}@${each.time}`)
          check(
            longest !== undefined && each.duration <= longest,
            `${what} is not a note of the song`,
          )
        }

        if (each.midi < range.first || each.midi > range.last) off += 1
        end = Math.max(end, each.time + each.duration)
        before = each
        checked += 1
      })
      check(result.duration === end, `length ${result.duration}, but the last note ends at ${end}`)
      check(
        result.offPianoCount === off,
        `${result.offPianoCount} counted off the piano, ${off} are`,
      )
      check(!chosen.fitToPiano || off === 0, `${off} notes off the piano after fitting`)
      // The song never becomes longer than it was.
      check(result.duration <= song.duration + 1e-9, 'longer than the song')
      expect(problems, `song ${round}, ${JSON.stringify(chosen)}`).toEqual([])

      if (chosen.fitToPiano) fitted += 1
      if (chosen.melodyOnly) melodies += 1
    }
    expect(checked).toBeGreaterThan(30_000)
    expect(melodies).toBeGreaterThan(500)
    expect(fitted).toBeGreaterThan(500)
  })

  it('moves a fitted note by whole octaves only, and no further than it has to', () => {
    const random = seededRandom(99)
    for (let round = 0; round < 300; round++) {
      const range = randomRange(random)
      // One note of every pitch, each alone at its own time, so that every one can be found again.
      const notes = Array.from({ length: 88 }, (_, index) => note(21 + index, index, 0.5))
      const result = arrange(songOf(part(0, notes)), options({ fitToPiano: true }), range)
      expect(result.notes).toHaveLength(88)
      result.notes.forEach((moved, index) => {
        const from = 21 + index
        expect((moved.midi - from) % 12 === 0, `pitch ${from}`).toBe(true)
        if (from >= range.first && from <= range.last) expect(moved.midi).toBe(from)
        else {
          expect(moved.midi >= range.first && moved.midi <= range.last).toBe(true)
          // The nearest place: one octave nearer the note would be off the piano again.
          const nearer = moved.midi + (from < range.first ? -12 : 12)
          expect(nearer < range.first || nearer > range.last, `pitch ${from}`).toBe(true)
        }
      })
    }
  })
})

describe('one note at a time', () => {
  it('keeps the top of each chord and cuts each note where the next one starts', () => {
    const song = songOf(
      part(0, [note(72, 0, 1), note(76, 1, 1), note(79, 2, 2)]),
      part(1, [note(48, 0, 4), note(55, 0.01, 4), note(60, 1.02, 0.5)]),
    )
    expect(shape(arrange(song, options({ melodyOnly: true }), FULL_PIANO))).toEqual([
      [72, 0, 1],
      [76, 1, 1],
      [79, 2, 2],
    ])
  })

  it('takes a low note that starts on its own for a melody note, as the rule says', () => {
    // The left hand moves under a held top note: each new start is a "chord" of one.
    const song = songOf(part(0, [note(84, 0, 4)]), part(1, [note(48, 1, 1), note(52, 2, 1)]))
    expect(shape(arrange(song, options({ melodyOnly: true }), FULL_PIANO))).toEqual([
      [84, 0, 1],
      [48, 1, 1],
      [52, 2, 1],
    ])
  })

  it('counts 30 ms from the first note of a chord, so a fast run is not one endless chord', () => {
    const run = Array.from({ length: 10 }, (_, index) => note(60 + index, index * 0.025, 0.02))
    const result = arrange(songOf(part(0, run)), options({ melodyOnly: true }), FULL_PIANO)
    // Notes 0-1 are one chord, 2-3 the next, and so on: the higher of each pair stays.
    expect(result.notes.map((each) => each.midi)).toEqual([61, 63, 65, 67, 69])
  })

  it('finds the melody first and fits it to the piano afterwards', () => {
    // On the small piano the high note comes down an octave; it is still the one that is kept.
    const song = songOf(part(0, [note(60, 0, 1), note(96, 0, 1)]))
    const result = arrange(song, options({ melodyOnly: true, fitToPiano: true }), SMALL_PIANO)
    expect(shape(result)).toEqual([[84, 0, 1]])
  })
})

describe('the same pitch twice', () => {
  it('ends a note where the same pitch starts again, and leaves other pitches alone', () => {
    const song = songOf(part(0, [note(60, 0, 2), note(64, 0, 2)]), part(1, [note(60, 1, 2)]))
    expect(shape(arrange(song, options(), FULL_PIANO))).toEqual([
      [60, 0, 1],
      [64, 0, 2],
      [60, 1, 2],
    ])
  })

  it('makes one note of a pitch that two parts play at the same moment: the longer one', () => {
    const song = songOf(part(0, [note(60, 0, 0.5, 0.3)]), part(1, [note(60, 0.0005, 2, 0.9)]))
    expect(arrange(song, options(), FULL_PIANO).notes).toEqual([note(60, 0.0005, 2, 0.9)])
  })

  it('cleans up after fitting too, when two octaves land on one key', () => {
    const song = songOf(part(0, [note(36, 0, 2), note(48, 1, 2)]))
    const result = arrange(song, options({ fitToPiano: true }), SMALL_PIANO)
    expect(shape(result)).toEqual([
      [48, 0, 1],
      [48, 1, 2],
    ])
  })

  it('drops what is left of a note that is cut to under a millisecond', () => {
    const song = songOf(part(0, [note(60, 0, 2)]), part(1, [note(60, 0.0015, 1)]))
    // 1.5 ms apart is two presses, and the first then lasts 1.5 ms: kept.
    // Any closer and what is left of the first is under a millisecond: dropped.
    expect(arrange(song, options(), FULL_PIANO).notes).toHaveLength(2)
    const closer = songOf(part(0, [note(60, 0, 2)]), part(1, [note(60, 0.00101, 0.5)]))
    const result = arrange(closer, options(), FULL_PIANO)
    expect(result.notes.every((each) => each.duration >= 0.001)).toBe(true)
  })
})

describe('the choice of parts', () => {
  const song = songOf(
    part(0, [note(60, 0, 1)]),
    part(5, [note(64, 0, 1)]),
    part(7, [note(36, 0, 1), note(38, 0.5, 1)], true),
    part(9, [note(67, 0, 1)]),
  )

  it('plays every part but the drums when left to itself', () => {
    expect(selectedTracks(song, options()).map((track) => track.id)).toEqual([0, 5, 9])
    expect(
      arrange(song, options(), FULL_PIANO).notes.map((each) => each.midi),
    ).toEqual([60, 64, 67])
  })

  it('plays the chosen parts, in the order of the song, whatever order they are named in', () => {
    expect(
      selectedTracks(song, options({ trackIds: [9, 0] })).map((track) => track.id),
    ).toEqual([0, 9])
  })

  it('never plays drums, even when they are asked for by number', () => {
    expect(selectedTracks(song, options({ trackIds: [7] }))).toEqual([])
    const result = arrange(song, options({ trackIds: [7, 5] }), FULL_PIANO)
    expect(result.notes.map((each) => each.midi)).toEqual([64])
  })

  it('plays nothing, without complaint, when no chosen part exists', () => {
    for (const trackIds of [[], [1, 2, 3], [Number.NaN], [-0.5]]) {
      expect(
        arrange(song, options({ trackIds }), FULL_PIANO),
      ).toEqual({ notes: [], duration: 0, offPianoCount: 0 })
    }
  })

  it('has nothing to play in a song that is all drums, or has no parts, or no notes', () => {
    const empty = { notes: [], duration: 0, offPianoCount: 0 }
    const drumsOnly = songOf(part(0, [note(36, 0, 1)], true), part(1, [note(38, 0, 1)], true))
    for (const each of [drumsOnly, songOf(), songOf(part(0, []))]) {
      for (const melodyOnly of [false, true]) {
        for (const fitToPiano of [false, true]) {
          expect(arrange(each, options({ melodyOnly, fitToPiano }), SMALL_PIANO)).toEqual(empty)
        }
      }
    }
  })

  it('counts the notes that are off the piano, and none once they are fitted', () => {
    const wide = songOf(
      part(
        0,
        [
          note(21, 0, 1), note(47, 1, 1), note(48, 2, 1), note(84, 3, 1), note(85, 4, 1),
          note(108, 5, 1),
        ],
      ),
    )
    expect(arrange(wide, options(), SMALL_PIANO).offPianoCount).toBe(4)
    expect(arrange(wide, options(), FULL_PIANO).offPianoCount).toBe(0)
    const fitted = arrange(wide, options({ fitToPiano: true }), SMALL_PIANO)
    expect(fitted.offPianoCount).toBe(0)
    expect(fitted.notes.map((each) => each.midi)).toEqual([57, 59, 48, 84, 73, 84])
  })
})

describe('where the computer keys go for a song', () => {
  const homeRow = new Set(Object.values(DEFAULT_BINDINGS))
  const at = (...midis: number[]): { midi: number }[] => midis.map((midi) => ({ midi }))

  it('stays where it is for no notes at all', () => {
    expect(bestBaseOctave([])).toBe(DEFAULT_BASE_OCTAVE)
    expect(bestBaseOctave([], homeRow)).toBe(DEFAULT_BASE_OCTAVE)
    expect(bestBaseOctave(at(60), new Set())).toBe(DEFAULT_BASE_OCTAVE)
  })

  it('puts the home row under a tune, wherever on the piano the tune is', () => {
    // The home row plays from the second C of the zone up to the F an octave and a half above.
    for (let octave = MIN_BASE_OCTAVE; octave <= MAX_BASE_OCTAVE; octave++) {
      const c = midiOfC(octave + 1)
      expect(
        bestBaseOctave(at(c, c + 4, c + 7, c + 12, c + 16), homeRow),
        `octave ${octave}`,
      ).toBe(octave)
    }
  })

  it('goes where most of the notes are when it cannot reach them all', () => {
    const mostlyLow = at(36, 38, 40, 41, 43, 45, 47, 48, 96)
    expect(bestBaseOctave(mostlyLow, homeRow)).toBe(1)
    const mostlyHigh = at(36, 91, 93, 95, 96, 98, 100)
    expect(bestBaseOctave(mostlyHigh, homeRow)).toBe(5)
  })

  it('prefers the usual place, then the lower one, when two places are as good', () => {
    // Middle C alone is on every row of keys at octaves 1 to 4 when every slot counts.
    expect(bestBaseOctave(at(60))).toBe(DEFAULT_BASE_OCTAVE)
    // A0 is below every place the keys can go: nothing to choose between them.
    expect(bestBaseOctave(at(21, 22, 23))).toBe(DEFAULT_BASE_OCTAVE)
    // C2 and C7 cannot both be reached: one each for octaves 1 and 4 or 5; the lower wins.
    expect(bestBaseOctave(at(36, 96))).toBe(2)
  })

  it('never answers with a place the keys cannot go', () => {
    const random = seededRandom(5)
    for (let round = 0; round < 500; round++) {
      const notes = Array.from(
        { length: Math.floor(random() * 30) },
        () => ({ midi: 21 + Math.floor(random() * 88) }),
      )
      for (const preset of KEY_PRESETS) {
        const slots = new Set(Object.values(preset.bindings))
        const best = bestBaseOctave(notes, slots)
        expect(
          Number.isInteger(best) && best >= MIN_BASE_OCTAVE && best <= MAX_BASE_OCTAVE,
        ).toBe(true)

        // No other place plays more of the notes.
        const playable = (octave: number): number => notes.filter(
          (each) => slots.has(each.midi - midiOfC(octave)),
        ).length
        for (let octave = MIN_BASE_OCTAVE; octave <= MAX_BASE_OCTAVE; octave++) {
          expect(
            playable(octave),
            `${preset.id}, round ${round}`,
          ).toBeLessThanOrEqual(playable(best))
        }
      }
    }
  })
})
