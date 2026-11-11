// @vitest-environment jsdom
/**
 * The whole app in a simulated browser, driven with real key and mouse
 * events: from a computer key to a note on the bus and on the screen, and the
 * "Customize keys" flow. The sound engine is replaced by a silent stand-in.
 *
 * Keys are sent by physical position: '[KeyA>]' holds the A key down,
 * '[/KeyA]' lets it go and '[KeyA]' taps it.
 */
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const calls: string[] = []
  const listeners = new Set<() => void>()
  let status = 'idle'
  const engine = {
    start(): Promise<void> {
      calls.push('start')
      status = 'ready'
      for (const listener of [...listeners]) listener()
      return Promise.resolve()
    },
    getStatus: () => status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    noteOn(midi: number): void {
      calls.push(`on:${midi}`)
    },
    noteOff(midi: number): void {
      calls.push(`off:${midi}`)
    },
    setSustain(): void {},
    setVolume(): void {},
    setTranspose(): void {},
    setReverb(): void {},
    setRelease(): void {},
    allNotesOff(): void {},
    dispose(): void {},
  }
  return {
    engine,
    calls,
    reset(): void {
      calls.length = 0
      status = 'idle'
    },
  }
})

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

import { App } from './App'
import { bus } from './app/pianoApp'
import type { NoteEvent } from './core/types'
import { DEFAULT_BINDINGS } from './input/keymap'
import { DEFAULT_SETTINGS, STORAGE_KEY, createSettingsStore, settingsStore } from './state/settings'
import { KEYS_RESET_MESSAGE, UNUSABLE_KEY_MESSAGE } from './ui/keyEditorModel'

type User = ReturnType<typeof userEvent.setup>

const START_TEXT = 'Click or press any key to start'
const EDITOR_INSTRUCTION = 'Click a piano key, then press the key you want to use for it.'

/** Every note the bus has announced since the test began, e.g. ['on:60', 'off:60']. */
let notes: string[] = []
let stopRecording: () => void = () => {}

beforeAll(() => {
  // jsdom has no canvas and no pointer capture. The light trails then draw
  // nothing, and the piano falls back on its own safety nets.
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
  const element = Element.prototype as Partial<Element>
  element.setPointerCapture ??= () => {}
  element.releasePointerCapture ??= () => {}
  element.hasPointerCapture ??= () => false
})

beforeEach(() => {
  audio.reset()
  window.localStorage.clear()
  settingsStore.reset()
  notes = []
  stopRecording = bus.subscribe((event: NoteEvent) => {
    notes.push(`${event.type}:${event.midi}`)
  })
})

afterEach(() => {
  cleanup()
  stopRecording()
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

function drawApp(): User {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  return userEvent.setup()
}

/** Draws the app and gets past the start overlay with a click, as most players do. */
async function startApp(): Promise<User> {
  const user = drawApp()
  await user.click(screen.getByText(START_TEXT))
  notes.length = 0
  audio.calls.length = 0
  return user
}

/** The notes the bus says are held, lowest first. */
function held(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

/** A key of the on-screen piano, by what a screen reader calls it ("C4, key A"). */
function pianoKey(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

function isSustainOn(): boolean {
  return settingsStore.get().sustain
}

/** The note names written on the "now playing" line. */
function nowPlaying(): string[] {
  const list = screen.queryByRole('list', { name: 'Notes being played' })
  return list ? [...list.querySelectorAll('li')].map((item) => item.textContent ?? '') : []
}

function editorPanel(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Customize keys' })
}

/** The first line of the "Customize keys" panel: the instruction, or "Press a key for C4…". */
function editorLead(): string {
  return editorPanel()?.querySelector('.key-editor__lead')?.textContent ?? ''
}

/** What the "Customize keys" panel says the last action did. */
function editorMessage(): string {
  return editorPanel()?.querySelector('[role="status"]')?.textContent ?? ''
}

async function openEditor(user: User): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Customize keys' }))
  expect(editorLead()).toBe(EDITOR_INSTRUCTION)
}

/** Opens "Customize keys" and clicks a piano key, which then waits for a computer key. */
async function selectPianoKey(user: User, name: string, note: string): Promise<void> {
  if (editorPanel() === null) await openEditor(user)
  await user.click(pianoKey(name))
  expect(editorLead()).toBe(`Press a key for ${note}…`)
}

function withoutKey(bindings: Readonly<Record<string, number>>, code: string): Record<string, number> {
  return Object.fromEntries(Object.entries(bindings).filter(([boundCode]) => boundCode !== code))
}

/** A repeat of a key that is being held down, as the keyboard sends them. */
function repeatKey(code: string, key = ''): boolean {
  return fireEvent.keyDown(document.activeElement ?? document.body, { code, key, repeat: true })
}

function setPageVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  fireEvent(document, new Event('visibilitychange'))
}

describe('the start overlay', () => {
  it('starts the sound on the first key press, which plays nothing, even once released', async () => {
    const user = drawApp()

    await user.keyboard('[KeyA>]')

    expect(audio.calls.filter((call) => call === 'start')).toHaveLength(1)
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(notes).toEqual([])

    // The key goes up after the overlay is gone.
    await user.keyboard('[/KeyA]')
    expect(notes).toEqual([])
    expect(held()).toEqual([])

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])
  })

  it('does not play the repeats of the key that started the sound', async () => {
    const user = drawApp()

    await user.keyboard('[KeyA>5]')
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(notes).toEqual([])

    await user.keyboard('[/KeyA]')
    expect(notes).toEqual([])
  })

  it('does not treat Space as the sustain key when it is the first key', async () => {
    const user = drawApp()

    await user.keyboard('[Space>3/]')

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(isSustainOn()).toBe(false)

    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(true)
  })

  it.each(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ShiftLeft'])(
    'starts on %s without doing anything else',
    async (code) => {
      const user = drawApp()

      await user.keyboard(`[${code}]`)

      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(editorPanel()).toBeNull()
      expect(notes).toEqual([])
      expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    },
  )

  it('starts on a click and leaves the keyboard to the piano', async () => {
    const user = drawApp()

    await user.click(screen.getByText(START_TEXT))
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.activeElement).toBe(document.body)

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
  })

  it('survives a first key press that has no code', async () => {
    drawApp()

    fireEvent.keyDown(document.body, { code: '', key: 'a' })
    fireEvent.keyUp(document.body, { code: '', key: 'a' })

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(notes).toEqual([])
  })

  it('leaves browser shortcuts alone while the overlay is up', async () => {
    drawApp()

    const unprevented = fireEvent.keyDown(document.body, { code: 'KeyR', key: 'r', ctrlKey: true })

    expect(unprevented).toBe(true)
    expect(notes).toEqual([])
  })
})

