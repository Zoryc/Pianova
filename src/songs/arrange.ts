import {
  DEFAULT_BASE_OCTAVE,
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  isInRange,
  midiToSlot,
} from '../core/layout'
import type { PianoRange } from '../core/layout'
import type { Midi } from '../core/types'
import type { ArrangeOptions, Arrangement, PlayableNote, Song, SongTrack } from './song'

export { DEFAULT_ARRANGE_OPTIONS } from './song'
export type { ArrangeOptions, Arrangement, PlayableNote } from './song'

/** Notes that start this close together (in seconds) are heard as one chord. */
const CHORD_WINDOW = 0.03
/** Notes of one pitch that start this close together (in seconds) are one press of the key. */
const SAME_PRESS_WINDOW = 0.001
/** A note shorter than this (in seconds) is not played. */
const SHORTEST_NOTE = 0.001
const SEMITONES_PER_OCTAVE = 12

/** The parts `options` selects (percussion is never included, even when listed). */
export function selectedTracks(song: Song, options: ArrangeOptions): readonly SongTrack[] {
  const pitched = song.tracks.filter((track) => !track.isPercussion)
  if (options.trackIds === 'auto') return pitched
  const wanted = new Set(options.trackIds)
  return pitched.filter((track) => wanted.has(track.id))
}

/**
 * The base octave (MIN_BASE_OCTAVE..MAX_BASE_OCTAVE) at which the computer
 * keys can play the most of these notes: a note counts when its slot at that
 * base octave is in `playableSlots` (the slots that have a key; when omitted,
 * every slot of the keyboard zone counts). Ties go to the octave nearest
 * DEFAULT_BASE_OCTAVE, then the lower one. DEFAULT_BASE_OCTAVE for no notes.
 */
export function bestBaseOctave(
  notes: readonly { midi: Midi }[],
  playableSlots?: ReadonlySet<number>,
): number {
  let best = DEFAULT_BASE_OCTAVE
  let bestCount = -1
  // Lowest first, and only a strictly better octave replaces the best so far:
  // of two equally good octaves the lower one stays.
  for (let octave = MIN_BASE_OCTAVE; octave <= MAX_BASE_OCTAVE; octave += 1) {
    const count = countPlayable(notes, octave, playableSlots)
    const nearer = distanceFromDefault(octave) < distanceFromDefault(best)
    if (count > bestCount || (count === bestCount && nearer)) {
      best = octave
      bestCount = count
    }
  }
  return best
}

/**
 * The notes to play for `song`. `range` is the piano on screen. Never changes
 * the song, and the same arguments always give the same result.
 */
export function arrange(song: Song, options: ArrangeOptions, range: PianoRange): Arrangement {
  let notes = mergedNotes(selectedTracks(song, options))
  if (options.melodyOnly) notes = melodyOf(notes)
  if (options.fitToPiano) notes = notes.map((note) => movedOntoPiano(note, range))
  notes = withoutSamePitchOverlaps(notes)
  notes = notes.filter((note) => note.duration >= SHORTEST_NOTE).sort(byTimeThenMidi)

  return {
    notes,
    duration: endOfLastNote(notes),
    offPianoCount: notes.filter((note) => !isInRange(note.midi, range)).length,
  }
}

function countPlayable(
  notes: readonly { midi: Midi }[],
  baseOctave: number,
  playableSlots: ReadonlySet<number> | undefined,
): number {
  let count = 0
  for (const note of notes) {
    const slot = midiToSlot(note.midi, baseOctave)
    if (slot !== null && (playableSlots === undefined || playableSlots.has(slot))) count += 1
  }
  return count
}

function distanceFromDefault(baseOctave: number): number {
  return Math.abs(baseOctave - DEFAULT_BASE_OCTAVE)
}

/** Copies of every note of these parts, in the order they are played. */
function mergedNotes(tracks: readonly SongTrack[]): PlayableNote[] {
  const notes: PlayableNote[] = []
  for (const track of tracks) {
    for (const note of track.notes) notes.push({ ...note })
  }
  return notes.sort(byTimeThenMidi)
}

