// @vitest-environment jsdom
/**
 * Hunting for what is still wrong in the sky, where the light is drawn: the
 * real <Sky /> on a real NoteBus, drawing on the stand-in canvas of
 * skyTestKit.ts, pushed where a player (or a browser) would push it: very
 * long and very short notes, keys held for minutes, bursts, a tab that was
 * away, every look, sizes down to nothing, a drawing context that goes away.
 *
 * The sky is 1300 x 600 CSS pixels unless a test changes it. On the full
 * piano (52 white keys) every white key is then 25 wide, and light travels
 * 200 pixels a second.
 */
import type { JSX } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { paletteFor, paletteForNote } from '../../core/colour'
import { pianoRange } from '../../core/layout'
import type { PianoRange } from '../../core/layout'
import { NoteBus } from '../../core/noteBus'
import { keyRectOf } from '../../core/pianoGeometry'
import type { AccentChoice, BackgroundName, BarStyle, Midi, SparksLevel } from '../../core/types'
import type { PlayableNote } from '../../songs/song'
import { Sky } from './Sky'
import type { FallingSource, SkyProps } from './Sky'
import { MAX_BARS, MAX_SPARKS, SKY_SECONDS, skySpeed } from './skyModel'
import { BLOOM_PICTURE_SIZE, SPARK_PICTURE_SIZE } from './skySprites'
import { FRAME_MS, FakeGradient, carriesText, installFakeBrowser } from './skyTestKit'
import type { FakeBrowser, FakeContext, PaintedBar, StampedImage } from './skyTestKit'

const FULL = pianoRange(88, 3)
const SMALL = pianoRange(37, 3)
const C4 = 60
const C_SHARP_4 = 61
const D4 = 62
const E4 = 64
const F4 = 65
const NO_HINTS: ReadonlyMap<Midi, string> = new Map()
/** The smallest and the largest letter the sky writes on a bar, in pixels: its own choice of what can be read. */
const SMALLEST_LETTER = 8
const LARGEST_LETTER = 20

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

