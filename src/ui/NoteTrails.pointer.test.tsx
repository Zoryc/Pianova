// @vitest-environment jsdom
/**
 * The light trails as a whole: the real <NoteTrails /> on a real NoteBus,
 * drawing on a stand-in canvas that remembers what was painted, with the
 * browser's frame clock, ResizeObserver and reduced-motion setting replaced
 * by ones the tests control.
 *
 * The canvas is 1100 x 160 CSS pixels unless a test changes it, so every
 * white key is 50 wide.
 */
import { StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keyRect } from '../core/keyGeometry'
import { NoteBus } from '../core/noteBus'
import { NoteTrails } from './NoteTrails'
import {
  MAX_BARS,
  MAX_FRAME_MS,
  MIN_BAR_HEIGHT,
  staticGlowHeight,
  trailSpeed,
} from './noteTrailsModel'

const BASE = 3
const C4 = 60
const C_SHARP_4 = 61
const D4 = 62
const FRAME_MS = 16

const THEME: Readonly<Record<string, string>> = {
  '--accent': '#a1a1a1',
  '--accent-strong': '#b2b2b2',
  '--key-black-pressed': '#c3c3c3',
}

// ---------------------------------------------------------------------------
// The stand-in canvas
// ---------------------------------------------------------------------------

interface PaintedBar {
  /** Position and size as handed to the canvas: CSS pixels, y measured down from the top. */
  x: number
  y: number
  width: number
  height: number
  radius: number
  /** The colours of the gradient the bar was filled with, top first. */
  colors: string[]
  shadowColor: string
  opacity: number
}

class FakeGradient {
  readonly stops: string[] = []
  addColorStop(_offset: number, color: string): void {
    this.stops.push(color)
  }
}

interface ContextState {
  fillStyle: unknown
  shadowColor: string
  shadowBlur: number
  globalAlpha: number
  globalCompositeOperation: string
}

class FakeContext {
  fillStyle: unknown = '#000000'
  shadowColor = 'rgba(0, 0, 0, 0)'
  shadowBlur = 0
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  /** Bars on the canvas since it was last wiped. */
  painted: PaintedBar[] = []
  /** How many times the whole canvas was wiped. */
  wipes = 0
  /** How many times bars were painted. */
  paints = 0
  scale = { x: 1, y: 1 }
  private path: Omit<PaintedBar, 'colors' | 'shadowColor' | 'opacity'>[] = []
  private readonly saved: ContextState[] = []

  constructor(readonly canvas: HTMLCanvasElement) {}

  setTransform(a: number, _b: number, _c: number, d: number): void {
    this.scale = { x: a, y: d }
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    const whole =
      x === 0 && y === 0 && width * this.scale.x >= this.canvas.width && height * this.scale.y >= this.canvas.height
    if (whole) {
      this.painted = []
      this.wipes++
    }
  }

  createLinearGradient(): FakeGradient {
    return new FakeGradient()
  }

  save(): void {
    const { fillStyle, shadowColor, shadowBlur, globalAlpha, globalCompositeOperation } = this
    this.saved.push({ fillStyle, shadowColor, shadowBlur, globalAlpha, globalCompositeOperation })
  }

  restore(): void {
    const state = this.saved.pop()
    if (state) Object.assign(this, state)
  }

  beginPath(): void {
    this.path = []
  }

  roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    if (!(radius >= 0)) throw new RangeError('a canvas refuses a negative corner radius')
    this.path.push({ x, y, width, height, radius })
  }

  fill(): void {
    this.paints++
    const colors = this.fillStyle instanceof FakeGradient ? this.fillStyle.stops : [String(this.fillStyle)]
    for (const rect of this.path) {
      this.painted.push({ ...rect, colors, shadowColor: this.shadowColor, opacity: this.globalAlpha })
    }
  }

  /** Only used to fade the picture out: nothing to remember. */
  fillRect(): void {}
}

const contexts = new WeakMap<HTMLCanvasElement, FakeContext>()
const size = { width: 1100, height: 160 }

// ---------------------------------------------------------------------------
// The stand-in browser: frames, resize observer, reduced motion
// ---------------------------------------------------------------------------

const frames = {
  pending: new Map<number, FrameRequestCallback>(),
  nextId: 1,
  now: 5000,
  requested: 0,
  cancelled: 0,
}

