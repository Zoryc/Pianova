// @vitest-environment jsdom
/**
 * The on-screen piano under a mouse, fingers and a pen: the real <Piano />
 * drawn in a simulated browser and driven with the same pointer events a
 * browser sends, including the ones that arrive when things go wrong (a
 * cancelled touch, a lost capture, a release that never comes).
 *
 * The simulated browser has no layout, so the piano box is given a fixed
 * place on screen: 2200 x 200 pixels, which makes every white key 100 wide.
 */
import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEY_RECTS } from '../core/keyGeometry'
import { MAX_BASE_OCTAVE, MIN_BASE_OCTAVE, SLOT_COUNT, slotToMidi } from '../core/layout'
import { noteName, pitchName } from '../core/notes'
import type { LabelMode, Midi, NoteNaming } from '../core/types'
import { Piano } from './Piano'
import type { PianoProps } from './Piano'
import { barRect, startBar } from './noteTrailsModel'
import { BLACK_KEY_HEIGHT } from './pianoHitTest'

const BOX = { left: 100, top: 40, width: 2200, height: 200 }
/** Halfway down the black keys, and halfway down the part of the white keys below them (shares of the piano's height). */
const UPPER_ROW = BLACK_KEY_HEIGHT / 2
const LOWER_ROW = (1 + BLACK_KEY_HEIGHT) / 2

const LABEL_MODES: readonly LabelMode[] = ['both', 'keys', 'notes', 'none']
const NAMINGS: readonly NoteNaming[] = ['letters', 'solfege']

interface Point {
  clientX: number
  clientY: number
}

/** The point across the piano where a key has its middle, at a given share of the piano's height. */
function inColumn(slot: number, heightShare: number): Point {
  const rect = KEY_RECTS[slot]
  if (!rect) throw new Error(`no key for slot ${slot}`)
  return {
    clientX: BOX.left + (rect.left + rect.width / 2) * BOX.width,
    clientY: BOX.top + heightShare * BOX.height,
  }
}

/** A point on the visible part of a key: black keys high up, white keys below the black ones. */
function onSlot(slot: number): Point {
  return inColumn(slot, KEY_RECTS[slot]?.black ? UPPER_ROW : LOWER_ROW)
}

/** A height on screen that is just under the piano. */
const UNDER_PIANO_Y = BOX.top + BOX.height + 30
const ABOVE_PIANO: Point = { clientX: BOX.left + 500, clientY: BOX.top - 30 }
const BELOW_PIANO: Point = { clientX: BOX.left + 500, clientY: UNDER_PIANO_Y }
const LEFT_OF_PIANO: Point = { clientX: BOX.left - 5, clientY: BOX.top + 100 }
/** Under the piano and to its left: the way from below it to beside it that does not pass over it. */
const ROUND_ITS_CORNER: Point = { clientX: BOX.left - 5, clientY: UNDER_PIANO_Y }

/**
 * Just off the piano, straight below a white key. Between the key and this
 * point the pointer crosses no other key, so a test that leaves the piano
 * this way says nothing about keys that a slanted way out would pass over.
 */
function straightBelow(whiteSlot: number): Point {
  return { clientX: onSlot(whiteSlot).clientX, clientY: UNDER_PIANO_Y }
}

// ---------------------------------------------------------------------------
// Pointer capture, the way a browser does it (the simulated browser has none).
// ---------------------------------------------------------------------------

const captured = new Map<number, Element>()
let captureWorks = true
const captureCalls: string[] = []

beforeEach(() => {
  captured.clear()
  captureCalls.length = 0
  captureWorks = true
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.setPointerCapture = function (this: Element, pointerId: number): void {
    if (!captureWorks) throw new DOMException('No active pointer with this id', 'NotFoundError')
    captureCalls.push(`${pointerId}:${this.className}`)
    captured.set(pointerId, this)
  }
  proto.hasPointerCapture = function (this: Element, pointerId: number): boolean {
    return captured.get(pointerId) === this
  }
  proto.releasePointerCapture = function (this: Element, pointerId: number): void {
    if (captured.get(pointerId) === this) captured.delete(pointerId)
  }
})

afterEach(() => {
  cleanup()
  const proto = Element.prototype as unknown as Record<string, unknown>
  delete proto.setPointerCapture
  delete proto.hasPointerCapture
  delete proto.releasePointerCapture
})

// ---------------------------------------------------------------------------
// Drawing the piano
// ---------------------------------------------------------------------------

interface Harness {
  piano: HTMLElement
  /** "down 60" / "up 60", in the order the piano reported them. */
  log: string[]
  selected: number[]
  key(slot: number): HTMLElement
  update(changes: Partial<PianoProps>): void
  unmount(): void
}

function draw(overrides: Partial<PianoProps> = {}, strict = false): Harness {
  const log: string[] = []
  const selected: number[] = []
  let props: PianoProps = {
    baseOctave: 3,
    activeNotes: new Set<Midi>(),
    labelMode: 'both',
    noteNaming: 'letters',
    keyLabels: new Map<number, string>(),
    onNoteDown: (midi) => log.push(`down ${midi}`),
    onNoteUp: (midi) => log.push(`up ${midi}`),
    onSelectSlot: (slot) => selected.push(slot),
    ...overrides,
  }
  const element = (): React.JSX.Element =>
    strict ? (
      <StrictMode>
        <Piano {...props} />
      </StrictMode>
    ) : (
      <Piano {...props} />
    )
  const view = render(element())
  const piano = view.container.querySelector<HTMLElement>('.piano')
  if (!piano) throw new Error('the piano was not drawn')
  piano.getBoundingClientRect = () =>
    ({
      x: BOX.left,
      y: BOX.top,
      left: BOX.left,
      top: BOX.top,
      width: BOX.width,
      height: BOX.height,
      right: BOX.left + BOX.width,
      bottom: BOX.top + BOX.height,
      toJSON: () => ({}),
    }) as DOMRect

  return {
    piano,
    log,
    selected,
    key(slot) {
      const key = piano.querySelector<HTMLElement>(`.piano-key[data-slot="${slot}"]`)
      if (!key) throw new Error(`no key element for slot ${slot}`)
      return key
    },
    update(changes) {
      props = { ...props, ...changes }
      view.rerender(element())
    },
    unmount: () => view.unmount(),
  }
}

