import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import type { NoteBus } from '../core/noteBus'
import type { NoteEvent } from '../core/types'
import {
  advanceBars,
  barRect,
  fadeHeight,
  frameSeconds,
  keepHeld,
  releaseBar,
  startBar,
  staticGlowHeight,
  staticGlowRect,
} from './noteTrailsModel'
import type { TrailBar } from './noteTrailsModel'
import './noteTrails.css'

export interface NoteTrailsProps {
  bus: NoteBus
  baseOctave: number
}

/** Above this, extra canvas pixels cost more than they show. */
const MAX_PIXEL_RATIO = 2
/** The look of a bar, in CSS pixels. Kept modest: a soft glow, not neon. */
const CORNER_RADIUS = 6
const GLOW_BLUR = 10
const BAR_OPACITY = 0.85
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Glowing trails that rise from the keys being played. Purely decorative: it
 * listens to the bus itself and draws on a canvas, so React never re-renders
 * while notes are moving.
 */
export function NoteTrails({ bus, baseOctave }: NoteTrailsProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** The piano position the trails were last started for; null until they first appear. */
  const startedForOctave = useRef<number | null>(null)

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    // Starting over when the piano moves lower or higher drops the bars of the
    // old position. Any other start means the trails have just appeared, and
    // then the notes that are already held get their bar too.
    const pianoMoved = startedForOctave.current !== null && startedForOctave.current !== baseOctave
    startedForOctave.current = baseOctave
    return runTrails(context, bus, baseOctave, !pianoMoved)
  }, [bus, baseOctave])

  return <canvas ref={canvasRef} className="note-trails" aria-hidden="true" />
}

/**
 * Connects the canvas to the bus and animates it. With `showHeldNotes`, the
 * notes that are held at this moment start with a bar, like notes played
 * later. Returns the function that undoes all of it.
 */
function runTrails(
  context: CanvasRenderingContext2D,
  bus: NoteBus,
  baseOctave: number,
  showHeldNotes: boolean,
): () => void {
  const canvas = context.canvas
  const colors = readColors(canvas)
  const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY)
  let bars: readonly TrailBar[] = []
  let surface: Surface | null = null
  let frameId: number | null = null
  let lastFrameTime: number | null = null

  const draw = (): void => {
    clearCanvas(context)
    if (surface) paintBars(context, surface, colors, bars, motionQuery.matches)
  }

  const onFrame = (time: number): void => {
    frameId = null
    const seconds = frameSeconds(lastFrameTime === null ? 0 : time - lastFrameTime)
    lastFrameTime = time
    bars = surface ? advanceBars(bars, seconds, surface.height) : []
    draw()
    // With no bars left the canvas has just been cleared and the loop ends here: an idle piano costs nothing.
    if (bars.length > 0) frameId = requestAnimationFrame(onFrame)
  }

  const startLoop = (): void => {
    if (frameId !== null || bars.length === 0) return
    lastFrameTime = null
    frameId = requestAnimationFrame(onFrame)
  }

  const stopLoop = (): void => {
    if (frameId !== null) cancelAnimationFrame(frameId)
    frameId = null
  }

  /** Shows the current bars: one still picture of the held notes for reduced motion, the animation otherwise. */
  const show = (): void => {
    if (motionQuery.matches) {
      stopLoop()
      bars = keepHeld(bars)
      draw()
    } else {
      startLoop()
    }
  }

  const onNote = (event: NoteEvent): void => {
    if (!surface) return
    bars =
      event.type === 'on'
        ? startBar(bars, event.midi, baseOctave)
        : releaseBar(bars, event.midi)
    show()
  }

  /** A bar for every note the bus says is held: these started while the trails could not show them. */
  const startHeldNotes = (): void => {
    if (!surface) return
    for (const midi of bus.getActiveNotes()) bars = startBar(bars, midi, baseOctave)
    if (bars.length > 0) show()
  }

  /** Matches the drawing area to the canvas. Without an area there is nothing to show, and the bars are dropped. */
  const fitToCanvas = (): void => {
    surface = fitCanvas(canvas)
    if (!surface) {
      bars = []
      stopLoop()
    }
    // Resizing wipes a canvas, so repaint straight away instead of flickering until the next frame.
    draw()
  }

  /*
   * The canvas may have changed size. The page takes the height of the light
   * trails away, down to nothing, when the window is low or a panel opens,
   * and gives it back afterwards. Notes played in between have no bar, so the
   * ones that are still held get theirs when the canvas has an area again.
   */
  const onResize = (): void => {
    const hadArea = surface !== null
    fitToCanvas()
    if (!hadArea) startHeldNotes()
  }

  const stopListening = bus.subscribe(onNote)
  const resizeObserver = new ResizeObserver(onResize)
  resizeObserver.observe(canvas.parentElement ?? canvas)
  // Zooming the page changes devicePixelRatio, often without changing the size of the box.
  window.addEventListener('resize', onResize)
  motionQuery.addEventListener('change', show)
  fitToCanvas()
  if (showHeldNotes) startHeldNotes()

  return () => {
    stopListening()
    resizeObserver.disconnect()
    window.removeEventListener('resize', onResize)
    motionQuery.removeEventListener('change', show)
    stopLoop()
    clearCanvas(context)
  }
}