/** Lets the browser draw one frame, `ms` after the previous one. */
function frame(ms = FRAME_MS): void {
  frames.now += ms
  const callbacks = [...frames.pending.values()]
  frames.pending.clear()
  for (const callback of callbacks) callback(frames.now)
}

/** Runs frames for `seconds` of animation. */
function play(seconds: number): void {
  for (let i = 0; i < Math.round((seconds * 1000) / FRAME_MS); i++) frame()
}

/** Runs frames until the animation stops by itself. Fails if it never does. */
function playUntilIdle(): number {
  let count = 0
  while (frames.pending.size > 0) {
    frame()
    if (++count > 2000) throw new Error('the animation never stopped')
  }
  return count
}

const resizeObservers = new Set<FakeResizeObserver>()

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

/** The box around the canvas changed size. */
function resizeTo(width: number, height: number): void {
  size.width = width
  size.height = height
  for (const observer of [...resizeObservers]) observer.fire()
}

const motion = {
  reduced: false,
  listeners: new Set<() => void>(),
}

function setReducedMotion(reduced: boolean): void {
  motion.reduced = reduced
  for (const listener of [...motion.listeners]) listener()
}

beforeEach(() => {
  size.width = 1100
  size.height = 160
  frames.pending.clear()
  frames.requested = 0
  frames.cancelled = 0
  motion.reduced = false
  motion.listeners.clear()
  resizeObservers.clear()

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    let context = contexts.get(this)
    if (!context) {
      context = new FakeContext(this)
      contexts.set(this, context)
    }
    return context
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
  vi.stubGlobal('getComputedStyle', () => ({
    color: 'rgb(9, 9, 9)',
    getPropertyValue: (name: string) => THEME[name] ?? '',
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  delete proto.clientWidth
  delete proto.clientHeight
})

// ---------------------------------------------------------------------------

interface Trails {
  bus: NoteBus
  canvas: HTMLCanvasElement
  context: FakeContext
  /** The bars on the canvas right now, in the order they were painted. */
  bars(): PaintedBar[]
  move(baseOctave: number): void
  unmount(): void
}

function draw(bus = new NoteBus(), baseOctave = BASE, strict = false): Trails {
  const element = (octave: number): React.JSX.Element =>
    strict ? (
      <StrictMode>
        <NoteTrails bus={bus} baseOctave={octave} />
      </StrictMode>
    ) : (
      <NoteTrails bus={bus} baseOctave={octave} />
    )
  const view = render(element(baseOctave))
  const canvas = view.container.querySelector('canvas')
  if (!canvas) throw new Error('no canvas was drawn')
  const context = contexts.get(canvas)
  if (!context) throw new Error('the canvas was never asked for its context')
  return {
    bus,
    canvas,
    context,
    bars: () => [...context.painted],
    move: (octave) => view.rerender(element(octave)),
    unmount: () => view.unmount(),
  }
}

/** Left edge and width, in canvas pixels, of the key that plays `midi` at the default position. */
function keySpan(midi: number, width = size.width): { left: number; width: number; centre: number } {
  const rect = keyRect(midi - 48)
  if (!rect) throw new Error(`no key for ${midi}`)
  return {
    left: rect.left * width,
    width: rect.width * width,
    centre: (rect.left + rect.width / 2) * width,
  }
}

function only(bars: PaintedBar[]): PaintedBar {
  expect(bars).toHaveLength(1)
  return bars[0] as PaintedBar
}

/** How far the top of a bar is above the keys (the bottom edge of the canvas). */
function topAboveKeys(bar: PaintedBar): number {
  return size.height - bar.y
}

// ===========================================================================

describe('the canvas itself', () => {
  it('is decorative: hidden from screen readers', () => {
    const trails = draw()
    expect(trails.canvas.getAttribute('aria-hidden')).toBe('true')
    expect(trails.canvas.className).toBe('note-trails')
  })

  it('uses no frames at all while nothing is played', () => {
    draw()
    resizeTo(900, 150)
    window.dispatchEvent(new Event('resize'))
    expect(frames.requested).toBe(0)
  })

  it.each([
    [1, 1100, 160],
    [1.25, 1375, 200],
    [1.5, 1650, 240],
    [2, 2200, 320],
  ])('matches its pixel grid to the screen at pixel ratio %s', (ratio, pixelWidth, pixelHeight) => {
    vi.stubGlobal('devicePixelRatio', ratio)
    const trails = draw()
    expect(trails.canvas.width).toBe(pixelWidth)
    expect(trails.canvas.height).toBe(pixelHeight)
  })

  it('is no less sharp on a denser screen, and never uses more pixels than the screen has', () => {
    vi.stubGlobal('devicePixelRatio', 3)
    const trails = draw()
    expect(trails.canvas.width).toBeGreaterThanOrEqual(2200)
    expect(trails.canvas.width).toBeLessThanOrEqual(3300)
    expect(trails.canvas.height).toBeGreaterThanOrEqual(320)
    expect(trails.canvas.height).toBeLessThanOrEqual(480)
  })

  it('watches its own box, or the one it fills, for size changes', () => {
    const trails = draw()
    const observed = [...resizeObservers].flatMap((observer) => observer.observed)
    expect(observed.length).toBeGreaterThan(0)
    for (const element of observed) {
      expect([trails.canvas, trails.canvas.parentElement]).toContain(element)
    }
  })
})

describe('a held note', () => {
  it('starts the animation and grows a bar upward from its key at the trail speed', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    expect(frames.pending.size).toBe(1)

    frame() // the first frame only starts the clock
    play(0.48)
    const bar = only(trails.bars())
    const key = keySpan(C4)
    expect(bar.x + bar.width / 2).toBeCloseTo(key.centre, 6)
    expect(bar.x).toBeGreaterThan(key.left)
    expect(bar.x + bar.width).toBeLessThan(key.left + key.width)
    expect(topAboveKeys(bar)).toBeCloseTo(trailSpeed(size.height) * 0.48, 6)
    // Attached to the key: the bar reaches the bottom edge of the canvas (and a little past it).
    expect(bar.y + bar.height).toBeGreaterThanOrEqual(size.height)
  })

  it('draws black-key notes narrower, in the deeper colour, and on top of white-key notes', () => {
    const trails = draw()
    trails.bus.noteOn(C_SHARP_4, 'keyboard')
    trails.bus.noteOn(C4, 'keyboard')
    play(0.3)
    const [white, black, ...rest] = trails.bars()
    expect(rest).toHaveLength(0)
    if (!white || !black) throw new Error('two bars were expected')
    expect(white.x + white.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
    expect(black.x + black.width / 2).toBeCloseTo(keySpan(C_SHARP_4).centre, 6)
    expect(black.width).toBeLessThan(white.width)
    // Colours come from the theme variables, not from the code.
    expect(white.colors).toEqual([THEME['--accent'], THEME['--accent-strong']])
    expect(black.colors).toEqual([THEME['--key-black-pressed'], THEME['--accent']])
    expect(white.shadowColor).toBe(THEME['--accent'])
    expect(black.shadowColor).toBe(THEME['--key-black-pressed'])
  })

  it('falls back to the text colour when a theme variable is missing, instead of failing', () => {
    vi.stubGlobal('getComputedStyle', () => ({ color: 'rgb(9, 9, 9)', getPropertyValue: () => '' }))
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.2)
    expect(only(trails.bars()).colors).toEqual(['rgb(9, 9, 9)', 'rgb(9, 9, 9)'])
  })

  it('never grows taller than the canvas, however long the note is held', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(20)
    expect(topAboveKeys(only(trails.bars()))).toBe(size.height)
    expect(frames.pending.size).toBe(1)
  })

  it('ignores notes that are not on the piano at its current position', () => {
    const trails = draw()
    trails.bus.noteOn(47, 'keyboard')
    trails.bus.noteOn(85, 'keyboard')
    trails.bus.noteOff(47, 'keyboard')
    expect(frames.requested).toBe(0)
    expect(trails.bars()).toEqual([])
  })

  it('shows the first and the last key of the piano, at every position', () => {
    for (const base of [1, 2, 3, 4, 5]) {
      const bus = new NoteBus()
      const trails = draw(bus, base)
      const lowest = 12 * (base + 1)
      bus.noteOn(lowest, 'pointer')
      bus.noteOn(lowest + 36, 'pointer')
      play(0.2)
      const [low, high] = trails.bars()
      if (!low || !high) throw new Error('two bars were expected')
      expect(low.x + low.width / 2).toBeCloseTo(size.width / 44, 6)
      expect(high.x + high.width / 2).toBeCloseTo(size.width - size.width / 44, 6)
      trails.unmount()
      frames.pending.clear()
    }
  })
})

describe('a released note', () => {
  it('lets the bar go: it rises at the same speed and keeps its height', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    frame()
    play(0.32)
    const held = only(trails.bars())
    trails.bus.noteOff(C4, 'keyboard')
    play(0.16)
    const released = only(trails.bars())
    expect(released.height).toBeCloseTo(topAboveKeys(held), 6)
    expect(size.height - (released.y + released.height)).toBeCloseTo(trailSpeed(size.height) * 0.16, 6)
  })

  it('leaves a visible bar after even the quickest tap', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    trails.bus.noteOff(C4, 'keyboard')
    frame()
    expect(only(trails.bars()).height).toBeGreaterThanOrEqual(MIN_BAR_HEIGHT)
  })

  it('stops the animation and leaves a clean canvas once every bar has left', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    trails.bus.noteOn(D4, 'pointer')
    play(0.5)
    trails.bus.noteOff(C4, 'keyboard')
    play(0.2)
    trails.bus.noteOff(D4, 'pointer')
    const framesNeeded = playUntilIdle()
    // The bars need at most the time to climb the canvas, not longer.
    expect(framesNeeded * FRAME_MS).toBeLessThan((size.height / trailSpeed(size.height)) * 1000 + 100)
    expect(trails.bars()).toEqual([])
    expect(frames.pending.size).toBe(0)

    // And it starts again with the next note.
    trails.bus.noteOn(C4, 'keyboard')
    expect(frames.pending.size).toBe(1)
    play(0.1)
    expect(trails.bars()).toHaveLength(1)
  })

  it('starts a second bar when the same note is played again before the first has left', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.3)
    trails.bus.noteOff(C4, 'keyboard')
    play(0.1)
    trails.bus.noteOn(C4, 'keyboard')
    play(0.1)
    expect(trails.bars()).toHaveLength(2)
  })

  it('lets the old bar go when a second source strikes a note that is still held', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.3)
    trails.bus.noteOn(C4, 'pointer')
    play(0.1)
    expect(trails.bars()).toHaveLength(2)
    trails.bus.noteOff(C4, 'keyboard')
    play(0.1)
    // Still held by the pointer: one bar stays attached to the key.
    expect(trails.bars().filter((bar) => bar.y + bar.height >= size.height)).toHaveLength(1)
    trails.bus.noteOff(C4, 'pointer')
    playUntilIdle()
    expect(trails.bars()).toEqual([])
  })

  it('is released by bus.allOff(), like every other way a note can end', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    trails.bus.noteOn(D4, 'pointer')
    play(0.2)
    trails.bus.allOff()
    playUntilIdle()
    expect(trails.bars()).toEqual([])
  })
})

