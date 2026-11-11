import { midiOfC } from './notes'
import type { Midi } from './types'

/**
 * The on-screen piano is a window of SLOT_COUNT keys. Slot 0 is the C of
 * `baseOctave`; each slot is one semitone higher than the one before.
 * Key bindings point at slots, not at absolute notes, so moving the window
 * (changing `baseOctave`) moves every bound key with it.
 */

/** Three octaves plus the top C: C, C♯ … up to the C three octaves above. */
export const SLOT_COUNT = 37

export const MIN_BASE_OCTAVE = 1
/** With base octave 5 the last slot is C8, the top of a real piano. */
export const MAX_BASE_OCTAVE = 5
/** Slots cover C3..C6, which puts middle C (C4) on slot 12. */
export const DEFAULT_BASE_OCTAVE = 3

export function isValidSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < SLOT_COUNT
}

export function clampBaseOctave(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BASE_OCTAVE
  return Math.min(MAX_BASE_OCTAVE, Math.max(MIN_BASE_OCTAVE, Math.round(value)))
}

export function slotToMidi(slot: number, baseOctave: number): Midi {
  return midiOfC(baseOctave) + slot
}

/** The slot showing `midi` in the current window, or null if it is outside the window. */
export function midiToSlot(midi: Midi, baseOctave: number): number | null {
  const slot = midi - midiOfC(baseOctave)
  return isValidSlot(slot) ? slot : null
}

/*
 * The piano on screen. It is separate from the 37 slots above: the slots are
 * the notes the computer keys can be given (the "keyboard zone"), the piano
 * on screen is a range of notes that always contains that zone.
 */

/** How many keys the on-screen piano has. */
export type PianoSize = 88 | 61 | 49 | 37

/** Largest first. */
export const PIANO_SIZES: readonly PianoSize[] = [88, 61, 49, 37]

/** What the setting holds: a fixed size, or 'auto' (the largest that fits the window). */
export type PianoSizeSetting = PianoSize | 'auto'

/** Narrowest white key, in CSS pixels, that Auto accepts. */
export const MIN_AUTO_KEY_WIDTH = 26

const WHITE_KEYS: Readonly<Record<PianoSize, number>> = { 88: 52, 61: 36, 49: 29, 37: 22 }

export function isPianoSizeSetting(value: unknown): value is PianoSizeSetting {
  return value === 'auto' || PIANO_SIZES.some((size) => size === value)
}

/**
 * The size to draw. A fixed setting is returned as it is. 'auto' picks the
 * largest piano whose white keys are at least MIN_AUTO_KEY_WIDTH wide on a
 * piano `widthPx` wide, or the smallest piano when none is.
 */
export function resolvePianoSize(setting: PianoSizeSetting, widthPx: number): PianoSize {
  if (setting !== 'auto') return setting
  for (const size of PIANO_SIZES) {
    if (widthPx / WHITE_KEYS[size] >= MIN_AUTO_KEY_WIDTH) return size
  }
  return 37
}

/** The notes the on-screen piano shows: lowest and highest, both included. */
export interface PianoRange {
  first: Midi
  last: Midi
}

const FULL_PIANO: PianoRange = Object.freeze({ first: 21, last: 108 })
/** The octave a 61-key or 49-key piano starts on when nothing pulls it elsewhere (C2). */
const STANDARD_START_OCTAVE = 2
const ranges = new Map<string, PianoRange>()

/**
 * The notes shown by a piano of `size` keys when the keyboard zone starts at
 * the C of `baseOctave`. The zone always lies inside the result.
 * - 88: the whole piano, A0..C8.
 * - 61 and 49: C to C. The usual range (from C2) moved by whole octaves, as
 *   little as possible, so that the zone is inside it and it stays on the piano.
 * - 37: exactly the zone.
 * The same object is returned for the same arguments.
 */
export function pianoRange(size: PianoSize, baseOctave: number): PianoRange {
  if (size === 88) return FULL_PIANO
  const zoneOctave = clampBaseOctave(baseOctave)
  const key = `${size}:${zoneOctave}`
  const cached = ranges.get(key)
  if (cached) return cached

  const octaves = (size - 1) / 12
  // The zone is three octaves: the piano may start up to (octaves - 3) octaves below it.
  const lowest = Math.max(MIN_BASE_OCTAVE, zoneOctave - (octaves - 3))
  const highest = Math.min(zoneOctave, 8 - octaves)
  const startOctave = Math.min(highest, Math.max(lowest, STANDARD_START_OCTAVE))
  const first = midiOfC(startOctave)
  const range = Object.freeze({ first, last: first + size - 1 })
  ranges.set(key, range)
  return range
}

export function isInRange(midi: Midi, range: PianoRange): boolean {
  return midi >= range.first && midi <= range.last
}
