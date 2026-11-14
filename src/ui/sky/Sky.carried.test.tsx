// @vitest-environment jsdom
/**
 * Checks carried over from the light trails, which the sky replaced.
 *
 * The trails had tests of their own (the model, the canvas, and what they
 * cost). Most of what those asked for is asked of the sky in Sky.test.tsx and
 * skyModel.test.ts. The ones here are the rest: things the trails were held
 * to that no test of the sky said yet. The last check of the file is not
 * carried over: it was added when this move was reviewed.
 *
 * As in Sky.test.tsx: the real <Sky /> on a real NoteBus, drawing on a
 * stand-in canvas with a hand-cranked frame clock (see skyTestKit.ts). The sky
 * is 1300 x 600 CSS pixels, so light travels 200 pixels a second.
 */
import { StrictMode } from 'react'
import type { JSX } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_BASE_OCTAVE,
  MIN_AUTO_KEY_WIDTH,
  MIN_BASE_OCTAVE,
  PIANO_SIZES,
  pianoRange,
  resolvePianoSize,
} from '../../core/layout'
import type { PianoRange } from '../../core/layout'
import { NoteBus } from '../../core/noteBus'
import { keyRectOf, keyRects, whiteKeyCount } from '../../core/pianoGeometry'
import type { Midi, NoteListener } from '../../core/types'
import type { PlayableNote } from '../../songs/song'
import { Sky } from './Sky'
import type { FallingSource, SkyProps } from './Sky'
import {
  MAX_FRAME_MS,
  barLeft,
  barWidth,
  fadeHeight,
  releaseBar,
  skySpeed,
  startBar,
  stillGlowHeight,
} from './skyModel'
import type { RisingBar } from './skyModel'
import { FRAME_MS, installFakeBrowser } from './skyTestKit'
import type { FakeBrowser, FakeContext, PaintedBar } from './skyTestKit'

const FULL = pianoRange(88, 3)
const SMALL = pianoRange(37, 3)
const C4 = 60
const C_SHARP_4 = 61
const D4 = 62
const WIDTH = 1300
const HEIGHT = 600
const NO_HINTS: ReadonlyMap<Midi, string> = new Map()

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Helpers (as in Sky.test.tsx)
// ---------------------------------------------------------------------------

interface MountedSky {
  bus: NoteBus
  canvas: HTMLCanvasElement
  context: FakeContext
  /** The bars on the canvas right now. */
  bars(): PaintedBar[]
  update(patch: Partial<SkyProps>): void
  unmount(): void
}

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
    update(patch) {
      props = { ...props, ...patch }
      view.rerender(page())
    },
    unmount: () => act(() => view.unmount()),
  }
}

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1)
  return items[0] as T
}

/** Where a key is across the sky, in pixels. */
function keySpan(midi: Midi, range: PianoRange = FULL, width = WIDTH) {
  const key = keyRectOf(midi, range)
  if (!key) throw new Error(`note ${midi} is not on this piano`)
  return { left: key.left * width, width: key.width * width, centre: (key.left + key.width / 2) * width }
}

const centreOf = (bar: PaintedBar): number => bar.x + bar.width / 2
/** How far the two ends of a bar are above the line. */
const topAboveLine = (bar: PaintedBar): number => browser.size.height - bar.y
const bottomAboveLine = (bar: PaintedBar): number => browser.size.height - (bar.y + bar.height)

/** The middles of some bars or keys, left to right, as text that can be compared. */
function leftToRight(centres: readonly number[]): string[] {
  return [...centres].sort((a, b) => a - b).map((centre) => centre.toFixed(6))
}

function note(midi: Midi, time: number, duration: number): PlayableNote {
  return { midi, time, duration, velocity: 0.8 }
}

/** A song that stands still at its start. */
function stillSong(notes: PlayableNote[]): FallingSource {
  return { getNotes: () => notes, getPosition: () => 0, isPlaying: () => false }
}

// ---------------------------------------------------------------------------