describe('many notes', () => {
  it('survives hundreds of notes in a burst without piling bars up', () => {
    const trails = draw()
    for (let round = 0; round < 20; round++) {
      for (let midi = 48; midi <= 84; midi++) {
        trails.bus.noteOn(midi, 'playback')
        trails.bus.noteOff(midi, 'playback')
      }
      frame()
      expect(trails.bars().length).toBeLessThanOrEqual(MAX_BARS)
    }
    expect(trails.bars()).toHaveLength(MAX_BARS)
    // One frame request at a time, however many notes arrive.
    expect(frames.pending.size).toBe(1)
    playUntilIdle()
    expect(trails.bars()).toEqual([])
  })

  it('draws a bar above every key when all 37 are held at once', () => {
    const trails = draw()
    const notes = Array.from({ length: 37 }, (_, slot) => 48 + slot)
    for (const midi of notes) trails.bus.noteOn(midi, 'playback')
    play(0.2)
    const leftToRight = (centres: readonly number[]): string[] =>
      centres.toSorted((a, b) => a - b).map((centre) => centre.toFixed(6))
    expect(leftToRight(trails.bars().map((bar) => bar.x + bar.width / 2))).toEqual(
      leftToRight(notes.map((midi) => keySpan(midi).centre)),
    )
    // Still one frame request at a time.
    expect(frames.pending.size).toBe(1)
  })

  it('asks for exactly one frame per frame while notes are moving', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    trails.bus.noteOn(D4, 'keyboard')
    trails.bus.noteOff(C4, 'keyboard')
    const before = frames.requested
    play(0.16)
    expect(frames.requested - before).toBe(10)
  })
})

