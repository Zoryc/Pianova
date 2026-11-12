// @vitest-environment jsdom
/**
 * "No stuck notes" audit of the whole app in a simulated browser.
 *
 * For every way a note can start (computer keyboard, pointer, the bus API
 * that the song player uses, and a real song) each test starts a note and
 * then takes one of the exits the specs list (docs/ARCHITECTURE.md sections
 * 5.5 and 7, docs/INTERFACE.md sections 5.1, 5.5 and 7): key or pointer
 * release, window blur, tab hidden, pagehide, unmount, a pop-up of the
 * browser that takes the keyboard, choosing the computer keys (Settings, Keys
 * tab), moving the computer keys lower / higher, resetting the settings.
 * Afterwards nothing may be held on the bus, nothing may still be sounding in
 * the engine and no piano key may still be lit.
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
import { player } from './app/songsApp'
import { keyRects } from './core/pianoGeometry'
import { slotToMidi } from './core/layout'
import type { PianoRange } from './core/layout'
import { settingsStore } from './state/settings'
import { resetSongs } from './ui/songsTestKit'
import { LEAD_IN_SECONDS, playSong } from './ui/useSongs'

/** The size the piano box pretends to have (jsdom lays nothing out). */
const PIANO_BOX = { left: 100, top: 300, width: 1100, height: 200 }

const C4 = 60
const C5 = 72

/** A piano the tests are played on. */
interface TestPiano {
  name: string
  range: PianoRange
  /** Where C3 is on it, counted from its lowest key. C3 is where the computer keys start (slot 0). */
  placeOfC3: number
}

/**
 * The piano the simulated browser gets: the 37 keys the computer keyboard
 * reaches. When the computer keys move lower or higher it moves with them.
 */
const SMALL_PIANO: TestPiano = {
  name: 'the 37-key piano, which moves with the computer keys',
  range: { first: 48, last: 84 },
  placeOfC3: 0,
}

/** The piano with all its 88 keys. It stays as it is when the computer keys move. */
const FULL_PIANO: TestPiano = {
  name: 'the full piano, which stays as it is',
  range: { first: 21, last: 108 },
  placeOfC3: 27,
}

/** The piano the app of the running test was started on. */
let pianoOnScreen = SMALL_PIANO

beforeAll(() => {
  // jsdom has no canvas and no pointer capture. The sky then draws nothing,
  // and the piano falls back to its "pointer could not be captured" path.
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.hasPointerCapture = () => false
})

/** The tabs of the Settings panel. */
type SettingsTab = 'Sound' | 'Keys' | 'Piano' | 'Look' | 'About'

/**
 * Settings opens on the tab it was last on, also from one test to the next.
 * True when a test left it on another tab than the first one.
 */
let settingsLeftItsFirstTab = false