function byTimeThenMidi(a: PlayableNote, b: PlayableNote): number {
  return a.time - b.time || a.midi - b.midi
}

/** One note at a time: the highest note of each chord, cut short where the next one starts. */
function melodyOf(notes: readonly PlayableNote[]): PlayableNote[] {
  const tops = topNotesOfChords(notes)
  return tops.map((note, index) => {
    const next = tops[index + 1]
    return next === undefined ? note : endingBy(note, next.time)
  })
}

/**
 * The highest note of each chord (the longest one, when a chord has it twice).
 * A chord is every note that starts within CHORD_WINDOW of the chord's first
 * note. `notes` must be in time order.
 */
function topNotesOfChords(notes: readonly PlayableNote[]): PlayableNote[] {
  const tops: PlayableNote[] = []
  let chordStart = 0
  for (const note of notes) {
    const top = tops[tops.length - 1]
    if (top === undefined || note.time - chordStart > CHORD_WINDOW) {
      tops.push(note)
      chordStart = note.time
    } else if (note.midi > top.midi || (note.midi === top.midi && note.duration > top.duration)) {
      tops[tops.length - 1] = note
    }
  }
  return tops
}

/**
 * The note, moved by whole octaves to the nearest place on the piano when it
 * is off it. Every piano on screen has at least an octave of keys, so there
 * is always such a place.
 */
function movedOntoPiano(note: PlayableNote, range: PianoRange): PlayableNote {
  if (note.midi < range.first) {
    return { ...note, midi: note.midi + wholeOctaves(range.first - note.midi) }
  }
  if (note.midi > range.last) {
    return { ...note, midi: note.midi - wholeOctaves(note.midi - range.last) }
  }
  return note
}

/** The smallest number of whole octaves that covers `semitones`, in semitones. */
function wholeOctaves(semitones: number): number {
  return Math.ceil(semitones / SEMITONES_PER_OCTAVE) * SEMITONES_PER_OCTAVE
}

/**
 * Makes sure one pitch never sounds twice at once. The note bus ignores a
 * second press of a note that is already held, so such a note would be lost
 * and the first one would stop too early. `notes` must be in time order.
 */
function withoutSamePitchOverlaps(notes: readonly PlayableNote[]): PlayableNote[] {
  const byPitch = new Map<Midi, PlayableNote[]>()
  for (const note of notes) {
    const samePitch = byPitch.get(note.midi)
    if (samePitch) samePitch.push(note)
    else byPitch.set(note.midi, [note])
  }
  return [...byPitch.values()].flatMap(withoutOverlaps)
}

/**
 * For the notes of one pitch, in time order: of several notes that start
 * within SAME_PRESS_WINDOW of the first of them only the longest stays, and a
 * note still sounding when the next one starts ends there.
 */
function withoutOverlaps(notes: readonly PlayableNote[]): PlayableNote[] {
  const kept: PlayableNote[] = []
  let pressStart = 0
  for (const note of notes) {
    const previous = kept[kept.length - 1]
    if (previous === undefined || note.time - pressStart > SAME_PRESS_WINDOW) {
      if (previous !== undefined) kept[kept.length - 1] = endingBy(previous, note.time)
      kept.push(note)
      pressStart = note.time
    } else if (note.duration > previous.duration) {
      kept[kept.length - 1] = note
    }
  }
  return kept
}

/** The note itself when it is over by `end` (in seconds); otherwise a copy cut to end there. */
function endingBy(note: PlayableNote, end: number): PlayableNote {
  if (note.time + note.duration <= end) return note
  let duration = end - note.time
  // The subtraction can round up by the smallest step a number can take, which
  // would leave the note overlapping the next one by that much: step back down.
  if (note.time + duration > end) duration *= 1 - Number.EPSILON
  return { ...note, duration }
}

function endOfLastNote(notes: readonly PlayableNote[]): number {
  let end = 0
  for (const note of notes) end = Math.max(end, note.time + note.duration)
  return end
}
