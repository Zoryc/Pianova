// @vitest-environment jsdom
/**
 * The piano and the computer keys in the assembled app (src/App.tsx), where
 * the pieces meet: the "Auto" piano size in windows of every width against
 * every position of the computer keys, the letters a browser reports for the
 * player's keyboard, the mouse on a full piano next to the computer keys,
 * choosing keys with the keyboard alone, and what is left on screen or left
 * sounding when something else takes the keyboard away.
 *
 * The sound engine and the sky are replaced by stand-ins. There is no layout
 * here: the width of the stage and the place of the piano are whatever the
 * test says they are.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle' }
  /** "on 60" / "off 60", as the engine was told. */
  const heard: string[] = []
  const engine = {
    start(): Promise<void> {
      state.status = 'ready'
      for (const listener of [...listeners]) listener()
      return Promise.resolve()
    },
    getStatus: () => state.status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    noteOn(midi: number): void {
      heard.push(`on ${midi}`)
    },
    noteOff(midi: number): void {
      heard.push(`off ${midi}`)
    },
    setSustain(): void {},
    setVolume(): void {},
    setTranspose(): void {},
    setReverb(): void {},
    setRelease(): void {},
    allNotesOff(): void {},
    dispose(): void {},
  }
  return { engine, state, heard }
})

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

vi.mock('./ui/sky/Sky', async () => {
  const { createElement } = await import('react')
  return {
    Sky() {
      return createElement('canvas', { className: 'sky' })
    },
  }
})

import { App } from './App'
import { bus } from './app/pianoApp'
import {
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  SLOT_COUNT,
  pianoRange,
  slotToMidi,
} from './core/layout'
import type { PianoRange, PianoSize } from './core/layout'
import { keyRectOf } from './core/pianoGeometry'
import { DEFAULT_BINDINGS } from './input/keymap'
import { settingsStore } from './state/settings'
import { BLACK_KEY_HEIGHT } from './ui/pianoHitTest'
import { resetSongs } from './ui/songsTestKit'

const UNUSABLE = "That key can't be used. Try a letter, number or symbol key."
const FULL_PIANO: PianoRange = { first: 21, last: 108 }

/** How wide the stage is on the make-believe screen (0: nothing can be measured). */
let stageWidth = 0
/** What the browser calls when the stage changes size. */
let resizeListeners: (() => void)[] = []
/** Where the piano is on the make-believe screen. */
const BOX = { left: 0, top: 500, width: 2600, height: 200 }

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(): void {
    resizeListeners.push(this.callback)
  }
  disconnect(): void {
    resizeListeners = resizeListeners.filter((listener) => listener !== this.callback)
  }
}

function resizeWindowTo(width: number): void {
  stageWidth = width
  act(() => {
    for (const listener of resizeListeners) listener()
  })
}

/** Pointer capture, the way a browser does it (the simulated browser has none). */
const captured = new Map<number, Element>()

beforeEach(async () => {
  await resetSongs()
  settingsStore.reset()
  bus.allOff()
  audio.state.status = 'idle'
  audio.heard.length = 0
  stageWidth = 0
  resizeListeners = []
  captured.clear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('piano')) {
      return {
        ...BOX,
        x: BOX.left,
        y: BOX.top,
        right: BOX.left + BOX.width,
        bottom: BOX.top + BOX.height,
      } as DOMRect
    }
    const width = this.classList.contains('stage') ? stageWidth : 0
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0 } as DOMRect
  })
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.setPointerCapture = function (this: Element, pointerId: number): void {
    captured.set(pointerId, this)
  }
  proto.hasPointerCapture = function (this: Element, pointerId: number): boolean {
    return captured.get(pointerId) === this
  }
  proto.releasePointerCapture = function (this: Element, pointerId: number): void {
    if (captured.get(pointerId) === this) captured.delete(pointerId)
  }
})

afterEach(async () => {
  cleanup()
  const proto = Element.prototype as unknown as Record<string, unknown>
  delete proto.setPointerCapture
  delete proto.hasPointerCapture
  delete proto.releasePointerCapture
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
  await resetSongs()
})

/** A key of the computer keyboard goes down or up, on whatever has the keyboard focus. */
function key(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init })
  const target = document.activeElement ?? document.body
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function tap(code: string, init: KeyboardEventInit = {}): void {
  key('keydown', code, init)
  key('keyup', code, init)
}

