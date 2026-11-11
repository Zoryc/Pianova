import { inkOn } from '../../core/colour'
import type { LightPalette } from '../../core/colour'
import type { BarStyle } from '../../core/types'
import { barRadius } from './skyModel'
import { withAlpha } from './skyColour'

/*
 * The pieces of light that are made once and then used many times a frame:
 * the glow of a bar, a spark, the bloom where a note meets the line, and the
 * gradient that fills the bars. The glows are "sprites": small pictures,
 * blurred once when they are made, that are then stamped onto the sky.
 * Stamping a picture costs almost nothing; asking the canvas to blur
 * something on every frame does not.
 */

/** The glow of a bar, as a picture that can be stretched to any height. */
export interface BarGlow {
  image: HTMLCanvasElement
  /** How far the glow reaches beyond the bar on every side, in CSS pixels. */
  margin: number
  /**
   * How far into the bar, from its top and from its bottom, the two ends of
   * the picture reach, in CSS pixels. Between them every row is the same,
   * which is what makes the picture stretchable.
   */
  cap: number
  /** Width and height of what is drawn in `image`, in CSS pixels. */
  width: number
  height: number
  /** Canvas pixels per CSS pixel in `image`. */
  scale: number
}

/** Everything made in advance for one colour of light. */
export interface LightArt {
  /**
   * Fills the bars. It spans the whole height of the sky: `deep` far from
   * the line, the colour itself over most of the sky, `bright` at the line.
   */
  barFill: CanvasGradient
  /** Neon bars: a faint fill and a bright outline. */
  neonFill: string
  neonLine: string
  /** The colour of a key letter written on a bar: dark on a solid bar, bright inside a neon one. */
  ink: string
  /** The glow of a white-key bar and of a black-key bar. Null when there is no glow. */
  whiteGlow: BarGlow | null
  blackGlow: BarGlow | null
  spark: HTMLCanvasElement | null
  /** Null when there is no glow. */
  bloom: HTMLCanvasElement | null
}

/** What the art is made for. It is made again when any of this changes. */
export interface ArtSpec {
  /** Height of the sky, in CSS pixels. */
  skyHeight: number
  /** Width of the bars above white and black keys, in CSS pixels. */
  whiteBarWidth: number
  blackBarWidth: number
  barStyle: BarStyle
  /** 0..1 */
  glow: number
  /** Canvas pixels per CSS pixel. */
  pixelRatio: number
}

export interface SkyArt {
  /** Call before drawing a frame. Forgets what was made for another size, style or glow. */
  prepare(spec: ArtSpec): void
  /** The art for one palette: made the first time it is asked for, remembered after that. */
  of(palette: LightPalette): LightArt
}

/** A spark's bright centre is this share of its picture; the rest is its soft edge. */
export const SPARK_CORE_SHARE = 0.3

/** Where the colours of a bar change, from the top of the sky (0) to the line (1). */
const DEEP_UNTIL = 0.04
const LIGHT_FROM = 0.42
/** The hot end of a bar, where it turns bright: this share of the sky above the line, but never more pixels than this. */
const HOT_SHARE = 0.1
const MAX_HOT_HEIGHT = 64

/** How far the glow of a bar reaches at full strength, in CSS pixels. */
const MAX_GLOW_BLUR = 30
/** Below this the glow would not show: none is made. */
const MIN_GLOW_BLUR = 0.5
/** The picture extends this many times the blur beyond the bar; past that the glow is too faint to see. */
const GLOW_REACH = 1.4
/**
 * Three glows on top of each other look richer than one: a wide soft one, a
 * closer one, and a tight bright one that hugs the bar. Each is a share of
 * the full blur, and so solid.
 */
const GLOW_LAYERS: readonly (readonly [blurShare: number, alpha: number])[] = [
  [1, 0.42],
  [0.45, 0.36],
  [0.14, 0.5],
]
/** Rows in the middle of the picture that are stretched to make the glow as tall as its bar. */
const GLOW_MIDDLE_ROWS = 2
/** The glow slips this far under the edge of its bar, so no dark seam shows between the two. */
const GLOW_OVERLAP = 0.75
/**
 * A solid bar is hottest down its middle, like a tube of light: the
 * near-white tint of its colour is added there. How solid that is at full
 * glow, and how it falls away toward the two edges of the bar (how far
 * across the bar, how much of it is left).
 */
const CORE_ALPHA = 0.8
const CORE_PROFILE: readonly (readonly [across: number, share: number])[] = [
  [0, 0],
  [0.2, 0.28],
  [0.5, 1],
  [0.8, 0.28],
  [1, 0],
]
/** Far outside any picture: where a shape is drawn when only its shadow is wanted. */
const OUT_OF_SIGHT = 10000

/** Width and height of the pictures of a spark and of a bloom, in canvas pixels. */
export const SPARK_PICTURE_SIZE = 32
export const BLOOM_PICTURE_SIZE = 128
/** The streak of light across a bloom is this thick, as a share of its length. */
const STREAK_FLATNESS = 0.06
const NEON_FILL_ALPHA = 0.16

