import { paletteFor, paletteForNote } from '../../core/colour'
import type { LightPalette } from '../../core/colour'
import type { PianoRange } from '../../core/layout'
import { BLACK_KEY_WIDTH_RATIO, keyRectOf, whiteKeyCount } from '../../core/pianoGeometry'
import type { AccentChoice, BackgroundName, BarStyle, Midi } from '../../core/types'
import { paintBackdrop, sameBackdrop } from './skyBackdrop'
import type { BackdropSpec } from './skyBackdrop'
import { NIGHT_COLOUR, withAlpha } from './skyColour'
import {
  backgroundBoost,
  barLeft,
  barRadius,
  barWidth,
  fadeHeight,
  fallingBottom,
  fallingHeight,
  firstNoteFrom,
  firstUnfinishedNote,
  lineGlow,
  skySpeed,
  sparkStrength,
  stillGlowHeight,
} from './skyModel'
import type { FallingIndex, Impact, RisingBar, Sparks } from './skyModel'
import { SPARK_CORE_SHARE, createSkyArt } from './skySprites'
import type { ArtSpec, BarGlow, LightArt, SkyArt } from './skySprites'

/*
 * Draws one picture of the sky. Everything here runs on every frame while
 * something moves, so it makes nothing new as it goes: gradients and glows
 * come ready-made from skySprites.ts, the background from skyBackdrop.ts,
 * and the few things kept between frames live in the painter.
 *
 * Light is added to light ("lighter" blending): where two glows overlap the
 * sky gets brighter, as it would with real light. The one exception is the
 * body of a bar above a black key, which covers the white-key bars behind
 * it, so that the two can still be told apart.
 */

/** The drawing area: its size in CSS pixels, and how many canvas pixels make one CSS pixel each way. */
export interface Surface {
  width: number
  height: number
  scaleX: number
  scaleY: number
}

/** The falling notes of a song, and where the song is. */
export interface SongPicture {
  index: FallingIndex
  /** Seconds into the song. */
  position: number
  /** Note -> the letter of the computer key that plays it. */
  hints: ReadonlyMap<Midi, string>
}

/** Everything one picture of the sky shows. */
export interface SkyPicture {
  surface: Surface
  range: PianoRange
  barStyle: BarStyle
  /** 0..1 */
  glow: number
  background: BackgroundName
  accent: AccentChoice
  customColour: string
  /** Reduced motion: no flashes, no brightening, and still glows in place of rising bars. */
  still: boolean
  /** The bars of free play. Not drawn while `song` is set. */
  bars: readonly RisingBar[]
  /** Null in free play, and when light bars are switched off. */
  song: SongPicture | null
  impacts: readonly Impact[]
  sparks: Sparks
  /** The number of sounding notes, smoothed (see `easePresence`). */
  presence: number
}

/** Bars above black keys are a little darker, as the keys are. */
const BLACK_BAR_ALPHA = 0.82
/** Neon bars: the width of the bright outline. */
const NEON_LINE = 2
/** A thin gap above every falling note, so that a note played twice in a row reads as two. */
const FALLING_GAP = 1.5
/** A crowded song never asks for more bars than this in one picture: the ones furthest away wait. */
const MAX_FALLING_BARS = 400

/** Key letters: only on bars at least this wide, between these sizes, with this much room around them. */
const MIN_HINT_BAR_WIDTH = 14
const MIN_HINT_SIZE = 8
const MAX_HINT_SIZE = 20
const HINT_SIZE_SHARE = 0.62
const HINT_PADDING = 3
/** Letters are measured once, at this size, and scaled from there. */
const HINT_MEASURE_SIZE = 100
const MAX_REMEMBERED_HINTS = 200

