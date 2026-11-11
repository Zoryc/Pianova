import { describe, expect, it } from 'vitest'
import { BLACK_KEY_WIDTH_RATIO, KEY_RECTS, WHITE_KEY_COUNT, keyRect } from './keyGeometry'
import { SLOT_COUNT } from './layout'

describe('keyGeometry', () => {
  it('has one rect per slot, 22 white and 15 black', () => {
    expect(KEY_RECTS).toHaveLength(SLOT_COUNT)
    expect(WHITE_KEY_COUNT).toBe(22)
    expect(KEY_RECTS.filter((r) => r.black)).toHaveLength(15)
    KEY_RECTS.forEach((rect, index) => expect(rect.slot).toBe(index))
  })

  it('lays white keys edge to edge across the full width', () => {
    const whites = KEY_RECTS.filter((r) => !r.black)
    const width = 1 / 22
    whites.forEach((rect, index) => {
      expect(rect.left).toBeCloseTo(index * width, 10)
      expect(rect.width).toBeCloseTo(width, 10)
    })
    const last = whites[whites.length - 1]
    expect(last ? last.left + last.width : 0).toBeCloseTo(1, 10)
  })

  it('centres black keys on the gap between their neighbours', () => {
    const cSharp = keyRect(1)
    const d = keyRect(2)
    expect(cSharp?.black).toBe(true)
    expect(cSharp && d ? cSharp.left + cSharp.width / 2 : -1).toBeCloseTo(d?.left ?? 0, 10)
    expect(cSharp?.width).toBeCloseTo((1 / 22) * BLACK_KEY_WIDTH_RATIO, 10)
  })

  it('keeps every key inside the piano and returns null outside the window', () => {
    for (const rect of KEY_RECTS) {
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.left + rect.width).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(keyRect(-1)).toBeNull()
    expect(keyRect(SLOT_COUNT)).toBeNull()
  })
})
