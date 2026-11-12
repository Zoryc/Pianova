// @vitest-environment jsdom
/**
 * The whole screen as a player meets it: the real <App /> drawn in a
 * simulated browser and used with real clicks and key presses. Only the sound
 * engine is replaced, by a silent stand-in whose status the tests can set.
 *
 * Covered here: the start overlay, every control of the top bar and of the
 * Settings panel with what it stores and shows, both reset flows, the
 * Transposed and Sustain badges, the notes being played, the sound status and
 * its retry, where the keyboard focus goes, keyboard-only use (with what
 * Escape takes back, one thing at a time), ARIA and wording.
 *
 * In this simulated browser nothing has a size, so the piano is the smallest
 * one: 37 keys, C3 to C6.
 */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = {
    status: 'idle' as 'idle' | 'loading' | 'ready' | 'fallback' | 'error',
    /** What start() leads to. */
    startsAs: 'ready' as 'idle' | 'loading' | 'ready' | 'fallback' | 'error',
    /** How many times the app asked for the sound to start. Every call counts. */
    starts: 0,
    calls: [] as string[],
  }
  function setStatus(next: typeof state.status): void {
    if (next === state.status) return
    state.status = next
    for (const listener of [...listeners]) listener()
  }
  const engine = {
    start(): Promise<void> {
      state.starts += 1
      setStatus(state.startsAs)
      return Promise.resolve()
    },
    getStatus: () => state.status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    noteOn(midi: number, velocity?: number): void {
      state.calls.push(`on:${midi}:${velocity}`)
    },
    noteOff(midi: number): void {
      state.calls.push(`off:${midi}`)
    },
    setSustain(on: boolean): void {
      state.calls.push(`sustain:${on}`)
    },
    setVolume(volume: number): void {
      state.calls.push(`volume:${volume}`)
    },
    setTranspose(semitones: number): void {
      state.calls.push(`transpose:${semitones}`)
    },
    setReverb(amount: number): void {
      state.calls.push(`reverb:${amount}`)
    },
    setRelease(seconds: number): void {
      state.calls.push(`release:${seconds}`)
    },
    allNotesOff(): void {},
    dispose(): void {},
  }
  return { engine, state, setStatus }
})

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

import { App } from './App'
import { APP_NAME } from './app/appInfo'
import { bus } from './app/pianoApp'
import { DEFAULT_BINDINGS } from './input/keymap'
import { DEFAULT_SETTINGS, STORAGE_KEY, settingsStore } from './state/settings'
import type { Settings } from './state/settings'
import { installFakeBrowser } from './ui/sky/skyTestKit'
import type { FakeBrowser } from './ui/sky/skyTestKit'
import { resetSongs } from './ui/songsTestKit'
import { AUTO_HIDE_DELAY_MS } from './ui/useAutoHide'

type User = ReturnType<typeof userEvent.setup>

const START_TEXT = 'Click or press any key to start'
const HINT_TEXT = 'Press the keys shown on the piano, or click it'

type SettingsTab = 'Sound' | 'Keys' | 'Piano' | 'Look' | 'About'
const SETTINGS_TABS: readonly SettingsTab[] = ['Sound', 'Keys', 'Piano', 'Look', 'About']

/** jsdom has no canvas: the sky simply draws nothing. */
const noCanvas = (() => null) as HTMLCanvasElement['getContext']

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = noCanvas
  // jsdom has no pointer capture: the piano only needs the calls not to throw.
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.hasPointerCapture ??= () => false
})

beforeEach(async () => {
  await resetSongs()
  audio.state.status = 'idle'
  audio.state.startsAs = 'ready'
  audio.state.starts = 0
  audio.state.calls.length = 0
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
})

afterEach(async () => {
  cleanup()
  bus.allOff()
  // A song that a test left in the player must not play on into the next test.
  await resetSongs()
})

/** Draws the app the way main.tsx does. */
function drawApp(): User {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  return userEvent.setup()
}

/** Draws the app and gets past the start overlay with a click, like most players. */
async function startApp(): Promise<User> {
  const user = drawApp()
  await user.click(screen.getByRole('button', { name: new RegExp(START_TEXT) }))
  return user
}

function setAudioStatus(status: FakeStatus): void {
  act(() => audio.setStatus(status))
}