describe('from a computer key to the screen', () => {
  it('plays the note, lights its key and names it, then lets all of it go', async () => {
    const user = await startApp()

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
    expect(audio.calls).toEqual(['on:60'])
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('true')
    expect(nowPlaying()).toEqual(['C4'])

    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])
    expect(audio.calls).toEqual(['on:60', 'off:60'])
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('false')
    expect(nowPlaying()).toEqual([])
  })

  it('plays a chord and releases each key on its own', async () => {
    const user = await startApp()

    await user.keyboard('[KeyA>][KeyD>][KeyG>]')
    expect(held()).toEqual([60, 64, 67])
    expect(nowPlaying()).toEqual(['C4', 'E4', 'G4'])

    await user.keyboard('[/KeyD]')
    expect(held()).toEqual([60, 67])

    await user.keyboard('[/KeyA][/KeyG]')
    expect(held()).toEqual([])
  })

  it('starts one note per key press however long the key is held', async () => {
    const user = await startApp()

    await user.keyboard('[KeyA>6]')
    expect(notes).toEqual(['on:60'])
    expect(audio.calls).toEqual(['on:60'])

    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])
  })

  it('plays the same note with Shift held, and with Shift let go first', async () => {
    const user = await startApp()

    await user.keyboard('{Shift>}[KeyA>]')
    expect(notes).toEqual(['on:60'])

    await user.keyboard('{/Shift}[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])
  })

  it.each(['Control', 'Alt', 'Meta'])(
    'leaves %s shortcuts to the browser and plays nothing for them',
    async (modifier) => {
      const user = await startApp()

      await user.keyboard(`{${modifier}>}[KeyA>]`)
      expect(notes).toEqual([])

      // The modifier goes up first: the repeats of the letter still play nothing.
      await user.keyboard(`{/${modifier}}`)
      repeatKey('KeyA', 'a')
      expect(notes).toEqual([])

      await user.keyboard('[/KeyA]')
      expect(notes).toEqual([])

      await user.keyboard('[KeyA]')
      expect(notes).toEqual(['on:60', 'off:60'])
    },
  )

  it.each(['Control', 'Alt', 'Meta'])(
    'still releases a note when %s is pressed while it sounds',
    async (modifier) => {
      const user = await startApp()

      // The modifier going down does not cut the note…
      await user.keyboard(`[KeyA>]{${modifier}>}`)
      expect(held()).toEqual([60])

      // …and the letter's own key up stops it, modifier or not.
      await user.keyboard(`[/KeyA]{/${modifier}}`)
      expect(notes).toEqual(['on:60', 'off:60'])
      expect(held()).toEqual([])
    },
  )

  it('ignores key presses that carry no code, without stopping the notes being held', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')

    const downUnprevented = fireEvent.keyDown(document.body, { code: '', key: 'x' })
    const upUnprevented = fireEvent.keyUp(document.body, { code: '', key: 'x' })

    expect(downUnprevented).toBe(true)
    expect(upUnprevented).toBe(true)
    expect(notes).toEqual(['on:60'])

    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
  })

  it('leaves keys that play nothing to the browser', async () => {
    await startApp()

    expect(fireEvent.keyDown(document.body, { code: 'KeyZ', key: 'z' })).toBe(true)
    expect(fireEvent.keyDown(document.body, { code: 'ArrowDown', key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(document.body, { code: 'F5', key: 'F5' })).toBe(true)
    // A key that plays a note must not also scroll, type or open quick find.
    expect(fireEvent.keyDown(document.body, { code: 'Quote', key: "'" })).toBe(false)
    expect(notes).toEqual(['on:77'])
  })

  /*
   * The saved keys are an object, and every object answers to names such as
   * "constructor". A key press that carries one of them as its code (only a
   * script can send it) is a key that plays nothing, like any other.
   */
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'does not take "%s" for a key that plays a note',
    async (code) => {
      await startApp()

      expect(fireEvent.keyDown(document.body, { code })).toBe(true)
      fireEvent.keyUp(document.body, { code })

      expect(notes).toEqual([])
      expect(held()).toEqual([])
    },
  )
})

