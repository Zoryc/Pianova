import { isValidMidi, midiOfC } from '../core/notes'
import type { Song, SongNote } from './song'

/** One built-in tune, as it is written down. */
export interface StarterTune {
  id: string
  title: string
  beatsPerMinute: number
  /** See `tuneToSong` for how a tune is written. */
  tune: string
}

const STARTER_PREFIX = 'starter:'

/** Exported for the unit test that checks the bars of every tune. */
export const STARTER_TUNES: readonly StarterTune[] = [
  {
    id: 'starter:twinkle-twinkle-little-star',
    title: 'Twinkle, Twinkle, Little Star',
    beatsPerMinute: 100,
    tune:
      'C4/1 C4/1 G4/1 G4/1 | A4/1 A4/1 G4/2 | F4/1 F4/1 E4/1 E4/1 | D4/1 D4/1 C4/2 | ' +
      'G4/1 G4/1 F4/1 F4/1 | E4/1 E4/1 D4/2 | G4/1 G4/1 F4/1 F4/1 | E4/1 E4/1 D4/2 | ' +
      'C4/1 C4/1 G4/1 G4/1 | A4/1 A4/1 G4/2 | F4/1 F4/1 E4/1 E4/1 | D4/1 D4/1 C4/2',
  },
  {
    id: 'starter:mary-had-a-little-lamb',
    title: 'Mary Had a Little Lamb',
    beatsPerMinute: 110,
    tune:
      'E4/1 D4/1 C4/1 D4/1 | E4/1 E4/1 E4/2 | D4/1 D4/1 D4/2 | E4/1 G4/1 G4/2 | ' +
      'E4/1 D4/1 C4/1 D4/1 | E4/1 E4/1 E4/1 E4/1 | D4/1 D4/1 E4/1 D4/1 | C4/4',
  },
  {
    id: 'starter:ode-to-joy',
    title: 'Ode to Joy',
    beatsPerMinute: 110,
    tune:
      'B4/1 B4/1 C5/1 D5/1 | D5/1 C5/1 B4/1 A4/1 | G4/1 G4/1 A4/1 B4/1 | B4/1.5 A4/.5 A4/2 | ' +
      'B4/1 B4/1 C5/1 D5/1 | D5/1 C5/1 B4/1 A4/1 | G4/1 G4/1 A4/1 B4/1 | A4/1.5 G4/.5 G4/2 | ' +
      'A4/1 A4/1 B4/1 G4/1 | A4/1 B4/.5 C5/.5 B4/1 G4/1 | A4/1 B4/.5 C5/.5 B4/1 A4/1 | ' +
      'G4/1 A4/1 D4/2 | ' +
      'B4/1 B4/1 C5/1 D5/1 | D5/1 C5/1 B4/1 A4/1 | G4/1 G4/1 A4/1 B4/1 | A4/1.5 G4/.5 G4/2',
  },
  {
    id: 'starter:frere-jacques',
    title: 'Frère Jacques',
    beatsPerMinute: 110,
    tune:
      'G4/1 A4/1 B4/1 G4/1 | G4/1 A4/1 B4/1 G4/1 | B4/1 C5/1 D5/2 | B4/1 C5/1 D5/2 | ' +
      'D5/.5 E5/.5 D5/.5 C5/.5 B4/1 G4/1 | D5/.5 E5/.5 D5/.5 C5/.5 B4/1 G4/1 | ' +
      'G4/1 D4/1 G4/2 | G4/1 D4/1 G4/2',
  },
  {
    id: 'starter:jingle-bells',
    title: 'Jingle Bells',
    beatsPerMinute: 120,
    tune:
      'E4/1 E4/1 E4/2 | E4/1 E4/1 E4/2 | E4/1 G4/1 C4/1.5 D4/.5 | E4/4 | ' +
      'F4/1 F4/1 F4/1.5 F4/.5 | F4/1 E4/1 E4/1 E4/.5 E4/.5 | E4/1 D4/1 D4/1 E4/1 | D4/2 G4/2 | ' +
      'E4/1 E4/1 E4/2 | E4/1 E4/1 E4/2 | E4/1 G4/1 C4/1.5 D4/.5 | E4/4 | ' +
      'F4/1 F4/1 F4/1.5 F4/.5 | F4/1 E4/1 E4/1 E4/.5 E4/.5 | G4/1 G4/1 F4/1 D4/1 | C4/4',
  },
  {
    id: 'starter:fur-elise',
    title: 'Für Elise (opening)',
    beatsPerMinute: 66,
    tune:
      'E5/.25 D#5/.25 | E5/.25 D#5/.25 E5/.25 B4/.25 D5/.25 C5/.25 | ' +
      'A4/.5 R/.25 C4/.25 E4/.25 A4/.25 | B4/.5 R/.25 E4/.25 G#4/.25 B4/.25 | ' +
      'C5/.5 R/.25 E4/.25 E5/.25 D#5/.25 | E5/.25 D#5/.25 E5/.25 B4/.25 D5/.25 C5/.25 | ' +
      'A4/.5 R/.25 C4/.25 E4/.25 A4/.25 | B4/.5 R/.25 E4/.25 C5/.25 B4/.25 | A4/1',
  },
]

