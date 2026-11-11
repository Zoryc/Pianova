// @vitest-environment jsdom
/**
 * The sky as a whole: the real <Sky /> on a real NoteBus, drawing on a
 * stand-in canvas that remembers what was painted, with the browser's frame
 * clock, resize observer and reduced-motion setting replaced by ones the
 * tests control (see skyTestKit.ts).
 *
 * The sky is 1300 x 600 CSS pixels unless a test changes it. On the full
 * piano (52 white keys) every white key is then 25 wide, and light travels
 * 200 pixels a second.
 */
import { StrictMode } from 'react'
import type { JSX } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { paletteForNote } from '../../core/colour'
import { pianoRange } from '../../core/layout'
import type { PianoRange } from '../../core/layout'
import { NoteBus } from '../../core/noteBus'
import { keyRectOf } from '../../core/pianoGeometry'
import type { Midi, NoteListener } from '../../core/types'
import type { PlayableNote } from '../../songs/song'
import { Sky } from './Sky'
import type { FallingSource, SkyProps } from './Sky'
import {
  AFTERGLOW_SECONDS,
  FLASH_SECONDS,
  MAX_BACKGROUND_BOOST,
  MAX_BARS,
  MAX_FRAME_MS,
  MAX_SPARKS,
  MIN_BAR_HEIGHT,
  SKY_SECONDS,
  barWidth,
  skySpeed,
  stillGlowHeight,
} from './skyModel'
import { BLOOM_PICTURE_SIZE, SPARK_PICTURE_SIZE } from './skySprites'
import { FRAME_MS, installFakeBrowser } from './skyTestKit'
import type { FakeBrowser, FakeContext, PaintedBar, StampedImage } from './skyTestKit'

const FULL = pianoRange(88, 3)
const SMALL = pianoRange(37, 3)
const C4 = 60
const C_SHARP_4 = 61
const D4 = 62
const NO_HINTS: ReadonlyMap<Midi, string> = new Map()

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A bus that also tells how many consumers are subscribed to it right now. */
class CountingBus extends NoteBus {
  subscribers = 0

  override subscribe(listener: NoteListener): () => void {
    const unsubscribe = super.subscribe(listener)
    let counted = true
    this.subscribers += 1
    return () => {
      if (counted) this.subscribers -= 1
      counted = false
      unsubscribe()
    }
  }
}

type StampKind = 'spark' | 'bloom' | 'backdrop' | 'glow'

interface MountedSky {
  bus: NoteBus
  canvas: HTMLCanvasElement
  context: FakeContext
  /** The bars on the canvas right now. */
  bars(): PaintedBar[]
  /** The pictures of one kind that were copied onto the canvas for the current frame. */
  stamps(kind: StampKind): StampedImage[]
  update(patch: Partial<SkyProps>): void
  unmount(): void
}

/** Puts a sky on the page. Sparks are off unless a test asks for them, so that frames stop predictably. */
function mount(overrides: Partial<SkyProps> = {}, strict = false): MountedSky {
  let props: SkyProps = {
    bus: new NoteBus(),
    range: FULL,
    showBars: true,
    barStyle: 'solid',
    sparks: 'off',
    glow: 0.6,
    background: 'black',
    accent: 'red',
    customColour: '#ff2a2a',
    falling: null,
    hints: NO_HINTS,
    ...overrides,
  }
  const page = (): JSX.Element =>
    strict ? (
      <StrictMode>
        <Sky {...props} />
      </StrictMode>
    ) : (
      <Sky {...props} />
    )
  const view = render(page())
  const canvas = view.container.querySelector('canvas') as HTMLCanvasElement
  const context = browser.contextOf(canvas)
  return {
    bus: props.bus,
    canvas,
    context,
    bars: () => context.bars,
    stamps: (kind) => context.images.filter((stamp) => kindOf(stamp) === kind),
    update(patch) {
      props = { ...props, ...patch }
      view.rerender(page())
    },
    unmount: () => act(() => view.unmount()),
  }
}

function kindOf(stamp: StampedImage): StampKind {
  const source = stamp.image as HTMLCanvasElement
  if (source.width === SPARK_PICTURE_SIZE && source.height === SPARK_PICTURE_SIZE) return 'spark'
  if (source.width === BLOOM_PICTURE_SIZE && source.height === BLOOM_PICTURE_SIZE) return 'bloom'
  if (stamp.width === browser.size.width && stamp.height === browser.size.height) return 'backdrop'
  return 'glow'
}

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1)
  return items[0] as T
}

/** Where a key is across the sky, in pixels. */
function keySpan(midi: Midi, range: PianoRange = FULL, width = browser.size.width) {
  const key = keyRectOf(midi, range)
  if (!key) throw new Error(`note ${midi} is not on this piano`)
  return { left: key.left * width, width: key.width * width, centre: (key.left + key.width / 2) * width }
}

const centreOf = (bar: PaintedBar): number => bar.x + bar.width / 2
/** How far the two ends of a bar are above the line. */
const topAboveLine = (bar: PaintedBar): number => browser.size.height - bar.y
const bottomAboveLine = (bar: PaintedBar): number => browser.size.height - (bar.y + bar.height)

/** A song the tests move by hand. */
function fakeSong(notes: PlayableNote[]) {
  const state = { position: 0, playing: false, asked: 0 }
  const source: FallingSource = {
    getNotes: () => {
      state.asked++
      return notes
    },
    getPosition: () => state.position,
    isPlaying: () => state.playing,
  }
  /** Lets the song play for `seconds`, one frame at a time. Returns how many frames were drawn. */
  const play = (seconds: number): number => {
    let ran = 0
    for (let i = 0; i < Math.round((seconds * 1000) / FRAME_MS); i++) {
      state.position += FRAME_MS / 1000
      ran += browser.frame()
    }
    return ran
  }
  return { state, source, play }
}

function note(midi: Midi, time: number, duration: number): PlayableNote {
  return { midi, time, duration, velocity: 0.8 }
}

// ---------------------------------------------------------------------------