describe('a long pause', () => {
  it('does not make the bars jump after the tab was hidden for minutes', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    frame()
    play(0.16)
    const before = topAboveKeys(only(trails.bars()))
    // The browser stops drawing a hidden tab. Ten minutes later it draws again.
    frame(10 * 60 * 1000)
    const after = topAboveKeys(only(trails.bars()))
    expect(after - before).toBeCloseTo((trailSpeed(size.height) * MAX_FRAME_MS) / 1000, 6)
    // And the animation carries on normally from there.
    frame()
    const next = topAboveKeys(only(trails.bars()))
    expect(next - after).toBeCloseTo((trailSpeed(size.height) * FRAME_MS) / 1000, 6)
  })

  it('finishes the bars of notes released while the tab was hidden, then goes idle', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.3)
    // Hiding the page releases every note; no frame runs until it is shown again.
    trails.bus.allOff()
    frame(5 * 60 * 1000)
    playUntilIdle()
    expect(trails.bars()).toEqual([])
    expect(frames.pending.size).toBe(0)
  })

  it('copes with a frame clock that stands still or runs backwards', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.16)
    const before = topAboveKeys(only(trails.bars()))
    frame(0)
    frame(-500)
    expect(topAboveKeys(only(trails.bars()))).toBe(before)
  })
})