/** A click with the mouse: the control has the focus when the click arrives. */
function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

/** Enter on a focused control: the browser sends a click that no mouse button made. */
function pressEnterOn(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 0 })
}

/** Draws the app and gets past the start overlay. */
function startApp(): void {
  render(<App />)
  tap('Enter')
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function panel(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Settings' })
}

/** Opens Settings on one of its tabs. (The panel remembers its last tab from test to test.) */
function openSettingsOn(tab: string): HTMLElement {
  if (!panel()) clickWithMouse(button('Settings'))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  clickWithMouse(within(settings).getByRole('tab', { name: tab }))
  return settings
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

function pianoKeys(): HTMLElement[] {
  return [...piano().querySelectorAll<HTMLElement>('.piano-key')]
}

function pianoKey(midi: number): HTMLElement {
  return piano().querySelector(`.piano-key[data-midi="${midi}"]`) as HTMLElement
}

function keycap(midi: number): string | undefined {
  return pianoKey(midi).querySelector('.piano-key__cap')?.textContent ?? undefined
}

function selectedKeys(): number[] {
  return [...piano().querySelectorAll<HTMLElement>('.is-selected')].map((element) =>
    Number(element.dataset.midi),
  )
}

function litKeys(): number[] {
  return [...piano().querySelectorAll<HTMLElement>('.is-lit')].map((element) =>
    Number(element.dataset.midi),
  )
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function message(): string {
  return document.querySelector('.change-key__message')?.textContent ?? ''
}

function lead(): string {
  return document.querySelector('.change-key__lead')?.textContent ?? ''
}

/** A point on the visible part of a key of the piano on screen. */
function onNote(midi: number, range: PianoRange): { clientX: number; clientY: number } {
  const rect = keyRectOf(midi, range)
  if (!rect) throw new Error(`the piano has no key for note ${midi}`)
  const share = rect.black ? BLACK_KEY_HEIGHT / 2 : (1 + BLACK_KEY_HEIGHT) / 2
  return {
    clientX: BOX.left + (rect.left + rect.width / 2) * BOX.width,
    clientY: BOX.top + share * BOX.height,
  }
}

/** The mouse, sending the piano what a browser sends it. */
function mouse(type: string, at: { clientX: number; clientY: number }, init: PointerEventInit = {}): void {
  const target = captured.get(1) ?? piano()
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerup' ? 0 : 1,
        ...at,
        ...init,
      }),
    )
  })
  if (type === 'pointerup' || type === 'pointercancel') {
    const holder = captured.get(1)
    captured.delete(1)
    if (holder) {
      act(() => {
        holder.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }))
      })
    }
  }
}

