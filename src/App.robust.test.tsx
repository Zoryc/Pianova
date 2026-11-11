// @vitest-environment jsdom
/**
 * "No stuck notes" audit of the whole app in a simulated browser.
 *
 * For every way a note can start (computer keyboard, pointer, and the bus API
 * that later phases will use) each test starts a note and then takes one of
 * the exits the spec lists (docs/ARCHITECTURE.md sections 5.5, 5.6, 5.7 and
 * 7): key or pointer release, window blur, tab hidden, pagehide, unmount,
 * entering "Customize keys", moving the piano lower / higher, resetting the
 * settings. Afterwards nothing may be held on the bus and nothing may still be
 * sounding in the engine.
 *
 * The sound engine is replaced by a stand-in that only remembers which notes
 * it was asked to play.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  /** Notes the engine was told to start and not yet told to stop. */
  const sounding = new Set<number>()
  const listeners = new Set<() => void>()
  const state = { status: 'idle', starts: 0 }
  const engine = {
    start(): Promise<void> {
      state.starts += 1
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
      sounding.add(midi)
    },
    noteOff(midi: number): void {
      sounding.delete(midi)
    },
    setSustain(): void {},
    setVolume(): void {},
    setTranspose(): void {},
    setReverb(): void {},
    setRelease(): void {},
    allNotesOff(): void {
      sounding.clear()
    },
    dispose(): void {},
  }
  return {
    engine,
    sounding,
    state,
    reset(): void {
      sounding.clear()
      state.status = 'idle'
      state.starts = 0
    },
  }
})

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

import { App } from './App'
import { bus } from './app/pianoApp'
import { KEY_RECTS } from './core/keyGeometry'
import { slotToMidi } from './core/layout'
import { settingsStore } from './state/settings'

/** The size the piano box pretends to have (jsdom lays nothing out). */
const PIANO_BOX = { left: 100, top: 300, width: 1100, height: 200 }

const C4 = 60
const C5 = 72

beforeAll(() => {
  // jsdom has no canvas and no pointer capture. The light trails then draw
  // nothing, and the piano falls back to its "pointer could not be captured" path.
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.hasPointerCapture = () => false
})

beforeEach(() => {
  window.localStorage.clear()
  act(() => settingsStore.reset())
  bus.allOff()
  audio.reset()
  setVisibility('visible')
})

afterEach(() => {
  cleanup()
  bus.allOff()
  vi.restoreAllMocks()
})

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

function keyEvent(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init })
  // Like a browser: key events go to whatever has focus and bubble up to the window.
  act(() => {
    ;(document.activeElement ?? document.body).dispatchEvent(event)
  })
  return event
}

function keyDown(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return keyEvent('keydown', code, init)
}

function keyUp(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return keyEvent('keyup', code, init)
}

function windowEvent(type: string): void {
  act(() => {
    window.dispatchEvent(new Event(type))
  })
}

function hideTab(): void {
  setVisibility('hidden')
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function piano(): HTMLElement {
  const box = screen.getByRole('group', { name: 'Piano' })
  box.getBoundingClientRect = () => ({ ...PIANO_BOX, x: 0, y: 0, right: 0, bottom: 0, toJSON: () => ({}) })
  return box
}

/** A point of the piano box that lies on the key for `slot`. */
function pointOnSlot(slot: number): { clientX: number; clientY: number } {
  const rect = KEY_RECTS[slot]
  if (!rect) throw new Error(`no key for slot ${slot}`)
  return {
    clientX: PIANO_BOX.left + (rect.left + rect.width / 2) * PIANO_BOX.width,
    // Black keys are hit in the upper part of the box, white keys near the bottom.
    clientY: PIANO_BOX.top + (rect.black ? 0.2 : 0.9) * PIANO_BOX.height,
  }
}

function pointer(
  type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'pointerLeave' | 'lostPointerCapture',
  slot: number | null,
  init: PointerEventInit = {},
): void {
  const point = slot === null ? { clientX: 5, clientY: 5 } : pointOnSlot(slot)
  const pressed = type === 'pointerDown' || type === 'pointerMove'
  fireEvent[type](piano(), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: pressed ? 1 : 0,
    ...point,
    ...init,
  })
}

/** Draws the app and gets past the start overlay, as a player would. */
function startApp(): ReturnType<typeof render> {
  const view = render(<App />)
  keyDown('Enter')
  keyUp('Enter')
  expect(screen.queryByText('Click or press any key to start')).toBeNull()
  return view
}

function click(name: string | RegExp): void {
  // `detail: 1` is what a real mouse click carries.
  fireEvent.click(screen.getByRole('button', { name }), { detail: 1 })
}

