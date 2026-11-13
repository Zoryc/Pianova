// @vitest-environment jsdom
/**
 * The whole app in a simulated browser, driven with real key and mouse
 * events: from a computer key to a note on the bus and on the screen, and
 * choosing your own keys on the Keys tab of Settings. The sound engine is
 * replaced by a silent stand-in.
 *
 * Keys are sent by physical position: '[KeyA>]' holds the A key down,
 * '[/KeyA]' lets it go and '[KeyA]' taps it.
 */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    /** The sound stops working, as when the browser refuses to start it. */
    fail(): void {
      status = 'error'
      for (const listener of [...listeners]) listener()
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
import { DEFAULT_BINDINGS, KEY_PRESETS } from './input/keymap'
import type { Bindings, KeyPresetId } from './input/keymap'
import { DEFAULT_SETTINGS, STORAGE_KEY, createSettingsStore, settingsStore } from './state/settings'
import { KEYS_RESET_MESSAGE, UNUSABLE_KEY_MESSAGE } from './ui/keyEditorModel'
import { closeSong } from './ui/useSongs'

type User = ReturnType<typeof userEvent.setup>

const START_TEXT = 'Click or press any key to start'
const EDITOR_INSTRUCTION = 'Click a piano key below, then press the key you want to use for it.'

const SETTINGS_TABS = ['Sound', 'Keys', 'Piano', 'Look', 'About'] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]

/** Every note the bus has announced since the test began, e.g. ['on:60', 'off:60']. */
let notes: string[] = []
let stopRecording: () => void = () => {}

beforeAll(() => {
  // jsdom has no canvas and no pointer capture. The sky then draws nothing,
  // and the piano falls back on its own safety nets.
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
  const element = Element.prototype as Partial<Element>
  element.setPointerCapture ??= () => {}
  element.releasePointerCapture ??= () => {}
  element.hasPointerCapture ??= () => false
})

/**
 * Puts every setting back to how the app starts. The tests tell "no key was
 * changed" by the keys still being the very object the app starts with. The
 * store keeps its own copy of keys that only read the same as that object
 * (after "Reset to default keys", say), so the keys are first made different.
 */
function startFromDefaultSettings(): void {
  settingsStore.set({ bindings: { KeyA: 0 } })
  settingsStore.reset()
}

beforeEach(() => {
  audio.reset()
  window.localStorage.clear()
  startFromDefaultSettings()
  notes = []
  stopRecording = bus.subscribe((event: NoteEvent) => {
    notes.push(`${event.type}:${event.midi}`)
  })
})

