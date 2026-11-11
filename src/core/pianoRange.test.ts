import { describe, expect, it } from 'vitest'
import {
  MAX_BASE_OCTAVE,
  MIN_AUTO_KEY_WIDTH,
  MIN_BASE_OCTAVE,
  PIANO_SIZES,
  SLOT_COUNT,
  isInRange,
  isPianoSizeSetting,
  pianoRange,
  resolvePianoSize,
  slotToMidi,
} from './layout'
import { isBlackKey, noteName } from './notes'
import { BLACK_KEY_WIDTH_RATIO, keyRectOf, keyRects, whiteKeyCount } from './pianoGeometry'

describe('pianoRange', () => {
  it('shows the whole piano at 88 keys, whatever the base octave', () => {
    for (let octave = MIN_BASE_OCTAVE; octave <= MAX_BASE_OCTAVE; octave++) {
      expect(pianoRange(88, octave)).toEqual({ first: 21, last: 108 })
    }
  })

  it('uses the usual ranges when the zone is in the middle', () => {
    expect(names(pianoRange(61, 3))).toEqual(['C2', 'C7'])
    expect(names(pianoRange(49, 3))).toEqual(['C2', 'C6'])
    expect(names(pianoRange(37, 3))).toEqual(['C3', 'C6'])
  })

  it('moves by whole octaves, as little as possible, to keep the zone inside', () => {
    expect(names(pianoRange(61, 1))).toEqual(['C1', 'C6'])
    expect(names(pianoRange(61, 5))).toEqual(['C3', 'C8'])
    expect(names(pianoRange(49, 1))).toEqual(['C1', 'C5'])
    expect(names(pianoRange(49, 4))).toEqual(['C3', 'C7'])
    expect(names(pianoRange(49, 5))).toEqual(['C4', 'C8'])
  })

  it('always has the right number of keys, contains the zone and stays on the piano', () => {
    for (const size of PIANO_SIZES) {
      for (let octave = MIN_BASE_OCTAVE; octave <= MAX_BASE_OCTAVE; octave++) {
        const range = pianoRange(size, octave)
        expect(range.last - range.first + 1).toBe(size)
        expect(range.first).toBeGreaterThanOrEqual(21)
        expect(range.last).toBeLessThanOrEqual(108)
        expect(isBlackKey(range.first)).toBe(false)
        expect(isBlackKey(range.last)).toBe(false)
        expect(isInRange(slotToMidi(0, octave), range)).toBe(true)
        expect(isInRange(slotToMidi(SLOT_COUNT - 1, octave), range)).toBe(true)
      }
    }
  })

  it('returns the same object for the same arguments and copes with odd octaves', () => {
    expect(pianoRange(61, 3)).toBe(pianoRange(61, 3))
    expect(pianoRange(37, 99)).toEqual(pianoRange(37, MAX_BASE_OCTAVE))
    expect(pianoRange(49, Number.NaN)).toEqual(pianoRange(49, 3))
  })

  it('knows what is on the piano', () => {
    const range = pianoRange(37, 3)
    expect(isInRange(47, range)).toBe(false)
    expect(isInRange(48, range)).toBe(true)
    expect(isInRange(84, range)).toBe(true)
    expect(isInRange(85, range)).toBe(false)
  })
})

describe('resolvePianoSize', () => {
  it('returns a fixed size as it is', () => {
    for (const size of PIANO_SIZES) expect(resolvePianoSize(size, 10)).toBe(size)
  })

  it('picks the largest piano whose keys are wide enough', () => {
    expect(resolvePianoSize('auto', 52 * MIN_AUTO_KEY_WIDTH)).toBe(88)
    expect(resolvePianoSize('auto', 52 * MIN_AUTO_KEY_WIDTH - 1)).toBe(61)
    expect(resolvePianoSize('auto', 36 * MIN_AUTO_KEY_WIDTH)).toBe(61)
    expect(resolvePianoSize('auto', 36 * MIN_AUTO_KEY_WIDTH - 1)).toBe(49)
    expect(resolvePianoSize('auto', 29 * MIN_AUTO_KEY_WIDTH - 1)).toBe(37)
    expect(resolvePianoSize('auto', 1920)).toBe(88)
    expect(resolvePianoSize('auto', 750)).toBe(37)
  })

  it('falls back to the smallest piano for a width it cannot use', () => {
    expect(resolvePianoSize('auto', 0)).toBe(37)
    expect(resolvePianoSize('auto', -5)).toBe(37)
    expect(resolvePianoSize('auto', Number.NaN)).toBe(37)
  })

  it('recognises valid settings', () => {
    expect(isPianoSizeSetting('auto')).toBe(true)
    expect(isPianoSizeSetting(61)).toBe(true)
    expect(isPianoSizeSetting(76)).toBe(false)
    expect(isPianoSizeSetting('88')).toBe(false)
    expect(isPianoSizeSetting(null)).toBe(false)
  })
})

describe('pianoGeometry', () => {
  it('counts white keys', () => {
    expect(whiteKeyCount(pianoRange(88, 3))).toBe(52)
    expect(whiteKeyCount(pianoRange(61, 3))).toBe(36)
    expect(whiteKeyCount(pianoRange(49, 3))).toBe(29)
    expect(whiteKeyCount(pianoRange(37, 3))).toBe(22)
  })

  it('lays white keys edge to edge across the full width, for every size', () => {
    for (const size of PIANO_SIZES) {
      const range = pianoRange(size, 3)
      const whites = keyRects(range).filter((rect) => !rect.black)
      const width = 1 / whites.length
      whites.forEach((rect, index) => {
        expect(rect.left).toBeCloseTo(index * width, 10)
        expect(rect.width).toBeCloseTo(width, 10)
      })
    }
  })

  it('centres each black key on the line between its neighbours and keeps it on the piano', () => {
    for (const size of PIANO_SIZES) {
      const range = pianoRange(size, 3)
      for (const rect of keyRects(range)) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.left + rect.width).toBeLessThanOrEqual(1 + 1e-9)
        if (!rect.black) continue
        const next = keyRectOf(rect.midi + 1, range)
        expect(next?.black).toBe(false)
        expect(rect.left + rect.width / 2).toBeCloseTo(next?.left ?? -1, 10)
        expect(rect.width).toBeCloseTo((next?.width ?? 0) * BLACK_KEY_WIDTH_RATIO, 10)
      }
    }
  })

  it('handles a piano that starts on A (the full piano)', () => {
    const range = pianoRange(88, 3)
    const rects = keyRects(range)
    expect(rects).toHaveLength(88)
    expect(rects[0]).toMatchObject({ midi: 21, black: false, left: 0 })
    expect(rects[1]).toMatchObject({ midi: 22, black: true })
    expect(rects[87]).toMatchObject({ midi: 108, black: false })
    expect((rects[87]?.left ?? 0) + (rects[87]?.width ?? 0)).toBeCloseTo(1, 10)
  })

  it('finds a key by note, returns null off the piano, and reuses its arrays', () => {
    const range = pianoRange(37, 3)
    expect(keyRectOf(60, range)?.midi).toBe(60)
    expect(keyRectOf(47, range)).toBeNull()
    expect(keyRectOf(85, range)).toBeNull()
    expect(keyRectOf(60.5, range)).toBeNull()
    expect(keyRects(range)).toBe(keyRects(pianoRange(37, 3)))
  })
})

function names(range: { first: number; last: number }): string[] {
  return [noteName(range.first), noteName(range.last)]
}