// ---------------------------------------------------------------------------
// A pointer that behaves like the browser's: once the piano has captured it,
// its events are sent to the piano box wherever it is, and the capture ends
// (with `lostpointercapture`) after the release or the cancel.
// ---------------------------------------------------------------------------

function send(target: EventTarget, type: string, init: PointerEventInit): void {
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
  })
}

class Pointer {
  private buttons = 0
  private at: Point = { clientX: 0, clientY: 0 }

  constructor(
    private readonly harness: Harness,
    readonly id = 1,
    readonly type: 'mouse' | 'touch' | 'pen' = 'mouse',
  ) {}

  private init(extra: PointerEventInit = {}): PointerEventInit {
    return {
      pointerId: this.id,
      pointerType: this.type,
      isPrimary: true,
      buttons: this.buttons,
      button: -1,
      ...this.at,
      ...extra,
    }
  }

  private target(fallback: EventTarget): EventTarget {
    return captured.get(this.id) ?? fallback
  }

  /** Presses on a key (by slot) or anywhere (by point). `button`: 0 left, 1 middle, 2 right. */
  down(where: number | Point, button = 0): this {
    const onKey = typeof where === 'number'
    this.at = onKey ? onSlot(where) : where
    this.buttons |= [1, 4, 2][button] ?? 0
    const target = onKey ? this.harness.key(where) : this.harness.piano
    send(target, 'pointerdown', this.init({ button }))
    return this
  }

  /** Moves, keeping the buttons as they are. Reaches the piano only if it is over it or captured by it. */
  move(where: number | Point, target: EventTarget = this.harness.piano): this {
    this.at = typeof where === 'number' ? onSlot(where) : where
    send(this.target(target), 'pointermove', this.init())
    return this
  }

  /** A button changes while another stays down: the browser reports that as a move. */
  changeButtons(buttons: number, button: number): this {
    this.buttons = buttons
    send(this.target(this.harness.piano), 'pointermove', this.init({ button }))
    return this
  }

  up(button = 0): this {
    this.buttons = 0
    send(this.target(this.harness.piano), 'pointerup', this.init({ button }))
    this.endCapture()
    return this
  }

  cancel(): this {
    this.buttons = 0
    send(this.target(this.harness.piano), 'pointercancel', this.init())
    this.endCapture()
    return this
  }

  /** The pointer crosses the edge of the piano on its way out. */
  leave(): this {
    this.at = BELOW_PIANO
    send(this.harness.piano, 'pointerout', this.init({ relatedTarget: document.body }))
    return this
  }

  private endCapture(): void {
    const holder = captured.get(this.id)
    if (!holder) return
    captured.delete(this.id)
    send(holder, 'lostpointercapture', this.init())
  }
}

/** Every key that went down came back up exactly once, and none went down twice in a row. */
function expectBalanced(log: readonly string[]): void {
  const down = new Set<string>()
  for (const entry of log) {
    const [kind, midi] = entry.split(' ') as [string, string]
    if (kind === 'down') {
      expect(down.has(midi), `${midi} started twice without stopping: ${log.join(', ')}`).toBe(false)
      down.add(midi)
    } else {
      expect(down.has(midi), `${midi} stopped without having started: ${log.join(', ')}`).toBe(true)
      down.delete(midi)
    }
  }
  expect([...down], `left sounding: ${log.join(', ')}`).toEqual([])
}

const C4 = 12
const C_SHARP_4 = 13
const D4 = 14
const E4 = 16
const F4 = 17
const G4 = 19
const A4 = 21
const C5 = 24

// ===========================================================================