describe('the canvas itself', () => {
  it('is decorative: hidden from screen readers', () => {
    const sky = mount()
    expect(sky.canvas.getAttribute('aria-hidden')).toBe('true')
    expect(sky.canvas.className).toBe('sky')
  })

  it('draws its background once and then uses no frames at all while nothing is played', () => {
    const sky = mount()
    expect(sky.stamps('backdrop')).toHaveLength(1)
    browser.resizeTo(900, 400)
    window.dispatchEvent(new Event('resize'))
    sky.update({})
    expect(browser.frames.requested).toBe(0)
    expect(sky.stamps('backdrop')).toHaveLength(1)
  })

  it.each([
    [1, 1300, 600],
    [1.25, 1625, 750],
    [1.5, 1950, 900],
    [2, 2600, 1200],
  ])('matches its pixel grid to the screen at pixel ratio %s', (ratio, pixelWidth, pixelHeight) => {
    vi.stubGlobal('devicePixelRatio', ratio)
    const sky = mount()
    expect(sky.canvas.width).toBe(pixelWidth)
    expect(sky.canvas.height).toBe(pixelHeight)
    expect(sky.context.zoom).toEqual({ x: ratio, y: ratio })
  })

  it('never uses more than two canvas pixels per pixel, however dense the screen', () => {
    vi.stubGlobal('devicePixelRatio', 3)
    const sky = mount()
    expect(sky.canvas.width).toBe(2600)
    expect(sky.canvas.height).toBe(1200)
  })

  it('watches the box it fills for size changes', () => {
    const sky = mount()
    expect(browser.observed()).toEqual([sky.canvas.parentElement])
  })

  it('does not fail when the browser gives no drawing context', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
    const sky = mount({ sparks: 'some', background: 'stars' })
    sky.bus.noteOn(C4, 'keyboard')
    sky.update({ glow: 1 })
    expect(browser.frames.requested).toBe(0)
    sky.unmount()
  })
})

describe('free play: a held note', () => {
  it('starts the animation and grows a bar upward from the line at the speed of the sky', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    expect(browser.frames.pending.size).toBe(1)
    browser.frame()
    browser.play(0.3)
    const bar = only(sky.bars())
    expect(topAboveLine(bar)).toBeCloseTo(skySpeed(600) * 0.3, 6)
    // It runs a little past the line, so that it looks attached to its key.
    expect(bottomAboveLine(bar)).toBeLessThanOrEqual(0)
  })

  it('stands the bar on its key: centred, and a little narrower', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    const bar = only(sky.bars())
    const key = keySpan(C4)
    expect(centreOf(bar)).toBeCloseTo(key.centre, 6)
    expect(bar.width).toBe(barWidth(key.width))
    expect(bar.width).toBeLessThan(key.width)
  })

  it('draws black-key bars narrower and over the white-key bars, as the keys lie', () => {
    const sky = mount()
    sky.bus.noteOn(C_SHARP_4, 'keyboard')
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(D4, 'keyboard')
    browser.play(0.2)
    const [first, second, third] = sky.bars()
    expect(sky.bars()).toHaveLength(3)
    expect(centreOf(first as PaintedBar)).toBeCloseTo(keySpan(C4).centre, 6)
    expect(centreOf(second as PaintedBar)).toBeCloseTo(keySpan(D4).centre, 6)
    expect(centreOf(third as PaintedBar)).toBeCloseTo(keySpan(C_SHARP_4).centre, 6)
    expect(third?.width).toBeLessThan(first?.width ?? 0)
    // Light adds to light, but a black-key bar covers what is behind it, and is a little darker.
    expect(first?.blend).toBe('lighter')
    expect(third?.blend).toBe('source-over')
    expect(third?.alpha).toBeLessThan(first?.alpha ?? 0)
  })

  it('never grows taller than the sky, however long the note is held', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(8)
    expect(topAboveLine(only(sky.bars()))).toBe(600)
  })

  it('ignores notes that are not on the piano, and asks for no frame for them', () => {
    const sky = mount({ range: SMALL })
    sky.bus.noteOn(47, 'playback')
    sky.bus.noteOff(47, 'playback')
    sky.bus.noteOn(85, 'keyboard')
    expect(browser.frames.requested).toBe(0)
    expect(sky.bars()).toEqual([])
  })

  it('shows the first and the last key of the piano inside the sky', () => {
    for (const range of [FULL, SMALL]) {
      const sky = mount({ range })
      sky.bus.noteOn(range.first, 'keyboard')
      sky.bus.noteOn(range.last, 'keyboard')
      browser.play(0.2)
      const [low, high] = sky.bars()
      expect(low?.x).toBeGreaterThanOrEqual(0)
      expect((high?.x ?? 0) + (high?.width ?? 0)).toBeLessThanOrEqual(1300)
      sky.bus.allOff()
      sky.unmount()
    }
  })
})

describe('free play: a released note', () => {
  it('lets the bar go: it rises at the same speed and keeps its height', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.frame()
    browser.play(0.3)
    sky.bus.noteOff(C4, 'keyboard')
    browser.play(0.25)
    const bar = only(sky.bars())
    expect(bottomAboveLine(bar)).toBeCloseTo(skySpeed(600) * 0.25, 6)
    expect(bar.height).toBeCloseTo(skySpeed(600) * 0.3, 6)
  })

  it('leaves a visible bar after even the quickest tap', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOff(C4, 'keyboard')
    browser.play(0.1)
    expect(only(sky.bars()).height).toBe(MIN_BAR_HEIGHT)
  })

  it('stops the animation and leaves only the background once every bar has left', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(D4, 'pointer')
    browser.play(0.4)
    sky.bus.noteOff(C4, 'keyboard')
    browser.play(0.2)
    sky.bus.noteOff(D4, 'pointer')
    const frames = browser.playUntilIdle()
    expect(frames).toBeGreaterThan(60)
    expect(frames).toBeLessThan(SKY_SECONDS * 60 + 30)
    expect(sky.bars()).toEqual([])
    expect(sky.context.images.map(kindOf)).toEqual(['backdrop'])
    expect(sky.context.rects.filter((rect) => rect.blend !== 'destination-out')).toEqual([])
    expect(browser.frame()).toBe(0)
  })

  it('starts a second bar when the same note is played again before the first has left', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    sky.bus.noteOff(C4, 'keyboard')
    browser.play(0.2)
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.1)
    expect(sky.bars()).toHaveLength(2)
  })

  it('lets the old bar go when a second source strikes a note that is still held', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.3)
    sky.bus.noteOn(C4, 'pointer')
    browser.play(0.1)
    const [old, fresh] = sky.bars()
    expect(sky.bars()).toHaveLength(2)
    expect(bottomAboveLine(old as PaintedBar)).toBeGreaterThan(0)
    expect(bottomAboveLine(fresh as PaintedBar)).toBeLessThanOrEqual(0)
  })

  it('is released by bus.allOff(), like every other way a note can end', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(D4, 'pointer')
    browser.play(0.2)
    sky.bus.allOff()
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })
})

