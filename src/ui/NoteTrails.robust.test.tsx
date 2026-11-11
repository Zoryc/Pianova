// @vitest-environment jsdom
/**
 * The light trails on a stand-in canvas with a hand-cranked animation clock:
 * what they cost while the piano is idle, per frame while notes are moving,
 * and what they leave behind when they go away (spec section 5.8: "an idle
 * piano uses no CPU", "cleans up fully on unmount").
 */
import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteBus } from '../core/noteBus'
import type { NoteListener } from '../core/types'
import { NoteTrails } from './NoteTrails'
import { MAX_BARS } from './noteTrailsModel'

const CANVAS = { width: 1100, height: 160 }
const FRAME_MS = 16
/**
 * Glows and gradients are what costs time on a canvas. A few per frame are
 * fine (today: one per colour, and one to fade the top out). This is far
 * fewer than the 37 a frame would need with one for every key of the piano.
 */
const FEW_PER_FRAME = 8

/** Counts what the trails ask of the canvas. */
const calls = { gradients: 0, fills: 0, roundRects: 0, clears: 0 }

/** The frames the page has asked for and not yet been given. */
let frames = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
let clock = 0
let cancelled = 0
let reducedMotion = false
let mediaListeners = 0
let observers = 0

function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = {
    canvas,
    globalAlpha: 1,
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    globalCompositeOperation: 'source-over',
    setTransform() {},
    clearRect() {
      calls.clears += 1
    },
    createLinearGradient() {
      calls.gradients += 1
      return { addColorStop() {} }
    },
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {
      calls.roundRects += 1
    },
    fill() {
      calls.fills += 1
    },
    fillRect() {},
  }
  return context as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
  frames = new Map()
  nextFrameId = 1
  clock = 0
  cancelled = 0
  reducedMotion = false
  mediaListeners = 0
  observers = 0
  calls.gradients = calls.fills = calls.roundRects = calls.clears = 0

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return fakeContext(this)
  } as unknown as HTMLCanvasElement['getContext']
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => CANVAS.width,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => CANVAS.height,
  })

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const id = nextFrameId++
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    if (frames.delete(id)) cancelled += 1
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        observers += 1
      }
      unobserve(): void {}
      disconnect(): void {
        observers -= 1
      }
    },
  )
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reducedMotion
    },
    addEventListener() {
      mediaListeners += 1
    },
    removeEventListener() {
      mediaListeners -= 1
    },
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Gives the page the frames it asked for, one screen refresh at a time. Returns how many ran. */
function runFrames(count: number): number {
  let ran = 0
  for (let index = 0; index < count; index++) {
    const pending = [...frames]
    if (pending.length === 0) break
    frames = new Map()
    clock += FRAME_MS
    for (const [, callback] of pending) {
      callback(clock)
      ran += 1
    }
  }
  return ran
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

function mount(bus: NoteBus, baseOctave = 3): ReturnType<typeof render> {
  return render(
    <StrictMode>
      <NoteTrails bus={bus} baseOctave={baseOctave} />
    </StrictMode>,
  )
}

describe('NoteTrails: an idle piano', () => {
  it('asks for no animation frame until a note is played', () => {
    const bus = new CountingBus()
    mount(bus)
    expect(frames.size).toBe(0)
    expect(bus.subscribers).toBe(1)
  })

  it('ignores notes outside the piano and asks for no frame for them', () => {
    const bus = new NoteBus()
    mount(bus)
    bus.noteOn(30, 'playback')
    bus.noteOff(30, 'playback')
    expect(frames.size).toBe(0)
  })

  it('stops asking for frames once the last bar has left, and starts again at the next note', () => {
    const bus = new NoteBus()
    mount(bus)

    bus.noteOn(60, 'keyboard')
    expect(frames.size).toBe(1)
    // Held: one frame at a time, for as long as the key is down.
    expect(runFrames(120)).toBe(120)
    expect(frames.size).toBe(1)

    bus.noteOff(60, 'keyboard')
    // The bar now rises out of the canvas: a few seconds at most.
    const ran = runFrames(1000)
    expect(ran).toBeGreaterThan(10)
    expect(ran).toBeLessThan(400)
    expect(frames.size).toBe(0)
    expect(runFrames(10)).toBe(0)

    bus.noteOn(62, 'keyboard')
    expect(frames.size).toBe(1)
  })

  it('never has more than one frame pending, however many notes are played at once', () => {
    const bus = new NoteBus()
    mount(bus)
    for (let midi = 48; midi <= 84; midi++) bus.noteOn(midi, 'pointer')
    expect(frames.size).toBe(1)
    runFrames(3)
    for (let midi = 48; midi <= 84; midi++) bus.noteOff(midi, 'pointer')
    expect(frames.size).toBe(1)
  })

  it('asks for no frame at all when the player prefers reduced motion', () => {
    reducedMotion = true
    const bus = new NoteBus()
    mount(bus)
    bus.noteOn(60, 'keyboard')
    bus.noteOn(61, 'keyboard')
    expect(frames.size).toBe(0)
    expect(calls.fills).toBeGreaterThan(0)
    bus.allOff()
    expect(frames.size).toBe(0)
  })
})

describe('NoteTrails: cost of one frame', () => {
  it('does not grow with the number of bars: a few fills and gradients, not one per bar', () => {
    const bus = new NoteBus()
    mount(bus)
    // A white-key note and a black-key note, so both colours are in use.
    bus.noteOn(60, 'keyboard')
    bus.noteOn(61, 'keyboard')
    runFrames(5)

    const costOfFrame = (): { gradients: number; fills: number } => {
      const before = { ...calls }
      runFrames(1)
      return { gradients: calls.gradients - before.gradients, fills: calls.fills - before.fills }
    }
    const withTwo = costOfFrame()

    for (let midi = 48; midi <= 84; midi++) bus.noteOn(midi, 'pointer')
    runFrames(5)
    const withThirtySeven = costOfFrame()

    for (const cost of [withTwo, withThirtySeven]) {
      // Something was painted…
      expect(cost.fills).toBeGreaterThanOrEqual(1)
      // …at a cost that stays small however many bars there are.
      expect(cost.fills).toBeLessThanOrEqual(FEW_PER_FRAME)
      expect(cost.gradients).toBeLessThanOrEqual(FEW_PER_FRAME)
    }
  })

  it('keeps the list of bars bounded when notes flood in', () => {
    const bus = new NoteBus()
    mount(bus)
    for (let round = 0; round < 50; round++) {
      for (let midi = 48; midi <= 84; midi++) {
        bus.noteOn(midi, 'playback')
        bus.noteOff(midi, 'playback')
      }
    }
    const before = calls.roundRects
    runFrames(1)
    // 1850 notes were played; only the newest bars are kept and drawn.
    expect(calls.roundRects - before).toBeLessThanOrEqual(MAX_BARS)
  })
})

describe('NoteTrails: going away', () => {
  it('cancels the pending frame and removes every listener when unmounted in the middle of a note', () => {
    const bus = new CountingBus()
    const view = mount(bus)
    bus.noteOn(60, 'keyboard')
    runFrames(3)
    expect(frames.size).toBe(1)

    act(() => view.unmount())

    expect(frames.size).toBe(0)
    expect(cancelled).toBeGreaterThanOrEqual(1)
    expect(bus.subscribers).toBe(0)
    expect(mediaListeners).toBe(0)
    expect(observers).toBe(0)
    // Notes played afterwards reach nobody.
    bus.noteOff(60, 'keyboard')
    bus.noteOn(62, 'keyboard')
    expect(frames.size).toBe(0)
  })

  it('leaves one subscription, not several, after the piano was moved many times', () => {
    const bus = new CountingBus()
    const view = mount(bus)
    for (let move = 0; move < 20; move++) {
      bus.noteOn(60 + move, 'keyboard')
      view.rerender(
        <StrictMode>
          <NoteTrails bus={bus} baseOctave={1 + (move % 5)} />
        </StrictMode>,
      )
    }
    expect(bus.subscribers).toBe(1)
    expect(mediaListeners).toBe(1)
    expect(observers).toBe(1)
    expect(frames.size).toBeLessThanOrEqual(1)
  })

  it('drops the bars of the old position when the piano moves, and then goes idle', () => {
    const bus = new NoteBus()
    const view = mount(bus, 3)
    bus.noteOn(60, 'keyboard')
    runFrames(3)

    // As in the app, every note is let go when the piano moves (spec 5.7),
    // before the trails start again at the new position.
    bus.allOff()
    // The bar is on its way up: the animation is still running.
    expect(frames.size).toBe(1)
    view.rerender(
      <StrictMode>
        <NoteTrails bus={bus} baseOctave={4} />
      </StrictMode>,
    )

    expect(frames.size).toBe(0)
    expect(runFrames(10)).toBe(0)
  })
})