describe('playing with a pointer', () => {
  it('plays the key under the pointer on press and stops it on release', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    expect(h.log).toEqual(['down 60'])
    mouse.up()
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('finds every one of the 37 keys, at every piano position', () => {
    for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
      const h = draw({ baseOctave })
      const mouse = new Pointer(h)
      for (let slot = 0; slot < SLOT_COUNT; slot++) mouse.down(slot).up()
      const expected = Array.from({ length: SLOT_COUNT }, (_, slot) => {
        const midi = slotToMidi(slot, baseOctave)
        return [`down ${midi}`, `up ${midi}`]
      }).flat()
      expect(h.log).toEqual(expected)
      h.unmount()
    }
  })

  it('plays the white key when the pointer is below a black key, and the black key above', () => {
    const h = draw()
    const cSharp = KEY_RECTS[C_SHARP_4]
    if (!cSharp) throw new Error('geometry is missing C sharp')
    // The left half of C sharp lies over C, the right half over D.
    const leftHalf = BOX.left + (cSharp.left + cSharp.width * 0.25) * BOX.width
    const rightHalf = BOX.left + (cSharp.left + cSharp.width * 0.75) * BOX.width
    const high = BOX.top + UPPER_ROW * BOX.height
    const low = BOX.top + LOWER_ROW * BOX.height
    const mouse = new Pointer(h)
    mouse.down({ clientX: leftHalf, clientY: high }).up()
    mouse.down({ clientX: leftHalf, clientY: low }).up()
    mouse.down({ clientX: rightHalf, clientY: low }).up()
    expect(h.log).toEqual(['down 61', 'up 61', 'down 60', 'up 60', 'down 62', 'up 62'])
  })

  it('ignores the right and the middle mouse button', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4, 2).move(D4).up(2)
    mouse.down(C4, 1).move(D4).up(1)
    expect(h.log).toEqual([])
    expect(captureCalls).toEqual([])
  })

  it('captures the pointer on the piano box, so the release reaches it from anywhere', () => {
    const h = draw()
    new Pointer(h, 7).down(C4)
    expect(captureCalls).toEqual(['7:piano'])
  })

  it('plays a finger and a pen like the mouse', () => {
    const h = draw()
    new Pointer(h, 21, 'touch').down(C4).up()
    new Pointer(h, 22, 'pen').down(D4).up()
    expect(h.log).toEqual(['down 60', 'up 60', 'down 62', 'up 62'])
  })

  it('plays each key passed over when dragging, releasing the previous one first', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4).move(C_SHARP_4).move(D4).move(D4).move(E4).up()
    expect(h.log).toEqual([
      'down 60',
      'up 60',
      'down 61',
      'up 61',
      'down 62',
      'up 62',
      'down 64',
      'up 64',
    ])
  })

  it('does not repeat the note while the pointer wanders inside one key', () => {
    const h = draw()
    const mouse = new Pointer(h)
    const { clientX, clientY } = onSlot(C4)
    mouse.down(C4)
    mouse.move({ clientX: clientX + 20, clientY }).move({ clientX: clientX - 20, clientY: clientY + 15 })
    expect(h.log).toEqual(['down 60'])
  })

  it('stops the note when the pointer is dragged off the piano, and plays again when it comes back', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4).move(straightBelow(C4))
    expect(h.log).toEqual(['down 60', 'up 60'])
    // Wandering about beside the piano, without passing over it, plays nothing.
    mouse.move(BELOW_PIANO).move(ROUND_ITS_CORNER).move(LEFT_OF_PIANO)
    mouse.move(ROUND_ITS_CORNER).move(straightBelow(E4))
    expect(h.log).toEqual(['down 60', 'up 60'])
    mouse.move(E4)
    expect(h.log).toEqual(['down 60', 'up 60', 'down 64'])
    mouse.up()
    expectBalanced(h.log)
  })

  it('stops the note when the button is released outside the piano', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4).move(straightBelow(C4)).up()
    expect(h.log).toEqual(['down 60', 'up 60'])
    // Nothing is left behind: coming back without pressing plays nothing.
    mouse.move(D4)
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('starts playing when a pointer pressed on the very edge slides onto a key', () => {
    const h = draw()
    const mouse = new Pointer(h)
    // The right edge itself belongs to no key.
    mouse.down({ clientX: BOX.left + BOX.width, clientY: BOX.top + 150 })
    expect(h.log).toEqual([])
    mouse.move(SLOT_COUNT - 1)
    expect(h.log).toEqual([`down ${slotToMidi(SLOT_COUNT - 1, 3)}`])
    mouse.up()
    expectBalanced(h.log)
  })

  it('does nothing for a pointer that only hovers', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.move(C4).move(D4).leave()
    expect(h.log).toEqual([])
  })

  it('reports to the newest callbacks when they change while a key is held', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    const later: string[] = []
    h.update({
      onNoteDown: (midi) => later.push(`down ${midi}`),
      onNoteUp: (midi) => later.push(`up ${midi}`),
    })
    mouse.move(D4).up()
    expect(h.log).toEqual(['down 60'])
    expect(later).toEqual(['up 60', 'down 62', 'up 62'])
  })

  it('keeps a held key down while the piano is redrawn because notes light up', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    h.update({ activeNotes: new Set([60]) })
    h.update({ activeNotes: new Set([60, 64]), labelMode: 'notes', noteNaming: 'solfege' })
    h.update({ keyLabels: new Map([[C4, 'Q']]) })
    expect(h.log).toEqual(['down 60'])
    mouse.up()
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('plays each note once when drawn twice by StrictMode', () => {
    const h = draw({}, true)
    const mouse = new Pointer(h)
    mouse.down(C4).move(D4).up()
    expect(h.log).toEqual(['down 60', 'up 60', 'down 62', 'up 62'])
  })
})