describe('free play: many notes and long pauses', () => {
  it('survives hundreds of notes in a burst without piling bars up', () => {
    const sky = mount()
    for (let round = 0; round < 20; round++) {
      for (let midi = 48; midi <= 84; midi++) {
        sky.bus.noteOn(midi, 'playback')
        sky.bus.noteOff(midi, 'playback')
      }
    }
    browser.frame()
    expect(sky.bars().length).toBe(MAX_BARS)
    expect(browser.frames.pending.size).toBe(1)
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })

  it('asks for exactly one frame per frame while notes are moving', () => {
    const sky = mount({ sparks: 'lots' })
    for (let midi = 48; midi <= 84; midi++) sky.bus.noteOn(midi, 'pointer')
    expect(browser.frames.pending.size).toBe(1)
    for (let i = 0; i < 30; i++) expect(browser.frame()).toBe(1)
    for (let midi = 48; midi <= 84; midi++) sky.bus.noteOff(midi, 'pointer')
    expect(browser.frames.pending.size).toBe(1)
  })

  it('goes still while a key stays down once nothing moves any more, and wakes at the next note', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    const frames = browser.playUntilIdle()
    // The bar has filled the sky and the glow has settled: the picture stays as it is.
    expect(frames).toBeLessThan(SKY_SECONDS * 60 + 30)
    expect(topAboveLine(only(sky.bars()))).toBe(600)
    sky.bus.noteOn(D4, 'keyboard')
    expect(browser.frames.pending.size).toBe(1)
    sky.bus.allOff()
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })

  it('does not make the bars jump after the tab was hidden for minutes', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.frame()
    browser.play(0.1)
    const before = topAboveLine(only(sky.bars()))
    browser.frame(5 * 60 * 1000)
    const after = topAboveLine(only(sky.bars()))
    expect(after - before).toBeCloseTo((skySpeed(600) * MAX_FRAME_MS) / 1000, 6)
  })

  it('copes with a frame clock that stands still or runs backwards', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.frame()
    browser.play(0.1)
    const before = topAboveLine(only(sky.bars()))
    browser.frame(0)
    browser.frame(-500)
    expect(topAboveLine(only(sky.bars()))).toBe(before)
  })
})

describe('resizing', () => {
  it('keeps the bars and repaints at once when the box changes size', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.3)
    const wipes = sky.context.wipes
    browser.resizeTo(880, 420)
    expect(sky.canvas.width).toBe(880)
    expect(sky.canvas.height).toBe(420)
    expect(sky.context.wipes).toBeGreaterThan(wipes)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4, FULL, 880).centre, 6)
    expect(browser.frames.pending.size).toBe(1)
  })

  it('follows a change of pixel ratio (page zoom, another screen) without losing the bars', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.3)
    vi.stubGlobal('devicePixelRatio', 1.5)
    window.dispatchEvent(new Event('resize'))
    expect(sky.canvas.width).toBe(1950)
    expect(sky.context.zoom).toEqual({ x: 1.5, y: 1.5 })
    // Still in CSS pixels: the bar has not moved on screen.
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4).centre, 6)
  })

  it('stops animating while the canvas has no size, and gives the keys still held their light back', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    browser.resizeTo(1300, 0)
    expect(browser.frames.pending.size).toBe(0)
    expect(sky.bars()).toEqual([])
    sky.bus.noteOn(D4, 'pointer')
    expect(browser.frames.pending.size).toBe(0)

    browser.resizeTo(1300, 600)
    expect(browser.frames.pending.size).toBe(1)
    browser.play(0.3)
    const [c, d] = sky.bars()
    expect(sky.bars()).toHaveLength(2)
    expect(centreOf(c as PaintedBar)).toBeCloseTo(keySpan(C4).centre, 6)
    expect(centreOf(d as PaintedBar)).toBeCloseTo(keySpan(D4).centre, 6)
    expect(sky.stamps('bloom')).toHaveLength(2)

    sky.bus.allOff()
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })

  it('draws on a canvas that only gets its size after it was mounted', () => {
    browser.size.width = 0
    browser.size.height = 0
    const sky = mount()
    browser.resizeTo(1300, 600)
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    expect(sky.bars()).toHaveLength(1)
    expect(sky.canvas.width).toBe(1300)
  })

  it('starts no second bar for a held key when the canvas only changes size', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    browser.resizeTo(880, 420)
    browser.resizeTo(1300, 600)
    browser.play(0.1)
    expect(sky.bars()).toHaveLength(1)
  })
})

describe('notes that are already held when the sky appears', () => {
  it('grows a bar for a key that is being held', () => {
    const bus = new NoteBus()
    bus.noteOn(C4, 'keyboard')
    const sky = mount({ bus })
    browser.play(0.3)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4).centre, 6)
    bus.noteOff(C4, 'keyboard')
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })

  it('grows one bar for each held key when mounted twice by StrictMode', () => {
    const bus = new NoteBus()
    bus.noteOn(C4, 'keyboard')
    bus.noteOn(D4, 'pointer')
    const sky = mount({ bus }, true)
    expect(browser.frames.pending.size).toBe(1)
    browser.play(0.3)
    expect(sky.bars()).toHaveLength(2)
    bus.allOff()
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })

  it('shows nothing for a held note that is not on the piano', () => {
    const bus = new NoteBus()
    bus.noteOn(47, 'keyboard')
    const sky = mount({ bus, range: SMALL })
    expect(browser.frames.requested).toBe(0)
    expect(sky.bars()).toEqual([])
  })
})

