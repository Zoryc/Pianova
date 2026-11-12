import type { PianoRange } from '../../core/layout'
import type { NoteBus } from '../../core/noteBus'
import { keyRectOf } from '../../core/pianoGeometry'
import type { Midi, NoteEvent } from '../../core/types'
import type { SkyProps } from './Sky'
import { SkyPainter } from './skyDraw'
import type { SkyPicture, SongPicture, Surface } from './skyDraw'
import {
  advanceBars,
  advanceImpacts,
  advanceSparks,
  barsAreMoving,
  createSparks,
  easePresence,
  emitSparks,
  frameSeconds,
  impactsAreMoving,
  indexFallingNotes,
  keepHeldBars,
  releaseBar,
  releaseImpact,
  seededRandom,
  settleImpacts,
  soundingCount,
  startBar,
  strikeImpact,
  strikeSparks,
} from './skyModel'
import type { FallingIndex, Impact, RisingBar } from './skyModel'

/** Everything the sky is told to show: the props of <Sky /> without the bus. */
export type SkyScene = Omit<SkyProps, 'bus'>

/** Above this, extra canvas pixels cost more than they show. */
const MAX_PIXEL_RATIO = 2
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
/** Used for the key letters when the page names no typeface. */
const FALLBACK_FONT = 'monospace'
/** Where the sparks' random numbers start. Any number will do. */
const SPARK_SEED = 7
/**
 * While a song is loaded and nothing moves, the sky looks this often
 * (milliseconds) whether the song has started or been moved to another place:
 * nothing tells it so.
 */
const SONG_WATCH_MS = 100

/**
 * Connects a canvas to the bus and keeps the sky on it up to date. Returns
 * null when the browser gives no drawing context: there is then no sky.
 */
export function runSky(canvas: HTMLCanvasElement, bus: NoteBus): SkyRunner | null {
  const context = canvas.getContext('2d')
  return context ? new SkyRunner(canvas, context, bus) : null
}

/**
 * Runs one sky: listens to the notes, moves the light forward frame by
 * frame, and draws it. Frames are only asked for while something moves; an
 * idle sky costs nothing.
 */
export class SkyRunner {
  private readonly canvas: HTMLCanvasElement
  private readonly bus: NoteBus
  private readonly painter: SkyPainter
  private readonly motion: MediaQueryList
  private readonly resizeObserver: ResizeObserver
  private readonly stopListening: () => void

  /** What to show. Null until `show` is first called. */
  private scene: SkyScene | null = null
  /** Null while the canvas has no area to draw on. */
  private surface: Surface | null = null

  private readonly bars: RisingBar[] = []
  private readonly impacts: Impact[] = []
  private readonly sparks = createSparks()
  private presence = 0
  private readonly random = seededRandom(SPARK_SEED)

  private frameId: number | null = null
  private lastFrameTime: number | null = null
  private songWatch: ReturnType<typeof setInterval> | null = null

  /** The notes of the loaded song, prepared for quick look-up, and where the song was in the last picture. */
  private songIndex: FallingIndex | null = null
  private drawnPosition: number | null = null
  /** Filled in again for every picture, instead of making new ones. */
  private songPicture: SongPicture | null = null
  private picture: SkyPicture | null = null

  constructor(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, bus: NoteBus) {
    this.canvas = canvas
    this.bus = bus
    this.painter = new SkyPainter(context, getComputedStyle(canvas).fontFamily || FALLBACK_FONT)
    this.motion = window.matchMedia(REDUCED_MOTION_QUERY)
    this.stopListening = bus.subscribe(this.onNote)
    this.resizeObserver = new ResizeObserver(this.onResize)
    this.resizeObserver.observe(canvas.parentElement ?? canvas)
    // Zooming the page changes devicePixelRatio, often without changing the size of the box.
    window.addEventListener('resize', this.onResize)
    this.motion.addEventListener('change', this.onMotionChange)
    canvas.addEventListener('contextrestored', this.onContextRestored)
    this.surface = fitCanvas(canvas)
  }

  /**
   * The latest settings of the sky. Light that is in the air stays there
   * when only its look changes. A new picture is drawn only when something
   * that shows has changed.
   */
  show(next: SkyScene): void {
    const previous = this.scene
    this.scene = next
    if (!previous) this.showHeldNotes()
    else this.follow(previous, next)
    this.watchSong(next.falling !== null)
    this.wake(!previous || !sameLook(previous, next) || this.songMoved())
  }