/** The drawing area: its size in CSS pixels, and how many canvas pixels make one CSS pixel each way. */
interface Surface {
  width: number
  height: number
  scaleX: number
  scaleY: number
}

/** Matches the canvas's pixel grid to its size on screen. Null while the canvas has no area to draw on. */
function fitCanvas(canvas: HTMLCanvasElement): Surface | null {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) return null
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  const pixelWidth = Math.max(1, Math.round(width * pixelRatio))
  const pixelHeight = Math.max(1, Math.round(height * pixelRatio))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  return { width, height, scaleX: pixelWidth / width, scaleY: pixelHeight / height }
}

/** The two ends of a bar's gradient: `near` the keys and `far` from them. `far` also tints the glow. */
interface BarColors {
  near: string
  far: string
}

interface TrailColors {
  white: BarColors
  black: BarColors
}

function readColors(canvas: HTMLCanvasElement): TrailColors {
  const styles = getComputedStyle(canvas)
  // A missing variable falls back to the text colour: the canvas would throw on an empty colour.
  const read = (name: string): string => styles.getPropertyValue(name).trim() || styles.color
  const accent = read('--accent')
  return {
    white: { near: read('--accent-strong'), far: accent },
    black: { near: accent, far: read('--key-black-pressed') },
  }
}

function clearCanvas(context: CanvasRenderingContext2D): void {
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
}

/** Paints the bars on a cleared canvas. `still` (reduced motion) paints a short glow per held note instead. */
function paintBars(
  context: CanvasRenderingContext2D,
  surface: Surface,
  colors: TrailColors,
  bars: readonly TrailBar[],
  still: boolean,
): void {
  if (bars.length === 0) return
  const { height } = surface
  const rectOf = still ? staticGlowRect : barRect
  // From here on, one unit is one CSS pixel.
  context.setTransform(surface.scaleX, 0, 0, surface.scaleY, 0, 0)
  // Black-key bars go on top, as the black keys do on the piano.
  fillBars(context, surface, bars.filter((bar) => !bar.black), rectOf, colors.white)
  fillBars(context, surface, bars.filter((bar) => bar.black), rectOf, colors.black)
  if (still) fadeOut(context, surface, height - staticGlowHeight(height), height)
  else fadeOut(context, surface, 0, fadeHeight(height))
}

/** Fills one group of bars in a single pass, so the glow is computed once however many bars there are. */
function fillBars(
  context: CanvasRenderingContext2D,
  surface: Surface,
  bars: readonly TrailBar[],
  rectOf: typeof barRect,
  colors: BarColors,
): void {
  if (bars.length === 0) return
  const gradient = context.createLinearGradient(0, 0, 0, surface.height)
  gradient.addColorStop(0, colors.far)
  gradient.addColorStop(1, colors.near)
  context.save()
  context.globalAlpha = BAR_OPACITY
  context.fillStyle = gradient
  context.shadowColor = colors.far
  // Shadows ignore the canvas transform, so the blur is scaled by hand.
  context.shadowBlur = GLOW_BLUR * surface.scaleY
  context.beginPath()
  for (const bar of bars) {
    const rect = rectOf(bar, surface.width, surface.height)
    const radius = Math.min(CORNER_RADIUS, rect.width / 2)
    // A held bar runs past the bottom edge, so it looks attached to its key until it is released.
    const overhang = bar.held ? radius : 0
    context.roundRect(rect.x, rect.y, rect.width, rect.height + overhang, radius)
  }
  context.fill()
  context.restore()
}

/**
 * Erases what has been painted: everything above `top`, then gradually less
 * down to `bottom`, where nothing is erased. Works for any bar colour because
 * only the mask's opacity matters, not its colour.
 */
function fadeOut(
  context: CanvasRenderingContext2D,
  surface: Surface,
  top: number,
  bottom: number,
): void {
  const mask = context.createLinearGradient(0, top, 0, bottom)
  mask.addColorStop(0, 'rgba(0, 0, 0, 1)')
  mask.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.fillStyle = mask
  context.fillRect(0, 0, surface.width, bottom)
  context.restore()
}