describe('reduced motion', () => {
  it('shows a short still glow above a held key and never animates in free play', () => {
    browser.setReducedMotion(true)
    const sky = mount({ sparks: 'lots' })
    sky.bus.noteOn(C4, 'keyboard')
    const glow = only(sky.bars())
    expect(centreOf(glow)).toBeCloseTo(keySpan(C4).centre, 6)
    expect(topAboveLine(glow)).toBe(stillGlowHeight(600))
    expect(sky.stamps('spark')).toEqual([])

    sky.bus.noteOn(C4, 'pointer')
    expect(sky.bars()).toHaveLength(1)
    sky.bus.allOff()
    expect(sky.bars()).toEqual([])
    expect(browser.frames.requested).toBe(0)
  })

  it('shows the still glow for a key that was already held', () => {
    browser.setReducedMotion(true)
    const bus = new NoteBus()
    bus.noteOn(C4, 'keyboard')
    const sky = mount({ bus })
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4).centre, 6)
    expect(browser.frames.requested).toBe(0)
  })

  it('stops the animation when it is switched on in the middle of a note, and starts it again when switched off', () => {
    const sky = mount({ sparks: 'some' })
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(D4, 'keyboard')
    browser.play(0.3)
    sky.bus.noteOff(D4, 'keyboard')
    browser.play(0.1)
    expect(sky.stamps('spark').length).toBeGreaterThan(0)

    browser.setReducedMotion(true)
    expect(browser.frames.pending.size).toBe(0)
    expect(topAboveLine(only(sky.bars()))).toBe(stillGlowHeight(600))
    expect(sky.stamps('spark')).toEqual([])

    browser.setReducedMotion(false)
    expect(browser.frames.pending.size).toBe(1)
    browser.play(0.2)
    expect(sky.bars()).toHaveLength(1)
    sky.bus.allOff()
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })

  it('repaints the still glow when the canvas is resized', () => {
    browser.setReducedMotion(true)
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.resizeTo(880, 500)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4, FULL, 880).centre, 6)
    expect(browser.frames.requested).toBe(0)
  })
})

describe('when the piano on screen changes', () => {
  it('clears the light of the old piano and stops animating', () => {
    const sky = mount({ sparks: 'some' })
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(D4, 'keyboard')
    browser.play(0.3)
    sky.bus.noteOff(D4, 'keyboard')
    browser.play(0.1)
    expect(sky.bars()).toHaveLength(2)

    // As in the app: every note is let go, then the piano changes.
    sky.bus.allOff()
    sky.update({ range: SMALL })
    expect(sky.bars()).toEqual([])
    expect(sky.stamps('spark')).toEqual([])
    expect(sky.stamps('bloom')).toEqual([])
    expect(browser.frames.pending.size).toBe(0)
  })

  it('draws the next notes where their keys now are', () => {
    const sky = mount()
    sky.update({ range: SMALL })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4, SMALL).centre, 6)
    // And what is now off the piano is ignored.
    sky.bus.noteOn(47, 'keyboard')
    browser.play(0.1)
    expect(sky.bars()).toHaveLength(1)
  })

  it('listens to the bus once, however often the piano changed', () => {
    const bus = new CountingBus()
    const sky = mount({ bus })
    for (let i = 0; i < 10; i++) sky.update({ range: i % 2 === 0 ? SMALL : FULL })
    expect(bus.subscribers).toBe(1)
    expect(browser.observers()).toBe(1)
    expect(browser.motionListeners()).toBe(1)
    bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    expect(sky.bars()).toHaveLength(1)
  })
})

describe('changing the look', () => {
  it('keeps the light that is in the air when only its look changes', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.frame()
    browser.play(0.3)
    sky.update({ glow: 1, accent: 'blue', background: 'aurora', sparks: 'some' })
    browser.play(0.2)
    expect(topAboveLine(only(sky.bars()))).toBeCloseTo(skySpeed(600) * 0.5, 6)
  })

  it('repaints at once, without animating, when the look changes while nothing moves', () => {
    const sky = mount()
    const wipes = sky.context.wipes
    sky.update({ background: 'stars' })
    sky.update({ accent: 'green' })
    expect(sky.context.wipes).toBe(wipes + 2)
    sky.update({})
    expect(sky.context.wipes).toBe(wipes + 2)
    expect(browser.frames.requested).toBe(0)
  })

  it('fills solid bars with a gradient and draws neon bars as bright outlines around a faint fill', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.3)
    const solid = only(sky.bars())
    expect(solid.outline).toBeNull()
    expect(typeof solid.fill).toBe('object')

    sky.update({ barStyle: 'neon' })
    browser.play(0.1)
    const neon = only(sky.bars())
    expect(neon.outline).toBe(paletteForNote(C4, 'red', '').bright)
    expect(String(neon.fill)).toContain(paletteForNote(C4, 'red', '').light)
  })

  it('draws no bars with light bars switched off, and gives a held key its bar when they come back', () => {
    const sky = mount({ showBars: false, sparks: 'some' })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.3)
    expect(sky.bars()).toEqual([])
    // The key still shows where it meets the line.
    expect(sky.stamps('bloom')).toHaveLength(1)
    expect(sky.stamps('spark').length).toBeGreaterThan(0)

    sky.update({ showBars: true })
    browser.play(0.2)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4).centre, 6)
    sky.update({ showBars: false })
    browser.frame()
    expect(sky.bars()).toEqual([])
  })

  it('has no glow at all at glow 0, and more of it at glow 1', () => {
    const sky = mount({ glow: 0 })
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(D4, 'keyboard')
    browser.play(0.3)
    expect(sky.bars()).toHaveLength(2)
    expect(sky.stamps('glow')).toEqual([])
    expect(sky.stamps('bloom')).toEqual([])
    expect(sky.context.rects.filter((rect) => rect.blend === 'lighter')).toEqual([])

    sky.update({ glow: 0.5 })
    browser.play(0.1)
    const half = sky.stamps('bloom')[0]
    expect(sky.stamps('glow').length).toBeGreaterThan(0)
    sky.update({ glow: 1 })
    browser.play(0.1)
    const full = sky.stamps('bloom')[0]
    expect(full?.width).toBeGreaterThan(half?.width ?? 0)
    expect(full?.alpha).toBeGreaterThan(half?.alpha ?? 0)
  })

  it('gives every note its own colour with Rainbow, the same in every octave', () => {
    const sky = mount({ accent: 'rainbow' })
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(D4, 'keyboard')
    sky.bus.noteOn(C4 + 12, 'keyboard')
    browser.play(0.2)
    const [c, d, highC] = sky.bars()
    expect(c?.fill).not.toBe(d?.fill)
    expect(c?.fill).toBe(highC?.fill)
  })

  it('does not fail on a glow outside 0..1', () => {
    const sky = mount({ glow: Number.NaN })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    sky.update({ glow: 7 })
    browser.play(0.2)
    sky.update({ glow: -3 })
    browser.play(0.2)
    expect(sky.bars()).toHaveLength(1)
  })
})