describe('the model: a bar and its key', () => {
  it('gives every bar the left edge and the width of its key, white or black, on every piano', () => {
    for (const size of PIANO_SIZES) {
      const range = pianoRange(size, 3)
      const bars: RisingBar[] = []
      for (const key of keyRects(range)) startBar(bars, key.midi, range)
      expect(bars.map(({ midi, black, left, width }) => ({ midi, black, left, width }))).toEqual(
        keyRects(range).map(({ midi, black, left, width }) => ({ midi, black, left, width })),
      )
    }
  })

  it('leaves the bars of the other notes alone when one is let go', () => {
    const bars: RisingBar[] = []
    startBar(bars, C4, FULL)
    startBar(bars, D4, FULL)
    const other = { ...(bars[1] as RisingBar) }
    releaseBar(bars, C4)
    expect(bars[1]).toEqual(other)
  })

  it('fades bars over a share of the sky: twice as far in a sky twice as high', () => {
    expect(fadeHeight(HEIGHT * 2)).toBeCloseTo(fadeHeight(HEIGHT) * 2, 10)
    expect(fadeHeight(HEIGHT)).toBeLessThan(HEIGHT)
  })

  it('still gives a bar a whole pixel of width on a key that is hardly there', () => {
    expect(barWidth(0)).toBeGreaterThanOrEqual(1)
    // A black key of the full piano in a sky 20 pixels wide: a quarter of a pixel.
    const narrowKey = keySpan(C_SHARP_4, FULL, 20).width
    expect(narrowKey).toBeLessThan(1)
    expect(barWidth(narrowKey)).toBeGreaterThanOrEqual(1)
  })
})

describe('free play: where the bars stand', () => {
  it('shows the first and the last key of the piano on their own keys, at every size and position', () => {
    for (const size of PIANO_SIZES) {
      for (let octave = MIN_BASE_OCTAVE; octave <= MAX_BASE_OCTAVE; octave++) {
        const range = pianoRange(size, octave)
        const sky = mount({ range })
        sky.bus.noteOn(range.first, 'pointer')
        sky.bus.noteOn(range.last, 'pointer')
        browser.play(0.2)
        const [low, high] = sky.bars()
        if (!low || !high) throw new Error('two bars were expected')
        expect(sky.bars()).toHaveLength(2)
        // Both ends of a piano are white keys: half a key in from each edge of the sky.
        const whiteKey = WIDTH / whiteKeyCount(range)
        expect(centreOf(low), `${size} keys, octave ${octave}`).toBeCloseTo(whiteKey / 2, 6)
        expect(centreOf(high), `${size} keys, octave ${octave}`).toBeCloseTo(WIDTH - whiteKey / 2, 6)
        sky.bus.allOff()
        sky.unmount()
        browser.frames.pending.clear()
      }
    }
  })

  it.each([
    ['the full piano', FULL],
    ['the keyboard zone alone', SMALL],
  ])('draws a bar above every key when all of %s is held at once', (_name, range) => {
    const sky = mount({ range })
    const notes = keyRects(range).map((key) => key.midi)
    for (const midi of notes) sky.bus.noteOn(midi, 'playback')
    browser.play(0.2)
    expect(leftToRight(sky.bars().map(centreOf))).toEqual(
      leftToRight(notes.map((midi) => keySpan(midi, range).centre)),
    )
    // Every bar stands on the line, inside its own key.
    for (const bar of sky.bars()) {
      expect(bottomAboveLine(bar)).toBeLessThanOrEqual(0)
      expect(bar.width).toBeLessThan(WIDTH / whiteKeyCount(range))
    }
    // Still one frame request at a time.
    expect(browser.frames.pending.size).toBe(1)
  })

  it('keeps one bar on the key while a second source still holds the note', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.3)
    sky.bus.noteOn(C4, 'pointer')
    browser.play(0.1)
    expect(sky.bars()).toHaveLength(2)

    sky.bus.noteOff(C4, 'keyboard')
    browser.play(0.1)
    // Still held by the pointer: one bar stays attached to the key.
    expect(sky.bars()).toHaveLength(2)
    expect(sky.bars().filter((bar) => bottomAboveLine(bar) <= 0)).toHaveLength(1)

    sky.bus.noteOff(C4, 'pointer')
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })

  it('still draws a bar a whole pixel wide in a sky that is hardly there', () => {
    browser.size.width = 20
    const sky = mount()
    sky.bus.noteOn(C_SHARP_4, 'keyboard')
    browser.play(0.2)
    expect(only(sky.bars()).width).toBeGreaterThanOrEqual(1)
  })
})