describe('no stuck notes', () => {
  it('releases held keys when the window loses focus, and ignores them until pressed again', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>][KeyS>]')

    fireEvent.blur(window)
    expect(notes).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
    expect(nowPlaying()).toEqual([])

    // Back in the window with the keys still down.
    repeatKey('KeyA', 'a')
    await user.keyboard('[/KeyA][/KeyS]')
    expect(notes).toHaveLength(4)

    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])
  })

  it('releases held keys when the tab is hidden', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')

    try {
      setPageVisibility('hidden')
      expect(notes).toEqual(['on:60', 'off:60'])
    } finally {
      setPageVisibility('visible')
    }

    await user.keyboard('[/KeyA][KeyA>]')
    expect(notes).toEqual(['on:60', 'off:60', 'on:60'])
  })

  it('releases held keys when the page is left', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>][KeyD>]')

    fireEvent(window, new Event('pagehide'))

    expect(held()).toEqual([])
    expect(notes).toEqual(['on:60', 'on:64', 'off:60', 'off:64'])
  })

  it('releases held keys when the piano moves higher, and plays the new note next time', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')

    await user.click(screen.getByRole('button', { name: /Higher/ }))
    expect(notes).toEqual(['on:60', 'off:60'])
    expect(nowPlaying()).toEqual([])

    repeatKey('KeyA', 'a')
    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60', 'off:60', 'on:72'])
    expect(pianoKey('C5, key A').getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
  })

  /*
   * Spec 5.5: "on key up release that note", and a key whose note was
   * released by someone else no longer counts as holding it. K is held (C5)
   * while the piano is moved higher, which silences it. A now plays C5:
   * tapping A must start and stop it, whatever K is doing.
   */
  it('releases a note on key up after the piano moved while another key was held', async () => {
    const user = await startApp()
    await user.keyboard('[KeyK>]')
    expect(held()).toEqual([72])

    await user.click(screen.getByRole('button', { name: /Higher/ }))
    expect(held()).toEqual([])

    // K is still down. A is the C5 key now.
    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([72])

    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
    expect(nowPlaying()).toEqual([])
  })

  it('releases held keys when "Customize keys" is opened', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')

    await user.click(screen.getByRole('button', { name: 'Customize keys' }))

    expect(notes).toEqual(['on:60', 'off:60'])
    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])
  })

  it('releases held keys when the app goes away, and stops listening', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')

    cleanup()
    expect(notes).toEqual(['on:60', 'off:60'])

    await user.keyboard('[/KeyA][KeyS>][Space]')
    expect(notes).toEqual(['on:60', 'off:60'])
    expect(isSustainOn()).toBe(false)
  })
})