type StampKind = 'spark' | 'bloom' | 'backdrop' | 'letter' | 'glow'

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
function mount(overrides: Partial<SkyProps> = {}): MountedSky {
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
  const page = (): JSX.Element => <Sky {...props} />
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
  if (carriesText(source)) return 'letter'
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
/** How far the lower end of a bar is above the line. */
const bottomAboveLine = (bar: PaintedBar): number => browser.size.height - (bar.y + bar.height)
const topAboveLine = (bar: PaintedBar): number => browser.size.height - bar.y

/** The bars that stand on the key of `midi`. */
function barsOn(sky: MountedSky, midi: Midi, range: PianoRange = FULL): PaintedBar[] {
  const { centre } = keySpan(midi, range)
  return sky.bars().filter((bar) => Math.abs(centreOf(bar) - centre) < 0.01)
}

/** A song the tests move by hand. */
function fakeSong(notes: PlayableNote[]) {
  const state = { position: 0, playing: false }
  const source: FallingSource = {
    getNotes: () => notes,
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

/** The size, in pixels, a piece of text was written at. */
function sizeOf(font: string): number {
  return Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 'NaN')
}

/** The colours of a gradient a bar was filled with. */
function coloursOf(fill: unknown): string[] {
  return fill instanceof FakeGradient ? fill.stops.map(([, colour]) => colour) : []
}

// ---------------------------------------------------------------------------
// Key letters on falling notes
// ---------------------------------------------------------------------------

describe('key letters on falling notes', () => {
  const hints = new Map<Midi, string>([
    [C4, 'A'],
    [D4, 'S'],
    [E4, 'D'],
    [F4, 'F'],
  ])
  const scale = [note(C4, 1, 1), note(D4, 1.2, 1), note(E4, 1.4, 1), note(F4, 1.6, 1)]

  it('writes every letter at the size of its bar in the very first picture of a song', () => {
    // A song that is loaded and not playing: this picture stays on screen until something changes.
    const song = fakeSong(scale)
    const sky = mount({ falling: song.source, hints })
    expect(sky.context.letters.map((text) => text.text)).toEqual(['A', 'S', 'D', 'F'])
    // A white-key bar is 21 wide here: its letter is about 13 tall.
    for (const text of sky.context.letters) {
      expect(sizeOf(text.font), `the size of "${text.text}"`).toBeGreaterThanOrEqual(SMALLEST_LETTER)
      expect(sizeOf(text.font), `the size of "${text.text}"`).toBeLessThanOrEqual(LARGEST_LETTER)
    }
  })

  it('writes the new letters at the size of their bars when the keys get other letters while the song is paused', () => {
    const song = fakeSong(scale)
    const sky = mount({ falling: song.source, hints })
    // One more picture: by now every letter above has been measured.
    sky.update({ glow: 0.7 })
    const before = sky.context.letters.map((text) => sizeOf(text.font))

    // Another keyboard type (or other keys chosen in Settings): the same notes, other letters.
    const azerty = new Map<Midi, string>([
      [C4, 'Q'],
      [D4, 'Z'],
      [E4, 'E'],
      [F4, 'R'],
    ])
    sky.update({ hints: azerty })
    expect(sky.context.letters.map((text) => text.text)).toEqual(['Q', 'Z', 'E', 'R'])
    expect(sky.context.letters.map((text) => sizeOf(text.font))).toEqual(before)
  })

  it('writes a letter that is seen for the first time in the middle of a song at the size of its bar', () => {
    const song = fakeSong([note(C4, 1, 0.5), note(D4, 1.2, 0.5), note(E4, 9, 1), note(F4, 9.2, 1)])
    const sky = mount({ falling: song.source, hints })
    // The player drags the progress slider while the song is paused: two letters not seen before.
    song.state.position = 8
    sky.update({})
    expect(sky.context.letters.map((text) => text.text)).toEqual(['D', 'F'])
    for (const text of sky.context.letters) {
      expect(sizeOf(text.font), `the size of "${text.text}"`).toBeLessThanOrEqual(LARGEST_LETTER)
    }
  })

  it('writes the same letters in the same places in every picture, from the very first one', () => {
    const song = fakeSong(scale)
    const sky = mount({ falling: song.source, hints })
    const first = sky.context.letters.map(({ text, x, y, font }) => ({ text, x, y, font }))
    expect(first.map(({ text }) => text)).toEqual(['A', 'S', 'D', 'F'])
    for (const glow of [0.7, 0.8]) {
      sky.update({ glow })
      expect(sky.context.letters.map(({ text, x, y, font }) => ({ text, x, y, font }))).toEqual(first)
    }
    for (const text of first) expect(sizeOf(text.font)).toBeLessThanOrEqual(LARGEST_LETTER)
  })

  it('writes a small letter on a bar 13 pixels wide, and none on a narrower bar', () => {
    // The black keys of a full piano are the narrowest there are. In a sky 1300
    // wide their bars are 13.02 wide; in a sky 1280 wide, 12.82.
    const letters = new Map<Midi, string>([
      [C4, 'A'],
      [C_SHARP_4, 'W'],
    ])
    const song = fakeSong([note(C4, 1, 1), note(C_SHARP_4, 1.2, 1)])
    const sky = mount({ falling: song.source, hints: letters })
    const narrowest = only(barsOn(sky, C_SHARP_4))
    expect(narrowest.width).toBeGreaterThanOrEqual(13)
    expect(narrowest.width).toBeLessThan(13.1)
    expect(sky.context.letters.map((text) => text.text)).toEqual(['A', 'W'])
    const letter = sky.context.letters[1]
    expect(letter?.x).toBeCloseTo(centreOf(narrowest), 6)
    expect(sizeOf(letter?.font ?? '')).toBeGreaterThanOrEqual(SMALLEST_LETTER)
    // The stand-in canvas makes every character 0.6 times as wide as the font is tall.
    expect(sizeOf(letter?.font ?? '') * 0.6).toBeLessThan(narrowest.width)

    browser.resizeTo(1280, 600)
    expect(only(barsOn(sky, C_SHARP_4)).width).toBeLessThan(13)
    // Only the width keeps the letter out: the bar is as tall as before, and the white key still has its own.
    expect(sky.context.letters.map((text) => text.text)).toEqual(['A'])
  })

  it('follows the letters when they change, and writes none once they are switched off', () => {
    const song = fakeSong(scale)
    const sky = mount({ falling: song.source, hints })
    sky.update({ hints: new Map<Midi, string>([[D4, 'X']]) })
    expect(sky.context.letters.map((text) => text.text)).toEqual(['X'])
    sky.update({ hints: NO_HINTS })
    expect(sky.context.letters).toEqual([])
    expect(browser.frames.requested).toBe(0)
  })

  it('keeps a long label inside its bar or leaves it out, and never fails on odd labels', () => {
    const odd = new Map<Midi, string>([
      [C4, 'Num 1'],
      [D4, 'Backspace'],
      [E4, ''],
      [F4, 'é'],
    ])
    const song = fakeSong(scale)
    for (const range of [FULL, SMALL]) {
      const sky = mount({ falling: song.source, hints: odd, range })
      for (const text of sky.context.letters) {
        const size = sizeOf(text.font)
        const bar = only(sky.bars().filter((candidate) => Math.abs(centreOf(candidate) - text.x) < 0.01))
        expect(size).toBeGreaterThanOrEqual(SMALLEST_LETTER)
        // The stand-in canvas makes every character 0.6 times as wide as the font is tall.
        expect(text.text.length * size * 0.6).toBeLessThanOrEqual(bar.width)
        expect(text.text).not.toBe('')
      }
      sky.unmount()
    }
  })

  // The lower end of a note that sounds has sunk into the line. The sky then
  // rests the letter on the line, where it can still be read: its builders'
  // reading of "at its lower end", which src/ui/sky/Sky.test.tsx pins too.
  it('writes the letter of a very long note on the line while it sounds, for as long as it sounds', () => {
    const song = fakeSong([note(C4, 1, 5000)])
    const sky = mount({ falling: song.source, hints })
    for (const position of [1.5, 60, 2500, 5000.8]) {
      song.state.position = position
      sky.update({})
      const text = only(sky.context.letters)
      expect(text.y).toBeLessThan(600)
      expect(text.y).toBeGreaterThan(580)
      expect(text.alpha).toBe(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Falling notes: odd lengths, crowds, moving about the song
// ---------------------------------------------------------------------------

describe('falling notes: very long and very short notes', () => {
  it('keeps showing the notes that fall while one long note sounds through hundreds of others', () => {
    // A bass note held for ten minutes (a pedal that is never lifted, a key that
    // is never released in the file), and a melody of four notes a second over it.
    const notes = [note(36, 0, 600)]
    for (let i = 0; i < 2000; i++) notes.push(note(C4 + (i % 12), 0.5 + i * 0.25, 0.2))
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })

    // Early in the song all is well.
    song.state.position = 10
    sky.update({})
    expect(sky.bars().length).toBeGreaterThanOrEqual(12)

    // Five minutes in: the long note still sounds, and three seconds of melody are on their way down.
    song.state.position = 300
    sky.update({})
    expect(barsOn(sky, 36)).toHaveLength(1)
    const melody = sky.bars().filter((bar) => !barsOn(sky, 36).includes(bar))
    expect(melody.length).toBeGreaterThanOrEqual(12)
    expect(melody.length).toBeLessThanOrEqual(14)
  })

  it('keeps showing the notes to come when a held pedal lets many notes ring on', () => {
    // Every note rings until its own pitch is played again (which is how a file
    // with the pedal held down is imported), and one low note never comes back.
    const notes: PlayableNote[] = [note(40, 0, 400)]
    for (let i = 0; i < 1500; i++) notes.push(note(C4 + (i % 24), 0.2 + i * 0.2, 4.7))
    const song = fakeSong(notes)
    song.state.position = 200
    const sky = mount({ falling: song.source })
    // Notes that start in the next three seconds: fifteen of them, all still above the line.
    const coming = sky.bars().filter((bar) => bottomAboveLine(bar) > 0)
    expect(coming.length).toBeGreaterThanOrEqual(14)
  })

  it('shows a note of no length at all as a small bar that lands when it sounds', () => {
    const song = fakeSong([note(C4, 1, 0), note(D4, 2, 0.001)])
    const sky = mount({ falling: song.source })
    const [c, d] = sky.bars()
    expect(sky.bars()).toHaveLength(2)
    expect(bottomAboveLine(c as PaintedBar)).toBeCloseTo(1 * skySpeed(600), 6)
    expect((c as PaintedBar).height).toBeGreaterThan(3)
    expect(bottomAboveLine(d as PaintedBar)).toBeCloseTo(2 * skySpeed(600), 6)

    song.state.position = 0.999
    sky.update({})
    expect(bottomAboveLine(sky.bars()[0] as PaintedBar)).toBeCloseTo(0.001 * skySpeed(600), 6)
  })

  it('draws a note that lasts for hours without asking the canvas for anything impossible', () => {
    const song = fakeSong([note(C4, 1, 3 * 3600), note(C_SHARP_4, 2, 3 * 3600)])
    const sky = mount({ falling: song.source, glow: 1, barStyle: 'neon' })
    for (const position of [0, 1.5, 3000, 3 * 3600]) {
      song.state.position = position
      sky.update({})
      expect(sky.bars()).toHaveLength(2)
      for (const bar of sky.bars()) {
        expect(Number.isFinite(bar.y)).toBe(true)
        expect(Number.isFinite(bar.height)).toBe(true)
        // It reaches from the line (or from where it still is on its way down) past the top of the sky.
        expect(bar.y + bar.height).toBeGreaterThan(0)
      }
    }
    song.state.position = 3 * 3600 + 3
    sky.update({})
    expect(sky.bars()).toEqual([])
  })

  it('draws nothing, and does not fail, for a song without notes or a place past its end', () => {
    const empty = fakeSong([])
    const sky = mount({ falling: empty.source, hints: new Map([[C4, 'A']]) })
    expect(sky.bars()).toEqual([])
    const short = fakeSong([note(C4, 0, 1)])
    short.state.position = 50
    sky.update({ falling: short.source })
    expect(sky.bars()).toEqual([])
    // The player never gives a place that is not a number. Should one ever
    // come, the sky does not fail on it, and asks the canvas for nothing impossible.
    short.state.position = Number.NaN
    expect(() => sky.update({})).not.toThrow()
    for (const bar of sky.bars()) {
      expect(Number.isFinite(bar.y)).toBe(true)
      expect(Number.isFinite(bar.height)).toBe(true)
    }
    expect(browser.frames.requested).toBe(0)
  })
})

describe('falling notes: moving about the song', () => {
  const speed = skySpeed(600)
  const notes: PlayableNote[] = []
  for (let i = 0; i < 400; i++) notes.push(note(48 + (i % 30), i * 0.5, 0.4))

  /** What should be on screen at `position`: every note that has not ended and has entered the sky. */
  function expectedBottoms(position: number): number[] {
    return notes
      .filter((each) => each.time + each.duration > position && each.time < position + SKY_SECONDS)
      .map((each) => (each.time - position) * speed)
      .sort((a, b) => a - b)
  }

  function drawnBottoms(sky: MountedSky): number[] {
    return sky
      .bars()
      .map(bottomAboveLine)
      .sort((a, b) => a - b)
  }

  it('puts every note where it belongs after jumping forwards and backwards, paused or playing', () => {
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })
    for (const position of [0, 150.25, 3.1, 199.9, 0.05, 77.77, 12, 0]) {
      song.state.position = position
      sky.update({})
      const drawn = drawnBottoms(sky)
      const expected = expectedBottoms(position)
      expect(drawn).toHaveLength(expected.length)
      drawn.forEach((bottom, i) => expect(bottom).toBeCloseTo(expected[i] as number, 6))
    }

    song.state.playing = true
    sky.update({})
    song.play(0.5)
    // A jump back while it plays: the very next frame shows the new place.
    song.state.position = 20
    browser.frame()
    const drawn = drawnBottoms(sky)
    const expected = expectedBottoms(20)
    expect(drawn).toHaveLength(expected.length)
    drawn.forEach((bottom, i) => expect(bottom).toBeCloseTo(expected[i] as number, 6))
  })

  it('carries on from the same place after a pause, without a jump', () => {
    const song = fakeSong(notes)
    const sky = mount({ falling: song.source })
    song.state.playing = true
    sky.update({})
    song.play(1)
    const beforePause = drawnBottoms(sky)

    song.state.playing = false
    browser.frame()
    expect(browser.frames.pending.size).toBe(0)
    // Minutes go by on the frame clock; the song has not moved.
    browser.frames.now += 5 * 60 * 1000
    expect(drawnBottoms(sky)).toEqual(beforePause)

    song.state.playing = true
    sky.update({})
    expect(browser.frames.pending.size).toBe(1)
    browser.frame()
    expect(drawnBottoms(sky)).toEqual(beforePause)
    song.play(0.25)
    const expected = expectedBottoms(song.state.position)
    const drawn = drawnBottoms(sky)
    expect(drawn).toHaveLength(expected.length)
    drawn.forEach((bottom, i) => expect(bottom).toBeCloseTo(expected[i] as number, 6))
  })

  it('goes still when the song ends and is put back at its start', () => {
    const song = fakeSong([note(C4, 0.2, 0.3)])
    const sky = mount({ falling: song.source, sparks: 'some' })
    song.state.playing = true
    sky.update({})
    song.play(0.2)
    sky.bus.noteOn(C4, 'playback')
    song.play(0.3)
    // The end: the player lets go of its notes, stops, and goes back to the start.
    sky.bus.allOff('playback')
    song.state.playing = false
    song.state.position = 0
    const frames = browser.playUntilIdle()
    expect(frames).toBeLessThan(120)
    expect(sky.stamps('bloom')).toEqual([])
    expect(sky.stamps('spark')).toEqual([])
    // The picture that stays is the start of the song.
    expect(bottomAboveLine(only(sky.bars()))).toBeCloseTo(0.2 * speed, 6)
  })
})

describe('falling notes: thousands at once', () => {
  /**
   * The most bars of a song the sky draws in one picture. The number is the
   * sky's own (the spec names no limit; it asks that drawing stays fast): if
   * it is changed there, it changes here.
   */
  const MOST_FALLING_BARS = 400

  /** Six thousand notes in three seconds, on every key of the piano in turn. */
  function wallOfNotes(): PlayableNote[] {
    const wall: PlayableNote[] = []
    for (let i = 0; i < 6000; i++) wall.push(note(21 + (i % 88), 1 + i * 0.0005, 0.2))
    return wall
  }

  it('draws the nearest notes of a wall of thousands, and each frame stays the same size', () => {
    const song = fakeSong(wallOfNotes())
    const sky = mount({ falling: song.source, hints: new Map([[C4, 'A']]) })
    song.state.playing = true
    sky.update({})
    song.play(0.2)
    const drawn = sky.bars().length
    expect(drawn).toBeGreaterThan(300)
    expect(drawn).toBeLessThanOrEqual(MOST_FALLING_BARS)
    // The bars that are drawn are the ones that land first.
    const highest = Math.max(...sky.bars().map(bottomAboveLine))
    expect(highest).toBeLessThan(1.1 * skySpeed(600))
    song.play(0.2)
    expect(sky.bars().length).toBeLessThanOrEqual(MOST_FALLING_BARS)
    expect(browser.frames.pending.size).toBe(1)
  })

  it('is as full in the middle of the wall, while one note is held under all of it', () => {
    // The held note began before everything else. The thousands of notes that
    // have ended since must not count toward what the sky draws at most.
    const held = note(108, 0, 600)
    const song = fakeSong([held, ...wallOfNotes()])
    song.state.position = 2.5
    const sky = mount({ falling: song.source })
    expect(barsOn(sky, held.midi).some((bar) => bar.height > 600)).toBe(true)
    expect(sky.bars().length).toBeGreaterThan(300)
    expect(sky.bars().length).toBeLessThanOrEqual(MOST_FALLING_BARS)
  })
})

// ---------------------------------------------------------------------------
// The animation loop
// ---------------------------------------------------------------------------

describe('the animation loop', () => {
  it('asks for no frame and paints nothing new for a whole minute while a loaded song is paused', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const song = fakeSong([note(C4, 1, 1)])
    song.state.position = 0.4
    const sky = mount({ falling: song.source, background: 'stars' })
    const wipes = sky.context.wipes
    vi.advanceTimersByTime(60_000)
    expect(browser.frames.requested).toBe(0)
    expect(sky.context.wipes).toBe(wipes)
  })

  it('asks for no frame while the page is redrawn again and again and nothing moves', () => {
    const sky = mount({ background: 'aurora' })
    const wipes = sky.context.wipes
    for (let i = 0; i < 50; i++) sky.update({})
    expect(browser.frames.requested).toBe(0)
    expect(sky.context.wipes).toBe(wipes)
  })

  it('keeps going for ten minutes of a held key, one frame at a time, and stops when it is let go', () => {
    const sky = mount({ sparks: 'lots' })
    sky.bus.noteOn(C4, 'keyboard')
    let mostSparks = 0
    let tallest = 0
    // The slowest frames the sky counts in full: 20 a second.
    for (let i = 0; i < 10 * 60 * 20; i++) {
      expect(browser.frame(50)).toBe(1)
      if (i % 40 !== 39) continue
      mostSparks = Math.max(mostSparks, sky.stamps('spark').length)
      tallest = Math.max(tallest, topAboveLine(only(sky.bars())))
      expect(browser.frames.pending.size).toBe(1)
    }
    expect(tallest).toBe(600)
    expect(mostSparks).toBeGreaterThan(10)
    // One key: about 42 sparks a second that each live a second at most.
    expect(mostSparks).toBeLessThan(80)

    sky.bus.noteOff(C4, 'keyboard')
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
    expect(sky.stamps('spark')).toEqual([])
    expect(sky.stamps('bloom')).toEqual([])
    expect(browser.frames.pending.size).toBe(0)
  })

  it('takes one small step, not a leap, when the tab comes back after ten minutes', () => {
    const song = fakeSong([note(D4, 2, 1)])
    const sky = mount({ falling: song.source, sparks: 'lots', background: 'night' })
    song.state.playing = true
    sky.update({})
    sky.bus.noteOn(C4, 'keyboard')
    song.play(0.5)
    const sparksBefore = sky.stamps('spark').length
    const fallingBefore = bottomAboveLine(only(barsOn(sky, D4)))

    // Hidden: no frames, and the app pauses the song. Then the tab is shown again.
    song.state.playing = false
    expect(browser.frame(10 * 60 * 1000)).toBe(1)
    expect(bottomAboveLine(only(barsOn(sky, D4)))).toBe(fallingBefore)
    // No more sparks than one slow frame can add.
    expect(sky.stamps('spark').length).toBeLessThanOrEqual(sparksBefore + 4)
    expect(sky.stamps('spark').length).toBeLessThanOrEqual(MAX_SPARKS)
    sky.bus.allOff()
    browser.playUntilIdle()
    expect(sky.stamps('spark')).toEqual([])
  })

  it('leaves nothing behind after five hundred notes struck and let go in the same instant', () => {
    const sky = mount({ sparks: 'lots' })
    for (let round = 0; round < 4; round++) {
      // Every note there is, the ones that are not on the piano included.
      for (let midi = 0; midi <= 127; midi++) sky.bus.noteOn(midi, 'playback')
      sky.bus.allOff()
    }
    expect(browser.frames.pending.size).toBe(1)
    browser.frame()
    expect(sky.bars().length).toBeLessThanOrEqual(MAX_BARS)
    expect(sky.stamps('spark').length).toBeLessThanOrEqual(MAX_SPARKS)
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
    expect(sky.stamps('bloom')).toEqual([])
    expect(sky.stamps('spark')).toEqual([])
    // Whatever is still copied onto the idle sky is its background, nothing of the notes.
    expect(sky.context.images).toHaveLength(sky.stamps('backdrop').length)
  })

  it('stops for a playing song when light bars are switched off, and starts again when they come back', () => {
    const song = fakeSong([note(C4, 2, 1)])
    const sky = mount({ falling: song.source })
    song.state.playing = true
    sky.update({})
    song.play(0.5)
    expect(sky.bars()).toHaveLength(1)

    sky.update({ showBars: false })
    expect(browser.frames.pending.size).toBe(0)
    expect(sky.bars()).toEqual([])
    const requested = browser.frames.requested
    song.state.position += 0.5
    sky.update({})
    expect(browser.frames.requested).toBe(requested)

    sky.update({ showBars: true })
    expect(browser.frames.pending.size).toBe(1)
    song.play(0.1)
    expect(bottomAboveLine(only(sky.bars()))).toBeCloseTo((2 - song.state.position) * skySpeed(600), 6)
  })

  it('never has two frames waiting, whatever is thrown at it in the middle of a frame', () => {
    const song = fakeSong([note(C4, 1, 1)])
    const sky = mount({ sparks: 'some' })
    sky.bus.noteOn(C4, 'keyboard')
    for (let i = 0; i < 60; i++) {
      browser.frame()
      if (i % 5 === 0) sky.update({ glow: (i % 10) / 10 })
      if (i % 7 === 0) browser.resizeTo(1300 - i, 600 - i)
      if (i % 11 === 0) window.dispatchEvent(new Event('resize'))
      if (i % 13 === 0) sky.update({ falling: i % 26 === 0 ? song.source : null })
      if (i % 17 === 0) browser.setReducedMotion(i % 34 === 0)
      if (i % 3 === 0) sky.bus.noteOn(D4, 'pointer')
      else sky.bus.noteOff(D4, 'pointer')
      expect(browser.frames.pending.size).toBeLessThanOrEqual(1)
    }
    browser.setReducedMotion(false)
    sky.update({ falling: null })
    sky.bus.allOff()
    browser.playUntilIdle()
    expect(sky.bars()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Sparks
// ---------------------------------------------------------------------------

describe('sparks', () => {
  /** How many sparks are over the key of `midi` (and its near neighbours) right now. */
  function sparksNear(sky: MountedSky, midi: Midi): number {
    const key = keySpan(midi)
    return sky
      .stamps('spark')
      .filter((spark) => Math.abs(spark.x + spark.width / 2 - key.centre) < key.width * 2).length
  }

  it('stay inside the budget with every key of the piano held at "lots"', () => {
    const sky = mount({ sparks: 'lots' })
    for (let midi = FULL.first; midi <= FULL.last; midi++) sky.bus.noteOn(midi, 'playback')
    let most = 0
    for (let i = 0; i < 240; i++) {
      browser.frame()
      most = Math.max(most, sky.stamps('spark').length)
    }
    expect(most).toBeLessThanOrEqual(MAX_SPARKS)
    expect(most).toBeGreaterThan(MAX_SPARKS / 2)
    sky.bus.allOff()
    browser.playUntilIdle()
    expect(sky.stamps('spark')).toEqual([])
  })

  it('still fly from a note that is struck while ten others are held at "lots"', () => {
    const sky = mount({ sparks: 'lots' })
    for (let i = 0; i < 10; i++) sky.bus.noteOn(36 + i * 2, 'playback')
    browser.play(3)
    sky.bus.noteOn(96, 'keyboard')
    browser.play(0.5)
    expect(sparksNear(sky, 96)).toBeGreaterThan(5)
    expect(sky.stamps('spark').length).toBeLessThan(MAX_SPARKS)
  })

  it('are drawn where their key now is after the sky changed size, not at the old place', () => {
    const sky = mount({ sparks: 'lots' })
    sky.bus.noteOn(100, 'keyboard')
    browser.play(1)
    browser.resizeTo(650, 600)
    // Within about a second, every spark that was born in the wide sky has gone out.
    browser.play(1.2)
    const key = keySpan(100, FULL, 650)
    for (const spark of sky.stamps('spark')) {
      expect(Math.abs(spark.x + spark.width / 2 - key.centre)).toBeLessThan(60)
    }
    expect(sky.stamps('spark').length).toBeGreaterThan(5)
  })
})

// ---------------------------------------------------------------------------
// Every look
// ---------------------------------------------------------------------------

describe('every look', () => {
  const barStyles: BarStyle[] = ['solid', 'neon']
  const backgrounds: BackgroundName[] = ['black', 'night', 'stars', 'aurora']
  const sparkLevels: SparksLevel[] = ['off', 'some', 'lots']
  const glows = [0, 0.01, 0.5, 1]
  const accents: AccentChoice[] = ['red', 'white', 'custom', 'rainbow']

  it('draws free play and a song in every bar style, background, sparks level, glow and colour', () => {
    const song = fakeSong([note(C4, 0.5, 1), note(C_SHARP_4, 0.2, 0.5), note(D4, 1.5, 0.1), note(10, 1, 1)])
    song.state.position = 0.4
    const hints = new Map<Midi, string>([[C4, 'A']])
    for (const barStyle of barStyles) {
      for (const background of backgrounds) {
        for (const sparks of sparkLevels) {
          for (const glow of glows) {
            for (const accent of accents) {
              const look = { barStyle, background, sparks, glow, accent, customColour: '#102040' }
              const sky = mount(look)
              sky.bus.noteOn(C4, 'keyboard')
              sky.bus.noteOn(C_SHARP_4, 'keyboard')
              browser.play(0.2)
              sky.bus.noteOff(C4, 'keyboard')
              browser.play(0.1)
              expect(sky.bars(), JSON.stringify(look)).toHaveLength(2)
              expect(sky.stamps('bloom').length, JSON.stringify(look)).toBe(glow > 0 ? 2 : 0)
              expect(sky.stamps('spark').length > 0, JSON.stringify(look)).toBe(sparks !== 'off')

              sky.update({ falling: song.source, hints })
              browser.frame()
              // Three notes of the song are on the piano and on screen; one of them carries a letter.
              expect(sky.bars(), JSON.stringify(look)).toHaveLength(3)
              expect(sky.context.letters.map((text) => text.text)).toEqual(['A'])
              expect(sky.stamps('backdrop').length).toBeGreaterThanOrEqual(1)
              sky.unmount()
              browser.frames.pending.clear()
            }
          }
        }
      }
    }
  })

  it('has no halo of any kind at glow 0, also around falling notes', () => {
    const song = fakeSong([note(C4, 0.5, 1), note(C_SHARP_4, 0.2, 0.5)])
    const sky = mount({ falling: song.source, glow: 0 })
    sky.bus.noteOn(C4, 'playback')
    browser.play(0.3)
    expect(sky.bars()).toHaveLength(2)
    expect(sky.stamps('glow')).toEqual([])
    expect(sky.stamps('bloom')).toEqual([])
    // Nothing but the bars and the background: no band of light on the line either.
    expect(sky.context.images).toHaveLength(sky.stamps('backdrop').length)
  })

  it('gives every falling note, its glow on the line and its sparks the colour of its own note with Rainbow', () => {
    const song = fakeSong([note(C4, 0.5, 1), note(D4, 0.6, 1), note(C4 + 12, 0.7, 1)])
    const sky = mount({ falling: song.source, accent: 'rainbow', sparks: 'lots' })
    const [c, d, cAbove] = sky.bars()
    const lightOf = (midi: Midi): string => paletteForNote(midi, 'rainbow', '#ff2a2a').light
    expect(coloursOf(c?.fill)).toContain(lightOf(C4))
    expect(coloursOf(d?.fill)).toContain(lightOf(D4))
    expect(coloursOf(d?.fill)).not.toContain(lightOf(C4))
    // The same note an octave higher has the same colour.
    expect(cAbove?.fill).toBe(c?.fill)

    sky.bus.noteOn(C4, 'playback')
    sky.bus.noteOn(D4, 'playback')
    sky.bus.noteOn(C4 + 12, 'playback')
    browser.play(0.3)
    const blooms = sky.stamps('bloom')
    expect(blooms).toHaveLength(3)
    expect(blooms[0]?.image).not.toBe(blooms[1]?.image)
    expect(blooms[0]?.image).toBe(blooms[2]?.image)
    // Sparks: one picture for C (both octaves) and one for D.
    expect(new Set(sky.stamps('spark').map((spark) => spark.image)).size).toBe(2)
  })

  it('takes the colour of the chrome, not of a note, for the band of light on the line with Rainbow', () => {
    const sky = mount({ accent: 'rainbow', glow: 1 })
    sky.bus.noteOn(D4, 'keyboard')
    browser.play(0.5)
    const band = sky.context.rects.find((rect) => rect.fill instanceof FakeGradient && rect.blend === 'lighter')
    const chrome = paletteFor('rainbow', '#ff2a2a').light
    expect(coloursOf(band?.fill).some((colour) => colour.startsWith(chrome))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The player's own colour, dragged through the colour picker
// ---------------------------------------------------------------------------

describe("the player's own colour, changing on every frame", () => {
  function colourNumber(i: number): string {
    return `#${((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`
  }

  it('draws with the newest colour every time, in free play and on the background', () => {
    const sky = mount({ accent: 'custom', customColour: '#336699', background: 'stars' })
    sky.bus.noteOn(C4, 'keyboard')
    browser.play(0.2)
    for (let i = 0; i < 300; i++) {
      const customColour = colourNumber(i)
      sky.update({ customColour })
      browser.frame()
      const light = paletteFor('custom', customColour).light
      expect(coloursOf(only(sky.bars()).fill)).toContain(light)
    }
  })

  it('makes its pictures once for each colour, not again on every frame of that colour', () => {
    const sky = mount({ accent: 'custom', customColour: '#336699', sparks: 'lots', background: 'aurora' })
    sky.bus.noteOn(C4, 'keyboard')
    sky.bus.noteOn(C_SHARP_4, 'keyboard')
    browser.play(0.2)
    const perColour: number[] = []
    for (let i = 0; i < 120; i++) {
      const before = browser.contexts().length
      sky.update({ customColour: colourNumber(i) })
      browser.play(0.1)
      perColour.push(browser.contexts().length - before)
    }
    // Two glows, a spark and a bloom for the new colour; the background is painted again on its own canvas.
    expect(Math.max(...perColour)).toBeLessThanOrEqual(4)

    const settled = browser.contexts().length
    browser.play(2)
    expect(browser.contexts().length).toBe(settled)
  })

  it('paints the background once for each colour while nothing is played, and asks for no frame', () => {
    const sky = mount({ accent: 'custom', customColour: '#336699', background: 'aurora' })
    // Nothing is played, so the only canvas besides the sky's own is the one the
    // background is painted on: one canvas, however many colours go by.
    const backdrop = (): FakeContext =>
      only(browser.contexts().filter((context) => context !== sky.context))
    // How the stand-in canvas sees a picture being painted again: it is wiped whole first.
    const paintedBefore = backdrop().wipes
    for (let i = 0; i < 200; i++) sky.update({ customColour: colourNumber(i) })
    expect(backdrop().wipes - paintedBefore).toBe(200)
    expect(browser.frames.requested).toBe(0)

    // The same colour again and again paints nothing more.
    for (let i = 0; i < 20; i++) sky.update({ customColour: colourNumber(199) })
    expect(backdrop().wipes - paintedBefore).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Sizes: down to nothing, odd pixel ratios
// ---------------------------------------------------------------------------

describe('odd sizes', () => {
  it.each([
    [1, 1],
    [2, 300],
    [300, 2],
    [40, 9],
    [5000, 3000],
  ])('draws everything in a sky of %i x %i without failing', (width, height) => {
    browser.size.width = width
    browser.size.height = height
    const song = fakeSong([note(C4, 0.5, 1), note(C_SHARP_4, 0.2, 0.5), note(D4, 1.5, 0), note(E4, 0, 9000)])
    const hints = new Map<Midi, string>([
      [C4, 'A'],
      [C_SHARP_4, 'W'],
      [E4, 'Num 1'],
    ])
    for (const barStyle of ['solid', 'neon'] as const) {
      for (const glow of [0, 1]) {
        const sky = mount({ barStyle, glow, sparks: 'lots', background: 'stars', accent: 'rainbow' })
        sky.bus.noteOn(C4, 'keyboard')
        sky.bus.noteOn(C_SHARP_4, 'keyboard')
        browser.play(0.3)
        sky.bus.noteOff(C4, 'keyboard')
        browser.play(0.3)
        sky.update({ falling: song.source, hints })
        song.state.playing = true
        song.play(0.3)
        song.state.playing = false
        browser.setReducedMotion(true)
        sky.update({ falling: null })
        browser.setReducedMotion(false)
        sky.bus.allOff()
        browser.playUntilIdle()
        expect(sky.canvas.width).toBe(width)
        expect(sky.canvas.height).toBe(height)
        sky.unmount()
      }
    }
  })

  it('shows the falling notes again, at the heights of the new size, after the sky had no area', () => {
    const song = fakeSong([note(C4, 1, 0.5), note(D4, 2, 0.5)])
    const hints = new Map<Midi, string>([[C4, 'A']])
    const sky = mount({ falling: song.source, hints })
    expect(sky.bars()).toHaveLength(2)
    browser.resizeTo(0, 0)
    expect(sky.bars()).toEqual([])
    expect(sky.context.letters).toEqual([])
    browser.resizeTo(1300, 900)
    const [c, d] = sky.bars()
    expect(sky.bars()).toHaveLength(2)
    expect(900 - ((c?.y ?? 0) + (c?.height ?? 0))).toBeCloseTo(1 * skySpeed(900), 6)
    expect(900 - ((d?.y ?? 0) + (d?.height ?? 0))).toBeCloseTo(2 * skySpeed(900), 6)
    expect(sky.context.letters.map((text) => text.text)).toEqual(['A'])
    expect(browser.frames.requested).toBe(0)
  })

  it.each([1.1, 1.25, 1.75, 2, 2.625])(
    'keeps the light on the same CSS pixels at pixel ratio %s, mid-note and mid-song',
    (ratio) => {
      const song = fakeSong([note(D4, 1, 0.5)])
      const sky = mount({ sparks: 'some', glow: 1 })
      sky.bus.noteOn(C4, 'keyboard')
      browser.play(0.3)
      const before = { ...only(sky.bars()) }

      vi.stubGlobal('devicePixelRatio', ratio)
      window.dispatchEvent(new Event('resize'))
      const used = Math.min(ratio, 2)
      expect(sky.canvas.width).toBe(Math.round(1300 * used))
      expect(sky.canvas.height).toBe(Math.round(600 * used))
      // The stand-in canvas keeps what it is asked in CSS pixels: the bar has not moved.
      expect(only(sky.bars()).x).toBe(before.x)
      expect(only(sky.bars()).width).toBe(before.width)
      // Whatever was rounded, the whole CSS width and height are covered exactly.
      expect(sky.context.zoom.x * 1300).toBeCloseTo(sky.canvas.width, 9)
      expect(sky.context.zoom.y * 600).toBeCloseTo(sky.canvas.height, 9)

      sky.update({ falling: song.source })
      browser.frame()
      const falling = only(barsOn(sky, D4))
      expect(bottomAboveLine(falling)).toBeCloseTo(1 * skySpeed(600), 6)
      sky.bus.allOff()
      browser.playUntilIdle()
    },
  )

  it('fits its pixel grid to a size that is not a whole number of device pixels', () => {
    vi.stubGlobal('devicePixelRatio', 1.5)
    browser.size.width = 1365
    browser.size.height = 413
    const sky = mount({ background: 'stars' })
    expect(sky.canvas.width).toBe(2048)
    expect(sky.canvas.height).toBe(620)
    sky.bus.noteOn(FULL.last, 'keyboard')
    browser.play(0.2)
    const bar = only(sky.bars())
    const key = keySpan(FULL.last, FULL, 1365)
    expect(centreOf(bar)).toBeCloseTo(key.centre, 6)
    // The last key ends on the right edge of the sky, and its light inside it.
    expect(key.left + key.width).toBeCloseTo(1365, 6)
    expect(bar.x + bar.width).toBeLessThanOrEqual(1365)
    // The background copies exactly onto the canvas.
    const [backdrop] = sky.stamps('backdrop')
    expect(backdrop?.width).toBe(1365)
    expect(backdrop?.height).toBe(413)
    expect((backdrop?.image as HTMLCanvasElement).width).toBe(2048)
    expect((backdrop?.image as HTMLCanvasElement).height).toBe(620)
  })
})

// ---------------------------------------------------------------------------
// Reduced motion, the piano changing, appearing in the middle of things
// ---------------------------------------------------------------------------

describe('reduced motion in the middle of a song', () => {
  it('puts the sparks out at once, keeps the notes falling, and brings the sparks back when it is switched off', () => {
    const song = fakeSong([note(C4, 0.5, 4), note(D4, 3, 1)])
    const sky = mount({ falling: song.source, sparks: 'lots' })
    song.state.playing = true
    sky.update({})
    song.play(0.5)
    sky.bus.noteOn(C4, 'playback')
    song.play(0.5)
    expect(sky.stamps('spark').length).toBeGreaterThan(5)

    browser.setReducedMotion(true)
    browser.frame()
    expect(sky.stamps('spark')).toEqual([])
    const before = bottomAboveLine(only(barsOn(sky, D4)))
    song.play(0.5)
    expect(sky.stamps('spark')).toEqual([])
    expect(bottomAboveLine(only(barsOn(sky, D4)))).toBeCloseTo(before - 0.5 * skySpeed(600), 4)
    // The note that is sounding keeps a steady glow on the line.
    expect(sky.stamps('bloom')).toHaveLength(1)

    browser.setReducedMotion(false)
    song.play(0.5)
    expect(sky.stamps('spark').length).toBeGreaterThan(5)
    sky.bus.allOff()
    song.state.playing = false
    browser.playUntilIdle()
  })
})

describe('the piano changing in the middle of a song', () => {
  it('moves the falling notes onto the keys of the new piano and drops the light of the old one', () => {
    const song = fakeSong([note(C4, 1, 1), note(30, 1.2, 1), note(D4, 1.4, 1)])
    const sky = mount({ falling: song.source, sparks: 'lots' })
    song.state.playing = true
    sky.update({})
    sky.bus.noteOn(C4, 'playback')
    sky.bus.noteOn(30, 'playback')
    song.play(0.4)
    expect(sky.bars()).toHaveLength(3)
    expect(sky.stamps('bloom')).toHaveLength(2)

    sky.update({ range: SMALL })
    browser.frame()
    // Note 30 is not on the small piano: two bars, on the keys where they now are.
    expect(sky.bars()).toHaveLength(2)
    expect(barsOn(sky, C4, SMALL)).toHaveLength(1)
    expect(barsOn(sky, D4, SMALL)).toHaveLength(1)
    expect(sky.stamps('bloom')).toEqual([])
    expect(sky.stamps('spark')).toEqual([])

    // The app lets go of every note when the piano changes: nothing of the old piano comes back.
    sky.bus.allOff()
    song.play(0.2)
    expect(sky.stamps('bloom')).toEqual([])
    sky.bus.noteOn(D4, 'playback')
    song.play(0.1)
    const bloom = only(sky.stamps('bloom'))
    expect(bloom.x + bloom.width / 2).toBeCloseTo(keySpan(D4, SMALL).centre, 6)
  })
})

describe('appearing while notes are held and a song is loaded', () => {
  it('lights the line under the held notes without a flash, a burst of sparks or a rising bar', () => {
    const bus = new NoteBus()
    bus.noteOn(C4, 'keyboard')
    bus.noteOn(200, 'keyboard')
    const song = fakeSong([note(D4, 1, 1)])
    const sky = mount({ bus, falling: song.source, sparks: 'some' })
    expect(browser.frames.pending.size).toBe(1)
    browser.frame()
    expect(sky.bars()).toHaveLength(1)
    expect(barsOn(sky, D4)).toHaveLength(1)
    const bloom = only(sky.stamps('bloom'))
    expect(bloom.x + bloom.width / 2).toBeCloseTo(keySpan(C4).centre, 6)
    // No burst: a note that was already sounding only trickles.
    expect(sky.stamps('spark').length).toBeLessThanOrEqual(1)
    browser.play(0.5)
    const settled = only(sky.stamps('bloom'))
    // No flash either: the glow was at its resting size from the first frame.
    expect(bloom.width).toBe(settled.width)
    bus.allOff()
    browser.playUntilIdle()
  })
})

// ---------------------------------------------------------------------------
// The drawing context
// ---------------------------------------------------------------------------

describe('the drawing context', () => {
  it('paints the picture again when the browser gives back a drawing context it had taken away', () => {
    // A graphics driver that restarts, a laptop that wakes up: the browser
    // empties the canvas, says "contextlost", and later "contextrestored".
    const sky = mount({ background: 'stars' })
    expect(sky.stamps('backdrop')).toHaveLength(1)
    const wipes = sky.context.wipes

    sky.canvas.dispatchEvent(new Event('contextlost', { cancelable: true }))
    // What the browser does to a canvas whose context it restores: it is empty.
    sky.context.clearRect(0, 0, 1300, 600)
    sky.canvas.dispatchEvent(new Event('contextrestored'))

    expect(sky.context.wipes).toBeGreaterThan(wipes + 1)
    expect(sky.stamps('backdrop')).toHaveLength(1)
    // And it stays idle: one picture, no animation.
    expect(browser.frames.requested).toBe(0)
  })

  it('does nothing, and fails nowhere, when the small pictures cannot be made', () => {
    const sky = mount({ sparks: 'lots', background: 'stars', glow: 1 })
    // From now on only the sky's own canvas gets a drawing context.
    const real = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      return this === sky.canvas ? (real as (...rest: unknown[]) => unknown).apply(this, args) : null
    } as unknown as HTMLCanvasElement['getContext']
    try {
      sky.update({ accent: 'blue', background: 'aurora' })
      sky.bus.noteOn(C4, 'keyboard')
      browser.play(0.5)
      // The bar itself is drawn by the sky's own context; glows, sparks and the background are left out.
      expect(sky.bars()).toHaveLength(1)
      expect(sky.context.images).toEqual([])
      sky.bus.allOff()
      browser.playUntilIdle()
      expect(sky.bars()).toEqual([])
    } finally {
      HTMLCanvasElement.prototype.getContext = real
    }
  })
})