describe('resizing', () => {
  it('keeps the bars and repaints at once when the box changes size', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    frame()
    play(0.32)
    const wipes = trails.context.wipes
    resizeTo(880, 120)
    expect(trails.canvas.width).toBe(880)
    expect(trails.canvas.height).toBe(120)
    expect(trails.context.wipes).toBeGreaterThan(wipes)
    const bar = only(trails.bars())
    expect(bar.x + bar.width / 2).toBeCloseTo(keySpan(C4, 880).centre, 6)
    expect(frames.pending.size).toBe(1)
  })

  it('follows a change of pixel ratio (page zoom, another screen) without losing the bars', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.32)
    vi.stubGlobal('devicePixelRatio', 1.5)
    window.dispatchEvent(new Event('resize'))
    expect(trails.canvas.width).toBe(1650)
    expect(trails.canvas.height).toBe(240)
    expect(trails.context.scale).toEqual({ x: 1.5, y: 1.5 })
    const bar = only(trails.bars())
    // Still in CSS pixels: the bar has not moved on screen.
    expect(bar.x + bar.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
  })

  it('stops animating while the canvas has no size, and works again when it has one', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.2)
    resizeTo(0, 0)
    expect(frames.pending.size).toBe(0)
    expect(trails.bars()).toEqual([])
    trails.bus.noteOff(C4, 'keyboard')
    trails.bus.noteOn(D4, 'keyboard')
    expect(frames.pending.size).toBe(0)
    trails.bus.noteOff(D4, 'keyboard')

    resizeTo(1100, 160)
    expect(frames.pending.size).toBe(0)
    trails.bus.noteOn(C4, 'keyboard')
    expect(frames.pending.size).toBe(1)
    play(0.2)
    const bar = only(trails.bars())
    expect(bar.x + bar.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
  })

  it('draws on a canvas that only gets its size after it was mounted', () => {
    size.width = 0
    size.height = 0
    const trails = draw()
    resizeTo(1100, 160)
    trails.bus.noteOn(C4, 'keyboard')
    play(0.2)
    expect(trails.bars()).toHaveLength(1)
    expect(trails.canvas.width).toBe(1100)
  })

  /*
   * The spec (5.7): the light trails give up their height, down to nothing,
   * when a panel opens or the window is short. A key can be down, or go down,
   * while they have none. When the height comes back it is a held note like
   * any other (5.8): a bar grows from its key.
   */
  it('grows a bar for every key that is still held when the canvas gets its height back', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.2)
    resizeTo(1100, 0)
    trails.bus.noteOn(D4, 'pointer')
    expect(frames.pending.size).toBe(0)

    resizeTo(1100, 160)
    expect(frames.pending.size).toBe(1)
    play(0.3)
    const centres = trails.bars().map((bar) => bar.x + bar.width / 2)
    expect(centres).toHaveLength(2)
    expect(centres[0]).toBeCloseTo(keySpan(C4).centre, 6)
    expect(centres[1]).toBeCloseTo(keySpan(D4).centre, 6)

    // And they let go normally.
    trails.bus.allOff()
    playUntilIdle()
    expect(trails.bars()).toEqual([])
  })

  it('shows the still glow for a key that is still held when the canvas gets its height back (reduced motion)', () => {
    setReducedMotion(true)
    const trails = draw()
    resizeTo(1100, 0)
    trails.bus.noteOn(C4, 'keyboard')

    resizeTo(1100, 160)
    const glow = only(trails.bars())
    expect(glow.x + glow.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
    expect(frames.requested).toBe(0)
  })

  it('does so too when the piano was moved while the canvas had no height', () => {
    const trails = draw()
    resizeTo(1100, 0)
    trails.move(4)
    // With the piano one octave higher, C4 is its first key.
    trails.bus.noteOn(C4, 'keyboard')

    resizeTo(1100, 160)
    play(0.2)
    const bar = only(trails.bars())
    expect(bar.x + bar.width / 2).toBeCloseTo(size.width / 44, 6)
  })

  it('starts no second bar for a held key when the canvas only changes size', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.2)
    resizeTo(880, 120)
    resizeTo(1100, 160)
    play(0.1)
    expect(trails.bars()).toHaveLength(1)
  })
})