describe('the "Auto" piano size in windows of every width', () => {
  /** The narrowest window for each piano: 26 pixels for every white key. */
  const WIDTHS: readonly [number, PianoSize][] = [
    [320, 37],
    [753, 37],
    [754, 49],
    [800, 49],
    [935, 49],
    [936, 61],
    [1351, 61],
    [1352, 88],
    [1366, 88],
    [3840, 88],
  ]
  const ZONES = Array.from(
    { length: MAX_BASE_OCTAVE - MIN_BASE_OCTAVE + 1 },
    (_, index) => MIN_BASE_OCTAVE + index,
  )
  const cases = WIDTHS.flatMap(([width, size]) =>
    ZONES.map((baseOctave) => ({ width, size, baseOctave })),
  )

  it.each(cases)(
    'at $width pixels the piano has $size keys and holds every note of the computer keys (octave $baseOctave)',
    ({ width, size, baseOctave }) => {
      stageWidth = width
      act(() => settingsStore.set({ baseOctave }))
      startApp()

      const shown = pianoKeys().map((element) => Number(element.dataset.midi))
      expect(shown).toHaveLength(size)
      expect({ first: shown[0], last: shown.at(-1) }).toEqual(pianoRange(size, baseOctave))
      // Comfortably wide keys: at least 26 pixels, unless the piano is already the smallest.
      const whiteKeys = piano().querySelectorAll('.piano-key--white').length
      if (size !== 37) expect(width / whiteKeys).toBeGreaterThanOrEqual(26)

      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        expect(pianoKey(slotToMidi(slot, baseOctave)).dataset.slot).toBe(String(slot))
      }
      expect(piano().querySelector('.piano__zone') !== null).toBe(size !== 37)

      for (const [code, slot] of Object.entries(DEFAULT_BINDINGS)) {
        key('keydown', code)
        expect(litKeys(), code).toEqual([slotToMidi(slot, baseOctave)])
        key('keyup', code)
      }
      expect(heldNotes()).toEqual([])
    },
  )

  it('lets go of held notes when the window is resized onto another piano, and plays on', () => {
    stageWidth = 1366
    startApp()
    expect(pianoKeys()).toHaveLength(88)
    key('keydown', 'KeyA')
    mouse('pointerdown', onNote(21, FULL_PIANO))
    expect(heldNotes()).toEqual([21, 60])

    resizeWindowTo(1000)
    expect(pianoKeys()).toHaveLength(61)
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])

    // Both are still down. Neither starts anything until it is pressed again.
    key('keydown', 'KeyA', { repeat: true })
    mouse('pointermove', onNote(40, pianoRange(61, 3)))
    expect(heldNotes()).toEqual([])
    mouse('pointerup', onNote(40, pianoRange(61, 3)))
    key('keyup', 'KeyA')

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('keeps held notes when the window changes width without changing the piano', () => {
    stageWidth = 1366
    startApp()
    key('keydown', 'KeyA')
    resizeWindowTo(1500)
    resizeWindowTo(1352)
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
  })

  it('keeps the piano key that waits for a computer key when the window is resized', () => {
    stageWidth = 1366
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))

    resizeWindowTo(800)
    expect(pianoKeys()).toHaveLength(49)
    expect(selectedKeys()).toEqual([64])
    tap('KeyM', { key: 'm' })
    expect(settingsStore.get().bindings.KeyM).toBe(16)
  })
})

describe('the letters the browser reports for the keyboard', () => {
  /** What Chrome and Edge report on a French keyboard, for the keys this test looks at. */
  const FRENCH = new Map([
    ['KeyA', 'q'],
    ['KeyQ', 'a'],
    ['KeyW', 'z'],
    ['KeyZ', 'w'],
    ['Semicolon', 'm'],
    ['KeyM', ','],
    ['Quote', 'ù'],
    ['Digit2', 'é'],
    ['Numpad1', '1'],
  ])

  async function startWithLayoutMap(layoutMap: ReadonlyMap<string, string> | 'refused'): Promise<void> {
    const getLayoutMap =
      layoutMap === 'refused'
        ? () => Promise.reject(new Error('not allowed here'))
        : () => Promise.resolve(layoutMap)
    vi.stubGlobal('navigator', { keyboard: { getLayoutMap }, userActivation: { hasBeenActive: true } })
    render(<App />)
    await act(async () => {
      await Promise.resolve()
    })
    tap('Enter')
  }

  it('are drawn on the piano with "Auto", on the same physical keys as ever', async () => {
    await startWithLayoutMap(FRENCH)

    expect(keycap(60)).toBe('Q')
    expect(keycap(61)).toBe('Z')
    expect(keycap(76)).toBe('M')
    expect(keycap(77)).toBe('Ù')
    expect(pianoKey(60).getAttribute('aria-label')).toBe('C4, key Q')
    // A key the browser said nothing about keeps the letter of a US keyboard.
    expect(keycap(62)).toBe('S')

    // The physical key that a US keyboard calls A still plays middle C.
    key('keydown', 'KeyA', { key: 'q' })
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA', { key: 'q' })
  })

  it('give way to the keyboard type the player chooses, and come back with "Auto"', async () => {
    await startWithLayoutMap(FRENCH)
    openSettingsOn('Keys')

    clickWithMouse(button('QWERTY'))
    expect(keycap(60)).toBe('A')
    expect(keycap(76)).toBe(';')

    clickWithMouse(button('QWERTZ'))
    expect(keycap(68)).toBe('Z')
    expect(keycap(76)).toBe('Ö')

    clickWithMouse(button('Auto'))
    expect(keycap(60)).toBe('Q')
    expect(keycap(76)).toBe('M')
  })

  it('win over the letter a key typed when it was chosen, and name the key in the message', async () => {
    await startWithLayoutMap(FRENCH)
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(48))
    // Chosen with Shift held: the key reports a capital, the browser knows the key itself.
    tap('KeyM', { key: '?', shiftKey: true })

    expect(message()).toBe('"," now plays C3.')
    expect(keycap(48)).toBe(',')
  })

  it('never rename the number pad, which reads "Num 1" on every keyboard', async () => {
    await startWithLayoutMap(FRENCH)
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(48))
    tap('Numpad1', { key: '1' })

    expect(message()).toBe('"Num 1" now plays C3.')
    expect(keycap(48)).toBe('Num 1')
    expect(pianoKey(48).getAttribute('aria-label')).toBe('C3, key Num 1')

    for (const type of ['QWERTY', 'AZERTY', 'QWERTZ', 'Auto']) {
      clickWithMouse(button(type))
      expect(keycap(48), type).toBe('Num 1')
    }
  })

  it.each([
    ['the browser reports no key at all', new Map<string, string>()],
    ['the browser refuses to say', 'refused' as const],
  ])('fall back on US letters when %s', async (_why, layoutMap) => {
    await startWithLayoutMap(layoutMap)
    expect(keycap(60)).toBe('A')
    expect(keycap(76)).toBe(';')
    expect(keycap(77)).toBe("'")

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
  })
})