describe('sparks', () => {
  it('fly from the line at the key of every note that is sounding', () => {
    const sky = mount({ sparks: 'some' })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.5)
    const sparks = sky.stamps('spark')
    const key = keySpan(C4)
    expect(sparks.length).toBeGreaterThan(3)
    for (const spark of sparks) {
      const centre = spark.x + spark.width / 2
      expect(centre).toBeGreaterThan(key.left - 30)
      expect(centre).toBeLessThan(key.left + key.width + 30)
      expect(spark.y + spark.height / 2).toBeLessThanOrEqual(600)
      expect(spark.y + spark.height / 2).toBeGreaterThan(400)
      expect(spark.blend).toBe('lighter')
    }
  })

  it('are about three times as many with "lots", and none with "off"', () => {
    const count = (level: SkyProps['sparks']): number => {
      const sky = mount({ sparks: level })
      sky.bus.noteOn(C4, 'keyboard')
      sky.bus.noteOn(D4, 'keyboard')
      browser.play(2)
      const sparks = sky.stamps('spark').length
      sky.bus.allOff()
      sky.unmount()
      return sparks
    }
    const some = count('some')
    expect(count('off')).toBe(0)
    expect(some).toBeGreaterThan(8)
    expect(count('lots') / some).toBeGreaterThan(2.2)
    expect(count('lots') / some).toBeLessThan(3.8)
  })

  it('go out within about a second of the last note, and the animation then stops', () => {
    const sky = mount({ sparks: 'lots', showBars: false })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(1)
    sky.bus.noteOff(C4, 'keyboard')
    const frames = browser.playUntilIdle()
    expect(frames).toBeLessThan(75)
    expect(sky.stamps('spark')).toEqual([])
  })

  it('never number more than MAX_SPARKS, whatever is played', () => {
    const sky = mount({ sparks: 'lots' })
    let most = 0
    for (let round = 0; round < 12; round++) {
      for (let midi = FULL.first; midi <= FULL.last; midi++) sky.bus.noteOn(midi, 'keyboard')
      browser.play(0.1)
      most = Math.max(most, sky.stamps('spark').length)
      sky.bus.allOff()
      browser.play(0.05)
    }
    expect(most).toBe(MAX_SPARKS)
  })

  it('stop at once when they are switched off', () => {
    const sky = mount({ sparks: 'lots' })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.5)
    sky.update({ sparks: 'off' })
    browser.frame()
    expect(sky.stamps('spark')).toEqual([])
  })
})

describe('the glow where a note meets the line', () => {
  it('is a bloom on the line, in the middle of the key', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.5)
    const bloom = only(sky.stamps('bloom'))
    expect(bloom.x + bloom.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
    expect(bloom.y + bloom.height / 2).toBeCloseTo(600, 6)
    // About two key widths of bright light: the picture is wider, because its edge is very faint.
    expect(bloom.width).toBeGreaterThan(keySpan(C4).width * 2)
    expect(bloom.width).toBeLessThan(keySpan(C4).width * 5)
    expect(bloom.blend).toBe('lighter')
  })

  it('flashes when the note is struck and settles within 150 ms', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.frame()
    const struck = only(sky.stamps('bloom'))
    browser.play(FLASH_SECONDS + 0.02)
    const settled = only(sky.stamps('bloom'))
    browser.play(0.3)
    const later = only(sky.stamps('bloom'))
    expect(struck.width).toBeGreaterThan(settled.width)
    expect(struck.alpha).toBeGreaterThan(settled.alpha)
    expect(later.width).toBe(settled.width)
    expect(later.alpha).toBe(settled.alpha)
    expect(FLASH_SECONDS).toBeLessThanOrEqual(0.15)
  })

  it('fades out after the note stops', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.5)
    const sounding = only(sky.stamps('bloom')).alpha
    sky.bus.noteOff(C4, 'keyboard')
    browser.play(AFTERGLOW_SECONDS / 2)
    expect(only(sky.stamps('bloom')).alpha).toBeLessThan(sounding)
    browser.play(AFTERGLOW_SECONDS / 2 + 0.05)
    expect(sky.stamps('bloom')).toEqual([])
  })

  it('makes the whole line glow brighter the more notes sound at once', () => {
    const lineAlpha = (sky: MountedSky): number =>
      sky.context.rects.find((rect) => rect.blend === 'lighter' && rect.width === 1300)?.alpha ?? 0
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(1)
    const one = lineAlpha(sky)
    for (const midi of [64, 67, 72]) sky.bus.noteOn(midi, 'keyboard')
    browser.play(1)
    const four = lineAlpha(sky)
    for (let midi = 36; midi < 48; midi++) sky.bus.noteOn(midi, 'keyboard')
    browser.play(1)
    const sixteen = lineAlpha(sky)
    expect(one).toBeGreaterThan(0)
    expect(four).toBeGreaterThan(one * 2)
    expect(sixteen).toBeGreaterThan(four)
    expect(sixteen).toBeLessThanOrEqual(1)

    sky.bus.allOff()
    browser.playUntilIdle()
    expect(lineAlpha(sky)).toBe(0)
  })
})