/** A player dragging through the colour picker asks for many colours: only this many are remembered. */
const MAX_PALETTES = 48

/** How much two sizes may differ and still share their art, in CSS pixels. */
const SAME_SIZE = 0.01

/**
 * Makes and remembers the art for each palette. `context` is the sky's own
 * drawing context: the gradients are made by it, and the small pictures by
 * canvases created next to it.
 */
export function createSkyArt(context: CanvasRenderingContext2D): SkyArt {
  const made = new Map<LightPalette, LightArt>()
  let current: ArtSpec | null = null

  const prepare = (spec: ArtSpec): void => {
    if (current && sameSpec(current, spec)) return
    current = { ...spec }
    made.clear()
  }

  const of = (palette: LightPalette): LightArt => {
    const known = made.get(palette)
    if (known) return known
    if (made.size >= MAX_PALETTES) made.clear()
    const art = makeArt(context, palette, current)
    made.set(palette, art)
    return art
  }

  return { prepare, of }
}

function sameSpec(a: ArtSpec, b: ArtSpec): boolean {
  return (
    Math.abs(a.skyHeight - b.skyHeight) < SAME_SIZE &&
    Math.abs(a.whiteBarWidth - b.whiteBarWidth) < SAME_SIZE &&
    Math.abs(a.blackBarWidth - b.blackBarWidth) < SAME_SIZE &&
    a.barStyle === b.barStyle &&
    a.glow === b.glow &&
    a.pixelRatio === b.pixelRatio
  )
}

function makeArt(
  context: CanvasRenderingContext2D,
  palette: LightPalette,
  spec: ArtSpec | null,
): LightArt {
  const page = context.canvas.ownerDocument
  return {
    barFill: makeBarFill(context, palette, spec?.skyHeight ?? 1),
    neonFill: withAlpha(palette.light, NEON_FILL_ALPHA),
    neonLine: palette.bright,
    ink: spec?.barStyle === 'neon' ? palette.bright : inkOn(palette.bright),
    whiteGlow: spec ? makeBarGlow(page, palette, spec.whiteBarWidth, spec) : null,
    blackGlow: spec ? makeBarGlow(page, palette, spec.blackBarWidth, spec) : null,
    spark: makeSpark(page, palette),
    bloom: spec && spec.glow > 0 ? makeBloom(page, palette) : null,
  }
}

function makeBarFill(
  context: CanvasRenderingContext2D,
  palette: LightPalette,
  skyHeight: number,
): CanvasGradient {
  const hot = skyHeight > 0 ? Math.min(HOT_SHARE, MAX_HOT_HEIGHT / skyHeight) : HOT_SHARE
  const fill = context.createLinearGradient(0, 0, 0, skyHeight)
  fill.addColorStop(DEEP_UNTIL, palette.deep)
  fill.addColorStop(LIGHT_FROM, palette.light)
  fill.addColorStop(1 - hot, palette.light)
  fill.addColorStop(1, palette.bright)
  return fill
}

/** A bar standing in a picture of its glow: where it is, in CSS pixels. */
interface BarShape {
  left: number
  top: number
  width: number
  height: number
  radius: number
}

/**
 * The glow of a bar `barWidth` wide: the light around it and, for a solid
 * bar, the lighter line down its middle. The picture holds the two ends of
 * the bar and a couple of rows of its middle; `stampGlow` in skyDraw.ts
 * stretches the middle to the height of the bar.
 */
function makeBarGlow(
  page: Document,
  palette: LightPalette,
  barWidth: number,
  spec: ArtSpec,
): BarGlow | null {
  const blur = MAX_GLOW_BLUR * spec.glow
  if (!(blur >= MIN_GLOW_BLUR)) return null

  const scale = spec.pixelRatio
  const margin = Math.ceil(blur * GLOW_REACH)
  const radius = barRadius(barWidth, Number.POSITIVE_INFINITY)
  const cap = Math.max(Math.ceil(radius) + 1, margin)
  const bar: BarShape = {
    left: margin,
    top: margin,
    width: barWidth,
    height: cap * 2 + GLOW_MIDDLE_ROWS,
    radius,
  }
  const width = bar.width + margin * 2
  const height = bar.height + margin * 2
  const picture = newPicture(page, width * scale, height * scale)
  if (!picture) return null

  const { canvas, context } = picture
  // From here on, one unit is one CSS pixel.
  context.setTransform(scale, 0, 0, scale, 0, 0)
  for (const [blurShare, alpha] of GLOW_LAYERS) {
    castShadow(context, bar, palette.light, alpha, blur * blurShare * scale, scale)
  }
  removeInside(context, bar)
  if (spec.barStyle === 'solid') addCore(context, bar, palette, spec.glow)
  return { image: canvas, margin, cap, width, height, scale }
}

/**
 * Draws the blurred shadow of the bar without the bar: the bar itself is
 * drawn far outside the picture and only its shadow, moved back, lands in it.
 * A canvas does not scale shadows, so `blurPixels` is in canvas pixels.
 */