describe('the mouse on a full piano, next to the computer keys', () => {
  function startOnFullPiano(): void {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
  }

  it('plays the keys outside the reach of the computer keys, from the lowest A to the highest C', () => {
    startOnFullPiano()
    for (const midi of [21, 22, 47, 85, 107, 108]) {
      mouse('pointerdown', onNote(midi, FULL_PIANO))
      expect(heldNotes(), `note ${midi}`).toEqual([midi])
      expect(pianoKey(midi).getAttribute('aria-pressed')).toBe('true')
      mouse('pointerup', onNote(midi, FULL_PIANO))
      expect(heldNotes()).toEqual([])
      expect(pianoKey(midi).getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('plays every key on the way in one sweep across the whole piano, and leaves none sounding', () => {
    startOnFullPiano()
    const started: number[] = []
    const stop = bus.subscribe((event) => {
      if (event.type === 'on') started.push(event.midi)
    })

    const low = { clientX: BOX.left + 1, clientY: BOX.top + 0.3 * BOX.height }
    const high = { clientX: BOX.left + BOX.width - 1, clientY: BOX.top + 0.3 * BOX.height }
    mouse('pointerdown', low)
    mouse('pointermove', high)
    mouse('pointerup', high)
    stop()

    expect(started).toEqual(Array.from({ length: 88 }, (_, index) => 21 + index))
    expect(heldNotes()).toEqual([])
    expect(audio.heard.filter((entry) => entry.startsWith('on'))).toHaveLength(88)
    expect(audio.heard.filter((entry) => entry.startsWith('off'))).toHaveLength(88)
  })

  it('shares a note with the computer key that plays it: it sounds until both let go', () => {
    startOnFullPiano()
    key('keydown', 'KeyA')
    mouse('pointerdown', onNote(60, FULL_PIANO))
    expect(heldNotes()).toEqual([60])

    mouse('pointerup', onNote(60, FULL_PIANO))
    expect(heldNotes()).toEqual([60])
    expect(litKeys()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])

    // And the other way round.
    mouse('pointerdown', onNote(60, FULL_PIANO))
    key('keydown', 'KeyA')
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([60])
    mouse('pointerup', onNote(60, FULL_PIANO))
    expect(heldNotes()).toEqual([])
    expect(audio.heard.at(-1)).toBe('off 60')
  })

  it('ignores the right and the middle button, and stops when the left one is let go under them', () => {
    startOnFullPiano()
    mouse('pointerdown', onNote(30, FULL_PIANO), { button: 2, buttons: 2 })
    mouse('pointerup', onNote(30, FULL_PIANO), { button: 2 })
    mouse('pointerdown', onNote(30, FULL_PIANO), { button: 1, buttons: 4 })
    mouse('pointerup', onNote(30, FULL_PIANO), { button: 1 })
    expect(audio.heard).toEqual([])

    mouse('pointerdown', onNote(30, FULL_PIANO))
    // The right button goes down too, then the left one comes up: the browser reports moves.
    mouse('pointermove', onNote(30, FULL_PIANO), { button: 2, buttons: 3 })
    expect(heldNotes()).toEqual([30])
    mouse('pointermove', onNote(30, FULL_PIANO), { button: 0, buttons: 2 })
    expect(heldNotes()).toEqual([])
    mouse('pointerup', onNote(30, FULL_PIANO), { button: 2 })
    expect(audio.heard).toEqual(['on 30', 'off 30'])
  })

  it('stops the note when the mouse is dragged off the piano, is cancelled, or the window loses focus', () => {
    startOnFullPiano()
    const above = { clientX: BOX.left + 300, clientY: BOX.top - 40 }

    mouse('pointerdown', onNote(100, FULL_PIANO))
    mouse('pointermove', above)
    expect(heldNotes()).toEqual([])
    mouse('pointerup', above)

    mouse('pointerdown', onNote(100, FULL_PIANO))
    mouse('pointercancel', onNote(100, FULL_PIANO))
    expect(heldNotes()).toEqual([])

    mouse('pointerdown', onNote(100, FULL_PIANO))
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(heldNotes()).toEqual([])
    // The release that comes late changes nothing.
    mouse('pointerup', onNote(100, FULL_PIANO))
    expect(audio.heard.filter((entry) => entry === 'on 100')).toHaveLength(3)
    expect(audio.heard.filter((entry) => entry === 'off 100')).toHaveLength(3)
  })

  it('stops the note of the mouse when the computer keys move lower or higher under it', () => {
    startOnFullPiano()
    mouse('pointerdown', onNote(90, FULL_PIANO))
    expect(heldNotes()).toEqual([90])

    act(() => settingsStore.set({ baseOctave: 4 }))
    expect(heldNotes()).toEqual([])
    mouse('pointermove', onNote(91, FULL_PIANO))
    expect(heldNotes()).toEqual([])
    mouse('pointerup', onNote(91, FULL_PIANO))
    expect(audio.heard).toEqual(['on 90', 'off 90'])
  })

  it('stops everything when the app goes away with a key and the mouse down', () => {
    startOnFullPiano()
    key('keydown', 'KeyA')
    mouse('pointerdown', onNote(21, FULL_PIANO))
    expect(heldNotes()).toEqual([21, 60])

    cleanup()
    expect(heldNotes()).toEqual([])
    expect(audio.heard.filter((entry) => entry.startsWith('off')).sort()).toEqual(['off 21', 'off 60'])
  })

  it('plays nothing while the computer keys are being chosen: a press only selects, inside the zone', () => {
    startOnFullPiano()
    openSettingsOn('Keys')

    for (const midi of [21, 60, 108]) {
      mouse('pointerdown', onNote(midi, FULL_PIANO))
      mouse('pointermove', onNote(midi + (midi === 108 ? -1 : 1), FULL_PIANO))
      mouse('pointerup', onNote(midi, FULL_PIANO))
      fireEvent.click(pianoKey(midi), { detail: 1 })
    }
    expect(audio.heard).toEqual([])
    expect(selectedKeys()).toEqual([60])

    // Another mouse button selects nothing: only a real click does.
    tap('Escape')
    fireEvent.contextMenu(pianoKey(62))
    fireEvent(pianoKey(62), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(selectedKeys()).toEqual([])
  })

  it('is let go when choosing keys starts under a pressed mouse button, and plays again afterwards', () => {
    startOnFullPiano()
    openSettingsOn('Sound')
    mouse('pointerdown', onNote(30, FULL_PIANO))
    expect(heldNotes()).toEqual([30])

    // The Keys tab is reached with the keyboard while the mouse button is still down.
    pressEnterOn(screen.getByRole('tab', { name: 'Keys' }))
    expect(piano().classList.contains('piano--editing')).toBe(true)
    expect(heldNotes()).toEqual([])
    mouse('pointerup', onNote(30, FULL_PIANO))
    expect(audio.heard).toEqual(['on 30', 'off 30'])

    pressEnterOn(screen.getByRole('tab', { name: 'Sound' }))
    mouse('pointerdown', onNote(30, FULL_PIANO))
    expect(heldNotes()).toEqual([30])
    mouse('pointerup', onNote(30, FULL_PIANO))
    expect(heldNotes()).toEqual([])
  })
})

describe('choosing keys with the keyboard alone', () => {
  it('reaches a piano key with Tab, takes it with Enter, and never loses its place', async () => {
    const user = userEvent.setup()
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    pressEnterOn(button('Settings'))
    pressEnterOn(screen.getByRole('tab', { name: 'Keys' }))

    // The last control of the panel, then Tab: the first key of the zone, not the first of the piano.
    button('Reset to default keys').focus()
    await user.tab()
    expect(document.activeElement).toBe(pianoKey(48))
    await user.tab()
    expect(document.activeElement).toBe(pianoKey(49))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(pianoKey(48))

    await user.keyboard('{Enter}')
    expect(selectedKeys()).toEqual([48])
    expect(lead()).toBe('Press a key for C3…')
    expect(document.activeElement).toBe(pianoKey(48))

    // While the piano key waits, Tab, Enter and Space are refused and do nothing else.
    await user.keyboard('{Tab}')
    expect(document.activeElement).toBe(pianoKey(48))
    expect(message()).toBe(UNUSABLE)
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(selectedKeys()).toEqual([48])
    expect(settingsStore.get().sustain).toBe(false)

    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings.KeyZ).toBe(0)
    expect(message()).toBe('"Z" now plays C3.')
    expect(document.activeElement).toBe(pianoKey(48))
    expect(heldNotes()).toEqual([])

    // With nothing waiting the new key plays, also with the focus on a piano key.
    await user.keyboard('{z>}')
    expect(heldNotes()).toEqual([48])
    await user.keyboard('{/z}')
    expect(heldNotes()).toEqual([])

    // The last key of the zone is the last stop: the 51 keys outside it are skipped.
    pianoKey(84).focus()
    await user.tab()
    expect(piano().contains(document.activeElement)).toBe(false)

    pianoKey(84).focus()
    await user.keyboard('{Escape}')
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(button('Settings'))
  })

  it('leaves Space as the sustain key on a focused piano key, and Enter alone as the way to take it', async () => {
    const user = userEvent.setup()
    startApp()
    openSettingsOn('Keys')
    pianoKey(60).focus()

    await user.keyboard(' ')
    expect(settingsStore.get().sustain).toBe(true)
    expect(selectedKeys()).toEqual([])

    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(selectedKeys()).toEqual([])

    await user.keyboard('{Enter}')
    expect(selectedKeys()).toEqual([60])
    await user.keyboard('{Backspace}')
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()
    expect(message()).toBe('C4 has no key now.')
    expect(document.activeElement).toBe(pianoKey(60))
  })
})

describe('what the Keys tab says after a change', () => {
  /*
   * The line names a computer key and the note it plays: '"M" now plays E4.'
   * It is taken away as soon as that stops being true: when the keys move
   * lower or higher, and when another keyboard type changes the letters.
   */
  it('stays while it is true, and goes when the keys are moved lower or higher', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    tap('KeyM', { key: 'm' })
    expect(message()).toBe('"M" now plays E4. "D" no longer plays a note.')

    // Trying the new key changes nothing of what the line says.
    key('keydown', 'KeyM', { key: 'm' })
    expect(heldNotes()).toEqual([64])
    key('keyup', 'KeyM', { key: 'm' })
    expect(message()).toBe('"M" now plays E4. "D" no longer plays a note.')

    clickWithMouse(button(/Higher/))
    // M plays E5 now: the line that said "now plays E4" is gone.
    expect(message()).toBe('')
    key('keydown', 'KeyM', { key: 'm' })
    expect(heldNotes()).toEqual([76])
    key('keyup', 'KeyM', { key: 'm' })

    // The same on the way down, with the line of another change.
    fireEvent.click(pianoKey(72))
    tap('Backspace', { key: 'Backspace' })
    expect(message()).toBe('C5 has no key now.')
    clickWithMouse(button(/Lower/))
    expect(message()).toBe('')
  })

  it('goes when another keyboard type is chosen: the piano draws other letters now', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(48))
    tap('KeyQ', { key: 'q' })
    expect(message()).toBe('"Q" now plays C3.')

    clickWithMouse(button('AZERTY'))
    // The piano writes A on that key now, and Q on the key of C4.
    expect(keycap(48)).toBe('A')
    expect(keycap(60)).toBe('Q')
    expect(message()).toBe('')
  })

  it('leaves the piano key that is waiting for a computer key waiting, whatever was moved', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(60))
    tap('Enter', { key: 'Enter' })
    expect(message()).toBe(UNUSABLE)

    clickWithMouse(button('QWERTZ'))
    expect(message()).toBe('')
    expect(selectedKeys()).toEqual([60])
    expect(lead()).toBe('Press a key for C4…')

    // The same key of the keyboard zone, one octave higher now.
    clickWithMouse(button(/Higher/))
    expect(selectedKeys()).toEqual([72])
    expect(lead()).toBe('Press a key for C5…')

    // It is still waiting: the next key pressed is taken for it, and the line
    // that says so names that key as a German keyboard prints it.
    tap('KeyZ', { key: 'y' })
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(message()).toBe('"Y" now plays C5. "A" no longer plays a note.')
  })

  it('keeps "The default keys are back." after the keys were reset: that line is still true', () => {
    act(() => settingsStore.set({ baseOctave: 4, keyboardType: 'azerty', bindings: { KeyM: 12 } }))
    startApp()
    openSettingsOn('Keys')

    clickWithMouse(button('Reset to default keys'))
    clickWithMouse(button('Yes'))

    expect(message()).toBe('The default keys are back.')
    // The reset is about which key plays which note, not about where the keys sit or their letters.
    expect(settingsStore.get()).toMatchObject({ baseOctave: 4, keyboardType: 'azerty' })
  })
})