describe('the background', () => {
  it('is painted once and only copied after that', () => {
    const sky = mount({ background: 'stars' })
    const backdrop = only(sky.stamps('backdrop')).image as HTMLCanvasElement
    const painted = browser.contextOf(backdrop)
    expect(painted.discs).toBeGreaterThan(100)
    const wipes = painted.wipes

    sky.bus.noteOn(C4, 'keyboard')
    browser.play(1)
    sky.bus.allOff()
    browser.playUntilIdle()
    expect(painted.wipes).toBe(wipes)
    expect(only(sky.stamps('backdrop')).image).toBe(backdrop)
  })

  it('is painted again when the background, the colour or the size changes', () => {
    const sky = mount({ background: 'night' })
    const painted = browser.contextOf(only(sky.stamps('backdrop')).image as HTMLCanvasElement)
    const wipes = painted.wipes
    sky.update({ background: 'aurora' })
    expect(painted.wipes).toBe(wipes + 1)
    sky.update({ accent: 'purple' })
    expect(painted.wipes).toBe(wipes + 2)
    browser.resizeTo(1000, 500)
    expect(painted.wipes).toBe(wipes + 3)
    sky.update({ glow: 0.9 })
    expect(painted.wipes).toBe(wipes + 3)
  })

  it('is drawn behind the light, and a little brighter while notes sound', () => {
    const sky = mount({ background: 'night' })
    for (let midi = 60; midi < 68; midi++) sky.bus.noteOn(midi, 'keyboard')
    browser.play(1.5)
    const [behind, brighter] = sky.stamps('backdrop')
    expect(sky.stamps('backdrop')).toHaveLength(2)
    expect(behind).toMatchObject({ blend: 'destination-over', alpha: 1 })
    expect(brighter?.blend).toBe('lighter')
    expect(brighter?.alpha).toBeCloseTo(MAX_BACKGROUND_BOOST, 6)

    sky.bus.allOff()
    browser.play(0.1)
    const easing = sky.stamps('backdrop')[1]?.alpha ?? 0
    expect(easing).toBeLessThan(MAX_BACKGROUND_BOOST)
    expect(easing).toBeGreaterThan(0)
    browser.playUntilIdle()
    expect(sky.stamps('backdrop')).toHaveLength(1)
  })
})

