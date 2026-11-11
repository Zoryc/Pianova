import { SLOT_COUNT } from './layout'
import { isBlackKey } from './notes'

/**
 * Where each key sits across the piano, as fractions of the piano's width.
 * Slot 0 is always a C, so the geometry does not depend on the base octave.
 * The on-screen piano and anything drawn in line with it (note trails now,
 * falling notes in Practice mode later) must both use this, so they line up.
 */
export interface KeyRect {
  slot: number
  black: boolean
  /** Left edge, 0..1 of the piano width. */
  left: number
  /** Width, 0..1 of the piano width. */
  width: number
}

/** A black key's width relative to a white key's. */
export const BLACK_KEY_WIDTH_RATIO = 0.62

function buildKeyRects(): KeyRect[] {
  const blacks = Array.from({ length: SLOT_COUNT }, (_, slot) => isBlackKey(slot))
  const whiteCount = blacks.filter((black) => !black).length
  const whiteWidth = 1 / whiteCount
  const blackWidth = whiteWidth * BLACK_KEY_WIDTH_RATIO
  const rects: KeyRect[] = []
  let whitesBefore = 0
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    if (blacks[slot]) {
      // Centred on the line between the white keys on either side.
      rects.push({
        slot,
        black: true,
        left: whitesBefore * whiteWidth - blackWidth / 2,
        width: blackWidth,
      })
    } else {
      rects.push({ slot, black: false, left: whitesBefore * whiteWidth, width: whiteWidth })
      whitesBefore++
    }
  }
  return rects
}

/** One entry per slot, index = slot. */
export const KEY_RECTS: readonly KeyRect[] = buildKeyRects()

/** Number of white keys in the window (22). */
export const WHITE_KEY_COUNT = KEY_RECTS.filter((rect) => !rect.black).length

export function keyRect(slot: number): KeyRect | null {
  return KEY_RECTS[slot] ?? null
}
