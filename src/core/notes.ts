import type { Midi, NoteNaming } from './types'

/** Lowest note on a piano (A0). */
export const MIDI_MIN: Midi = 21
/** Highest note on a piano (C8). */
export const MIDI_MAX: Midi = 108

const DISPLAY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
const SOLFEGE_NAMES = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'] as const
const ASCII_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false] as const

/** 0 = C, 1 = C♯ … 11 = B. */
export function pitchClass(midi: Midi): number {
  return ((Math.trunc(midi) % 12) + 12) % 12
}

/** Octave number in scientific pitch notation (middle C = C4). */
export function octaveOf(midi: Midi): number {
  return Math.floor(midi / 12) - 1
}

export function isBlackKey(midi: Midi): boolean {
  return BLACK[pitchClass(midi)] ?? false
}

/** Note name without the octave, for display: "C", "F♯" (or "Do", "Fa♯" in solfège). */
export function pitchName(midi: Midi, naming: NoteNaming = 'letters'): string {
  const names = naming === 'solfege' ? SOLFEGE_NAMES : DISPLAY_NAMES
  return names[pitchClass(midi)] ?? '?'
}

/** Full note name for display: "C4", "F♯3" (or "Do4", "Fa♯3" in solfège). */
export function noteName(midi: Midi, naming: NoteNaming = 'letters'): string {
  return `${pitchName(midi, naming)}${octaveOf(midi)}`
}

/** ASCII note name that Tone.js understands: "C4", "F#3". */
export function toneName(midi: Midi): string {
  return `${ASCII_NAMES[pitchClass(midi)] ?? 'C'}${octaveOf(midi)}`
}

/** MIDI number of the C that starts the given octave: midiOfC(4) === 60. */
export function midiOfC(octave: number): Midi {
  return 12 * (octave + 1)
}

export function isValidMidi(value: unknown): value is Midi {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIDI_MIN && value <= MIDI_MAX
  )
}
