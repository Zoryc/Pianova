import type { LightPalette } from '../../core/colour'
import type { PianoRange } from '../../core/layout'
import { pitchClass } from '../../core/notes'
import { keyRects } from '../../core/pianoGeometry'
import type { BackgroundName } from '../../core/types'
import { STAR_FIELDS, starField } from './skyModel'
import { NIGHT_COLOUR, withAlpha } from './skyColour'

/*
 * What is behind the light: the background the player chose, and the faint
 * lines that mark the octaves. It is painted once, onto a canvas of its own
 * that is never shown, and the sky then copies that picture on every frame.
 * It is painted again only when its size, the background, the colour or the
 * piano changes, or after the browser took the drawing away and gave it back.
 *
 * The picture is see-through wherever it has nothing to show, so the black
 * stage behind the sky is the black of every background.
 */

export interface BackdropSpec {
  /** Size of the sky in CSS pixels. */
  width: number
  height: number
  /** Canvas pixels per CSS pixel, across and down. */
  scaleX: number
  scaleY: number
  background: BackgroundName
  /** The palette of the chrome: the aurora and the octave lines take its colour. */
  palette: LightPalette
  range: PianoRange
}

/** True when both describe the same picture, so it need not be painted again. */
export function sameBackdrop(a: BackdropSpec, b: BackdropSpec): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.background === b.background &&
    a.palette === b.palette &&
    a.range.first === b.range.first &&
    a.range.last === b.range.last
  )
}

/** How solid the night's blue is at the top of the sky and at the line. */
const NIGHT_TOP_ALPHA = 0.04
const NIGHT_BOTTOM_ALPHA = 0.3
/** The corners lose up to this share of the night's colour. */
const VIGNETTE_STRENGTH = 0.75
/** The darkening starts this far from the middle and is complete this far, in half-diagonals of the sky. */
const VIGNETTE_START = 0.45
const VIGNETTE_END = 1.1

/** One star for every this many square pixels of sky, within these limits ("a few hundred"). */
const SKY_PER_STAR = 3200
const MIN_STARS = 120
const MAX_STARS = 420
const STAR_SEED = 20240229
/** Stars at least this bright get a faint ring of light around them. */
const HALO_STAR_BRIGHTNESS = 0.6
const STAR_HALO_SIZE = 3.2
const STAR_HALO_ALPHA = 0.12

/**
 * The glows of the aurora: where the middle of each is and how far it
 * reaches (as shares of the sky's width and height), which shade it has and
 * how solid it is at its middle.
 */
const AURORA_GLOWS: readonly AuroraGlow[] = [
  { x: 0.16, y: 1.02, reachX: 0.4, reachY: 0.88, shade: 'deep', alpha: 0.4 },
  { x: 0.8, y: 1.08, reachX: 0.52, reachY: 0.66, shade: 'deep', alpha: 0.38 },
  { x: 0.5, y: 1, reachX: 0.34, reachY: 0.46, shade: 'light', alpha: 0.11 },
]

interface AuroraGlow {
  x: number
  y: number
  reachX: number
  reachY: number
  shade: 'light' | 'deep'
  alpha: number
}

/** How visible the octave lines are, and the share of the sky's height over which they fade in from the top. */
const GUIDE_ALPHA = 0.13
const GUIDE_FADE_IN = 0.3
const PITCH_CLASS_OF_C = 0

/**
 * Paints the whole backdrop onto `canvas`, resizing it to fit. Returns false
 * when the browser gives no drawing context: there is then no backdrop.
 */
export function paintBackdrop(canvas: HTMLCanvasElement, spec: BackdropSpec): boolean {
  canvas.width = Math.max(1, Math.round(spec.width * spec.scaleX))
  canvas.height = Math.max(1, Math.round(spec.height * spec.scaleY))
  const context = canvas.getContext('2d')
  if (!context) return false

  // From here on, one unit is one CSS pixel.
  context.setTransform(spec.scaleX, 0, 0, spec.scaleY, 0, 0)
  context.clearRect(0, 0, spec.width, spec.height)
  if (spec.background !== 'black') paintNight(context, spec)
  if (spec.background === 'stars') paintStars(context, spec)
  if (spec.background !== 'black') paintVignette(context, spec)
  if (spec.background === 'aurora') paintAurora(context, spec)
  paintGuides(context, spec)
  return true
}