/** The bloom where a note meets the line: about two key widths of bright light, with a faint edge beyond. */
const BLOOM_KEY_WIDTHS = 4.8
/** At no glow the bloom would be this share of its full size. */
const BLOOM_SMALLEST = 0.65
/** More than 1, so that the bloom is already at its brightest a little before the glow is at its strongest. */
const BLOOM_ALPHA = 1.25
/** A new note makes its bloom this much bigger and brighter for a moment. */
const FLASH_GROWTH = 0.4
const FLASH_ALPHA = 0.5

/** The band of light that lies on the line: its height with no glow and what full glow adds, in pixels. */
const LINE_BAND_HEIGHT = 14
const LINE_BAND_GROWTH = 46
const LINE_BAND_ALPHA = 0.85

/** A spark is brightest for the first part of its life, then fades. */
const SPARK_FADE_START = 0.55
/** By the end of its life a spark has shrunk to this share of its size. */
const SPARK_SMALLEST = 0.5

/** Anything fainter than this cannot be seen and is not drawn. */
const TOO_FAINT = 0.004

/** Draws pictures of the sky on one canvas, and keeps between frames what would be costly to make again. */
export class SkyPainter {
  private readonly context: CanvasRenderingContext2D
  private readonly fontFamily: string
  private readonly art: SkyArt
  private readonly artSpec: ArtSpec = {
    skyHeight: 0,
    whiteBarWidth: 0,
    blackBarWidth: 0,
    barStyle: 'solid',
    glow: 0,
    pixelRatio: 1,
  }

  /** The background, painted on a canvas of its own. Null until first needed, or when it cannot be made. */
  private backdrop: HTMLCanvasElement | null = null
  private backdropPainted: BackdropSpec | null = null
  private backdropWanted: BackdropSpec | null = null

  /** The mask that fades the top of the bars out, and the span it was made for. */
  private fade: CanvasGradient | null = null
  private fadeTop = Number.NaN
  private fadeBottom = Number.NaN

  /** The band of light on the line, and what it was made for. */
  private band: CanvasGradient | null = null
  private bandPalette: LightPalette | null = null
  private bandTop = Number.NaN
  private bandBottom = Number.NaN

  /** The notes of the song that are in this picture: from this index up to, but not including, that one. */
  private fallingFrom = 0
  private fallingTo = 0

  /** How wide each key letter is when written one pixel tall, and the font for each whole size. */
  private readonly hintWidths = new Map<string, number>()
  private readonly hintFonts: string[] = []

  /** `fontFamily` is the typeface of the key letters. */
  constructor(context: CanvasRenderingContext2D, fontFamily: string) {
    this.context = context
    this.fontFamily = fontFamily
    this.art = createSkyArt(context)
  }

  /** Empties the canvas. */
  clear(): void {
    const { context } = this
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  }

  /**
   * Draws one picture, from nothing. The light goes onto the empty canvas
   * first, so that the top of the bars can be faded by rubbing them out; the
   * background is then put behind it.
   */
  draw(picture: SkyPicture): void {
    const { context } = this
    const { surface } = picture
    this.clear()
    // From here on, one unit is one CSS pixel.
    context.setTransform(surface.scaleX, 0, 0, surface.scaleY, 0, 0)
    this.prepareArt(picture)
    if (picture.song) this.findFallingNotes(picture, picture.song)

    // Bars above white keys first, then bars above black keys over them, as the keys themselves lie.
    this.drawBars(picture, false)
    this.drawBars(picture, true)
    this.fadeBars(picture)

    this.drawLineGlow(picture)
    this.drawBlooms(picture)
    this.drawSparks(picture)
    if (picture.song) this.drawHints(picture, picture.song)
    this.drawBackdrop(picture)

    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
  }

  private prepareArt(picture: SkyPicture): void {
    const whiteKey = picture.surface.width / Math.max(1, whiteKeyCount(picture.range))
    this.artSpec.skyHeight = picture.surface.height
    this.artSpec.whiteBarWidth = barWidth(whiteKey)
    this.artSpec.blackBarWidth = barWidth(whiteKey * BLACK_KEY_WIDTH_RATIO)
    this.artSpec.barStyle = picture.barStyle
    this.artSpec.glow = picture.glow
    this.artSpec.pixelRatio = picture.surface.scaleX
    this.art.prepare(this.artSpec)
  }

