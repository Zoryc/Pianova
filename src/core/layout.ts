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