describe('free play: frames', () => {
  it('stops asking for frames once the last bar has left, and starts again at the next note', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    expect(browser.frames.pending.size).toBe(1)
    // Held, and its bar still growing: one frame at a time.
    for (let i = 0; i < 120; i++) expect(browser.frame()).toBe(1)
    expect(browser.frames.pending.size).toBe(1)

    sky.bus.noteOff(C4, 'keyboard')
    // The bar now rises out of the sky: a few seconds at most.
    const ran = browser.playUntilIdle()
    expect(ran).toBeGreaterThan(10)
    expect(ran).toBeLessThan(400)
    expect(browser.frames.pending.size).toBe(0)
    expect(browser.frame()).toBe(0)
    expect(sky.bars()).toEqual([])

    sky.bus.noteOn(D4, 'keyboard')
    expect(browser.frames.pending.size).toBe(1)
    browser.play(0.1)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(D4).centre, 6)
  })

  it('carries on at its usual speed after the tab was hidden for minutes', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.frame()
    browser.play(0.1)
    // The browser stops drawing a hidden tab. Ten minutes later it draws again.
    browser.frame(10 * 60 * 1000)
    const after = topAboveLine(only(sky.bars()))
    expect(after).toBeCloseTo(skySpeed(HEIGHT) * (0.1 + MAX_FRAME_MS / 1000), 6)
    browser.frame()
    const next = topAboveLine(only(sky.bars()))
    expect(next - after).toBeCloseTo((skySpeed(HEIGHT) * FRAME_MS) / 1000, 6)
  })

  it('finishes the bars of notes released while the tab was hidden, then goes idle', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.3)
    // Hiding the page releases every note; no frame runs until it is shown again.
    sky.bus.allOff()
    browser.frame(5 * 60 * 1000)
    expect(sky.bars()).toHaveLength(1)
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
    expect(browser.frames.pending.size).toBe(0)
  })

  it('makes nothing new per frame however many bars there are: no gradient, no picture, no blur', () => {
    const sky = mount({ accent: 'rainbow', background: 'stars' })
    for (const key of keyRects(FULL)) sky.bus.noteOn(key.midi, 'keyboard')
    browser.play(0.5)

    const gradients = (): number =>
      browser.contexts().reduce((sum, context) => sum + context.gradientsMade, 0)
    const blurs = (): number => browser.contexts().reduce((sum, context) => sum + context.blursAsked, 0)
    const before = { gradients: gradients(), blurs: blurs(), pictures: browser.contexts().length }
    expect(browser.play(1)).toBe(60)
    expect(sky.bars()).toHaveLength(88)
    expect(gradients()).toBe(before.gradients)
    expect(blurs()).toBe(before.blurs)
    expect(browser.contexts().length).toBe(before.pictures)
    expect(sky.context.blursAsked).toBe(0)

    // And every bar is drawn once a frame, not once for every other bar.
    browser.frame()
    expect(sky.bars()).toHaveLength(88)
  })
})