  /** Undoes everything: no listener, no timer and no frame is left behind, and the canvas is empty. */
  stop(): void {
    this.stopListening()
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.onResize)
    this.motion.removeEventListener('change', this.onMotionChange)
    this.canvas.removeEventListener('contextrestored', this.onContextRestored)
    this.stopLoop()
    this.watchSong(false)
    this.painter.clear()
  }

  // -------------------------------------------------------------------------
  // What happens
  // -------------------------------------------------------------------------

  private readonly onNote = (event: NoteEvent): void => {
    const { scene } = this
    if (!scene || !this.surface || !keyRectOf(event.midi, scene.range)) return
    if (event.type === 'on') {
      this.startNote(event.midi, scene, true)
    } else {
      releaseBar(this.bars, event.midi)
      releaseImpact(this.impacts, event.midi)
    }
    this.wake(true)
  }

  /*
   * The canvas may have changed size, down to nothing and back. Notes played
   * while it had no area have no light, so the ones that are still held get
   * theirs when the area comes back.
   */
  private readonly onResize = (): void => {
    const hadArea = this.surface !== null
    this.surface = fitCanvas(this.canvas)
    if (!this.surface) {
      this.forgetLight()
      this.stopLoop()
    } else if (!hadArea) {
      this.showHeldNotes()
    }
    // Resizing wipes a canvas, so it is painted again straight away instead of flickering until the next frame.
    this.draw()
    this.wake(false)
  }

  private readonly onMotionChange = (): void => {
    this.wake(true)
  }

  /*
   * The browser had taken the drawing away (a graphics driver that restarted,
   * a laptop that woke up) and now gives it back, with an empty canvas. An
   * idle sky would stay empty until the next note, and the ready-made
   * pictures may have been emptied too: they are made anew for this picture.
   */
  private readonly onContextRestored = (): void => {
    this.painter.forget()
    this.draw()
  }

  private readonly onSongWatch = (): void => {
    if (this.frameId === null) this.wake(this.songMoved())
  }

  private readonly onFrame = (time: number): void => {
    this.frameId = null
    const seconds = frameSeconds(this.lastFrameTime === null ? 0 : time - this.lastFrameTime)
    this.lastFrameTime = time
    this.step(seconds)
    this.draw()
    // When nothing moves any more, the picture just drawn stays and the loop ends here.
    if (this.isMoving()) this.frameId = requestAnimationFrame(this.onFrame)
  }

  // -------------------------------------------------------------------------
  // The light
  // -------------------------------------------------------------------------

  /**
   * A note is sounding: it gets its glow on the line and, in free play, its
   * bar. `struck` is false for a note that was already held when the sky
   * could first show it: it lights up without a flash or a burst of sparks.
   */
  private startNote(midi: Midi, scene: SkyScene, struck: boolean): void {
    const { surface } = this
    const impact = surface ? strikeImpact(this.impacts, midi, scene.range) : null
    if (!surface || !impact) return
    if (barsRise(scene)) startBar(this.bars, midi, scene.range)
    if (struck && !this.motion.matches) {
      strikeSparks(this.sparks, impact, scene.sparks, surface.width, this.random)
    } else {
      impact.flash = 0
    }
  }

  /** Light for every note the bus says is held: these started while the sky could not show them. */
  private showHeldNotes(): void {
    const { scene } = this
    if (!scene) return
    for (const midi of this.bus.getActiveNotes()) this.startNote(midi, scene, false)
  }

  /** The scene changed: drops the light that no longer belongs in it. */
  private follow(previous: SkyScene, next: SkyScene): void {
    if (!sameRange(previous.range, next.range)) {
      // The piano changed: every key is somewhere else, so the light of the old piano goes.
      this.forgetLight()
    } else if (barsRise(previous) !== barsRise(next)) {
      this.bars.length = 0
      if (barsRise(next)) {
        for (const midi of this.bus.getActiveNotes()) startBar(this.bars, midi, next.range)
      }
    }
    if (next.sparks === 'off') this.sparks.count = 0
  }

  private forgetLight(): void {
    this.bars.length = 0
    this.impacts.length = 0
    this.sparks.count = 0
    this.presence = 0
  }

  /** Moves the light forward by `seconds`. With reduced motion nothing moves by itself. */
  private step(seconds: number): void {
    const { scene, surface } = this
    if (!scene || !surface || this.motion.matches) return
    advanceBars(this.bars, seconds, surface.height)
    advanceImpacts(this.impacts, seconds)
    this.presence = easePresence(this.presence, soundingCount(this.impacts), seconds)
    emitSparks(this.sparks, this.impacts, scene.sparks, seconds, surface.width, this.random)
    advanceSparks(this.sparks, seconds)
  }

  /** Reduced motion: what is left is what stands still (held notes and their glow). */
  private settle(): void {
    keepHeldBars(this.bars)
    settleImpacts(this.impacts)
    this.sparks.count = 0
    this.presence = 0
  }

  /** True while the next frame would look different from this one. */
  private isMoving(): boolean {
    const { scene, surface } = this
    if (!scene || !surface) return false
    if (songIsFalling(scene)) return true
    if (this.motion.matches) return false
    const sounding = soundingCount(this.impacts)
    return (
      barsAreMoving(this.bars, surface.height) ||
      impactsAreMoving(this.impacts) ||
      this.sparks.count > 0 ||
      (scene.sparks !== 'off' && sounding > 0) ||
      this.presence !== sounding
    )
  }

  /** True when the loaded song is somewhere else, or has other notes, than in the last picture. */
  private songMoved(): boolean {
    const falling = this.scene?.falling
    if (!falling || !this.scene?.showBars) return false
    return (
      falling.getPosition() !== this.drawnPosition || falling.getNotes() !== this.songIndex?.notes
    )
  }

  // -------------------------------------------------------------------------
  // Frames
  // -------------------------------------------------------------------------

  /**
   * Something may have changed. Keeps the frames coming if anything moves.
   * If nothing does, the frames stop here and the picture as it now stands
   * is drawn once (when no frame was running, only if `redraw` asks for it).
   */
  private wake(redraw: boolean): void {
    if (this.motion.matches) this.settle()
    if (this.isMoving()) {
      this.startLoop()
      return
    }
    const wasRunning = this.frameId !== null
    this.stopLoop()
    if (wasRunning || redraw) this.draw()
  }

  private startLoop(): void {
    if (this.frameId !== null) return
    this.lastFrameTime = null
    this.frameId = requestAnimationFrame(this.onFrame)
  }

  private stopLoop(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
  }

  private watchSong(loaded: boolean): void {
    if (loaded && this.songWatch === null) {
      this.songWatch = setInterval(this.onSongWatch, SONG_WATCH_MS)
    } else if (!loaded && this.songWatch !== null) {
      clearInterval(this.songWatch)
      this.songWatch = null
    }
  }

  private draw(): void {
    const { scene, surface } = this
    if (!scene || !surface) {
      this.painter.clear()
      return
    }
    this.painter.draw(this.currentPicture(scene, surface))
  }

  /** What to draw right now. The same objects are filled in again each time. */
  private currentPicture(scene: SkyScene, surface: Surface): SkyPicture {
    const song = this.currentSong(scene)
    this.drawnPosition = song ? song.position : null
    const picture = (this.picture ??= {
      surface,
      range: scene.range,
      barStyle: scene.barStyle,
      glow: 0,
      background: scene.background,
      accent: scene.accent,
      customColour: scene.customColour,
      still: false,
      bars: this.bars,
      song,
      impacts: this.impacts,
      sparks: this.sparks,
      presence: 0,
    })
    picture.surface = surface
    picture.range = scene.range
    picture.barStyle = scene.barStyle
    picture.glow = clamp01(scene.glow)
    picture.background = scene.background
    picture.accent = scene.accent
    picture.customColour = scene.customColour
    picture.still = this.motion.matches
    picture.song = song
    picture.presence = this.presence
    return picture
  }

  /** The falling notes to draw, or null in free play and when light bars are off. */
  private currentSong(scene: SkyScene): SongPicture | null {
    const { falling } = scene
    if (!falling || !scene.showBars) return null
    const notes = falling.getNotes()
    if (this.songIndex?.notes !== notes) this.songIndex = indexFallingNotes(notes)
    const position = falling.getPosition()
    const song = (this.songPicture ??= { index: this.songIndex, position: 0, hints: scene.hints })
    song.index = this.songIndex
    song.position = Number.isFinite(position) ? position : 0
    song.hints = scene.hints
    return song
  }
}

