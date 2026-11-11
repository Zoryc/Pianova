import { describe, expect, it } from 'vitest'
import { keyRect } from '../core/keyGeometry'
import { DEFAULT_BASE_OCTAVE } from '../core/layout'
import {
  MAX_BARS,
  MAX_FRAME_MS,
  MIN_BAR_HEIGHT,
  advanceBars,
  barRect,
  fadeHeight,
  frameSeconds,
  keepHeld,
  releaseBar,
  startBar,
  staticGlowHeight,
  staticGlowRect,
  trailSpeed,
} from './noteTrailsModel'
import type { TrailBar } from './noteTrailsModel'

/** With the default base octave the window is C3..C6, so middle C is slot 12. */
const BASE = DEFAULT_BASE_OCTAVE
const MIDDLE_C = 60
const C_SHARP = 61
const D = 62
const WIDTH = 1100
const HEIGHT = 160
const FRAME = 1 / 60

function only(bars: readonly TrailBar[]): TrailBar {
  expect(bars).toHaveLength(1)
  return bars[0] as TrailBar
}

/** Runs the simulation for `seconds`, one 60 fps frame at a time. */
function run(bars: readonly TrailBar[], seconds: number): readonly TrailBar[] {
  let current = bars
  for (let frame = 0; frame < Math.round(seconds / FRAME); frame++) {
    current = advanceBars(current, FRAME, HEIGHT)
  }
  return current
}

describe('startBar', () => {
  it('starts a held bar of no height on the key of the note', () => {
    const bar = only(startBar([], MIDDLE_C, BASE))
    const key = keyRect(12)
    expect(bar).toEqual({
      midi: MIDDLE_C,
      black: false,
      left: key?.left,
      width: key?.width,
      bottom: 0,
      height: 0,
      held: true,
    })
  })

  it('makes black-key bars narrower than white-key bars', () => {
    const white = only(startBar([], MIDDLE_C, BASE))
    const black = only(startBar([], C_SHARP, BASE))
    expect(black.black).toBe(true)
    expect(black.width).toBeLessThan(white.width)
    expect(black.left).toBe(keyRect(13)?.left)
  })

  it('places the note according to the base octave', () => {
    expect(only(startBar([], MIDDLE_C, 4)).left).toBe(0)
  })

  it('ignores notes outside the window and keeps the same list', () => {
    const bars = startBar([], MIDDLE_C, BASE)
    expect(startBar(bars, 47, BASE)).toBe(bars)
    expect(startBar(bars, 85, BASE)).toBe(bars)
    expect(startBar(bars, 60.5, BASE)).toBe(bars)
  })

  it('lets the old bar go when a held note is triggered again', () => {
    const first = run(startBar([], MIDDLE_C, BASE), 0.5)
    const [old, fresh, ...rest] = startBar(first, MIDDLE_C, BASE)
    expect(rest).toHaveLength(0)
    expect(old?.held).toBe(false)
    expect(old?.height).toBeCloseTo(only(first).height, 10)
    expect(fresh).toMatchObject({ midi: MIDDLE_C, held: true, height: 0, bottom: 0 })
  })

  it('never keeps more than MAX_BARS, dropping the oldest', () => {
    let bars: readonly TrailBar[] = startBar([], D, BASE)
    for (let i = 0; i < MAX_BARS + 50; i++) bars = startBar(bars, MIDDLE_C, BASE)
    expect(bars).toHaveLength(MAX_BARS)
    expect(bars.some((bar) => bar.midi === D)).toBe(false)
    expect(bars.filter((bar) => bar.held)).toHaveLength(1)
    expect(bars[bars.length - 1]?.held).toBe(true)
  })

  it('does not change the list it was given', () => {
    const bars = startBar([], MIDDLE_C, BASE)
    const snapshot = structuredClone(bars)
    startBar(bars, MIDDLE_C, BASE)
    startBar(bars, D, BASE)
    expect(bars).toEqual(snapshot)
  })
})