describe('a quick glissando', () => {
  /*
   * Browsers hand a page at most one pointermove per screen refresh. A quick
   * sweep therefore reaches the piano as a few moves that are several keys
   * apart; some browsers keep the positions in between and give them out
   * through getCoalescedEvents(). The spec (5.6): "A fast drag does not skip
   * keys: every key on the straight line between two pointer positions is
   * played, in order (coalesced pointer events are used when the browser has
   * them)".
   */

  /** What the piano reports when these notes are played one after the other, each released before the next. */
  function inTurn(notes: readonly number[]): string[] {
    return notes.flatMap((midi) => [`down ${midi}`, `up ${midi}`])
  }

  /** One move of the pressed mouse that ends on the last of `slots`, having been on each of them since its previous move. */
  function moveThrough(h: Harness, slots: readonly number[]): void {
    const init = (slot: number): PointerEventInit => ({
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: -1,
      buttons: 1,
      ...onSlot(slot),
    })
    const last = slots.at(-1)
    if (last === undefined) throw new Error('a move needs somewhere to go')
    const coalescedEvents = slots.map((slot) => new PointerEvent('pointermove', init(slot)))
    act(() => {
      h.piano.dispatchEvent(new PointerEvent('pointermove', { ...init(last), coalescedEvents }))
    })
  }

  it('plays the keys the pointer passed over between two moves', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    // One move takes the pointer from C4 to G4 along the white keys: it passed over D4, E4 and F4.
    moveThrough(h, [D4, E4, F4, G4])
    mouse.up()
    expect(h.log).toEqual(inTurn([60, 62, 64, 65, 67]))
  })

  it('plays every key on the line between two moves when the browser reports nothing in between', () => {
    const h = draw()
    const mouse = new Pointer(h)
    // Up to G4 in one move and back down in the next, along the white keys.
    mouse.down(C4).move(G4)
    expect(h.log).toEqual([...inTurn([60, 62, 64, 65]), 'down 67'])
    mouse.move(C4).up()
    expect(h.log).toEqual(inTurn([60, 62, 64, 65, 67, 65, 64, 62, 60]))
  })

  it('plays the black keys as well when the line runs through the upper part of the piano', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(inColumn(C4, UPPER_ROW)).move(inColumn(G4, UPPER_ROW)).up()
    expect(h.log).toEqual(inTurn([60, 61, 62, 63, 64, 65, 66, 67]))
  })

  it('fills in the gaps between the positions the browser kept, too', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    // The browser kept one position on the way to G4, and that one is already two keys from C4.
    moveThrough(h, [E4, G4])
    mouse.up()
    expect(h.log).toEqual(inTurn([60, 62, 64, 65, 67]))
  })

  it('follows each finger along its own line', () => {
    const h = draw()
    const left = new Pointer(h, 11, 'touch').down(C4)
    const right = new Pointer(h, 12, 'touch').down(C5)
    left.move(E4)
    expect(h.log).toEqual(['down 60', 'down 72', 'up 60', 'down 62', 'up 62', 'down 64'])
    right.move(A4)
    expect(h.log.slice(6)).toEqual(['up 72', 'down 71', 'up 71', 'down 69'])
    left.up()
    right.up()
    expectBalanced(h.log)
  })

  it('starts a new line at each press: nothing is played between where a pointer was and where it presses next', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4).up()
    mouse.down(G4).move(A4)
    expect(h.log).toEqual(['down 60', 'up 60', 'down 67', 'up 67', 'down 69'])
    // The same when the release never arrived because the window lost focus.
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    mouse.down(C4).move(D4).up()
    expect(h.log.slice(5)).toEqual(['up 69', 'down 60', 'up 60', 'down 62', 'up 62'])
  })
})

