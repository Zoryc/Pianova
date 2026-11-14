import { vi } from 'vitest'

/*
 * Stand-ins for the parts of a browser the sky needs, for its tests only: a
 * canvas that remembers what was drawn on it, and a frame clock, a resize
 * observer and a reduced-motion setting that the tests control. Nothing in
 * the app imports this file.
 */

/** A rounded rectangle that was filled or outlined: position and size as handed to the canvas (CSS pixels). */
export interface PaintedBar {
  x: number
  y: number
  width: number
  height: number
  radius: number
  /** What it was filled with: a colour, or a gradient. */
  fill: unknown
  /** The colour of its outline, or null when it was only filled. */
  outline: string | null
  alpha: number
  blend: string
}

/** A picture that was copied onto the canvas, and where. */
export interface StampedImage {
  image: unknown
  x: number
  y: number
  width: number
  height: number
  alpha: number
  blend: string
}

export interface WrittenText {
  text: string
  x: number
  y: number
  font: string
  colour: unknown
  alpha: number
}

/** The outline drawn around a text. */
export interface TextEdge extends WrittenText {
  lineWidth: number
  lineJoin: string
}

/**
 * A key letter on a canvas: a ready-made picture of it that was copied
 * there. What it says and how it was written is read from the small canvas
 * the picture was made on.
 */
export interface StampedLetter {
  text: string
  /** The point the letter is centred on, on the canvas it was copied to (CSS pixels). */
  x: number
  y: number
  /** The font and the colour it was written in when its picture was made. */
  font: string
  colour: unknown
  /** How solid it was copied. */
  alpha: number
  /** The edge that was copied under it, from a picture of its own. Null when the letter has none. */
  edge: StampedEdge | null
}

export interface StampedEdge {
  text: string
  /** The point the edge is centred on, as for the letter. */
  x: number
  y: number
  font: string
  colour: unknown
  alpha: number
  lineWidth: number
  lineJoin: string
}

export interface FilledRect {
  x: number
  y: number
  width: number
  height: number
  fill: unknown
  alpha: number
  blend: string
}

export class FakeGradient {
  readonly stops: [offset: number, colour: string][] = []
  constructor(
    readonly kind: 'linear' | 'radial',
    readonly span: readonly number[],
  ) {}
  addColorStop(offset: number, colour: string): void {
    this.stops.push([offset, colour])
  }
}

interface ContextState {
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  globalAlpha: number
  globalCompositeOperation: string
  font: string
  textAlign: string
  textBaseline: string
  shadowColor: string
  shadowOffsetX: number
  blur: number
}

interface PathRect {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

/** Every drawing context made in a test, so that a test can ask what all of them were asked to do. */
const everyContext = new Set<FakeContext>()
/** The drawing context of each canvas: how a copied picture is traced back to what was drawn on it. */
const contextOfCanvas = new WeakMap<object, FakeContext>()

export class FakeContext {
  fillStyle: unknown = '#000000'
  strokeStyle: unknown = '#000000'
  lineWidth = 1
  lineJoin = 'miter'
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  textAlign = 'start'
  textBaseline = 'alphabetic'
  shadowColor = 'rgba(0, 0, 0, 0)'
  shadowOffsetX = 0

  /** What is on the canvas since it was last wiped. */
  bars: PaintedBar[] = []
  images: StampedImage[] = []
  texts: WrittenText[] = []
  textEdges: TextEdge[] = []
  rects: FilledRect[] = []
  discs = 0

  /** Counted over the whole life of the context. */
  wipes = 0
  gradientsMade = 0
  blursAsked = 0
  /**
   * How often the canvas was asked to write, to outline or to measure a
   * text, or to change its font. Each of those makes a real browser bring
   * the styles of the whole page up to date.
   */
  textCalls = 0
  /** Canvas pixels per unit, as last set with setTransform. */
  zoom = { x: 1, y: 1 }

  private blur = 0
  private typeface = '10px sans-serif'
  private path: PathRect[] = []
  private pathDiscs = 0
  private readonly saved: ContextState[] = []

  constructor(readonly canvas: HTMLCanvasElement) {
    everyContext.add(this)
    contextOfCanvas.set(canvas, this)
  }

  get font(): string {
    return this.typeface
  }
  set font(value: string) {
    this.textCalls++
    this.typeface = value
  }

  /**
   * The key letters that were copied onto this canvas since it was last
   * wiped, in the order they were copied. An edge counts with the letter
   * that was copied over it.
   */
  get letters(): StampedLetter[] {
    const letters: StampedLetter[] = []
    let edge: StampedEdge | null = null
    for (const stamp of this.images) {
      const picture = contextOfCanvas.get(stamp.image as object)
      const outlined = picture?.textEdges[0]
      const written = picture?.texts[0]
      if (picture && outlined) {
        edge = { ...outlined, ...placeOf(stamp, picture, outlined), alpha: stamp.alpha }
      } else if (picture && written) {
        const place = placeOf(stamp, picture, written)
        const under = edge && edge.x === place.x && edge.y === place.y ? edge : null
        letters.push({ ...written, ...place, alpha: stamp.alpha, edge: under })
        edge = null
      } else {
        edge = null
      }
    }
    return letters
  }