describe('Space, the sustain key', () => {
  it('toggles sustain once per tap with nothing focused, and shows it', async () => {
    const user = await startApp()
    const sustain = screen.getByRole('switch', { name: 'Sustain' })

    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(true)
    expect(sustain.getAttribute('aria-checked')).toBe('true')

    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(false)
    expect(sustain.getAttribute('aria-checked')).toBe('false')
  })

  it('does not toggle again while Space is held down', async () => {
    const user = await startApp()

    await user.keyboard('[Space>6/]')

    expect(isSustainOn()).toBe(true)
    expect(notes).toEqual([])
  })

  it('toggles once and does not press the button that has focus', async () => {
    const user = await startApp()
    const advanced = screen.getByRole('button', { name: /Advanced/ })
    advanced.focus()

    await user.keyboard('[Space]')

    expect(isSustainOn()).toBe(true)
    expect(advanced.getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles exactly once when the Sustain switch itself has focus', async () => {
    const user = await startApp()
    screen.getByRole('switch', { name: 'Sustain' }).focus()

    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(true)

    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(false)
  })

  it('toggles once when the volume slider has focus, and leaves the volume alone', async () => {
    const user = await startApp()
    const volume = screen.getByRole('slider', { name: 'Volume' })
    volume.focus()

    await user.keyboard('[Space]')

    expect(isSustainOn()).toBe(true)
    expect(settingsStore.get().volume).toBe(0.8)
    expect(document.activeElement).toBe(volume)
  })

  it('still plays notes while a button or a slider has focus', async () => {
    const user = await startApp()

    screen.getByRole('button', { name: /Advanced/ }).focus()
    await user.keyboard('[KeyA]')
    screen.getByRole('slider', { name: 'Volume' }).focus()
    await user.keyboard('[KeyS]')

    expect(notes).toEqual(['on:60', 'off:60', 'on:62', 'off:62'])
  })

  it('does one thing only on a piano key that has focus in "Customize keys"', async () => {
    const user = await startApp()
    await openEditor(user)
    const key = pianoKey('C4, key A')
    key.focus()

    await user.keyboard('[Space]')

    // Two rules meet here: Space presses a focused button, and Space is the
    // sustain key. Whichever of them the app follows, one tap must not do both.
    const chosen = key.getAttribute('aria-pressed') === 'true'
    expect([chosen, isSustainOn()].filter(Boolean)).toHaveLength(1)
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
  })

  it('is refused as a key for a note, without toggling sustain', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.keyboard('[Space]')

    expect(isSustainOn()).toBe(false)
    expect(editorMessage()).toBe(UNUSABLE_KEY_MESSAGE)
    expect(editorLead()).toBe('Press a key for C4…')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
  })

  it('toggles sustain in "Customize keys" while no piano key is waiting', async () => {
    const user = await startApp()
    await openEditor(user)

    await user.keyboard('[Space]')

    expect(isSustainOn()).toBe(true)
  })
})

describe('focus goes back to the piano', () => {
  it('lets go of a button that was clicked, so Enter does not press it again', async () => {
    const user = await startApp()

    await user.click(screen.getByRole('button', { name: /Higher/ }))
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(document.activeElement).toBe(document.body)

    await user.keyboard('[Enter][Space]')
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(isSustainOn()).toBe(true)
  })

  it('lets go of the Labels list once a choice is made, so the keys play again', async () => {
    const user = await startApp()
    const labels = screen.getByRole('combobox', { name: 'Labels' })

    await user.selectOptions(labels, 'Keys only')
    expect(settingsStore.get().labelMode).toBe('keys')
    expect(document.activeElement).not.toBe(labels)

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
  })

  /*
   * Spec 5.7: the Labels list must not keep the keyboard once the player is
   * done with it, "so the player can go straight back to playing". A list
   * that is opened and closed again without a new choice announces no
   * change. If it kept the keyboard, the piano would stay silent, and in a
   * real browser the letters K and N would change the Labels choice.
   *
   * The simulated browser has no list to open, so the three tests below send
   * the page what Chrome and Edge send it in each case.
   */
  it('plays again at once after the Labels list is closed with Escape', async () => {
    const user = await startApp()
    const labels = screen.getByRole('combobox', { name: 'Labels' })

    await user.click(labels)
    expect(document.activeElement).toBe(labels)
    // The open list keeps the key down to itself: the page only sees the key come up.
    fireEvent.keyUp(labels, { code: 'Escape', key: 'Escape' })
    expect(document.activeElement).not.toBe(labels)

    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])
    expect(settingsStore.get().labelMode).toBe('both')
  })

  it('plays again at once after the choice the Labels list already shows is picked again', async () => {
    const user = await startApp()
    const labels = screen.getByRole('combobox', { name: 'Labels' })

    await user.click(labels)
    expect(document.activeElement).toBe(labels)
    // Picking a choice in the list reaches the page as a click that no mouse button made.
    fireEvent.click(labels, { detail: 0 })
    expect(document.activeElement).not.toBe(labels)

    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])
    expect(settingsStore.get().labelMode).toBe('both')
  })

  it('gives the keyboard back at the next key when the Labels list was closed by a click elsewhere', async () => {
    const user = await startApp()
    const labels = screen.getByRole('combobox', { name: 'Labels' })

    // The page is told nothing about a click that closes an open list: all it
    // knows is that the list was clicked and still has the keyboard.
    await user.click(labels)
    expect(document.activeElement).toBe(labels)

    // K must not be left to the list, which would jump to "Keys only".
    expect(fireEvent.keyDown(labels, { code: 'KeyK', key: 'k' })).toBe(false)
    fireEvent.keyUp(document.activeElement ?? document.body, { code: 'KeyK', key: 'k' })
    expect(document.activeElement).not.toBe(labels)
    expect(settingsStore.get().labelMode).toBe('both')

    // At the latest the second key press sounds.
    await user.keyboard('[KeyK>]')
    expect(held()).toEqual([72])
  })
})