describe('reduced motion', () => {
  it('shows a short still glow above a held key and never animates', () => {
    setReducedMotion(true)
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    expect(frames.requested).toBe(0)
    const glow = only(trails.bars())
    expect(glow.x + glow.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
    expect(topAboveKeys(glow)).toBe(staticGlowHeight(size.height))
    expect(topAboveKeys(glow)).toBeLessThan(size.height / 2)

    trails.bus.noteOn(C_SHARP_4, 'keyboard')
    expect(trails.bars()).toHaveLength(2)
    trails.bus.noteOff(C4, 'keyboard')
    expect(trails.bars()).toHaveLength(1)
    trails.bus.noteOff(C_SHARP_4, 'keyboard')
    expect(trails.bars()).toEqual([])
    expect(frames.requested).toBe(0)
  })

  it('keeps one glow when a held note is struck again', () => {
    setReducedMotion(true)
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    trails.bus.noteOn(C4, 'pointer')
    expect(trails.bars()).toHaveLength(1)
    trails.bus.allOff()
    expect(trails.bars()).toEqual([])
  })

  it('stops the animation when it is switched on in the middle of a note', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    trails.bus.noteOn(D4, 'keyboard')
    play(0.3)
    trails.bus.noteOff(D4, 'keyboard')
    play(0.1)
    expect(trails.bars()).toHaveLength(2)

    setReducedMotion(true)
    expect(frames.pending.size).toBe(0)
    // Only the held note is left, as a still glow; the rising bar is gone.
    const glow = only(trails.bars())
    expect(glow.x + glow.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
    expect(topAboveKeys(glow)).toBe(staticGlowHeight(size.height))
    frame()
    expect(frames.pending.size).toBe(0)
  })

  it('animates again when it is switched off in the middle of a note', () => {
    setReducedMotion(true)
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    setReducedMotion(false)
    expect(frames.pending.size).toBe(1)
    frame()
    play(0.32)
    expect(topAboveKeys(only(trails.bars()))).toBeCloseTo(trailSpeed(size.height) * 0.32, 6)
    trails.bus.noteOff(C4, 'keyboard')
    playUntilIdle()
    expect(trails.bars()).toEqual([])
  })

  it('repaints the still glow when the canvas is resized', () => {
    setReducedMotion(true)
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    resizeTo(880, 200)
    const glow = only(trails.bars())
    expect(glow.x + glow.width / 2).toBeCloseTo(keySpan(C4, 880).centre, 6)
    expect(frames.requested).toBe(0)
  })
})

describe('when the piano moves lower or higher', () => {
  it('clears the bars of the old position and stops animating', () => {
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    trails.bus.noteOn(D4, 'keyboard')
    play(0.3)
    trails.bus.noteOff(D4, 'keyboard')
    play(0.1)
    expect(trails.bars()).toHaveLength(2)

    // As in the app: every note is let go first, then the piano moves.
    trails.bus.allOff()
    trails.move(4)
    expect(trails.bars()).toEqual([])
    expect(frames.pending.size).toBe(0)
    frame()
    expect(frames.pending.size).toBe(0)
  })

  it('draws the next notes where their keys now are', () => {
    const trails = draw()
    trails.move(4)
    // With the piano one octave higher, C4 is its first key.
    trails.bus.noteOn(C4, 'keyboard')
    play(0.2)
    const bar = only(trails.bars())
    expect(bar.x + bar.width / 2).toBeCloseTo(size.width / 44, 6)
    // And what is now below the piano is ignored.
    trails.bus.noteOn(59, 'keyboard')
    play(0.1)
    expect(trails.bars()).toHaveLength(1)
  })

  it('listens to the bus once, not once per position it has been in', () => {
    const trails = draw()
    trails.move(4)
    trails.move(2)
    trails.move(3)
    trails.bus.noteOn(C4, 'keyboard')
    play(0.2)
    expect(trails.bars()).toHaveLength(1)
    expect(frames.pending.size).toBe(1)
  })
})

describe('cleaning up', () => {
  it('stops everything when it is taken off the screen in the middle of a note', () => {
    const removeFromWindow = vi.spyOn(window, 'removeEventListener')
    const trails = draw()
    trails.bus.noteOn(C4, 'keyboard')
    play(0.2)
    trails.unmount()

    expect(frames.pending.size).toBe(0)
    expect(resizeObservers.size).toBe(0)
    expect(motion.listeners.size).toBe(0)
    expect(removeFromWindow.mock.calls.some(([type]) => type === 'resize')).toBe(true)
    expect(trails.bars()).toEqual([])

    // Nothing it left behind reacts to later notes, resizes or setting changes.
    const paints = trails.context.paints
    const requested = frames.requested
    trails.bus.noteOn(D4, 'keyboard')
    trails.bus.allOff()
    window.dispatchEvent(new Event('resize'))
    setReducedMotion(true)
    expect(frames.requested).toBe(requested)
    expect(frames.pending.size).toBe(0)
    expect(trails.context.paints).toBe(paints)
    removeFromWindow.mockRestore()
  })

  it('draws each note once when mounted twice by StrictMode', () => {
    const trails = draw(new NoteBus(), BASE, true)
    expect(resizeObservers.size).toBe(1)
    expect(motion.listeners.size).toBe(1)
    trails.bus.noteOn(C4, 'keyboard')
    expect(frames.pending.size).toBe(1)
    play(0.2)
    expect(trails.bars()).toHaveLength(1)
    trails.bus.noteOff(C4, 'keyboard')
    playUntilIdle()
    expect(trails.bars()).toEqual([])
  })

  it('does not fail when the browser gives no drawing context', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
    const bus = new NoteBus()
    const view = render(<NoteTrails bus={bus} baseOctave={BASE} />)
    bus.noteOn(C4, 'keyboard')
    expect(frames.requested).toBe(0)
    view.unmount()
  })
})

