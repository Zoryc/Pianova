/** Small helpers that turn numbers into the text shown on screen. */
import { SLOT_COUNT, slotToMidi } from '../core/layout'
import { noteName } from '../core/notes'
import type { NoteNaming } from '../core/types'

/** 0.8 → 80. Whole numbers only, so a slider never shows "79.99999". */
export function toPercent(fraction: number): number {
  return Math.round(fraction * 100)
}

/** 0.8 → "80%". */
export function formatPercent(fraction: number): string {
  return `${toPercent(fraction)}%`
}

/** 0 → "0", 2 → "+2", -3 → "−3" (a real minus sign, as wide as the plus). */
export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`
  if (value < 0) return `−${Math.abs(value)}`
  return '0'
}

/** The lowest and highest note of the on-screen piano at this position: "C3 – C6". */
export function pianoRangeLabel(baseOctave: number, naming: NoteNaming): string {
  const lowest = noteName(slotToMidi(0, baseOctave), naming)
  const highest = noteName(slotToMidi(SLOT_COUNT - 1, baseOctave), naming)
  return `${lowest} – ${highest}`
}