/** Bars rise from the keys in free play only: while a song is loaded its notes fall instead. */
function barsRise(scene: SkyScene): boolean {
  return scene.showBars && scene.falling === null
}

function songIsFalling(scene: SkyScene): boolean {
  return scene.showBars && scene.falling !== null && scene.falling.isPlaying()
}

function sameRange(a: PianoRange, b: PianoRange): boolean {
  return a.first === b.first && a.last === b.last
}

/** True when both scenes would give the same picture of the same light. */
function sameLook(a: SkyScene, b: SkyScene): boolean {
  return (
    sameRange(a.range, b.range) &&
    a.showBars === b.showBars &&
    a.barStyle === b.barStyle &&
    a.sparks === b.sparks &&
    a.glow === b.glow &&
    a.background === b.background &&
    a.accent === b.accent &&
    a.customColour === b.customColour &&
    a.falling === b.falling &&
    a.hints === b.hints
  )
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/** Matches the canvas's pixel grid to its size on screen. Null while the canvas has no area to draw on. */
function fitCanvas(canvas: HTMLCanvasElement): Surface | null {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) return null
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  const pixelWidth = Math.max(1, Math.round(width * pixelRatio))
  const pixelHeight = Math.max(1, Math.round(height * pixelRatio))
  // Setting the size wipes a canvas, even to the size it already has.
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  return { width, height, scaleX: pixelWidth / width, scaleY: pixelHeight / height }
}