describe('a note held while a pop-up of the browser takes the keyboard', () => {
  /*
   * While the list of a drop-down or the colour picker is open, Chrome and
   * Edge keep every key event to themselves, key releases included (the
   * Labels drop-down says so in its own comments). A computer key let go at
   * that moment never reaches the page: without help, its note has no way to
   * stop.
   *
   * These tests send no key release, which is all the page ever sees. The page
   * cannot tell a key that was let go from one that is still down, so a note
   * whose key is in fact still held is cut short too. That is the price of
   * never leaving one stuck.
   */
  it('does not go on sounding once the drop-down has given the keyboard back', () => {
    startApp()
    const settings = openSettingsOn('Piano')
    const labels = within(settings).getByRole('combobox', { name: 'Labels on the keys' })

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    // The list is opened with the mouse; A is let go while it is open (the page is not told).
    fireEvent.pointerDown(labels)
    fireEvent.mouseDown(labels)
    labels.focus()
    // A choice is made: the list closes and the drop-down lets go of the keyboard.
    fireEvent.change(labels, { target: { value: 'keys' } })
    expect(document.activeElement).not.toBe(labels)
    expect(settingsStore.get().labelMode).toBe('keys')

    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])
  })

  it('plays again at the very next press of that key', () => {
    startApp()
    const settings = openSettingsOn('Piano')
    const labels = within(settings).getByRole('combobox', { name: 'Labels on the keys' })

    key('keydown', 'KeyA')
    fireEvent.pointerDown(labels)
    fireEvent.mouseDown(labels)
    labels.focus()
    fireEvent.change(labels, { target: { value: 'keys' } })
    audio.heard.length = 0

    // A was let go while the list was open. Pressed again, it must sound.
    key('keydown', 'KeyA')
    expect(audio.heard).toContain('on 60')
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('stops when "Your colour" opens the colour picker, and plays again at the very next press', () => {
    startApp()
    const settings = openSettingsOn('Look')

    // A note held to watch the light while a colour is picked.
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    // The picker opens; A is let go while it is open (the page is not told).
    clickWithMouse(within(settings).getByRole('radio', { name: 'Your colour' }))
    expect(settingsStore.get().accent).toBe('custom')
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])
    audio.heard.length = 0

    key('keydown', 'KeyA')
    expect(audio.heard).toEqual(['on 60'])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('stops too when the colour picker is opened with Enter on "Your colour"', () => {
    startApp()
    const settings = openSettingsOn('Look')
    key('keydown', 'KeyA')

    pressEnterOn(within(settings).getByRole('radio', { name: 'Your colour' }))

    expect(settingsStore.get().accent).toBe('custom')
    expect(heldNotes()).toEqual([])
  })

  it('goes on sounding when a colour is chosen that opens nothing', () => {
    startApp()
    const settings = openSettingsOn('Look')
    key('keydown', 'KeyA')

    clickWithMouse(within(settings).getByRole('radio', { name: 'Blue' }))

    expect(settingsStore.get().accent).toBe('blue')
    expect(heldNotes()).toEqual([60])
    expect(litKeys()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })
})