describe('Customize keys', () => {
  it('gives a computer key to the piano key that was clicked, and saves it', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C3', 'C3')
    expect(pianoKey('C3').getAttribute('aria-pressed')).toBe('true')

    await user.keyboard('[KeyZ]')

    expect(settingsStore.get().bindings).toEqual({ ...DEFAULT_BINDINGS, KeyZ: 0 })
    expect(editorMessage()).toBe('"Z" now plays C3.')
    expect(editorLead()).toBe(EDITOR_INSTRUCTION)
    expect(pianoKey('C3, key Z').getAttribute('aria-pressed')).toBe('false')
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      bindings?: Record<string, number>
    }
    expect(saved.bindings?.KeyZ).toBe(0)
    // What the next visit will load.
    expect(createSettingsStore(window.localStorage).get().bindings.KeyZ).toBe(0)
  })

  it('plays nothing for the key press that was captured, its repeats or its release', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C3', 'C3')

    await user.keyboard('[KeyZ>4]')
    expect(settingsStore.get().bindings.KeyZ).toBe(0)
    expect(notes).toEqual([])

    await user.keyboard('[/KeyZ]')
    expect(notes).toEqual([])

    // From the next press on it is an ordinary key.
    await user.keyboard('[KeyZ>]')
    expect(notes).toEqual(['on:48'])
    await user.keyboard('[/KeyZ]')
    expect(held()).toEqual([])
  })

  it('lets the keyboard play as usual while no piano key is waiting', async () => {
    const user = await startApp()
    await openEditor(user)

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
  })

  // The spec does not cover a key that is held while a piano key is clicked.
  // The app's choice: its note is let go, and its repeats are not a choice of key.
  it('goes quiet when a piano key is clicked, and does not capture a key that was already down', async () => {
    const user = await startApp()
    await openEditor(user)
    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])

    await selectPianoKey(user, 'D4, key S', 'D4')
    expect(held()).toEqual([])

    // A is still down and keeps repeating: that is not the player choosing it.
    repeatKey('KeyA', 'a')
    repeatKey('KeyA', 'a')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
    expect(editorLead()).toBe('Press a key for D4…')

    await user.keyboard('[/KeyA]')
    expect(editorLead()).toBe('Press a key for D4…')
    expect(notes).toEqual(['on:60', 'off:60'])
  })

  it('moves a key that already played another note, and says what changed', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'D4, key S', 'D4')

    await user.keyboard('[KeyA]')

    const { bindings } = settingsStore.get()
    expect(bindings.KeyA).toBe(14)
    expect(Object.hasOwn(bindings, 'KeyS')).toBe(false)
    expect(editorMessage()).toBe('"A" now plays D4. "S" no longer plays a note. C4 has no key now.')
    expect(pianoKey('D4, key A')).toBeTruthy()
    expect(pianoKey('C4')).toBeTruthy()

    await user.keyboard('[KeyS][KeyA>]')
    expect(notes).toEqual(['on:62'])
  })

  it('accepts the key the note already has', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.keyboard('[KeyA]')

    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(editorMessage()).toBe('"A" now plays C4.')
    expect(editorLead()).toBe(EDITOR_INSTRUCTION)
  })

  // The spec does not cover an Escape that is held down. The app's choice:
  // its repeats do not go on to close the panel.
  it('cancels on Escape, and closes on the next Escape only once the first was let go', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.keyboard('[Escape>]')
    expect(editorLead()).toBe(EDITOR_INSTRUCTION)

    repeatKey('Escape', 'Escape')
    expect(editorPanel()).not.toBeNull()

    await user.keyboard('[/Escape][Escape]')
    expect(editorPanel()).toBeNull()
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
    expect(notes).toEqual([])
  })

  it.each(['Backspace', 'Delete'])('removes the key of the note on %s', async (code) => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.keyboard(`[${code}]`)

    expect(Object.hasOwn(settingsStore.get().bindings, 'KeyA')).toBe(false)
    expect(editorMessage()).toBe('C4 has no key now.')
    expect(editorLead()).toBe(EDITOR_INSTRUCTION)
    expect(pianoKey('C4')).toBeTruthy()

    await user.keyboard('[KeyA]')
    expect(notes).toEqual([])
  })

  it.each(['Enter', 'Tab', 'ArrowLeft', 'CapsLock', 'PageDown'])(
    'refuses %s and keeps waiting',
    async (code) => {
      const user = await startApp()
      await selectPianoKey(user, 'C4, key A', 'C4')

      await user.keyboard(`[${code}]`)

      expect(editorMessage()).toBe(UNUSABLE_KEY_MESSAGE)
      expect(editorLead()).toBe('Press a key for C4…')
      expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)

      await user.keyboard('[KeyZ]')
      expect(settingsStore.get().bindings.KeyZ).toBe(12)
    },
  )

  // The spec lists the F-keys among the keys to refuse. That the browser
  // still gets them (F5 reloads the page) is the app's choice.
  it('refuses function keys but leaves them to the browser', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    const unprevented = fireEvent.keyDown(document.body, { code: 'F5', key: 'F5' })

    expect(unprevented).toBe(true)
    expect(editorMessage()).toBe(UNUSABLE_KEY_MESSAGE)
    expect(editorLead()).toBe('Press a key for C4…')
  })

  it.each(['Control', 'Alt', 'Meta'])(
    'does not capture a key pressed with %s',
    async (modifier) => {
      const user = await startApp()
      await selectPianoKey(user, 'C4, key A', 'C4')

      await user.keyboard(`{${modifier}>}[KeyZ]{/${modifier}}`)

      expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
      expect(editorLead()).toBe('Press a key for C4…')
      expect(editorMessage()).toBe('')
      expect(notes).toEqual([])
    },
  )

  it('captures a key pressed with Shift as the key itself', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C3', 'C3')

    await user.keyboard('{Shift>}[KeyZ]{/Shift}')

    expect(settingsStore.get().bindings.KeyZ).toBe(0)
    expect(pianoKey('C3, key Z')).toBeTruthy()

    await user.keyboard('[KeyZ>]')
    expect(notes).toEqual(['on:48'])
  })

  // The spec says to save the character the new key types. A dead key types
  // none; that the older saved label of that key is then dropped is the app's choice.
  it('captures a dead key and labels it with what a US keyboard prints', async () => {
    const user = await startApp()
    settingsStore.set({ customLabels: { BracketLeft: 'Ü' } })
    await selectPianoKey(user, 'C3', 'C3')

    fireEvent.keyDown(document.body, { code: 'BracketLeft', key: 'Dead' })
    fireEvent.keyUp(document.body, { code: 'BracketLeft', key: 'Dead' })

    expect(settingsStore.get().bindings.BracketLeft).toBe(0)
    expect(settingsStore.get().customLabels).toEqual({})
    expect(editorMessage()).toBe('"[" now plays C3.')
    expect(pianoKey('C3, key [')).toBeTruthy()
  })

  it('refuses a key press that carries no code, and keeps waiting', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    fireEvent.keyDown(document.body, { code: '', key: 'q' })
    fireEvent.keyUp(document.body, { code: '', key: 'q' })

    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
    expect(settingsStore.get().customLabels).toEqual({})
    expect(editorLead()).toBe('Press a key for C4…')
    expect(editorMessage()).toBe(UNUSABLE_KEY_MESSAGE)
    expect(notes).toEqual([])
  })

  it('forgets the waiting piano key when "Done" is clicked', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(editorPanel()).toBeNull()

    await user.keyboard('[KeyZ][KeyA]')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
    expect(notes).toEqual(['on:60', 'off:60'])

    await openEditor(user)
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('false')
    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
  })

  it('forgets the waiting piano key when the "Customize keys" button closes the panel', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.click(screen.getByRole('button', { name: 'Customize keys' }))
    expect(editorPanel()).toBeNull()

    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
  })

  // The spec does not say what the reset does to a piano key that is waiting,
  // or what the panel says afterwards. The app's choice: nothing is waiting
  // any more, and the panel says that the default keys are back.
  it('puts the default keys back, also while a piano key is waiting', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')
    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    await selectPianoKey(user, 'D4, key S', 'D4')

    await user.click(screen.getByRole('button', { name: 'Reset to default keys' }))
    // Nothing is reset before the answer.
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(settingsStore.get().customLabels).toEqual({})
    expect(editorMessage()).toBe(KEYS_RESET_MESSAGE)
    expect(editorLead()).toBe(EDITOR_INSTRUCTION)

    // No piano key is waiting any more: the next key plays instead of being captured.
    await user.keyboard('[KeyX][KeyA>]')
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(notes).toEqual(['on:60'])
  })

  it('lets go of the note of a key that is held while the default keys are put back', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')
    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings).toEqual({ ...withoutKey(DEFAULT_BINDINGS, 'KeyA'), KeyZ: 12 })

    // No piano key is waiting, so Z plays its new note. It is held during the reset.
    await user.keyboard('[KeyZ>]')
    expect(notes).toEqual(['on:60'])
    await user.click(screen.getByRole('button', { name: 'Reset to default keys' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    expect(held()).toEqual([60])

    // A plays that note again. The spec does not cover two held keys on one
    // note; the app's choice is that they share it until both are up.
    await user.keyboard('[KeyA>]')
    repeatKey('KeyZ', 'z')
    await user.keyboard('[/KeyZ]')
    expect(held()).toEqual([60])
    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
    expect(audio.calls).toEqual(['on:60', 'off:60'])

    // Z plays nothing any more.
    await user.keyboard('[KeyZ]')
    expect(audio.calls).toEqual(['on:60', 'off:60'])
  })

  it('uses up the key presses it handles, and only those', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    // Refused, cancelled, removed or captured: the browser must not act on them too.
    expect(fireEvent.keyDown(document.body, { code: 'Space', key: ' ' })).toBe(false)
    expect(fireEvent.keyDown(document.body, { code: 'ArrowDown', key: 'ArrowDown' })).toBe(false)
    expect(fireEvent.keyDown(document.body, { code: 'Quote', key: "'" })).toBe(false)
    expect(settingsStore.get().bindings.Quote).toBe(12)

    await user.click(pianoKey('D4, key S'))
    expect(fireEvent.keyDown(document.body, { code: 'Backspace', key: 'Backspace' })).toBe(false)
    await user.click(pianoKey('E4, key D'))
    expect(fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' })).toBe(false)

    // No piano key is waiting: keys that play nothing are the browser's again.
    expect(fireEvent.keyDown(document.body, { code: 'Backspace', key: 'Backspace' })).toBe(true)
    expect(fireEvent.keyDown(document.body, { code: 'ArrowDown', key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(document.body, { code: 'KeyS', key: 's' })).toBe(true)
  })

  it('keeps the keys when the reset is answered with No', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')
    await user.keyboard('[KeyZ]')

    await user.click(screen.getByRole('button', { name: 'Reset to default keys' }))
    await user.click(screen.getByRole('button', { name: 'No' }))

    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(screen.getByRole('button', { name: 'Reset to default keys' })).toBeTruthy()
  })

  it('follows the piano when it is moved while a piano key is waiting', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.click(screen.getByRole('button', { name: /Lower/ }))
    expect(editorLead()).toBe('Press a key for C3…')

    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(editorMessage()).toBe('"Z" now plays C3. "A" no longer plays a note.')
  })

  it('selects a piano key with Enter for someone using the keyboard alone', async () => {
    const user = await startApp()
    await openEditor(user)
    const key = pianoKey('C4, key A')
    key.focus()

    await user.keyboard('[Enter]')
    expect(editorLead()).toBe('Press a key for C4…')
    // The Enter that chose the piano key is not taken as the key for the note.
    expect(editorMessage()).toBe('')

    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(document.activeElement).toBe(key)
  })

  it('takes the keyboard away from the piano keys when the panel is closed', async () => {
    const user = await startApp()
    await openEditor(user)
    const key = pianoKey('C4, key A')
    key.focus()

    await user.keyboard('[Escape]')

    expect(editorPanel()).toBeNull()
    // Where the keyboard goes instead is not checked here: only that no piano
    // key keeps it, and that the computer keys play again.
    const piano = screen.getByRole('group', { name: 'Piano' })
    expect(piano.contains(document.activeElement)).toBe(false)
    expect(key.tabIndex).toBe(-1)

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
  })
})