describe('notes that are already held when the trails appear', () => {
  /*
   * The spec (5.8): "While a note is held, a glowing bar grows upward from
   * the top edge of that key's position", and for reduced motion "just show a
   * short static glow above held keys". The trails appear in the middle of a
   * note when "Light trails" is switched on in the Advanced panel while a key
   * is down.
   */
  it('grows a bar for a key that is being held', () => {
    const bus = new NoteBus()
    bus.noteOn(C4, 'keyboard')
    const trails = draw(bus)
    play(0.3)
    const bar = only(trails.bars())
    expect(bar.x + bar.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
    // And it lets go normally.
    bus.noteOff(C4, 'keyboard')
    playUntilIdle()
    expect(trails.bars()).toEqual([])
  })

  it('shows the still glow for a key that is being held (reduced motion)', () => {
    setReducedMotion(true)
    const bus = new NoteBus()
    bus.noteOn(C4, 'keyboard')
    const trails = draw(bus)
    const glow = only(trails.bars())
    expect(glow.x + glow.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
  })

  it('grows one bar for each held key when mounted twice by StrictMode', () => {
    const bus = new NoteBus()
    bus.noteOn(C4, 'keyboard')
    bus.noteOn(D4, 'pointer')
    const trails = draw(bus, BASE, true)
    expect(frames.pending.size).toBe(1)
    play(0.3)
    expect(trails.bars()).toHaveLength(2)
    bus.allOff()
    playUntilIdle()
    expect(trails.bars()).toEqual([])
  })

  it('shows nothing for a held note that is not on the piano at its current position', () => {
    const bus = new NoteBus()
    bus.noteOn(47, 'keyboard')
    bus.noteOn(85, 'keyboard')
    const trails = draw(bus)
    expect(frames.requested).toBe(0)
    expect(trails.bars()).toEqual([])
  })
})