  /** Blurring is the costly thing a canvas can be asked for, so every request is counted. */
  get shadowBlur(): number {
    return this.blur
  }
  set shadowBlur(value: number) {
    if (value > 0) this.blursAsked++
    this.blur = value
  }

  setTransform(a: number, _b: number, _c: number, d: number): void {
    this.zoom = { x: a, y: d }
  }

  translate(): void {}

  scale(): void {}

  clearRect(x: number, y: number, width: number, height: number): void {
    const whole =
      x === 0 &&
      y === 0 &&
      width * this.zoom.x >= this.canvas.width &&
      height * this.zoom.y >= this.canvas.height
    if (!whole) return
    this.bars = []
    this.images = []
    this.texts = []
    this.textEdges = []
    this.rects = []
    this.discs = 0
    this.wipes++
  }

  createLinearGradient(...span: number[]): FakeGradient {
    this.gradientsMade++
    return new FakeGradient('linear', span)
  }

  createRadialGradient(...span: number[]): FakeGradient {
    this.gradientsMade++
    return new FakeGradient('radial', span)
  }

  save(): void {
    const { fillStyle, strokeStyle, lineWidth, globalAlpha, globalCompositeOperation } = this
    const { typeface: font, textAlign, textBaseline, shadowColor, shadowOffsetX, blur } = this
    this.saved.push({
      fillStyle,
      strokeStyle,
      lineWidth,
      globalAlpha,
      globalCompositeOperation,
      font,
      textAlign,
      textBaseline,
      shadowColor,
      shadowOffsetX,
      blur,
    })
  }

  restore(): void {
    const state = this.saved.pop()
    if (!state) return
    const { font, ...rest } = state
    Object.assign(this, rest)
    this.typeface = font
  }

  beginPath(): void {
    this.path = []
    this.pathDiscs = 0
  }

  roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    if (!(radius >= 0)) throw new RangeError('a canvas refuses a negative corner radius')
    this.path.push({ x, y, width, height, radius })
  }

  arc(): void {
    this.pathDiscs++
  }

  fill(): void {
    this.discs += this.pathDiscs
    for (const rect of this.path) {
      this.bars.push({
        ...rect,
        fill: this.fillStyle,
        outline: null,
        alpha: this.globalAlpha,
        blend: this.globalCompositeOperation,
      })
    }
  }

  /** An outline drawn around a shape that was just filled belongs to that shape. */
  stroke(): void {
    const outlined = this.bars.slice(-this.path.length)
    for (const bar of outlined) bar.outline = String(this.strokeStyle)
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({
      x,
      y,
      width,
      height,
      fill: this.fillStyle,
      alpha: this.globalAlpha,
      blend: this.globalCompositeOperation,
    })
  }

  /** Both ways a canvas is asked to copy a picture: the whole of it, or a part of it. */
  drawImage(image: unknown, ...numbers: number[]): void {
    const [x = 0, y = 0, width = 0, height = 0] = numbers.length > 4 ? numbers.slice(4) : numbers
    if ([x, y, width, height].some((value) => !Number.isFinite(value))) {
      throw new TypeError('a canvas refuses to copy a picture to a place that is not a number')
    }
    this.images.push({
      image,
      x,
      y,
      width,
      height,
      alpha: this.globalAlpha,
      blend: this.globalCompositeOperation,
    })
  }

  fillText(text: string, x: number, y: number): void {
    this.textCalls++
    this.texts.push({ text, x, y, font: this.font, colour: this.fillStyle, alpha: this.globalAlpha })
  }

  /** The outline of a text: kept apart from the texts themselves. */
  strokeText(text: string, x: number, y: number): void {
    this.textCalls++
    this.textEdges.push({
      text,
      x,
      y,
      font: this.font,
      colour: this.strokeStyle,
      alpha: this.globalAlpha,
      lineWidth: this.lineWidth,
      lineJoin: this.lineJoin,
    })
  }

  /** Every character is 0.6 times as wide as the font is tall, as in a typewriter face. */
  measureText(text: string): { width: number } {
    this.textCalls++
    const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? '10')
    return { width: text.length * size * 0.6 }
  }
}

/** True for a picture that something was written on: a key letter, or the edge of one. */
export function carriesText(image: unknown): boolean {
  const picture = contextOfCanvas.get(image as object)
  return picture !== undefined && picture.texts.length + picture.textEdges.length > 0
}

