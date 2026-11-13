// @vitest-environment jsdom
/**
 * The on-screen piano under a mouse, fingers and a pen: the real <Piano />
 * drawn in a simulated browser and driven with the same pointer events a
 * browser sends, including the ones that arrive when things go wrong (a
 * cancelled touch, a lost capture, a release that never comes).
 *
 * The simulated browser has no layout, so the piano box is given a fixed
 * place on screen: 2200 x 200 pixels, which makes every white key of a piano
 * of 37 keys 100 wide. Most tests use that piano; the ones about larger
 * pianos say so.
 */
import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCENT_COLOURS, inkOn, paletteFor, paletteForNote } from '../core/colour'
import {
  DEFAULT_BASE_OCTAVE,
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  PIANO_SIZES,
  SLOT_COUNT,
  midiToSlot,
  pianoRange,
  slotToMidi,
} from '../core/layout'
import type { PianoRange, PianoSize } from '../core/layout'
import { isBlackKey, noteName, pitchName } from '../core/notes'
import { BLACK_KEY_WIDTH_RATIO, keyRectOf, keyRects, whiteKeyCount } from '../core/pianoGeometry'
import type { AccentChoice, KeyEffect, KeyStyle, LabelMode, Midi, NoteNaming } from '../core/types'
import { Piano } from './Piano'
import type { PianoProps } from './Piano'
import { BLACK_KEY_HEIGHT } from './pianoHitTest'

const BOX = { left: 100, top: 40, width: 2200, height: 200 }
/** Halfway down the black keys, and halfway down the part of the white keys below them (shares of the piano's height). */
const UPPER_ROW = BLACK_KEY_HEIGHT / 2
const LOWER_ROW = (1 + BLACK_KEY_HEIGHT) / 2

const LABEL_MODES: readonly LabelMode[] = ['both', 'keys', 'notes', 'none']
const NAMINGS: readonly NoteNaming[] = ['letters', 'solfege']
const KEY_STYLES: readonly KeyStyle[] = ['classic', 'midnight', 'glass']
/** Glow is the effect the piano starts with; the stylesheet has a block of rules for each of the others. */
const KEY_EFFECTS: readonly KeyEffect[] = ['glow', 'press', 'edge', 'pop']

/**
 * Where the keys of a piano of 37 keys are. That piano is exactly the
 * keyboard zone, so its keys are in the same places wherever the zone is:
 * the key of slot n is the n-th of these.
 */
const ZONE_RECTS = keyRects(pianoRange(37, DEFAULT_BASE_OCTAVE))

interface Point {
  clientX: number
  clientY: number
}

/** The point across the piano where a key has its middle, at a given share of the piano's height. */
function inColumn(slot: number, heightShare: number): Point {
  const rect = ZONE_RECTS[slot]
  if (!rect) throw new Error(`no key for slot ${slot}`)
  return {
    clientX: BOX.left + (rect.left + rect.width / 2) * BOX.width,
    clientY: BOX.top + heightShare * BOX.height,
  }
}

/** A point on the visible part of a key: black keys high up, white keys below the black ones. */
function onSlot(slot: number): Point {
  return inColumn(slot, ZONE_RECTS[slot]?.black ? UPPER_ROW : LOWER_ROW)
}

/** The same for a note on a piano of any size. */
function onNote(midi: Midi, range: PianoRange): Point {
  const rect = keyRectOf(midi, range)
  if (!rect) throw new Error(`the piano has no key for note ${midi}`)
  return {
    clientX: BOX.left + (rect.left + rect.width / 2) * BOX.width,
    clientY: BOX.top + (rect.black ? UPPER_ROW : LOWER_ROW) * BOX.height,
  }
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
  /** The notes the piano shows right now. */
  range(): PianoRange
  /** The key of a slot of the keyboard zone. */
  key(slot: number): HTMLElement
  /** The key of a note, anywhere on the piano. */
  note(midi: Midi): HTMLElement
  update(changes: Partial<PianoProps>): void
  /** Gives the piano another number of keys, as the piano size setting does. */
  resize(size: PianoSize): void
  unmount(): void
}

interface DrawOptions extends Partial<PianoProps> {
  /** How many keys the piano has (37 when left out). */
  size?: PianoSize
}

/**
 * Draws the piano. As in the app, the notes it shows follow from its size and
 * from where the keyboard zone is, unless a test hands it a `range` itself.
 */
