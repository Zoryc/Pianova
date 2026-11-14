import type { LightPalette } from '../../core/colour'
import type { BarStyle, Midi } from '../../core/types'
import { barRadius } from './skyModel'
import { lightnessOf, withAlpha } from './skyColour'

/*
 * The pieces of light that are made once and then used many times a frame:
 * the glow of a bar, a spark, the bloom where a note meets the line, the
 * gradient that fills the bars, and the key letters on the falling notes.
 * The glows are "sprites": small pictures, blurred once when they are made,
 * that are then stamped onto the sky. Stamping a picture costs almost
 * nothing; asking the canvas to blur something on every frame does not.
 *
 * The letters are pictures for another reason. Every time a canvas is asked
 * to write (or only to change its font, or to measure a text), the browser
 * first brings the styles of the whole page up to date. While something on
 * the page is fading (the progress line of a song always is), Firefox then
 * paints the whole page again, piano included: once for every frame. So no
 * canvas is asked to write during a frame: each letter is written once, on a
 * small canvas of its own, and stamped from there.
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
  /**
   * The colour of a key letter written on a bar: the same all the way down,
   * so the letter never changes while it falls. A solid bar is a deep shade
   * far from the line and nearly white on it, so no colour alone reads on
   * all of it: `inkEdge` is a thin edge drawn around the letter in the
   * opposite tone, which shows only where the bar comes close to the colour
   * of the letter. Inside a neon bar the letter is the bright tint and has
   * no edge (null).
   */
  ink: string
  inkEdge: string | null
  /** The glow of a white-key bar and of a black-key bar. Null when there is no glow. */
  whiteGlow: BarGlow | null
  blackGlow: BarGlow | null
  spark: HTMLCanvasElement | null
  /** Null when there is no glow. */
  bloom: HTMLCanvasElement | null
}

/**
 * The letter of a computer key, written once, to be stamped onto every
 * falling note of that key. The letter and the edge around it are two
 * pictures of the same size, stamped one over the other, the edge first:
 * through a letter that fades at the top of the sky its edge shows a little,
 * which one picture of both would lose.
 */
export interface HintPicture {
  /** The letter alone. */
  letter: HTMLCanvasElement
  /** The edge around the letter, alone. Null when the letter has no edge. */
  edge: HTMLCanvasElement | null
  /** The height the letter is written at, in CSS pixels. */
  size: number
  /** Width and height of both pictures, in canvas pixels. */
  width: number
  height: number
  /** Where the pictures go across the sky: their left edge, in whole canvas pixels. */
  left: number
  /**
   * How far the line the letter stands on is below the middle of the letter,
   * and which row of the pictures that line is on. In canvas pixels. See
   * `drawHints` in skyDraw.ts.
   */
  baselineDrop: number
  baselineRow: number
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
  /**
   * The letter `label` for the falling notes of the key of `midi`, whose bars
   * are `barWidth` wide and centred on `centre` (CSS pixels across the sky),
   * in the ink of `palette`. Made the first time it is asked for and
   * remembered after that, one per key. Null when the bar is too narrow to
   * hold the letter.
   */
  hint(
    midi: Midi,
    label: string,
    palette: LightPalette,
    barWidth: number,
    centre: number,
  ): HintPicture | null
  /** Forgets everything made so far, so that it is made anew when next asked for: the pictures may have been emptied. */
  forget(): void
}

/** A spark's bright centre is this share of its picture; the rest is its soft edge. */
export const SPARK_CORE_SHARE = 0.3

/** Where the colours of a bar change, from the top of the sky (0) to the line (1). */
const DEEP_UNTIL = 0.04
const LIGHT_FROM = 0.42
/** The hot end of a bar, where it turns bright: this share of the sky above the line, but never more pixels than this. */
const HOT_SHARE = 0.1
const MAX_HOT_HEIGHT = 64
/**
 * A solid bar whose own colour is at least this light (0 = black, 1 = white)
 * carries dark key letters; a darker one carries white letters. Set by eye,
 * not by the rule used for the text on buttons (inkOn): that rule puts black
 * on a pure red, where white is the easier one to read.
 */
const DARK_INK_FROM = 0.4
/** How solid the edge around a key letter is. */
const INK_EDGE_ALPHA = 0.7

/**
 * Key letters: only on bars at least this wide, between these sizes, with
 * this much room around them. The narrowest bar gets the smallest letter:
 * the black keys of the full piano in a window 1366 pixels wide have bars
 * between 13 and 14 pixels wide, and their notes must carry a letter too.
 */