describe('releaseBar', () => {
  it('detaches only the bar of the released note', () => {
    const held = run(startBar(startBar([], MIDDLE_C, BASE), D, BASE), 0.5)
    const released = releaseBar(held, MIDDLE_C)
    expect(released.map((bar) => bar.held)).toEqual([false, true])
    expect(released[0]?.height).toBeCloseTo(held[0]?.height ?? -1, 10)
    expect(released[0]?.bottom).toBe(0)
    expect(held[0]?.held).toBe(true)
  })

  it('gives even the quickest tap a visible bar', () => {
    const tapped = releaseBar(startBar([], MIDDLE_C, BASE), MIDDLE_C)
    expect(only(tapped).height).toBe(MIN_BAR_HEIGHT)
  })

  it('keeps the same list when the note has no held bar', () => {
    const bars = startBar([], MIDDLE_C, BASE)
    expect(releaseBar(bars, D)).toBe(bars)
    const released = releaseBar(bars, MIDDLE_C)
    expect(releaseBar(released, MIDDLE_C)).toBe(released)
  })
})

describe('keepHeld', () => {
  it('drops the bars that were let go', () => {
    const bars = releaseBar(startBar(startBar([], MIDDLE_C, BASE), D, BASE), MIDDLE_C)
    expect(keepHeld(bars).map((bar) => bar.midi)).toEqual([D])
  })
})

describe('advanceBars', () => {
  it('grows a held bar upward at the trail speed, bottom on the key', () => {
    const bar = only(advanceBars(startBar([], MIDDLE_C, BASE), 0.25, HEIGHT))
    expect(bar.height).toBeCloseTo(trailSpeed(HEIGHT) * 0.25, 10)
    expect(bar.bottom).toBe(0)
    expect(bar.held).toBe(true)
  })

  it('raises a released bar at the same speed without changing its height', () => {
    const released = releaseBar(run(startBar([], MIDDLE_C, BASE), 0.5), MIDDLE_C)
    const before = only(released)
    const after = only(advanceBars(released, 0.25, HEIGHT))
    expect(after.bottom).toBeCloseTo(trailSpeed(HEIGHT) * 0.25, 10)
    expect(after.height).toBe(before.height)
  })

  it('moves at a constant speed, however the time is cut into frames', () => {
    const start = startBar([], MIDDLE_C, BASE)
    const oneStep = only(advanceBars(start, 0.5, HEIGHT))
    const manySteps = only(run(start, 0.5))
    expect(manySteps.height).toBeCloseTo(oneStep.height, 6)
  })

  it('does nothing visible when no time has passed', () => {
    const bars = releaseBar(run(startBar([], MIDDLE_C, BASE), 0.2), MIDDLE_C)
    expect(advanceBars(bars, 0, HEIGHT)).toEqual(bars)
  })

  it('keeps a bar that is partly above the top and removes it once it is fully above', () => {
    const released = releaseBar(run(startBar([], MIDDLE_C, BASE), 0.5), MIDDLE_C)
    const climbSeconds = HEIGHT / trailSpeed(HEIGHT)
    const almostGone = only(advanceBars(released, climbSeconds * 0.99, HEIGHT))
    expect(almostGone.bottom + almostGone.height).toBeGreaterThan(HEIGHT)
    expect(advanceBars(released, climbSeconds, HEIGHT)).toHaveLength(0)
  })

  it('never lets a held bar grow taller than the canvas', () => {
    const bar = only(run(startBar([], MIDDLE_C, BASE), 60))
    expect(bar.height).toBe(HEIGHT)
    expect(bar.held).toBe(true)
  })

  it('does not change the list it was given', () => {
    const bars = releaseBar(run(startBar(startBar([], MIDDLE_C, BASE), D, BASE), 0.2), D)
    const snapshot = structuredClone(bars)
    advanceBars(bars, 0.1, HEIGHT)
    expect(bars).toEqual(snapshot)
  })

  it('ends with an empty list after every note is released, so the render loop can stop', () => {
    let bars = startBar([], MIDDLE_C, BASE)
    bars = run(startBar(bars, C_SHARP, BASE), 0.4)
    bars = run(releaseBar(bars, MIDDLE_C), 0.3)
    expect(bars).toHaveLength(2)
    bars = releaseBar(bars, C_SHARP)
    const climbSeconds = HEIGHT / trailSpeed(HEIGHT)
    expect(run(bars, climbSeconds + 0.1)).toHaveLength(0)
  })
})