/**
 * Where a point of a copied picture came to lie on the canvas it was copied
 * to: `at` is the point as it was handed to the picture's own canvas.
 */
function placeOf(
  stamp: StampedImage,
  picture: FakeContext,
  at: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: stamp.x + (at.x * picture.zoom.x * stamp.width) / picture.canvas.width,
    y: stamp.y + (at.y * picture.zoom.y * stamp.height) / picture.canvas.height,
  }
}

/** The stand-in browser a test works with. */
export interface FakeBrowser {
  /** The size of every canvas on the page, in CSS pixels. Change it with `resizeTo`. */
  readonly size: { width: number; height: number }
  /** Animation frames: the ones waiting, and how many were asked for and cancelled so far. */
  readonly frames: {
    pending: Map<number, FrameRequestCallback>
    requested: number
    cancelled: number
    now: number
  }
  /** How many resize observers and reduced-motion listeners are connected right now. */
  observers(): number
  motionListeners(): number
  /** The elements the resize observers were asked to watch. */
  observed(): Element[]
  /** Lets the browser draw one frame, `ms` after the previous one. Returns how many callbacks ran. */
  frame(ms?: number): number
  /** Runs frames for `seconds` of animation. Returns how many callbacks ran. */
  play(seconds: number): number
  /** Runs frames until the animation stops by itself. Fails if it never does. Returns how many ran. */
  playUntilIdle(): number
  /** The box around the canvases changed size. */
  resizeTo(width: number, height: number): void
  setReducedMotion(reduced: boolean): void
  /** What `canvas` was asked to draw. */
  contextOf(canvas: HTMLCanvasElement): FakeContext
  /** Every drawing context made since the browser was installed, the hidden pictures included. */
  contexts(): FakeContext[]
}

export const FRAME_MS = 1000 / 60

/**
 * Replaces the canvas, the frame clock, the resize observer and the
 * reduced-motion setting of the test page by stand-ins. Call it in
 * `beforeEach`, and `vi.unstubAllGlobals()` in `afterEach`.
 */
export function installFakeBrowser(): FakeBrowser {
  const size = { width: 1300, height: 600 }
  const frames = {
    pending: new Map<number, FrameRequestCallback>(),
    nextId: 1,
    requested: 0,
    cancelled: 0,
    now: 5000,
  }
  const contexts = new WeakMap<HTMLCanvasElement, FakeContext>()
  const resizeObservers = new Set<FakeResizeObserver>()
  const motion = { reduced: false, listeners: new Set<() => void>() }
  everyContext.clear()

  class FakeResizeObserver {
    readonly observed: Element[] = []
    constructor(private readonly callback: ResizeObserverCallback) {
      resizeObservers.add(this)
    }
    observe(element: Element): void {
      this.observed.push(element)
    }
    unobserve(): void {}
    disconnect(): void {
      resizeObservers.delete(this)
    }
    fire(): void {
      this.callback([], this as unknown as ResizeObserver)
    }
  }

  const contextOf = (canvas: HTMLCanvasElement): FakeContext => {
    let context = contexts.get(canvas)
    if (!context) {
      context = new FakeContext(canvas)
      contexts.set(canvas, context)
    }
    return context
  }

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return contextOf(this)
  } as unknown as HTMLCanvasElement['getContext']
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => size.width,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => size.height,
  })

  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const id = frames.nextId++
    frames.pending.set(id, callback)
    frames.requested++
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    if (frames.pending.delete(id)) frames.cancelled++
  })
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return query.includes('prefers-reduced-motion') && motion.reduced
    },
    addEventListener: (_type: string, listener: () => void) => motion.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => motion.listeners.delete(listener),
  }))

  const frame = (ms = FRAME_MS): number => {
    frames.now += ms
    const callbacks = [...frames.pending.values()]
    frames.pending.clear()
    for (const callback of callbacks) callback(frames.now)
    return callbacks.length
  }

  const play = (seconds: number): number => {
    let ran = 0
    for (let i = 0; i < Math.round((seconds * 1000) / FRAME_MS); i++) ran += frame()
    return ran
  }

  const playUntilIdle = (): number => {
    let ran = 0
    while (frames.pending.size > 0) {
      ran += frame()
      if (ran > 5000) throw new Error('the animation never stopped')
    }
    return ran
  }

  return {
    size,
    frames,
    observers: () => resizeObservers.size,
    motionListeners: () => motion.listeners.size,
    observed: () => [...resizeObservers].flatMap((observer) => observer.observed),
    frame,
    play,
    playUntilIdle,
    resizeTo(width, height) {
      size.width = width
      size.height = height
      for (const observer of [...resizeObservers]) observer.fire()
    },
    setReducedMotion(reduced) {
      motion.reduced = reduced
      for (const listener of [...motion.listeners]) listener()
    },
    contextOf,
    contexts: () => [...everyContext],
  }
}