describe('Customize keys with the key labels switched off', () => {
  /*
   * Spec 5.7: "While Customize keys is open the piano always shows the
   * computer-key labels, whatever the Labels setting says (the saved setting
   * is not changed)." The panel asks the player to change those keys, so
   * they have to be on screen. The computer keys are added to what the
   * player chose: the note names stay hidden with "No labels" and stay
   * shown with "Notes only".
   */
  it.each([
    ['No labels', 'none', false],
    ['Notes only', 'notes', true],
  ] as const)(
    'shows the computer keys on the piano while it is open, with Labels on "%s"',
    async (_name, labelMode, showsNoteNames) => {
      settingsStore.set({ labelMode })
      const user = await startApp()
      expect(pianoKey('D4, key S').textContent).not.toContain('S')

      await openEditor(user)

      expect(pianoKey('D4, key S').textContent).toContain('S')
      expect(pianoKey("F5, key '").textContent).toContain("'")
      expect(pianoKey('D4, key S').textContent?.includes('D')).toBe(showsNoteNames)
      expect(settingsStore.get().labelMode).toBe(labelMode)

      // Back to playing: the labels are the player's own choice again.
      await user.click(screen.getByRole('button', { name: 'Done' }))
      expect(pianoKey('D4, key S').textContent).not.toContain('S')
      expect(settingsStore.get().labelMode).toBe(labelMode)
    },
  )

  it('names the computer key for screen readers whatever the Labels choice', async () => {
    settingsStore.set({ labelMode: 'none' })
    const user = await startApp()
    await openEditor(user)

    expect(pianoKey('C4, key A')).toBeTruthy()
    expect(pianoKey('C3')).toBeTruthy()
  })
})