describe('frameSeconds', () => {
  it('turns milliseconds into seconds', () => {
    expect(frameSeconds(16)).toBeCloseTo(0.016, 10)
  })

  it('clamps a long gap, such as coming back from a background tab', () => {
    expect(frameSeconds(30_000)).toBe(MAX_FRAME_MS / 1000)
    expect(frameSeconds(Number.POSITIVE_INFINITY)).toBe(MAX_FRAME_MS / 1000)
  })

  it('never goes backwards or returns NaN', () => {
    expect(frameSeconds(0)).toBe(0)
    expect(frameSeconds(-5)).toBe(0)
    expect(frameSeconds(Number.NaN)).toBe(0)
  })
})

describe('trailSpeed', () => {
  it('scales with the canvas height, so a bar takes the same time to cross any canvas', () => {
    expect(trailSpeed(320)).toBeCloseTo(trailSpeed(160) * 2, 10)
  })

  it('stays lively on a tiny or empty canvas', () => {
    expect(trailSpeed(0)).toBeGreaterThan(0)
    expect(trailSpeed(10)).toBe(trailSpeed(0))
  })
})

describe('barRect', () => {
  it('centres the bar on its key and keeps it inside the key', () => {
    for (const midi of [MIDDLE_C, C_SHARP]) {
      const bar = only(startBar([], midi, BASE))
      const rect = barRect(bar, WIDTH, HEIGHT)
      const keyLeft = bar.left * WIDTH
      const keyWidth = bar.width * WIDTH
      expect(rect.x + rect.width / 2).toBeCloseTo(keyLeft + keyWidth / 2, 8)
      expect(rect.x).toBeGreaterThan(keyLeft)
      expect(rect.x + rect.width).toBeLessThan(keyLeft + keyWidth)
      expect(rect.width).toBeGreaterThan(keyWidth * 0.8)
    }
  })

  it('stands a held bar on the bottom edge of the canvas', () => {
    const bar = only(run(startBar([], MIDDLE_C, BASE), 0.5))
    const rect = barRect(bar, WIDTH, HEIGHT)
    expect(rect.height).toBe(bar.height)
    expect(rect.y + rect.height).toBeCloseTo(HEIGHT, 10)
  })

  it('lifts a released bar off the bottom edge by the distance it has risen', () => {
    const released = releaseBar(run(startBar([], MIDDLE_C, BASE), 0.5), MIDDLE_C)
    const bar = only(advanceBars(released, 0.25, HEIGHT))
    const rect = barRect(bar, WIDTH, HEIGHT)
    expect(HEIGHT - (rect.y + rect.height)).toBeCloseTo(bar.bottom, 10)
    expect(rect.height).toBe(bar.height)
  })

  it('still has some width on a very narrow canvas', () => {
    const bar = only(startBar([], C_SHARP, BASE))
    expect(barRect(bar, 20, HEIGHT).width).toBeGreaterThanOrEqual(1)
  })
})

describe('reduced motion and fading', () => {
  it('draws the still glow on the bottom edge, the same size however long the note is held', () => {
    const fresh = only(startBar([], MIDDLE_C, BASE))
    const old = only(run([fresh], 1))
    const rect = staticGlowRect(fresh, WIDTH, HEIGHT)
    expect(staticGlowRect(old, WIDTH, HEIGHT)).toEqual(rect)
    expect(rect.height).toBe(staticGlowHeight(HEIGHT))
    expect(rect.y + rect.height).toBe(HEIGHT)
    expect(rect.x).toBe(barRect(fresh, WIDTH, HEIGHT).x)
    expect(rect.width).toBe(barRect(fresh, WIDTH, HEIGHT).width)
  })

  it('keeps the still glow short, and inside a tiny canvas', () => {
    expect(staticGlowHeight(HEIGHT)).toBeGreaterThan(0)
    expect(staticGlowHeight(HEIGHT)).toBeLessThan(HEIGHT / 2)
    expect(staticGlowHeight(10)).toBe(10)
  })

  it('fades bars over the top part of the canvas only', () => {
    expect(fadeHeight(HEIGHT)).toBeGreaterThan(0)
    expect(fadeHeight(HEIGHT)).toBeLessThan(HEIGHT)
    expect(fadeHeight(HEIGHT * 2)).toBeCloseTo(fadeHeight(HEIGHT) * 2, 10)
  })
})