  private artFor(picture: SkyPicture, midi: Midi): LightArt {
    return this.art.of(paletteForNote(midi, picture.accent, picture.customColour))
  }

  // -------------------------------------------------------------------------
  // Bars
  // -------------------------------------------------------------------------

  /** The bars above the white keys, or the ones above the black keys. */
  private drawBars(picture: SkyPicture, black: boolean): void {
    if (picture.song) this.drawFallingNotes(picture, picture.song, black)
    else if (picture.still) this.drawStillGlows(picture, black)
    else this.drawRisingBars(picture, black)
  }

  private drawRisingBars(picture: SkyPicture, black: boolean): void {
    const { surface, bars } = picture
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]
      if (!bar || bar.black !== black) continue
      const keyWidth = bar.width * surface.width
      const width = barWidth(keyWidth)
      // A held bar runs past the line, so it looks attached to its key until it is let go.
      const overhang = bar.held ? barRadius(width, bar.height) : 0
      const top = surface.height - bar.bottom - bar.height
      this.drawBar(
        picture,
        bar.midi,
        bar.black,
        barLeft(bar.left * surface.width, keyWidth),
        top,
        width,
        bar.height + overhang,
      )
    }
  }

  /** Reduced motion: a short still glow above every held key, in place of a bar that grows. */
  private drawStillGlows(picture: SkyPicture, black: boolean): void {
    const { surface, bars } = picture
    const height = stillGlowHeight(surface.height)
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]
      if (!bar || bar.black !== black) continue
      const keyWidth = bar.width * surface.width
      this.drawBar(
        picture,
        bar.midi,
        bar.black,
        barLeft(bar.left * surface.width, keyWidth),
        surface.height - height,
        barWidth(keyWidth),
        height,
      )
    }
  }

  private drawFallingNotes(picture: SkyPicture, song: SongPicture, black: boolean): void {
    const { surface, range } = picture
    const { notes } = song.index
    const speed = skySpeed(surface.height)
    for (let i = this.fallingFrom; i < this.fallingTo; i++) {
      const note = notes[i]
      const key = note ? keyRectOf(note.midi, range) : null
      if (!note || !key || key.black !== black) continue
      const height = fallingHeight(note, speed)
      const top = surface.height - fallingBottom(note, song.position, speed) - height
      // A note between the two ends of the search may have ended already: it has sunk below the line.
      if (top >= surface.height) continue
      const keyWidth = key.width * surface.width
      this.drawBar(
        picture,
        note.midi,
        key.black,
        barLeft(key.left * surface.width, keyWidth),
        top + FALLING_GAP,
        barWidth(keyWidth),
        height - FALLING_GAP,
      )
    }
  }

  /**
   * Finds the notes that are in the picture: the first one that has not
   * ended yet, up to the last one that is low enough to have entered the sky.
   * Both are found by halving the sorted notes, never by walking the song.
   */
  private findFallingNotes(picture: SkyPicture, song: SongPicture): void {
    const { height } = picture.surface
    const lastTime = song.position + height / skySpeed(height)
    this.fallingFrom = firstUnfinishedNote(song.index, song.position)
    this.fallingTo = Math.min(
      firstNoteFrom(song.index, lastTime),
      this.fallingFrom + MAX_FALLING_BARS,
    )
  }

  /**
   * One bar and its glow. `top` is measured down from the top of the sky.
   * A bar above a white key is light added to the light already there. A bar
   * above a black key covers what is behind it, as its key covers the white
   * keys; only its glow is added.
   */
  private drawBar(
    picture: SkyPicture,
    midi: Midi,
    black: boolean,
    left: number,
    top: number,
    width: number,
    height: number,
  ): void {
    if (!(height > 0)) return
    const { context } = this
    const art = this.artFor(picture, midi)
    context.globalCompositeOperation = black ? 'source-over' : 'lighter'
    context.globalAlpha = black ? BLACK_BAR_ALPHA : 1
    if (picture.barStyle === 'neon' && Math.min(width, height) > NEON_LINE * 2) {
      this.outlineBar(art, left, top, width, height)
    } else {
      context.beginPath()
      context.roundRect(left, top, width, height, barRadius(width, height))
      context.fillStyle = art.barFill
      context.fill()
    }
    const glow = black ? art.blackGlow : art.whiteGlow
    if (!glow) return
    context.globalCompositeOperation = 'lighter'
    stampGlow(context, glow, left, top, width, height)
  }

  /** Neon: a bright line just inside the edge of the bar, around a faint fill. */
  private outlineBar(art: LightArt, left: number, top: number, width: number, height: number): void {
    const { context } = this
    const inset = NEON_LINE / 2
    const innerWidth = width - NEON_LINE
    const innerHeight = height - NEON_LINE
    context.beginPath()
    context.roundRect(
      left + inset,
      top + inset,
      innerWidth,
      innerHeight,
      Math.max(0, barRadius(width, height) - inset),
    )
    context.fillStyle = art.neonFill
    context.fill()
    context.lineWidth = NEON_LINE
    context.strokeStyle = art.neonLine
    context.stroke()
  }

  /**
   * Fades the bars out toward the top of the sky, by rubbing out what has
   * been drawn so far. With still glows, everything above them is rubbed out
   * and the glows fade toward their own top.
   */
  private fadeBars(picture: SkyPicture): void {
    const { context } = this
    const { width, height } = picture.surface
    const stillGlows = picture.still && picture.song === null
    const top = stillGlows ? height - stillGlowHeight(height) : 0
    const bottom = stillGlows ? height : fadeHeight(height)
    if (!this.fade || this.fadeTop !== top || this.fadeBottom !== bottom) {
      // Only how solid the mask is matters, not its colour.
      this.fade = context.createLinearGradient(0, top, 0, bottom)
      this.fade.addColorStop(0, withAlpha(NIGHT_COLOUR, 1))
      this.fade.addColorStop(1, withAlpha(NIGHT_COLOUR, 0))
      this.fadeTop = top
      this.fadeBottom = bottom
    }
    context.globalCompositeOperation = 'destination-out'
    context.globalAlpha = 1
    context.fillStyle = this.fade
    context.fillRect(0, 0, width, bottom)
    context.globalCompositeOperation = 'lighter'
  }

  // -------------------------------------------------------------------------
  // The line, the blooms and the sparks
  // -------------------------------------------------------------------------

  /** A band of light lying on the line. The more notes sound at once, the brighter it is. */
  private drawLineGlow(picture: SkyPicture): void {
    if (picture.still) return
    const strength = lineGlow(picture.presence) * picture.glow * LINE_BAND_ALPHA
    if (strength < TOO_FAINT) return

    const { context } = this
    const { width, height } = picture.surface
    const palette = paletteFor(picture.accent, picture.customColour)
    const top = height - (LINE_BAND_HEIGHT + LINE_BAND_GROWTH * picture.glow)
    if (
      !this.band ||
      this.bandPalette !== palette ||
      this.bandTop !== top ||
      this.bandBottom !== height
    ) {
      this.band = context.createLinearGradient(0, top, 0, height)
      this.band.addColorStop(0, withAlpha(palette.light, 0))
      this.band.addColorStop(0.6, withAlpha(palette.light, 0.16))
      this.band.addColorStop(0.92, withAlpha(palette.light, 0.55))
      this.band.addColorStop(1, withAlpha(palette.bright, 0.9))
      this.bandPalette = palette
      this.bandTop = top
      this.bandBottom = height
    }
    context.globalAlpha = strength
    context.fillStyle = this.band
    context.fillRect(0, top, width, height - top)
  }

  /** The soft bright light where each sounding note meets the line. */
  private drawBlooms(picture: SkyPicture): void {
    const { glow, surface, impacts } = picture
    if (!(glow > 0)) return
    const { context } = this
    const keyWidth = surface.width / Math.max(1, whiteKeyCount(picture.range))
    const restingSize = keyWidth * BLOOM_KEY_WIDTHS * (BLOOM_SMALLEST + (1 - BLOOM_SMALLEST) * glow)
    for (let i = 0; i < impacts.length; i++) {
      const impact = impacts[i]
      const bloom = impact ? this.artFor(picture, impact.midi).bloom : null
      if (!impact || !bloom) continue
      // Squared, so that most of the flash is gone well before it ends.
      const flash = picture.still ? 0 : impact.flash * impact.flash
      const size = restingSize * (1 + FLASH_GROWTH * flash)
      context.globalAlpha = Math.min(1, impact.level * glow * (BLOOM_ALPHA + FLASH_ALPHA * flash))
      context.drawImage(
        bloom,
        impact.centre * surface.width - size / 2,
        surface.height - size / 2,
        size,
        size,
      )
    }
  }

  private drawSparks(picture: SkyPicture): void {
    const { context } = this
    const { sparks, surface } = picture
    for (let i = 0; i < sparks.count; i++) {
      const spark = this.artFor(picture, sparks.midi[i] ?? 0).spark
      if (!spark) continue
      const strength = sparkStrength(sparks, i)
      const shrink = SPARK_SMALLEST + (1 - SPARK_SMALLEST) * strength
      const half = ((sparks.radius[i] ?? 0) * shrink) / SPARK_CORE_SHARE
      context.globalAlpha = Math.min(1, strength / SPARK_FADE_START)
      context.drawImage(
        spark,
        (sparks.x[i] ?? 0) - half,
        surface.height - (sparks.y[i] ?? 0) - half,
        half * 2,
        half * 2,
      )
    }
  }

  // -------------------------------------------------------------------------
  // Key letters on falling notes
  // -------------------------------------------------------------------------

  /**
   * Writes, on each falling note that a computer key can play, the letter of
   * that key: at the lower end of the bar, which is the end that lands first.
   * While the note sounds the letter rests on the line.
   */
  private drawHints(picture: SkyPicture, song: SongPicture): void {
    if (song.hints.size === 0) return
    const { context } = this
    const { surface, range } = picture
    const { notes } = song.index
    const speed = skySpeed(surface.height)
    const fade = fadeHeight(surface.height)
    let size = 0
    context.globalCompositeOperation = 'source-over'
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    for (let i = this.fallingFrom; i < this.fallingTo; i++) {
      const note = notes[i]
      const label = note ? song.hints.get(note.midi) : undefined
      const key = note && label ? keyRectOf(note.midi, range) : null
      if (!note || !label || !key) continue
      const keyWidth = key.width * surface.width
      const width = barWidth(keyWidth)
      if (width < MIN_HINT_BAR_WIDTH) continue

      const wanted = this.hintSize(label, width)
      const bottom = surface.height - fallingBottom(note, song.position, speed)
      const top = bottom - fallingHeight(note, speed) + FALLING_GAP
      const restsAt = Math.min(bottom, surface.height)
      // Only when the part of the bar that shows is tall enough to hold the letter.
      if (wanted < MIN_HINT_SIZE || restsAt - Math.max(top, 0) < wanted + HINT_PADDING * 2) continue

      if (wanted !== size) {
        size = wanted
        context.font = this.hintFont(size)
      }
      const middle = restsAt - HINT_PADDING - size / 2
      // The letter fades with its bar at the top of the sky.
      context.globalAlpha = Math.min(1, Math.max(0, middle / fade))
      context.fillStyle = this.artFor(picture, note.midi).ink
      context.fillText(label, barLeft(key.left * surface.width, keyWidth) + width / 2, middle)
    }
  }

  /** The largest whole size at which `label` fits a bar `width` wide. Each label is measured only once. */
  private hintSize(label: string, width: number): number {
    let labelWidth = this.hintWidths.get(label)
    if (labelWidth === undefined) {
      this.context.font = this.hintFont(HINT_MEASURE_SIZE)
      labelWidth = this.context.measureText(label).width / HINT_MEASURE_SIZE
      if (this.hintWidths.size >= MAX_REMEMBERED_HINTS) this.hintWidths.clear()
      this.hintWidths.set(label, labelWidth)
    }
    const fitting = labelWidth > 0 ? (width - HINT_PADDING * 2) / labelWidth : MAX_HINT_SIZE
    return Math.floor(Math.min(MAX_HINT_SIZE, width * HINT_SIZE_SHARE, fitting))
  }

  private hintFont(size: number): string {
    return (this.hintFonts[size] ??= `700 ${size}px ${this.fontFamily}`)
  }

  // -------------------------------------------------------------------------
  // The background
  // -------------------------------------------------------------------------

  /**
   * Puts the background behind everything drawn so far, a little brighter
   * while notes sound. It is a ready-made picture: only copied here, and
   * painted again only when it would look different.
   */
  private drawBackdrop(picture: SkyPicture): void {
    const backdrop = this.readyBackdrop(picture)
    if (!backdrop) return
    const { context } = this
    const { width, height } = picture.surface
    context.globalAlpha = 1
    context.globalCompositeOperation = 'destination-over'
    context.drawImage(backdrop, 0, 0, width, height)

    const boost = picture.still ? 0 : backgroundBoost(picture.presence)
    if (boost < TOO_FAINT) return
    context.globalAlpha = boost
    context.globalCompositeOperation = 'lighter'
    context.drawImage(backdrop, 0, 0, width, height)
  }

  private readyBackdrop(picture: SkyPicture): HTMLCanvasElement | null {
    const wanted = this.wantedBackdrop(picture)
    if (this.backdropPainted && sameBackdrop(this.backdropPainted, wanted)) return this.backdrop

    this.backdrop ??= this.context.canvas.ownerDocument.createElement('canvas')
    if (!paintBackdrop(this.backdrop, wanted)) this.backdrop = null
    this.backdropPainted = { ...wanted }
    return this.backdrop
  }

  /** What the background should show now. The same object is filled in again on every frame. */
  private wantedBackdrop(picture: SkyPicture): BackdropSpec {
    const { surface } = picture
    const palette = paletteFor(picture.accent, picture.customColour)
    const wanted = (this.backdropWanted ??= {
      width: 0,
      height: 0,
      scaleX: 1,
      scaleY: 1,
      background: picture.background,
      palette,
      range: picture.range,
    })
    wanted.width = surface.width
    wanted.height = surface.height
    wanted.scaleX = surface.scaleX
    wanted.scaleY = surface.scaleY
    wanted.background = picture.background
    wanted.palette = palette
    wanted.range = picture.range
    return wanted
  }
}

/**
 * Stamps the glow of a bar. The picture of the glow holds the two ends of a
 * bar and a strip of its middle: the ends are copied as they are and the
 * strip is stretched between them, so one picture serves bars of any height.
 * A bar shorter than the two ends together gets a part of each.
 */
function stampGlow(
  context: CanvasRenderingContext2D,
  glow: BarGlow,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const { image, margin, cap, scale } = glow
  const end = Math.min(cap, height / 2)
  const x = left - margin
  const across = width + margin * 2
  const sourceWidth = glow.width * scale
  const endRows = (margin + end) * scale

  context.drawImage(image, 0, 0, sourceWidth, endRows, x, top - margin, across, margin + end)
  if (height > cap * 2) {
    const middleRow = (margin + cap) * scale
    context.drawImage(image, 0, middleRow, sourceWidth, 1, x, top + cap, across, height - cap * 2)
  }
  context.drawImage(
    image,
    0,
    glow.height * scale - endRows,
    sourceWidth,
    endRows,
    x,
    top + height - end,
    across,
    margin + end,
  )
}