describe('resizing: a sky that has no area for a while', () => {
  it('asks for no frame when its area comes back and no key is held, and works again at the next note', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    browser.resizeTo(0, 0)
    expect(browser.frames.pending.size).toBe(0)
    expect(sky.bars()).toEqual([])
    sky.bus.noteOff(C4, 'keyboard')
    sky.bus.noteOn(D4, 'keyboard')
    expect(browser.frames.pending.size).toBe(0)
    sky.bus.noteOff(D4, 'keyboard')

    browser.resizeTo(WIDTH, HEIGHT)
    expect(browser.frames.pending.size).toBe(0)
    expect(sky.bars()).toEqual([])
    sky.bus.noteOn(C4, 'keyboard')
    expect(browser.frames.pending.size).toBe(1)
    browser.play(0.2)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4).centre, 6)
  })

  it('shows the still glow for a key that is still held when its height comes back (reduced motion)', () => {
    browser.setReducedMotion(true)
    const sky = mount()
    browser.resizeTo(WIDTH, 0)
    sky.bus.noteOn(C4, 'keyboard')
    expect(sky.bars()).toEqual([])

    browser.resizeTo(WIDTH, HEIGHT)
    const glow = only(sky.bars())
    expect(centreOf(glow)).toBeCloseTo(keySpan(C4).centre, 6)
    expect(topAboveLine(glow)).toBe(stillGlowHeight(HEIGHT))
    expect(browser.frames.requested).toBe(0)
  })

  it('gives a held key its bar where the key now is, when the piano changed while there was no height', () => {
    const sky = mount()
    browser.resizeTo(WIDTH, 0)
    sky.update({ range: SMALL })
    // On the small piano C4 is somewhere else than on the full one.
    sky.bus.noteOn(C4, 'keyboard')

    browser.resizeTo(WIDTH, HEIGHT)
    browser.play(0.2)
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C4, SMALL).centre, 6)
    expect(keySpan(C4, SMALL).centre).not.toBeCloseTo(keySpan(C4, FULL).centre, 0)
  })
})

describe('when the piano on screen changes many times', () => {
  it('keeps one of everything, and never more than one frame waiting, while notes are played in between', () => {
    const bus = new CountingBus()
    const sky = mount({ bus }, true)
    for (let move = 0; move < 20; move++) {
      bus.noteOn(60 + move, 'keyboard')
      sky.update({ range: pianoRange(move % 2 === 0 ? 61 : 37, 1 + (move % 5)) })
      expect(browser.frames.pending.size).toBeLessThanOrEqual(1)
    }
    expect(bus.subscribers).toBe(1)
    expect(browser.observers()).toBe(1)
    expect(browser.motionListeners()).toBe(1)

    // The light of every piano that went by is gone: only what is played now shows.
    bus.allOff()
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
    expect(browser.frames.pending.size).toBe(0)
  })
})

describe('reduced motion', () => {
  it('shows one still glow for each held key, standing on the line, as wide as a bar', () => {
    browser.setReducedMotion(true)
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(C_SHARP_4, 'keyboard')
    const [white, black] = sky.bars()
    if (!white || !black) throw new Error('two glows were expected')
    expect(sky.bars()).toHaveLength(2)
    for (const [glow, midi] of [
      [white, C4],
      [black, C_SHARP_4],
    ] as const) {
      const key = keySpan(midi)
      expect(glow.x).toBeCloseTo(barLeft(key.left, key.width), 6)
      expect(glow.width).toBeCloseTo(barWidth(key.width), 6)
      expect(topAboveLine(glow)).toBe(stillGlowHeight(HEIGHT))
      expect(bottomAboveLine(glow)).toBe(0)
    }
    expect(stillGlowHeight(HEIGHT)).toBeLessThan(HEIGHT / 2)

    sky.bus.noteOff(C4, 'keyboard')
    expect(centreOf(only(sky.bars()))).toBeCloseTo(keySpan(C_SHARP_4).centre, 6)
    sky.bus.noteOff(C_SHARP_4, 'keyboard')
    expect(sky.bars()).toEqual([])
    expect(browser.frames.requested).toBe(0)
  })

  it('leaves only the glow of the key still held when it is switched on in the middle of a note', () => {
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(D4, 'keyboard')
    browser.frame()
    browser.play(1)
    sky.bus.noteOff(D4, 'keyboard')
    browser.play(0.1)
    expect(sky.bars()).toHaveLength(2)
    // The bar of the held key has grown taller than a still glow is.
    expect(Math.max(...sky.bars().map(topAboveLine))).toBeGreaterThan(stillGlowHeight(HEIGHT))

    browser.setReducedMotion(true)
    expect(browser.frames.pending.size).toBe(0)
    // Only the held note is left, as a still glow; the rising bar is gone.
    const glow = only(sky.bars())
    expect(centreOf(glow)).toBeCloseTo(keySpan(C4).centre, 6)
    expect(topAboveLine(glow)).toBe(stillGlowHeight(HEIGHT))
    expect(bottomAboveLine(glow)).toBe(0)
    expect(browser.frame()).toBe(0)
    expect(browser.frames.pending.size).toBe(0)
  })

  it('grows the bar from the line, at the speed of the sky, when it is switched off in the middle of a note', () => {
    browser.setReducedMotion(true)
    const sky = mount()
    sky.bus.noteOn(C4, 'keyboard')
    expect(browser.frames.requested).toBe(0)

    browser.setReducedMotion(false)
    expect(browser.frames.pending.size).toBe(1)
    browser.frame()
    browser.play(0.3)
    expect(topAboveLine(only(sky.bars()))).toBeCloseTo(skySpeed(HEIGHT) * 0.3, 6)
    sky.bus.noteOff(C4, 'keyboard')
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })
})