beforeEach(() => {
  // Every test finds Settings on its first tab (Sound), where opening the
  // panel changes nothing on the piano. Opened on Keys, it lets go of every note.
  if (settingsLeftItsFirstTab) {
    render(<App />)
    keyDown('Enter')
    keyUp('Enter')
    openSettingsOn('Sound')
    cleanup()
  }
  window.localStorage.clear()
  act(() => settingsStore.reset())
  bus.allOff()
  audio.reset()
  setVisibility('visible')
  pianoOnScreen = SMALL_PIANO
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

/**
 * A point of the piano box that lies on the key for `slot`: the key that many
 * keys above C3 on the piano the app was started on.
 */
function pointOnSlot(slot: number): { clientX: number; clientY: number } {
  const rect = keyRects(pianoOnScreen.range)[pianoOnScreen.placeOfC3 + slot]
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

/**
 * Draws the app and gets past the start overlay, as a player would. The
 * simulated browser gets the 37-key piano; the full one has to be asked for.
 */
function startApp(pianoToShow: TestPiano = SMALL_PIANO): ReturnType<typeof render> {
  if (pianoToShow === FULL_PIANO) act(() => settingsStore.set({ pianoSize: 88 }))
  pianoOnScreen = pianoToShow
  const view = render(<App />)
  keyDown('Enter')
  keyUp('Enter')
  expect(screen.queryByText('Click or press any key to start')).toBeNull()
  const { first, last } = pianoToShow.range
  expect(document.querySelectorAll('.piano-key')).toHaveLength(last - first + 1)
  return view
}

function click(name: string | RegExp): void {
  // `detail: 1` is what a real mouse click carries.
  fireEvent.click(screen.getByRole('button', { name }), { detail: 1 })
}

/** Enter on a focused control: the browser sends a click that no mouse button made (`detail` 0). */
function pressEnterOn(control: HTMLElement): void {
  control.focus()
  fireEvent.click(control, { detail: 0 })
}

function settingsPanel(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Settings' })
}

/** A click with the mouse on one of the tabs of Settings, which must be open. */
function chooseTab(tab: SettingsTab): void {
  fireEvent.click(screen.getByRole('tab', { name: tab }), { detail: 1 })
  settingsLeftItsFirstTab = tab !== 'Sound'
}

/** Opens Settings with the mouse, if it is not open, and shows one of its tabs. */
function openSettingsOn(tab: SettingsTab): void {
  if (!settingsPanel()) click('Settings')
  chooseTab(tab)
}

/**
 * True while the computer keys are being chosen: Settings is open on its Keys
 * tab, and a click on a piano key selects it instead of playing it.
 */
function isChoosingKeys(): boolean {
  return screen.getByRole('group', { name: 'Piano' }).classList.contains('piano--editing')
}

/** The drop-down for what is written on the piano keys, in the Piano tab of Settings. */
function labelsDropDown(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Labels on the keys' })
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

  /*
   * A drop-down's open list and the browser's colour picker keep every key to
   * themselves, key releases included, and the window does not lose focus. A
   * key let go at that moment never reaches the page, so its note stops as
   * soon as one of them takes over (ARCHITECTURE.md 7: "No stuck notes, ever").
   */
  it('when the Labels drop-down takes the keyboard, and the key-up that follows changes nothing', () => {
    openSettingsOn('Piano')
    // Settings is open on the tab with the drop-down, and the note is still held.
    expectPlaying(C4)
    act(() => labelsDropDown().focus())
    expect(document.activeElement).toBe(labelsDropDown())
    expectSilence()
    keyUp('KeyA')
    expectSilence()
  })

  it('when "Your colour" opens the colour picker, and the key plays again at its next press', () => {
    openSettingsOn('Look')
    expectPlaying(C4)
    fireEvent.click(screen.getByRole('radio', { name: 'Your colour' }), { detail: 1 })
    expect(settingsStore.get().accent).toBe('custom')
    expectSilence()

    // The picker kept the key-up to itself: for the page the key never came up.
    keyDown('KeyA')
    expectPlaying(C4)
    keyUp('KeyA')
    expectSilence()
  })

  it('but not when a ready-made colour is chosen: no pop-up takes the keyboard for that', () => {
    openSettingsOn('Look')
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }), { detail: 1 })
    expect(settingsStore.get().accent).toBe('blue')
    expectPlaying(C4)
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

  it('when the Keys tab of Settings is opened, where the computer keys are chosen', () => {
    click('Settings')
    // Settings alone lets the piano play on. Its Keys tab is what silences it.
    expect(isChoosingKeys()).toBe(false)
    expectPlaying(C4)
    chooseTab('Keys')
    expect(isChoosingKeys()).toBe(true)
    expectSilence()
    keyUp('KeyA')
    expectSilence()
  })

  it('when Settings opens straight on the Keys tab it was left on', () => {
    openSettingsOn('Keys')
    click('Close Settings')
    expect(isChoosingKeys()).toBe(false)
    keyUp('KeyA')
    keyDown('KeyA')
    expectPlaying(C4)

    click('Settings')
    expect(isChoosingKeys()).toBe(true)
    expectSilence()
    keyUp('KeyA')
    expectSilence()
  })

  it('when a piano key is selected in the Keys tab', () => {
    keyUp('KeyA')
    openSettingsOn('Keys')
    // With nothing selected the keyboard still plays.
    keyDown('KeyS')
    expectPlaying(62)
    fireEvent.click(screen.getByRole('button', { name: 'C3' }), { detail: 1 })
    expect(screen.getByRole('button', { name: 'C3' }).classList.contains('is-selected')).toBe(true)
    expectSilence()
    keyUp('KeyS')
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
    openSettingsOn('Keys')
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

  it('when the Keys tab of Settings is opened with the keyboard while the pointer is down', () => {
    pressEnterOn(screen.getByRole('button', { name: 'Settings' }))
    // The keyboard is now on the first tab of Settings, and the note is still held.
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Sound' }))
    expectPlaying(C4)
    // The arrow keys go from tab to tab: Keys is the one after Sound.
    keyDown('ArrowRight', { key: 'ArrowRight' })
    keyUp('ArrowRight', { key: 'ArrowRight' })
    settingsLeftItsFirstTab = true
    expect(isChoosingKeys()).toBe(true)
    expectSilence()
    // The pointer is still down: moving it must not play while the keys are being chosen.
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

describe('a note started through the bus (the way the song player plays notes) stops', () => {
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

  it('when the Keys tab of Settings is opened, where the computer keys are chosen', () => {
    click('Settings')
    expectPlaying(C4)
    chooseTab('Keys')
    expect(isChoosingKeys()).toBe(true)
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
    openSettingsOn('Piano')
    const labels = labelsDropDown()
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
   * lets go when its list is closed without a new choice (Escape, or choosing
   * the option it already shows). Settings stays open: the piano plays under it.
   *
   * jsdom cannot open a list. Each test gives the drop-down the keyboard, as
   * opening the list does, and then sends what Chrome and Edge were seen to
   * send to the page when the list closes. For a key that is only its key-up:
   * the key-down goes to the open list and never reaches the page.
   */
  function openLabelsList(): HTMLElement {
    startApp()
    openSettingsOn('Piano')
    const labels = labelsDropDown()
    labels.focus()
    expect(document.activeElement).toBe(labels)
    return labels
  }

  function expectPianoPlaysAgain(): void {
    expect(document.activeElement).not.toBe(labelsDropDown())
    expect(settingsPanel()).not.toBeNull()
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

/*
 * Two rules stop a note when the computer keys move lower or higher
 * (ARCHITECTURE.md 7): held notes are let go when the keys move, and when the
 * piano on screen becomes another one. On the 37-key piano both fire, because
 * that piano moves with the keys. The full piano stays as it is, so there the
 * first rule alone stops the note: each test runs on both.
 *
 * "Lower" and "Higher" are in the Keys tab of Settings. Opening that tab lets
 * go of every note, so the notes start under the open tab, where the piano
 * plays as long as no piano key is selected.
 */
describe.each([SMALL_PIANO, FULL_PIANO])(
  'a note stops when the computer keys are moved lower or higher, on $name',
  (pianoToShow) => {
    beforeEach(() => {
      startApp(pianoToShow)
    })

    function holdKeyAUnderTheKeysTab(): void {
      openSettingsOn('Keys')
      keyDown('KeyA')
      expectPlaying(C4)
      expect(litKeys()).toEqual(['C4, key A'])
    }

    it('started with the computer keyboard: moved higher, and the key then plays the new note', () => {
      holdKeyAUnderTheKeysTab()
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

    it('started with the computer keyboard: moved lower', () => {
      holdKeyAUnderTheKeysTab()
      click(/Lower/)
      expect(settingsStore.get().baseOctave).toBe(2)
      expectSilence()
      keyUp('KeyA')
      expectSilence()
    })

    /*
     * "Lower" and "Higher" cannot be reached while the mouse holds a note: in
     * the Keys tab a click on the piano selects a key. The computer keys still
     * move under a held note when a song that needs them elsewhere is loaded,
     * or when they are moved in another browser tab. Both write the same
     * setting, as here.
     */
    it('started with the pointer: moved higher while the pointer is down', () => {
      pointer('pointerDown', 12)
      expectPlaying(C4)
      act(() => settingsStore.set({ baseOctave: 4 }))
      expectSilence()
      // The button is still down: moving and letting go starts nothing.
      pointer('pointerMove', 14)
      expectSilence()
      pointer('pointerUp', 14)
      expectSilence()
    })

    it.each([
      ['higher', /Higher/, 4],
      ['lower', /Lower/, 2],
    ] as const)(
      'started through the bus, the way the song player plays notes: moved %s',
      (_direction, buttonName, octave) => {
        openSettingsOn('Keys')
        act(() => bus.noteOn(C4, 'playback'))
        expectPlaying(C4)
        expect(litKeys()).toEqual(['C4, key A'])

        click(buttonName)
        expect(settingsStore.get().baseOctave).toBe(octave)
        expectSilence()
      },
    )

    it('and a key pressed and released after the move stops its note, even while an older key is still down', () => {
      holdKeyAUnderTheKeysTab()
      // The computer keys move one octave lower while A is held: A's note is let go.
      click(/Lower/)
      expect(settingsStore.get().baseOctave).toBe(2)
      expectSilence()

      // K (slot 24) now plays C4, the note A was playing before the move.
      expect(slotToMidi(24, settingsStore.get().baseOctave)).toBe(C4)
      keyDown('KeyK')
      expectPlaying(C4)
      keyUp('KeyK')
      // ARCHITECTURE.md 5.5: "on key up release that note". Nothing else is
      // holding C4: A's note ended when the computer keys moved.
      expectSilence()

      keyUp('KeyA')
      expectSilence()
    })
  },
)

/*
 * A real song, played by the app's own player. It sounds its first note
 * (middle C) once its lead-in is over.
 */
describe('a song that is playing', () => {
  const TWINKLE = 'starter:twinkle-twinkle-little-star'
  /** From "Play" to a moment in the middle of the song's first note. */
  const INTO_THE_FIRST_NOTE_MS = LEAD_IN_SECONDS * 1000 + 100

  /** The notes the song has started since the test last emptied this list. */
  const startedBySong: number[] = []
  let stopListening: () => void = () => {}

  beforeEach(async () => {
    await resetSongs()
    vi.useFakeTimers()
    startedBySong.length = 0
    stopListening = bus.subscribe((event) => {
      if (event.type === 'on' && event.source === 'playback') startedBySong.push(event.midi)
    })
  })

  afterEach(async () => {
    stopListening()
    cleanup()
    vi.useRealTimers()
    await resetSongs()
  })

  function wait(milliseconds: number): void {
    act(() => {
      vi.advanceTimersByTime(milliseconds)
    })
  }

  /** Starts the app and the song, and waits until the song holds its first note. */
  function playUntilFirstNote(): void {
    startApp()
    act(() => {
      expect(playSong(TWINKLE)).toBe(true)
    })
    wait(INTO_THE_FIRST_NOTE_MS)
    expect(player.getState().status).toBe('playing')
    expectPlaying(C4)
    expect(litKeys()).toEqual(['C4, key A'])
  }

  /** The song is paused where it was, and none of its notes starts in the seconds that follow. */
  function expectTheSongWaits(place: number): void {
    expect(player.getState().status).toBe('paused')
    expectSilence()
    wait(3000)
    expectSilence()
    expect(player.getPosition()).toBeCloseTo(place, 2)
  }

  /*
   * INTERFACE.md 5.5: opening the Keys tab, and selecting a piano key there,
   * pauses a song that is playing. Letting go of its notes would not be
   * enough: the song would start its next note a moment later, while the
   * piano is meant to wait quietly. The song stays loaded, and "Play" carries
   * on from the same place.
   */
  it('is paused when the Keys tab of Settings opens, and "Play" carries on from there', () => {
    playUntilFirstNote()
    const place = player.getPosition()

    openSettingsOn('Keys')
    expect(isChoosingKeys()).toBe(true)
    expectTheSongWaits(place)

    startedBySong.length = 0
    click('Play')
    expect(player.getState().status).toBe('playing')
    wait(3000)
    expect(startedBySong.length).toBeGreaterThan(0)
    expect(player.getPosition()).toBeCloseTo(place + 3, 1)
  })

  it('is paused again when a piano key is selected, after "Play" under the Keys tab', () => {
    playUntilFirstNote()
    openSettingsOn('Keys')
    click('Play')
    wait(1000)
    expect(player.getState().status).toBe('playing')
    const place = player.getPosition()

    fireEvent.click(screen.getByRole('button', { name: 'C3' }), { detail: 1 })
    expect(screen.getByRole('button', { name: 'C3' }).classList.contains('is-selected')).toBe(true)
    expectTheSongWaits(place)
  })

  it.each(['Sound', 'Piano', 'Look', 'About'] as const)(
    'plays on under the %s tab of Settings',
    (tab) => {
      playUntilFirstNote()
      startedBySong.length = 0

      openSettingsOn(tab)
      expect(isChoosingKeys()).toBe(false)
      expect(player.getState().status).toBe('playing')
      expectPlaying(C4)
      wait(3000)
      expect(player.getState().status).toBe('playing')
      expect(startedBySong.length).toBeGreaterThan(0)
    },
  )

  // SONGS.md 4.5: the player pauses when the page is hidden. A page that is
  // being left is treated the same way.
  it.each([
    ['the tab is hidden', hideTab],
    ['the page is left (pagehide)', () => windowEvent('pagehide')],
  ])('is paused when %s, and starts no note on a page nobody sees', (_exit, leave) => {
    playUntilFirstNote()
    const place = player.getPosition()

    leave()
    expectTheSongWaits(place)
  })
})