function draw(options: DrawOptions = {}, strict = false): Harness {
  const { size: firstSize = 37, ...overrides } = options
  const log: string[] = []
  const selected: number[] = []
  let size = firstSize
  /** The notes a test asked for itself, which then stay until the piano is resized. */
  let ownRange = overrides.range ?? null
  let props: PianoProps = {
    range: pianoRange(size, overrides.baseOctave ?? DEFAULT_BASE_OCTAVE),
    baseOctave: DEFAULT_BASE_OCTAVE,
    activeNotes: new Set<Midi>(),
    labelMode: 'both',
    noteNaming: 'letters',
    keyLabels: new Map<number, string>(),
    keyStyle: 'classic',
    keyEffect: 'glow',
    accent: 'red',
    customColour: ACCENT_COLOURS.red,
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

  function redraw(changes: Partial<PianoProps>): void {
    if (changes.range) ownRange = changes.range
    const range = ownRange ?? pianoRange(size, changes.baseOctave ?? props.baseOctave)
    props = { ...props, ...changes, range }
    view.rerender(element())
  }

  return {
    piano,
    log,
    selected,
    range: () => props.range,
    key(slot) {
      const key = piano.querySelector<HTMLElement>(`.piano-key[data-slot="${slot}"]`)
      if (!key) throw new Error(`no key element for slot ${slot}`)
      return key
    },
    note(midi) {
      const key = piano.querySelector<HTMLElement>(`.piano-key[data-midi="${midi}"]`)
      if (!key) throw new Error(`no key element for note ${midi}`)
      return key
    },
    update: redraw,
    resize(newSize) {
      size = newSize
      ownRange = null
      redraw({})
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

// Keys of the keyboard zone, by slot, named for the notes they play while the zone is where it starts out.
const C4 = 12
const C_SHARP_4 = 13
const D4 = 14
const E4 = 16
const F4 = 17
const G4 = 19
const A4 = 21
const C5 = 24

/** What the piano reports when these notes are played one after the other, each released before the next. */
function inTurn(notes: readonly number[]): string[] {
  return notes.flatMap((midi) => [`down ${midi}`, `up ${midi}`])
}

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

  it.each(PIANO_SIZES)('finds every key of a piano of %i keys, wherever the keyboard zone is', (size) => {
    for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
      const h = draw({ size, baseOctave })
      const mouse = new Pointer(h)
      const notes = keyRects(h.range()).map((rect) => rect.midi)
      expect(notes).toHaveLength(size)
      for (const midi of notes) mouse.down(onNote(midi, h.range())).up()
      expect(h.log).toEqual(inTurn(notes))
      h.unmount()
    }
  })

  it('plays the full piano from its lowest A to its highest C', () => {
    const h = draw({ size: 88 })
    const mouse = new Pointer(h)
    // The far left and the far right of the box, in the upper and in the lower part.
    for (const heightShare of [UPPER_ROW, LOWER_ROW]) {
      const clientY = BOX.top + heightShare * BOX.height
      mouse.down({ clientX: BOX.left + 1, clientY }).up()
      mouse.down({ clientX: BOX.left + BOX.width - 1, clientY }).up()
    }
    expect(h.log).toEqual(inTurn([21, 108, 21, 108]))
  })

  it('plays the keys outside the keyboard zone like the others', () => {
    const h = draw({ size: 61, keyLabels: new Map([[0, 'Z']]) })
    const range = h.range()
    expect(midiToSlot(range.first, DEFAULT_BASE_OCTAVE)).toBeNull()
    expect(midiToSlot(range.last, DEFAULT_BASE_OCTAVE)).toBeNull()
    const mouse = new Pointer(h)
    mouse.down(onNote(range.first, range)).up()
    mouse.down(onNote(range.last, range)).up()
    expect(h.log).toEqual(inTurn([range.first, range.last]))
  })

  it('plays the white key when the pointer is below a black key, and the black key above', () => {
    const h = draw()
    const cSharp = ZONE_RECTS[C_SHARP_4]
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
    // A new look is not a new piano.
    h.update({ keyStyle: 'glass', accent: 'rainbow' })
    h.update({ accent: 'custom', customColour: '#00c2a8' })
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

  it('misses no key of the full piano in one sweep from end to end', () => {
    const h = draw({ size: 88 })
    const range = h.range()
    const notes = keyRects(range).map((rect) => rect.midi)
    const mouse = new Pointer(h)
    const y = BOX.top + UPPER_ROW * BOX.height
    // Pressed on the lowest key; the next position the browser reports is on the highest.
    mouse.down({ clientX: BOX.left + 1, clientY: y }).move({ clientX: BOX.left + BOX.width - 1, clientY: y })
    mouse.up()
    expect(h.log).toEqual(inTurn(notes))
    // The same along the lower part of the piano, where only the white keys are.
    h.log.length = 0
    const low = BOX.top + LOWER_ROW * BOX.height
    mouse.down({ clientX: BOX.left + BOX.width - 1, clientY: low }).move({ clientX: BOX.left + 1, clientY: low })
    mouse.up()
    expect(h.log).toEqual(inTurn(notes.filter((midi) => !isBlackKey(midi)).toReversed()))
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
      switch (random(17)) {
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
        case 15:
          h.resize(PIANO_SIZES[random(PIANO_SIZES.length)] as PianoSize)
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

  it('stops the note when the piano gets another number of keys', () => {
    const h = draw({ size: 88 })
    const held = onNote(60, h.range())
    const mouse = new Pointer(h).down(held)
    h.resize(61)
    expect(h.log).toEqual(['down 60', 'up 60'])
    // The button is still down: it plays nothing more until it is pressed again.
    mouse.move({ clientX: held.clientX + 300, clientY: held.clientY })
    expect(h.log).toEqual(['down 60', 'up 60'])
    mouse.up()
    // The same spot is another key on the smaller piano.
    const there = keyRects(h.range()).find((rect) => {
      const x = (held.clientX - BOX.left) / BOX.width
      return !rect.black && x >= rect.left && x < rect.left + rect.width
    })
    mouse.down(held).up()
    expect(there?.midi).not.toBe(60)
    expect(h.log.slice(2)).toEqual(inTurn([there?.midi ?? -1]))
  })

  it('stops the note when the keyboard zone moves under a piano that stays as it is', () => {
    const h = draw({ size: 88, baseOctave: 3 })
    const before = h.range()
    const mouse = new Pointer(h).down(onNote(60, before))
    h.update({ baseOctave: 4 })
    // The full piano shows the same notes wherever the zone is.
    expect(h.range()).toEqual(before)
    expect(h.log).toEqual(['down 60', 'up 60'])
    mouse.up()
    mouse.down(onNote(60, before)).up()
    expect(h.log).toEqual(['down 60', 'up 60', 'down 60', 'up 60'])
  })

  it('keeps the note when the piano is handed the same notes again as a new object', () => {
    const h = draw({ size: 88 })
    const { first, last } = h.range()
    const mouse = new Pointer(h).down(onNote(60, h.range()))
    h.update({ range: { first, last } })
    h.update({ range: { first, last } })
    expect(h.log).toEqual(['down 60'])
    mouse.up()
    expect(h.log).toEqual(['down 60', 'up 60'])
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
    h.resize(88)
    expect(h.piano.querySelectorAll('.piano-key[tabindex="-1"]')).toHaveLength(88)
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

describe('Customize keys on a piano with more keys than the keyboard zone', () => {
  it('selects only keys of the keyboard zone', async () => {
    const h = draw({ size: 88, editMode: true })
    const user = userEvent.setup()
    // C3 and C6 are the ends of the zone; B2 and C♯6 lie just outside it.
    await user.click(h.note(47))
    await user.click(h.note(48))
    await user.click(h.note(84))
    await user.click(h.note(85))
    await user.click(h.note(21))
    expect(h.selected).toEqual([0, SLOT_COUNT - 1])
    expect(h.log).toEqual([])
  })

  it('follows the zone when it moves', async () => {
    const h = draw({ size: 88, editMode: true, baseOctave: 4 })
    const user = userEvent.setup()
    await user.click(h.note(48))
    await user.click(h.note(59))
    await user.click(h.note(60))
    await user.click(h.note(96))
    await user.click(h.note(97))
    expect(h.selected).toEqual([0, SLOT_COUNT - 1])
  })

  it('lets Tab reach the keys of the zone, lowest first, and no others', async () => {
    const h = draw({ size: 61, editMode: true })
    const user = userEvent.setup()
    const visited: (string | undefined)[] = []
    for (let i = 0; i < SLOT_COUNT; i++) {
      await user.tab()
      const focused = document.activeElement as HTMLElement
      expect(h.piano.contains(focused)).toBe(true)
      visited.push(focused.dataset.slot)
    }
    expect(visited).toEqual(Array.from({ length: SLOT_COUNT }, (_, slot) => String(slot)))
    // One more Tab leaves the piano: no key outside the zone takes the focus.
    await user.tab()
    expect(h.piano.contains(document.activeElement)).toBe(false)
  })

  it('tells a screen reader which keys are out of reach, only while customizing', () => {
    const h = draw({ size: 49, editMode: true })
    for (const rect of keyRects(h.range())) {
      const inZone = midiToSlot(rect.midi, DEFAULT_BASE_OCTAVE) !== null
      const key = h.note(rect.midi)
      expect(key.getAttribute('aria-disabled')).toBe(inZone ? null : 'true')
      expect(key.getAttribute('tabindex')).toBe(inZone ? '0' : '-1')
    }
    expect(h.piano.querySelectorAll('[aria-disabled="true"]')).toHaveLength(49 - SLOT_COUNT)
    h.update({ editMode: false })
    expect(h.piano.querySelector('[aria-disabled]')).toBeNull()
  })

  it('selects nothing with Enter on a key outside the zone, and leaves that key press to the app', async () => {
    const h = draw({ size: 88, editMode: true })
    const user = userEvent.setup()
    const seenByApp: string[] = []
    const listener = (event: KeyboardEvent): void => {
      seenByApp.push(event.code)
    }
    window.addEventListener('keydown', listener)
    try {
      // Tab does not stop on such a key, but other tools can still put the focus there.
      h.note(30).focus()
      expect(document.activeElement).toBe(h.note(30))
      await user.keyboard('[Enter]')
    } finally {
      window.removeEventListener('keydown', listener)
    }
    expect(seenByApp).toEqual(['Enter'])
    expect(h.selected).toEqual([])
  })

  it('highlights the selected slot on the key that carries it, wherever the zone is', () => {
    const h = draw({ size: 88, editMode: true, selectedSlot: 0 })
    expect(h.note(48).classList.contains('is-selected')).toBe(true)
    expect(h.note(48).getAttribute('aria-pressed')).toBe('true')
    h.update({ baseOctave: 2 })
    expect(h.note(48).classList.contains('is-selected')).toBe(false)
    expect(h.note(36).classList.contains('is-selected')).toBe(true)
    expect(h.piano.querySelectorAll('.is-selected')).toHaveLength(1)
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

  it.each([
    [88, 52, 36],
    [61, 36, 25],
    [49, 29, 20],
    [37, 22, 15],
  ] as const)('draws a piano of %i keys as %i white and %i black buttons', (size, white, black) => {
    const h = draw({ size })
    expect(h.piano.querySelectorAll('button.piano-key')).toHaveLength(size)
    expect(h.piano.querySelectorAll('.piano-key--white')).toHaveLength(white)
    expect(h.piano.querySelectorAll('.piano-key--black')).toHaveLength(black)
  })

  it('names the keys outside the keyboard zone by their note alone', () => {
    const keyLabels = new Map<number, string>([
      [0, 'Z'],
      [SLOT_COUNT - 1, 'I'],
    ])
    const h = draw({ size: 88, keyLabels })
    expect(h.note(21).getAttribute('aria-label')).toBe('A0')
    expect(h.note(47).getAttribute('aria-label')).toBe('B2')
    expect(h.note(48).getAttribute('aria-label')).toBe('C3, key Z')
    expect(h.note(84).getAttribute('aria-label')).toBe('C6, key I')
    expect(h.note(85).getAttribute('aria-label')).toBe('C♯6')
    expect(h.note(108).getAttribute('aria-label')).toBe('C8')
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

  it('says pressed for sounding keys outside the keyboard zone too', () => {
    const h = draw({ size: 88, activeNotes: new Set([21, 60, 108]) })
    const pressed = [...h.piano.querySelectorAll<HTMLElement>('.piano-key[aria-pressed="true"]')]
    expect(pressed.map((key) => key.dataset.midi)).toEqual(['21', '60', '108'])
    expect(pressed.every((key) => key.classList.contains('is-lit'))).toBe(true)
    expect(h.piano.querySelectorAll('.is-lit')).toHaveLength(3)
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
    h.resize(88)
    const onFullPiano = [...h.piano.querySelectorAll('.piano-key__note--c')].map((note) => note.textContent)
    expect(onFullPiano).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'])
  })

  it('writes keycaps only inside the keyboard zone, and note names on every key', () => {
    const h = draw({ size: 88, labelMode: 'both', keyLabels })
    for (const rect of keyRects(h.range())) {
      const slot = midiToSlot(rect.midi, DEFAULT_BASE_OCTAVE)
      const key = h.note(rect.midi)
      expect(key.dataset.slot).toBe(slot === null ? undefined : String(slot))
      expect(capOf(key)).toBe(slot === null ? null : (keyLabels.get(slot) ?? null))
      expect(noteOf(key)).toBe(rect.midi % 12 === 0 ? noteName(rect.midi) : pitchName(rect.midi))
    }
    expect(noteOf(h.note(21))).toBe('A')
    expect(noteOf(h.note(108))).toBe('C8')
  })

  it('moves the keycaps with the keyboard zone', () => {
    const h = draw({ size: 88, labelMode: 'keys', keyLabels })
    expect(capOf(h.note(60))).toBe('A')
    h.update({ baseOctave: 2 })
    expect(capOf(h.note(60))).toBeNull()
    expect(capOf(h.note(48))).toBe('A')
  })

  it('tells the stylesheet how many characters each label has to fit across its key', () => {
    const h = draw({ labelMode: 'both', noteNaming: 'solfege', keyLabels })
    const chars = (key: HTMLElement, label: 'cap' | 'note'): string => {
      const element = key.querySelector<HTMLElement>(`.piano-key__${label}`)
      if (!element) throw new Error(`the key has no ${label}`)
      return element.style.getPropertyValue('--label-chars')
    }
    // "Num 1" is written on two lines, so its longest word is what has to fit.
    expect(chars(h.key(0), 'cap')).toBe('3')
    expect(chars(h.key(1), 'cap')).toBe('3')
    // One character needs no shrinking, even a wide one.
    expect(chars(h.key(C4), 'cap')).toBe('')
    expect(chars(h.key(29), 'cap')).toBe('')
    // Do3, Ré, Sol♯.
    expect(chars(h.key(0), 'note')).toBe('3')
    expect(chars(h.key(2), 'note')).toBe('2')
    expect(chars(h.key(8), 'note')).toBe('4')
    h.update({ noteNaming: 'letters' })
    // C3, D (one letter, nothing to say), G♯.
    expect(chars(h.key(0), 'note')).toBe('2')
    expect(chars(h.key(2), 'note')).toBe('')
    expect(chars(h.key(8), 'note')).toBe('2')
  })

  it('marks keycaps of more than one character as small print', () => {
    const h = draw({ labelMode: 'keys', keyLabels })
    const isLong = (slot: number): boolean | undefined =>
      h.key(slot).querySelector('.piano-key__cap')?.classList.contains('piano-key__cap--long')
    expect(isLong(0)).toBe(true)
    expect(isLong(1)).toBe(true)
    expect(isLong(C4)).toBe(false)
    expect(isLong(28)).toBe(false)
  })
})

describe('where the keys are drawn', () => {
  function share(value: string): number {
    expect(value.endsWith('%')).toBe(true)
    return Number.parseFloat(value) / 100
  }

  // The light above the piano (rising bars, falling notes, sparks) is placed
  // with the same `keyRects`, so a key drawn from them sits right under its light.
  it.each(PIANO_SIZES)(
    'places every key of a piano of %i keys from the shared geometry, as percentages of the piano width',
    (size) => {
      for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
        const h = draw({ size, baseOctave })
        const rects = keyRects(h.range())
        expect(h.piano.querySelectorAll('.piano-key')).toHaveLength(rects.length)
        for (const rect of rects) {
          const key = h.note(rect.midi)
          // The simulated browser keeps six digits of a percentage, as real ones do when they print it.
          expect(share(key.style.left)).toBeCloseTo(rect.left, 6)
          expect(share(key.style.width)).toBeCloseTo(rect.width, 6)
          expect(key.classList.contains('piano-key--black')).toBe(rect.black)
        }
        h.unmount()
      }
    },
  )

  it('draws the keys in the order of their notes, lowest first', () => {
    for (const size of PIANO_SIZES) {
      const h = draw({ size })
      const drawn = [...h.piano.querySelectorAll<HTMLElement>('.piano-key')].map((key) => Number(key.dataset.midi))
      expect(drawn).toEqual(keyRects(h.range()).map((rect) => rect.midi))
      h.unmount()
    }
  })

  it('redraws the keys of the new notes when the piano changes size', () => {
    const h = draw({ size: 88 })
    expect(h.note(21)).toBeDefined()
    h.resize(49)
    const { first, last } = h.range()
    const drawn = [...h.piano.querySelectorAll<HTMLElement>('.piano-key')].map((key) => Number(key.dataset.midi))
    expect(drawn).toEqual(Array.from({ length: 49 }, (_, index) => first + index))
    expect(drawn.at(-1)).toBe(last)
    expect(share(h.note(first).style.left)).toBe(0)
  })

  it('tells the stylesheet the sizes it draws with', () => {
    for (const size of PIANO_SIZES) {
      const h = draw({ size })
      const { style } = h.piano
      // The black keys are drawn as far down as the pointer finds them, and as wide as the shared geometry makes them.
      expect(share(style.getPropertyValue('--piano-black-key-height'))).toBeCloseTo(BLACK_KEY_HEIGHT, 6)
      expect(Number(style.getPropertyValue('--piano-black-key-width'))).toBe(BLACK_KEY_WIDTH_RATIO)
      // Every other size follows from the width of one white key.
      expect(Number(style.getPropertyValue('--piano-white-keys'))).toBe(whiteKeyCount(h.range()))
      h.unmount()
    }
  })

  it('can be drawn as text, with no page to measure or listen to', () => {
    // The app is drawn this way to check that it loads without a browser.
    const html = renderToString(
      <Piano
        range={pianoRange(88, DEFAULT_BASE_OCTAVE)}
        baseOctave={DEFAULT_BASE_OCTAVE}
        activeNotes={new Set([60])}
        labelMode="both"
        noteNaming="letters"
        keyLabels={new Map([[C4, 'A']])}
        keyStyle="glass"
        keyEffect="glow"
        accent="rainbow"
        customColour={ACCENT_COLOURS.red}
        onNoteDown={() => {}}
        onNoteUp={() => {}}
      />,
    )
    expect(html.match(/class="piano-key /g)).toHaveLength(88)
    expect(html).toContain('data-key-style="glass"')
    expect(html).toContain('class="piano__zone"')
    expect(html).toContain(`--key-light:${paletteForNote(60, 'rainbow', '').light}`)
  })
})

describe('the line that marks the keyboard zone', () => {
  function share(value: string): number {
    expect(value.endsWith('%')).toBe(true)
    return Number.parseFloat(value) / 100
  }

  function zoneLine(h: Harness): HTMLElement | null {
    return h.piano.querySelector<HTMLElement>('.piano__zone')
  }

  it('is not drawn on a piano that is exactly the zone', () => {
    for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
      const h = draw({ size: 37, baseOctave })
      expect(zoneLine(h)).toBeNull()
      h.unmount()
    }
  })

  it.each([88, 61, 49] as const)(
    'runs from the first to the last key of the zone on a piano of %i keys, wherever the zone is',
    (size) => {
      for (let baseOctave = MIN_BASE_OCTAVE; baseOctave <= MAX_BASE_OCTAVE; baseOctave++) {
        const h = draw({ size, baseOctave })
        const line = zoneLine(h)
        const first = keyRectOf(slotToMidi(0, baseOctave), h.range())
        const last = keyRectOf(slotToMidi(SLOT_COUNT - 1, baseOctave), h.range())
        if (!line || !first || !last) throw new Error('the zone is not on the piano')
        expect(share(line.style.left)).toBeCloseTo(first.left, 6)
        // (Two printed percentages added up: one digit less to go by.)
        expect(share(line.style.left) + share(line.style.width)).toBeCloseTo(last.left + last.width, 5)
        // It is decoration: the keys themselves say what they are.
        expect(line.getAttribute('aria-hidden')).toBe('true')
        expect(line.textContent).toBe('')
        h.unmount()
      }
    },
  )

  it('follows the zone when it moves, and goes when the piano shrinks to the zone', () => {
    const h = draw({ size: 88, baseOctave: 3 })
    const before = zoneLine(h)?.style.left
    h.update({ baseOctave: 4 })
    const after = zoneLine(h)?.style.left
    expect(before).toBeDefined()
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
    h.resize(37)
    expect(zoneLine(h)).toBeNull()
    h.resize(49)
    expect(zoneLine(h)).not.toBeNull()
  })

  it('is not a key: it plays nothing and selects nothing', async () => {
    const h = draw({ size: 88, editMode: true })
    const line = zoneLine(h)
    if (!line) throw new Error('the zone line was not drawn')
    const user = userEvent.setup()
    await user.click(line)
    expect(h.selected).toEqual([])
    expect(h.piano.querySelectorAll('.piano-key')).toHaveLength(88)
    expect(line.matches('.piano-key, button')).toBe(false)
  })
})

describe('the look of the keys', () => {
  const ACCENTS: readonly AccentChoice[] = ['red', 'amber', 'blue', 'green', 'purple', 'white', 'custom', 'rainbow']
  const OWN_COLOUR = '#00c2a8'

  /** The colours a key carries for the stylesheet. */
  function lightOf(key: HTMLElement): { light: string; bright: string; ink: string } {
    return {
      light: key.style.getPropertyValue('--key-light'),
      bright: key.style.getPropertyValue('--key-light-bright'),
      ink: key.style.getPropertyValue('--key-light-ink'),
    }
  }

  it('names the key style for the stylesheet', () => {
    for (const keyStyle of KEY_STYLES) {
      const h = draw({ keyStyle })
      expect(h.piano.dataset.keyStyle).toBe(keyStyle)
      h.unmount()
    }
    const h = draw()
    h.update({ keyStyle: 'midnight' })
    expect(h.piano.dataset.keyStyle).toBe('midnight')
  })

  it('names the key effect for the stylesheet, and changes it at once', () => {
    for (const keyEffect of KEY_EFFECTS) {
      const h = draw({ keyEffect })
      expect(h.piano.dataset.keyEffect).toBe(keyEffect)
      h.unmount()
    }
    const h = draw({ activeNotes: new Set([60]) })
    h.update({ keyEffect: 'edge' })
    expect(h.piano.dataset.keyEffect).toBe('edge')
    // The effect is the stylesheet's business alone: a played key is marked the same way in all of them.
    expect(h.key(C4).classList.contains('is-lit')).toBe(true)
  })

  it('draws the same keys, labels and states with every key effect', () => {
    const keyLabels = new Map<number, string>([[C4, 'A']])
    const drawn = KEY_EFFECTS.map((keyEffect) => {
      const h = draw({ keyEffect, keyLabels, activeNotes: new Set([60, 61]) })
      const html = h.piano.innerHTML
      h.unmount()
      return html
    })
    expect(new Set(drawn).size).toBe(1)
  })

  it('draws the same keys, labels and states in every key style', () => {
    const keyLabels = new Map<number, string>([[C4, 'A']])
    const drawn = KEY_STYLES.map((keyStyle) => {
      const h = draw({ keyStyle, keyLabels, activeNotes: new Set([60]), editMode: true, selectedSlot: D4 })
      const html = h.piano.innerHTML
      h.unmount()
      return html
    })
    expect(drawn[1]).toBe(drawn[0])
    expect(drawn[2]).toBe(drawn[0])
  })

  it('lights a played key in the colour of the light', () => {
    const h = draw({ accent: 'blue', activeNotes: new Set([60, 61]) })
    const palette = paletteFor('blue', OWN_COLOUR)
    expect(palette.light).toBe(ACCENT_COLOURS.blue)
    for (const key of [h.key(C4), h.key(C_SHARP_4)]) {
      expect(key.classList.contains('is-lit')).toBe(true)
      expect(lightOf(key)).toEqual({ light: palette.light, bright: palette.bright, ink: inkOn(palette.light) })
    }
  })

  it.each(ACCENTS)('gives every key the palette of its note with the %s light', (accent) => {
    const h = draw({ size: 88, accent, customColour: OWN_COLOUR, activeNotes: new Set([21, 60, 61, 108]) })
    for (const rect of keyRects(h.range())) {
      const palette = paletteForNote(rect.midi, accent, OWN_COLOUR)
      expect(lightOf(h.note(rect.midi))).toEqual({
        light: palette.light,
        bright: palette.bright,
        ink: inkOn(palette.light),
      })
    }
  })

  it('gives every note its own colour with the rainbow, the same in every octave', () => {
    const h = draw({ size: 88, accent: 'rainbow', activeNotes: new Set([60, 68]) })
    // C is red; G♯ is the deep blue on which only white can be read.
    expect(lightOf(h.note(60))).toMatchObject({ light: '#ff3333', ink: '#000000' })
    expect(lightOf(h.note(68))).toMatchObject({ light: '#3333ff', ink: '#ffffff' })
    const notes = keyRects(h.range()).map((rect) => rect.midi)
    expect(new Set(notes.map((midi) => lightOf(h.note(midi)).light)).size).toBe(12)
    for (const midi of notes.filter((note) => note + 12 <= h.range().last)) {
      expect(lightOf(h.note(midi + 12))).toEqual(lightOf(h.note(midi)))
    }
  })

  it("follows the player's own colour as it changes", () => {
    const h = draw({ accent: 'custom', customColour: OWN_COLOUR, activeNotes: new Set([60]) })
    expect(lightOf(h.key(C4)).light).toBe(OWN_COLOUR)
    h.update({ customColour: '#ffd000' })
    expect(lightOf(h.key(C4)).light).toBe('#ffd000')
    // Something that is not a colour falls back on the default light instead of breaking the keys.
    h.update({ customColour: 'not a colour' })
    expect(lightOf(h.key(C4)).light).toBe(ACCENT_COLOURS.red)
  })

  it('leaves its colour on a key that was just released, for the afterglow', () => {
    const h = draw({ accent: 'rainbow', activeNotes: new Set([64]) })
    const whileLit = lightOf(h.key(E4))
    h.update({ activeNotes: new Set() })
    expect(h.key(E4).classList.contains('is-lit')).toBe(false)
    expect(lightOf(h.key(E4))).toEqual(whileLit)
    expect(whileLit.light).toBe(paletteForNote(64, 'rainbow', '').light)
  })
})

// ===========================================================================

/*
 * A code review of piano.css written down as checks: the numbers and the
 * rules that the look depends on, read from the stylesheet itself. There is
 * no layout engine here, so how it all looks can only be seen in a browser.
 */

interface NodeFiles {
  readFileSync(path: string, encoding: 'utf8'): string
}

interface NodeUrls {
  fileURLToPath(url: string): string
}

// The test runner empties stylesheets that are imported, so the file is read
// from disk, next to this one. (Node's own modules are loaded this way because
// the project has no Node type definitions.)
const nodeFilesModule = 'node:fs'
const nodeUrlsModule = 'node:url'
const { readFileSync } = (await import(/* @vite-ignore */ nodeFilesModule)) as NodeFiles
const { fileURLToPath } = (await import(/* @vite-ignore */ nodeUrlsModule)) as NodeUrls
const pianoCssPath = fileURLToPath(import.meta.url.replace(/[^/]*$/, 'piano.css'))

/** The stylesheet without its comments. */
const pianoCss = readFileSync(pianoCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

interface StyleRule {
  /** Each selector of the rule, with single spaces. */
  selectors: string[]
  declarations: string
}

/** Every rule of the stylesheet, including those inside @media. */
function styleRules(): StyleRule[] {
  return [...pianoCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(/,(?![^(]*\))/).map((part) => part.trim().replace(/\s+/g, ' ')),
    declarations: match[2] ?? '',
  }))
}

/** The declarations of every rule whose selector is exactly `selector`, one after the other. */
function styleRule(selector: string): string {
  const declarations = styleRules()
    .filter(({ selectors }) => selectors.includes(selector))
    .map((found) => found.declarations)
  if (declarations.length === 0) throw new Error(`The stylesheet has no rule for "${selector}"`)
  return declarations.join(';')
}

/** The value of one property in a rule, with single spaces, or null when the rule does not set it. */
function declared(selector: string, property: string): string | null {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(styleRule(selector))
  return found?.[1]?.trim().replace(/\s+/g, ' ') ?? null
}

function styleValue(selector: string, property: string): string {
  const found = declared(selector, property)
  if (found === null) throw new Error(`"${selector}" does not set ${property}`)
  return found
}

describe('what the stylesheet promises', () => {
  it('writes out no colour of its own: every one comes from the theme or from the key', () => {
    expect(pianoCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(pianoCss).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i)
    // No colour by name either, except see-through.
    const values = styleRules().flatMap(({ declarations }) =>
      declarations.split(';').map((declaration) => declaration.slice(declaration.indexOf(':') + 1)),
    )
    const named = /(?<![-\w])(?:black|white|red|green|blue|gr[ae]y|silver|ivory|gold|orange|yellow|purple|pink)(?![-\w(])/i
    expect(values.filter((value) => named.test(value))).toEqual([])
  })

  it('has one block of variables for each key style, and nothing but variables in them', () => {
    const names = [
      '--piano-white-fill',
      '--piano-white-edge',
      '--piano-white-cap-fill',
      '--piano-white-cap-ink',
      '--piano-white-note-ink',
      '--piano-white-landmark-ink',
      '--piano-black-fill',
      '--piano-black-edge',
      '--piano-black-cap-fill',
      '--piano-black-cap-ink',
      '--piano-black-note-ink',
    ]
    for (const keyStyle of KEY_STYLES) {
      // Classic is the piano's own block, so a style the stylesheet does not know still draws a piano.
      const selector = keyStyle === 'classic' ? '.piano' : `.piano[data-key-style='${keyStyle}']`
      for (const name of names) {
        expect(declared(selector, name), `${keyStyle} sets ${name}`).not.toBeNull()
      }
      if (keyStyle === 'classic') continue
      const properties = styleRule(selector)
        .split(';')
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration !== '')
      expect(properties.filter((declaration) => !declaration.startsWith('--'))).toEqual([])
    }
    // No rule draws a key differently for one style: the variables are all there is.
    const perStyle = styleRules().flatMap(({ selectors }) => selectors.filter((selector) => selector.includes('data-key-style')))
    expect(perStyle.sort()).toEqual([".piano[data-key-style='glass']", ".piano[data-key-style='midnight']"])
  })

  it('sizes the piano itself: as wide as its parent, keys 5.5 times as long as wide, between 110px and 34% of the window', () => {
    expect(styleValue('.piano', 'width')).toBe('100%')
    expect(styleValue('.piano', 'aspect-ratio')).toBe('var(--piano-white-keys) / 5.5')
    expect(styleValue('.piano', 'min-height')).toBe('110px')
    expect(styleValue('.piano', 'max-height')).toBe('34dvh')
    expect(styleValue('.piano', '--piano-key-width')).toBe('calc(100cqw / var(--piano-white-keys))')
    expect(styleValue('.piano', 'container-type')).toBe('inline-size')
  })

  it('draws no box around the piano and never shifts the keys sideways', () => {
    const unwanted = ['border', 'border-radius', 'padding', 'margin', 'background', 'box-shadow', 'outline', 'overflow']
    for (const property of unwanted) {
      expect(declared('.piano', property), property).toBeNull()
    }
  })

  it('draws the black keys as far down as the pointer finds them', () => {
    expect(styleValue('.piano-key--black', 'height')).toBe('var(--piano-black-key-height)')
    expect(styleValue('.piano-key--white', 'height')).toBe('100%')
  })

  it('tilts a played key around its far end, on a spring: quickly down, a little softer back up', () => {
    expect(styleValue('.piano-key', 'transform-origin')).toBe('top')
    expect(styleValue('.piano-key.is-lit', 'transform')).toMatch(/^perspective\(\d+px\) rotateX\(-\d+deg\)$/)
    // Both ways the key goes a little past where it is going and settles: a curve that rises above 1.
    const springBack = /^transform (\d+)ms cubic-bezier\(0\.\d+, (\d\.\d+), 0\.\d+, 1\),/.exec(styleValue('.piano-key', 'transition'))
    const springDown = /^cubic-bezier\(0\.\d+, (\d\.\d+), 0\.\d+, 1\), ease-out, linear$/.exec(
      styleValue('.piano-key.is-lit', 'transition-timing-function'),
    )
    expect(Number(springBack?.[2])).toBeGreaterThan(1)
    expect(Number(springDown?.[1])).toBeGreaterThan(1)
    const down = Number(/^(\d+)ms,/.exec(styleValue('.piano-key.is-lit', 'transition-duration'))?.[1])
    expect(down).toBeLessThanOrEqual(120)
    expect(Number(springBack?.[1])).toBeGreaterThan(down)
  })

  it('lets the light of a released key fade out over a quarter of a second, with the key still in front', () => {
    for (const layer of ['.piano-key::before', '.piano-key::after']) {
      expect(styleValue(layer, 'transition')).toBe('opacity 250ms ease-out')
      expect(styleValue(layer, 'opacity')).toBe('0')
    }
    expect(styleValue('.piano-key.is-lit::before', 'opacity')).toBe('1')
    expect(styleValue('.piano-key.is-lit::after', 'transition-duration')).toBe('50ms')
    expect(styleValue('.piano-key', 'transition')).toContain('z-index 0s linear 250ms')
    expect(styleValue('.piano-key.is-lit', 'transition-delay')).toBe('0s')
  })

  /*
   * The two checks below keep a key press cheap. Measured in Firefox on a
   * screen that shows 144 pictures a second, with the full piano: before
   * them, a run of quick notes showed about 75 pictures a second, and 144
   * with them. Firefox paints the whole piano again whenever anything on it
   * changes, so what counts is how much one painting costs and how often it
   * is asked for.
   */

  it('blends in plain sRGB every gradient that is drawn on all the keys, so that painting the piano stays cheap', () => {
    // A gradient with a color-mix() in it is blended in Oklab unless it says otherwise, and Firefox
    // then works out every step of every such gradient again, for every key, each time it paints.
    const drawnOnEveryKey = [styleValue('.piano::after', 'background')]
    for (const keyStyle of KEY_STYLES) {
      const selector = keyStyle === 'classic' ? '.piano' : `.piano[data-key-style='${keyStyle}']`
      drawnOnEveryKey.push(styleValue(selector, '--piano-white-fill'), styleValue(selector, '--piano-black-fill'))
    }
    const mixed = drawnOnEveryKey
      .flatMap((value) => value.split('linear-gradient(').slice(1))
      .filter((gradient) => gradient.includes('color-mix('))
    // Classic: two layers of a white key, three of a black key. And the wash of light over the keys.
    expect(mixed.length).toBeGreaterThanOrEqual(6)
    for (const gradient of mixed) {
      expect(gradient).toMatch(/^ ?to (?:top|right|bottom|left) in srgb,/)
    }
    // No other kind of gradient on the keys: this check would not see it.
    expect(drawnOnEveryKey.join(' ')).not.toMatch(/(?:radial|conic)-gradient\(/)
  })

  it('changes the colours of the labels in one step: nothing on a key is painted again for every frame of a fade', () => {
    // After a release the labels wait until the light is about half gone; a struck key takes its colours at once.
    expect(styleValue('.piano-key__cap', 'transition')).toBe('background-color 0s linear 90ms, color 0s linear 90ms')
    expect(styleValue('.piano-key__note', 'transition')).toBe('color 0s linear 90ms')
    const struck = '.piano-key.is-lit .piano-key__cap'
    expect(styleValue(struck, 'transition-delay')).toBe('0s')
    expect(declared(struck, 'transition-duration')).toBeNull()
    expect(declared(struck, 'transition')).toBeNull()

    // In the whole stylesheet, only what a browser can move without painting
    // again changes little by little: the tilt and the light of a key. (The
    // dimming of the keys that cannot be chosen happens once, when customizing
    // starts, not on a note.)
    const gradual = styleRules().flatMap(({ declarations }) => {
      const transition = /(?:^|;)\s*transition\s*:\s*([^;]+)/.exec(declarations)?.[1] ?? ''
      return transition
        // At the commas between two transitions, not at the ones inside a timing curve.
        .split(/,(?![^(]*\))/)
        .map((part) => part.trim().split(/\s+/))
        .filter(([property, duration]) => property !== undefined && property !== '' && duration !== '0s')
        .map(([property]) => property)
    })
    expect([...new Set(gradual)].sort()).toEqual(['filter', 'opacity', 'transform'])
  })

  describe('for the key effects', () => {
    const OTHER_EFFECTS = KEY_EFFECTS.filter((effect) => effect !== 'glow')
    /** The selectors of every rule that is written for one effect (or for several). */
    const effectSelectors = styleRules().flatMap(({ selectors }) =>
      selectors.filter((selector) => selector.includes('data-key-effect')),
    )

    it('has rules for each effect but Glow, which is the piano as it is without any', () => {
      for (const effect of OTHER_EFFECTS) {
        const own = effectSelectors.filter((selector) => selector.includes(`[data-key-effect='${effect}']`))
        expect(own.length, effect).toBeGreaterThan(0)
        // Something of the effect shows on a key that is played.
        expect(own.some((selector) => selector.includes('.piano-key')), effect).toBe(true)
      }
      expect(effectSelectors.filter((selector) => selector.includes("'glow'"))).toEqual([])
      // No effect the settings do not know.
      const named = effectSelectors.flatMap((selector) => [...selector.matchAll(/data-key-effect='(\w+)'/g)].map((found) => found[1]))
      expect([...new Set(named)].sort()).toEqual([...OTHER_EFFECTS].sort())
    })

    it('keeps every effect rule as weak as the rules of the piano, so that the selected key still wins', () => {
      for (const selector of effectSelectors) {
        expect(selector, selector).toMatch(/^:where\(/)
      }
    })

    it('moves only what a browser can move without painting the piano again', () => {
      // Each step of an animation sets nothing but the tilt, the stretch or the strength of a layer.
      const frames = [...pianoCss.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)]
      expect(frames.map((found) => found[1]).sort()).toEqual(['piano-flash', 'piano-pop'])
      for (const [, name, steps] of frames) {
        const properties = [...(steps ?? '').matchAll(/([\w-]+)\s*:/g)].map((found) => found[1])
        expect(properties.length, name).toBeGreaterThan(0)
        expect(properties.filter((property) => property !== 'transform' && property !== 'opacity'), name).toEqual([])
      }
      // And every animation that is used exists.
      const used = [...pianoCss.matchAll(/animation:\s*([\w-]+)/g)].map((found) => found[1]).filter((name) => name !== 'none')
      expect([...new Set(used)].sort()).toEqual(['piano-flash', 'piano-pop'])
    })

    it('adds no wide soft shadow and nothing that only one browser has', () => {
      const effectRules = styleRules().filter(({ selectors }) => selectors.some((selector) => selector.includes('data-key-effect')))
      for (const { selectors, declarations } of effectRules) {
        expect(declarations, selectors.join()).not.toMatch(/(?:^|[;\s])-(?:webkit|moz|ms|o)-/)
        expect(declarations, selectors.join()).not.toMatch(/filter\s*:|backdrop-filter|clip-path|mask/)
        // The blur of a shadow is its third length: at most a few pixels here.
        const blurs = [...declarations.matchAll(/(?:inset )?-?[\d.]+(?:px)? -?[\d.]+(?:px)? (?:calc\(var\(--glow\) \* )?([\d.]+)px/g)].map((found) => Number(found[1]))
        for (const blur of blurs) expect(blur, selectors.join()).toBeLessThanOrEqual(10)
      }
    })

    it('keeps the labels readable where the key keeps its own colour: its own ink, on a solid keycap', () => {
      const quiet = effectSelectors.filter((selector) => selector.endsWith('.piano-key--white.is-lit'))
      expect(quiet).toHaveLength(1)
      for (const effect of ['press', 'edge', 'pop']) expect(quiet[0]).toContain(`'${effect}'`)
      // The names keep the ink of the key style; the keycap is a solid chip, whatever tint lies under it.
      expect(styleValue(quiet[0] ?? '', '--piano-note-ink')).toBe('var(--piano-white-landmark-ink)')
      expect(styleValue(quiet[0] ?? '', '--piano-cap-fill')).toBe('var(--piano-dark-cap-fill)')
      expect(styleValue(quiet[0] ?? '', '--piano-cap-ink')).toBe('var(--piano-dark-cap-ink)')
      const onBlack = effectSelectors.filter((selector) => selector.endsWith('.piano-key--black.is-lit'))
      expect(onBlack).toHaveLength(1)
      expect(styleValue(onBlack[0] ?? '', '--piano-cap-fill')).toBe('var(--key-ivory)')
      expect(styleValue(onBlack[0] ?? '', '--piano-cap-ink')).toBe('var(--key-ebony)')
    })

    it('stands still for someone who asked for less movement', () => {
      const still = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(pianoCss)?.[1] ?? ''
      expect(still).toContain('animation: none')
      for (const layer of ['.piano-key.is-lit', '.piano-key.is-lit::before', '.piano-key.is-lit::after']) {
        expect(still).toContain(`:where(.piano) ${layer}`)
      }
      // Press goes down no further than a key does in the other effects.
      expect(still).toContain(styleValue('.piano-key.is-lit', 'transform'))
    })
  })

  it('stacks a played key in front of its neighbours, and white keys under the black ones', () => {
    const layers = [
      styleValue('.piano-key--white', 'z-index'),
      styleValue('.piano-key--white.is-lit', 'z-index'),
      styleValue('.piano-key--black', 'z-index'),
      styleValue('.piano-key--black.is-lit', 'z-index'),
    ].map(Number)
    expect(layers).toEqual([...layers].sort((a, b) => a - b))
    expect(new Set(layers).size).toBe(4)
    expect(Number(styleValue('.piano__zone', 'z-index'))).toBeGreaterThan(Math.max(...layers))
  })

  it('lights a key in its own colours', () => {
    expect(styleValue('.piano-key--white::before', 'background')).toMatch(
      /^linear-gradient\( to bottom, var\(--key-light-bright\), .*var\(--key-light\)/,
    )
    expect(styleValue('.piano-key--black::before', 'background')).toContain('var(--key-light-bright), var(--key-light)')
    expect(styleValue('.piano-key--black.is-lit', '--piano-note-ink')).toBe('var(--key-light-ink)')
  })

  it('scales the glow of a played key with the glow setting, down to nothing at all', () => {
    const glow = styleValue('.piano-key::after', 'box-shadow')
    expect(glow).toContain('var(--key-light)')
    const scaled = glow.match(/calc\(var\(--glow\) \* [\d.]+px\)/g) ?? []
    expect(scaled.length).toBeGreaterThanOrEqual(2)
    // Apart from the lengths that follow the setting, there is no size left in it.
    expect(glow.replace(/calc\(var\(--glow\) \* [\d.]+px\)/g, '')).not.toMatch(/\d(?:px|em|rem|cq\w+)/)
  })

  it('lets the light of the line fall on the far end of the keys, as strongly as the glow setting says', () => {
    for (const layer of ['.piano::before', '.piano::after']) {
      expect(styleValue(layer, 'opacity')).toBe('var(--glow)')
      expect(styleValue(layer, 'pointer-events')).toBe('none')
    }
    // Behind the keys: whatever the key style puts there. Over them: the wash, at their far end only.
    expect(styleValue('.piano::before', 'background')).toBe('var(--piano-bed)')
    expect(styleValue('.piano', '--piano-bed')).toBe('none')
    expect(styleValue('.piano::after', 'background')).toMatch(
      /^linear-gradient\( to bottom in srgb, .*var\(--light\).*transparent \)$/,
    )
    expect(styleValue('.piano::after', 'bottom')).toBe('auto')
    expect(Number(styleValue('.piano::after', 'z-index'))).toBeGreaterThan(
      Number(styleValue('.piano-key--black.is-lit', 'z-index')),
    )
  })

  it('marks the keyboard zone with a thin line in a dim tint of the light', () => {
    expect(styleValue('.piano__zone', 'height')).toBe('2px')
    expect(styleValue('.piano__zone', 'bottom')).toBe('0')
    expect(styleValue('.piano__zone', 'background')).toMatch(/^color-mix\(in srgb, var\(--light\) \d+%, transparent\)$/)
    expect(styleValue('.piano__zone', 'pointer-events')).toBe('none')
  })

  it('dims the keys outside the keyboard zone while customizing, and points at the others', () => {
    expect(styleValue('.piano--editing .piano-key:not([data-slot])', 'filter')).toMatch(/^brightness\(0\.\d+\)$/)
    expect(styleValue('.piano--editing .piano-key[data-slot]', 'cursor')).toBe('pointer')
    expect(styleValue('.piano-key', 'cursor')).toBe('default')
  })

  it('names every white key only when keys are 30px wide, and black keys when they are wider still', () => {
    expect(styleValue('.piano', '--piano-if-roomy')).toContain('var(--piano-key-width) - 29.99px')
    expect(styleValue('.piano', '--piano-if-roomy-black')).toContain('var(--piano-key-width) - 35.99px')
    expect(styleValue('.piano-key--white .piano-key__note', 'font-size')).toContain('var(--piano-if-roomy)')
    expect(styleValue('.piano-key--black .piano-key__note', 'font-size')).toContain('var(--piano-if-roomy-black)')
    // The C keys are named at any width.
    expect(styleValue('.piano-key--white .piano-key__note--c', 'font-size')).toBe('var(--piano-note-fit)')
  })

  it('shrinks a label to the room its key has, and never lets it spill over', () => {
    for (const label of ['.piano-key__cap', '.piano-key__note']) {
      expect(styleRule(label)).toContain('var(--piano-label-room) / (var(--label-chars, 1) *')
      expect(styleValue(label, 'max-width')).toBe('100%')
    }
    expect(styleValue('.piano-key__labels', 'overflow')).toBe('hidden')
    expect(styleValue('.piano-key__cap', 'overflow')).toBe('hidden')
    expect(styleValue('.piano-key__note', 'overflow-x')).toBe('clip')
    expect(styleValue('.piano-key--white', '--piano-label-room')).toContain('var(--piano-key-width)')
    expect(styleValue('.piano-key--black', '--piano-label-room')).toContain(
      'var(--piano-key-width) * var(--piano-black-key-width)',
    )
  })

  it("stops text selection and the browser's own gestures on the keys", () => {
    expect(styleValue('.piano', 'user-select')).toBe('none')
    expect(styleValue('.piano', 'touch-action')).toBe('none')
    expect(styleValue('.piano-key', 'touch-action')).toBe('none')
  })

  it('keeps its own colours in a Windows contrast theme', () => {
    expect(pianoCss).toMatch(/@media \(forced-colors: active\) \{\s*\.piano \{\s*forced-color-adjust: none;/)
  })
})