function castShadow(
  context: CanvasRenderingContext2D,
  bar: BarShape,
  colour: string,
  alpha: number,
  blurPixels: number,
  scale: number,
): void {
  context.save()
  context.shadowColor = withAlpha(colour, alpha)
  context.shadowBlur = blurPixels
  context.shadowOffsetX = OUT_OF_SIGHT * scale
  context.fillStyle = colour
  context.beginPath()
  context.roundRect(bar.left - OUT_OF_SIGHT, bar.top, bar.width, bar.height, bar.radius)
  context.fill()
  context.restore()
}

/** The bar itself is drawn by the sky, so its inside is taken out of the glow: only the light around it is left. */
function removeInside(context: CanvasRenderingContext2D, bar: BarShape): void {
  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.beginPath()
  context.roundRect(
    bar.left + GLOW_OVERLAP,
    bar.top + GLOW_OVERLAP,
    bar.width - GLOW_OVERLAP * 2,
    bar.height - GLOW_OVERLAP * 2,
    Math.max(0, bar.radius - GLOW_OVERLAP),
  )
  context.fill()
  context.restore()
}

/** The hot middle of the bar: its bright tint, fading to nothing at its edges. */
function addCore(
  context: CanvasRenderingContext2D,
  bar: BarShape,
  palette: LightPalette,
  glow: number,
): void {
  const core = context.createLinearGradient(bar.left, 0, bar.left + bar.width, 0)
  for (const [across, share] of CORE_PROFILE) {
    core.addColorStop(across, withAlpha(palette.bright, CORE_ALPHA * glow * share))
  }
  context.fillStyle = core
  context.beginPath()
  context.roundRect(bar.left, bar.top, bar.width, bar.height, bar.radius)
  context.fill()
}

/** A small round light with a bright centre and a soft edge. */
function makeSpark(page: Document, palette: LightPalette): HTMLCanvasElement | null {
  const picture = newPicture(page, SPARK_PICTURE_SIZE, SPARK_PICTURE_SIZE)
  if (!picture) return null
  const half = SPARK_PICTURE_SIZE / 2
  picture.context.translate(half, half)
  fillRoundLight(picture.context, half, [
    [0, withAlpha(palette.bright, 1)],
    [SPARK_CORE_SHARE / 2, withAlpha(palette.bright, 0.95)],
    [SPARK_CORE_SHARE, withAlpha(palette.light, 0.8)],
    [0.6, withAlpha(palette.light, 0.24)],
    [1, withAlpha(palette.light, 0)],
  ])
  return picture.canvas
}

/**
 * The light where a note meets the line: a wide soft light, hot in the
 * middle and fading a long way out, with a thin bright streak across it
 * that lies along the line.
 */
function makeBloom(page: Document, palette: LightPalette): HTMLCanvasElement | null {
  const picture = newPicture(page, BLOOM_PICTURE_SIZE, BLOOM_PICTURE_SIZE)
  if (!picture) return null
  const { canvas, context } = picture
  const half = BLOOM_PICTURE_SIZE / 2
  context.translate(half, half)
  // Many stops, so that the light falls away in a soft curve and not in straight steps.
  fillRoundLight(context, half, [
    [0, withAlpha(palette.bright, 1)],
    [0.05, withAlpha(palette.bright, 0.9)],
    [0.12, withAlpha(palette.light, 0.7)],
    [0.24, withAlpha(palette.light, 0.42)],
    [0.42, withAlpha(palette.light, 0.19)],
    [0.66, withAlpha(palette.light, 0.06)],
    [1, withAlpha(palette.light, 0)],
  ])
  // The same kind of light, squashed flat and added on top.
  context.globalCompositeOperation = 'lighter'
  context.scale(1, STREAK_FLATNESS)
  fillRoundLight(context, half, [
    [0, withAlpha(palette.bright, 0.75)],
    [0.25, withAlpha(palette.bright, 0.4)],
    [0.6, withAlpha(palette.light, 0.14)],
    [1, withAlpha(palette.light, 0)],
  ])
  return canvas
}

/** Fills a disc of light around the point the context is centred on: the stops run from its middle to its edge. */
function fillRoundLight(
  context: CanvasRenderingContext2D,
  radius: number,
  stops: readonly (readonly [offset: number, colour: string])[],
): void {
  const light = context.createRadialGradient(0, 0, 0, 0, 0, radius)
  for (const [offset, colour] of stops) light.addColorStop(offset, colour)
  context.fillStyle = light
  context.fillRect(-radius, -radius, radius * 2, radius * 2)
}

interface Picture {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
}

/** A blank picture of the given size in canvas pixels, or null when the browser gives no drawing context. */
function newPicture(page: Document, width: number, height: number): Picture | null {
  const canvas = page.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width))
  canvas.height = Math.max(1, Math.ceil(height))
  const context = canvas.getContext('2d')
  return context ? { canvas, context } : null
}