function held(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function sounding(): number[] {
  return [...audio.sounding].sort((a, b) => a - b)
}

function litKeys(): string[] {
  return [...document.querySelectorAll('.piano-key.is-lit')].map(
    (key) => key.getAttribute('aria-label') ?? '',
  )
}

function expectSilence(): void {
  expect(held()).toEqual([])
  expect(sounding()).toEqual([])
  expect(litKeys()).toEqual([])
}

function expectPlaying(...notes: number[]): void {
  expect(held()).toEqual(notes)
  expect(sounding()).toEqual(notes)
}

describe('start overlay', () => {
  it('uses the first key press only to start the sound, even when that key is still held', () => {
    render(<App />)
    const first = keyDown('KeyA')
    expect(first.defaultPrevented).toBe(true)
    expect(audio.state.starts).toBe(1)
    // The key is still down and repeats: that is not a note either.
    keyDown('KeyA', { repeat: true })
    expectSilence()
    keyUp('KeyA')
    expectSilence()

    keyDown('KeyA')
    expectPlaying(C4)
    keyUp('KeyA')
    expectSilence()
    expect(audio.state.starts).toBe(1)
  })
})

describe('a note started with the computer keyboard stops', () => {
  beforeEach(() => {
    startApp()
    keyDown('KeyA')
    expectPlaying(C4)
    expect(litKeys()).toEqual(['C4, key A'])
  })

  it('when the key is released', () => {
    keyUp('KeyA')
    expectSilence()
  })

  it('when the key is released while Ctrl is down', () => {
    keyUp('KeyA', { ctrlKey: true })
    expectSilence()
  })

  it('when the key is released after focus moved to the Labels drop-down', () => {
    screen.getByRole('combobox', { name: 'Labels' }).focus()
    keyUp('KeyA')
    expectSilence()
  })

  it('when the window loses focus, and the late key-up changes nothing', () => {
    windowEvent('blur')
    expectSilence()
    keyUp('KeyA')
    expectSilence()
    // The key works again afterwards.
    keyDown('KeyA')
    expectPlaying(C4)
    keyUp('KeyA')
    expectSilence()
  })

  it('when the tab is hidden', () => {
    hideTab()
    expectSilence()
  })

  it('when the page is left (pagehide)', () => {
    windowEvent('pagehide')
    expectSilence()
  })

  it('when the app is unmounted', () => {
    cleanup()
    expect(held()).toEqual([])
    expect(sounding()).toEqual([])
  })

  it('when "Customize keys" is opened', () => {
    click('Customize keys')
    expectSilence()
    keyUp('KeyA')
    expectSilence()
  })

  it('when a piano key is selected in "Customize keys"', () => {
    keyUp('KeyA')
    click('Customize keys')
    // With nothing selected the keyboard still plays.
    keyDown('KeyS')
    expectPlaying(62)
    fireEvent.click(screen.getByRole('button', { name: 'C3' }), { detail: 1 })
    expectSilence()
    keyUp('KeyS')
    expectSilence()
  })

  it('when the piano is moved higher, and the key then plays the new note', () => {
    click(/Higher/)
    expect(settingsStore.get().baseOctave).toBe(4)
    expectSilence()
    // Still held: its auto-repeat must not start anything.
    keyDown('KeyA', { repeat: true })
    expectSilence()
    keyUp('KeyA')
    expectSilence()
    keyDown('KeyA')
    expectPlaying(C5)
    keyUp('KeyA')
    expectSilence()
  })

  it('when the piano is moved lower', () => {
    click(/Lower/)
    expect(settingsStore.get().baseOctave).toBe(2)
    expectSilence()
    keyUp('KeyA')
    expectSilence()
  })

  it('on release, after every setting was reset while it was held', () => {
    act(() => settingsStore.set({ baseOctave: 4, transpose: 5, sustain: true }))
    act(() => settingsStore.reset())
    keyUp('KeyA')
    expectSilence()
  })

  it('on release, after its key was given to another note while it was held', () => {
    act(() => settingsStore.set({ bindings: { KeyA: 0 } }))
    expectPlaying(C4)
    keyUp('KeyA')
    expectSilence()
  })

  it('on release, after the default keys were put back while it was held', () => {
    click('Customize keys')
    expectSilence()
    keyUp('KeyA')
    keyDown('KeyD')
    expectPlaying(64)
    click('Reset to default keys')
    click('Yes')
    keyUp('KeyD')
    expectSilence()
  })

  it('on release, when a second key started meanwhile', () => {
    keyDown('KeyD')
    expectPlaying(C4, 64)
    keyUp('KeyA')
    expectPlaying(64)
    keyUp('KeyD')
    expectSilence()
  })
})

describe('a note started with the pointer stops', () => {
  beforeEach(() => {
    startApp()
    pointer('pointerDown', 12)
    expectPlaying(C4)
  })

  it('when the pointer is released', () => {
    pointer('pointerUp', 12)
    expectSilence()
  })

  it('when the pointer is cancelled', () => {
    pointer('pointerCancel', 12)
    expectSilence()
  })

  it('when the piano loses the pointer it had captured', () => {
    pointer('lostPointerCapture', 12)
    expectSilence()
  })

  it('when a pointer that could not be captured leaves the piano', () => {
    pointer('pointerLeave', null)
    expectSilence()
  })

  it('when the pointer is dragged off the piano, and the next key plays when it comes back', () => {
    pointer('pointerMove', null)
    expectSilence()
    pointer('pointerMove', 14)
    expectPlaying(62)
    pointer('pointerUp', 14)
    expectSilence()
  })

  it('when it glides to another key: the first one is let go', () => {
    pointer('pointerMove', 13)
    expectPlaying(61)
    pointer('pointerUp', 13)
    expectSilence()
  })

  it('when the left button is let go while another mouse button stays down', () => {
    // Browsers report this as a move with the left button no longer in `buttons`.
    pointer('pointerMove', 12, { buttons: 2 })
    expectSilence()
  })

  it('when the window loses focus', () => {
    windowEvent('blur')
    expectSilence()
    pointer('pointerUp', 12)
    expectSilence()
  })

  it('when the tab is hidden', () => {
    hideTab()
    expectSilence()
    pointer('pointerUp', 12)
    expectSilence()
  })

  it('when the page is left (pagehide)', () => {
    windowEvent('pagehide')
    expectSilence()
  })

  it('when the app is unmounted', () => {
    cleanup()
    expect(held()).toEqual([])
    expect(sounding()).toEqual([])
  })

  it('when "Customize keys" is opened with the keyboard while the pointer is down', () => {
    // Enter on the focused button arrives as a click with detail 0.
    fireEvent.click(screen.getByRole('button', { name: 'Customize keys' }), { detail: 0 })
    expectSilence()
    // The pointer is still down: moving it must not play in edit mode.
    pointer('pointerMove', 14)
    expectSilence()
    pointer('pointerUp', 14)
    expectSilence()
  })

  it('when the piano is moved higher (a second finger on a touch screen)', () => {
    click(/Higher/)
    expectSilence()
    pointer('pointerMove', 14)
    expectSilence()
    pointer('pointerUp', 14)
    expectSilence()
  })

  it('when every setting is reset while it is down, on release', () => {
    act(() => settingsStore.set({ transpose: 3, sustain: true }))
    act(() => settingsStore.reset())
    pointer('pointerUp', 12)
    expectSilence()
  })
})

describe('several fingers and several inputs on one note', () => {
  beforeEach(() => {
    startApp()
  })

  it('two fingers on two keys are let go one by one', () => {
    pointer('pointerDown', 12, { pointerId: 11, pointerType: 'touch' })
    pointer('pointerDown', 16, { pointerId: 12, pointerType: 'touch' })
    expectPlaying(C4, 64)
    pointer('pointerUp', 12, { pointerId: 11, pointerType: 'touch' })
    expectPlaying(64)
    pointer('pointerUp', 16, { pointerId: 12, pointerType: 'touch' })
    expectSilence()
  })

  it('a note held by a key and by the mouse stops only when both let go', () => {
    keyDown('KeyA')
    pointer('pointerDown', 12)
    expectPlaying(C4)
    keyUp('KeyA')
    expectPlaying(C4)
    pointer('pointerUp', 12)
    expectSilence()
  })

  it('a note held by a key and by the mouse stops when the window loses focus', () => {
    keyDown('KeyA')
    pointer('pointerDown', 12)
    windowEvent('blur')
    expectSilence()
  })
})

describe('a note started through the bus (the way later phases will play notes) stops', () => {
  beforeEach(() => {
    startApp()
    act(() => bus.noteOn(C4, 'playback'))
    expectPlaying(C4)
    expect(litKeys()).toEqual(['C4, key A'])
  })

  it('when its source lets go', () => {
    act(() => bus.noteOff(C4, 'playback'))
    expectSilence()
  })

  it('when the tab is hidden', () => {
    hideTab()
    expectSilence()
  })

  it('when the page is left (pagehide)', () => {
    windowEvent('pagehide')
    expectSilence()
  })

  it('when the app is unmounted', () => {
    cleanup()
    expect(held()).toEqual([])
    expect(sounding()).toEqual([])
  })

  it('when "Customize keys" is opened', () => {
    click('Customize keys')
    expectSilence()
  })

  it('when the piano is moved lower or higher', () => {
    click(/Higher/)
    expectSilence()
  })

  it('and is not cut by a key-up of the same note on the computer keyboard', () => {
    keyDown('KeyA')
    keyUp('KeyA')
    expectPlaying(C4)
    act(() => bus.noteOff(C4, 'playback'))
    expectSilence()
  })
})

describe('the Labels drop-down', () => {
  it('gives the keyboard back to the piano when a choice is made', () => {
    startApp()
    const labels = screen.getByRole('combobox', { name: 'Labels' })
    labels.focus()
    fireEvent.change(labels, { target: { value: 'keys' } })
    expect(settingsStore.get().labelMode).toBe('keys')
    expect(document.activeElement).not.toBe(labels)
    keyDown('KeyA')
    expectPlaying(C4)
    keyUp('KeyA')
    expectSilence()
  })

  /*
   * A drop-down that still has the keyboard keeps every key for itself: the
   * piano plays nothing, and a letter changes the Labels setting. So it also
   * lets go when its list is closed without a new choice (spec 5.7: Escape,
   * or choosing the option it already shows).
   *
   * jsdom cannot open a list. Each test gives the drop-down the keyboard, as
   * opening the list does, and then sends what Chrome and Edge were seen to
   * send to the page when the list closes. For a key that is only its key-up:
   * the key-down goes to the open list and never reaches the page.
   */
  function openLabelsList(): HTMLElement {
    startApp()
    const labels = screen.getByRole('combobox', { name: 'Labels' })
    labels.focus()
    return labels
  }

  function expectPianoPlaysAgain(): void {
    expect(settingsStore.get().labelMode).toBe('both')
    keyDown('KeyA', { key: 'a' })
    expectPlaying(C4)
    keyUp('KeyA', { key: 'a' })
    expectSilence()
  }

  it('gives the keyboard back to the piano when it is closed with Escape without choosing', () => {
    openLabelsList()
    keyUp('Escape', { key: 'Escape' })
    expectPianoPlaysAgain()
  })

  it('gives the keyboard back to the piano when Enter confirms the choice it already shows', () => {
    openLabelsList()
    keyUp('Enter', { key: 'Enter' })
    expectPianoPlaysAgain()
  })

  it('gives the keyboard back to the piano when the choice it already shows is picked in the list', () => {
    const labels = openLabelsList()
    // A pick in the list arrives as a click that no mouse button made
    // (`detail` is 0), and with no `change` when the choice stays the same.
    fireEvent.click(labels, { detail: 0 })
    expectPianoPlaysAgain()
  })
})

describe('a key-up the operating system never delivers', () => {
  /*
   * macOS does not send the key-up of an ordinary key that is released while
   * Command is down (browsers there never fire `keyup` for it), and the window
   * does not lose focus either. Command sits right next to Space, the sustain
   * key. The test replays exactly what such a browser sends.
   */
  it('does not leave the note held once the Command key has been let go again', () => {
    startApp()
    keyDown('KeyA')
    expectPlaying(C4)

    keyDown('MetaLeft', { key: 'Meta', metaKey: true })
    // The player lets go of A here: on macOS no keyup event reaches the page.
    keyUp('MetaLeft', { key: 'Meta' })

    // Spec 5.5: releasing Meta releases every note the keyboard holds
    // (section 7: "No stuck notes, ever").
    expectSilence()

    // And the key plays again at its next press.
    keyDown('KeyA')
    expectPlaying(C4)
    keyUp('KeyA')
    expectSilence()
  })
})

describe('keys held across a move of the piano', () => {
  it('a key pressed and released after the move stops its note, even while an older key is still down', () => {
    startApp()
    keyDown('KeyA')
    expectPlaying(C4)
    // The piano moves one octave lower while A is held: A's note is let go (spec 5.7).
    click(/Lower/)
    expectSilence()

    // K (slot 24) now plays C4, the note A was playing before the move.
    expect(slotToMidi(24, settingsStore.get().baseOctave)).toBe(C4)
    keyDown('KeyK')
    expectPlaying(C4)
    keyUp('KeyK')
    // Spec 5.5: "on key up release that note". Nothing else is holding C4:
    // A's note ended when the piano moved.
    expectSilence()

    keyUp('KeyA')
    expectSilence()
  })
})