describe('releases that go wrong', () => {
  it('stops the note when the touch is cancelled', () => {
    const h = draw()
    const finger = new Pointer(h, 5, 'touch')
    finger.down(C4).cancel()
    expect(h.log).toEqual(['down 60', 'up 60'])
    finger.move(D4)
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('stops the note when the piano loses the pointer capture without a release', () => {
    const h = draw()
    new Pointer(h, 3).down(C4)
    captured.delete(3)
    send(h.piano, 'lostpointercapture', { pointerId: 3 })
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('keeps the note when a key loses the capture a touch screen gave it', () => {
    // A finger is first captured by the key it lands on; the piano box then
    // takes the capture over and the key is told it lost it. The note goes on.
    const h = draw()
    const finger = new Pointer(h, 9, 'touch')
    finger.down(C4)
    send(h.key(C4), 'lostpointercapture', { pointerId: 9 })
    expect(h.log).toEqual(['down 60'])
    finger.move(D4).up()
    expect(h.log).toEqual(['down 60', 'up 60', 'down 62', 'up 62'])
  })

  it('does not stop the note when a captured pointer is reported as leaving', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    send(h.key(C4), 'pointerout', { pointerId: 1, relatedTarget: null })
    send(h.piano, 'pointerout', { pointerId: 1, relatedTarget: document.body })
    expect(h.log).toEqual(['down 60'])
    mouse.up()
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('stops the note when a pointer that could not be captured leaves the piano', () => {
    captureWorks = false
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    expect(h.log).toEqual(['down 60'])
    mouse.leave()
    expect(h.log).toEqual(['down 60', 'up 60'])
    // The release happens somewhere else and never reaches the piano.
    mouse.move(D4)
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('still plays and stops normally when the pointer cannot be captured', () => {
    captureWorks = false
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4).move(D4).up()
    expect(h.log).toEqual(['down 60', 'up 60', 'down 62', 'up 62'])
  })

  it('stops the note when the left button is let go while the right one stays down', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    mouse.changeButtons(3, 2) // right button pressed as well
    expect(h.log).toEqual(['down 60'])
    mouse.changeButtons(2, 0) // left button let go: reported as a move
    expect(h.log).toEqual(['down 60', 'up 60'])
    mouse.move(D4)
    expect(h.log).toEqual(['down 60', 'up 60'])
    mouse.up(2)
    expectBalanced(h.log)
  })

  it('keeps playing while a second mouse button is pressed and released during a drag', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4).changeButtons(5, 1).move(D4).changeButtons(1, 1).move(E4).up()
    expect(h.log).toEqual(['down 60', 'up 60', 'down 62', 'up 62', 'down 64', 'up 64'])
  })

  it('stops the note at the next mouse move when the release was never delivered', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    // The button came up where the page could not see it: the next move has no button down.
    mouse.changeButtons(0, -1)
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('starts cleanly when a pointer is pressed again without ever having been released', () => {
    const h = draw()
    const mouse = new Pointer(h)
    mouse.down(C4)
    mouse.down(E4)
    expect(h.log).toEqual(['down 60', 'up 60', 'down 64'])
    mouse.up()
    expectBalanced(h.log)
  })

  it('stops everything when the window loses focus, and ignores the late release', () => {
    const h = draw()
    const mouse = new Pointer(h)
    const finger = new Pointer(h, 2, 'touch')
    mouse.down(C4)
    finger.down(E4)
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(h.log).toEqual(['down 60', 'down 64', 'up 60', 'up 64'])
    mouse.move(D4).up()
    finger.cancel()
    expect(h.log).toEqual(['down 60', 'down 64', 'up 60', 'up 64'])
  })

  it('stops listening to the window once the piano is gone', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const h = draw()
    h.unmount()
    expect(remove.mock.calls.some(([type]) => type === 'blur')).toBe(true)
    remove.mockRestore()
  })
})

describe('several pointers', () => {
  it('plays a chord with three fingers', () => {
    const h = draw()
    const a = new Pointer(h, 11, 'touch').down(C4)
    const b = new Pointer(h, 12, 'touch').down(E4)
    const c = new Pointer(h, 13, 'touch').down(G4)
    expect(h.log).toEqual(['down 60', 'down 64', 'down 67'])
    b.up()
    a.up()
    c.cancel()
    expect(h.log).toEqual(['down 60', 'down 64', 'down 67', 'up 64', 'up 60', 'up 67'])
  })

  it('keeps a key down until the last of two fingers on it lets go', () => {
    const h = draw()
    const a = new Pointer(h, 11, 'touch').down(C4)
    const b = new Pointer(h, 12, 'touch').down(C4)
    expect(h.log).toEqual(['down 60'])
    a.up()
    expect(h.log).toEqual(['down 60'])
    b.up()
    expect(h.log).toEqual(['down 60', 'up 60'])
  })

  it('keeps a shared key down when one finger slides away or is cancelled', () => {
    const h = draw()
    const a = new Pointer(h, 11, 'touch').down(C4)
    const b = new Pointer(h, 12, 'touch').down(C4)
    b.move(D4)
    expect(h.log).toEqual(['down 60', 'down 62'])
    b.move(C4)
    expect(h.log).toEqual(['down 60', 'down 62', 'up 62'])
    b.cancel()
    expect(h.log).toEqual(['down 60', 'down 62', 'up 62'])
    a.move(straightBelow(C4))
    expect(h.log).toEqual(['down 60', 'down 62', 'up 62', 'up 60'])
  })

  it('never leaves a note sounding, whatever the pointers do (2000 random steps)', () => {
    // A small fixed random sequence, so a failure can be reproduced.
    let seed = 20240607
    const random = (limit: number): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed % limit
    }
    const h = draw()
    const pointers = [
      new Pointer(h, 1, 'mouse'),
      new Pointer(h, 2, 'touch'),
      new Pointer(h, 3, 'touch'),
      new Pointer(h, 4, 'pen'),
    ]
    const places: (number | Point)[] = [C4, C_SHARP_4, D4, E4, 0, SLOT_COUNT - 1, ABOVE_PIANO, BELOW_PIANO]
    let baseOctave = 3
    let editMode = false

    for (let step = 0; step < 2000; step++) {
      const pointer = pointers[random(pointers.length)] as Pointer
      const place = places[random(places.length)] as number | Point
      switch (random(16)) {
        case 0:
        case 1:
        case 2:
          pointer.down(place)
          break
        case 3:
        case 4:
        case 5:
        case 6:
          pointer.move(place)
          break
        case 7:
        case 8:
          pointer.up()
          break
        case 9:
          pointer.cancel()
          break
        case 10:
          pointer.changeButtons(random(2) === 0 ? 2 : 3, 0)
          break
        case 11:
          pointer.leave()
          break
        case 12:
          act(() => {
            window.dispatchEvent(new Event('blur'))
          })
          break
        case 13:
          baseOctave = MIN_BASE_OCTAVE + random(MAX_BASE_OCTAVE - MIN_BASE_OCTAVE + 1)
          h.update({ baseOctave })
          break
        case 14:
          editMode = !editMode
          h.update({ editMode })
          break
        default:
          pointer.down(place, 2)
      }
    }
    h.unmount()
    expect(h.log.length).toBeGreaterThan(100)
    expectBalanced(h.log)
  })
})

describe('no stuck notes when the piano changes under a held key', () => {
  it('stops the note when the piano goes away', () => {
    const h = draw()
    new Pointer(h).down(C4)
    new Pointer(h, 2, 'touch').down(E4)
    h.unmount()
    expect(h.log).toEqual(['down 60', 'down 64', 'up 60', 'up 64'])
  })

  it('stops the note that was started, not its new neighbour, when the piano moves lower or higher', () => {
    const h = draw({ baseOctave: 3 })
    const finger = new Pointer(h, 2, 'touch').down(C4)
    h.update({ baseOctave: 4 })
    expect(h.log).toEqual(['down 60', 'up 60'])
    // The finger is still on the glass: it plays nothing more until it is pressed again.
    finger.move(D4).move(E4)
    expect(h.log).toEqual(['down 60', 'up 60'])
    finger.up()
    finger.down(C4).up()
    expect(h.log).toEqual(['down 60', 'up 60', 'down 72', 'up 72'])
  })

  it('stops the note when "Customize keys" starts, and plays nothing while it is on', () => {
    const h = draw()
    const finger = new Pointer(h, 2, 'touch').down(C4)
    h.update({ editMode: true })
    expect(h.log).toEqual(['down 60', 'up 60'])
    finger.move(D4).up()
    new Pointer(h).down(E4).move(F4).up()
    expect(h.log).toEqual(['down 60', 'up 60'])
    expect(captureCalls).toEqual(['2:piano'])
  })

  it('plays again as soon as "Customize keys" ends', () => {
    const h = draw({ editMode: true })
    h.update({ editMode: false })
    new Pointer(h).down(C4).up()
    expect(h.log).toEqual(['down 60', 'up 60'])
  })
})

describe('what the browser must not do while playing', () => {
  it('cancels the mouse press (no focus on the key, no text selection, no drag) and the context menu', () => {
    const h = draw()
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => {
      h.key(C4).dispatchEvent(mouseDown)
      h.key(C4).dispatchEvent(contextMenu)
    })
    expect(mouseDown.defaultPrevented).toBe(true)
    expect(contextMenu.defaultPrevented).toBe(true)
  })

  it('takes the keyboard away from a control that had it, without giving it to the key', async () => {
    const select = document.createElement('select')
    document.body.append(select)
    const h = draw()
    select.focus()
    expect(document.activeElement).toBe(select)
    const user = userEvent.setup()
    await user.click(h.key(C4))
    expect(document.activeElement).toBe(document.body)
    select.remove()
  })

  it('keeps the keys out of the Tab order while playing', () => {
    const h = draw()
    expect(h.piano.querySelectorAll('.piano-key[tabindex="-1"]')).toHaveLength(SLOT_COUNT)
  })
})

// ===========================================================================

describe('Customize keys (edit mode)', () => {
  it('selects the clicked key and plays nothing', async () => {
    const h = draw({ editMode: true })
    const user = userEvent.setup()
    await user.click(h.key(C4))
    await user.click(h.key(C_SHARP_4))
    expect(h.selected).toEqual([C4, C_SHARP_4])
    expect(h.log).toEqual([])
    expect(captureCalls).toEqual([])
  })

  it('selects the key when the click lands on its label', async () => {
    const h = draw({ editMode: true, keyLabels: new Map([[C4, 'A']]) })
    const user = userEvent.setup()
    const cap = h.key(C4).querySelector('.piano-key__cap')
    const note = h.key(C4).querySelector('.piano-key__note')
    if (!cap || !note) throw new Error('labels were not drawn')
    await user.click(cap)
    await user.click(note)
    expect(h.selected).toEqual([C4, C4])
  })

  it('selects nothing for a click that is not on a key, or with another mouse button', async () => {
    const h = draw({ editMode: true })
    const user = userEvent.setup()
    await user.click(h.piano)
    await user.pointer({ keys: '[MouseRight]', target: h.key(C4) })
    expect(h.selected).toEqual([])
  })

  it('does not select by click while playing', async () => {
    const h = draw({ editMode: false })
    const user = userEvent.setup()
    await user.click(h.key(C4))
    expect(h.selected).toEqual([])
  })

  it('lets Tab reach all 37 keys, lowest first', async () => {
    const h = draw({ editMode: true })
    const user = userEvent.setup()
    const visited: (string | undefined)[] = []
    for (let i = 0; i < SLOT_COUNT; i++) {
      await user.tab()
      const focused = document.activeElement as HTMLElement
      expect(focused.tagName).toBe('BUTTON')
      expect(h.piano.contains(focused)).toBe(true)
      visited.push(focused.dataset.slot)
    }
    expect(visited).toEqual(Array.from({ length: SLOT_COUNT }, (_, slot) => String(slot)))
  })

  it('selects the focused key with Enter and keeps that key press from the rest of the app', async () => {
    const h = draw({ editMode: true })
    const user = userEvent.setup()
    const seenByApp: string[] = []
    const listener = (event: KeyboardEvent): void => {
      seenByApp.push(event.code)
    }
    window.addEventListener('keydown', listener)
    try {
      await user.tab()
      await user.tab()
      await user.keyboard('[Enter]')
    } finally {
      window.removeEventListener('keydown', listener)
    }
    // Tab went through; Enter did not (the app would have taken it for the key the player wants for this note).
    expect(seenByApp).toEqual(['Tab', 'Tab'])
    expect(h.selected).toEqual([1])
    expect(h.log).toEqual([])
  })

  it('leaves Space to the app, where it is the sustain key, and selects nothing with it', async () => {
    // The spec (5.5): Space turns sustain on and off "including when a button
    // has focus, without also 'clicking' that button". Enter is the key that
    // presses a button, a piano key in Customize keys included.
    const h = draw({ editMode: true })
    const user = userEvent.setup()
    const seenByApp: string[] = []
    // What the app does with Space: it uses the key press up, so that the focused button is not pressed.
    const listener = (event: KeyboardEvent): void => {
      seenByApp.push(event.code)
      if (event.code === 'Space') event.preventDefault()
    }
    window.addEventListener('keydown', listener)
    try {
      await user.tab()
      await user.tab()
      await user.keyboard('[Space]')
    } finally {
      window.removeEventListener('keydown', listener)
    }
    expect(seenByApp).toEqual(['Tab', 'Tab', 'Space'])
    expect(h.selected).toEqual([])
    expect(h.log).toEqual([])
  })

  it('selects nothing for the repeats a held Enter or Space sends', async () => {
    const h = draw({ editMode: true })
    const user = userEvent.setup()
    await user.tab()
    for (const key of ['Enter', ' ']) {
      act(() => {
        h.key(0).dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true, cancelable: true }))
      })
    }
    expect(h.selected).toEqual([])
  })

  it('leaves Enter and Space to the app once the focused key is the selected one', async () => {
    // The app then tells the user that this key cannot be used for a note.
    const h = draw({ editMode: true, selectedSlot: 0 })
    const user = userEvent.setup()
    const seenByApp: string[] = []
    const listener = (event: KeyboardEvent): void => {
      seenByApp.push(event.code)
      event.preventDefault()
    }
    window.addEventListener('keydown', listener)
    try {
      await user.tab()
      await user.keyboard('[Enter][Space]')
    } finally {
      window.removeEventListener('keydown', listener)
    }
    expect(seenByApp).toEqual(['Tab', 'Enter', 'Space'])
    expect(h.selected).toEqual([])
  })

  it('moves the selection when Enter is pressed on another key', async () => {
    const h = draw({ editMode: true, selectedSlot: 5 })
    const user = userEvent.setup()
    await user.tab()
    await user.keyboard('[Enter]')
    expect(h.selected).toEqual([0])
  })

  it('does not treat a browser shortcut (Ctrl+Enter) as a selection', async () => {
    const h = draw({ editMode: true })
    const user = userEvent.setup()
    await user.tab()
    await user.keyboard('{Control>}[Enter]{/Control}')
    expect(h.selected).toEqual([])
  })

  it('marks only the selected key as pressed, even while notes are sounding', () => {
    const h = draw({ editMode: true, selectedSlot: D4, activeNotes: new Set([60, 64]) })
    const pressed = [...h.piano.querySelectorAll('.piano-key[aria-pressed="true"]')]
    expect(pressed.map((key) => (key as HTMLElement).dataset.slot)).toEqual([String(D4)])
    expect(h.key(D4).classList.contains('is-selected')).toBe(true)
    // The sounding keys still light up for the eye.
    expect(h.key(C4).classList.contains('is-lit')).toBe(true)
    expect(h.piano.classList.contains('piano--editing')).toBe(true)
  })

  it('shows no selection outside edit mode', () => {
    const h = draw({ editMode: false, selectedSlot: D4 })
    expect(h.piano.querySelector('.is-selected')).toBeNull()
    expect(h.piano.querySelector('[aria-pressed="true"]')).toBeNull()
  })
})

