import type { PianoRange } from './layout'
import { isBlackKey } from './notes'
import type { Midi } from './types'

/**
 * Where each key of the on-screen piano sits, as fractions of the piano's
 * width, for a piano of any size. The piano and everything drawn in line
 * with it (rising bars, falling notes, sparks) use this, so they line up.
 */
export interface KeyRect {
  midi: Midi
  black: boolean
  /** Left edge, 0..1 of the piano's width. */
  left: number
  /** Width, 0..1 of the piano's width. */
  width: number
}

/** A black key's width relative to a white key's. */
export const BLACK_KEY_WIDTH_RATIO = 0.62

const cache = new Map<string, readonly KeyRect[]>()

/** Number of white keys in the range. */
export function whiteKeyCount(range: PianoRange): number {
  let count = 0
  for (let midi = range.first; midi <= range.last; midi++) {
    if (!isBlackKey(midi)) count++
  }
  return count
}

/**
 * One entry per note of the range, lowest first. White keys are laid edge to
 * edge across the full width; a black key is centred on the line between the
 * white keys on either side. The same array is returned for the same range.
 */
export function keyRects(range: PianoRange): readonly KeyRect[] {
  const key = `${range.first}:${range.last}`
  const cached = cache.get(key)
  if (cached) return cached

  const whites = whiteKeyCount(range)
  const whiteWidth = whites > 0 ? 1 / whites : 0
  const blackWidth = whiteWidth * BLACK_KEY_WIDTH_RATIO
  const rects: KeyRect[] = []
  let whitesBefore = 0
  for (let midi = range.first; midi <= range.last; midi++) {
    if (isBlackKey(midi)) {
      rects.push({
        midi,
        black: true,
        left: whitesBefore * whiteWidth - blackWidth / 2,
        width: blackWidth,
      })
    } else {
      rects.push({ midi, black: false, left: whitesBefore * whiteWidth, width: whiteWidth })
      whitesBefore++
    }
  }
  const frozen = Object.freeze(rects)
  cache.set(key, frozen)
  return frozen
}

/** The key for `midi`, or null when the note is not on this piano. */
export function keyRectOf(midi: Midi, range: PianoRange): KeyRect | null {
  if (!Number.isInteger(midi) || midi < range.first || midi > range.last) return null
  return keyRects(range)[midi - range.first] ?? null
}