afterEach(() => {
  cleanup()
  stopRecording()
  // A song that was started from the start box must not play on into the next test.
  closeSong()
  bus.allOff()
  startFromDefaultSettings()
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

/**
 * The window around the start box. While the app waits for the first click
 * or key press it is one button, named after what the box says.
 */
function startButton(): HTMLElement {
  return screen.getByRole('button', { name: START_TEXT })
}

/** True while the app waits for the first click or key press. */
function isWaitingToStart(): boolean {
  return screen.queryByRole('button', { name: START_TEXT }) !== null
}

/** The start box: the small menu the app opens with, and that the Menu button opens later. */
function startBox(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Menu' })
}

/** The app has started: the window is no longer a start button, and the start box is gone. */
function expectStarted(): void {
  expect(isWaitingToStart()).toBe(false)
  expect(startBox()).toBeNull()
}

/** Draws the app and starts it with a click beside the start box, as most players do. */
async function startApp(): Promise<User> {
  const user = drawApp()
  await user.click(startButton())
  notes.length = 0
  audio.calls.length = 0
  return user
}

/** The notes the bus says are held, lowest first. */
function held(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

/** A key of the on-screen piano, by what a screen reader calls it ("C4, key A"). */
function pianoKey(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

/** Whether a piano key is drawn as being played. */
function isLit(key: HTMLElement): boolean {
  return key.classList.contains('is-lit')
}

/** The piano keys drawn as being played, by what a screen reader calls them. */
function litKeys(): string[] {
  return [...piano().querySelectorAll('.piano-key.is-lit')].map(
    (key) => key.getAttribute('aria-label') ?? '',
  )
}

function isSustainOn(): boolean {
  return settingsStore.get().sustain
}

/** The note names written above the piano. */
function nowPlaying(): string[] {
  const list = screen.queryByRole('list', { name: 'Notes being played' })
  return list ? [...list.querySelectorAll('li')].map((item) => item.textContent ?? '') : []
}

/** The top bar, with everything that hides and shows with it. */
function menu(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.menu')
  if (element === null) throw new Error('The menu is not on the page.')
  return element
}

/** The sky above the piano, where a click lands on nothing. */
function emptySky(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.stage__sky')
  if (element === null) throw new Error('The sky is not on the page.')
  return element
}

/** The Menu button of the top bar, which opens and closes the start box. */
function menuButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Menu' })
}

/** Opens the start box with the Menu button, unless it is open already. */
async function openStartBox(user: User): Promise<HTMLElement> {
  if (startBox() === null) await user.click(menuButton())
  return screen.getByRole('dialog', { name: 'Menu' })
}

function settingsPanel(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Settings' })
}

/** Opens Settings the way a player does: the Menu button, then "Settings" in the start box. */
async function openSettings(user: User): Promise<HTMLElement> {
  const box = await openStartBox(user)
  await user.click(within(box).getByRole('button', { name: 'Settings' }))
  return screen.getByRole('dialog', { name: 'Settings' })
}

/** Opens the Songs panel the same way: the Menu button, then "All songs…" in the start box. */
async function openSongs(user: User): Promise<HTMLElement> {
  const box = await openStartBox(user)
  await user.click(within(box).getByRole('button', { name: 'All songs…' }))
  return screen.getByRole('dialog', { name: 'Songs' })
}

/**
 * Opens Settings if it is closed, and shows one of its tabs. (Settings opens
 * on the tab it was last on, also when that was in the test before.)
 */
async function openSettingsOn(user: User, tab: SettingsTab): Promise<HTMLElement> {
  const panel = settingsPanel() ?? (await openSettings(user))
  await user.click(within(panel).getByRole('tab', { name: tab }))
  return panel
}

async function closeSettings(user: User): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Close Settings' }))
  expect(settingsPanel()).toBeNull()
}

/** Makes `tab` the tab Settings opens on the next time. */
async function leaveSettingsOn(user: User, tab: SettingsTab): Promise<void> {
  await openSettingsOn(user, tab)
  await closeSettings(user)
}

/**
 * True while the computer keys are being chosen: Settings is open on its Keys
 * tab, and a click on a piano key selects it instead of playing it.
 */
function isChoosingKeys(): boolean {
  return piano().classList.contains('piano--editing')
}

/** The "Change one key" part of the Keys tab, or null when that tab is not showing. */
function keyChanger(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Change one key' })
}

/** Its first line: the instruction, or "Press a key for C4…". */
function editorLead(): string {
  return keyChanger()?.querySelector('.change-key__lead')?.textContent ?? ''
}

/** What it says the last action did. */
function editorMessage(): string {
  return keyChanger()?.querySelector('[role="status"]')?.textContent ?? ''
}

/** Opens Settings on its Keys tab: from then on a click on a piano key selects it. */
async function openEditor(user: User): Promise<void> {
  await openSettingsOn(user, 'Keys')
  expect(isChoosingKeys()).toBe(true)
  expect(editorLead()).toBe(EDITOR_INSTRUCTION)
}

/** Shows the Keys tab if needed and clicks a piano key, which then waits for a computer key. */
async function selectPianoKey(user: User, name: string, note: string): Promise<void> {
  if (!isChoosingKeys()) await openEditor(user)
  await user.click(pianoKey(name))
  expect(editorLead()).toBe(`Press a key for ${note}…`)
}

/** The keys of one of the ready-made layouts of the Keys tab. */
function layoutKeys(id: KeyPresetId): Bindings {
  const layout = KEY_PRESETS.find((preset) => preset.id === id)
  if (layout === undefined) throw new Error(`There is no "${id}" layout.`)
  return layout.bindings
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

/** Every button, slider and link in these parts of the page, in the order of the page. */
function controlsIn(...places: readonly (Element | null)[]): HTMLElement[] {
  return places.flatMap((place) =>
    place === null
      ? []
      : [...place.querySelectorAll<HTMLElement>('button, input[type="range"], a[href]')].filter(
          (control) => !control.matches(':disabled'),
        ),
  )
}

/** What a control is called, for the message of a check that fails. */
function nameOf(control: HTMLElement): string {
  const name = control.getAttribute('aria-label') ?? control.textContent ?? ''
  return `${control.tagName.toLowerCase()} "${name.trim()}"`
}

/** True when no button, slider, link or list is left holding the keyboard focus. */
function noControlHasFocus(): boolean {
  const focused = document.activeElement
  return focused === null || !focused.matches('button, input, select, a')
}

/** Presses Tab until `target()` has the keyboard focus, as someone without a mouse does. */
async function tabTo(user: User, target: () => HTMLElement): Promise<void> {
  for (let presses = 0; presses < 80 && document.activeElement !== target(); presses += 1) {
    await user.tab()
  }
  expect(document.activeElement).toBe(target())
}

describe('the start box, while the app waits to start', () => {
  it('starts the sound on the first key press, which plays nothing, even once released', async () => {
    const user = drawApp()

    await user.keyboard('[KeyA>]')

    expect(audio.calls.filter((call) => call === 'start')).toHaveLength(1)
    expectStarted()
    expect(notes).toEqual([])

    // The key goes up after the start box is gone.
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
    expectStarted()
    expect(notes).toEqual([])

    await user.keyboard('[/KeyA]')
    expect(notes).toEqual([])
  })

  it('does not treat Space as the sustain key when it is the first key', async () => {
    const user = drawApp()

    await user.keyboard('[Space>3/]')

    expectStarted()
    expect(isSustainOn()).toBe(false)

    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(true)
  })

  // Enter is pressed here with nothing focused. (On a line of the start box
  // it presses that line: see further down.)
  it.each(['Enter', 'Escape', 'ArrowDown'])(
    'starts on %s without doing anything else',
    async (code) => {
      const user = drawApp()

      await user.keyboard(`[${code}]`)

      expectStarted()
      // No panel opened, nothing took the keyboard focus, and the piano is there to be played.
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(document.body)
      expect(isChoosingKeys()).toBe(false)
      expect(notes).toEqual([])
      expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    },
  )

  // Shift goes down before Tab on the way back through the start box. Alone
  // it is the first half of that, and starts nothing.
  it.each(['ShiftLeft', 'ShiftRight'])('does not start on %s alone', async (code) => {
    const user = drawApp()

    await user.keyboard(`[${code}]`)

    expect(isWaitingToStart()).toBe(true)
    expect(startBox()).not.toBeNull()
    expect(audio.calls).toEqual([])
    expect(notes).toEqual([])
  })

  /*
   * Tab is how someone without a mouse gets to the lines of the start box.
   * So it does not start the app: it is left to the browser, and the app goes
   * on waiting.
   */
  it('does not start on Tab, which is left to the browser to reach the start box', async () => {
    const user = drawApp()

    expect(fireEvent.keyDown(document.body, { code: 'Tab', key: 'Tab' })).toBe(true)
    expect(fireEvent.keyUp(document.body, { code: 'Tab', key: 'Tab' })).toBe(true)

    expect(isWaitingToStart()).toBe(true)
    expect(startBox()).not.toBeNull()
    expect(audio.calls).toEqual([])
    expect(isChoosingKeys()).toBe(false)
    expect(notes).toEqual([])
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)

    // The next key starts the app, as if Tab had not been pressed.
    await user.keyboard('[KeyA]')
    expectStarted()
    expect(audio.calls).toEqual(['start'])
    expect(notes).toEqual([])
  })

  // On a line of the start box, Enter is that line's own click: it starts the
  // app and does what the line says.
  it('leaves Enter to the focused line of the start box, which starts the app', async () => {
    const user = drawApp()
    const box = screen.getByRole('dialog', { name: 'Menu' })
    within(box).getByRole('button', { name: 'Settings' }).focus()

    await user.keyboard('[Enter]')

    expectStarted()
    expect(audio.calls).toEqual(['start'])
    expect(settingsPanel()).not.toBeNull()
    expect(notes).toEqual([])
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
  })

  /*
   * A browser does not count every key as the player's go-ahead for sound:
   * Escape is not. Asking for sound then would fail, so the app waits for the
   * next key press, which also plays its note.
   */
  it.each(['Escape'])(
    'starts the sound at the next key when the browser does not count %s',
    async (code) => {
      const activation = { hasBeenActive: false }
      Object.defineProperty(navigator, 'userActivation', { configurable: true, value: activation })
      try {
        const user = drawApp()

        await user.keyboard(`[${code}]`)
        expectStarted()
        expect(audio.calls).toEqual([])

        activation.hasBeenActive = true
        await user.keyboard('[KeyA>]')
        expect(audio.calls).toEqual(['start', 'on:60'])
      } finally {
        Reflect.deleteProperty(navigator, 'userActivation')
      }
    },
  )

  // The whole window around the start box is the start button. A line of the
  // box starts the app too: "Free Play" does that and nothing more.
  it.each<[string, () => HTMLElement]>([
    ['the window around the start box', startButton],
    [
      'the "Free Play" line of the start box',
      () => screen.getByRole('button', { name: /Free Play/ }),
    ],
  ])('starts on a click on %s and leaves the keyboard to the piano', async (_where, target) => {
    const user = drawApp()

    await user.click(target())
    expectStarted()
    expect(audio.calls).toEqual(['start'])
    expect(document.activeElement).toBe(document.body)

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
  })

  it('survives a first key press that has no code', async () => {
    drawApp()

    fireEvent.keyDown(document.body, { code: '', key: 'a' })
    fireEvent.keyUp(document.body, { code: '', key: 'a' })

    expectStarted()
    expect(notes).toEqual([])
  })

  it('leaves browser shortcuts alone while the app waits to start', async () => {
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

  // The stage says "Click anywhere to try again". A key press is as good as a
  // click: it starts the sound again, and its note is played.
  it('tries to start the sound again at the next key press or click after it failed', async () => {
    const user = await startApp()
    const status = (): string => document.querySelector('.stage__status')?.textContent ?? ''

    act(() => audio.fail())
    expect(status()).toBe('Sound could not start. Click anywhere to try again.')
    await user.keyboard('[KeyA>]')
    expect(audio.calls).toEqual(['start', 'on:60'])
    expect(status()).toBe('')
    await user.keyboard('[/KeyA]')

    act(() => audio.fail())
    audio.calls.length = 0
    await user.click(emptySky())
    expect(audio.calls).toEqual(['start'])
    expect(status()).toBe('')
  })

  /*
   * The saved keys are an object, and every object answers to names such as
   * "constructor". A key press that carries one of them as its code (only a
   * script can send it) is a key that plays nothing, like any other.
   */
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'does not take "%s" for a key that plays a note',
    async (code) => {
      const user = await startApp()

      expect(fireEvent.keyDown(document.body, { code })).toBe(true)
      fireEvent.keyUp(document.body, { code })

      expect(notes).toEqual([])
      expect(held()).toEqual([])

      // A key that plays a note takes the open start box away. This one does not.
      const box = await openStartBox(user)
      expect(fireEvent.keyDown(document.body, { code })).toBe(true)
      fireEvent.keyUp(document.body, { code })
      expect(startBox()).toBe(box)
      expect(notes).toEqual([])
    },
  )

  /*
   * A computer key that plays a note takes the open start box away. A key
   * that was down before the box was opened plays nothing more: the keyboard
   * only sends it again and again for as long as it is held. The box stays,
   * or nobody could open it with a finger resting on a key.
   */
  it('leaves the start box open while a key that was already down keeps repeating', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')
    await openStartBox(user)

    repeatKey('KeyA', 'a')
    repeatKey('KeyA', 'a')
    expect(startBox(), 'the start box').not.toBeNull()
    expect(notes).toEqual(['on:60'])

    // Let go and pressed again, the key is played: its note sounds, and the box goes.
    await user.keyboard('[/KeyA][KeyA>]')
    expect(notes).toEqual(['on:60', 'off:60', 'on:60'])
    expect(startBox()).toBeNull()
  })
})

describe('no stuck notes', () => {
  it('releases held keys when the window loses focus, and ignores them until pressed again', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>][KeyS>]')

    fireEvent.blur(window)
    expect(notes).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
    expect(nowPlaying()).toEqual([])
    expect(litKeys()).toEqual([])

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

  // Whoever lets go of every note at once (the bus's `allOff`): the sound,
  // the lit keys and the names above the piano all follow.
  it('leaves nothing lit or sounding when every note is let go at once', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>][KeyD>]')
    expect(litKeys()).toEqual(['C4, key A', 'E4, key D'])

    act(() => bus.allOff())

    expect(audio.calls).toEqual(['on:60', 'on:64', 'off:60', 'off:64'])
    expect(litKeys()).toEqual([])
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('false')
    expect(pianoKey('E4, key D').getAttribute('aria-pressed')).toBe('false')
    expect(nowPlaying()).toEqual([])

    // The keys are still down: their repeats and their release do nothing more.
    repeatKey('KeyA', 'a')
    await user.keyboard('[/KeyA][/KeyD]')
    expect(audio.calls).toHaveLength(4)

    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])
    expect(litKeys()).toEqual(['C4, key A'])
  })

  /*
   * ARCHITECTURE.md 5.5: while the Windows or Command key is down, some
   * systems never tell the page that another key came up. So when it comes
   * up itself, every note the keyboard holds is let go.
   */
  it('lets go of every held note when the Windows or Command key comes up', async () => {
    const user = await startApp()

    // Going down, it cuts nothing.
    await user.keyboard('[KeyA>][KeyS>]{Meta>}')
    expect(held()).toEqual([60, 62])

    await user.keyboard('{/Meta}')
    expect(notes).toEqual(['on:60', 'on:62', 'off:60', 'off:62'])
    expect(litKeys()).toEqual([])
    expect(nowPlaying()).toEqual([])

    // A and S were down all along: letting go of them changes nothing, and they play again.
    repeatKey('KeyA', 'a')
    await user.keyboard('[/KeyA][/KeyS]')
    expect(notes).toHaveLength(4)
    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60', 'on:62', 'off:60', 'off:62', 'on:60'])
  })

  // "Lower" and "Higher" are on the Keys tab, where the keyboard still plays
  // as long as no piano key is waiting for a computer key.
  it('releases held keys when the computer keys move higher, and plays the new note next time', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Keys')
    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])

    await user.click(screen.getByRole('button', { name: /Higher/ }))
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(notes).toEqual(['on:60', 'off:60'])
    expect(nowPlaying()).toEqual([])

    repeatKey('KeyA', 'a')
    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60', 'off:60', 'on:72'])
    // On this tab "pressed" says which piano key is selected, so the light itself is looked at.
    expect(isLit(pianoKey('C5, key A'))).toBe(true)
    expect(nowPlaying()).toEqual(['C5'])
    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
    expect(isLit(pianoKey('C5, key A'))).toBe(false)

    // Back to playing, where "pressed" says which keys sound.
    await closeSettings(user)
    await user.keyboard('[KeyA>]')
    expect(pianoKey('C5, key A').getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
  })

  /*
   * ARCHITECTURE.md 5.5: "on key up release that note", and a key whose note
   * was released by someone else no longer counts as holding it. K is held
   * (C5) while the computer keys are moved higher, which silences it. A now
   * plays C5: tapping A must start and stop it, whatever K is doing.
   */
  it('releases a note on key up after the computer keys moved while another key was held', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Keys')
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

  it('releases held keys when the Keys tab of Settings is chosen', async () => {
    const user = await startApp()
    await leaveSettingsOn(user, 'Sound')
    await user.keyboard('[KeyA>]')

    // Neither the start box nor Settings alone stops the piano…
    await openStartBox(user)
    expect(notes).toEqual(['on:60'])
    await openSettings(user)
    expect(isChoosingKeys()).toBe(false)
    expect(notes).toEqual(['on:60'])

    // …choosing the computer keys does.
    await user.click(screen.getByRole('tab', { name: 'Keys' }))
    expect(isChoosingKeys()).toBe(true)
    expect(notes).toEqual(['on:60', 'off:60'])
    expect(nowPlaying()).toEqual([])

    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])
  })

  it('releases held keys when Settings opens on its Keys tab', async () => {
    const user = await startApp()
    await leaveSettingsOn(user, 'Keys')
    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])

    await openSettings(user)

    expect(isChoosingKeys()).toBe(true)
    expect(notes).toEqual(['on:60', 'off:60'])
    await user.keyboard('[/KeyA]')
    expect(notes).toEqual(['on:60', 'off:60'])
  })

  // INTERFACE.md 7: held notes are also let go when the piano on screen changes.
  it('releases held keys when the piano is given another size', async () => {
    const user = await startApp()
    const settings = await openSettingsOn(user, 'Piano')
    await user.keyboard('[KeyA>][KeyD>]')
    expect(held()).toEqual([60, 64])

    await user.click(within(settings).getByRole('button', { name: '61' }))
    expect(piano().querySelectorAll('.piano-key')).toHaveLength(61)
    expect(notes).toEqual(['on:60', 'on:64', 'off:60', 'off:64'])
    expect(nowPlaying()).toEqual([])

    // The keys are still down: their repeats and their release do nothing more.
    repeatKey('KeyA', 'a')
    await user.keyboard('[/KeyA][/KeyD]')
    expect(notes).toHaveLength(4)

    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('true')
  })

  // "Two octaves" has no note on the A key. Whether the note A is holding is
  // cut at once or at its key up is the app's choice; it must not stay.
  it('leaves no note behind when a ready-made layout takes the key of a held note away', async () => {
    const user = await startApp()
    const settings = await openSettingsOn(user, 'Keys')
    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])

    await user.click(within(settings).getByRole('button', { name: 'Two octaves' }))
    expect(Object.hasOwn(settingsStore.get().bindings, 'KeyA')).toBe(false)

    repeatKey('KeyA', 'a')
    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
    expect(notes).toEqual(['on:60', 'off:60'])
    expect(nowPlaying()).toEqual([])

    // A plays nothing in this layout; Q is its middle C.
    await user.keyboard('[KeyA][KeyQ>]')
    expect(notes).toEqual(['on:60', 'off:60', 'on:60'])
  })

  // "Reset all settings" (the About tab) also puts the computer keys back
  // where they were at the start, which moves the note under a held key.
  it('releases held keys when every setting is reset and the computer keys move back', async () => {
    settingsStore.set({ baseOctave: 4 })
    const user = await startApp()
    const settings = await openSettingsOn(user, 'About')
    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:72'])

    await user.click(within(settings).getByRole('button', { name: 'Reset all settings' }))
    // Nothing is reset before the answer.
    expect(notes).toEqual(['on:72'])
    await user.click(within(settings).getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(notes).toEqual(['on:72', 'off:72'])
    expect(litKeys()).toEqual([])
    expect(nowPlaying()).toEqual([])

    repeatKey('KeyA', 'a')
    await user.keyboard('[/KeyA][KeyA>]')
    expect(notes).toEqual(['on:72', 'off:72', 'on:60'])
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
  /**
   * With the keyboard focus on each of `controls` in turn: one tap of Space
   * turns sustain on or off once and changes nothing else, a letter still
   * plays its note, and the control was not pressed (it keeps the focus).
   */
  async function expectThePianoKeepsItsKeys(
    user: User,
    controls: readonly HTMLElement[],
  ): Promise<void> {
    for (const control of controls) {
      const name = nameOf(control)
      control.focus()
      expect(document.activeElement, name).toBe(control)
      const before = settingsStore.get()
      notes.length = 0

      await user.keyboard('[Space][KeyA]')

      expect(settingsStore.get(), name).toEqual({ ...before, sustain: !before.sustain })
      expect(notes, name).toEqual(['on:60', 'off:60'])
      expect(document.activeElement, name).toBe(control)
    }
  }

  /** True when the page still shows exactly these controls: none was pressed on the way. */
  function areStillThere(controls: readonly HTMLElement[], now: readonly HTMLElement[]): boolean {
    return (
      controls.length === now.length && controls.every((control, index) => control === now[index])
    )
  }

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

  it('toggles once and does not press the Menu button that has focus', async () => {
    const user = await startApp()
    const button = menuButton()
    button.focus()

    await user.keyboard('[Space]')

    expect(isSustainOn()).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // What opens the Settings and Songs panels: two lines of the start box.
  it.each(['Settings', 'All songs…'])(
    'toggles once and does not press the "%s" line of the start box that has focus',
    async (name) => {
      const user = await startApp()
      const box = await openStartBox(user)
      const line = within(box).getByRole('button', { name })
      line.focus()

      await user.keyboard('[Space]')

      expect(isSustainOn()).toBe(true)
      // The line was not pressed: the box is still there, and no panel took its place.
      expect(screen.getAllByRole('dialog')).toEqual([box])
      expect(document.activeElement).toBe(line)
    },
  )

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

    menuButton().focus()
    await user.keyboard('[KeyA]')
    screen.getByRole('slider', { name: 'Volume' }).focus()
    await user.keyboard('[KeyS]')

    expect(notes).toEqual(['on:60', 'off:60', 'on:62', 'off:62'])
  })

  it('toggles once and plays, whatever has the focus in the menu', async () => {
    const user = await startApp()
    const controls = controlsIn(menu())
    // The Menu button, the volume and sustain.
    expect(controls.length).toBeGreaterThanOrEqual(3)

    await expectThePianoKeepsItsKeys(user, controls)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(areStillThere(controls, controlsIn(menu()))).toBe(true)
  })

  /*
   * The ways to play, the songs, Settings and About are lines of the start
   * box. Space is the sustain key on them too, and presses none of them. A
   * key of the piano does more there than anywhere else: it plays its note
   * and takes the box away. So each line is tried in a box that was opened
   * again.
   */
  it('toggles once on every line of the start box, which a note then takes away', async () => {
    const user = await startApp()
    const lines = controlsIn(await openStartBox(user)).length
    // Free Play and the two ways to play still to come, three songs,
    // "All songs…", Settings and About.
    expect(lines).toBeGreaterThanOrEqual(9)

    for (let index = 0; index < lines; index += 1) {
      const box = await openStartBox(user)
      const controls = controlsIn(box)
      const line = controls[index]
      if (line === undefined) throw new Error(`The start box has no line ${index}.`)
      const name = nameOf(line)
      line.focus()
      expect(document.activeElement, name).toBe(line)
      const before = settingsStore.get()
      notes.length = 0

      await user.keyboard('[Space]')

      expect(settingsStore.get(), name).toEqual({ ...before, sustain: !before.sustain })
      expect(notes, name).toEqual([])
      // The line was not pressed: it keeps the focus, in the same box, and no panel opened.
      expect(document.activeElement, name).toBe(line)
      expect(screen.getAllByRole('dialog'), name).toEqual([box])
      expect(areStillThere(controls, controlsIn(startBox())), name).toBe(true)

      await user.keyboard('[KeyA]')

      expect(notes, name).toEqual(['on:60', 'off:60'])
      // The box is gone and nothing took its place: no panel, and no song was started.
      expect(screen.queryByRole('dialog'), name).toBeNull()
      expect(screen.queryByRole('region', { name: 'Song player' }), name).toBeNull()
      expect(settingsStore.get(), name).toEqual({ ...before, sustain: !before.sustain })
    }
  })

  // INTERFACE.md 5.4: Settings "is not modal: the piano keeps playing from
  // the computer keyboard while it is open". The "Labels on the keys" list
  // of the Piano tab is not among these controls: a list keeps the keys to
  // itself while it has the focus (see 'focus goes back to the piano' below).
  it.each(SETTINGS_TABS)(
    'toggles once and plays, whichever button, slider or link of Settings has the focus on its %s tab',
    async (tab) => {
      const user = await startApp()
      const settings = await openSettingsOn(user, tab)
      const controls = controlsIn(settings)
      // The five tabs and the close button, then what the tab itself holds.
      expect(controls.length).toBeGreaterThan(7)

      await expectThePianoKeepsItsKeys(user, controls)

      expect(settingsPanel()).toBe(settings)
      const showing = within(settings).getByRole('tab', { selected: true })
      expect(showing.textContent).toBe(tab)
      expect(areStillThere(controls, controlsIn(settings))).toBe(true)
    },
  )

  it('toggles once and plays, whatever has the focus in the Songs panel', async () => {
    const user = await startApp()
    const songs = await openSongs(user)
    const controls = controlsIn(songs)
    // The close button, "Import a MIDI file" and a Play button per starter song.
    expect(controls.length).toBeGreaterThan(2)

    await expectThePianoKeepsItsKeys(user, controls)

    // No song was started, and the panel is as it was.
    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Songs' })).toBe(songs)
    expect(areStillThere(controls, controlsIn(songs))).toBe(true)
  })

  it('toggles once while an open panel itself has the focus, and the panel stays', async () => {
    const user = await startApp()
    // Opened with the mouse, the panel takes the focus itself.
    const settings = await openSettingsOn(user, 'Sound')
    settings.focus()
    expect(document.activeElement).toBe(settings)

    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(true)
    // Both sustain switches on screen say so: the one in the menu and the one on the tab.
    for (const sustain of screen.getAllByRole('switch', { name: 'Sustain' })) {
      expect(sustain.getAttribute('aria-checked')).toBe('true')
    }

    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(false)
    expect(settingsPanel()).toBe(settings)
  })

  // In a browser Space also scrolls: the page, or the panel that has the focus.
  it('is used up going down and coming up, so that it scrolls nothing', async () => {
    const user = await startApp()
    expect(fireEvent.keyDown(document.body, { code: 'Space', key: ' ' })).toBe(false)
    expect(fireEvent.keyUp(document.body, { code: 'Space', key: ' ' })).toBe(false)

    const settings = await openSettingsOn(user, 'Look')
    settings.focus()
    expect(fireEvent.keyDown(settings, { code: 'Space', key: ' ' })).toBe(false)
    expect(fireEvent.keyDown(settings, { code: 'Space', key: ' ', repeat: true })).toBe(false)
    expect(fireEvent.keyUp(settings, { code: 'Space', key: ' ' })).toBe(false)

    // Two taps: sustain is back where it was.
    expect(isSustainOn()).toBe(false)
  })

  // Space never presses a button, so Enter has to: it is how someone without
  // a mouse works the switches and the buttons.
  it('leaves Enter to press the control that has the focus', async () => {
    const user = await startApp()
    const sustain = screen.getByRole('switch', { name: 'Sustain' })
    sustain.focus()

    await user.keyboard('[Enter]')
    expect(isSustainOn()).toBe(true)
    expect(document.activeElement).toBe(sustain)
    await user.keyboard('[Enter]')
    expect(isSustainOn()).toBe(false)

    const settings = await openSettingsOn(user, 'Look')
    const lightBars = within(settings).getByRole('switch', { name: 'Light bars' })
    lightBars.focus()
    await user.keyboard('[Enter]')
    expect(settingsStore.get().showTrails).toBe(false)
    expect(lightBars.getAttribute('aria-checked')).toBe('false')
    expect(document.activeElement).toBe(lightBars)

    const neon = within(settings).getByRole('button', { name: 'Neon' })
    neon.focus()
    await user.keyboard('[Enter]')
    expect(settingsStore.get().barStyle).toBe('neon')
    expect(document.activeElement).toBe(neon)
    expect(notes).toEqual([])
  })

  it('does one thing only on a piano key that has focus while the keys are being chosen', async () => {
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

  it('toggles sustain on the Keys tab while no piano key is waiting', async () => {
    const user = await startApp()
    await openEditor(user)

    await user.keyboard('[Space]')

    expect(isSustainOn()).toBe(true)
  })
})

describe('focus goes back to the piano', () => {
  /** A link that is clicked stays a link, but the test's page must not try to go anywhere. */
  function stayOnThePage(event: Event): void {
    event.preventDefault()
  }

  /**
   * Clicks, with the mouse, every button, slider and link that `place()`
   * holds, one after the other. After each click nothing may be left holding
   * the keyboard focus. Returns how many were clicked.
   */
  async function clickEveryControl(
    user: User,
    place: () => Element | Promise<Element>,
  ): Promise<number> {
    let clicked = 0
    // A click can swap buttons for others (a question and its answers), or
    // take the place away (the start box), so they are looked up again each time.
    for (let index = 0; index < controlsIn(await place()).length; index += 1) {
      const control = controlsIn(await place())[index]
      if (control === undefined) break
      const name = nameOf(control)
      if (control instanceof HTMLAnchorElement) control.addEventListener('click', stayOnThePage)

      await user.click(control)

      clicked += 1
      expect(noControlHasFocus(), name).toBe(true)
    }
    return clicked
  }

  it('lets go of a button that was clicked, so Enter does not press it again', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Keys')

    await user.click(screen.getByRole('button', { name: /Higher/ }))
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(document.activeElement).toBe(document.body)

    await user.keyboard('[Enter][Space]')
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(isSustainOn()).toBe(true)
  })

  it('lets go of every control of the menu once it was clicked', async () => {
    const user = await startApp()

    // The Menu button, the volume and sustain.
    const clicked = await clickEveryControl(user, menu)
    expect(clicked).toBeGreaterThanOrEqual(3)

    // Straight back to playing: the next key is the piano's.
    const sustain = isSustainOn()
    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(!sustain)
  })

  // A click on a line of the start box takes the box away, or puts a panel in
  // its place. So the box is opened again, with the Menu button, for each line.
  it('lets go of every line of the start box once it was clicked', async () => {
    const user = await startApp()

    // Free Play and the two ways to play still to come, three songs,
    // "All songs…", Settings and About.
    const clicked = await clickEveryControl(user, () => openStartBox(user))
    expect(clicked).toBeGreaterThanOrEqual(9)

    // Straight back to playing: the next key is the piano's.
    const sustain = isSustainOn()
    await user.keyboard('[Space]')
    expect(isSustainOn()).toBe(!sustain)
  })

  it.each(SETTINGS_TABS)(
    'lets go of every button, slider and link of the %s tab once it was clicked',
    async (tab) => {
      const user = await startApp()
      const settings = await openSettingsOn(user, tab)

      const clicked = await clickEveryControl(user, () => within(settings).getByRole('tabpanel'))
      expect(clicked).toBeGreaterThan(1)
      expect(settingsPanel()).toBe(settings)

      // Straight back to playing: the next key is the piano's.
      const sustain = isSustainOn()
      await user.keyboard('[Space]')
      expect(isSustainOn()).toBe(!sustain)
    },
  )

  it('lets go of the Labels list once a choice is made, so the keys play again', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Piano')
    const labels = screen.getByRole('combobox', { name: 'Labels on the keys' })

    await user.selectOptions(labels, 'Keys only')
    expect(settingsStore.get().labelMode).toBe('keys')
    expect(document.activeElement).not.toBe(labels)

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
  })

  // An arrow key on the closed list changes the choice at once. The page is
  // told of the change and of nothing else: no click comes with it.
  it('lets go of the Labels list once a choice is made without the mouse', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Piano')
    const labels = screen.getByRole('combobox', { name: 'Labels on the keys' })
    labels.focus()
    expect(document.activeElement).toBe(labels)

    fireEvent.change(labels, { target: { value: 'notes' } })
    expect(settingsStore.get().labelMode).toBe('notes')
    expect(document.activeElement).not.toBe(labels)

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
  })

  /*
   * The Labels list must not keep the keyboard once the player is done with
   * it, so that the player can go straight back to playing. A list that is
   * opened and closed again without a new choice announces no change. If it
   * kept the keyboard, the piano would stay silent, and in a real browser the
   * letters K and N would change the Labels choice.
   *
   * The simulated browser has no list to open, so the three tests below send
   * the page what Chrome and Edge send it in each case.
   */
  it('plays again at once after the Labels list is closed with Escape', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Piano')
    const labels = screen.getByRole('combobox', { name: 'Labels on the keys' })

    await user.click(labels)
    expect(document.activeElement).toBe(labels)
    // The open list keeps the key down to itself: the page only sees the key come up.
    fireEvent.keyUp(labels, { code: 'Escape', key: 'Escape' })
    expect(document.activeElement).not.toBe(labels)
    // That Escape closed the list, not Settings.
    expect(settingsPanel()).not.toBeNull()

    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])
    expect(settingsStore.get().labelMode).toBe('both')
  })

  it('plays again at once after the choice the Labels list already shows is picked again', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Piano')
    const labels = screen.getByRole('combobox', { name: 'Labels on the keys' })

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
    await openSettingsOn(user, 'Piano')
    const labels = screen.getByRole('combobox', { name: 'Labels on the keys' })

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

describe('choosing your own keys', () => {
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

  // INTERFACE.md 5.5: on the Keys tab "a click selects a key instead of playing it".
  it('selects the piano key that is pressed with the mouse, and does not play it', async () => {
    const user = await startApp()
    await openEditor(user)
    // The simulated browser lays nothing out. The piano is told where it is,
    // so that a press with the mouse lands on a key: here its first one, C3.
    piano().getBoundingClientRect = () => ({ left: 0, top: 0, width: 2200, height: 100 }) as DOMRect
    const onC3 = { button: 0, pointerId: 1, clientX: 50, clientY: 90 }

    fireEvent.pointerDown(pianoKey('C3'), onC3)
    fireEvent.pointerUp(pianoKey('C3'), onC3)
    fireEvent.click(pianoKey('C3'), { detail: 1 })

    expect(notes).toEqual([])
    expect(editorLead()).toBe('Press a key for C3…')
    expect(pianoKey('C3').getAttribute('aria-pressed')).toBe('true')

    // Back to playing, the same press plays the key.
    await closeSettings(user)
    fireEvent.pointerDown(pianoKey('C3'), onC3)
    expect(notes).toEqual(['on:48'])
    fireEvent.pointerUp(pianoKey('C3'), onC3)
    fireEvent.click(pianoKey('C3'), { detail: 1 })
    expect(notes).toEqual(['on:48', 'off:48'])
    expect(isChoosingKeys()).toBe(false)
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
    expect(isLit(pianoKey('C4, key A'))).toBe(true)
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

  // INTERFACE.md 5.0: Escape takes back one thing at a time: first the piano
  // key that is waiting, then the open panel. An Escape that is held down
  // never does more than one of these: its repeats do not go on to close the
  // panel, and are used up, so that the browser does nothing with them either.
  it('cancels on Escape, and closes on the next Escape only once the first was let go', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.keyboard('[Escape>]')
    expect(editorLead()).toBe(EDITOR_INSTRUCTION)
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('false')

    const leftToTheBrowser = repeatKey('Escape', 'Escape')
    expect(leftToTheBrowser).toBe(false)
    expect(settingsPanel()).not.toBeNull()
    expect(isChoosingKeys()).toBe(true)

    await user.keyboard('[/Escape][Escape]')
    expect(settingsPanel()).toBeNull()
    expect(isChoosingKeys()).toBe(false)
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
      // The key did nothing else either: Settings is still on its Keys tab.
      expect(isChoosingKeys()).toBe(true)

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
    act(() => settingsStore.set({ customLabels: { BracketLeft: 'Ü' } }))
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

  /*
   * INTERFACE.md 5.5: "Leaving the tab or closing the panel ends selection
   * mode." However Settings is closed, the piano key that was waiting is
   * forgotten: the next key press is not captured, now or when the Keys tab
   * is shown again.
   */
  it.each<[string, (user: User) => Promise<void>]>([
    [
      'Settings is closed with its close button',
      (user) => user.click(screen.getByRole('button', { name: 'Close Settings' })),
    ],
    [
      'the Menu button puts the start box in the place of Settings',
      async (user) => {
        await user.click(menuButton())
        expect(startBox()).not.toBeNull()
      },
    ],
    ['the empty sky is clicked', (user) => user.click(emptySky())],
    [
      // Two clicks: the Menu button takes Settings away, "All songs…" the start box.
      'the start box, and then the Songs panel, takes the place of Settings',
      async (user) => {
        await openSongs(user)
        expect(startBox()).toBeNull()
      },
    ],
  ])('forgets the waiting piano key when %s', async (_way, leave) => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await leave(user)
    expect(settingsPanel()).toBeNull()
    expect(isChoosingKeys()).toBe(false)

    await user.keyboard('[KeyZ][KeyA]')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
    expect(notes).toEqual(['on:60', 'off:60'])

    await openEditor(user)
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('false')
    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
  })

  it('forgets the waiting piano key when another tab of Settings is chosen', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    const settings = await openSettingsOn(user, 'Sound')
    expect(isChoosingKeys()).toBe(false)
    expect(settingsPanel()).toBe(settings)

    await user.keyboard('[KeyZ][KeyA]')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
    expect(notes).toEqual(['on:60', 'off:60'])

    await openEditor(user)
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('false')
    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings).toBe(DEFAULT_BINDINGS)
  })

  // INTERFACE.md 5.5: a ready-made layout is applied at once. A piano key that
  // was waiting no longer does: the next key press plays, in the new layout.
  it('forgets the waiting piano key when a ready-made layout is chosen', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.click(screen.getByRole('button', { name: 'Two octaves' }))
    expect(settingsStore.get().bindings).toEqual(layoutKeys('two-octaves'))
    expect(editorLead()).toBe(EDITOR_INSTRUCTION)
    expect(pianoKey('C4, key Q').getAttribute('aria-pressed')).toBe('false')

    // Q is middle C in that layout. It is played, not taken as the key for C4.
    await user.keyboard('[KeyQ>]')
    expect(notes).toEqual(['on:60'])
    expect(settingsStore.get().bindings).toEqual(layoutKeys('two-octaves'))
  })

  // Keys the player chose one by one are not replaced without asking. While
  // the question waits, nothing has changed and the keyboard plays as before.
  it('asks before a ready-made layout replaces keys the player chose, and plays on meanwhile', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C3', 'C3')
    await user.keyboard('[KeyZ]')
    const ownKeys = settingsStore.get().bindings

    await user.click(screen.getByRole('button', { name: 'White keys only' }))
    expect(screen.getByText('Replace your own keys with this layout?')).toBeTruthy()
    expect(settingsStore.get().bindings).toBe(ownKeys)
    await user.keyboard('[KeyZ][KeyA]')
    expect(notes).toEqual(['on:48', 'off:48', 'on:60', 'off:60'])

    await user.click(screen.getByRole('button', { name: 'No' }))
    expect(settingsStore.get().bindings).toBe(ownKeys)
    expect(screen.queryByText('Replace your own keys with this layout?')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'White keys only' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    expect(settingsStore.get().bindings).toEqual(layoutKeys('white-keys'))

    // In this layout Z is still the lowest C, and W is a white key of the top octave.
    notes.length = 0
    await user.keyboard('[KeyZ][KeyW]')
    expect(notes).toEqual(['on:48', 'off:48', 'on:74', 'off:74'])
  })

  // The spec does not say what the reset does to a piano key that is waiting,
  // or what the tab says afterwards. The app's choice: nothing is waiting
  // any more, and the tab says that the default keys are back.
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
    // Settings is still open on its Keys tab after all of that.
    expect(isChoosingKeys()).toBe(true)
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

  // The question takes the place of the button that was pressed, and the
  // answer takes the question away. Someone without a mouse must not lose
  // their place either time.
  it('keeps the keyboard focus through "Reset to default keys" and its answers', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')
    await user.keyboard('[KeyZ]')
    const reset = (): HTMLElement => screen.getByRole('button', { name: 'Reset to default keys' })
    reset().focus()

    // The focus goes to "No", the answer that changes nothing.
    await user.keyboard('[Enter]')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No' }))
    await user.keyboard('[Enter]')
    expect(document.activeElement).toBe(reset())
    expect(settingsStore.get().bindings.KeyZ).toBe(12)

    await user.keyboard('[Enter]')
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes' }))
    await user.keyboard('[Enter]')
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(editorMessage()).toBe(KEYS_RESET_MESSAGE)
    expect(document.activeElement).toBe(reset())
  })

  it('follows the computer keys when they are moved while a piano key is waiting', async () => {
    const user = await startApp()
    await selectPianoKey(user, 'C4, key A', 'C4')

    await user.click(screen.getByRole('button', { name: /Lower/ }))
    expect(editorLead()).toBe('Press a key for C3…')

    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(editorMessage()).toBe('"Z" now plays C3. "A" no longer plays a note.')
  })

  /*
   * The line that says what the last change did names a computer key and the
   * note it plays. Once the computer keys move lower or higher, or another
   * keyboard type changes the letters on the piano, it is no longer true: it
   * goes. The key that was chosen stays chosen.
   */
  it.each([
    ['the computer keys are moved higher', /Higher/, 'on:76'],
    ['another keyboard type is chosen', 'AZERTY', 'on:64'],
  ] as const)(
    'takes back what it said about the last change when %s',
    async (_change, buttonName, noteOfTheNewKey) => {
      const user = await startApp()
      await selectPianoKey(user, 'E4, key D', 'E4')
      await user.keyboard('[KeyM]')
      expect(editorMessage()).toBe('"M" now plays E4. "D" no longer plays a note.')

      await user.click(screen.getByRole('button', { name: buttonName }))
      expect(editorMessage()).toBe('')
      expect(editorLead()).toBe(EDITOR_INSTRUCTION)

      expect(settingsStore.get().bindings).toEqual({ ...withoutKey(DEFAULT_BINDINGS, 'KeyD'), KeyM: 16 })
      await user.keyboard('[KeyM>]')
      expect(notes).toEqual([noteOfTheNewKey])
    },
  )

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

  // From the app waiting to start to a changed key and back to playing, with
  // Tab, the arrow keys, Enter and Escape only.
  it('changes a key from start to finish without the mouse', async () => {
    const user = drawApp()
    await user.keyboard('[Enter]')
    expectStarted()

    // Settings is a line of the start box, which the Menu button opens.
    await tabTo(user, menuButton)
    await user.keyboard('[Enter]')
    const box = screen.getByRole('dialog', { name: 'Menu' })
    // The focus went into the box: onto its first line.
    expect(document.activeElement).toBe(within(box).getByRole('button', { name: /Free Play/ }))

    await tabTo(user, () => within(box).getByRole('button', { name: 'Settings' }))
    await user.keyboard('[Enter]')
    expect(startBox()).toBeNull()
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    // The focus went into the panel: onto the tab that is showing.
    expect(document.activeElement).toBe(within(settings).getByRole('tab', { selected: true }))

    // The tabs are one stop for Tab. Home goes to the first one, whichever
    // tab Settings was last on, and the arrow keys from one to the next.
    await user.keyboard('[Home]')
    expect(document.activeElement).toBe(within(settings).getByRole('tab', { name: 'Sound' }))
    expect(isChoosingKeys()).toBe(false)
    await user.keyboard('[ArrowRight]')
    expect(document.activeElement).toBe(within(settings).getByRole('tab', { name: 'Keys' }))
    expect(isChoosingKeys()).toBe(true)

    await tabTo(user, () => pianoKey('C4, key A'))
    await user.keyboard('[Enter]')
    expect(editorLead()).toBe('Press a key for C4…')

    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(editorMessage()).toBe('"Z" now plays C4. "A" no longer plays a note.')
    expect(document.activeElement).toBe(pianoKey('C4, key Z'))
    expect(notes).toEqual([])

    await user.keyboard('[Escape]')
    expect(settingsPanel()).toBeNull()
    // The focus is not lost with the panel: it is on the Menu button, which it was opened through.
    expect(document.activeElement).toBe(menuButton())
    expect(startBox()).toBeNull()

    await user.keyboard('[KeyZ>]')
    expect(notes).toEqual(['on:60'])
  })

  it('takes the keyboard away from the piano keys when the panel is closed', async () => {
    const user = await startApp()
    await openEditor(user)
    const key = pianoKey('C4, key A')
    key.focus()

    await user.keyboard('[Escape]')

    expect(settingsPanel()).toBeNull()
    // Where the keyboard goes instead is not checked here: only that no piano
    // key keeps it, and that the computer keys play again.
    expect(piano().contains(document.activeElement)).toBe(false)
    expect(key.tabIndex).toBe(-1)

    await user.keyboard('[KeyA>]')
    expect(notes).toEqual(['on:60'])
  })
})