/** Near-black at the top, a deep blue-black at the line. */
function paintNight(context: CanvasRenderingContext2D, { width, height }: BackdropSpec): void {
  const night = context.createLinearGradient(0, 0, 0, height)
  night.addColorStop(0, withAlpha(NIGHT_COLOUR, NIGHT_TOP_ALPHA))
  night.addColorStop(1, withAlpha(NIGHT_COLOUR, NIGHT_BOTTOM_ALPHA))
  context.fillStyle = night
  context.fillRect(0, 0, width, height)
}

/** The same stars every time: their places come from a fixed seed. */
function paintStars(context: CanvasRenderingContext2D, spec: BackdropSpec): void {
  const { width, height, palette } = spec
  const count = Math.min(MAX_STARS, Math.max(MIN_STARS, Math.round((width * height) / SKY_PER_STAR)))
  const stars = starField(count, STAR_SEED)
  context.fillStyle = palette.bright
  for (let at = 0; at < stars.length; at += STAR_FIELDS) {
    const x = (stars[at] ?? 0) * width
    const y = (stars[at + 1] ?? 0) * height
    const radius = stars[at + 2] ?? 0
    const brightness = stars[at + 3] ?? 0
    if (brightness >= HALO_STAR_BRIGHTNESS) {
      fillDisc(context, x, y, radius * STAR_HALO_SIZE, brightness * STAR_HALO_ALPHA)
    }
    fillDisc(context, x, y, radius, brightness)
  }
  context.globalAlpha = 1
}

function fillDisc(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  context.globalAlpha = alpha
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
}

/**
 * Darker corners. What has been painted so far is rubbed out toward the
 * corners, and the black stage shows through. Only how solid the mask is
 * matters, not its colour.
 */
function paintVignette(context: CanvasRenderingContext2D, { width, height }: BackdropSpec): void {
  const middleX = width / 2
  const middleY = height * 0.6
  const reach = Math.hypot(width, height) / 2
  const shade = context.createRadialGradient(
    middleX,
    middleY,
    reach * VIGNETTE_START,
    middleX,
    middleY,
    reach * VIGNETTE_END,
  )
  shade.addColorStop(0, withAlpha(NIGHT_COLOUR, 0))
  shade.addColorStop(1, withAlpha(NIGHT_COLOUR, VIGNETTE_STRENGTH))
  context.globalCompositeOperation = 'destination-out'
  context.fillStyle = shade
  context.fillRect(0, 0, width, height)
  context.globalCompositeOperation = 'source-over'
}

/** A few very large, very soft glows in the colour of the light, low in the sky. */
function paintAurora(context: CanvasRenderingContext2D, spec: BackdropSpec): void {
  const { width, height, palette } = spec
  context.globalCompositeOperation = 'lighter'
  for (const glow of AURORA_GLOWS) {
    const colour = palette[glow.shade]
    // The gradient is a circle one unit across; the canvas is stretched so that it covers the glow's oval.
    const light = context.createRadialGradient(0, 0, 0, 0, 0, 1)
    light.addColorStop(0, withAlpha(colour, glow.alpha))
    light.addColorStop(0.55, withAlpha(colour, glow.alpha * 0.35))
    light.addColorStop(1, withAlpha(colour, 0))
    context.save()
    context.translate(glow.x * width, glow.y * height)
    context.scale(glow.reachX * width, glow.reachY * height)
    context.fillStyle = light
    context.fillRect(-1, -1, 2, 2)
    context.restore()
  }
  context.globalCompositeOperation = 'source-over'
}

/** A very faint line where each octave starts (the left edge of every C), from the top of the sky to the line. */
function paintGuides(context: CanvasRenderingContext2D, spec: BackdropSpec): void {
  const { width, height, scaleX, palette, range } = spec
  const line = context.createLinearGradient(0, 0, 0, height)
  line.addColorStop(0, withAlpha(palette.light, 0))
  line.addColorStop(GUIDE_FADE_IN, withAlpha(palette.light, GUIDE_ALPHA))
  line.addColorStop(1, withAlpha(palette.light, GUIDE_ALPHA))
  context.fillStyle = line
  // One canvas pixel wide at least, and on a whole pixel, so the line is crisp.
  const lineWidth = Math.max(1, Math.round(scaleX)) / scaleX
  for (const key of keyRects(range)) {
    if (pitchClass(key.midi) !== PITCH_CLASS_OF_C || key.left <= 0) continue
    const x = Math.round(key.left * width * scaleX) / scaleX
    context.fillRect(x, 0, lineWidth, height)
  }
}
