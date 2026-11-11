import { keyRect } from '../core/keyGeometry'
import { midiToSlot } from '../core/layout'
import type { Midi } from '../core/types'

/**
 * The simulation behind the light trails: plain data in, plain data out, with
 * no canvas and no clock of its own, so it can be unit-tested.
 *
 * Vertical distances are CSS pixels measured upward from the bottom edge of
 * the canvas, which is where the trails meet the piano keys.
 */

export interface TrailBar {
  readonly midi: Midi
  /** A black-key note: narrower, and drawn in a deeper tone. */
  readonly black: boolean
  /** Left edge of the key, 0..1 of the canvas width. */
  readonly left: number
  /** Width of the key, 0..1 of the canvas width. */
  readonly width: number
  /** How far the bottom edge has risen above the keys. Stays 0 while the note is held. */
  readonly bottom: number
  readonly height: number
  /** True while the note is held: the bar is attached to its key and still growing. */
  readonly held: boolean
}

/** A rectangle in CSS pixels, with `y` measured down from the top of the canvas (the way a canvas draws). */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A stuck or flooding input can never make the list longer than this: the oldest bars go first. */
export const MAX_BARS = 200

/** Even the quickest tap leaves a bar this tall, so every note is seen. */
export const MIN_BAR_HEIGHT = 6

/** The longest step one frame may take. Without it bars would jump after the tab was in the background. */
export const MAX_FRAME_MS = 50

/** How long the tip of a bar takes to climb the whole canvas: a taller canvas gets faster bars. */
const CLIMB_SECONDS = 1.5

/** Keeps bars lively on a very short canvas (pixels per second). */
const MIN_SPEED = 60

/** Empty space between the bars of neighbouring keys. */
const BAR_GAP = 4

/** The share of the canvas, counted from its top, over which bars fade away. */
const FADE_FRACTION = 0.5

/** Reduced motion: the still glow above a held key is this share of the canvas height… */
const STATIC_GLOW_FRACTION = 0.3

/** …but never shorter than this. */
const MIN_STATIC_GLOW = 24

/** How fast bars grow and rise, in pixels per second. */
export function trailSpeed(canvasHeight: number): number {
  return Math.max(MIN_SPEED, canvasHeight / CLIMB_SECONDS)
}

/** The time one frame may advance the bars by, in seconds, from the milliseconds since the previous frame. */
export function frameSeconds(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0
  return Math.min(elapsedMs, MAX_FRAME_MS) / 1000
}

/**
 * A note started: a new bar is born on its key. A bar that the same note was
 * still holding (the note was re-triggered) is let go first. Notes outside the
 * piano's current window are ignored.
 */
export function startBar(
  bars: readonly TrailBar[],
  midi: Midi,
  baseOctave: number,
): readonly TrailBar[] {
  const slot = midiToSlot(midi, baseOctave)
  const key = slot === null ? null : keyRect(slot)
  if (!key) return bars
  const bar: TrailBar = {
    midi,
    black: key.black,
    left: key.left,
    width: key.width,
    bottom: 0,
    height: 0,
    held: true,
  }
  return [...releaseBar(bars, midi), bar].slice(-MAX_BARS)
}

/** A note ended: its bar detaches from the key and will now rise as a whole. */
export function releaseBar(bars: readonly TrailBar[], midi: Midi): readonly TrailBar[] {
  const isHolding = (bar: TrailBar): boolean => bar.held && bar.midi === midi
  if (!bars.some(isHolding)) return bars
  return bars.map((bar) =>
    isHolding(bar) ? { ...bar, held: false, height: Math.max(bar.height, MIN_BAR_HEIGHT) } : bar,
  )
}

/** Only the bars whose note is still held (all that reduced motion shows). */
export function keepHeld(bars: readonly TrailBar[]): readonly TrailBar[] {
  return bars.filter((bar) => bar.held)
}

/**
 * Moves time forward: held bars grow, released bars rise, and bars that are
 * entirely above the top of the canvas are removed.
 */
export function advanceBars(
  bars: readonly TrailBar[],
  seconds: number,
  canvasHeight: number,
): readonly TrailBar[] {
  const distance = trailSpeed(canvasHeight) * seconds
  return bars
    .map((bar) => moveBar(bar, distance, canvasHeight))
    .filter((bar) => bar.bottom < canvasHeight)
}

function moveBar(bar: TrailBar, distance: number, canvasHeight: number): TrailBar {
  if (!bar.held) return { ...bar, bottom: bar.bottom + distance }
  // Whatever is above the top is never seen, so a note held for minutes does not grow without limit.
  return { ...bar, height: Math.min(bar.height + distance, canvasHeight) }
}

/** Where to draw a bar, in line with its piano key. */
export function barRect(bar: TrailBar, canvasWidth: number, canvasHeight: number): Rect {
  return {
    ...horizontalSpan(bar, canvasWidth),
    y: canvasHeight - bar.bottom - bar.height,
    height: bar.height,
  }
}

/** Reduced motion: where to draw the short still glow that stands in for a bar. */
export function staticGlowRect(bar: TrailBar, canvasWidth: number, canvasHeight: number): Rect {
  const height = staticGlowHeight(canvasHeight)
  return { ...horizontalSpan(bar, canvasWidth), y: canvasHeight - height, height }
}

export function staticGlowHeight(canvasHeight: number): number {
  return Math.min(canvasHeight, Math.max(MIN_STATIC_GLOW, canvasHeight * STATIC_GLOW_FRACTION))
}

/** Height of the zone at the top of the canvas where bars fade out. */
export function fadeHeight(canvasHeight: number): number {
  return canvasHeight * FADE_FRACTION
}

/** The key's span in pixels, narrowed a little and kept centred so neighbouring bars do not merge. */
function horizontalSpan(bar: TrailBar, canvasWidth: number): Pick<Rect, 'x' | 'width'> {
  const keyWidth = bar.width * canvasWidth
  const width = Math.max(1, keyWidth - BAR_GAP)
  return { x: bar.left * canvasWidth + (keyWidth - width) / 2, width }
}
