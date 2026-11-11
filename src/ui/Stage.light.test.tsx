// @vitest-environment jsdom
/**
 * The stage with its real sky: is the light drawn exactly over the keys the
 * piano draws, at every piano size and after the window changed, and does
 * the sky get from the stage what the settings say?
 *
 * The sky draws on the stand-in canvas of src/ui/sky/skyTestKit.ts. There is
 * no layout here: the stage and the sky are as wide as the test says, and the
 * piano's keys are compared by the share of the width their styles give them.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PianoRange } from '../core/layout'
import { NoteBus } from '../core/noteBus'
import type { Midi } from '../core/types'
import type { PlayableNote } from '../songs/song'
import { DEFAULT_SETTINGS } from '../state/settings'
import type { Settings } from '../state/settings'
import { Stage } from './Stage'
import type { StageProps } from './Stage'
import type { FallingSource } from './sky/Sky'
import { BLOOM_PICTURE_SIZE, SPARK_PICTURE_SIZE } from './sky/skySprites'
import { installFakeBrowser } from './sky/skyTestKit'
import type { FakeBrowser, FakeContext, PaintedBar } from './sky/skyTestKit'

let browser: FakeBrowser

beforeEach(() => {
  browser = installFakeBrowser()
  // The stage measures itself to choose the piano that fits: it is as wide as the sky.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.classList.contains('stage') ? browser.size.width : 0
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0 } as DOMRect
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DrawnStage {
  bus: NoteBus
  context: FakeContext
  ranges: PianoRange[]
  redraw(changes: Partial<StageProps>): void
  unmount(): void
}

function drawStage(overrides: Partial<StageProps> = {}): DrawnStage {
  const ranges: PianoRange[] = []
  const props: StageProps = {
    id: 'the-stage',
    labelledBy: 'free-play-tab',
    bus: new NoteBus(),
    settings: withSettings({}),
    keyLabels: new Map(),
    hints: new Map(),
    falling: null,
    audioStatus: 'ready',
    showHint: false,
    editMode: false,
    selectedSlot: null,
    onSelectSlot: vi.fn(),
    onNoteDown: vi.fn(),
    onNoteUp: vi.fn(),
    onRangeChange: (range) => {
      ranges.push(range)
    },
    onSkyClick: vi.fn(),
    ...overrides,
  }
  const view = render(<Stage {...props} />)
  const canvas = view.container.querySelector('canvas.sky') as HTMLCanvasElement
  return {
    bus: props.bus,
    context: browser.contextOf(canvas),
    ranges,
    redraw(changes) {
      Object.assign(props, changes)
      view.rerender(<Stage {...props} />)
    },
    unmount: () => view.unmount(),
  }
}

/** The default settings with sparks off, so that the animation stops predictably. */
function withSettings(changes: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, sparks: 'off', ...changes }
}

function resizeTo(width: number, height: number): void {
  act(() => browser.resizeTo(width, height))
}

/** Where the piano draws a key: its left edge and width as shares (0..1) of the piano's width. */
function keyOnPiano(midi: Midi): { left: number; width: number; centre: number } {
  const key = document.querySelector<HTMLElement>(`.piano-key[data-midi="${midi}"]`)
  if (!key) throw new Error(`the piano has no key for note ${midi}`)
  const left = Number.parseFloat(key.style.left) / 100
  const width = Number.parseFloat(key.style.width) / 100
  return { left, width, centre: left + width / 2 }
}

function notesOnPiano(): Midi[] {
  return [...document.querySelectorAll<HTMLElement>('.piano-key')].map((key) => Number(key.dataset.midi))
}

/**
 * The test page writes the keys' places with six digits ("4.54545%"), so a
 * key is known here to about a thousandth of a pixel: that is how closely a
 * bar must agree with it.
 */
const CLOSE = 0.01

/** The bar whose middle is over the middle of the key of `midi`, if there is exactly one. */
function barOver(context: FakeContext, midi: Midi): PaintedBar | undefined {
  const centre = keyOnPiano(midi).centre * browser.size.width
  const over = context.bars.filter((bar) => Math.abs(bar.x + bar.width / 2 - centre) < CLOSE)
  return over.length === 1 ? over[0] : undefined
}

function stampsOf(context: FakeContext, size: number): number {
  return context.images.filter((stamp) => (stamp.image as HTMLCanvasElement).width === size).length
}

function fakeSong(notes: PlayableNote[]) {
  const state = { position: 0, playing: false }
  const source: FallingSource = {
    getNotes: () => notes,
    getPosition: () => state.position,
    isPlaying: () => state.playing,
  }
  return { state, source }
}

function note(midi: Midi, time: number, duration: number): PlayableNote {
  return { midi, time, duration, velocity: 0.8 }
}

// ---------------------------------------------------------------------------