const MIN_HINT_BAR_WIDTH = 13
const MIN_HINT_SIZE = 8
const MAX_HINT_SIZE = 20
const HINT_SIZE_SHARE = 0.62
export const HINT_PADDING = 3
/** The edge around a letter: the width of its line as a share of the size of the letter, and at least this many pixels. Half of it shows. */
const HINT_EDGE_SHARE = 0.22
const MIN_HINT_EDGE = 2
/** Letters are measured once, at this size, and scaled from there. */
const HINT_MEASURE_SIZE = 100
const MAX_REMEMBERED_HINTS = 200
/** No letter reaches further above or below its middle than this share of its size. */
const HINT_REACH = 0.75
/** Spare pixels around a letter in its picture, for the soft rim of its edge. */
const HINT_MARGIN = 1

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

/** The letter kept for one key, and what it was made for: asked for anything else, it is made again. */
interface KeptHint {
  label: string
  barWidth: number
  centre: number
  ink: string
  inkEdge: string | null
  picture: HintPicture | null
}

/**
 * Makes and remembers the art for each palette, and the letter of each key.
 * `context` is the sky's own drawing context: the gradients are made by it,
 * and the small pictures by canvases created next to it. `fontFamily` is the
 * typeface of the key letters.
 */
export function createSkyArt(context: CanvasRenderingContext2D, fontFamily: string): SkyArt {
  const page = context.canvas.ownerDocument
  const made = new Map<LightPalette, LightArt>()
  const hints = new Map<Midi, KeptHint>()
  let current: ArtSpec | null = null

  /** How wide each label is when written one pixel tall, and the font for each whole size. */
  const labelWidths = new Map<string, number>()
  const fonts: string[] = []
  /** Only ever measures. Made when the first label is measured; null when the browser gives none. */
  let measurer: CanvasRenderingContext2D | null | undefined

  const prepare = (spec: ArtSpec): void => {
    if (current && sameSpec(current, spec)) return
    current = { ...spec }
    made.clear()
    hints.clear()
  }

  const of = (palette: LightPalette): LightArt => {
    const known = made.get(palette)
    if (known) return known
    if (made.size >= MAX_PALETTES) made.clear()
    const art = makeArt(context, palette, current)
    made.set(palette, art)
    return art
  }

  const fontOf = (size: number): string => (fonts[size] ??= `700 ${size}px ${fontFamily}`)

  /** Each label is measured only once. */
  const widthOf = (label: string): number => {
    const known = labelWidths.get(label)
    if (known !== undefined) return known
    if (measurer === undefined) {
      measurer = newPicture(page, 1, 1)?.context ?? null
      if (measurer) measurer.font = fontOf(HINT_MEASURE_SIZE)
    }
    const width = measurer ? measurer.measureText(label).width / HINT_MEASURE_SIZE : 0
    if (labelWidths.size >= MAX_REMEMBERED_HINTS) labelWidths.clear()
    labelWidths.set(label, width)
    return width
  }

  /** The largest whole size at which `label` fits a bar `barWidth` wide. 0 when the bar is too narrow for any letter. */
  const sizeFor = (label: string, barWidth: number): number => {
    if (barWidth < MIN_HINT_BAR_WIDTH) return 0
    const labelWidth = widthOf(label)
    const fitting = labelWidth > 0 ? (barWidth - HINT_PADDING * 2) / labelWidth : MAX_HINT_SIZE
    return Math.floor(Math.min(MAX_HINT_SIZE, barWidth * HINT_SIZE_SHARE, fitting))
  }

  const hint = (
    midi: Midi,
    label: string,
    palette: LightPalette,
    barWidth: number,
    centre: number,
  ): HintPicture | null => {
    const { ink, inkEdge } = of(palette)
    const kept = hints.get(midi)
    if (
      kept &&
      kept.label === label &&
      kept.barWidth === barWidth &&
      kept.centre === centre &&
      kept.ink === ink &&
      kept.inkEdge === inkEdge
    ) {
      return kept.picture
    }
    const size = sizeFor(label, barWidth)
    const picture =
      current && size >= MIN_HINT_SIZE
        ? makeHint(page, current.pixelRatio, {
            label,
            font: fontOf(size),
            size,
            width: widthOf(label) * size,
            centre,
            ink,
            inkEdge,
          })
        : null
    hints.set(midi, { label, barWidth, centre, ink, inkEdge, picture })
    return picture
  }

  const forget = (): void => {
    made.clear()
    hints.clear()
  }

  return { prepare, of, hint, forget }
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
  const skyHeight = spec?.skyHeight ?? 1
  return {
    barFill: makeBarFill(context, palette, skyHeight),
    neonFill: withAlpha(palette.light, NEON_FILL_ALPHA),
    neonLine: palette.bright,
    ...(spec?.barStyle === 'neon' ? neonInk(palette) : solidInk(palette)),
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

type Ink = Pick<LightArt, 'ink' | 'inkEdge'>

/** Inside a neon bar there is hardly any colour: the letter is the bright tint, with nothing around it. */
function neonInk(palette: LightPalette): Ink {
  return { ink: palette.bright, inkEdge: null }
}

/** White letters with a dark edge on a bar of a dark colour, dark letters with a pale edge on a bar of a light one. */
function solidInk(palette: LightPalette): Ink {
  return lightnessOf(palette.light) >= DARK_INK_FROM
    ? { ink: '#000000', inkEdge: withAlpha(palette.bright, INK_EDGE_ALPHA) }
    : { ink: '#ffffff', inkEdge: withAlpha('#000000', INK_EDGE_ALPHA) }
}

/** One letter to make a picture of. Sizes and places in CSS pixels. */
interface HintWanted {
  label: string
  font: string
  size: number
  /** How wide the label is at that size. */
  width: number
  /** Where across the sky the letter is centred. */
  centre: number
  ink: string
  inkEdge: string | null
}

/**
 * Writes one letter, and the edge around it, each on a small canvas of its
 * own, exactly as they would be written on the sky itself: the same calls,
 * at the same part of a pixel across the sky, so that the stamped letter is
 * the written one, pixel for pixel.
 */
function makeHint(page: Document, scale: number, wanted: HintWanted): HintPicture | null {
  const { size } = wanted
  // The line the edge is drawn with. Half of it lies outside the letter: that half shows.
  const line = wanted.inkEdge ? Math.max(MIN_HINT_EDGE, size * HINT_EDGE_SHARE) : 0
  const room = line / 2 + HINT_MARGIN
  // From the point the letter is centred on to the sides of the picture, in whole canvas pixels.
  const halfWidth = Math.ceil((wanted.width / 2 + room) * scale)
  const halfHeight = Math.ceil((size * HINT_REACH + room) * scale)
  const width = halfWidth * 2 + 1
  const height = halfHeight * 2 + 1
  const centre = wanted.centre * scale
  const left = Math.floor(centre) - halfWidth

  const letter = newPicture(page, width, height)
  const edge = wanted.inkEdge ? newPicture(page, width, height) : null
  if (!letter || (wanted.inkEdge && !edge)) return null
  const x = (centre - left) / scale
  const y = halfHeight / scale
  for (const picture of [edge, letter]) {
    if (!picture) continue
    // From here on, one unit is one CSS pixel.
    picture.context.setTransform(scale, 0, 0, scale, 0, 0)
    picture.context.font = wanted.font
    picture.context.textAlign = 'center'
    picture.context.textBaseline = 'middle'
  }
  if (edge && wanted.inkEdge) {
    // Round corners on the edge of the letters: a pointed one would stick out of a sharp letter like A or W.
    edge.context.lineJoin = 'round'
    edge.context.lineWidth = line
    edge.context.strokeStyle = wanted.inkEdge
    edge.context.strokeText(wanted.label, x, y)
  }
  letter.context.fillStyle = wanted.ink
  letter.context.fillText(wanted.label, x, y)

  const baselineDrop = baselineBelowMiddle(letter.context, wanted.label) * scale
  return {
    letter: letter.canvas,
    edge: edge ? edge.canvas : null,
    size,
    width,
    height,
    left,
    baselineDrop,
    baselineRow: Math.round(halfHeight + baselineDrop),
  }
}

/**
 * How far the line a text stands on is below its middle, for a context that
 * writes text around its middle. 0 when the browser does not say.
 */
function baselineBelowMiddle(context: CanvasRenderingContext2D, label: string): number {
  const drop = -context.measureText(label).alphabeticBaseline
  return Number.isFinite(drop) ? drop : 0
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
 * The glow of a bar `barWidth` wide: the light around it, and nothing inside
 * it. A bar is one even colour from edge to edge, solid or neon: no lighter
 * line is drawn down its middle. The picture holds the two ends of the bar
 * and a couple of rows of its middle; `stampGlow` in skyDraw.ts stretches the
 * middle to the height of the bar.
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