describe('choosing your own keys with the key labels switched off', () => {
  /*
   * INTERFACE.md 5.5: while the Keys tab is open "the piano always shows the
   * keycaps", whatever the Labels setting says, and the saved setting is not
   * changed. The tab asks the player to change those keys, so they have to
   * be on screen. The computer keys are added to what the player chose: the
   * note names stay hidden with "No labels" and stay shown with "Notes only".
   */
  it.each([
    ['No labels', 'none', false],
    ['Notes only', 'notes', true],
  ] as const)(
    'shows the computer keys on the piano while the Keys tab is open, with Labels on "%s"',
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
      await closeSettings(user)
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
  const LAYOUTS = ['Home row', 'Two octaves', 'White keys only']
  const PIANO_SIZES = ['Auto', '88', '61', '49', '37']

  /*
   * Plays, moves the computer keys, changes them one by one and by layout,
   * resizes the piano, opens and closes the start box and the panels, loses
   * the window and hides the tab at random, with real key downs, repeats and
   * key ups.
   *
   * Nothing may be held right after the window lost the focus, the tab was
   * hidden or the computer keys moved; once every key is up again no note may
   * be left sounding; and the keys must still be one per note.
   *
   * A session is some 250 actions on the whole screen: it gets more time
   * than a test usually does, for a machine that is busy with other tests.
   */
  const SESSION_TIMEOUT_MS = 20_000

  it.each([21, 22, 23, 24, 25, 26])(
    'leave no note behind once every key is up (seed %i)',
    { timeout: SESSION_TIMEOUT_MS },
    async (seed) => {
      const user = await startApp()
      // Settings opens on the tab it was last on, also in the test before this
      // one. Each session starts from the same tab, so a seed is one session.
      await leaveSettingsOn(user, 'Sound')
      notes.length = 0
      audio.calls.length = 0

      const random = seededRandom(seed)
      const pick = <Item,>(items: readonly Item[]): Item => {
        const item = items[Math.floor(random() * items.length)]
        if (item === undefined) throw new Error('nothing to pick from')
        return item
      }
      const down = new Set<string>()
      const modifiers = { shiftKey: false, ctrlKey: false, altKey: false }
      const target = (): Element => document.activeElement ?? document.body
      const pressKey = (code: string): void => {
        fireEvent.keyDown(target(), { code, repeat: down.has(code), ...modifiers })
        down.add(code)
      }
      const click = (element: Element | null | undefined): void => {
        if (element instanceof HTMLButtonElement && !element.disabled) {
          fireEvent.click(element, { detail: 1 })
        }
      }
      /** What is open under the menu: the start box or a panel. There is never more than one. */
      const openBoxOrPanel = (): HTMLElement | null => document.querySelector('[role="dialog"]')
      /**
       * A button of the menu, of the start box or of the open panel, by its
       * name. (Not a key of the piano.)
       */
      const button = (name: string | RegExp): HTMLElement | null => {
        for (const place of [menu(), openBoxOrPanel()]) {
          if (place === null) continue
          const found = within(place).queryAllByRole('button', { name })[0]
          if (found !== undefined) return found
        }
        return null
      }
      /** Presses a line of the start box, which the Menu button opens first if it is closed. */
      const pressLineOfStartBox = (name: string): void => {
        if (startBox() === null) click(button('Menu'))
        click(button(name))
      }
      /**
       * Opens a panel with its line of the start box. When that panel is open
       * already, the Menu button takes it away and puts the start box there.
       */
      const openOrTakeAway = (panel: 'Settings' | 'Songs', line: string): void => {
        if (screen.queryByRole('dialog', { name: panel }) === null) pressLineOfStartBox(line)
        else click(button('Menu'))
      }
      const tabOfSettings = (tab: SettingsTab): HTMLElement | null => {
        const settings = settingsPanel()
        return settings === null ? null : within(settings).queryByRole('tab', { name: tab })
      }
      /** Opens Settings if it is closed, and shows one of its tabs. */
      const showTab = (tab: SettingsTab): void => {
        if (settingsPanel() === null) pressLineOfStartBox('Settings')
        click(tabOfSettings(tab))
      }
      // What the screen showed on the way, to know that the session went where it was meant to.
      let stepsWithAKeyWaiting = 0
      let stepsWithTheStartBoxOpen = 0
      let movesUnderAHeldNote = 0
      const pianosShown = new Set<number>()

      try {
        for (let step = 0; step < 250; step += 1) {
          const roll = random()
          if (roll < 0.28) {
            pressKey(pick(KEYS))
          } else if (roll < 0.52) {
            if (down.size === 0) continue
            const code = pick([...down])
            fireEvent.keyUp(target(), { code, ...modifiers })
            down.delete(code)
          } else if (roll < 0.57) {
            const modifier = pick(MODIFIERS)
            modifiers[modifier] = !modifiers[modifier]
          } else if (roll < 0.62) {
            // "Lower" and "Higher" are on the Keys tab, and showing it lets go
            // of every note. So a key goes down under the tab first, with Ctrl
            // and Alt let go (a key pressed with them plays nothing): the
            // computer keys then move while a note is held.
            showTab('Keys')
            modifiers.ctrlKey = false
            modifiers.altKey = false
            pressKey(pick(KEYS))
            const octave = settingsStore.get().baseOctave
            const heldBefore = held().length
            click(button(random() < 0.5 ? /Higher/ : /Lower/))
            if (settingsStore.get().baseOctave !== octave) {
              expect(held()).toEqual([])
              if (heldBefore > 0) movesUnderAHeldNote += 1
            }
          } else if (roll < 0.66) {
            openOrTakeAway('Settings', 'Settings')
          } else if (roll < 0.7) {
            click(tabOfSettings(pick(SETTINGS_TABS)))
          } else if (roll < 0.78) {
            if (isChoosingKeys()) click(pick([...piano().querySelectorAll('.piano-key')]))
          } else if (roll < 0.82) {
            for (const code of ['Escape', 'Backspace']) {
              if (random() < 0.5) {
                fireEvent.keyDown(target(), { code })
                fireEvent.keyUp(target(), { code })
              }
            }
          } else if (roll < 0.84) {
            click(button('Close Settings'))
          } else if (roll < 0.87) {
            showTab('Keys')
            click(button(pick(LAYOUTS)))
          } else if (roll < 0.89) {
            showTab('Keys')
            click(button('Reset to default keys'))
          } else if (roll < 0.91) {
            // Answers whatever question is waiting: about a layout, or about the reset.
            click(button(random() < 0.5 ? 'Yes' : 'No'))
          } else if (roll < 0.93) {
            // Another size than the one that is chosen, so that the piano changes.
            showTab('Piano')
            const isChosen = (size: string): boolean =>
              button(size)?.getAttribute('aria-pressed') === 'true'
            click(button(pick(PIANO_SIZES.filter((size) => !isChosen(size)))))
          } else if (roll < 0.94) {
            // A click starts with a press of the mouse, which is what takes the start box away.
            fireEvent.pointerDown(emptySky(), { button: 0 })
            fireEvent.click(emptySky(), { detail: 1 })
          } else if (roll < 0.95) {
            openOrTakeAway('Songs', 'All songs…')
          } else if (roll < 0.98) {
            fireEvent.blur(window)
            expect(held()).toEqual([])
            // Keys let go while another window has the keyboard never reach the page.
            if (random() < 0.5) down.clear()
          } else {
            setPageVisibility('hidden')
            expect(held()).toEqual([])
            setPageVisibility('visible')
          }

          const slots = Object.values(settingsStore.get().bindings)
          expect(new Set(slots).size).toBe(slots.length)

          if (piano().querySelector('.piano-key.is-selected') !== null) stepsWithAKeyWaiting += 1
          if (openBoxOrPanel()?.getAttribute('aria-label') === 'Menu') stepsWithTheStartBoxOpen += 1
          pianosShown.add(piano().querySelectorAll('.piano-key').length)
        }

        for (const code of [...down]) fireEvent.keyUp(target(), { code })
      } finally {
        setPageVisibility('visible')
      }

      // The session did go through the screen: a piano key waited for a
      // computer key, the start box was open, the piano became another one,
      // and the computer keys moved under a note that was held.
      expect(stepsWithAKeyWaiting).toBeGreaterThan(0)
      expect(stepsWithTheStartBoxOpen).toBeGreaterThan(0)
      expect(pianosShown.size).toBeGreaterThan(1)
      expect(movesUnderAHeldNote).toBeGreaterThan(0)

      expect(held()).toEqual([])
      expect(nowPlaying()).toEqual([])
      const onCount = audio.calls.filter((call) => call.startsWith('on:')).length
      const offCount = audio.calls.filter((call) => call.startsWith('off:')).length
      expect(offCount).toBe(onCount)
    },
  )
})

describe('React StrictMode', () => {
  it('listens to the keyboard once: one note and one sustain toggle per key press', async () => {
    const user = await startApp()

    await user.keyboard('[KeyA][Space]')

    expect(audio.calls).toEqual(['on:60', 'off:60'])
    expect(isSustainOn()).toBe(true)
  })

  it('captures a key once while the keys are being chosen', async () => {
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