function saved(): Partial<Settings> {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === null ? {} : (JSON.parse(raw) as Partial<Settings>)
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function found<T extends Element>(element: T | null, what: string): T {
  if (!element) throw new Error(`${what} is missing`)
  return element
}

/** Everything that waits behind the start overlay. */
function appScreen(): HTMLElement {
  return found(document.querySelector<HTMLElement>('.app__screen'), 'The screen')
}

/** The bar at the top: the name, the modes, volume, sustain, Songs and Settings. */
function topBar(): HTMLElement {
  return found(document.querySelector<HTMLElement>('.top-bar'), 'The top bar')
}

function settingsButton(): HTMLElement {
  return within(topBar()).getByRole('button', { name: 'Settings' })
}

function songsButton(): HTMLElement {
  return within(topBar()).getByRole('button', { name: 'Songs' })
}

/** One of the two floating panels, or null while it is closed. */
function panelNamed(name: 'Settings' | 'Songs'): HTMLElement | null {
  return screen.queryByRole('dialog', { name })
}

function settingsPanel(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Settings' })
}

function settingsTab(name: SettingsTab): HTMLElement {
  return within(settingsPanel()).getByRole('tab', { name })
}

/**
 * Opens Settings with the mouse (unless it is open) and shows one of its tabs.
 * The panel remembers its last tab from test to test, so the tab is always clicked.
 */
async function openSettings(user: User, tab: SettingsTab): Promise<HTMLElement> {
  if (!panelNamed('Settings')) await user.click(settingsButton())
  await user.click(settingsTab(tab))
  return settingsPanel()
}

/**
 * Opens Settings with the keyboard alone and goes to one of its tabs with the
 * arrow keys. The focus ends on that tab.
 */
async function openSettingsWithKeyboard(user: User, tab: SettingsTab): Promise<HTMLElement> {
  await tabTo(user, settingsButton())
  await user.keyboard('[Enter]')
  await user.keyboard('[Home]')
  for (let step = 0; step < SETTINGS_TABS.indexOf(tab); step += 1) await user.keyboard('[ArrowRight]')
  expect(document.activeElement).toBe(settingsTab(tab))
  return settingsPanel()
}

/** The row of one option of Settings, found by its name: it holds the control and the explanation. */
function option(container: HTMLElement, name: string): HTMLElement {
  return within(container).getByRole('group', { name })
}

/** The explanation an element points screen readers to, or '' when it has none. */
function explanationOf(element: Element): string {
  const id = element.getAttribute('aria-describedby')
  const explanation = id === null ? null : document.getElementById(id)
  return explanation?.textContent ?? ''
}

/** The names of the options of a tab and its titles, top to bottom, as a player reads them. */
function namesInOrder(container: Element): string[] {
  const names = container.querySelectorAll('.field__label, .settings-label, .settings-section-title')
  return [...names].map((name) => name.textContent ?? '')
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

/** A piano key by what a screen reader calls it, e.g. "C4, key A". Works in and out of edit mode. */
function pianoKey(label: string): HTMLElement {
  const key = piano().querySelector<HTMLElement>(`.piano-key[aria-label="${label}"]`)
  if (!key) throw new Error(`No piano key is labelled "${label}"`)
  return key
}

/** True while a click on the piano chooses the key to change: Settings is on its Keys tab. */
function isCustomizing(): boolean {
  return piano().classList.contains('piano--editing')
}

/** The part of the Keys tab that says what to do to change one key, and what the last change did. */
function changeOneKey(): HTMLElement {
  return screen.getByRole('region', { name: 'Change one key' })
}

/** The line of the Keys tab that says what the last change did. */
function keyMessage(): HTMLElement {
  return within(changeOneKey()).getByRole('status')
}

/** The sky above the piano, with the few words that float over it. */
function sky(): HTMLElement {
  return found(document.querySelector<HTMLElement>('.stage__sky'), 'The sky')
}

/** The line that says what the sound is doing, when that is worth saying. */
function soundStatus(): HTMLElement {
  return within(sky()).getByRole('status')
}

/** The names of the notes being played, as written above the piano. None when nothing is held. */
function playedNotes(): string[] {
  const list = within(sky()).queryByRole('list', { name: 'Notes being played' })
  return list === null ? [] : within(list).getAllByRole('listitem').map((note) => note.textContent ?? '')
}

/** True while the sky says how to play. (The words stay on the page; a class takes them off the screen.) */
function hintIsShown(): boolean {
  return !within(sky()).getByText(HINT_TEXT).classList.contains('stage__hint--gone')
}

function transposedBadge(): HTMLElement | null {
  return within(sky()).queryByText(/^Transposed/)
}

/** The sign on the stage that sustain is on. It stays when the menu, and its switch, is hidden. */
function sustainBadge(): HTMLElement | null {
  return within(sky()).queryByText('Sustain on')
}

/** The text of an element with single spaces, as it is read. */
function textOf(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** The words a player sees on a control, one space between them, without the decoration. */
function wordsOn(element: Element): string {
  const copy = element.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  const words: string[] = []
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const text = (walker.currentNode.textContent ?? '').trim()
    if (text !== '') words.push(text)
  }
  return words.join(' ')
}

/** True when `first` comes before `second` on the page, as it is read from top to bottom. */
function comesBefore(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/**
 * What a control is called: its aria-label, or the text of what it is
 * labelled by, or else its own text without the decoration hidden from
 * screen readers.
 */
function nameOf(element: Element | null): string {
  if (!element || element === document.body) return '(nothing)'
  const label = element.getAttribute('aria-label')
  if (label !== null) return label
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy !== null) {
    return labelledBy
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .join(' ')
  }
  const copy = element.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return textOf(copy)
}

/**
 * The controls of the top bar, in the order Tab reaches them. In this
 * simulated browser there is no full screen, so its button is not drawn
 * (see "full screen" below).
 */
const TOP_BAR_ORDER = ['Free Play', 'Volume', 'Sustain', 'Songs', 'Settings']

/**
 * How long a test may take that walks through dozens of controls, with Tab or
 * with one click after the other. Such a walk takes about a second, which is
 * too close to the usual limit when the machine is busy.
 */
const LONG_WALK_MS = 20_000

/** Presses Tab `times` times and returns the name of each control reached. */
async function tabThrough(user: User, times: number): Promise<string[]> {
  const names: string[] = []
  for (let step = 0; step < times; step += 1) {
    await user.tab()
    names.push(nameOf(document.activeElement))
  }
  return names
}

/** Presses Tab (or Shift+Tab, to go back) until `target` has the keyboard focus. */
async function tabTo(user: User, target: HTMLElement, back = false): Promise<void> {
  for (let step = 0; step < 80 && document.activeElement !== target; step += 1) {
    await user.tab({ shift: back })
  }
  expect(document.activeElement).toBe(target)
}

// ---------------------------------------------------------------------------

describe('start overlay', () => {
  it('covers the screen until the first click, and the click starts the sound once', async () => {
    const user = drawApp()
    const overlay = screen.getByRole('button', { name: new RegExp(START_TEXT) })
    expect(overlay.textContent).toContain(APP_NAME)
    // Everything else waits behind it, out of reach: the menu, the sky and the piano.
    expect(appScreen().hasAttribute('inert')).toBe(true)
    expect(appScreen().contains(topBar())).toBe(true)
    expect(appScreen().contains(sky())).toBe(true)
    expect(appScreen().contains(piano())).toBe(true)
    expect(appScreen().contains(overlay)).toBe(false)
    expect(audio.state.starts).toBe(0)

    await user.click(overlay)

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(appScreen().hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
    // The overlay is gone, so nothing is left holding the keyboard.
    expect(document.activeElement).toBe(document.body)
  })

  it('goes away on a key press, which neither plays a note nor does anything else', async () => {
    const user = drawApp()

    await user.keyboard('[KeyA>]')
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')
    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([])

    // The next press of the same key is an ordinary note.
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    await user.keyboard('[/KeyA]')
    expect(heldNotes()).toEqual([])
  })

  it.each(['Space', 'Enter', 'Tab', 'Escape', 'ShiftLeft'])(
    'the first press of %s removes the overlay and does nothing else',
    async (code) => {
      const user = drawApp()
      await user.keyboard(`[${code}]`)

      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(isCustomizing()).toBe(false)
      expect(document.activeElement).toBe(document.body)
      expect(heldNotes()).toEqual([])
    },
  )

  // Escape and a lone Shift are left out on purpose: a browser does not count
  // them as the player doing something and refuses the sound on them. What
  // the app does about that needs a browser that says so, or a stand-in for
  // one: it is tested in src/App.edge.test.tsx.
  it.each(['Space', 'Enter', 'Tab', 'KeyQ', 'Digit1'])(
    'the first press of %s starts the sound, once',
    async (code) => {
      const user = drawApp()
      await user.keyboard(`[${code}]`)
      expect(audio.state.starts).toBe(1)
    },
  )

  // With Ctrl held a key belongs to the browser: Ctrl+R reloads the page and
  // Ctrl+W closes the tab (W alone is a note). Whether such a press also
  // counts as "any key" for the overlay is left open here.
  it.each([
    ['while the overlay is up', drawApp],
    ['once the app has started', startApp],
  ] as const)('leaves browser shortcuts to the browser %s', async (_when, begin) => {
    await begin()
    for (const [code, key] of [
      ['KeyR', 'r'],
      ['KeyW', 'w'],
    ] as const) {
      // fireEvent returns false when something cancelled the key.
      expect(fireEvent.keyDown(document.body, { code, key, ctrlKey: true }), code).toBe(true)
      fireEvent.keyUp(document.body, { code, key, ctrlKey: true })
    }
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([])
  })

  it('does not start the sound a second time once it runs', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA][KeyS]')
    await user.click(settingsButton())
    await user.click(settingsButton())
    await user.click(songsButton())
    await user.click(sky())
    expect(audio.state.starts).toBe(1)
  })
})

// ---------------------------------------------------------------------------

describe('header and tabs', () => {
  it('shows the app name as the page heading', async () => {
    await startApp()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe(APP_NAME)
    expect(topBar().contains(heading)).toBe(true)
  })

  it('offers the three modes as real tabs, Free Play selected, the others not available yet', async () => {
    await startApp()
    const tablist = screen.getByRole('tablist')
    expect(tablist.getAttribute('aria-label')).toBeTruthy()
    expect(topBar().contains(tablist)).toBe(true)

    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.firstChild?.textContent)).toEqual([
      'Free Play',
      'Practice',
      'Real-time',
    ])
    expect(tabs.map((tab) => tab.querySelector('.mode-tab__badge')?.textContent)).toEqual([
      undefined,
      'Soon',
      'Soon',
    ])

    const [freePlay, practice, realTime] = tabs as [HTMLElement, HTMLElement, HTMLElement]
    expect(freePlay.getAttribute('aria-selected')).toBe('true')
    expect(freePlay.getAttribute('aria-disabled')).not.toBe('true')
    for (const tab of [practice, realTime]) {
      expect(tab.getAttribute('aria-selected')).toBe('false')
      expect(tab.getAttribute('aria-disabled')).toBe('true')
      expect(tab.getAttribute('title')).toBe('Coming in a later update')
    }
  })

  it('ties the selected tab to the page below it, both ways', async () => {
    await startApp()
    const freePlay = screen.getByRole('tab', { name: 'Free Play' })
    const page = screen.getByRole('tabpanel')
    expect(freePlay.getAttribute('aria-controls')).toBe(page.id)
    expect(page.getAttribute('aria-labelledby')).toBe(freePlay.id)
    // The page of Free Play is the stage: the sky and the piano under it.
    expect(page.contains(sky())).toBe(true)
    expect(page.contains(piano())).toBe(true)
    expect(comesBefore(sky(), piano())).toBe(true)
  })

  it('does nothing when a mode that is not built yet is clicked', async () => {
    const user = await startApp()
    await user.click(screen.getByRole('tab', { name: /Practice/ }))
    expect(screen.getByRole('tab', { name: 'Free Play' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByRole('tab', { name: /Practice/ }).getAttribute('aria-selected')).toBe(
      'false',
    )
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
  })
})

// ---------------------------------------------------------------------------

describe('top bar', () => {
  it('volume: the slider is named, moves the setting, the percentage and the sound', async () => {
    const user = await startApp()
    const slider = within(topBar()).getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    expect(slider.value).toBe('80')
    expect(slider.getAttribute('aria-valuetext')).toBe('80%')

    fireEvent.change(slider, { target: { value: '35' } })

    expect(settingsStore.get().volume).toBe(0.35)
    expect(saved().volume).toBe(0.35)
    expect(slider.value).toBe('35')
    expect(slider.getAttribute('aria-valuetext')).toBe('35%')
    expect(audio.state.calls).toContain('volume:0.35')

    // The same volume is in Settings, with its percentage written next to it.
    const sound = await openSettings(user, 'Sound')
    const inSettings = within(sound).getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    expect(inSettings.value).toBe('35')
    expect(inSettings.getAttribute('aria-valuetext')).toBe('35%')
    expect(within(option(sound, 'Volume')).getByText('35%')).toBeTruthy()

    // And the two follow each other.
    fireEvent.change(inSettings, { target: { value: '60' } })
    expect(settingsStore.get().volume).toBe(0.6)
    expect(saved().volume).toBe(0.6)
    expect(slider.value).toBe('60')
    expect(slider.getAttribute('aria-valuetext')).toBe('60%')
    expect(within(option(sound, 'Volume')).getByText('60%')).toBeTruthy()
    expect(audio.state.calls.at(-1)).toBe('volume:0.6')
  })

  it('volume: goes all the way down to 0% and up to 100%', async () => {
    const user = await startApp()
    const sound = await openSettings(user, 'Sound')
    const inSettings = within(sound).getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    const slider = within(topBar()).getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    for (const either of [slider, inSettings]) {
      expect(either.min).toBe('0')
      expect(either.max).toBe('100')
    }

    fireEvent.change(slider, { target: { value: '0' } })
    expect(settingsStore.get().volume).toBe(0)
    expect(slider.getAttribute('aria-valuetext')).toBe('0%')
    expect(within(option(sound, 'Volume')).getByText('0%')).toBeTruthy()

    fireEvent.change(slider, { target: { value: '100' } })
    expect(settingsStore.get().volume).toBe(1)
    expect(slider.getAttribute('aria-valuetext')).toBe('100%')
    expect(within(option(sound, 'Volume')).getByText('100%')).toBeTruthy()
  })

  it('sustain: a click switches it on and off, in words and for screen readers', async () => {
    const user = await startApp()
    const sustain = within(topBar()).getByRole('switch', { name: 'Sustain' })
    expect(sustain.getAttribute('aria-checked')).toBe('false')
    expect(wordsOn(sustain)).toBe('Sustain Off')
    // The hint that Space does the same.
    expect(within(topBar()).getByText('Space')).toBeTruthy()

    await user.click(sustain)
    expect(settingsStore.get().sustain).toBe(true)
    expect(saved().sustain).toBe(true)
    expect(sustain.getAttribute('aria-checked')).toBe('true')
    expect(wordsOn(sustain)).toBe('Sustain On')
    expect(audio.state.calls.at(-1)).toBe('sustain:true')

    await user.click(sustain)
    expect(settingsStore.get().sustain).toBe(false)
    expect(sustain.getAttribute('aria-checked')).toBe('false')
    expect(wordsOn(sustain)).toBe('Sustain Off')
    expect(audio.state.calls.at(-1)).toBe('sustain:false')
  })

  it('sustain: Space switches it too, and the switch on screen follows', async () => {
    const user = await startApp()
    const sustain = within(topBar()).getByRole('switch', { name: 'Sustain' })

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(sustain.getAttribute('aria-checked')).toBe('true')

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(false)
    expect(sustain.getAttribute('aria-checked')).toBe('false')
  })

  it('sustain: the switch in Settings and the one in the top bar are the same switch', async () => {
    const user = await startApp()
    const sound = await openSettings(user, 'Sound')
    const inSettings = within(sound).getByRole('switch', { name: 'Sustain' })
    const inTopBar = within(topBar()).getByRole('switch', { name: 'Sustain' })
    expect(textOf(inSettings)).toBe('Off')

    await user.click(inSettings)
    expect(settingsStore.get().sustain).toBe(true)
    expect(saved().sustain).toBe(true)
    expect(textOf(inSettings)).toBe('On')
    expect(inTopBar.getAttribute('aria-checked')).toBe('true')
    expect(audio.state.calls.at(-1)).toBe('sustain:true')

    await user.keyboard('[Space]')
    expect(inSettings.getAttribute('aria-checked')).toBe('false')
    expect(textOf(inSettings)).toBe('Off')
    expect(inTopBar.getAttribute('aria-checked')).toBe('false')
  })

  it('settings: closed at first; the button opens and closes the panel and says so with aria-expanded', async () => {
    const user = await startApp()
    const button = settingsButton()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const panel = settingsPanel()
    expect(button.getAttribute('aria-controls')).toBe(panel.id)
    expect(within(panel).getByRole('heading', { name: 'Settings' })).toBeTruthy()
    // On the page it comes after the menu and before the stage: Tab goes from the menu into it.
    expect(comesBefore(topBar(), panel)).toBe(true)
    expect(comesBefore(panel, sky())).toBe(true)
    expect(comesBefore(panel, piano())).toBe(true)

    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('songs: closed at first; the button opens and closes the panel, and only one panel is open at a time', async () => {
    const user = await startApp()
    const button = songsButton()
    expect(button.getAttribute('aria-expanded')).toBe('false')

    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const panel = found(panelNamed('Songs'), 'The Songs panel')
    expect(button.getAttribute('aria-controls')).toBe(panel.id)
    expect(within(panel).getByRole('heading', { name: 'Songs' })).toBeTruthy()

    await user.click(settingsButton())
    expect(panelNamed('Songs')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(settingsButton().getAttribute('aria-expanded')).toBe('true')

    await user.click(button)
    expect(panelNamed('Settings')).toBeNull()
    await user.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('every control has a visible plain-word label', async () => {
    const user = await startApp()
    // In the top bar the word is written on the control itself.
    expect([...topBar().querySelectorAll('button')].map(wordsOn)).toEqual([
      'Free Play',
      'Practice Soon',
      'Real-time Soon',
      'Sustain Off',
      'Songs',
      'Settings',
    ])
    // The one exception is the volume: a loudspeaker next to a short slider.
    const volume = within(topBar()).getByRole('slider', { name: 'Volume' })
    expect(volume.parentElement?.querySelector('svg')).not.toBeNull()

    // In Settings every option has its name written next to it.
    const names: Record<SettingsTab, string[]> = {
      Sound: ['Volume', 'Sustain', 'Advanced', 'Touch', 'Room echo', 'Note fade-out', 'Transpose'],
      Keys: ['Key layout', 'Change one key', 'Where your keys sit', 'Keyboard type'],
      Piano: ['Piano size', 'Key style', 'Labels on the keys', 'Note names'],
      Look: [
        'Theme',
        'Fine-tune',
        'Colour',
        'Glow',
        'Background',
        'Light bars',
        'Bar style',
        'Sparks',
        'Key letters on falling notes',
        'Show the notes being played',
        'Hide the menu automatically',
      ],
      About: [],
    }
    for (const tab of SETTINGS_TABS) {
      const panel = await openSettings(user, tab)
      expect(namesInOrder(panel), tab).toEqual(names[tab])
      expect(within(panel).getAllByRole('tab').map(wordsOn)).toEqual(SETTINGS_TABS)

      // No control stands alone: it is in a row with a name, or says itself what it does.
      const controls = panel.querySelectorAll('.settings-page button, .settings-page select')
      expect(controls.length, tab).toBeGreaterThan(0)
      for (const control of controls) {
        const row = control.closest('.field, .choice-group')
        const rowName = row?.querySelector('.field__label, .settings-label')?.textContent ?? ''
        expect(rowName !== '' || wordsOn(control) !== '', control.outerHTML.slice(0, 80)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// The last button of the top bar. jsdom cannot fill the screen, so these
// tests give it a stand-in that remembers what it was asked, and can say no.
// ---------------------------------------------------------------------------

describe('full screen', () => {
  const browser = {
    /** What fills the screen right now, or null. */
    element: null as Element | null,
    refuses: false,
    requests: [] as Element[],
    exits: 0,
  }

  /** The browser goes into or out of full screen, and says so. */
  function fill(element: Element | null): void {
    browser.element = element
    document.dispatchEvent(new Event('fullscreenchange'))
  }

  function fullScreenButton(): HTMLElement {
    return within(topBar()).getByRole('button', { name: /full screen$/i })
  }

  beforeEach(() => {
    browser.element = null
    browser.refuses = false
    browser.requests = []
    browser.exits = 0
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => browser.element,
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value(): Promise<void> {
        browser.exits += 1
        fill(null)
        return Promise.resolve()
      },
    })
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value(this: Element): Promise<void> {
        browser.requests.push(this)
        if (browser.refuses) return Promise.reject(new TypeError('The browser said no.'))
        fill(this)
        return Promise.resolve()
      },
    })
  })

  afterEach(() => {
    // The app goes first, while the stand-in it was drawn with is still there.
    cleanup()
    const page = document as unknown as Record<string, unknown>
    delete page.fullscreenEnabled
    delete page.fullscreenElement
    delete page.exitFullscreen
    delete (Element.prototype as unknown as Record<string, unknown>).requestFullscreen
  })

  it('is not offered where the browser cannot fill the screen', async () => {
    delete (document as unknown as Record<string, unknown>).fullscreenEnabled
    await startApp()
    expect(within(topBar()).queryByRole('button', { name: /full screen/i })).toBeNull()
    expect([...topBar().querySelectorAll('button')].at(-1)).toBe(settingsButton())
  })

  it('fills the screen with the whole page and puts it back, and always says which of the two it will do', async () => {
    const user = await startApp()
    const button = fullScreenButton()
    // The last control of the top bar: a small drawing, named for screen readers and in a tooltip.
    expect([...topBar().querySelectorAll('button')].at(-1)).toBe(button)
    expect(button.getAttribute('aria-label')).toBe('Full screen')
    expect(button.getAttribute('title')).toBe('Full screen')
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(wordsOn(button)).toBe('')

    await user.click(button)
    // Full screen is asked for the whole page, once: everything the app draws is in it.
    expect(browser.requests).toHaveLength(1)
    expect(browser.requests[0]).toBe(document.documentElement)
    expect(button.getAttribute('aria-label')).toBe('Leave full screen')
    expect(button.getAttribute('title')).toBe('Leave full screen')
    expect(browser.exits).toBe(0)

    await user.click(button)
    expect(browser.exits).toBe(1)
    expect(browser.requests).toHaveLength(1)
    expect(button.getAttribute('aria-label')).toBe('Full screen')
    expect(button.getAttribute('title')).toBe('Full screen')

    // The browser has its own ways out (Escape, F11): the button follows those too.
    await user.click(button)
    expect(button.getAttribute('aria-label')).toBe('Leave full screen')
    act(() => fill(null))
    expect(button.getAttribute('aria-label')).toBe('Full screen')
    expect(browser.exits).toBe(1)

    // Nothing else changed, and no panel opened.
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays as it is when the browser says no', async () => {
    browser.refuses = true
    const user = await startApp()
    const button = fullScreenButton()

    await user.click(button)

    expect(browser.requests).toHaveLength(1)
    expect(button.getAttribute('aria-label')).toBe('Full screen')
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    await user.keyboard('[/KeyA]')
  })

  it.each(['Full screen', 'Leave full screen'])(
    'after a click on "%s" the player can go straight back to playing',
    async (name) => {
      const user = await startApp()
      if (name === 'Leave full screen') await user.click(fullScreenButton())
      expect(fullScreenButton().getAttribute('aria-label')).toBe(name)

      await user.click(fullScreenButton())

      expect(document.activeElement).toBe(document.body)
      await user.keyboard('[KeyA>]')
      expect(heldNotes()).toEqual([60])
      await user.keyboard('[/KeyA]')
      await user.keyboard('[Space]')
      expect(settingsStore.get().sustain).toBe(true)
      // Enter does not press it again.
      const requests = browser.requests.length
      const exits = browser.exits
      await user.keyboard('[Enter]')
      expect(browser.requests).toHaveLength(requests)
      expect(browser.exits).toBe(exits)
    },
  )

  it('works with the keyboard alone: Tab reaches it last, Enter presses it, Space stays the sustain key', async () => {
    const user = await startApp()
    expect(await tabThrough(user, TOP_BAR_ORDER.length + 1)).toEqual([
      ...TOP_BAR_ORDER,
      'Full screen',
    ])
    const button = fullScreenButton()

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(browser.requests).toEqual([])

    await user.keyboard('[Enter]')
    expect(browser.requests).toHaveLength(1)
    expect(nameOf(button)).toBe('Leave full screen')
    // The player keeps their place, and can leave again from there.
    expect(document.activeElement).toBe(button)
    await user.keyboard('[Enter]')
    expect(browser.exits).toBe(1)
    expect(nameOf(button)).toBe('Full screen')
    expect(document.activeElement).toBe(button)
  })
})

// ---------------------------------------------------------------------------

describe('where the keys sit and what is written on them', () => {
  it('piano position: Lower and Higher move the range shown between them and on the piano', async () => {
    const user = await startApp()
    const keys = await openSettings(user, 'Keys')
    const position = option(keys, 'Where your keys sit')
    const lower = within(position).getByRole('button', { name: 'Lower' })
    const higher = within(position).getByRole('button', { name: 'Higher' })
    expect(within(position).getByText('C3 – C6')).toBeTruthy()
    expect(textOf(lower)).toMatch(/^◀︎? ?Lower$/)
    expect(textOf(higher)).toMatch(/^Higher ?▶︎?$/)
    expect(explanationOf(position)).toBe('Moves your computer keys to lower or higher notes.')

    await user.click(lower)
    expect(settingsStore.get().baseOctave).toBe(2)
    expect(saved().baseOctave).toBe(2)
    expect(within(position).getByText('C2 – C5')).toBeTruthy()
    // The same computer key now plays the note one step lower on the piano.
    expect(pianoKey('C3, key A')).toBeTruthy()

    await user.click(higher)
    await user.click(higher)
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(within(position).getByText('C4 – C7')).toBeTruthy()
    expect(pianoKey('C5, key A')).toBeTruthy()
  })

  it('piano position: the buttons are disabled at the two ends', async () => {
    const user = await startApp()
    const keys = await openSettings(user, 'Keys')
    const position = option(keys, 'Where your keys sit')
    const lower = within(position).getByRole('button', { name: 'Lower' }) as HTMLButtonElement
    const higher = within(position).getByRole('button', { name: 'Higher' }) as HTMLButtonElement

    await user.click(lower)
    await user.click(lower)
    expect(within(position).getByText('C1 – C4')).toBeTruthy()
    expect(lower.disabled).toBe(true)
    expect(higher.disabled).toBe(false)
    await user.click(lower)
    expect(settingsStore.get().baseOctave).toBe(1)

    for (let step = 0; step < 4; step += 1) await user.click(higher)
    expect(within(position).getByText('C5 – C8')).toBeTruthy()
    expect(higher.disabled).toBe(true)
    expect(lower.disabled).toBe(false)
    await user.click(higher)
    expect(settingsStore.get().baseOctave).toBe(5)
  })

  it('piano position: moving the keys lets go of a note that is held', async () => {
    const user = await startApp()
    const keys = await openSettings(user, 'Keys')
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])

    await user.click(within(keys).getByRole('button', { name: 'Higher' }))
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls).toContain('off:60')
    expect(piano().querySelector('.is-lit')).toBeNull()
    expect(playedNotes()).toEqual([])

    await user.keyboard('[/KeyA]')
    expect(heldNotes()).toEqual([])
  })

  it.each([
    ['Keys only', 'keys', true, false],
    ['Notes only', 'notes', false, true],
    ['No labels', 'none', false, false],
    ['Keys and notes', 'both', true, true],
  ] as const)('labels: "%s" is saved and changes what is written on the keys', async (choice, mode, caps, notes) => {
    const user = await startApp()
    // Start from a different mode, so that choosing this one is a change.
    act(() => settingsStore.set({ labelMode: mode === 'both' ? 'none' : 'both' }))
    const pianoTab = await openSettings(user, 'Piano')
    const select = within(pianoTab).getByRole('combobox', {
      name: 'Labels on the keys',
    }) as HTMLSelectElement

    await user.selectOptions(select, choice)

    expect(settingsStore.get().labelMode).toBe(mode)
    expect(saved().labelMode).toBe(mode)
    expect(select.value).toBe(mode)
    expect(piano().querySelectorAll('.piano-key__cap').length > 0).toBe(caps)
    expect(piano().querySelectorAll('.piano-key__note').length > 0).toBe(notes)
  })

  it('labels: offers the four choices in plain words', async () => {
    const user = await startApp()
    const pianoTab = await openSettings(user, 'Piano')
    const select = within(pianoTab).getByRole('combobox', { name: 'Labels on the keys' })
    expect(option(pianoTab, 'Labels on the keys').contains(select)).toBe(true)
    expect(within(select).getAllByRole('option').map((choice) => choice.textContent)).toEqual([
      'Keys and notes',
      'Keys only',
      'Notes only',
      'No labels',
    ])
  })

  it('customize keys: the Keys tab of Settings turns it on, and leaving the tab turns it off', async () => {
    const user = await startApp()
    expect(isCustomizing()).toBe(false)

    const settings = await openSettings(user, 'Keys')
    expect(settingsTab('Keys').getAttribute('aria-selected')).toBe('true')
    expect(isCustomizing()).toBe(true)
    expect(textOf(changeOneKey())).toContain(
      'Click a piano key below, then press the key you want to use for it.',
    )

    await user.click(settingsTab('Sound'))
    expect(settingsTab('Keys').getAttribute('aria-selected')).toBe('false')
    expect(isCustomizing()).toBe(false)
    expect(within(settings).queryByRole('region', { name: 'Change one key' })).toBeNull()

    await user.click(settingsTab('Keys'))
    expect(isCustomizing()).toBe(true)

    await user.click(settingsButton())
    expect(panelNamed('Settings')).toBeNull()
    expect(isCustomizing()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The options that used to be the Advanced panel. They are in Settings now:
// Touch, Room echo, Note fade-out and Transpose under "Advanced" in the Sound
// tab, Note names in the Piano tab, Light bars in the Look tab.
// ---------------------------------------------------------------------------

describe('the fine-tuning options of Settings', () => {
  it('has the six of them where the tabs say, each explained in one line', async () => {
    const user = await startApp()
    const sound = await openSettings(user, 'Sound')
    // The everyday options come first, the others after the title "Advanced".
    expect(namesInOrder(sound)).toEqual([
      'Volume',
      'Sustain',
      'Advanced',
      'Touch',
      'Room echo',
      'Note fade-out',
      'Transpose',
    ])
    expect(within(sound).getByRole('heading', { name: 'Advanced' })).toBeTruthy()
    for (const [name, sentence] of [
      ['Touch', 'How hard each note is played.'],
      ['Room echo', 'Adds the echo of a room. 0 is none.'],
      ['Note fade-out', 'How long a note rings after you let go.'],
      ['Transpose', 'Shifts every note up or down. 0 is normal.'],
    ] as const) {
      expect(explanationOf(option(sound, name)), name).toBe(sentence)
      expect(within(option(sound, name)).getByText(sentence)).toBeTruthy()
    }

    const pianoTab = await openSettings(user, 'Piano')
    expect(explanationOf(option(pianoTab, 'Note names'))).toBe('How notes are written on the piano.')
    expect(within(pianoTab).getByText('How notes are written on the piano.')).toBeTruthy()

    const look = await openSettings(user, 'Look')
    const lightBars = 'Bars of light for the notes you play and the falling notes of a song.'
    expect(explanationOf(option(look, 'Light bars'))).toBe(lightBars)
    expect(within(look).getByText(lightBars)).toBeTruthy()
  })

  it('touch: a slider from 10% to 100% that sets how hard notes are played', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Sound')
    const slider = within(panel).getByRole('slider', { name: 'Touch' }) as HTMLInputElement
    expect(slider.min).toBe('10')
    expect(slider.max).toBe('100')
    expect(slider.value).toBe('80')

    fireEvent.change(slider, { target: { value: '45' } })
    expect(settingsStore.get().velocity).toBe(0.45)
    expect(saved().velocity).toBe(0.45)
    expect(slider.getAttribute('aria-valuetext')).toBe('45%')
    expect(within(panel).getByText('45%')).toBeTruthy()

    // The very next note is played that hard.
    await user.keyboard('[KeyA]')
    expect(audio.state.calls).toContain('on:60:0.45')

    fireEvent.change(slider, { target: { value: '10' } })
    expect(settingsStore.get().velocity).toBe(0.1)
    expect(within(panel).getByText('10%')).toBeTruthy()
  })

  it('transpose: − and + step the value, written with its sign', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Sound')
    const down = within(panel).getByRole('button', { name: 'Transpose down' })
    const up = within(panel).getByRole('button', { name: 'Transpose up' })
    const value = panel.querySelector('.stepper__value') as HTMLElement
    expect(down.textContent).toBe('−')
    expect(up.textContent).toBe('+')
    expect(value.textContent).toBe('0')

    await user.click(up)
    await user.click(up)
    expect(settingsStore.get().transpose).toBe(2)
    expect(saved().transpose).toBe(2)
    expect(value.textContent).toBe('+2')
    expect(audio.state.calls.at(-1)).toBe('transpose:2')

    for (let step = 0; step < 5; step += 1) await user.click(down)
    expect(settingsStore.get().transpose).toBe(-3)
    expect(value.textContent).toBe('−3')
    expect(audio.state.calls.at(-1)).toBe('transpose:-3')
  })

  it('transpose: stops at 12 either way', async () => {
    const user = await startApp()
    act(() => settingsStore.set({ transpose: 11 }))
    const panel = await openSettings(user, 'Sound')
    const down = within(panel).getByRole('button', { name: 'Transpose down' }) as HTMLButtonElement
    const up = within(panel).getByRole('button', { name: 'Transpose up' }) as HTMLButtonElement

    await user.click(up)
    expect(settingsStore.get().transpose).toBe(12)
    expect(up.disabled).toBe(true)
    await user.click(up)
    expect(settingsStore.get().transpose).toBe(12)
    expect(panel.querySelector('.stepper__value')?.textContent).toBe('+12')

    act(() => settingsStore.set({ transpose: -11 }))
    expect(up.disabled).toBe(false)
    await user.click(down)
    expect(settingsStore.get().transpose).toBe(-12)
    expect(down.disabled).toBe(true)
    expect(panel.querySelector('.stepper__value')?.textContent).toBe('−12')
  })

  it('note names: "Do Ré Mi" renames the notes everywhere on the screen, "C D E" puts them back', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Piano')
    const letters = within(panel).getByRole('button', { name: 'C D E' })
    const solfege = within(panel).getByRole('button', { name: 'Do Ré Mi' })
    expect(letters.getAttribute('aria-pressed')).toBe('true')
    expect(solfege.getAttribute('aria-pressed')).toBe('false')

    await user.click(solfege)
    expect(settingsStore.get().noteNaming).toBe('solfege')
    expect(saved().noteNaming).toBe('solfege')
    expect(letters.getAttribute('aria-pressed')).toBe('false')
    expect(solfege.getAttribute('aria-pressed')).toBe('true')
    // On the piano, in what a screen reader says and in what is written on the keys.
    expect(pianoKey('Do4, key A').querySelector('.piano-key__note')?.textContent).toBe('Do4')
    // Above the piano.
    await user.keyboard('[KeyA>][KeyG>]')
    expect(playedNotes()).toEqual(['Do4', 'Sol4'])
    await user.keyboard('[/KeyA][/KeyG]')
    // And where the computer keys are chosen.
    await user.click(settingsTab('Keys'))
    expect(within(panel).getByText('Do3 – Do6')).toBeTruthy()
    await user.click(pianoKey('Do4, key A'))
    expect(textOf(changeOneKey())).toContain('Press a key for Do4…')
    await user.keyboard('[Escape]')

    await user.click(settingsTab('Piano'))
    await user.click(within(panel).getByRole('button', { name: 'C D E' }))
    expect(settingsStore.get().noteNaming).toBe('letters')
    expect(pianoKey('C4, key A').querySelector('.piano-key__note')?.textContent).toBe('C4')
    await user.click(settingsTab('Keys'))
    expect(within(panel).getByText('C3 – C6')).toBeTruthy()
  })

  it('room echo: a slider from 0% to 100%', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Sound')
    const slider = within(panel).getByRole('slider', { name: 'Room echo' }) as HTMLInputElement
    expect(slider.min).toBe('0')
    expect(slider.max).toBe('100')
    expect(slider.value).toBe('15')

    fireEvent.change(slider, { target: { value: '60' } })
    expect(settingsStore.get().reverb).toBe(0.6)
    expect(saved().reverb).toBe(0.6)
    expect(within(panel).getByText('60%')).toBeTruthy()
    expect(audio.state.calls.at(-1)).toBe('reverb:0.6')

    fireEvent.change(slider, { target: { value: '0' } })
    expect(settingsStore.get().reverb).toBe(0)
    expect(audio.state.calls.at(-1)).toBe('reverb:0')
  })

  it.each([
    ['Short', 'short', 0.25],
    ['Long', 'long', 2.5],
    ['Normal', 'normal', 1],
  ] as const)('note fade-out: "%s" is saved and passed on to the sound', async (label, release, seconds) => {
    const user = await startApp()
    act(() => settingsStore.set({ release: release === 'normal' ? 'long' : 'normal' }))
    const panel = await openSettings(user, 'Sound')
    const choices = ['Short', 'Normal', 'Long'].map((name) =>
      within(panel).getByRole('button', { name }),
    )

    await user.click(within(panel).getByRole('button', { name: label }))

    expect(settingsStore.get().release).toBe(release)
    expect(saved().release).toBe(release)
    expect(choices.map((choice) => choice.getAttribute('aria-pressed'))).toEqual(
      ['Short', 'Normal', 'Long'].map((name) => String(name === label)),
    )
    expect(audio.state.calls.at(-1)).toBe(`release:${seconds}`)
  })

  describe('with a canvas that remembers what is drawn on it', () => {
    let browser: FakeBrowser

    beforeEach(() => {
      browser = installFakeBrowser()
    })

    afterEach(() => {
      // The app goes first, while the stand-ins it was drawn with are still there.
      cleanup()
      vi.unstubAllGlobals()
      HTMLCanvasElement.prototype.getContext = noCanvas
      const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
      delete canvas.clientWidth
      delete canvas.clientHeight
    })

    /** Lets the sky draw for a moment and returns the bars of light that are then on it. */
    function barsInTheSky(): unknown[] {
      act(() => {
        browser.play(0.2)
      })
      const canvas = found(sky().querySelector('canvas'), 'The canvas of the sky')
      return browser.contextOf(canvas).bars
    }

    it('light bars: switching them off takes the bars out of the sky, switching them on brings them back', async () => {
      const user = await startApp()
      const panel = await openSettings(user, 'Look')
      const lightBars = within(panel).getByRole('switch', { name: 'Light bars' })
      expect(lightBars.getAttribute('aria-checked')).toBe('true')
      expect(textOf(lightBars)).toBe('On')
      const canvas = found(sky().querySelector('canvas'), 'The canvas of the sky')

      await user.keyboard('[KeyA>]')
      expect(barsInTheSky()).toHaveLength(1)

      await user.click(lightBars)
      expect(settingsStore.get().showTrails).toBe(false)
      expect(saved().showTrails).toBe(false)
      expect(lightBars.getAttribute('aria-checked')).toBe('false')
      expect(textOf(lightBars)).toBe('Off')
      expect(barsInTheSky()).toEqual([])
      // The key is still held and still lit: only the bar above it is gone.
      expect(heldNotes()).toEqual([60])
      expect(pianoKey('C4, key A').classList.contains('is-lit')).toBe(true)

      await user.click(lightBars)
      expect(settingsStore.get().showTrails).toBe(true)
      expect(textOf(lightBars)).toBe('On')
      // The key that is still held gets its bar back.
      expect(barsInTheSky()).toHaveLength(1)
      await user.keyboard('[/KeyA]')

      // The same canvas all along: on top of the piano, and hidden from screen readers.
      expect(sky().querySelector('canvas')).toBe(canvas)
      expect(document.querySelectorAll('canvas')).toHaveLength(1)
      expect(canvas.getAttribute('aria-hidden')).toBe('true')
      expect(comesBefore(canvas, piano())).toBe(true)
    })
  })

  it('stays open, with what was set, while the player plays and uses the top bar', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Sound')
    await user.click(within(panel).getByRole('button', { name: 'Transpose up' }))

    await user.keyboard('[KeyA][Space]')
    await user.click(within(topBar()).getByRole('switch', { name: 'Sustain' }))
    fireEvent.change(within(topBar()).getByRole('slider', { name: 'Volume' }), {
      target: { value: '50' },
    })
    await user.click(piano())

    expect(settingsButton().getAttribute('aria-expanded')).toBe('true')
    expect(settingsTab('Sound').getAttribute('aria-selected')).toBe('true')
    expect(settingsPanel().querySelector('.stepper__value')?.textContent).toBe('+1')
  })
})

// ---------------------------------------------------------------------------

describe('Reset all settings', () => {
  const CHANGED: Partial<Settings> = {
    velocity: 0.3,
    transpose: 5,
    noteNaming: 'solfege',
    reverb: 0.9,
    release: 'long',
    showTrails: false,
    volume: 0.2,
    sustain: true,
    baseOctave: 2,
    labelMode: 'keys',
    bindings: { KeyZ: 0 },
    customLabels: { KeyZ: 'Z' },
    keyStyle: 'glass',
    accent: 'blue',
    background: 'stars',
    showNoteNames: false,
  }

  it('asks first, in its own place, and "No" changes nothing', async () => {
    const user = await startApp()
    act(() => settingsStore.set(CHANGED))
    const before = settingsStore.get()
    const panel = await openSettings(user, 'About')
    expect(
      within(panel).getByText('Puts every setting and every key back to how it was at the start.'),
    ).toBeTruthy()
    // The line that says the reset was done is there, and says nothing yet.
    const done = within(panel).getByRole('status')
    expect(done.textContent).toBe('')

    await user.click(within(panel).getByRole('button', { name: 'Reset all settings' }))
    expect(within(panel).queryByRole('button', { name: 'Reset all settings' })).toBeNull()
    expect(within(panel).getByText('Really reset?')).toBeTruthy()
    expect(settingsStore.get()).toBe(before)
    expect(done.textContent).toBe('')

    await user.click(within(panel).getByRole('button', { name: 'No' }))
    expect(settingsStore.get()).toBe(before)
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Reset all settings' })).toBeTruthy()
    expect(within(panel).getByRole('status').textContent).toBe('')
    expect(transposedBadge()?.textContent).toBe('Transposed +5')
    expect(sustainBadge()).not.toBeNull()
    expect(pianoKey('Do2, key Z')).toBeTruthy()
  })

  it('"Yes" puts every setting and every key back, on the screen too', async () => {
    const user = await startApp()
    act(() => settingsStore.set(CHANGED))
    const panel = await openSettings(user, 'About')
    const done = within(panel).getByRole('status')

    await user.click(within(panel).getByRole('button', { name: 'Reset all settings' }))
    await user.click(within(panel).getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(saved()).toEqual(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))

    // The tab says so, in one line. It is the line that was there, empty, all
    // along: that is what makes a screen reader speak it.
    expect(within(panel).getByRole('status')).toBe(done)
    expect(done.textContent).toBe('Everything is back to how it was at the start.')

    // The screen follows: the question is gone, the badges too, and the piano and the top bar are as at the start.
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Reset all settings' })).toBeTruthy()
    expect(transposedBadge()).toBeNull()
    expect(sustainBadge()).toBeNull()
    expect(pianoKey('C4, key A')).toBeTruthy()
    expect(piano().getAttribute('data-key-style')).toBe('classic')
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(18)
    expect(piano().querySelectorAll('.piano-key__note').length).toBeGreaterThan(0)
    const inTopBar = within(topBar())
    expect((inTopBar.getByRole('slider', { name: 'Volume' }) as HTMLInputElement).value).toBe('80')
    expect(inTopBar.getByRole('switch', { name: 'Sustain' }).getAttribute('aria-checked')).toBe(
      'false',
    )
    for (const call of ['volume:0.8', 'sustain:false', 'transpose:0', 'reverb:0.15', 'release:1']) {
      expect(audio.state.calls).toContain(call)
    }

    // And so does every tab of Settings.
    const sliderValue = (name: string): string =>
      (within(panel).getByRole('slider', { name }) as HTMLInputElement).value
    const pressed = (name: string): string | null =>
      within(panel).getByRole('button', { name }).getAttribute('aria-pressed')

    await user.click(settingsTab('Sound'))
    expect(sliderValue('Volume')).toBe('80')
    expect(sliderValue('Touch')).toBe('80')
    expect(sliderValue('Room echo')).toBe('15')
    expect(panel.querySelector('.stepper__value')?.textContent).toBe('0')
    expect(pressed('Normal')).toBe('true')

    await user.click(settingsTab('Piano'))
    expect(pressed('C D E')).toBe('true')
    expect(pressed('Classic')).toBe('true')
    expect(pressed('Auto')).toBe('true')
    const labels = within(panel).getByRole('combobox', { name: 'Labels on the keys' })
    expect((labels as HTMLSelectElement).value).toBe('both')

    await user.click(settingsTab('Look'))
    expect(pressed('Ember')).toBe('true')
    expect(within(panel).getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('true')
    for (const name of ['Light bars', 'Show the notes being played']) {
      expect(within(panel).getByRole('switch', { name }).getAttribute('aria-checked')).toBe('true')
    }

    await user.click(settingsTab('Keys'))
    expect(pressed('Home row')).toBe('true')
    expect(within(panel).getByText('C3 – C6')).toBeTruthy()
  })

  it("never uses the browser's own confirm or alert boxes", async () => {
    const confirm = vi.fn(() => true)
    const alert = vi.fn()
    vi.stubGlobal('confirm', confirm)
    vi.stubGlobal('alert', alert)
    try {
      const user = await startApp()
      const panel = await openSettings(user, 'About')
      await user.click(within(panel).getByRole('button', { name: 'Reset all settings' }))
      await user.click(within(panel).getByRole('button', { name: 'Yes' }))

      // The player's own keys, then the two questions of the Keys tab.
      await user.click(settingsTab('Keys'))
      await user.click(pianoKey('C4, key A'))
      await user.keyboard('[KeyZ]')
      await user.click(within(panel).getByRole('button', { name: 'Two octaves' }))
      expect(within(panel).getByText('Replace your own keys with this layout?')).toBeTruthy()
      await user.click(within(panel).getByRole('button', { name: 'Yes' }))
      expect(within(panel).getByRole('button', { name: 'Two octaves' }).getAttribute('aria-pressed')).toBe(
        'true',
      )
      await user.click(within(panel).getByRole('button', { name: 'Reset to default keys' }))
      await user.click(within(panel).getByRole('button', { name: 'Yes' }))
      expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)

      expect(confirm).not.toHaveBeenCalled()
      expect(alert).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ---------------------------------------------------------------------------

describe('Customize keys and "Reset to default keys"', () => {
  it('assigns a key: click a piano key, press a computer key, read what happened', async () => {
    const user = await startApp()
    await openSettings(user, 'Keys')
    const panel = changeOneKey()

    await user.click(pianoKey('C4, key A'))
    expect(textOf(panel)).toContain('Press a key for C4…')
    expect(textOf(panel)).toContain('Esc = cancel · Backspace = remove this key')
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('true')

    await user.keyboard('[KeyZ]')
    expect(keyMessage().textContent).toBe('"Z" now plays C4. "A" no longer plays a note.')
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()
    expect(settingsStore.get().customLabels.KeyZ).toBe('Z')
    expect(saved().bindings).toEqual(settingsStore.get().bindings)
    expect(pianoKey('C4, key Z')).toBeTruthy()
    // Nothing is selected any more, the press played nothing, and the first sentence is back.
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([])
    expect(textOf(panel)).toContain(
      'Click a piano key below, then press the key you want to use for it.',
    )
  })

  it('says which note lost its key when a key that was in use is moved', async () => {
    const user = await startApp()
    await openSettings(user, 'Keys')
    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[KeyK]')
    expect(keyMessage().textContent).toBe(
      '"K" now plays C4. "A" no longer plays a note. C5 has no key now.',
    )
    expect(pianoKey('C4, key K')).toBeTruthy()
    expect(pianoKey('C5')).toBeTruthy()
  })

  it('"Reset to default keys": "No" keeps the player\'s keys, "Yes" brings the default ones back', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Keys')
    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[KeyZ]')
    const custom = settingsStore.get().bindings

    await user.click(within(panel).getByRole('button', { name: 'Reset to default keys' }))
    expect(within(panel).getByText('Really reset?')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Reset to default keys' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'No' }))
    expect(settingsStore.get().bindings).toBe(custom)
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(pianoKey('C4, key Z')).toBeTruthy()

    await user.click(within(panel).getByRole('button', { name: 'Reset to default keys' }))
    await user.click(within(panel).getByRole('button', { name: 'Yes' }))
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(settingsStore.get().customLabels).toEqual({})
    expect(saved().bindings).toEqual(DEFAULT_BINDINGS)
    expect(pianoKey('C4, key A')).toBeTruthy()
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Reset to default keys' })).toBeTruthy()
    // Still customizing: a reset does not close anything.
    expect(panelNamed('Settings')).toBe(panel)
    expect(settingsTab('Keys').getAttribute('aria-selected')).toBe('true')
    expect(isCustomizing()).toBe(true)
  })

  it('a reset of the keys leaves every other setting alone', async () => {
    const user = await startApp()
    const others: Partial<Settings> = {
      volume: 0.2,
      sustain: true,
      baseOctave: 4,
      transpose: 3,
      labelMode: 'keys',
      keyboardType: 'qwerty',
      accent: 'green',
      pianoSize: 49,
    }
    act(() => settingsStore.set(others))
    const panel = await openSettings(user, 'Keys')
    await user.click(pianoKey('C5, key A'))
    await user.keyboard('[KeyZ]')

    await user.click(within(panel).getByRole('button', { name: 'Reset to default keys' }))
    await user.click(within(panel).getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get()).toEqual({ ...DEFAULT_SETTINGS, ...others })
  })

  it('closing Settings leaves customizing, and so do another tab and Escape with nothing selected', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Keys')
    await user.click(within(panel).getByRole('button', { name: 'Close Settings' }))
    expect(panelNamed('Settings')).toBeNull()
    expect(isCustomizing()).toBe(false)
    expect(settingsButton().getAttribute('aria-expanded')).toBe('false')

    await openSettings(user, 'Keys')
    expect(isCustomizing()).toBe(true)
    await user.click(settingsTab('Look'))
    expect(isCustomizing()).toBe(false)
    expect(panelNamed('Settings')).not.toBeNull()

    await user.click(settingsTab('Keys'))
    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[Escape]')
    // The first Escape only cancels the selection.
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(panelNamed('Settings')).not.toBeNull()
    expect(isCustomizing()).toBe(true)
    await user.keyboard('[Escape]')
    expect(panelNamed('Settings')).toBeNull()
    expect(isCustomizing()).toBe(false)
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
  })

  it('refuses keys that cannot play a note, without toggling sustain or leaving the key', async () => {
    const user = await startApp()
    await openSettings(user, 'Keys')
    await user.click(pianoKey('C4, key A'))

    for (const code of ['Space', 'Enter', 'ArrowUp', 'Tab']) {
      await user.keyboard(`[${code}]`)
      expect(keyMessage().textContent).toBe(
        "That key can't be used. Try a letter, number or symbol key.",
      )
      expect(pianoKey('C4, key A').classList.contains('is-selected')).toBe(true)
    }
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(settingsTab('Keys').getAttribute('aria-selected')).toBe('true')

    await user.keyboard('[Backspace]')
    expect(keyMessage().textContent).toBe('C4 has no key now.')
    expect(pianoKey('C4')).toBeTruthy()
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()
  })

  it('with no piano key selected the keyboard still plays, so the layout can be tried', async () => {
    const user = await startApp()
    await openSettings(user, 'Keys')
    // No "click it" hint while a click on the piano means something else.
    expect(hintIsShown()).toBe(false)

    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    expect(playedNotes()).toEqual(['C4'])
    await user.keyboard('[/KeyA]')
    expect(heldNotes()).toEqual([])
    expect(hintIsShown()).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('Transposed badge, Sustain badge and the notes being played', () => {
  it('shows the hint while nothing was played yet, and no badge while the transpose is 0 and sustain is off', async () => {
    await startApp()
    expect(hintIsShown()).toBe(true)
    expect(playedNotes()).toEqual([])
    expect(within(sky()).queryByRole('list')).toBeNull()
    expect(transposedBadge()).toBeNull()
    expect(screen.queryByText(/Transposed/)).toBeNull()
    expect(sustainBadge()).toBeNull()
    expect(screen.queryByText(/Sustain on/)).toBeNull()
  })

  // Space switches sustain while the menu, and the switch in it, is hidden.
  // The badge is the sign that stays on the stage.
  it('shows a quiet "Sustain on" badge next to the Transposed badge for as long as sustain is on', async () => {
    const user = await startApp()

    await user.keyboard('[Space]')
    const badge = found(sustainBadge(), 'The Sustain badge')
    expect(badge.textContent).toBe('Sustain on')
    // Next to the sound status, and not part of it: it is not read out with it.
    expect(badge.parentElement).toBe(soundStatus().parentElement)
    expect(badge.closest('[role="status"], [aria-live]')).toBeNull()
    // The top bar keeps saying "Sustain On" in its own words: nothing there is renamed.
    expect(wordsOn(within(topBar()).getByRole('switch', { name: 'Sustain' }))).toBe('Sustain On')

    await user.keyboard('[Space]')
    expect(sustainBadge()).toBeNull()

    // The two switches show it as well.
    await user.click(within(topBar()).getByRole('switch', { name: 'Sustain' }))
    expect(sustainBadge()).not.toBeNull()
    const sound = await openSettings(user, 'Sound')
    await user.click(within(sound).getByRole('switch', { name: 'Sustain' }))
    expect(sustainBadge()).toBeNull()
    await user.click(within(sound).getByRole('switch', { name: 'Sustain' }))
    expect(sustainBadge()).not.toBeNull()

    // With the piano transposed too, the two badges stand side by side and look alike.
    await user.click(within(sound).getByRole('button', { name: 'Transpose up' }))
    const transposed = found(transposedBadge(), 'The Transposed badge')
    expect(transposed.nextElementSibling).toBe(sustainBadge())
    expect(sustainBadge()?.className).toBe(transposed.className)

    // It stays while notes are played and while Settings is closed.
    await user.click(settingsButton())
    await user.keyboard('[KeyA>]')
    expect(sustainBadge()?.textContent).toBe('Sustain on')
    await user.keyboard('[/KeyA]')
    expect(sustainBadge()?.textContent).toBe('Sustain on')
  })

  it('shows the badge next to the sound status as soon as the transpose is not 0, with its sign', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Sound')
    const up = within(panel).getByRole('button', { name: 'Transpose up' })
    const down = within(panel).getByRole('button', { name: 'Transpose down' })

    await user.click(up)
    await user.click(up)
    expect(transposedBadge()?.textContent).toBe('Transposed +2')
    expect(transposedBadge()?.parentElement).toBe(soundStatus().parentElement)

    for (let step = 0; step < 5; step += 1) await user.click(down)
    expect(transposedBadge()?.textContent).toBe('Transposed −3')

    for (let step = 0; step < 3; step += 1) await user.click(up)
    expect(screen.queryByText(/Transposed/)).toBeNull()
  })

  it('keeps the badge while notes are held, and while Settings is closed', async () => {
    const user = await startApp()
    act(() => settingsStore.set({ transpose: -12 }))
    expect(panelNamed('Settings')).toBeNull()
    expect(transposedBadge()?.textContent).toBe('Transposed −12')

    await user.keyboard('[KeyA>]')
    expect(transposedBadge()?.textContent).toBe('Transposed −12')
    // The line names the key that is held: the key itself does not change with the transpose.
    expect(playedNotes()).toEqual(['C4'])
    await user.keyboard('[/KeyA]')
    expect(transposedBadge()?.textContent).toBe('Transposed −12')
  })

  it('names the held notes, lowest first, and names none once they are let go', async () => {
    const user = await startApp()
    await user.keyboard('[KeyG>][KeyA>][KeyD>]')
    expect(playedNotes()).toEqual(['C4', 'E4', 'G4'])
    expect(hintIsShown()).toBe(false)

    await user.keyboard('[/KeyA]')
    expect(playedNotes()).toEqual(['E4', 'G4'])

    await user.keyboard('[/KeyG][/KeyD]')
    expect(playedNotes()).toEqual([])
    expect(within(sky()).queryByRole('list')).toBeNull()
    // The hint was for the first note only: it does not come back.
    expect(hintIsShown()).toBe(false)
  })

  it('names black keys with a sharp sign and follows the keys when they are moved', async () => {
    const user = await startApp()
    await user.keyboard('[KeyW>]')
    expect(playedNotes()).toEqual(['C♯4'])
    await user.keyboard('[/KeyW]')

    const keys = await openSettings(user, 'Keys')
    await user.click(within(keys).getByRole('button', { name: 'Lower' }))
    await user.keyboard('[KeyW>]')
    expect(playedNotes()).toEqual(['C♯3'])
    await user.keyboard('[/KeyW]')
  })

  it('lights the piano key that is held and puts it out again', async () => {
    const user = await startApp()
    const key = pianoKey('C4, key A')
    await user.keyboard('[KeyA>]')
    expect(key.classList.contains('is-lit')).toBe(true)
    expect(key.getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('[/KeyA]')
    expect(key.classList.contains('is-lit')).toBe(false)
    expect(key.getAttribute('aria-pressed')).toBe('false')
  })

  it('writes no names when the player switched them off, and writes them again when switched on', async () => {
    const user = await startApp()
    const look = await openSettings(user, 'Look')
    const names = within(look).getByRole('switch', { name: 'Show the notes being played' })
    expect(names.getAttribute('aria-checked')).toBe('true')

    await user.click(names)
    expect(settingsStore.get().showNoteNames).toBe(false)
    expect(saved().showNoteNames).toBe(false)
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    expect(playedNotes()).toEqual([])
    expect(pianoKey('C4, key A').classList.contains('is-lit')).toBe(true)

    await user.click(names)
    expect(playedNotes()).toEqual(['C4'])
    await user.keyboard('[/KeyA]')
  })
})

// ---------------------------------------------------------------------------
// What used to be the footer: the sound status is a quiet line in the sky, the
// credit is in the About tab, and the sustain key is explained next to its switch.
// ---------------------------------------------------------------------------

describe('sound status, sustain key and credit', () => {
  const CREDIT = 'Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)'

  it('always explains the sustain key, and says nothing about the sound while it is ready', async () => {
    const user = await startApp()
    expect(audio.state.status).toBe('ready')
    expect(soundStatus().textContent).toBe('')
    // Nothing at all is written at the foot of the sky.
    expect(textOf(soundStatus().parentElement)).toBe('')

    // The key that works the sustain is written next to its switch, and explained.
    const keycap = within(topBar()).getByText('Space')
    expect(keycap.getAttribute('title')).toBe('Space turns sustain on and off')
    expect(keycap.parentElement?.contains(within(topBar()).getByRole('switch', { name: 'Sustain' }))).toBe(
      true,
    )
    const sound = await openSettings(user, 'Sound')
    expect(explanationOf(option(sound, 'Sustain'))).toBe(
      'Notes keep ringing after you let go. Space also turns it on and off.',
    )
  })

  it.each(['loading', 'ready', 'fallback', 'error'] as const)(
    'credits the piano sound in the About tab, linked to its licence, while the sound is "%s"',
    async (status) => {
      audio.state.startsAs = status
      const user = await startApp()
      const about = await openSettings(user, 'About')
      const credit = within(about).getByText(/^Piano sound:/)
      expect(textOf(credit)).toBe(CREDIT)

      const link = within(about).getByRole('link')
      expect(credit.contains(link)).toBe(true)
      expect(link.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/3.0/')
      // It opens in a tab of its own and leaves the piano where it is.
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noreferrer')
      // The link is part of the credit, whichever of its words carry it.
      expect(CREDIT).toContain(textOf(link))
      expect(textOf(link)).not.toBe('')
    },
  )

  it.each([
    ['loading', 'Loading piano sound…'],
    ['fallback', 'Using basic sound (piano sound could not be loaded).'],
    ['error', 'Sound could not start. Click anywhere to try again.'],
  ] as const)('says so while the sound is "%s"', async (status, message) => {
    audio.state.startsAs = status
    await startApp()
    expect(soundStatus().textContent).toBe(message)
    expect(soundStatus().getAttribute('data-status')).toBe(status)
    expect(within(topBar()).getByText('Space')).toBeTruthy()
  })

  it('follows the sound: loading, then nothing once the piano sound is there', async () => {
    audio.state.startsAs = 'loading'
    await startApp()
    const status = soundStatus()
    expect(status.textContent).toBe('Loading piano sound…')

    setAudioStatus('ready')
    expect(status.textContent).toBe('')
    // The same element is kept, so a screen reader hears the changes.
    expect(soundStatus()).toBe(status)

    setAudioStatus('fallback')
    expect(status.textContent).toBe('Using basic sound (piano sound could not be loaded).')
  })

  it('after an error, a click anywhere tries again', async () => {
    audio.state.startsAs = 'error'
    const user = await startApp()
    expect(audio.state.starts).toBe(1)
    expect(soundStatus().textContent).toMatch(/^Sound could not start/)

    // Still failing: the message stays and every click is a new attempt.
    await user.click(screen.getByRole('heading', { level: 1 }))
    expect(audio.state.starts).toBe(2)
    expect(soundStatus().textContent).toMatch(/^Sound could not start/)

    audio.state.startsAs = 'ready'
    await user.click(sky())
    expect(audio.state.starts).toBe(3)
    expect(soundStatus().textContent).toBe('')

    // Once it works, clicks no longer start anything.
    await user.click(sky())
    expect(audio.state.starts).toBe(3)
  })

  it.each([
    ['the piano', () => piano()],
    ['a button of the top bar', () => settingsButton()],
    ['the message itself', () => soundStatus()],
    ['the empty sky', () => sky()],
  ] as const)('after an error, a click on %s tries again', async (_where, target) => {
    audio.state.startsAs = 'error'
    const user = await startApp()
    audio.state.startsAs = 'ready'
    await user.click(target())
    expect(audio.state.starts).toBe(2)
    expect(audio.state.status).toBe('ready')
  })

  it('after an error, a click inside an open panel tries again', async () => {
    audio.state.startsAs = 'error'
    const user = await startApp()
    await user.click(settingsButton())
    expect(audio.state.starts).toBe(2)

    audio.state.startsAs = 'ready'
    await user.click(settingsTab('About'))
    expect(audio.state.starts).toBe(3)
    expect(soundStatus().textContent).toBe('')
  })

  it('after an error, a key press tries again too', async () => {
    audio.state.startsAs = 'error'
    const user = await startApp()
    audio.state.startsAs = 'loading'
    await user.keyboard('[KeyA]')
    expect(audio.state.starts).toBe(2)
    expect(soundStatus().textContent).toBe('Loading piano sound…')
  })

  it('does not try again by itself when only the piano sound is missing', async () => {
    audio.state.startsAs = 'fallback'
    const user = await startApp()
    await user.click(sky())
    await user.keyboard('[KeyA]')
    expect(audio.state.starts).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Where the keyboard focus goes
// ---------------------------------------------------------------------------

/** The note the A key plays where the keys sit now (middle C by default). */
function noteOfKeyA(): number {
  return 12 * (settingsStore.get().baseOctave + 1) + 12
}

/** The very next key press is a note, and Space is the sustain key. */
async function expectKeysToPlay(user: User): Promise<void> {
  const sustain = settingsStore.get().sustain
  await user.keyboard('[KeyA>]')
  expect(heldNotes()).toEqual([noteOfKeyA()])
  await user.keyboard('[/KeyA]')
  expect(heldNotes()).toEqual([])
  // Space is the sustain key again, not "press the thing I last clicked".
  await user.keyboard('[Space]')
  expect(settingsStore.get().sustain).toBe(!sustain)
  await user.keyboard('[Space]')
  expect(settingsStore.get().sustain).toBe(sustain)
}

const NOTHING = 'nothing'

/**
 * What holds the keyboard, in words. A panel opened with the mouse holds it
 * as a whole: no control of it does, so no focus ring shows and Enter presses
 * nothing, and Tab goes on inside the panel.
 */
function keyboardHolder(): string {
  const focused = document.activeElement
  if (focused === null || focused === document.body) return NOTHING
  if (focused.getAttribute('role') === 'dialog') return `the ${nameOf(focused)} panel as a whole`
  return nameOf(focused)
}

/** No control holds the keyboard, and the very next key press is a note. */
async function expectStraightBackToPlaying(user: User, holder = NOTHING): Promise<void> {
  expect(keyboardHolder()).toBe(holder)
  await expectKeysToPlay(user)
}

describe('after a click with the mouse the player can go straight back to playing', () => {
  it.each([
    ['the Free Play tab', () => screen.getByRole('tab', { name: 'Free Play' }), NOTHING],
    ['a tab that is not built yet', () => screen.getByRole('tab', { name: /Real-time/ }), NOTHING],
    ['the Sustain switch', () => screen.getByRole('switch', { name: 'Sustain' }), NOTHING],
    ['Songs', () => songsButton(), 'the Songs panel as a whole'],
    ['Settings', () => settingsButton(), 'the Settings panel as a whole'],
  ] as const)('top bar: %s', async (_name, control, holder) => {
    const user = await startApp()
    await user.click(control())
    await expectStraightBackToPlaying(user, holder)
  })

  it.each(['Settings', 'Songs'] as const)('top bar: %s, clicked again to close its panel', async (name) => {
    const user = await startApp()
    const button = within(topBar()).getByRole('button', { name })
    await user.click(button)
    await user.click(button)
    expect(panelNamed(name)).toBeNull()
    await expectStraightBackToPlaying(user)
  })

  it.each(['Settings', 'Songs'] as const)('the close button of %s', async (name) => {
    const user = await startApp()
    await user.click(within(topBar()).getByRole('button', { name }))
    await user.click(screen.getByRole('button', { name: `Close ${name}` }))
    expect(panelNamed(name)).toBeNull()
    await expectStraightBackToPlaying(user)
  })

  it.each(SETTINGS_TABS)('Settings: the %s tab', async (tab) => {
    const user = await startApp()
    await openSettings(user, tab === 'Sound' ? 'About' : 'Sound')
    await user.click(settingsTab(tab))
    expect(settingsTab(tab).getAttribute('aria-selected')).toBe('true')
    await expectStraightBackToPlaying(user)
  })

  // A slider is not a place where the player types. Whether or not it keeps
  // the keyboard focus after a click, the keys go on playing.
  it.each([
    ['top-bar Volume', 'Sound', 'Volume', true],
    ['Volume', 'Sound', 'Volume', false],
    ['Touch', 'Sound', 'Touch', false],
    ['Room echo', 'Sound', 'Room echo', false],
    ['Glow', 'Look', 'Glow', false],
  ] as const)('the %s slider', async (_name, tab, name, inTopBar) => {
    const user = await startApp()
    const panel = await openSettings(user, tab)
    await user.click(within(inTopBar ? topBar() : panel).getByRole('slider', { name }))
    await expectKeysToPlay(user)
  })

  it.each([
    ['Sound', 'Transpose up', 'button', 'Transpose up'],
    ['Sound', 'Transpose down', 'button', 'Transpose down'],
    ['Sound', 'Short', 'button', 'Short'],
    ['Sound', 'Long', 'button', 'Long'],
    ['Sound', 'the Sustain switch', 'switch', 'Sustain'],
    ['Keys', 'Lower', 'button', 'Lower'],
    ['Keys', 'Higher', 'button', 'Higher'],
    ['Keys', 'a key layout', 'button', 'White keys only'],
    ['Keys', 'a keyboard type', 'button', 'AZERTY'],
    ['Keys', 'Reset to default keys', 'button', 'Reset to default keys'],
    ['Piano', 'Do Ré Mi', 'button', 'Do Ré Mi'],
    ['Piano', 'C D E', 'button', 'C D E'],
    ['Piano', 'a piano size', 'button', '61'],
    ['Piano', 'a key style', 'button', 'Glass'],
    ['Look', 'a theme', 'button', 'Midnight'],
    ['Look', 'a colour', 'radio', 'Blue'],
    ['Look', 'a background', 'button', 'Stars'],
    ['Look', 'the Light bars switch', 'switch', 'Light bars'],
    ['Look', 'a bar style', 'button', 'Neon'],
    ['Look', 'a number of sparks', 'button', 'Lots'],
    ['Look', 'the switch that hides the menu', 'switch', 'Hide the menu automatically'],
    ['About', 'Reset all settings', 'button', 'Reset all settings'],
  ] as const)('Settings, %s tab: %s', async (tab, _name, role, name) => {
    const user = await startApp()
    const panel = await openSettings(user, tab)
    await user.click(within(panel).getByRole(role, { name }))
    await expectStraightBackToPlaying(user)
  })

  it.each([
    ['About', 'Reset all settings', 'Yes'],
    ['About', 'Reset all settings', 'No'],
    ['Keys', 'Reset to default keys', 'Yes'],
    ['Keys', 'Reset to default keys', 'No'],
  ] as const)('Settings, %s tab: "%s", then "%s" to its question', async (tab, reset, answer) => {
    const user = await startApp()
    const panel = await openSettings(user, tab)
    await user.click(within(panel).getByRole('button', { name: reset }))
    await user.click(within(panel).getByRole('button', { name: answer }))
    await expectStraightBackToPlaying(user)
  })

  it.each(['Yes', 'No'] as const)(
    'Settings, Keys tab: "%s" to the question before a layout replaces the player\'s own keys',
    async (answer) => {
      const user = await startApp()
      // The player's own keys: the black keys moved away, A still plays middle C.
      act(() => settingsStore.set({ bindings: { KeyA: 12, KeyS: 14, KeyD: 16 } }))
      const panel = await openSettings(user, 'Keys')
      await user.click(within(panel).getByRole('button', { name: 'White keys only' }))
      expect(within(panel).getByText('Replace your own keys with this layout?')).toBeTruthy()
      expect(keyboardHolder()).toBe(NOTHING)

      await user.click(within(panel).getByRole('button', { name: answer }))
      expect(within(panel).queryByText('Replace your own keys with this layout?')).toBeNull()
      expect(Object.keys(settingsStore.get().bindings).length).toBe(answer === 'Yes' ? 22 : 3)
      await expectStraightBackToPlaying(user)
    },
  )

  it('Songs: "Import a MIDI file"', async () => {
    const user = await startApp()
    await user.click(songsButton())
    const songs = found(panelNamed('Songs'), 'The Songs panel')
    await user.click(within(songs).getByRole('button', { name: 'Import a MIDI file' }))
    expect(panelNamed('Songs')).toBe(songs)
    await expectStraightBackToPlaying(user)
  })

  it('Songs: "Play", and then every control of the player line', async () => {
    const user = await startApp()
    await user.click(songsButton())
    await user.click(screen.getByRole('button', { name: /^Play Twinkle/ }))
    // The panel gets out of the way, and takes nothing with it.
    expect(panelNamed('Songs')).toBeNull()
    expect(keyboardHolder()).toBe(NOTHING)

    // The song is paused first, so that the only notes are the player's own.
    const player = screen.getByRole('region', { name: 'Song player' })
    for (const name of ['Pause', 'Restart', 'Song options']) {
      await user.click(within(player).getByRole('button', { name }))
      await expectStraightBackToPlaying(user)
    }
    for (const name of ['Position in the song', 'Speed']) {
      await user.click(within(player).getByRole('slider', { name }))
      await expectKeysToPlay(user)
    }
    for (const name of ['Melody only', 'Fit to the piano']) {
      await user.click(within(player).getByRole('switch', { name }))
      await expectStraightBackToPlaying(user)
    }

    await user.click(within(player).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()
    await expectStraightBackToPlaying(user)
  }, LONG_WALK_MS)

  it('Customize keys: a piano key that was clicked and given a key does not keep the focus', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Keys')
    await user.click(pianoKey('C4, key A'))
    expect(document.activeElement).toBe(document.body)
    await user.keyboard('[KeyZ]')
    await user.click(within(panel).getByRole('button', { name: 'Close Settings' }))
    expect(document.activeElement).toBe(document.body)
    await user.keyboard('[KeyZ>]')
    expect(heldNotes()).toEqual([60])
    await user.keyboard('[/KeyZ]')
  })

  it('Enter does not press again the button that was last clicked with the mouse', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Keys')
    await user.click(within(panel).getByRole('button', { name: 'Higher' }))
    await user.keyboard('[Enter]')
    expect(settingsStore.get().baseOctave).toBe(4)

    await user.click(settingsTab('Sound'))
    await user.click(within(panel).getByRole('button', { name: 'Transpose up' }))
    await user.keyboard('[Enter]')
    expect(settingsStore.get().transpose).toBe(1)

    await user.click(settingsButton())
    await user.keyboard('[Enter]')
    expect(settingsButton().getAttribute('aria-expanded')).toBe('false')

    await user.click(settingsButton())
    await user.keyboard('[Enter]')
    expect(settingsButton().getAttribute('aria-expanded')).toBe('true')
    expect(settingsTab('Sound').getAttribute('aria-selected')).toBe('true')

    await user.click(within(topBar()).getByRole('switch', { name: 'Sustain' }))
    await user.keyboard('[Enter]')
    expect(settingsStore.get().sustain).toBe(true)
  })

  it('Labels: once a choice is made the list lets go of the keyboard', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Piano')
    const select = within(panel).getByRole('combobox', { name: 'Labels on the keys' })
    await user.selectOptions(select, 'Notes only')
    expect(settingsStore.get().labelMode).toBe('notes')
    await expectStraightBackToPlaying(user)
  })

  // The list was opened with a click, which puts the keyboard focus on it, and
  // closed again without a new choice. No value changed, yet the list must let
  // go of the keyboard, or the piano stays silent and a letter changes Labels.
  //
  // There is no drop-down list in this simulated browser, so the page is sent
  // what Chrome and Edge send it. While the list is open the key down goes to
  // the list and only the key up reaches the page. A pick in the list reaches
  // the page as a click that no mouse button made (its `detail` is 0), also
  // when the choice is the one already shown.
  it.each(['Escape', 'Enter'])(
    'Labels: closing the list with %s, without a new choice, gives the keyboard back to the piano',
    async (key) => {
      const user = await startApp()
      const panel = await openSettings(user, 'Piano')
      const select = within(panel).getByRole('combobox', { name: 'Labels on the keys' })
      await user.click(select)
      expect(document.activeElement).toBe(select)

      fireEvent.keyUp(select, { key, code: key })

      await expectStraightBackToPlaying(user)
      expect(settingsStore.get().labelMode).toBe('both')
      // Escape closed the list, not the panel around it.
      expect(panelNamed('Settings')).toBe(panel)
    },
  )

  it('Labels: picking the choice it already shows gives the keyboard back to the piano', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Piano')
    const select = within(panel).getByRole('combobox', { name: 'Labels on the keys' })
    await user.click(select)
    expect(document.activeElement).toBe(select)

    fireEvent.click(select, { detail: 0 })

    await expectStraightBackToPlaying(user)
    expect(settingsStore.get().labelMode).toBe('both')
  })
})

// ---------------------------------------------------------------------------
// Keyboard-only use. Space is the sustain key, so Tab and Enter must do.
// ---------------------------------------------------------------------------

describe('keyboard only', () => {
  it('Tab reaches every control in the order of the screen, and none of the 37 piano keys', async () => {
    const user = await startApp()
    expect(await tabThrough(user, TOP_BAR_ORDER.length)).toEqual(TOP_BAR_ORDER)
    expect(piano().querySelectorAll('[tabindex="0"]').length).toBe(0)
    // After the last control Tab leaves the page: no piano key is on the way.
    await user.tab()
    expect(piano().contains(document.activeElement)).toBe(false)
    expect(nameOf(document.activeElement)).toBe('(nothing)')
    // The modes that are not built are not tab stops.
    expect(screen.getByRole('tab', { name: /Practice/ }).tabIndex).toBe(-1)
    expect(screen.getByRole('tab', { name: /Real-time/ }).tabIndex).toBe(-1)
  })

  it('Tab goes on into the Settings panel when it is open', async () => {
    const user = await startApp()
    // Opened with the mouse, the panel holds the keyboard as a whole: Tab goes on inside it.
    await user.click(settingsButton())
    await user.tab()
    expect(document.activeElement).toBe(within(settingsPanel()).getByRole('tab', { selected: true }))

    await user.click(settingsTab('Sound'))
    act(() => settingsStore.set({ transpose: 1 }))
    const names = await tabThrough(user, TOP_BAR_ORDER.length + 11)
    expect(names.slice(0, TOP_BAR_ORDER.length)).toEqual(TOP_BAR_ORDER)
    // Of the five tabs only the one that is showing is a stop: the arrow keys reach the others.
    expect(names.slice(TOP_BAR_ORDER.length)).toEqual([
      'Sound',
      'Close Settings',
      'Volume',
      'Sustain',
      'Touch',
      'Room echo',
      'Short',
      'Normal',
      'Long',
      'Transpose down',
      'Transpose up',
    ])
  })

  it('the arrow keys go from one tab of Settings to the next, and show it at once', async () => {
    const user = await startApp()
    await openSettingsWithKeyboard(user, 'Sound')
    for (const tab of ['Keys', 'Piano', 'Look', 'About'] as const) {
      await user.keyboard('[ArrowRight]')
      expect(document.activeElement).toBe(settingsTab(tab))
      expect(settingsTab(tab).getAttribute('aria-selected')).toBe('true')
      expect(isCustomizing()).toBe(tab === 'Keys')
    }
    await user.keyboard('[ArrowLeft]')
    expect(document.activeElement).toBe(settingsTab('Look'))
    expect(within(settingsPanel()).getByRole('switch', { name: 'Light bars' })).toBeTruthy()
    // The arrows moved between tabs and did nothing else.
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(heldNotes()).toEqual([])
  })

  // Enter is what works buttons and switches. Keyboard focus is never dropped
  // on the floor: a button that was pressed with Enter keeps it, so the player
  // can press it again or Tab on from there. (Only a click with the mouse
  // takes the focus off a button.) The one button that hands the focus on is
  // "Settings": its panel opens under the player's hands.
  it('Enter presses the focused button, and the focus stays where the player is', async () => {
    const user = await startApp()

    const sustain = within(topBar()).getByRole('switch', { name: 'Sustain' })
    await tabTo(user, sustain)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(document.activeElement).toBe(sustain)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().sustain).toBe(false)

    await tabTo(user, settingsButton())
    await user.keyboard('[Enter]')
    expect(settingsButton().getAttribute('aria-expanded')).toBe('true')
    const panel = settingsPanel()
    // The focus goes into the panel: to the tab that is showing.
    expect(document.activeElement).toBe(within(panel).getByRole('tab', { selected: true }))
    await user.keyboard('[Home]')
    expect(document.activeElement).toBe(settingsTab('Sound'))

    const long = within(panel).getByRole('button', { name: 'Long' })
    await tabTo(user, long)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().release).toBe('long')
    expect(document.activeElement).toBe(long)

    const up = within(panel).getByRole('button', { name: 'Transpose up' })
    await tabTo(user, up)
    await user.keyboard('[Enter][Enter]')
    expect(settingsStore.get().transpose).toBe(2)
    expect(document.activeElement).toBe(up)

    await tabTo(user, settingsTab('Sound'), true)
    await user.keyboard('[ArrowRight]')
    const higher = within(panel).getByRole('button', { name: 'Higher' })
    await tabTo(user, higher)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(document.activeElement).toBe(higher)

    await tabTo(user, settingsTab('Keys'), true)
    await user.keyboard('[ArrowRight]')
    const solfege = within(panel).getByRole('button', { name: 'Do Ré Mi' })
    await tabTo(user, solfege)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().noteNaming).toBe('solfege')
    expect(document.activeElement).toBe(solfege)

    await tabTo(user, settingsTab('Piano'), true)
    await user.keyboard('[ArrowRight]')
    const lightBars = within(panel).getByRole('switch', { name: 'Light bars' })
    await tabTo(user, lightBars)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().showTrails).toBe(false)
    expect(document.activeElement).toBe(lightBars)
  }, LONG_WALK_MS)

  it('the piano keeps playing while a button or a slider has the focus', async () => {
    const user = await startApp()
    for (const control of [
      within(topBar()).getByRole('slider', { name: 'Volume' }),
      within(topBar()).getByRole('switch', { name: 'Sustain' }),
      songsButton(),
      settingsButton(),
    ]) {
      await tabTo(user, control)
      await user.keyboard('[KeyA>]')
      expect(heldNotes()).toEqual([60])
      await user.keyboard('[/KeyA]')
      expect(heldNotes()).toEqual([])
    }
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(settingsButton().getAttribute('aria-expanded')).toBe('false')
    expect(songsButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('the piano keeps playing while a control of Settings has the focus', async () => {
    const user = await startApp()
    const panel = await openSettingsWithKeyboard(user, 'Sound')
    for (const control of [
      settingsTab('Sound'),
      within(panel).getByRole('button', { name: 'Close Settings' }),
      within(panel).getByRole('slider', { name: 'Touch' }),
      within(panel).getByRole('button', { name: 'Normal' }),
      within(panel).getByRole('button', { name: 'Transpose up' }),
    ]) {
      await tabTo(user, control)
      await user.keyboard('[KeyA>]')
      expect(heldNotes()).toEqual([60])
      await user.keyboard('[/KeyA]')
      expect(heldNotes()).toEqual([])
      expect(document.activeElement).toBe(control)
    }
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(panelNamed('Settings')).toBe(panel)
  })

  it('Space stays the sustain key while a button has the focus, and never presses that button', async () => {
    const user = await startApp()

    await tabTo(user, settingsButton())
    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(settingsButton().getAttribute('aria-expanded')).toBe('false')

    await tabTo(user, songsButton(), true)
    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(false)
    expect(songsButton().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()

    // On the Sustain switch itself one tap is one change, not two that cancel out.
    const sustain = within(topBar()).getByRole('switch', { name: 'Sustain' })
    await tabTo(user, sustain, true)
    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(sustain.getAttribute('aria-checked')).toBe('true')
  })

  it('Space stays the sustain key on every kind of control of Settings, and presses none of them', async () => {
    const user = await startApp()
    const panel = await openSettingsWithKeyboard(user, 'Sound')
    let sustain = false
    const tapSpaceOn = async (control: HTMLElement): Promise<void> => {
      await tabTo(user, control)
      await user.keyboard('[Space]')
      sustain = !sustain
      expect(settingsStore.get().sustain, nameOf(control)).toBe(sustain)
      expect(document.activeElement).toBe(control)
    }

    // A tab, the close button, a choice, a stepper.
    await tapSpaceOn(settingsTab('Sound'))
    await tapSpaceOn(within(panel).getByRole('button', { name: 'Close Settings' }))
    await tapSpaceOn(within(panel).getByRole('button', { name: 'Long' }))
    await tapSpaceOn(within(panel).getByRole('button', { name: 'Transpose up' }))
    // The Sustain switch of the panel: one tap is one change.
    await tapSpaceOn(within(panel).getByRole('switch', { name: 'Sustain' }))

    // A card, a round colour, another switch and a reset button.
    await tabTo(user, settingsTab('Sound'), true)
    await user.keyboard('[ArrowRight]')
    await tapSpaceOn(within(panel).getByRole('button', { name: 'Two octaves' }))
    await tabTo(user, settingsTab('Keys'), true)
    await user.keyboard('[ArrowRight][ArrowRight]')
    await tapSpaceOn(within(panel).getByRole('radio', { name: 'Red' }))
    await tapSpaceOn(within(panel).getByRole('switch', { name: 'Light bars' }))
    await tabTo(user, settingsTab('Look'), true)
    await user.keyboard('[ArrowRight]')
    await tapSpaceOn(within(panel).getByRole('button', { name: 'Reset all settings' }))

    // Nothing but the sustain changed, and the panel is still open on the last tab.
    expect(settingsStore.get()).toEqual({ ...DEFAULT_SETTINGS, sustain })
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(settingsTab('About').getAttribute('aria-selected')).toBe('true')
  }, LONG_WALK_MS)

  it('leaves to a focused slider the keys that move it', async () => {
    const user = await startApp()
    const slider = within(topBar()).getByRole('slider', { name: 'Volume' })
    await tabTo(user, slider)
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      // fireEvent returns false when something cancelled the key.
      expect(fireEvent.keyDown(slider, { code, key: code }), code).toBe(true)
    }
    expect(heldNotes()).toEqual([])
  })

  it('leaves to the focused Labels list every key, as a place where the player types', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Piano')
    const select = within(panel).getByRole('combobox', { name: 'Labels on the keys' })
    await tabTo(user, select)
    for (const [code, key] of [
      ['ArrowDown', 'ArrowDown'],
      ['ArrowUp', 'ArrowUp'],
      ['Enter', 'Enter'],
      ['Space', ' '],
      ['KeyK', 'k'],
      ['KeyN', 'n'],
    ] as const) {
      expect(fireEvent.keyDown(select, { code, key }), code).toBe(true)
      fireEvent.keyUp(select, { code, key })
    }
    expect(heldNotes()).toEqual([])
    expect(settingsStore.get().sustain).toBe(false)
    expect(panelNamed('Settings')).toBe(panel)
  })

  it('Tab is never swallowed while playing or while customizing with no piano key selected', async () => {
    const user = await startApp()
    await user.tab()
    expect(nameOf(document.activeElement)).toBe('Free Play')
    await user.tab({ shift: true })

    await openSettingsWithKeyboard(user, 'Keys')
    expect(isCustomizing()).toBe(true)
    await user.tab()
    expect(nameOf(document.activeElement)).toBe('Close Settings')
    await user.tab()
    expect(nameOf(document.activeElement)).toBe('Home row')
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(settingsTab('Keys'))
  })

  it('customizing works with the keyboard alone: Tab to a piano key, Enter, the new key, Escape', async () => {
    const user = await startApp()
    await openSettingsWithKeyboard(user, 'Keys')
    expect(isCustomizing()).toBe(true)

    // While customizing, the piano keys are real tab stops, after the panel's own controls.
    expect(await tabThrough(user, 12)).toEqual([
      'Close Settings',
      'Home row',
      'Two octaves',
      'White keys only',
      'Lower',
      'Higher',
      'Auto',
      'QWERTY',
      'AZERTY',
      'QWERTZ',
      'Reset to default keys',
      'C3',
    ])
    expect(piano().querySelectorAll('button[tabindex="0"]').length).toBe(37)

    const middleC = pianoKey('C4, key A')
    await tabTo(user, middleC)
    await user.keyboard('[Enter]')
    expect(textOf(changeOneKey())).toContain('Press a key for C4…')
    expect(middleC.getAttribute('aria-pressed')).toBe('true')

    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(keyMessage().textContent).toContain('"Z" now plays C4.')
    // The player keeps their place on the piano and can go on to the next key.
    expect(document.activeElement).toBe(middleC)

    // On to the next key, which Escape lets go of again.
    await user.tab()
    await user.keyboard('[Enter]')
    expect(textOf(changeOneKey())).toContain('Press a key for C♯4…')
    await user.keyboard('[Escape]')
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(panelNamed('Settings')).not.toBeNull()

    await user.keyboard('[Escape]')
    expect(panelNamed('Settings')).toBeNull()
    expect(isCustomizing()).toBe(false)
    expect(piano().querySelectorAll('[tabindex="0"]').length).toBe(0)
    // A piano key must not keep the keyboard once customizing is over.
    expect(piano().contains(document.activeElement)).toBe(false)
    expect(document.activeElement).toBe(settingsButton())
  }, LONG_WALK_MS)

  // Space is the sustain key everywhere and never presses the button that has
  // the focus. While customizing, the piano keys are such buttons: Enter is
  // the key that selects one.
  it('Space stays the sustain key on a focused piano key while customizing, and does not select it', async () => {
    const user = await startApp()
    await openSettingsWithKeyboard(user, 'Keys')
    const middleC = pianoKey('C4, key A')
    await tabTo(user, middleC)

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(textOf(changeOneKey())).not.toContain('Press a key for')
    expect(document.activeElement).toBe(middleC)

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(false)
    expect(piano().querySelector('.is-selected')).toBeNull()
  }, LONG_WALK_MS)

  it.each(['Enter', 'Space'])(
    'the start overlay is one button, and %s on it starts the app once and does nothing else',
    async (code) => {
      const user = drawApp()
      // Tab is itself "any key", so the overlay only gets the focus from a
      // screen reader or a half-finished click.
      screen.getByRole('button', { name: new RegExp(START_TEXT) }).focus()

      await user.keyboard(`[${code}]`)

      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(audio.state.starts).toBe(1)
      expect(settingsStore.get().sustain).toBe(false)
      expect(document.activeElement).toBe(document.body)
    },
  )

  // The menu hides when the mouse is still. Someone without a mouse must not
  // be left without it: Tab brings it back.
  it('Tab brings the menu back once it has hidden itself, and puts the player on its first control', () => {
    vi.useFakeTimers()
    try {
      drawApp()
      fireEvent.click(screen.getByRole('button', { name: new RegExp(START_TEXT) }))
      const menu = found(topBar().closest('header'), 'The menu')
      const isHidden = (): boolean => menu.classList.contains('menu--hidden')
      act(() => {
        vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS)
      })
      expect(isHidden()).toBe(true)

      // Playing does not bring it back, and Space is still the sustain key.
      fireEvent.keyDown(document.body, { code: 'KeyA', key: 'a' })
      expect(heldNotes()).toEqual([60])
      fireEvent.keyUp(document.body, { code: 'KeyA', key: 'a' })
      fireEvent.keyDown(document.body, { code: 'Space', key: ' ' })
      fireEvent.keyUp(document.body, { code: 'Space', key: ' ' })
      expect(settingsStore.get().sustain).toBe(true)
      expect(isHidden()).toBe(true)

      fireEvent.keyDown(document.body, { code: 'Tab', key: 'Tab' })
      fireEvent.keyUp(document.body, { code: 'Tab', key: 'Tab' })
      expect(isHidden()).toBe(false)
      expect(nameOf(document.activeElement)).toBe('Free Play')
      expect(heldNotes()).toEqual([])

      // It stays for as long as the keyboard is in it.
      act(() => {
        vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 4)
      })
      expect(isHidden()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Tab is "any key" too: it starts the app instead of moving the focus', async () => {
    const user = drawApp()
    await user.tab()
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.activeElement).toBe(document.body)
    await user.tab()
    expect(nameOf(document.activeElement)).toBe('Free Play')
  })

  // With the keyboard, Enter on a reset button replaces the button with
  // "Really reset? Yes / No", and the answer puts the button back. Each time
  // the button that had the focus disappears: the focus must move on to the
  // sensible next control instead of falling back to the page.
  it.each([
    ['About', 'Reset all settings'],
    ['Keys', 'Reset to default keys'],
  ] as const)(
    'the question of "%s: %s" takes the keyboard focus, and gives it back when answered',
    async (tab, label) => {
      const user = await startApp()
      const panel = await openSettings(user, tab)
      const reset = within(panel).getByRole('button', { name: label })
      await tabTo(user, reset)

      await user.keyboard('[Enter]')
      expect(within(panel).getByText('Really reset?')).toBeTruthy()
      // The player is on the question (Yes or No), not thrown back to the top of the page.
      const question = within(panel).getByRole('group', { name: label })
      expect(question.contains(document.activeElement)).toBe(true)
      // On "No", the answer that changes nothing.
      expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'No' }))

      await user.keyboard('[Enter]')
      expect(within(panel).queryByText('Really reset?')).toBeNull()
      expect(document.activeElement).toBe(within(panel).getByRole('button', { name: label }))

      // And "Yes" gives it back as well.
      await user.keyboard('[Enter]')
      const yes = within(panel).getByRole('button', { name: 'Yes' })
      await tabTo(user, yes, true)
      await user.keyboard('[Enter]')
      expect(within(panel).queryByText('Really reset?')).toBeNull()
      expect(document.activeElement).toBe(within(panel).getByRole('button', { name: label }))
    },
  )

  it('the question before a layout replaces the player\'s own keys takes the focus, and gives it back', async () => {
    const user = await startApp()
    act(() => settingsStore.set({ bindings: { KeyA: 12 } }))
    const panel = await openSettings(user, 'Keys')
    const card = within(panel).getByRole('button', { name: 'Two octaves' })
    await tabTo(user, card)

    await user.keyboard('[Enter]')
    const question = within(panel).getByRole('group', { name: 'Two octaves' })
    expect(textOf(question)).toBe('Replace your own keys with this layout?YesNo')
    expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'No' }))

    await user.keyboard('[Enter]')
    expect(within(panel).queryByText('Replace your own keys with this layout?')).toBeNull()
    expect(settingsStore.get().bindings).toEqual({ KeyA: 12 })
    expect(document.activeElement).toBe(card)
  })

  // The close button disappears with its panel, and so does any button of the
  // panel that has the focus when Escape closes it. The focus must not
  // disappear with them.
  it.each([
    ['Enter on "Close Settings"', 'Close Settings', '[Enter]'],
    ['Escape on a button of the panel', 'Reset to default keys', '[Escape]'],
  ] as const)('%s does not drop the keyboard focus on the floor', async (_what, name, keys) => {
    const user = await startApp()
    const panel = await openSettingsWithKeyboard(user, 'Keys')
    await tabTo(user, within(panel).getByRole('button', { name }))

    await user.keyboard(keys)

    expect(panelNamed('Settings')).toBeNull()
    expect(isCustomizing()).toBe(false)
    // The player is back on the button that opened the panel, not at the top of the page.
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(settingsButton())
  })

  // The same when the panel was opened with a click and is then closed with
  // the keyboard: whoever presses Enter or Escape is working with the
  // keyboard now, and must keep a place on the page.
  it.each([
    ['Enter on "Close Settings"', 'Close Settings', '[Enter]'],
    ['Escape on a button of the panel', 'Reset to default keys', '[Escape]'],
  ] as const)(
    '%s does not drop the focus on the floor either when Settings was opened with the mouse',
    async (_what, name, keys) => {
      const user = await startApp()
      const panel = await openSettings(user, 'Keys')
      await tabTo(user, within(panel).getByRole('button', { name }))

      await user.keyboard(keys)

      expect(panelNamed('Settings')).toBeNull()
      expect(document.activeElement).not.toBe(document.body)
      expect(document.activeElement).toBe(settingsButton())
    },
  )

  // And the same in Songs, whose "Play" buttons close the panel as well.
  it.each([
    ['Enter on "Close Songs"', /^Close Songs$/, '[Enter]'],
    ['Enter on the "Play" button of a song', /^Play Twinkle/, '[Enter]'],
    ['Escape on a button of the panel', /^Import a MIDI file$/, '[Escape]'],
  ] as const)(
    '%s does not drop the focus on the floor either when Songs was opened with the mouse',
    async (_what, name, keys) => {
      const user = await startApp()
      await user.click(songsButton())
      const songs = found(panelNamed('Songs'), 'The Songs panel')
      await tabTo(user, within(songs).getByRole('button', { name }))

      await user.keyboard(keys)

      expect(panelNamed('Songs')).toBeNull()
      expect(document.activeElement).not.toBe(document.body)
      expect(document.activeElement).toBe(songsButton())
    },
  )

  // Escape leaves customizing. A piano key that had the focus is then no
  // longer a tab stop, and the focus must not be lost with it either.
  it('Escape on a focused piano key leaves customizing without dropping the keyboard focus on the floor', async () => {
    const user = await startApp()
    await openSettingsWithKeyboard(user, 'Keys')
    await tabTo(user, pianoKey('C4, key A'))

    await user.keyboard('[Escape]')

    expect(panelNamed('Settings')).toBeNull()
    expect(isCustomizing()).toBe(false)
    expect(piano().contains(document.activeElement)).toBe(false)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(settingsButton())

    // And the piano plays again at once.
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
  }, LONG_WALK_MS)

  // -------------------------------------------------------------------------
  // Escape takes back one thing at a time, always in the same order: the
  // piano key that waits for a computer key, the open song options, the open
  // panel, and last the keyboard focus when it is inside the menu (which can
  // then hide). With none of these the key is left to the browser. A key that
  // is held down sends its press again and again: Escape still does one thing.
  // -------------------------------------------------------------------------

  const ESCAPE = { code: 'Escape', key: 'Escape' }

  /**
   * Presses Escape where the keyboard focus is, holds it down for `repeats`
   * more presses that the keyboard then sends by itself, and lets go. True
   * when the app used the press up, false when it left it to the browser.
   */
  function pressEscape(repeats: number): boolean {
    const focused = (): Element => document.activeElement ?? document.body
    // fireEvent returns false when something cancelled the key.
    const usedUp = !fireEvent.keyDown(focused(), ESCAPE)
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      fireEvent.keyDown(focused(), { ...ESCAPE, repeat: true })
    }
    fireEvent.keyUp(focused(), ESCAPE)
    return usedUp
  }

  const ESCAPE_PRESSES = [
    ['pressed and let go', 0],
    ['held down', 5],
  ] as const

  /** Puts a song in the player and pauses it at once, so that the only notes are the player's own. */
  async function loadPausedSong(user: User): Promise<HTMLElement> {
    await user.click(songsButton())
    await user.click(screen.getByRole('button', { name: /^Play Twinkle/ }))
    const player = screen.getByRole('region', { name: 'Song player' })
    await user.click(within(player).getByRole('button', { name: 'Pause' }))
    return player
  }

  function songOptions(): HTMLElement | null {
    return screen.queryByRole('group', { name: 'Song options' })
  }

  it.each(ESCAPE_PRESSES)(
    'Escape, %s, takes back one thing: the piano key that waits, then the song options, then the panel',
    async (_how, repeats) => {
      const user = await startApp()
      const player = await loadPausedSong(user)
      const panel = await openSettings(user, 'Keys')
      // The piano key of the computer key A, wherever the song has put the keys.
      const waiting = found(
        piano().querySelector<HTMLElement>('.piano-key[aria-label$=", key A"]'),
        'The piano key of A',
      )
      await user.click(waiting)
      await user.click(within(player).getByRole('button', { name: 'Song options' }))
      expect(waiting.classList.contains('is-selected')).toBe(true)
      expect(songOptions()).not.toBeNull()
      const before = settingsStore.get()

      // 1. The piano key no longer waits. Everything else is as it was.
      expect(pressEscape(repeats)).toBe(true)
      expect(piano().querySelector('.is-selected')).toBeNull()
      expect(songOptions()).not.toBeNull()
      expect(panelNamed('Settings')).toBe(panel)
      expect(isCustomizing()).toBe(true)

      // 2. The song options close. The panel stays.
      expect(pressEscape(repeats)).toBe(true)
      expect(songOptions()).toBeNull()
      expect(panelNamed('Settings')).toBe(panel)
      expect(isCustomizing()).toBe(true)

      // 3. The panel closes. The song stays in the player.
      expect(pressEscape(repeats)).toBe(true)
      expect(panelNamed('Settings')).toBeNull()
      expect(isCustomizing()).toBe(false)
      expect(screen.getByRole('region', { name: 'Song player' })).toBe(player)

      // 4. Nothing is left to take back: the key is the browser's.
      expect(keyboardHolder()).toBe(NOTHING)
      expect(pressEscape(repeats)).toBe(false)
      expect(screen.getByRole('region', { name: 'Song player' })).toBe(player)
      // Escape changed no key and no setting on the way.
      expect(settingsStore.get()).toBe(before)
    },
    LONG_WALK_MS,
  )

  it.each(ESCAPE_PRESSES)(
    'Escape, %s, closes song options used with the keyboard, then lets go of the menu, then is left to the browser',
    async (_how, repeats) => {
      const user = await startApp()
      const player = await loadPausedSong(user)
      const optionsButton = within(player).getByRole('button', { name: 'Song options' })
      await tabTo(user, optionsButton)
      await user.keyboard('[Enter]')
      expect(optionsButton.getAttribute('aria-expanded')).toBe('true')
      const options = found(songOptions(), 'The song options')
      await tabTo(user, within(options).getByRole('switch', { name: 'Melody only' }))

      // 1. The options close. The focus is not lost with them: it is on their button.
      expect(pressEscape(repeats)).toBe(true)
      expect(songOptions()).toBeNull()
      expect(optionsButton.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(optionsButton)

      // 2. The menu lets go of the keyboard. The song stays in the player.
      expect(pressEscape(repeats)).toBe(true)
      expect(keyboardHolder()).toBe(NOTHING)
      expect(screen.getByRole('region', { name: 'Song player' })).toBe(player)

      // 3. Nothing is left to take back: the key is the browser's.
      expect(pressEscape(repeats)).toBe(false)
      expect(screen.getByRole('region', { name: 'Song player' })).toBe(player)
      await expectKeysToPlay(user)
    },
    LONG_WALK_MS,
  )

  // Tab brings the hidden menu back and puts the keyboard in it, and the menu
  // stays for as long as the keyboard is there. Escape is the way out again.
  it('Escape takes the keyboard out of the menu that Tab brought back, and the menu hides again', () => {
    vi.useFakeTimers()
    try {
      drawApp()
      fireEvent.click(screen.getByRole('button', { name: new RegExp(START_TEXT) }))
      const menu = found(topBar().closest('header'), 'The menu')
      const isHidden = (): boolean => menu.classList.contains('menu--hidden')
      act(() => {
        vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS)
      })
      fireEvent.keyDown(document.body, { code: 'Tab', key: 'Tab' })
      fireEvent.keyUp(document.body, { code: 'Tab', key: 'Tab' })
      expect(isHidden()).toBe(false)
      expect(menu.contains(document.activeElement)).toBe(true)

      expect(pressEscape(0)).toBe(true)
      expect(keyboardHolder()).toBe(NOTHING)
      // The menu is given its usual time, and then goes.
      expect(isHidden()).toBe(false)
      act(() => {
        vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS)
      })
      expect(isHidden()).toBe(true)

      // Escape pressed nothing and changed nothing, and the next one is the browser's.
      expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(pressEscape(0)).toBe(false)
      expect(isHidden()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------------------
// What a screen reader is told
// ---------------------------------------------------------------------------

/**
 * Goes through everything there is to open, one place after the other (only
 * one panel is open at a time), with every question asked and a piano key
 * waiting for its computer key. `look` is called at each place, with its name.
 */
async function visitEveryPlace(user: User, look: (place: string) => void): Promise<void> {
  act(() => settingsStore.set({ transpose: 2 }))
  look('the stage')

  const settings = await openSettings(user, 'Sound')
  look('Settings, Sound')

  // The Keys tab with the player's own keys, both of its questions asked and
  // a piano key that has just refused a computer key.
  await user.click(settingsTab('Keys'))
  await user.click(pianoKey('C4, key A'))
  await user.keyboard('[KeyZ]')
  await user.click(within(settings).getByRole('button', { name: 'Two octaves' }))
  await user.click(within(settings).getByRole('button', { name: 'Reset to default keys' }))
  await user.click(pianoKey('C4, key Z'))
  await user.keyboard('[Enter]')
  look('Settings, Keys')
  await user.keyboard('[Escape]')

  await user.click(settingsTab('Piano'))
  look('Settings, Piano')

  await user.click(settingsTab('Look'))
  look('Settings, Look')

  await user.click(settingsTab('About'))
  await user.click(within(settings).getByRole('button', { name: 'Reset all settings' }))
  look('Settings, About')

  await user.click(songsButton())
  const songs = found(panelNamed('Songs'), 'The Songs panel')
  look('Songs')

  // A song in the player, stopped, with its options open.
  await user.click(within(songs).getByRole('button', { name: /^Play Twinkle/ }))
  await user.click(screen.getByRole('button', { name: 'Pause' }))
  await user.click(screen.getByRole('button', { name: 'Song options' }))
  look('a song in the player')
}

const EVERY_PLACE = [
  'the stage',
  'Settings, Sound',
  'Settings, Keys',
  'Settings, Piano',
  'Settings, Look',
  'Settings, About',
  'Songs',
  'a song in the player',
]

describe('ARIA', () => {
  it('every id is unique and every aria reference points at something on the page', async () => {
    audio.state.startsAs = 'loading'
    const user = await startApp()
    const seen: string[] = []

    await visitEveryPlace(user, (place) => {
      seen.push(place)
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
      expect(new Set(ids).size, place).toBe(ids.length)

      for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
        for (const element of document.querySelectorAll(`[${attribute}]`)) {
          for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/)) {
            expect(document.getElementById(id), `${place}: ${attribute}="${id}"`).not.toBeNull()
          }
        }
      }
    })
    expect(seen).toEqual(EVERY_PLACE)
  })

  it('every button, switch, slider and list has a name', async () => {
    const user = await startApp()
    const seen: string[] = []

    await visitEveryPlace(user, (place) => {
      seen.push(place)
      const controls = [
        ...document.querySelectorAll('button, input, select, [role="switch"], [role="tab"]'),
        // What screen readers are not told about needs no name: the browser's own
        // colour picker and file field, each opened by a button that has one.
      ].filter((control) => control.closest('[aria-hidden="true"], [hidden]') === null)
      // The 37 piano keys and the seven controls of the top bar are always there.
      expect(controls.length, place).toBeGreaterThanOrEqual(44)
      if (place.startsWith('Settings')) expect(controls.length, place).toBeGreaterThan(50)
      for (const control of controls) {
        expect(nameOf(control).length, `${place}: ${control.outerHTML.slice(0, 80)}`).toBeGreaterThan(0)
      }
    })
    expect(seen).toEqual(EVERY_PLACE)
  })

  it('names buttons by their word alone: the arrows, the speaker, the cross and the chevron are decoration', async () => {
    const user = await startApp()
    /** The element that holds a decorative character, and nothing else. */
    const holderOf = (glyph: string): Element | undefined =>
      [...document.querySelectorAll('span')].find(
        (span) => span.children.length === 0 && (span.textContent ?? '').includes(glyph),
      )

    // The top bar: the speaker of the volume is a small drawing.
    expect(within(topBar()).getByRole('button', { name: 'Songs' })).toBeTruthy()
    expect(within(topBar()).getByRole('button', { name: 'Settings' })).toBeTruthy()
    expect(within(topBar()).getByRole('slider', { name: 'Volume' })).toBeTruthy()
    expect(topBar().querySelectorAll('svg').length).toBeGreaterThan(0)
    for (const drawing of topBar().querySelectorAll('svg')) {
      expect(drawing.getAttribute('aria-hidden')).toBe('true')
    }

    // Settings: the cross of its close button, and the arrows of Lower and Higher.
    const keys = await openSettings(user, 'Keys')
    const close = within(keys).getByRole('button', { name: 'Close Settings' })
    expect(close.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(within(keys).getByRole('button', { name: 'Lower' })).toBeTruthy()
    expect(within(keys).getByRole('button', { name: 'Higher' })).toBeTruthy()
    for (const glyph of ['◀', '▶']) {
      expect(holderOf(glyph)?.getAttribute('aria-hidden'), glyph).toBe('true')
    }

    // The player line: the drawings on Play and Restart, and the chevron of "Song options".
    await user.click(songsButton())
    await user.click(screen.getByRole('button', { name: /^Play Twinkle/ }))
    const player = screen.getByRole('region', { name: 'Song player' })
    expect(within(player).getByRole('button', { name: 'Pause' })).toBeTruthy()
    expect(within(player).getByRole('button', { name: 'Restart' })).toBeTruthy()
    expect(within(player).getByRole('button', { name: 'Song options' })).toBeTruthy()
    expect(holderOf('▾')?.getAttribute('aria-hidden')).toBe('true')
    for (const drawing of player.querySelectorAll('svg')) {
      expect(drawing.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('groups each control with its visible label and its explanation', async () => {
    const user = await startApp()
    const rows: Record<SettingsTab, number> = { Sound: 6, Keys: 2, Piano: 4, Look: 9, About: 0 }
    const cardGroups: Record<SettingsTab, number> = { Sound: 0, Keys: 1, Piano: 0, Look: 1, About: 0 }

    for (const tab of SETTINGS_TABS) {
      const panel = await openSettings(user, tab)

      const groups = [...panel.querySelectorAll<HTMLElement>('.field')]
      expect(groups.length, tab).toBe(rows[tab])
      for (const group of groups) {
        expect(group.getAttribute('role')).toBe('group')
        const label = document.getElementById(group.getAttribute('aria-labelledby') ?? '')
        expect(label?.textContent).toBe(group.querySelector('.field__label')?.textContent)
        expect(label?.textContent).toBeTruthy()
        const hint = group.querySelector('.field__hint')
        if (hint) {
          expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')).toBe(hint)
        }
      }

      // The themes and the key layouts: cards under one name and one explanation.
      const cards = [...panel.querySelectorAll<HTMLElement>('.choice-group')]
      expect(cards.length, tab).toBe(cardGroups[tab])
      for (const group of cards) {
        expect(group.getAttribute('role')).toBe('group')
        const label = document.getElementById(group.getAttribute('aria-labelledby') ?? '')
        expect(label?.textContent).toBe(group.querySelector('.settings-label')?.textContent)
        expect(label?.textContent).toBeTruthy()
        const hint = group.querySelector('.choice-group__head .settings-hint')
        if (hint) {
          expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')).toBe(hint)
        }
        // Each card says what it is called and what choosing it gives.
        for (const card of within(group).getAllByRole('button')) {
          expect(nameOf(card)).toBeTruthy()
          expect(explanationOf(card)).toBeTruthy()
          expect(['true', 'false']).toContain(card.getAttribute('aria-pressed'))
        }
      }
    }
  })

  it('says what a slider is set to in percent', async () => {
    const user = await startApp()
    const sliders = (): string[] =>
      screen
        .getAllByRole('slider')
        .map((slider) => `${slider.getAttribute('aria-label')}: ${slider.getAttribute('aria-valuetext')}`)
    expect(sliders()).toEqual(['Volume: 80%'])

    await openSettings(user, 'Sound')
    expect(sliders()).toEqual(['Volume: 80%', 'Volume: 80%', 'Touch: 80%', 'Room echo: 15%'])

    await openSettings(user, 'Look')
    expect(sliders()).toEqual(['Volume: 80%', 'Glow: 60%'])
  })

  it('makes the piano one named group whose keys say their note, their computer key and whether they are down', async () => {
    const user = await startApp()
    expect(piano().getAttribute('aria-label')).toBe('Piano')
    const keys = [...piano().querySelectorAll('.piano-key')]
    expect(keys.length).toBe(37)
    expect(keys[0]?.getAttribute('aria-label')).toBe('C3')
    expect(keys[12]?.getAttribute('aria-label')).toBe('C4, key A')
    expect(keys[36]?.getAttribute('aria-label')).toBe('C6')
    for (const key of keys) expect(key.getAttribute('aria-pressed')).toBe('false')

    await user.keyboard('[KeyA>]')
    expect(keys[12]?.getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('[/KeyA]')
  })

  it('keeps the two message lines on the page while they are empty, as live regions', async () => {
    const user = await startApp()
    const sound = soundStatus()
    expect(sound.textContent).toBe('')

    await openSettings(user, 'Keys')
    const result = keyMessage()
    expect(result.textContent).toBe('')

    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[Enter]')
    // The same element gets the text: that is what makes a screen reader speak it.
    expect(keyMessage()).toBe(result)
    expect(result.textContent).toMatch(/^That key can't be used/)

    // The sound's line is still the same one, and still there.
    expect(soundStatus()).toBe(sound)
    setAudioStatus('fallback')
    expect(sound.textContent).toMatch(/^Using basic sound/)
  })

  it('does not read out the notes being played: they change too fast', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')
    const notes = within(sky()).getByRole('list', { name: 'Notes being played' })
    expect(notes.closest('[role="status"], [aria-live]')).toBeNull()
    await user.keyboard('[/KeyA]')
  })

  it.each([
    ['About', 'Reset all settings'],
    ['Keys', 'Reset to default keys'],
  ] as const)('names the reset question of the %s tab after what it resets', async (tab, label) => {
    const user = await startApp()
    const panel = await openSettings(user, tab)
    await user.click(within(panel).getByRole('button', { name: label }))
    const question = within(panel).getByRole('group', { name: label })
    expect(textOf(question)).toBe('Really reset?YesNo')
  })

  // Once a piano key is selected every key press belongs to the editor, Tab
  // included. A screen-reader user who selected the key with Enter must be
  // told what is asked for and that Esc gets out, or they are stuck.
  //
  // A screen reader speaks text that changes inside a live region it already
  // knows. So both lines have to be polite live regions that are on the page
  // before the key is selected. (A description added to the key itself would
  // not do: it is not read out for the element that already has the focus.)
  it('tells a screen reader what to do once a piano key is selected', async () => {
    const user = await startApp()
    const panel = await openSettingsWithKeyboard(user, 'Keys')
    const liveRegions = new Set<Element>(panel.querySelectorAll('[aria-live="polite"]'))

    await tabTo(user, pianoKey('C4, key A'))
    await user.keyboard('[Enter]')

    const prompt = within(panel).getByText('Press a key for C4…')
    const wayOut = within(panel).getByText('Esc = cancel · Backspace = remove this key')
    for (const line of [prompt, wayOut]) {
      const region = line.closest('[aria-live="polite"]')
      expect(region, textOf(line)).not.toBeNull()
      expect(region !== null && liveRegions.has(region), textOf(line)).toBe(true)
    }
  }, LONG_WALK_MS)

  it('says of each panel what it is, and which button opened it', async () => {
    const user = await startApp()
    for (const name of ['Settings', 'Songs'] as const) {
      const button = within(topBar()).getByRole('button', { name })
      expect(button.hasAttribute('aria-controls')).toBe(false)
      await user.click(button)
      const panel = found(panelNamed(name), `The ${name} panel`)
      expect(button.getAttribute('aria-controls')).toBe(panel.id)
      expect(within(panel).getByRole('heading', { level: 2, name })).toBeTruthy()
      expect(within(panel).getByRole('button', { name: `Close ${name}` })).toBeTruthy()
      // The piano stays in reach under it: the panel does not take the page over.
      expect(panel.getAttribute('aria-modal')).not.toBe('true')
      expect(appScreen().hasAttribute('inert')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** Everything a player can read or be told by a screen reader, on the whole page. */
function everyWordOnThePage(): string {
  const parts: string[] = [document.body.textContent ?? '']
  for (const attribute of ['aria-label', 'aria-valuetext', 'title', 'placeholder', 'alt']) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      parts.push(element.getAttribute(attribute) ?? '')
    }
  }
  return parts.join(' \n ')
}

/**
 * The words the spec keeps away from the player: "MIDI", "binding" (in any
 * of its forms), "slot" and "octave shift".
 */
const JARGON = [/midi/i, /\bbind/i, /\bbound\b/i, /\bslots?\b/i, /octave shift/i]

/** And where songs are concerned: a song has parts and a speed. */
const SONG_JARGON = [/\btracks?\b/i, /\btempo\b/i, /\bbpm\b/i]

/**
 * "MIDI file" is the one technical term a player is shown, where songs are
 * added, because it is what they have to look for (docs/SONGS.md, section 1).
 */
function withoutMidiFile(words: string): string {
  return words.replace(/MIDI files?/g, 'file')
}

describe('wording', () => {
  it('uses no jargon anywhere, with every panel open in turn', async () => {
    audio.state.startsAs = 'fallback'
    const user = await startApp()
    const seen: string[] = []

    await visitEveryPlace(user, (place) => {
      seen.push(place)
      const everything = everyWordOnThePage()
      const words = place === 'Songs' ? withoutMidiFile(everything) : everything
      for (const jargon of [...JARGON, ...SONG_JARGON]) {
        expect(words, `${place}: ${jargon}`).not.toMatch(jargon)
      }
    })
    expect(seen).toEqual(EVERY_PLACE)
  })

  it('says "MIDI file" in the Songs panel, where songs are added, and nowhere else', async () => {
    const user = await startApp()
    expect(everyWordOnThePage()).not.toMatch(/midi/i)
    for (const tab of SETTINGS_TABS) {
      await openSettings(user, tab)
      expect(everyWordOnThePage(), tab).not.toMatch(/midi/i)
    }

    await user.click(songsButton())
    const songs = found(panelNamed('Songs'), 'The Songs panel')
    expect(within(songs).getByRole('button', { name: 'Import a MIDI file' })).toBeTruthy()
    expect(within(songs).getByText('or drop a MIDI file anywhere on this page')).toBeTruthy()
    expect(withoutMidiFile(everyWordOnThePage())).not.toMatch(/midi/i)

    await user.click(screen.getByRole('button', { name: 'Close Songs' }))
    expect(everyWordOnThePage()).not.toMatch(/midi/i)
  })

  it('uses no jargon in the messages of the key editor either', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Keys')
    const messages: string[] = []
    const read = (): void => {
      messages.push(keyMessage().textContent ?? '')
    }
    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[KeyK]')
    read()
    await user.click(pianoKey('D4, key S'))
    await user.keyboard('[Delete]')
    read()
    await user.click(within(panel).getByRole('button', { name: 'Reset to default keys' }))
    await user.click(within(panel).getByRole('button', { name: 'Yes' }))
    read()
    expect(messages[0]).toBe('"K" now plays C4. "A" no longer plays a note. C5 has no key now.')
    expect(messages[1]).toBe('D4 has no key now.')
    expect(messages[2]?.length).toBeGreaterThan(0)
    for (const message of messages) {
      for (const jargon of JARGON) expect(message).not.toMatch(jargon)
    }
  })

  it('shows the same words in the same places whatever is open (nothing renames itself)', async () => {
    const user = await startApp()
    const wordsOfTheTopBar = (): string[] =>
      [...topBar().querySelectorAll('h1, button, input, kbd')].map((element) => nameOf(element))
    const before = wordsOfTheTopBar()
    expect(before).toEqual([
      APP_NAME,
      'Free Play',
      'PracticeSoon',
      'Real-timeSoon',
      'Volume',
      'Sustain',
      'Space',
      'Songs',
      'Settings',
    ])

    for (const tab of SETTINGS_TABS) {
      await openSettings(user, tab)
      expect(wordsOfTheTopBar(), tab).toEqual(before)
      // The tabs of the panel keep their names and their order too.
      expect(within(settingsPanel()).getAllByRole('tab').map(nameOf)).toEqual(SETTINGS_TABS)
    }
    await user.click(songsButton())
    expect(wordsOfTheTopBar()).toEqual(before)
    await user.click(within(found(panelNamed('Songs'), 'The Songs panel')).getByRole('button', { name: /^Play Twinkle/ }))
    expect(wordsOfTheTopBar()).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// Nothing gets stuck, nothing is lost
// ---------------------------------------------------------------------------

describe('no stuck notes and no lost settings', () => {
  it('plays each key press exactly once (the app is drawn twice in development)', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA][KeyS]')
    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([
      'on:60:0.8',
      'on:62:0.8',
    ])
    expect(audio.state.calls.filter((call) => call.startsWith('off:'))).toEqual(['off:60', 'off:62'])
  })

  it('lets go of a held note when the Keys tab is opened, and when a piano key is selected', async () => {
    const user = await startApp()
    // Settings opens on the tab it was last on: make that one a tab where the piano just plays.
    await openSettings(user, 'Sound')
    await user.click(settingsButton())

    await user.keyboard('[KeyA>]')
    await user.click(settingsButton())
    // Settings alone does not stop the piano…
    expect(heldNotes()).toEqual([60])
    // …choosing the computer keys does.
    await user.click(settingsTab('Keys'))
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls).toContain('off:60')
    expect(piano().querySelector('.is-lit')).toBeNull()
    await user.keyboard('[/KeyA]')

    await user.keyboard('[KeyS>]')
    expect(heldNotes()).toEqual([62])
    await user.click(pianoKey('C4, key A'))
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyS]')
    expect(heldNotes()).toEqual([])
    // Letting go of S was not "the next key press": C4 still waits for its key.
    expect(pianoKey('C4, key A').classList.contains('is-selected')).toBe(true)
  })

  it('lets go of held notes when the page is hidden, left, or loses the keyboard', async () => {
    const user = await startApp()

    await user.keyboard('[KeyA>]')
    fireEvent(window, new Event('blur'))
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')

    await user.keyboard('[KeyA>]')
    fireEvent(window, new Event('pagehide'))
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')

    await user.keyboard('[KeyA>]')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    visibility.mockRestore()
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')

    // Nothing is left on the screen either: no name above the piano, no key lit.
    expect(playedNotes()).toEqual([])
    expect(piano().querySelector('.is-lit')).toBeNull()
    expect(audio.state.calls.filter((call) => call === 'off:60')).toHaveLength(3)
  })

  it('lets go of held notes when the app goes away', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>][KeyD>]')
    expect(heldNotes()).toEqual([60, 64])
    cleanup()
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls).toContain('off:60')
    expect(audio.state.calls).toContain('off:64')
  })

  it('lets go of a held note when a reset moves the keys back to where they were at the start', async () => {
    const user = await startApp()
    act(() => settingsStore.set({ baseOctave: 2 }))
    const panel = await openSettings(user, 'About')
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([48])

    await user.click(within(panel).getByRole('button', { name: 'Reset all settings' }))
    await user.click(within(panel).getByRole('button', { name: 'Yes' }))
    expect(settingsStore.get().baseOctave).toBe(3)
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls).toContain('off:48')
    expect(piano().querySelector('.is-lit')).toBeNull()

    // The key is still down. Letting go of it later stops nothing, and it plays again after that.
    await user.keyboard('[/KeyA]')
    expect(heldNotes()).toEqual([])
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    await user.keyboard('[/KeyA]')
  })

  it('what the player changed on the screen is what a reload would find', async () => {
    const { createSettingsStore } = await import('./state/settings')
    const user = await startApp()

    fireEvent.change(within(topBar()).getByRole('slider', { name: 'Volume' }), {
      target: { value: '55' },
    })
    await user.keyboard('[Space]')

    const panel = await openSettings(user, 'Sound')
    fireEvent.change(within(panel).getByRole('slider', { name: 'Touch' }), { target: { value: '60' } })
    await user.click(within(panel).getByRole('button', { name: 'Transpose down' }))
    fireEvent.change(within(panel).getByRole('slider', { name: 'Room echo' }), { target: { value: '0' } })
    await user.click(within(panel).getByRole('button', { name: 'Short' }))

    await user.click(settingsTab('Piano'))
    await user.selectOptions(
      within(panel).getByRole('combobox', { name: 'Labels on the keys' }),
      'Keys only',
    )
    await user.click(within(panel).getByRole('button', { name: 'Do Ré Mi' }))
    await user.click(within(panel).getByRole('button', { name: 'Glass' }))
    await user.click(within(panel).getByRole('button', { name: '49' }))

    await user.click(settingsTab('Look'))
    await user.click(within(panel).getByRole('switch', { name: 'Light bars' }))
    await user.click(within(panel).getByRole('radio', { name: 'Blue' }))
    fireEvent.change(within(panel).getByRole('slider', { name: 'Glow' }), { target: { value: '90' } })
    await user.click(within(panel).getByRole('button', { name: 'Stars' }))
    await user.click(within(panel).getByRole('button', { name: 'Neon' }))
    await user.click(within(panel).getByRole('button', { name: 'Lots' }))
    await user.click(within(panel).getByRole('switch', { name: 'Key letters on falling notes' }))
    await user.click(within(panel).getByRole('switch', { name: 'Show the notes being played' }))
    await user.click(within(panel).getByRole('switch', { name: 'Hide the menu automatically' }))

    await user.click(settingsTab('Keys'))
    await user.click(within(panel).getByRole('button', { name: 'Lower' }))
    await user.click(within(panel).getByRole('button', { name: 'QWERTZ' }))
    await user.click(pianoKey('Do2'))
    await user.keyboard('[KeyZ]')

    const expected: Settings = {
      ...DEFAULT_SETTINGS,
      volume: 0.55,
      sustain: true,
      baseOctave: 2,
      labelMode: 'keys',
      velocity: 0.6,
      transpose: -1,
      noteNaming: 'solfege',
      reverb: 0,
      release: 'short',
      showTrails: false,
      pianoSize: 49,
      keyStyle: 'glass',
      keyboardType: 'qwertz',
      accent: 'blue',
      glow: 0.9,
      background: 'stars',
      barStyle: 'neon',
      sparks: 'lots',
      showKeyHints: false,
      showNoteNames: false,
      autoHideMenu: false,
      bindings: { ...DEFAULT_BINDINGS, KeyZ: 0 },
      customLabels: { KeyZ: 'Z' },
    }
    expect(settingsStore.get()).toEqual(expected)
    // A fresh store over the same storage is what the next visit starts from.
    expect(createSettingsStore(window.localStorage).get()).toEqual(expected)
  })

  it('applies the saved settings to the sound and the screen when the app is first drawn', async () => {
    act(() =>
      settingsStore.set({
        volume: 0.3,
        sustain: true,
        transpose: 4,
        reverb: 0.5,
        release: 'long',
        labelMode: 'notes',
        baseOctave: 4,
        keyStyle: 'midnight',
        accent: 'green',
      }),
    )
    audio.state.calls.length = 0
    const user = drawApp()

    for (const call of ['volume:0.3', 'sustain:true', 'transpose:4', 'reverb:0.5', 'release:2.5']) {
      expect(audio.state.calls).toContain(call)
    }
    const volume = within(topBar()).getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    expect(volume.value).toBe('30')
    expect(volume.getAttribute('aria-valuetext')).toBe('30%')
    expect(screen.getByRole('switch', { name: 'Sustain' }).getAttribute('aria-checked')).toBe('true')
    expect(transposedBadge()?.textContent).toBe('Transposed +4')
    expect(sustainBadge()?.textContent).toBe('Sustain on')
    // The piano: where the keys sit, what is written on them, how they are drawn, the colour of the light.
    expect(pianoKey('C5, key A')).toBeTruthy()
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(0)
    expect(piano().querySelectorAll('.piano-key__note').length).toBeGreaterThan(0)
    expect(piano().getAttribute('data-key-style')).toBe('midnight')
    expect(found(document.querySelector<HTMLElement>('.app'), 'The app').style.getPropertyValue('--light')).toBe(
      '#2bd96b',
    )
    // Settings stays closed even though some of its options are not the default.
    expect(settingsButton().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()

    // Once it is opened, its tabs show the same saved values.
    await user.click(screen.getByRole('button', { name: new RegExp(START_TEXT) }))
    const panel = await openSettings(user, 'Sound')
    expect(within(option(panel, 'Volume')).getByText('30%')).toBeTruthy()
    expect(within(option(panel, 'Room echo')).getByText('50%')).toBeTruthy()
    expect(panel.querySelector('.stepper__value')?.textContent).toBe('+4')
    expect(within(panel).getByRole('button', { name: 'Long' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(settingsTab('Keys'))
    expect(within(panel).getByText('C4 – C7')).toBeTruthy()
    await user.click(settingsTab('Piano'))
    const labels = within(panel).getByRole('combobox', { name: 'Labels on the keys' })
    expect((labels as HTMLSelectElement).value).toBe('notes')
    expect(within(panel).getByRole('button', { name: 'Midnight' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })
})

// ---------------------------------------------------------------------------
// The mouse on the piano, as the hint promises ("or click it")
// ---------------------------------------------------------------------------

/** jsdom lays nothing out, so the piano is told where it is: 1100 x 200 at the top left. */
function placePiano(): HTMLElement {
  const box = piano()
  box.getBoundingClientRect = () => new DOMRect(0, 0, 1100, 200)
  return box
}

describe('the mouse on the piano', () => {
  const LOWEST_KEY = { pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: 190 }

  it('a press plays the key under it, as hard as Touch says, and letting go stops it', async () => {
    await startApp()
    act(() => settingsStore.set({ velocity: 0.5 }))
    const box = placePiano()
    expect(hintIsShown()).toBe(true)

    fireEvent.pointerDown(box, { ...LOWEST_KEY, button: 0, buttons: 1 })
    expect(heldNotes()).toEqual([48])
    expect(playedNotes()).toEqual(['C3'])
    expect(pianoKey('C3').classList.contains('is-lit')).toBe(true)
    expect(audio.state.calls).toContain('on:48:0.5')
    // The hint has done its work at the first note.
    expect(hintIsShown()).toBe(false)

    fireEvent.pointerUp(box, { ...LOWEST_KEY, button: 0, buttons: 0 })
    expect(heldNotes()).toEqual([])
    expect(playedNotes()).toEqual([])
    expect(pianoKey('C3').classList.contains('is-lit')).toBe(false)
    expect(audio.state.calls).toContain('off:48')
  })

  it('plays under an open panel too, which stays open', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Look')
    const box = placePiano()

    fireEvent.pointerDown(box, { ...LOWEST_KEY, button: 0, buttons: 1 })
    expect(heldNotes()).toEqual([48])
    fireEvent.pointerUp(box, { ...LOWEST_KEY, button: 0, buttons: 0 })
    await user.click(pianoKey('C3'))

    expect(heldNotes()).toEqual([])
    expect(panelNamed('Settings')).toBe(panel)
  })

  it('plays nothing while customizing, where a click chooses the key to change', async () => {
    const user = await startApp()
    await openSettings(user, 'Keys')
    const box = placePiano()

    fireEvent.pointerDown(box, { ...LOWEST_KEY, button: 0, buttons: 1 })
    fireEvent.pointerUp(box, { ...LOWEST_KEY, button: 0, buttons: 0 })
    await user.click(pianoKey('C3'))

    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([])
    expect(textOf(changeOneKey())).toContain('Press a key for C3…')
  })

  it('takes the keyboard away from the Labels list, so the keys play again', async () => {
    const user = await startApp()
    const panel = await openSettings(user, 'Piano')
    const select = within(panel).getByRole('combobox', { name: 'Labels on the keys' })
    await user.click(select)
    expect(document.activeElement).toBe(select)

    const box = placePiano()
    fireEvent.pointerDown(box, { ...LOWEST_KEY, button: 0, buttons: 1 })
    fireEvent.pointerUp(box, { ...LOWEST_KEY, button: 0, buttons: 0 })

    expect(document.activeElement).toBe(document.body)
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    await user.keyboard('[/KeyA]')
  })
})

// ---------------------------------------------------------------------------
// The Keys tab of Settings is where the computer keys are changed, so while it
// is open the piano always shows them, whatever the Labels choice is for
// playing. The choice itself is not changed.
// ---------------------------------------------------------------------------

describe('Customize keys while the key labels are switched off', () => {
  it.each([
    ['No labels', 'none', false],
    ['Notes only', 'notes', true],
  ] as const)(
    'shows the computer keys on the piano while customizing, even with "%s" chosen for playing',
    async (_name, mode, noteNames) => {
      const user = await startApp()
      act(() => settingsStore.set({ labelMode: mode }))
      expect(piano().querySelectorAll('.piano-key__cap').length).toBe(0)

      const panel = await openSettings(user, 'Keys')
      // 18 piano keys have a computer key by default: the player must see them to change them.
      const caps = [...piano().querySelectorAll('.piano-key__cap')].map((cap) => cap.textContent)
      expect(caps).toHaveLength(18)
      expect(caps).toContain('A')
      // Only the computer keys are added: the note names are shown, or not, as the player chose.
      expect(piano().querySelectorAll('.piano-key__note').length > 0).toBe(noteNames)
      // The choice itself stays as it was in what is saved…
      expect(settingsStore.get().labelMode).toBe(mode)
      expect(saved().labelMode).toBe(mode)

      // …and on the screen: the Piano tab still shows it, and there the piano is labelled as chosen.
      await user.click(settingsTab('Piano'))
      const labels = within(panel).getByRole('combobox', { name: 'Labels on the keys' })
      expect((labels as HTMLSelectElement).value).toBe(mode)
      expect(piano().querySelectorAll('.piano-key__cap').length).toBe(0)

      await user.click(settingsTab('Keys'))
      expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(18)
      await user.click(within(panel).getByRole('button', { name: 'Close Settings' }))
      // Back to playing: the labels are as the player chose them.
      expect(settingsStore.get().labelMode).toBe(mode)
      expect(piano().querySelectorAll('.piano-key__cap').length).toBe(0)
      expect(piano().querySelectorAll('.piano-key__note').length > 0).toBe(noteNames)
    },
  )
})