/** A small seeded random generator, so a failing run can be repeated exactly. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

describe('random sessions', () => {
  const KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyK', 'KeyL', 'Quote', 'KeyZ', 'Digit1', 'Space', 'Enter']
  const MODIFIERS = ['shiftKey', 'ctrlKey', 'altKey'] as const

  /*
   * Plays, moves the piano, customizes keys, loses the window and hides the
   * tab at random, with real key downs, repeats and key ups. Once every key
   * is up again no note may be left sounding, and the keys must still be one
   * per note.
   */
  it.each([21, 22, 23, 24, 25, 26])('leave no note behind once every key is up (seed %i)', async (seed) => {
    await startApp()
    const random = seededRandom(seed)
    const pick = <Item,>(items: readonly Item[]): Item => {
      const item = items[Math.floor(random() * items.length)]
      if (item === undefined) throw new Error('nothing to pick from')
      return item
    }
    const down = new Set<string>()
    const modifiers = { shiftKey: false, ctrlKey: false, altKey: false }
    const target = (): Element => document.activeElement ?? document.body
    const click = (element: Element | null | undefined): void => {
      if (element instanceof HTMLButtonElement && !element.disabled) {
        fireEvent.click(element, { detail: 1 })
      }
    }
    const button = (name: string | RegExp): HTMLElement | null =>
      screen.queryByRole('button', { name })

    try {
      for (let step = 0; step < 250; step += 1) {
        const roll = random()
        if (roll < 0.3) {
          const code = pick(KEYS)
          fireEvent.keyDown(target(), { code, repeat: down.has(code), ...modifiers })
          down.add(code)
        } else if (roll < 0.55) {
          if (down.size === 0) continue
          const code = pick([...down])
          fireEvent.keyUp(target(), { code, ...modifiers })
          down.delete(code)
        } else if (roll < 0.62) {
          const modifier = pick(MODIFIERS)
          modifiers[modifier] = !modifiers[modifier]
        } else if (roll < 0.7) {
          click(button(random() < 0.5 ? /Higher/ : /Lower/))
        } else if (roll < 0.76) {
          click(button('Customize keys'))
        } else if (roll < 0.86) {
          if (editorPanel() !== null) click(pick(screen.getAllByRole('button', { name: /^[A-G]♯?\d/ })))
        } else if (roll < 0.9) {
          for (const code of ['Escape', 'Backspace']) {
            if (random() < 0.5) {
              fireEvent.keyDown(target(), { code })
              fireEvent.keyUp(target(), { code })
            }
          }
        } else if (roll < 0.93) {
          click(button('Done'))
        } else if (roll < 0.96) {
          // Keys let go while another window has the keyboard never reach the page.
          fireEvent.blur(window)
          if (random() < 0.5) down.clear()
        } else {
          setPageVisibility('hidden')
          setPageVisibility('visible')
        }

        const slots = Object.values(settingsStore.get().bindings)
        expect(new Set(slots).size).toBe(slots.length)
      }

      for (const code of [...down]) fireEvent.keyUp(target(), { code })
    } finally {
      setPageVisibility('visible')
    }

    expect(held()).toEqual([])
    expect(nowPlaying()).toEqual([])
    const onCount = audio.calls.filter((call) => call.startsWith('on:')).length
    const offCount = audio.calls.filter((call) => call.startsWith('off:')).length
    expect(offCount).toBe(onCount)
  })
})

describe('React StrictMode', () => {
  it('listens to the keyboard once: one note and one sustain toggle per key press', async () => {
    const user = await startApp()

    await user.keyboard('[KeyA][Space]')

    expect(audio.calls).toEqual(['on:60', 'off:60'])
    expect(isSustainOn()).toBe(true)
  })

  it('captures a key once while customizing', async () => {
    const user = await startApp()
    const changes = vi.fn()
    const stop = settingsStore.subscribe(changes)
    await selectPianoKey(user, 'C3', 'C3')

    await user.keyboard('[KeyZ]')
    stop()

    expect(changes).toHaveBeenCalledTimes(1)
    expect(editorMessage()).toBe('"Z" now plays C3.')
  })
})