describe('the light and the keys', () => {
  it.each([
    [88, 1366],
    [88, 1920],
    [61, 1366],
    [49, 801],
    [37, 1333],
  ] as const)(
    'a bar rises over the middle of its own key, for every key of the %i-key piano in a sky %i wide',
    (pianoSize, width) => {
      browser.size.width = width
      const stage = drawStage({ settings: withSettings({ pianoSize }) })
      const notes = notesOnPiano()
      expect(notes).toHaveLength(pianoSize)
      act(() => {
        for (const midi of notes) stage.bus.noteOn(midi, 'keyboard')
      })
      browser.play(0.2)
      expect(stage.context.bars).toHaveLength(pianoSize)

      for (const midi of notes) {
        const key = keyOnPiano(midi)
        const bar = barOver(stage.context, midi)
        expect(bar, `the bar of note ${midi}`).toBeDefined()
        if (!bar) continue
        // Inside its key, never over a neighbour, and never outside the sky.
        expect(bar.x).toBeGreaterThanOrEqual(key.left * width - CLOSE)
        expect(bar.x + bar.width).toBeLessThanOrEqual((key.left + key.width) * width + CLOSE)
        expect(bar.width).toBeGreaterThan(key.width * width * 0.7)
        expect(bar.x).toBeGreaterThanOrEqual(-key.width * width)
        expect(bar.x + bar.width).toBeLessThanOrEqual(width + key.width * width)
      }
      act(() => stage.bus.allOff())
      browser.playUntilIdle()
      expect(stage.context.bars).toEqual([])
    },
  )

  it('moves the falling notes onto the keys of the piano that Auto picks when the window gets narrower', () => {
    browser.size.width = 1400
    const song = fakeSong([note(60, 1, 0.5), note(21, 1.2, 0.5), note(96, 1.4, 0.5)])
    const stage = drawStage({ falling: song.source })
    expect(notesOnPiano()).toHaveLength(88)
    expect(stage.context.bars).toHaveLength(3)
    for (const midi of [60, 21, 96]) expect(barOver(stage.context, midi)).toBeDefined()

    resizeTo(1000, 600)
    // 88 keys would be 19 pixels each: the 61-key piano fits (C2 to C7).
    expect(notesOnPiano()).toHaveLength(61)
    expect(stage.ranges.at(-1)).toEqual({ first: 36, last: 96 })
    expect(stage.context.bars).toHaveLength(2)
    expect(barOver(stage.context, 60)).toBeDefined()
    expect(barOver(stage.context, 96)).toBeDefined()
    expect(browser.frames.requested).toBe(0)

    resizeTo(1400, 600)
    expect(notesOnPiano()).toHaveLength(88)
    expect(stage.context.bars).toHaveLength(3)
    for (const midi of [60, 21, 96]) expect(barOver(stage.context, midi)).toBeDefined()
  })

  it('drops the light of the old piano when Auto picks another one in the middle of a note', () => {
    browser.size.width = 1400
    const stage = drawStage()
    act(() => stage.bus.noteOn(60, 'keyboard'))
    browser.play(0.3)
    expect(barOver(stage.context, 60)).toBeDefined()

    resizeTo(1000, 600)
    // The app lets go of every note when the piano changes (see useNoStuckNotes).
    act(() => stage.bus.allOff())
    browser.playUntilIdle()
    expect(stage.context.bars).toEqual([])
    expect(stampsOf(stage.context, BLOOM_PICTURE_SIZE)).toBe(0)

    act(() => stage.bus.noteOn(60, 'keyboard'))
    browser.play(0.3)
    expect(stage.context.bars).toHaveLength(1)
    expect(barOver(stage.context, 60)).toBeDefined()
    act(() => stage.bus.allOff())
    browser.playUntilIdle()
  })

  it('keeps the light on the keys when the computer keys move by an octave on a small piano', () => {
    browser.size.width = 1300
    const stage = drawStage({ settings: withSettings({ pianoSize: 37, baseOctave: 3 }) })
    const before = notesOnPiano()
    stage.redraw({ settings: withSettings({ pianoSize: 37, baseOctave: 4 }) })
    const after = notesOnPiano()
    expect(after[0]).toBe((before[0] as number) + 12)
    act(() => stage.bus.noteOn(after[0] as number, 'keyboard'))
    act(() => stage.bus.noteOn(after.at(-1) as number, 'keyboard'))
    browser.play(0.2)
    expect(stage.context.bars).toHaveLength(2)
    expect(barOver(stage.context, after[0] as number)).toBeDefined()
    expect(barOver(stage.context, after.at(-1) as number)).toBeDefined()
    act(() => stage.bus.allOff())
    browser.playUntilIdle()
  })
})