describe('what the sky reads from the page', () => {
  const hints = new Map<Midi, string>([[C4, 'A']])
  const song = [note(C4, 1, 1)]

  it('writes the key letters in the typeface the page names', () => {
    vi.stubGlobal('getComputedStyle', () => ({ fontFamily: '"Test Mono", monospace' }))
    const sky = mount({ falling: stillSong(song), hints })
    expect(only(sky.context.letters).text).toBe('A')
    expect(only(sky.context.letters).font).toMatch(/^700 \d+px "Test Mono", monospace$/)
  })

  it('falls back to a plain typewriter face when the page names none, instead of failing', () => {
    vi.stubGlobal('getComputedStyle', () => ({ fontFamily: '' }))
    const sky = mount({ falling: stillSong(song), hints })
    expect(only(sky.context.letters).text).toBe('A')
    expect(only(sky.context.letters).font).toMatch(/^700 \d+px monospace$/)
  })
})

// Not carried over: this one came out of the review of the new sky. A key
// letter is written on a bar that is 13 pixels wide or more, and that number
// hangs together with another: "Auto" draws white keys down to
// MIN_AUTO_KEY_WIDTH wide, and where they are exactly that wide the bars of
// the black keys are at their narrowest, between 13 and 14 pixels. With the
// full piano that is a window 1352 wide, a little under the common 1366. The
// sharps and flats of a song must carry their letter there like other notes.
describe('key letters on the narrowest keys that Auto draws', () => {
  const hints = new Map<Midi, string>([[C_SHARP_4, 'W']])
  const song = [note(C_SHARP_4, 1, 1)]

  it.each([88, 61, 49] as const)(
    'are written on black-key notes too, in the narrowest window where Auto shows %i keys',
    (size) => {
      const range = pianoRange(size, 3)
      const width = whiteKeyCount(range) * MIN_AUTO_KEY_WIDTH
      // One pixel narrower and Auto shows a smaller piano, whose keys are wider again.
      expect(resolvePianoSize('auto', width)).toBe(size)
      expect(resolvePianoSize('auto', width - 1)).not.toBe(size)

      browser.size.width = width
      const sky = mount({ range, falling: stillSong(song), hints })
      const bar = only(sky.bars())
      expect(bar.width).toBeCloseTo(barWidth(keySpan(C_SHARP_4, range, width).width), 6)
      expect(bar.width).toBeGreaterThanOrEqual(13)
      expect(bar.width).toBeLessThan(14)
      expect(only(sky.context.letters).text).toBe('W')
    },
  )
})