describe('a song is loaded: falling notes', () => {
  const speed = skySpeed(600)
  const notes = [note(C4, 1, 0.5), note(D4, 2, 1), note(C_SHARP_4, 2.5, 0.25), note(64, 9, 1)]

  it('draws every note of the next few seconds above the line, as far up as it is ahead in time', () => {
    const song = fakeSong(notes)
    song.state.position = 0.5
    const sky = mount({ falling: song.source })
    const [c, d, cSharp] = sky.bars()
    expect(sky.bars()).toHaveLength(3)
    expect(bottomAboveLine(c as PaintedBar)).toBeCloseTo(0.5 * speed, 6)
    expect(topAboveLine(c as PaintedBar)).toBeLessThanOrEqual(1 * speed)
    expect(topAboveLine(c as PaintedBar)).toBeGreaterThan(1 * speed - 3)
    expect(bottomAboveLine(d as PaintedBar)).toBeCloseTo(1.5 * speed, 6)
    expect(centreOf(c as PaintedBar)).toBeCloseTo(keySpan(C4).centre, 6)
    expect(centreOf(d as PaintedBar)).toBeCloseTo(keySpan(D4).centre, 6)
    // The black-key note is drawn last, over the others.
    expect(centreOf(cSharp as PaintedBar)).toBeCloseTo(keySpan(C_SHARP_4).centre, 6)
  })

  it('stands still while the song is not playing, and uses no frames', () => {
    const song = fakeSong(notes)
    mount({ falling: song.source })
    expect(browser.frames.requested).toBe(0)
  })

  it('lets the notes fall while the song plays: each reaches the line exactly when it sounds', () => {
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })
    song.state.playing = true
    sky.update({})
    expect(browser.frames.pending.size).toBe(1)
    song.play(1)
    expect(song.state.position).toBeCloseTo(1, 6)
    expect(bottomAboveLine(sky.bars()[0] as PaintedBar)).toBeCloseTo(0, 4)
    song.play(0.25)
    // It now sinks into the line: its lower end is below it.
    expect(bottomAboveLine(sky.bars()[0] as PaintedBar)).toBeCloseTo(-0.25 * speed, 4)
    song.play(0.3)
    // The first note has ended and is gone: the two others are left.
    expect(sky.bars()).toHaveLength(2)
    expect(centreOf(sky.bars()[0] as PaintedBar)).toBeCloseTo(keySpan(D4).centre, 6)
  })

  it('stops asking for frames when the song is paused, and the notes stay where they are', () => {
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })
    song.state.playing = true
    sky.update({})
    song.play(0.5)
    song.state.playing = false
    browser.frame()
    expect(browser.frames.pending.size).toBe(0)
    expect(sky.bars()).toHaveLength(3)
  })

  it('notices by itself, within a moment, that the song has started or was moved', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })
    const wipes = sky.context.wipes

    // Moved while paused: one new picture, no animation.
    song.state.position = 1.2
    vi.advanceTimersByTime(150)
    expect(sky.context.wipes).toBe(wipes + 1)
    expect(browser.frames.requested).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(sky.context.wipes).toBe(wipes + 1)

    song.state.playing = true
    vi.advanceTimersByTime(150)
    expect(browser.frames.pending.size).toBe(1)
  })

  it('shows the new place at once when the song is moved and the page is drawn again', () => {
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })
    song.state.position = 8.5
    sky.update({})
    expect(bottomAboveLine(only(sky.bars()))).toBeCloseTo(0.5 * speed, 6)
    expect(browser.frames.requested).toBe(0)
  })

  it('draws no rising bars while a song is loaded, but the keys still glow and throw sparks', () => {
    const song = fakeSong([])
    const sky = mount({ falling: song.source, sparks: 'some' })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.5)
    expect(sky.bars()).toEqual([])
    expect(sky.stamps('bloom')).toHaveLength(1)
    expect(sky.stamps('spark').length).toBeGreaterThan(0)
    sky.bus.allOff()
    browser.playUntilIdle()
  })

  it('goes back to rising bars when the song is closed, with a bar for a key that is held', () => {
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    sky.update({ falling: null })
    browser.play(0.2)
    const bar = only(sky.bars())
    expect(centreOf(bar)).toBeCloseTo(keySpan(C4).centre, 6)
    expect(bottomAboveLine(bar)).toBeLessThanOrEqual(0)
  })

  it('drops the rising bars when a song is loaded', () => {
    const song = fakeSong([])
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.3)
    sky.bus.noteOff(C4, 'keyboard')
    sky.update({ falling: song.source })
    browser.frame()
    expect(sky.bars()).toEqual([])
  })

  it('does not draw notes that are not on the piano', () => {
    const song = fakeSong([note(30, 1, 1), note(C4, 1, 1), note(100, 1, 1)])
    const sky = mount({ falling: song.source, range: SMALL })
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4, SMALL).centre, 6)
  })

  it('draws no falling notes with light bars switched off, and does not animate for them', () => {
    const song = fakeSong(notes)
    song.state.playing = true
    const sky = mount({ falling: song.source, showBars: false })
    expect(sky.bars()).toEqual([])
    expect(browser.frames.requested).toBe(0)
  })

  it('keeps falling with reduced motion, because the notes are information', () => {
    browser.setReducedMotion(true)
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source, sparks: 'lots' })
    song.state.playing = true
    sky.update({})
    expect(song.play(1)).toBe(60)
    expect(bottomAboveLine(sky.bars()[0] as PaintedBar)).toBeCloseTo(0, 4)
    sky.bus.noteOn(C4, 'playback')
    song.play(0.2)
    expect(sky.stamps('spark')).toEqual([])
    // No flash and no brightening: the glow is steady.
    expect(sky.stamps('backdrop')).toHaveLength(1)
    const steady = only(sky.stamps('bloom'))
    song.play(0.2)
    expect(only(sky.stamps('bloom'))).toEqual(steady)
  })

  it('draws only the notes that are on screen, however long the song', () => {
    const long: PlayableNote[] = []
    for (let i = 0; i < 50_000; i++) long.push(note(48 + (i % 37), i * 0.1, 0.09))
    const song = fakeSong(long)
    song.state.position = 2500
    song.state.playing = true
    const sky = mount({ falling: song.source })
    song.play(0.5)
    // Three seconds of music at ten notes a second, give or take the ones at the edges.
    expect(sky.bars().length).toBeGreaterThanOrEqual(29)
    expect(sky.bars().length).toBeLessThanOrEqual(32)
  })

  it('never asks a crowded song for more bars than it can draw smoothly', () => {
    const crowded: PlayableNote[] = []
    for (let i = 0; i < 20_000; i++) crowded.push(note(21 + (i % 88), 1 + i * 0.0001, 0.5))
    const song = fakeSong(crowded)
    const sky = mount({ falling: song.source })
    expect(sky.bars().length).toBeGreaterThan(100)
    expect(sky.bars().length).toBeLessThanOrEqual(400)
  })

  it('follows the song to its new notes when the arrangement changes', () => {
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })
    expect(sky.bars()).toHaveLength(3)
    const other = fakeSong([note(C4, 1, 1)])
    sky.update({ falling: other.source })
    expect(sky.bars()).toHaveLength(1)
  })
})

describe('a song is loaded: key letters', () => {
  const speed = skySpeed(600)
  const hints = new Map<Midi, string>([
    [C4, 'A'],
    [C_SHARP_4, 'W'],
    [D4, 'S'],
    [64, 'Num 1'],
  ])

  it('writes the letter of the key inside the bar, at its lower end', () => {
    const song = fakeSong([note(C4, 1, 1), note(D4, 1.5, 1)])
    const sky = mount({ falling: song.source, hints })
    const [a, s] = sky.context.texts
    const [c, d] = sky.bars()
    expect(sky.context.texts.map((text) => text.text)).toEqual(['A', 'S'])
    for (const [text, bar] of [
      [a, c],
      [s, d],
    ] as const) {
      expect(text?.x).toBeCloseTo(centreOf(bar as PaintedBar), 6)
      // In the lower end of the bar, and inside it.
      const end = (bar?.y ?? 0) + (bar?.height ?? 0)
      expect(text?.y).toBeLessThan(end)
      expect(text?.y).toBeGreaterThan(end - 20)
      expect(text?.alpha).toBe(1)
    }
    // Sized to the bar: a bar 21 wide holds a letter of about 13.
    expect(a?.font).toMatch(/\b1[0-4]px\b/)
  })

  it('writes nothing with hints off, and nothing on a note that no key plays', () => {
    const song = fakeSong([note(C4, 1, 1), note(65, 1, 1)])
    const withHints = mount({ falling: song.source, hints })
    expect(withHints.context.texts.map((text) => text.text)).toEqual(['A'])
    withHints.unmount()
    const without = mount({ falling: song.source })
    expect(without.context.texts).toEqual([])
  })

  it('writes no letter on a bar narrower than 14 pixels', () => {
    // On the full piano in this sky a black-key bar is about 13 wide.
    const song = fakeSong([note(C_SHARP_4, 1, 1)])
    const narrow = mount({ falling: song.source, hints })
    expect(only(narrow.bars()).width).toBeLessThan(14)
    expect(narrow.context.texts).toEqual([])
    narrow.unmount()
    const wide = mount({ falling: song.source, hints, range: SMALL })
    expect(only(wide.bars()).width).toBeGreaterThanOrEqual(14)
    expect(wide.context.texts.map((text) => text.text)).toEqual(['W'])
  })

  it('writes no letter on a bar too short to hold it', () => {
    const song = fakeSong([note(C4, 1, 0.04)])
    const sky = mount({ falling: song.source, hints })
    expect(only(sky.bars()).height).toBeLessThan(10)
    expect(sky.context.texts).toEqual([])
  })

  it('makes a long label smaller so that it stays inside its bar', () => {
    const song = fakeSong([note(64, 1, 1)])
    const sky = mount({ falling: song.source, hints, range: SMALL })
    const text = only(sky.context.texts)
    const bar = only(sky.bars())
    const size = Number.parseFloat(/(\d+)px/.exec(text.font)?.[1] ?? '0')
    expect(text.text).toBe('Num 1')
    // The stand-in canvas makes every character 0.6 times as wide as the font is tall.
    expect(text.text.length * size * 0.6).toBeLessThan(bar.width)
    expect(size).toBeGreaterThanOrEqual(8)
  })

  it('rests the letter on the line while the note sounds, until too little of the bar is left', () => {
    const song = fakeSong([note(C4, 1, 1)])
    song.state.position = 1.5
    const sky = mount({ falling: song.source, hints })
    const text = only(sky.context.texts)
    expect(text.y).toBeLessThan(600)
    expect(text.y).toBeGreaterThan(580)
    song.state.position = 1.97
    sky.update({})
    expect(sky.context.texts).toEqual([])
    expect(0.03 * speed).toBeLessThan(10)
  })

  it('fades the letter with its bar at the top of the sky', () => {
    const song = fakeSong([note(C4, 2.9, 1)])
    const sky = mount({ falling: song.source, hints })
    const text = only(sky.context.texts)
    expect(text.alpha).toBeGreaterThan(0)
    expect(text.alpha).toBeLessThan(1)
  })
})