// ===========================================================================

describe('what a screen reader is told', () => {
  it('presents the piano as one named group of 37 buttons', () => {
    const h = draw()
    expect(h.piano.getAttribute('role')).toBe('group')
    expect(h.piano.getAttribute('aria-label')).toBe('Piano')
    const keys = h.piano.querySelectorAll('button.piano-key')
    expect(keys).toHaveLength(SLOT_COUNT)
    expect(h.piano.querySelectorAll('.piano-key--white')).toHaveLength(22)
    expect(h.piano.querySelectorAll('.piano-key--black')).toHaveLength(15)
  })

  it('names every key by its note and its computer key, in every mode and at every position', () => {
    const keyLabels = new Map<number, string>([
      [C4, 'A'],
      [C_SHARP_4, 'W'],
      [28, ';'],
      [0, 'Num 1'],
    ])
    for (const editMode of [false, true]) {
      for (const noteNaming of NAMINGS) {
        for (const labelMode of LABEL_MODES) {
          for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
            const h = draw({ editMode, noteNaming, labelMode, baseOctave, keyLabels })
            for (let slot = 0; slot < SLOT_COUNT; slot++) {
              const name = noteName(slotToMidi(slot, baseOctave), noteNaming)
              const label = keyLabels.get(slot)
              // The computer key is named even when the labels on the keys are switched off.
              expect(h.key(slot).getAttribute('aria-label')).toBe(
                label === undefined ? name : `${name}, key ${label}`,
              )
            }
            h.unmount()
          }
        }
      }
    }
  })

  it('writes the names the spec gives as examples', () => {
    const h = draw({ keyLabels: new Map([[C4, 'A']]) })
    expect(h.key(C4).getAttribute('aria-label')).toBe('C4, key A')
    expect(h.key(D4).getAttribute('aria-label')).toBe('D4')
    h.update({ noteNaming: 'solfege' })
    expect(h.key(C4).getAttribute('aria-label')).toBe('Do4, key A')
    expect(h.key(20).getAttribute('aria-label')).toBe('Sol♯4')
  })

  it('says pressed for exactly the sounding keys while playing', () => {
    const h = draw({ activeNotes: new Set([60, 61, 84, 200]) })
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const sounding = slot === C4 || slot === C_SHARP_4 || slot === SLOT_COUNT - 1
      expect(h.key(slot).getAttribute('aria-pressed')).toBe(String(sounding))
      expect(h.key(slot).classList.contains('is-lit')).toBe(sounding)
    }
    h.update({ activeNotes: new Set() })
    expect(h.piano.querySelector('[aria-pressed="true"]')).toBeNull()
    expect(h.piano.querySelectorAll('[aria-pressed="false"]')).toHaveLength(SLOT_COUNT)
  })

  it('lights the same notes after the piano moves, on the keys that now carry them', () => {
    const h = draw({ baseOctave: 3, activeNotes: new Set([60]) })
    expect(h.key(C4).getAttribute('aria-pressed')).toBe('true')
    h.update({ baseOctave: 4 })
    expect(h.key(0).getAttribute('aria-pressed')).toBe('true')
    expect(h.key(C4).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('labels on the keys', () => {
  const keyLabels = new Map<number, string>([
    [0, 'Num 1'],
    [1, 'Num +'],
    [C4, 'A'],
    [C_SHARP_4, 'W'],
    [28, ';'],
    [29, 'ろ'],
  ])

  function capOf(key: HTMLElement): string | null {
    return key.querySelector('.piano-key__cap')?.textContent ?? null
  }

  function noteOf(key: HTMLElement): string | null {
    return key.querySelector('.piano-key__note')?.textContent ?? null
  }

  it('shows the right text on every key for every label mode and note naming', () => {
    for (const noteNaming of NAMINGS) {
      for (const labelMode of LABEL_MODES) {
        const h = draw({ labelMode, noteNaming, keyLabels })
        const showsCaps = labelMode === 'keys' || labelMode === 'both'
        const showsNotes = labelMode === 'notes' || labelMode === 'both'
        for (let slot = 0; slot < SLOT_COUNT; slot++) {
          const midi = slotToMidi(slot, 3)
          const key = h.key(slot)
          expect(capOf(key)).toBe(showsCaps ? (keyLabels.get(slot) ?? null) : null)
          // C keys carry the octave; every other key, white or black, only its pitch.
          const expectedNote = slot % 12 === 0 ? noteName(midi, noteNaming) : pitchName(midi, noteNaming)
          expect(noteOf(key)).toBe(showsNotes ? expectedNote : null)
          // Nothing else is written on a key.
          expect(key.textContent).toBe(`${capOf(key) ?? ''}${noteOf(key) ?? ''}`)
        }
        h.unmount()
      }
    }
  })

  it('writes the names the spec asks for: C4 / Do4 on C keys, the pitch elsewhere, sharps on black keys', () => {
    const h = draw({ labelMode: 'notes', noteNaming: 'letters' })
    expect(noteOf(h.key(C4))).toBe('C4')
    expect(noteOf(h.key(D4))).toBe('D')
    expect(noteOf(h.key(C_SHARP_4))).toBe('C♯')
    expect(noteOf(h.key(SLOT_COUNT - 1))).toBe('C6')
    h.update({ noteNaming: 'solfege' })
    expect(noteOf(h.key(C4))).toBe('Do4')
    expect(noteOf(h.key(D4))).toBe('Ré')
    expect(noteOf(h.key(C_SHARP_4))).toBe('Do♯')
    expect(noteOf(h.key(20))).toBe('Sol♯')
  })

  it('puts the keycap above the note name', () => {
    const h = draw({ labelMode: 'both', keyLabels })
    const labels = h.key(C4).querySelector('.piano-key__labels')
    expect([...(labels?.children ?? [])].map((child) => child.textContent)).toEqual(['A', 'C4'])
  })

  it('draws nothing at all on a key that has neither a keycap nor a note name to show', () => {
    const h = draw({ labelMode: 'keys', keyLabels })
    expect(h.key(D4).children).toHaveLength(0)
    h.update({ labelMode: 'none' })
    expect(h.piano.querySelector('.piano-key__labels')).toBeNull()
  })

  it('marks the C keys as landmarks', () => {
    const h = draw({ labelMode: 'notes' })
    const landmarks = [...h.piano.querySelectorAll('.piano-key__note--c')].map((note) => note.textContent)
    expect(landmarks).toEqual(['C3', 'C4', 'C5', 'C6'])
  })
})

describe('where the keys are drawn', () => {
  function share(value: string): number {
    expect(value.endsWith('%')).toBe(true)
    return Number.parseFloat(value) / 100
  }

  it('places every key from the shared geometry, as percentages of the piano width', () => {
    const h = draw()
    for (const rect of KEY_RECTS) {
      const key = h.key(rect.slot)
      // The simulated browser keeps six digits of a percentage, as real ones do when they print it.
      expect(share(key.style.left)).toBeCloseTo(rect.left, 6)
      expect(share(key.style.width)).toBeCloseTo(rect.width, 6)
      expect(key.classList.contains('piano-key--black')).toBe(rect.black)
    }
    // The black keys are drawn as far down as the pointer finds them.
    expect(share(h.piano.style.getPropertyValue('--piano-black-key-height'))).toBeCloseTo(BLACK_KEY_HEIGHT, 6)
  })

  it('lines every light trail up with the key it rises from, at every piano position', () => {
    const width = 1254
    for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
      const h = draw({ baseOctave })
      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        const key = h.key(slot)
        const keyLeft = share(key.style.left) * width
        const keyWidth = share(key.style.width) * width
        const bars = startBar([], slotToMidi(slot, baseOctave), baseOctave)
        expect(bars).toHaveLength(1)
        const bar = bars[0]
        if (!bar) throw new Error('no bar')
        const trail = barRect(bar, width, 160)
        // Centred on the key and never wider than it.
        expect(Math.abs(trail.x + trail.width / 2 - (keyLeft + keyWidth / 2))).toBeLessThan(0.01)
        expect(trail.x).toBeGreaterThanOrEqual(keyLeft)
        expect(trail.x + trail.width).toBeLessThanOrEqual(keyLeft + keyWidth)
        expect(bar.black).toBe(key.classList.contains('piano-key--black'))
      }
      h.unmount()
    }
  })
})