describe('what the settings do to the sky', () => {
  it('draws no bars, rising or falling, with light bars switched off, but still lights the line and throws sparks', () => {
    const song = fakeSong([note(60, 1, 0.5)])
    const stage = drawStage({ settings: withSettings({ showTrails: false, sparks: 'some' }) })
    act(() => stage.bus.noteOn(62, 'keyboard'))
    browser.play(0.3)
    expect(stage.context.bars).toEqual([])
    expect(stampsOf(stage.context, BLOOM_PICTURE_SIZE)).toBe(1)
    expect(stampsOf(stage.context, SPARK_PICTURE_SIZE)).toBeGreaterThan(0)

    stage.redraw({ falling: song.source })
    browser.play(0.1)
    expect(stage.context.bars).toEqual([])

    stage.redraw({ settings: withSettings({ showTrails: true, sparks: 'some' }) })
    browser.play(0.1)
    expect(stage.context.bars).toHaveLength(1)
    expect(barOver(stage.context, 60)).toBeDefined()
    act(() => stage.bus.allOff())
    browser.playUntilIdle()
  })

  it('writes the letters it is given on the falling notes, and none when it is given none', () => {
    const song = fakeSong([note(60, 1, 1), note(62, 1.5, 1)])
    const hints = new Map<Midi, string>([[60, 'A']])
    const stage = drawStage({ falling: song.source, hints, settings: withSettings({ pianoSize: 37 }) })
    expect(stage.context.texts.map((text) => text.text)).toEqual(['A'])
    const bar = barOver(stage.context, 60)
    expect(stage.context.texts[0]?.x).toBeCloseTo((bar?.x ?? 0) + (bar?.width ?? 0) / 2, 6)
    stage.redraw({ hints: new Map() })
    expect(stage.context.texts).toEqual([])
  })

  it('follows the bar style, the glow, the sparks and the colour without restarting the light in the air', () => {
    const stage = drawStage()
    act(() => stage.bus.noteOn(60, 'keyboard'))
    browser.play(0.5)
    const before = { ...(barOver(stage.context, 60) as PaintedBar) }
    stage.redraw({
      settings: withSettings({
        barStyle: 'neon',
        glow: 1,
        sparks: 'lots',
        accent: 'rainbow',
        background: 'aurora',
        keyStyle: 'glass',
      }),
    })
    browser.play(0.1)
    const after = barOver(stage.context, 60) as PaintedBar
    // Neon draws its outline just inside the bar: the bar is where it was, and has kept growing.
    expect(after.x).toBeGreaterThanOrEqual(before.x)
    expect(after.x + after.width).toBeLessThanOrEqual(before.x + before.width)
    expect(after.height).toBeGreaterThan(before.height - 2)
    expect(after.outline).not.toBeNull()
    expect(stampsOf(stage.context, SPARK_PICTURE_SIZE)).toBeGreaterThan(0)
    act(() => stage.bus.allOff())
    browser.playUntilIdle()
  })
})

describe('what a note costs the idle sky', () => {
  it('neither animates nor paints again for a note that is not on the piano', () => {
    const stage = drawStage({ settings: withSettings({ pianoSize: 37, sparks: 'lots' }) })
    const wipes = stage.context.wipes
    // The piano shows C3 to C6: this note is below it. The stage draws itself again for it.
    act(() => stage.bus.noteOn(30, 'playback'))
    act(() => stage.bus.noteOff(30, 'playback'))
    expect(browser.frames.requested).toBe(0)
    expect(stage.context.wipes).toBe(wipes)
  })

  it('asks for one frame at a time while notes come and go, however often the stage is drawn again', () => {
    const stage = drawStage({ settings: withSettings({ sparks: 'some' }) })
    for (let i = 0; i < 40; i++) {
      act(() => stage.bus.noteOn(48 + (i % 20), 'keyboard'))
      expect(browser.frames.pending.size).toBe(1)
      browser.frame()
      if (i % 3 === 0) act(() => stage.bus.noteOff(48 + (i % 20), 'keyboard'))
    }
    act(() => stage.bus.allOff())
    browser.playUntilIdle()
    expect(stage.context.bars).toEqual([])
  })
})

// Last in this file: when it fails, the stage it drew cannot be taken off the page cleanly.
describe('telling the app which piano is on screen', () => {
  it('does not mind what the function it reports to gives back', () => {
    // Easily written by whoever uses the stage: an arrow function that keeps the range, and so returns it.
    const kept: { range: PianoRange | null } = { range: null }
    const stage = drawStage({
      settings: withSettings({ pianoSize: 88 }),
      onRangeChange: (range) => (kept.range = range),
    })
    expect(kept.range).toEqual({ first: 21, last: 108 })
    // Another piano: the stage reports it, and nothing breaks.
    expect(() => stage.redraw({ settings: withSettings({ pianoSize: 37 }) })).not.toThrow()
    expect(kept.range).toEqual({ first: 48, last: 84 })
    expect(notesOnPiano()).toHaveLength(37)
    expect(() => stage.unmount()).not.toThrow()
  })
})