/** "C4/1", "D#5/.25" or "R/.5": a note name (or R for a rest), a slash, a number of beats. */
const TOKEN = /^(?:([A-G])(#?)(\d)|R)\/(\d+(?:\.\d+)?|\.\d+)$/

/** Semitones above C of each letter. */
const SEMITONES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Each note sounds for this much of its length, so that repeated notes are heard separately. */
const SOUNDING_SHARE = 0.9
/** How hard the notes of a written tune are played, 0..1. */
const TUNE_VELOCITY = 0.8
/** General MIDI number of the piano. */
const PIANO_PROGRAM = 0

/**
 * Turns a tune written as text into a Song with one part.
 * `tune` is a list of tokens separated by spaces: "C4/1" is the note C4 for 1 beat,
 * "D#5/.25" a quarter of a beat, "R/.5" a rest of half a beat. "|" is ignored (bar
 * lines, for reading). Each note sounds for 90% of its length so that repeated notes
 * are heard separately.
 * Throws on a token it cannot read (the tunes are checked by a unit test).
 */
export function tuneToSong(id: string, title: string, beatsPerMinute: number, tune: string): Song {
  if (!Number.isFinite(beatsPerMinute) || beatsPerMinute <= 0) {
    throw new Error(`The tune "${title}" needs a speed above 0 beats a minute.`)
  }
  const secondsPerBeat = 60 / beatsPerMinute
  const notes: SongNote[] = []
  // Counted in beats, not seconds, so that rounding does not build up along the tune.
  let beat = 0
  for (const token of tune.split(/\s+/)) {
    if (token === '' || token === '|') continue
    const { midi, beats } = readToken(token, title)
    if (midi !== null) {
      notes.push({
        midi,
        time: beat * secondsPerBeat,
        duration: beats * SOUNDING_SHARE * secondsPerBeat,
        velocity: TUNE_VELOCITY,
      })
    }
    beat += beats
  }
  const last = notes[notes.length - 1]
  if (last === undefined) throw new Error(`The tune "${title}" has no notes.`)

  return {
    id,
    title,
    duration: last.time + last.duration,
    tracks: [{ id: 0, name: '', isPercussion: false, program: PIANO_PROGRAM, notes }],
    createdAt: 0,
  }
}

/** One token of a tune: the note it names (null for a rest) and how many beats it lasts. */
function readToken(token: string, title: string): { midi: number | null; beats: number } {
  const match = TOKEN.exec(token)
  if (match === null) throw unreadable(token, title)
  const [, letter, sharp, octave, length] = match

  const beats = Number(length)
  if (!(beats > 0)) throw unreadable(token, title)
  if (letter === undefined) return { midi: null, beats }

  const midi = midiOfC(Number(octave)) + (SEMITONES[letter] ?? 0) + (sharp === '#' ? 1 : 0)
  if (!isValidMidi(midi)) throw unreadable(token, title)
  return { midi, beats }
}

function unreadable(token: string, title: string): Error {
  return new Error(`Cannot read "${token}" in the tune "${title}".`)
}

/**
 * Built-in songs: old tunes in the public domain, written out here as notes.
 * Their ids start with 'starter:'.
 */
export const STARTER_SONGS: readonly Song[] = STARTER_TUNES.map((starter) =>
  tuneToSong(starter.id, starter.title, starter.beatsPerMinute, starter.tune),
)

export function isStarterSong(id: string): boolean {
  return typeof id === 'string' && id.startsWith(STARTER_PREFIX)
}