describe('what a frame costs', () => {
  it('makes nothing new once it is running: no gradient, no picture and no blur per frame', () => {
    const song = fakeSong([note(C4, 1, 3), note(64, 1, 3), note(67, 1.5, 0.5), note(C_SHARP_4, 2, 1)])
    const hints = new Map<Midi, string>([[C4, 'A']])
    const sky = mount({ falling: song.source, hints, sparks: 'lots', background: 'stars', accent: 'rainbow' })
    song.state.playing = true
    sky.update({})
    for (const midi of [C4, 64, 67, C_SHARP_4, 70]) sky.bus.noteOn(midi, 'playback')
    song.play(0.5)

    const made = (): number => browser.contexts().reduce((sum, context) => sum + context.gradientsMade, 0)
    const blurs = (): number => browser.contexts().reduce((sum, context) => sum + context.blursAsked, 0)
    const before = { gradients: made(), blurs: blurs(), pictures: browser.contexts().length }
    song.play(1.5)
    expect(sky.stamps('spark').length).toBeGreaterThan(50)
    expect(made()).toBe(before.gradients)
    expect(blurs()).toBe(before.blurs)
    expect(browser.contexts().length).toBe(before.pictures)
    // The sky's own canvas is never asked to blur anything: glows are ready-made pictures.
    expect(sky.context.blursAsked).toBe(0)
  })

  it('prepares the notes of a song once, not on every frame', () => {
    const long: PlayableNote[] = []
    for (let i = 0; i < 50_000; i++) long.push(note(48 + (i % 37), i * 0.1, 0.09))
    let reads = 0
    const watched = new Proxy(long, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const song = fakeSong(watched)
    song.state.position = 1000
    song.state.playing = true
    mount({ falling: song.source })
    song.play(0.2)
    reads = 0
    song.play(1)
    // Sixty frames of about thirty bars each, drawn in three passes, plus the searches.
    expect(reads).toBeLessThan(60 * 200)
  })
})

describe('cleaning up', () => {
  it('stops everything when it is taken off the screen in the middle of a note', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const removeFromWindow = vi.spyOn(window, 'removeEventListener')
    const bus = new CountingBus()
    const song = fakeSong([note(C4, 1, 1)])
    const sky = mount({ bus, falling: song.source, sparks: 'some' })
    song.state.playing = true
    sky.update({})
    bus.noteOn(C4, 'keyboard')
    song.play(0.2)
    sky.unmount()

    expect(browser.frames.pending.size).toBe(0)
    expect(browser.observers()).toBe(0)
    expect(browser.motionListeners()).toBe(0)
    expect(bus.subscribers).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(removeFromWindow.mock.calls.some(([type]) => type === 'resize')).toBe(true)
    expect(sky.bars()).toEqual([])
    expect(sky.context.images).toEqual([])

    // Nothing it left behind reacts to later notes, resizes or setting changes.
    const wipes = sky.context.wipes
    const requested = browser.frames.requested
    bus.noteOn(D4, 'keyboard')
    bus.allOff()
    window.dispatchEvent(new Event('resize'))
    browser.setReducedMotion(true)
    vi.advanceTimersByTime(1000)
    expect(browser.frames.requested).toBe(requested)
    expect(sky.context.wipes).toBe(wipes)
    removeFromWindow.mockRestore()
  })

  it('has one of everything, and draws each note once, when mounted twice by StrictMode', () => {
    const bus = new CountingBus()
    const sky = mount({ bus }, true)
    expect(bus.subscribers).toBe(1)
    expect(browser.observers()).toBe(1)
    expect(browser.motionListeners()).toBe(1)
    bus.noteOn(C4, 'keyboard')
    expect(browser.frames.pending.size).toBe(1)
    browser.play(0.2)
    expect(sky.bars()).toHaveLength(1)
    bus.noteOff(C4, 'keyboard')
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })

  it('starts over with a new bus, and stops listening to the old one', () => {
    const first = new CountingBus()
    const second = new CountingBus()
    const sky = mount({ bus: first })
    sky.update({ bus: second })
    expect(first.subscribers).toBe(0)
    expect(second.subscribers).toBe(1)
    first.noteOn(C4, 'keyboard')
    expect(browser.frames.pending.size).toBe(0)
    second.noteOn(D4, 'keyboard')
    browser.play(0.2)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(D4).centre, 6)
  })
})
