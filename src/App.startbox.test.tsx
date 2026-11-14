// @vitest-environment jsdom
/**
 * The start box in the whole app: the small menu that is open when the app
 * opens, and that the Menu button opens again. Before the first click or key
 * press: what starts the app and what does not, and each line of the box used
 * as the very first thing. After it: what opens and closes the box, what its
 * lines do, what Escape, the piano keys and the mouse do to it, what Enter does
 * when it is held down, and where the keyboard focus goes, for someone with a
 * keyboard and for someone with a mouse.
 *
 * The sound engine and the sky are stand-ins; each has tests of its own. The
 * simulated page differs from a browser's in three ways that matter here: it
 * has no full screen (a test that needs one gives it one), it would give the
 * keyboard focus to a control that cannot be used, which it is taught not to,
 * and a click does not move the keyboard focus, so a test that clicks moves
 * it first, to where a browser would.
 */
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle', starts: 0, notesOn: [] as number[], notesOff: [] as number[] }
  const tell = (): void => {
    for (const listener of [...listeners]) listener()
  }
  const engine = {
    start(): Promise<void> {
      state.starts += 1
      state.status = 'ready'
      tell()
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
      state.notesOn.push(midi)
    },
    noteOff(midi: number): void {
      state.notesOff.push(midi)
    },
    setSustain(): void {},
    setVolume(): void {},
    setTranspose(): void {},
    setReverb(): void {},
    setRelease(): void {},
    allNotesOff(): void {},
    dispose(): void {},
  }
  return { engine, state, tell }
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
import { APP_NAME } from './app/appInfo'
import { bus } from './app/pianoApp'
import { player } from './app/songsApp'
import { formatDuration } from './songs/song'
import { STARTER_SONGS } from './songs/starterSongs'
import { settingsStore } from './state/settings'
import { CLOSE_SENTENCE, START_SENTENCE } from './ui/StartBox'
import { addSong, resetSongs, songFile } from './ui/songsTestKit'
import { AUTO_HIDE_DELAY_MS } from './ui/useAutoHide'
import { UNREADABLE_SONG_MESSAGE, playSong } from './ui/useSongs'

const HINT = 'Press the keys shown on the piano, or click it'
const TAGLINE = 'A piano you play with your computer keyboard.'
const TWINKLE = 'starter:twinkle-twinkle-little-star'
const PLAY_TWINKLE = 'Play Twinkle, Twinkle, Little Star'
const FREE_PLAY = /^Free Play/

/** The lines of the box that Tab stops at, top to bottom, while the player has no songs. */
const LINES_OF_THE_BOX = [
  'Free PlayPlay anything you like',
  PLAY_TWINKLE,
  'Play Mary Had a Little Lamb',
  'Play Ode to Joy',
  'All songs…',
  'Settings',
  'About',
]

/** How the simulated page gives a control the keyboard focus, before the tests change it. */
const focusOfThePage = HTMLElement.prototype.focus

/** The element the make-believe browser is showing full screen, or null. */
let fullscreenElement: Element | null = null
const requestFullscreen = vi.fn<() => Promise<void>>()
const exitFullscreen = vi.fn<() => Promise<void>>()

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  audio.state.starts = 0
  audio.state.notesOn = []
  audio.state.notesOff = []
  fullscreenElement = null
  requestFullscreen.mockReset().mockResolvedValue(undefined)
  exitFullscreen.mockReset().mockResolvedValue(undefined)
  // A browser never gives the keyboard focus to a control inside a part of the
  // page that is inert. The simulated page would, so it is taught not to.
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (this.closest('[inert]') === null) focusOfThePage.call(this, options)
  })
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  const page = document as unknown as Record<string, unknown>
  delete page.fullscreenEnabled
  delete page.fullscreenElement
  delete page.exitFullscreen
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen
  bus.allOff()
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

/**
 * A click with the mouse that lands on `place`: a heading, a picture, the
 * words inside a button. As in a browser, the keyboard focus goes to the
 * nearest thing around the place that can hold it, and the click arrives on
 * the place itself.
 */
function clickWithMouseOn(place: Element): void {
  place.closest<HTMLElement>('button, [tabindex]')?.focus()
  fireEvent.click(place, { detail: 1 })
}

/** What is drawn deepest inside a control, at its start or at its end: a picture, a few words. */
function innermost(control: Element, end: 'first' | 'last'): Element {
  const inside = end === 'first' ? control.firstElementChild : control.lastElementChild
  return inside === null ? control : innermost(inside, end)
}

/** A click with the mouse on a line of the box, where a real one lands: on what is drawn in it. */
function clickInside(target: HTMLElement): void {
  clickWithMouseOn(innermost(target, 'last'))
}

/**
 * Enter on a focused control, as a browser does it: the key goes down, and
 * unless the page keeps the key for itself, the control gets a click that no
 * mouse button made. The key comes up on whatever has the focus by then.
 */
function pressEnterOn(target: HTMLElement): void {
  target.focus()
  const down = key('keydown', 'Enter', { key: 'Enter' })
  if (!down.defaultPrevented) fireEvent.click(target, { detail: 0 })
  key('keyup', 'Enter', { key: 'Enter' })
}

/**
 * Enter held down on a focused control, as a browser does it: the key goes
 * down, repeats `repeats` times and comes up. Each time it goes down and the
 * page does not keep it for itself, the browser clicks the button that has
 * the focus at that moment. Gives back what was clicked, by name, in order.
 */
async function holdEnterOn(target: HTMLElement, repeats = 4): Promise<string[]> {
  const clicked: string[] = []
  const note = (event: Event): void => {
    clicked.push(nameOf(event.target as Element))
  }
  document.addEventListener('click', note, true)
  target.focus()
  await userEvent.setup().keyboard(`{Enter>${repeats + 1}/}`)
  document.removeEventListener('click', note, true)
  return clicked
}

/**
 * Follows the browser's file picker from now on. The app opens it with a
 * click of its own on a file field that is not shown. What it gives back
 * says how often that has happened.
 */
function watchFilePicker(): () => number {
  const clicksOfTheApp = vi.spyOn(HTMLElement.prototype, 'click')
  return () =>
    clicksOfTheApp.mock.contexts.filter(
      (clicked) => clicked instanceof HTMLInputElement && clicked.type === 'file',
    ).length
}

/** The mouse button goes down on something. The click comes when it is let go. */
function pressMouseOn(target: Element): void {
  fireEvent.pointerDown(target)
  fireEvent.mouseDown(target)
}

/** Draws the app as it opens: with the start box, waiting for the first click or key press. */
function drawApp(): void {
  render(<App />)
}

/** Draws the app and starts it with a key, which closes the start box. */
function startApp(): void {
  drawApp()
  tap('Enter')
}

function root(): HTMLElement {
  return document.querySelector('.app') as HTMLElement
}

function appScreen(): HTMLElement {
  return document.querySelector('.app__screen') as HTMLElement
}

/** True while the app waits to start: the screen behind the start box cannot be used. */
function isWaiting(): boolean {
  return appScreen().hasAttribute('inert')
}

function menu(): HTMLElement {
  return document.querySelector('.menu') as HTMLElement
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function menuButton(): HTMLElement {
  return button('Menu')
}

/** The unseen button that is the whole window around the box, while the app waits to start. */
function windowButton(): HTMLElement {
  return button(START_SENTENCE)
}

function box(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Menu' })
}

/** A line of the start box, by the name a screen reader gives it. */
function line(name: string | RegExp): HTMLElement {
  return within(box()).getByRole('button', { name })
}

/** Something drawn in the start box that is not a control: a picture, a list, the foot. */
function inBox(selector: string): Element {
  const found = box().querySelector(selector)
  if (found === null) throw new Error(`Nothing in the start box matches "${selector}".`)
  return found
}

/** The part of the start box that scrolls when the window is low: its two lists. */
function scrollingPart(): Element {
  return inBox('.start-box__body')
}

function panel(name: 'Settings' | 'Songs'): HTMLElement {
  return screen.getByRole('dialog', { name })
}

/** The box and the panels that are on the page right now, by name: "Menu", "Songs", "Settings". */
function open(): string[] {
  return screen.queryAllByRole('dialog').map((dialog) => {
    const heading = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
    return dialog.getAttribute('aria-label') ?? heading?.textContent ?? ''
  })
}

/** Opens the box with a click of the mouse on the Menu button. */
function openBox(): HTMLElement {
  clickWithMouse(menuButton())
  return box()
}

/** Opens the box the way someone without a mouse does: Enter on the Menu button. */
function openBoxWithKeyboard(): HTMLElement {
  pressEnterOn(menuButton())
  return box()
}

/** Opens Settings on one of its tabs. (The panel remembers its last tab from test to test.) */
function openSettingsOn(tab: string): HTMLElement {
  if (!open().includes('Settings')) {
    if (!open().includes('Menu')) openBox()
    clickWithMouse(line('Settings'))
  }
  clickWithMouse(within(panel('Settings')).getByRole('tab', { name: tab }))
  return panel('Settings')
}

/** The tab of Settings that is showing. */
function chosenTab(): string[] {
  return within(panel('Settings'))
    .getAllByRole('tab')
    .filter((tab) => tab.getAttribute('aria-selected') === 'true')
    .map((tab) => tab.textContent ?? '')
}

function playerLine(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Song player' })
}

function sky(): HTMLElement {
  return document.querySelector('.stage__sky') as HTMLElement
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

function pianoKey(midi: number): HTMLElement {
  return piano().querySelector(`.piano-key[data-midi="${midi}"]`) as HTMLElement
}

function hint(): string {
  return screen.getByText(HINT).className
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()]
}

function sustain(): boolean {
  return settingsStore.get().sustain
}

function mainHeadings(): (string | null)[] {
  return screen.queryAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)
}

/** What a control is called: its label for screen readers, or else its words. */
function nameOf(control: Element): string {
  return control.getAttribute('aria-label') ?? control.textContent ?? ''
}

/**
 * What the Tab key stops at, top to bottom, as a browser has it: no control
 * that is switched off, hidden, or inside a part of the page that is inert.
 */
function tabStops(): string[] {
  const controls = document.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex]',
  )
  return [...controls]
    .filter((control) => control.tabIndex >= 0 && !control.matches(':disabled'))
    .filter((control) => control.closest('[inert], [hidden]') === null)
    .map(nameOf)
}

/**
 * Follows the start box from now on. What it gives back says, in order, each
 * time the box was put on the page ("opened") or taken off it ("closed").
 */
function watchBox(): () => string[] {
  const seen: string[] = []
  const holdsBox = (node: Node): boolean =>
    node instanceof Element &&
    (node.matches('.start-box') || node.querySelector('.start-box') !== null)
  const note = (changes: MutationRecord[]): void => {
    for (const change of changes) {
      if ([...change.removedNodes].some(holdsBox)) seen.push('closed')
      if ([...change.addedNodes].some(holdsBox)) seen.push('opened')
    }
  }
  const observer = new MutationObserver(note)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    note(observer.takeRecords())
    observer.disconnect()
    return seen
  }
}

/** Files let go over the page, as after a drag from a folder of the computer. */
async function dropFiles(...files: File[]): Promise<void> {
  const dataTransfer = { types: ['Files'], files, dropEffect: 'none' }
  await act(async () => {
    fireEvent(document.body, createEvent.drop(document.body, { dataTransfer }))
    await Promise.resolve()
  })
}

/** Makes the simulated page one that can go full screen, as a browser's page can. */
function giveThePageFullScreen(): void {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true })
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  })
  document.documentElement.requestFullscreen = requestFullscreen
  document.exitFullscreen = exitFullscreen
}

/** The browser goes into or out of full screen and says so, a moment after being asked. */
function browserShows(element: Element | null): void {
  act(() => {
    fullscreenElement = element
    document.dispatchEvent(new Event('fullscreenchange'))
  })
}

/**
 * The app has started, once, and what it waited behind is gone: the window
 * button always, and the layer with it, unless the box is still open in it
 * (a line that leaves the box open started the app).
 */
function expectStarted(): void {
  expect(isWaiting()).toBe(false)
  expect(document.querySelector('.start-layer__window')).toBeNull()
  const layer = document.querySelector('.start-layer')
  const stillOpen = screen.queryByRole('dialog', { name: 'Menu' })
  expect(layer === null || layer.contains(stillOpen)).toBe(true)
  expect(screen.queryByRole('button', { name: START_SENTENCE })).toBeNull()
  expect(screen.queryByText(START_SENTENCE)).toBeNull()
  expect(audio.state.starts).toBe(1)
}

/** The app still waits to start, with the start box open. */
function expectWaiting(): void {
  expect(open()).toEqual(['Menu'])
  expect(isWaiting()).toBe(true)
  expect(windowButton()).toBeTruthy()
  expect(within(box()).getByText(START_SENTENCE)).toBeTruthy()
  expect(audio.state.starts).toBe(0)
}

describe('before the first click or key press', () => {
  it('the start box is open, in front of a screen that cannot be used yet', () => {
    drawApp()
    expectWaiting()

    // The box hangs beside the screen, not in it: it alone can be used.
    const layer = document.querySelector('.start-layer') as HTMLElement
    expect(layer.parentElement).toBe(root())
    expect([...layer.children]).toEqual([windowButton(), box()])
    expect(appScreen().contains(layer)).toBe(false)
    expect(screen.queryByText(CLOSE_SENTENCE)).toBeNull()

    // Nobody has opened it, so it has not taken the keyboard focus.
    expect(document.activeElement).toBe(document.body)
    expect(heldNotes()).toEqual([])
    expect(player.getState().status).toBe('empty')
    expect(playerLine()).toBeNull()
  })

  it('Tab reaches the window around the box, then its lines, and nothing behind them', () => {
    drawApp()
    expect(tabStops()).toEqual([START_SENTENCE, ...LINES_OF_THE_BOX])
    // The menu and the piano are drawn, but out of reach.
    expect(appScreen().contains(menuButton())).toBe(true)
    expect(appScreen().contains(piano())).toBe(true)
  })

  it('Tab does not stop at the part of the box that scrolls, only at the lines in it', () => {
    drawApp()
    // The two lists scroll when the window is low. A browser makes such a part
    // a stop of its own, which the simulated page cannot know: the box says no.
    expect(scrollingPart().getAttribute('tabindex')).toBe('-1')
    expect(scrollingPart().contains(line(FREE_PLAY))).toBe(true)
    expect(scrollingPart().contains(line('All songs…'))).toBe(true)

    // The same in the box that the Menu button opens.
    tap('Enter')
    openBox()
    expect(scrollingPart().getAttribute('tabindex')).toBe('-1')
    expect(scrollingPart().contains(line(FREE_PLAY))).toBe(true)
  })

  it('a click on the window around the box starts the app and closes the box, nothing else', () => {
    drawApp()
    const before = settingsStore.get()
    clickWithMouse(windowButton())

    expectStarted()
    expect(open()).toEqual([])
    expect(heldNotes()).toEqual([])
    expect(audio.state.notesOn).toEqual([])
    expect(settingsStore.get()).toBe(before)
    expect(playerLine()).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('a press of the mouse that is not yet a click starts nothing', () => {
    drawApp()
    pressMouseOn(windowButton())
    pressMouseOn(box())
    pressMouseOn(line(FREE_PLAY))
    expectWaiting()
  })

  it.each(['KeyA', 'Space', 'Escape', 'ArrowDown', 'Backspace', 'Enter', 'NumpadEnter'])(
    'the key %s starts the app and closes the box, and does nothing else',
    (code) => {
      drawApp()
      const before = settingsStore.get()
      expect(key('keydown', code).defaultPrevented).toBe(true)
      expectStarted()
      expect(open()).toEqual([])

      // However long it is held: no note, no sustain, nothing opened.
      for (let repeat = 0; repeat < 3; repeat++) key('keydown', code, { repeat: true })
      key('keyup', code)
      expect(heldNotes()).toEqual([])
      expect(audio.state.notesOn).toEqual([])
      expect(settingsStore.get()).toBe(before)
      expect(open()).toEqual([])
      expect(audio.state.starts).toBe(1)

      // From the next press on, the keyboard is the piano's.
      key('keydown', 'KeyA')
      expect(heldNotes()).toEqual([60])
    },
  )

  it('a function key starts the app too, and is left to the browser (F5 reloads the page)', () => {
    drawApp()
    expect(key('keydown', 'F5', { key: 'F5' }).defaultPrevented).toBe(false)
    expectStarted()
    expect(open()).toEqual([])
  })

  it('Tab does not start the app: it is left to the browser, to move through the box', () => {
    drawApp()
    const tabIsLeftAlone = (): boolean => {
      const down = key('keydown', 'Tab', { key: 'Tab' })
      const up = key('keyup', 'Tab', { key: 'Tab' })
      return !down.defaultPrevented && !up.defaultPrevented
    }

    expect(tabIsLeftAlone()).toBe(true)
    for (const stop of [windowButton(), line(FREE_PLAY), line(PLAY_TWINKLE), line('About')]) {
      stop.focus()
      expect(tabIsLeftAlone()).toBe(true)
      // The app has not moved the focus either: where it goes next is the browser's business.
      expect(document.activeElement).toBe(stop)
    }
    expectWaiting()
    expect(heldNotes()).toEqual([])
  })

  it('Shift+Tab goes back through the box, and does not start the app either', () => {
    drawApp()
    line('Settings').focus()

    // Shift goes down first, by itself, and stays down while Tab is pressed.
    key('keydown', 'ShiftLeft', { key: 'Shift', shiftKey: true })
    expect(open()).toEqual(['Menu'])
    expect(isWaiting()).toBe(true)
    const tab = key('keydown', 'Tab', { key: 'Tab', shiftKey: true })
    key('keyup', 'Tab', { key: 'Tab', shiftKey: true })
    key('keyup', 'ShiftLeft', { key: 'Shift' })

    expect(tab.defaultPrevented).toBe(false)
    expectWaiting()
    expect(document.activeElement).toBe(line('Settings'))
  })

  it.each(['Enter', 'NumpadEnter'])(
    '%s on a focused line of the box is left to that line, whose click starts the app',
    (code) => {
      drawApp()
      line(FREE_PLAY).focus()
      expect(key('keydown', code, { key: 'Enter' }).defaultPrevented).toBe(false)
      // The key itself starts nothing. The browser now clicks the line.
      expectWaiting()

      fireEvent.click(line(FREE_PLAY), { detail: 0 })
      key('keyup', code, { key: 'Enter' })
      expectStarted()
      expect(open()).toEqual([])
      expect(heldNotes()).toEqual([])
    },
  )

  it.each(['Space', 'KeyA', 'Escape'])(
    'the key %s with a line of the box focused starts the app, and does not press the line',
    (code) => {
      drawApp()
      line('Settings').focus()
      expect(key('keydown', code).defaultPrevented).toBe(true)
      key('keyup', code)

      expectStarted()
      expect(open()).toEqual([])
      expect(sustain()).toBe(false)
      expect(heldNotes()).toEqual([])
      // The line is gone, and the Menu button could not take the focus yet.
      expect(document.activeElement).toBe(document.body)
    },
  )

  it('Enter on the window around the box starts the app, as any key does', () => {
    drawApp()
    windowButton().focus()
    expect(key('keydown', 'Enter', { key: 'Enter' }).defaultPrevented).toBe(true)
    key('keyup', 'Enter', { key: 'Enter' })
    expectStarted()
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(document.body)
  })

  it('does not start at Ctrl, Alt or the Windows key with a letter: those are shortcuts', () => {
    drawApp()
    key('keydown', 'KeyL', { ctrlKey: true })
    key('keydown', 'KeyD', { altKey: true })
    key('keydown', 'KeyA', { metaKey: true })
    expectWaiting()
  })

  // The whole box starts the app, not only its lines: a click on the words
  // that say "click" must not be the one place where a click does nothing.
  it.each([
    ['the name of the app', () => screen.getByRole('heading', { level: 1 })],
    ['the picture behind the name', () => inBox('.start-box__picture')],
    ['a falling note of that picture', () => inBox('.start-box__picture rect')],
    ['the words under the name', () => within(box()).getByText(TAGLINE)],
    ['the heading "Play"', () => within(box()).getByRole('heading', { name: 'Play' })],
    ['the heading "Songs"', () => within(box()).getByRole('heading', { name: 'Songs' })],
    ['the sentence that says to click', () => within(box()).getByText(START_SENTENCE)],
    ['the gap between two lines', () => inBox('.start-box__list')],
    ['the room between the two columns', () => inBox('.start-box__columns')],
    ['the foot of the box, beside its lines', () => inBox('.start-box__foot')],
    ['the box itself, at its edge', () => box()],
    ['the picture on "Practice", which is coming', () => innermost(line(/^Practice/), 'first')],
    ['the words "The song waits for you"', () => innermost(line(/^Practice/), 'last')],
    ['the "Soon" on "Real-time"', () => within(line(/^Real-time/)).getByText('Soon')],
  ])('a click on %s starts the app once, and the box stays open', (_where, find) => {
    drawApp()
    const before = settingsStore.get()
    const theBox = box()
    const place = find()
    expect(theBox.contains(place)).toBe(true)
    clickWithMouseOn(place)

    expectStarted()
    // It is the very same box, where it hung: only the window around it is no
    // longer a button, and the sentence now says how to close it.
    expect(open()).toEqual(['Menu'])
    expect(box()).toBe(theBox)
    expect(document.querySelector('.start-layer')?.contains(theBox)).toBe(true)
    expect(within(theBox).getByText(CLOSE_SENTENCE)).toBeTruthy()
    expect(menuButton().getAttribute('aria-controls')).toBe(theBox.id)

    // The click chose nothing and played nothing.
    expect(line(FREE_PLAY).getAttribute('aria-pressed')).toBe('true')
    expect(heldNotes()).toEqual([])
    expect(audio.state.notesOn).toEqual([])
    expect(settingsStore.get()).toBe(before)
    expect(playerLine()).toBeNull()
    // No line was left with the keyboard focus, to show a ring at the next note played.
    expect(within(theBox).getAllByRole('button')).not.toContain(document.activeElement)

    // A second click in the same place starts nothing again, and closes nothing.
    clickWithMouseOn(place)
    expect(open()).toEqual(['Menu'])
    expect(box()).toBe(theBox)
    expect(audio.state.starts).toBe(1)
  })

  // A real click on a line lands on what is drawn inside it, almost never on the line's own edge.
  it.each([
    [
      'the picture on "Free Play"',
      'the box closes',
      () => innermost(line(FREE_PLAY), 'first'),
      { open: [], song: 'empty', screenFilled: 0 },
    ],
    [
      'the words "Play anything you like"',
      'the box closes',
      () => innermost(line(FREE_PLAY), 'last'),
      { open: [], song: 'empty', screenFilled: 0 },
    ],
    [
      'the title of a song',
      'the box closes and the song plays',
      () => within(line(PLAY_TWINKLE)).getByText('Twinkle, Twinkle, Little Star'),
      { open: [], song: 'playing', screenFilled: 0 },
    ],
    [
      'the length of a song',
      'the box closes and the song plays',
      () => innermost(line(PLAY_TWINKLE), 'last'),
      { open: [], song: 'playing', screenFilled: 0 },
    ],
    [
      'the picture on "All songs…"',
      'the Songs panel takes the place of the box',
      () => innermost(line('All songs…'), 'first'),
      { open: ['Songs'], song: 'empty', screenFilled: 0 },
    ],
    [
      'the picture on "Settings"',
      'the Settings panel takes the place of the box',
      () => innermost(line('Settings'), 'first'),
      { open: ['Settings'], song: 'empty', screenFilled: 0 },
    ],
    [
      'the picture on "Full screen"',
      'the screen is filled and the box stays open',
      () => innermost(line('Full screen'), 'first'),
      { open: ['Menu'], song: 'empty', screenFilled: 1 },
    ],
  ])('a click on %s starts the app once: %s', (_where, _what, find, after) => {
    giveThePageFullScreen()
    drawApp()
    const place = find()
    // Not the line itself: something inside it.
    expect(place.closest('button')).not.toBeNull()
    expect(place.closest('button')).not.toBe(place)
    clickWithMouseOn(place)

    expectStarted()
    expect(open()).toEqual(after.open)
    expect(player.getState().status).toBe(after.song)
    expect(requestFullscreen).toHaveBeenCalledTimes(after.screenFilled)
    expect(heldNotes()).toEqual([])
  })

  it.each([
    ['a press of the mouse on the sky', () => pressMouseOn(sky())],
    ['a key of the piano', () => tap('KeyA')],
    ['Escape', () => tap('Escape')],
    ['a click on the Menu button', () => clickWithMouse(menuButton())],
    ['a click on "Free Play"', () => clickWithMouse(line(FREE_PLAY))],
  ])('the box that a click on its sentence left open closes at %s', (_what, close) => {
    drawApp()
    clickWithMouseOn(within(box()).getByText(START_SENTENCE))
    expect(open()).toEqual(['Menu'])

    close()
    expect(open()).toEqual([])
    expect(document.querySelector('.start-layer')).toBeNull()
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')

    // Opened again, it is put between the menu and the piano: the layer was for the start.
    openBox()
    expect(document.querySelector('.start-layer')).toBeNull()
    expect(document.querySelector('.app__panels')?.contains(box())).toBe(true)
    expect(audio.state.starts).toBe(1)
  })

  it('a way to play that is coming starts the app as any line does, and the box stays open', () => {
    drawApp()
    clickWithMouse(line(/^Practice/))
    expectStarted()
    expect(open()).toEqual(['Menu'])
    // Nothing was chosen: "Free Play" is still the way to play that is on.
    expect(line(FREE_PLAY).getAttribute('aria-pressed')).toBe('true')
    expect(line(/^Practice/).getAttribute('aria-pressed')).not.toBe('true')

    clickWithMouse(line(/^Real-time/))
    expect(open()).toEqual(['Menu'])
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([])

    // The box it left open closes like any other: at a press of the mouse outside it.
    pressMouseOn(line(/^Practice/))
    pressMouseOn(menuButton())
    expect(open()).toEqual(['Menu'])
    pressMouseOn(sky())
    expect(open()).toEqual([])
    expect(document.querySelector('.start-layer')).toBeNull()
  })

  it('a file dropped on the page starts the app, closes the box and opens Songs', async () => {
    drawApp()
    await dropFiles(songFile('Early.mid'))
    await screen.findByText('"Early" was added.')

    expect(isWaiting()).toBe(false)
    expect(document.querySelector('.start-layer')).toBeNull()
    expect(open()).toEqual(['Songs'])
    // A drop is not a click or a key press: the sound waits for one of those.
    expect(audio.state.starts).toBe(0)
    key('keydown', 'KeyA')
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([60])
  })

  it('after a file was dropped first, the Menu button opens the box under the menu', async () => {
    drawApp()
    await dropFiles(songFile('Early.mid'))
    await screen.findByText('"Early" was added.')

    // The drop closed the box, not a click on it. It must not come back over the whole window.
    openBox()
    expect(open()).toEqual(['Menu'])
    expect(document.querySelector('.start-layer')).toBeNull()
    expect([...(document.querySelector('.app__panels')?.children ?? [])]).toEqual([box()])
    expect(within(box()).getByText(CLOSE_SENTENCE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: START_SENTENCE })).toBeNull()
    // That click on "Menu" was the first click of all: the sound starts with it.
    expect(audio.state.starts).toBe(1)
  })
})

describe.each([
  ['clicked with the mouse', clickWithMouse],
  ['clicked on what is drawn inside it', clickInside],
  ['pressed with Enter', pressEnterOn],
])('a line of the box, %s as the very first thing', (_how, choose) => {
  it('"Free Play" starts the app and closes the box', () => {
    drawApp()
    choose(line(FREE_PLAY))

    expectStarted()
    expect(open()).toEqual([])
    expect(playerLine()).toBeNull()
    expect(heldNotes()).toEqual([])
    // The Menu button could not be used yet when the line went away: the focus is nowhere.
    expect(document.activeElement).toBe(document.body)

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('a song starts the app and plays, with the player line in the menu', () => {
    drawApp()
    choose(line(PLAY_TWINKLE))

    expectStarted()
    expect(open()).toEqual([])
    expect(player.getState()).toMatchObject({ status: 'playing', songId: TWINKLE })
    expect(menu().contains(playerLine())).toBe(true)
    expect(document.activeElement).toBe(document.body)
  })

  it('"All songs…" starts the app and opens the Songs panel in place of the box', () => {
    drawApp()
    choose(line('All songs…'))

    expectStarted()
    expect(open()).toEqual(['Songs'])
    expect(player.getState().status).toBe('empty')
    // No control had the focus when the panel opened: it holds it, and Tab goes on inside it.
    expect(document.activeElement).toBe(panel('Songs'))
  })

  it('"Settings" starts the app and opens the Settings panel in place of the box', () => {
    drawApp()
    choose(line('Settings'))

    expectStarted()
    expect(open()).toEqual(['Settings'])
    expect(document.activeElement).toBe(panel('Settings'))
  })

  it('"About" starts the app and opens Settings on its About tab', () => {
    drawApp()
    choose(line('About'))

    expectStarted()
    expect(open()).toEqual(['Settings'])
    expect(chosenTab()).toEqual(['About'])
  })

  it('"Full screen" starts the app and fills the screen, and the box stays open', () => {
    giveThePageFullScreen()
    drawApp()
    const before = box()
    choose(line('Full screen'))

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expectStarted()
    // It is the very same box, where it hung: only the window around it is no
    // longer a button. It is what the Menu button opens and closes from now on.
    expect(open()).toEqual(['Menu'])
    expect(box()).toBe(before)
    expect(document.querySelector('.start-layer')?.contains(box())).toBe(true)
    expect(within(box()).getByText(CLOSE_SENTENCE)).toBeTruthy()
    expect(menuButton().getAttribute('aria-controls')).toBe(box().id)

    browserShows(document.documentElement)
    expect(line('Leave full screen')).toBeTruthy()
    expect(open()).toEqual(['Menu'])
    expect(audio.state.starts).toBe(1)
    expect(exitFullscreen).not.toHaveBeenCalled()

    // It closes as it does whenever it was opened with the Menu button.
    tap('KeyA')
    expect(open()).toEqual([])
    expect(document.querySelector('.start-layer')).toBeNull()

    // Opened again, it is put between the menu and the piano, like a panel.
    clickWithMouse(menuButton())
    expect(document.querySelector('.start-layer')).toBeNull()
    expect(document.querySelector('.app__panels')?.contains(box())).toBe(true)
    expect(heldNotes()).toEqual([])
    expect(audio.state.notesOn).toEqual([60])
  })

  it('"Full screen" leaves a box that a press of the mouse outside it closes', () => {
    giveThePageFullScreen()
    drawApp()
    choose(line('Full screen'))
    expect(open()).toEqual(['Menu'])

    // While the app waited, no press closed anything. Now one does, unless it
    // lands on the box or on the Menu button, which closes the box itself.
    pressMouseOn(box())
    pressMouseOn(line('Full screen'))
    pressMouseOn(menuButton())
    expect(open()).toEqual(['Menu'])

    pressMouseOn(sky())
    expect(open()).toEqual([])
    expect(document.querySelector('.start-layer')).toBeNull()
    // The click that ends that press opens nothing, and the app has started once.
    clickWithMouse(sky())
    expect(open()).toEqual([])
    expect(audio.state.starts).toBe(1)
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })
})

describe('the Menu button, after the start', () => {
  it('says that the box is closed, and points at nothing', () => {
    startApp()
    expect(open()).toEqual([])
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(menuButton().hasAttribute('aria-controls')).toBe(false)
    expect(menuButton().textContent).toBe('Menu')
    // It is where the menu starts: the first control of the top bar.
    expect(menu().querySelector('button, input')).toBe(menuButton())
  })

  it('opens the box between the menu and the piano, and closes it again', () => {
    startApp()
    const opened = openBox()
    expect(open()).toEqual(['Menu'])
    // Where the app puts its panels, not in a layer over the whole window.
    const room = document.querySelector('.app__panels') as HTMLElement
    expect([...room.children]).toEqual([opened])
    expect(document.querySelector('.start-layer')).toBeNull()
    expect(screen.queryByRole('button', { name: START_SENTENCE })).toBeNull()
    expect(within(opened).getByText(CLOSE_SENTENCE)).toBeTruthy()
    expect(isWaiting()).toBe(false)

    expect(menuButton().getAttribute('aria-expanded')).toBe('true')
    expect(menuButton().getAttribute('aria-controls')).toBe(opened.id)

    clickWithMouse(menuButton())
    expect(open()).toEqual([])
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(menuButton().hasAttribute('aria-controls')).toBe(false)
    // Opening and closing it is all that happened.
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([])
  })

  it('opens the same box as at the start: the same lines in the same order', () => {
    drawApp()
    const linesAtTheStart = within(box()).getAllByRole('button').map(nameOf)
    tap('Enter')

    openBox()
    expect(within(box()).getAllByRole('button').map(nameOf)).toEqual(linesAtTheStart)
    expect(line(FREE_PLAY).getAttribute('aria-pressed')).toBe('true')
  })

  it.each(['Songs', 'Settings'] as const)('closes the %s panel when it opens the box', (name) => {
    startApp()
    openBox()
    clickWithMouse(line(name === 'Songs' ? 'All songs…' : 'Settings'))
    expect(open()).toEqual([name])

    openBox()
    expect(open()).toEqual(['Menu'])
    clickWithMouse(menuButton())
    // The panel does not come back when the box closes.
    expect(open()).toEqual([])
  })

  it('ends the choosing of keys when it closes Settings on its Keys tab', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    expect(piano().classList.contains('piano--editing')).toBe(true)

    openBox()
    expect(open()).toEqual(['Menu'])
    expect(piano().classList.contains('piano--editing')).toBe(false)
    expect(piano().querySelector('.is-selected')).toBeNull()
    // No piano key is waiting behind the box: a key of the piano plays, and closes the box.
    key('keydown', 'KeyA')
    expect(open()).toEqual([])
    expect(heldNotes()).toEqual([60])
    expect(settingsStore.get().bindings.KeyA).toBe(12)
  })

  it('does not blink when it is pressed with the mouse: one press opens, the next closes', () => {
    startApp()
    const changes = watchBox()

    pressMouseOn(menuButton())
    expect(open()).toEqual([])
    clickWithMouse(menuButton())
    expect(open()).toEqual(['Menu'])

    // The press comes before the click. Were it to close the box, the click would open it again.
    pressMouseOn(menuButton())
    expect(open()).toEqual(['Menu'])
    clickWithMouse(menuButton())
    expect(open()).toEqual([])

    // The same when the press lands on the picture inside the button.
    pressMouseOn(menuButton().querySelector('svg') as SVGElement)
    clickWithMouse(menuButton())
    pressMouseOn(menuButton().querySelector('svg') as SVGElement)
    expect(open()).toEqual(['Menu'])
    clickWithMouse(menuButton())
    expect(changes()).toEqual(['opened', 'closed', 'opened', 'closed'])
  })

  it('opens the box once when Enter is held on it: it does not blink open and closed', async () => {
    const user = userEvent.setup()
    startApp()
    menuButton().focus()
    const changes = watchBox()

    // The key repeats while it is down. The focus is on "Free Play" by then.
    await user.keyboard('{Enter>4/}')
    expect(changes()).toEqual(['opened'])
    expect(open()).toEqual(['Menu'])
  })

  it('closes the box once when Enter is held on it: the box does not pop open again', async () => {
    startApp()
    openBoxWithKeyboard()
    const changes = watchBox()

    // The focus is taken back from "Free Play" to the Menu button (Shift+Tab), and
    // stays there when the box closes: the repeats of the key land on the button.
    expect(await holdEnterOn(menuButton())).toEqual(['Menu'])
    expect(changes()).toEqual(['closed'])
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())

    // Let go and pressed again, Enter is a new press: the box opens.
    pressEnterOn(menuButton())
    expect(open()).toEqual(['Menu'])
  })
})

describe('the lines of the box, after the start', () => {
  it('"Free Play" closes the box, and leaves a song that is loaded where it is', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    openBox()
    clickWithMouse(line(FREE_PLAY))

    expect(open()).toEqual([])
    expect(player.getState()).toMatchObject({ status: 'playing', songId: TWINKLE })
    expect(playerLine()).not.toBeNull()
  })

  it('a song closes the box and plays, and the player line appears in the menu', () => {
    startApp()
    expect(playerLine()).toBeNull()
    openBox()
    clickWithMouse(line('Play Ode to Joy'))

    expect(open()).toEqual([])
    expect(player.getState()).toMatchObject({
      status: 'playing',
      songId: 'starter:ode-to-joy',
      title: 'Ode to Joy',
    })
    const controls = playerLine() as HTMLElement
    expect(document.querySelector('.top-bar')?.contains(controls)).toBe(true)
    expect(within(controls).getByText('Ode to Joy')).toBeTruthy()
    expect(within(controls).getByRole('button', { name: 'Pause' })).toBeTruthy()
  })

  it("a song of the player's own is offered first, and plays the same way", async () => {
    const tune = await addSong('Tune.mid')
    startApp()
    openBox()
    clickWithMouse(line('Play Tune'))

    expect(open()).toEqual([])
    expect(player.getState()).toMatchObject({ status: 'playing', songId: tune.id, title: 'Tune' })
  })

  it('a song takes the place of the one that was loaded', () => {
    startApp()
    openBox()
    clickWithMouse(line(PLAY_TWINKLE))
    openBox()
    clickWithMouse(line('Play Mary Had a Little Lamb'))

    expect(player.getState()).toMatchObject({
      status: 'playing',
      songId: 'starter:mary-had-a-little-lamb',
    })
    expect(screen.getAllByRole('region', { name: 'Song player' })).toHaveLength(1)
  })

  it('a song that cannot be read opens the Songs panel, which says why', async () => {
    const tune = await addSong('Tune.mid')
    window.localStorage.removeItem(`pianoapp.song.v1.${tune.id}`)
    startApp()
    openBox()
    clickWithMouse(line('Play Tune'))

    expect(open()).toEqual(['Songs'])
    expect(within(panel('Songs')).getByRole('status').textContent).toBe(UNREADABLE_SONG_MESSAGE)
    expect(player.getState().status).toBe('empty')
    expect(playerLine()).toBeNull()
  })

  it('"All songs…" closes the box and opens the Songs panel', () => {
    startApp()
    openBox()
    clickWithMouse(line('All songs…'))
    expect(open()).toEqual(['Songs'])
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
  })

  it('"Settings" closes the box and opens Settings on the tab it was last on', () => {
    startApp()
    openSettingsOn('Piano')
    clickWithMouse(button('Close Settings'))

    openBox()
    clickWithMouse(line('Settings'))
    expect(open()).toEqual(['Settings'])
    expect(chosenTab()).toEqual(['Piano'])
  })

  it('"About" closes the box and opens Settings on its About tab, whichever was last', () => {
    startApp()
    openSettingsOn('Sound')
    clickWithMouse(button('Close Settings'))

    openBox()
    clickWithMouse(line('About'))
    expect(open()).toEqual(['Settings'])
    expect(chosenTab()).toEqual(['About'])
    expect(within(panel('Settings')).getByRole('heading', { name: APP_NAME })).toBeTruthy()

    // About is then the tab the panel was last on.
    clickWithMouse(button('Close Settings'))
    openBox()
    clickWithMouse(line('Settings'))
    expect(chosenTab()).toEqual(['About'])
  })

  it('"Full screen" fills the screen and leaves the box open, and leaves it the same way', () => {
    giveThePageFullScreen()
    startApp()
    openBox()
    clickWithMouse(line('Full screen'))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(open()).toEqual(['Menu'])

    browserShows(document.documentElement)
    expect(open()).toEqual(['Menu'])
    clickWithMouse(line('Leave full screen'))
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
    browserShows(null)
    expect(open()).toEqual(['Menu'])
    expect(line('Full screen')).toBeTruthy()
  })

  it('has no "Full screen" line where the browser cannot do that', () => {
    startApp()
    openBox()
    expect(within(box()).queryByRole('button', { name: /full screen/i })).toBeNull()
  })

  it('the ways to play that are coming do nothing: the box stays as it is', () => {
    startApp()
    openBox()
    clickWithMouse(line(/^Practice/))
    clickWithMouse(line(/^Real-time/))
    expect(open()).toEqual(['Menu'])
    expect(line(FREE_PLAY).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the box, Songs and Settings', () => {
  it('are never open two at a time, whatever is pressed and in whatever order', async () => {
    drawApp()
    expect(open()).toEqual(['Menu'])
    clickWithMouse(line('Settings'))
    expect(open()).toEqual(['Settings'])

    openBox()
    expect(open()).toEqual(['Menu'])
    clickWithMouse(line('All songs…'))
    expect(open()).toEqual(['Songs'])
    clickWithMouse(within(panel('Songs')).getByRole('button', { name: PLAY_TWINKLE }))
    expect(open()).toEqual([])

    openBox()
    clickWithMouse(line('About'))
    expect(open()).toEqual(['Settings'])
    openBox()
    expect(open()).toEqual(['Menu'])
    clickWithMouse(line('Play Ode to Joy'))
    expect(open()).toEqual([])

    openBox()
    await dropFiles(songFile('Dropped.mid'))
    await screen.findByText('"Dropped" was added.')
    expect(open()).toEqual(['Songs'])
    openBox()
    expect(open()).toEqual(['Menu'])
    tap('Escape')
    expect(open()).toEqual([])
  })

  it('a file dropped while the box is open closes it and opens Songs', async () => {
    startApp()
    openBox()
    await dropFiles(songFile('Dropped.mid'))
    await screen.findByText('"Dropped" was added.')

    expect(open()).toEqual(['Songs'])
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(within(panel('Songs')).getByRole('status').textContent).toBe('"Dropped" was added.')
  })
})

describe('Escape, with the box open', () => {
  /** What Escape can take back, as it stands on the page right now. */
  function canBeTakenBack(): string[] {
    const found: string[] = []
    if (piano().querySelector('.is-selected')) found.push('a piano key waiting')
    if (screen.queryByRole('group', { name: 'Song options' })) found.push('the song options')
    for (const name of open()) found.push(name === 'Menu' ? 'the box' : `the ${name} panel`)
    if (menu().contains(document.activeElement)) found.push('the focus in the menu')
    return found
  }

  /** The key stays down and repeats. True when every repeat was kept from the browser. */
  function holdEscape(): boolean {
    const kept: boolean[] = []
    for (let repeat = 0; repeat < 4; repeat++) {
      kept.push(key('keydown', 'Escape', { repeat: true }).defaultPrevented)
    }
    return kept.every(Boolean)
  }

  /** A song loaded, the box open, and the song options opened with Enter. */
  function openBoxAndSongOptions(): void {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    openBoxWithKeyboard()
    pressEnterOn(button('Song options'))
    expect(canBeTakenBack()).toEqual(['the song options', 'the box', 'the focus in the menu'])
  }

  it('closes the box, and is then left to the browser', () => {
    startApp()
    openBox()
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(open()).toEqual([])
    key('keyup', 'Escape')

    // Nothing is left to take back: the key is the browser's (it leaves full screen with it).
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
  })

  it('never plays a note, changes a setting or stops a song', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    const before = settingsStore.get()
    openBox()
    tap('Escape')
    tap('Escape')

    expect(heldNotes()).toEqual([])
    expect(settingsStore.get()).toBe(before)
    expect(player.getState()).toMatchObject({ status: 'playing', songId: TWINKLE })
  })

  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
    'with %o is a shortcut of the browser or the system: the box stays',
    (modifier) => {
      startApp()
      openBox()
      expect(key('keydown', 'Escape', modifier).defaultPrevented).toBe(false)
      expect(open()).toEqual(['Menu'])
    },
  )

  it('takes back one thing at each press: the song options, the box, the focus in the menu', () => {
    openBoxAndSongOptions()

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(canBeTakenBack()).toEqual(['the box', 'the focus in the menu'])
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(canBeTakenBack()).toEqual(['the focus in the menu'])
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(canBeTakenBack()).toEqual([])
    expect(document.activeElement).toBe(document.body)
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
    // Escape is not a button of the player: the song is still there.
    expect(playerLine()).not.toBeNull()
  })

  it('held down, never takes back a second thing, at whichever step it is held', () => {
    openBoxAndSongOptions()

    key('keydown', 'Escape')
    expect(holdEscape()).toBe(true)
    expect(canBeTakenBack()).toEqual(['the box', 'the focus in the menu'])
    key('keyup', 'Escape')

    key('keydown', 'Escape')
    expect(holdEscape()).toBe(true)
    expect(canBeTakenBack()).toEqual(['the focus in the menu'])
    key('keyup', 'Escape')

    key('keydown', 'Escape')
    // Nothing is left for a new press to take back: the repeats are the browser's.
    expect(holdEscape()).toBe(false)
    expect(canBeTakenBack()).toEqual([])
  })

  it('held down after it closed the box does not close the menu too', () => {
    startApp()
    openBoxWithKeyboard()
    key('keydown', 'Escape')
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())

    expect(holdEscape()).toBe(true)
    expect(document.activeElement).toBe(menuButton())
    key('keyup', 'Escape')
    tap('Escape')
    expect(document.activeElement).toBe(document.body)
  })

  it('closes a panel that was opened from the box, and the box does not come back', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    // With the mouse: while a piano key waits, Enter would be taken for its computer key.
    clickWithMouse(button('Song options'))
    expect(canBeTakenBack()).toEqual([
      'a piano key waiting',
      'the song options',
      'the Settings panel',
    ])

    tap('Escape')
    expect(canBeTakenBack()).toEqual(['the song options', 'the Settings panel'])
    tap('Escape')
    expect(canBeTakenBack()).toEqual(['the Settings panel'])
    tap('Escape')
    expect(canBeTakenBack()).toEqual([])
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
  })
})

describe('Enter held down a little too long', () => {
  // A key that is held sends its press again and again, and a browser clicks
  // the focused button at each of them. The press must do its one thing all
  // the same: what it opens or closes moves the focus to another button.
  describe.each([
    ['as the very first thing', drawApp],
    [
      'in the box that Enter on the Menu button opened',
      (): void => {
        startApp()
        openBoxWithKeyboard()
      },
    ],
  ])('on a line of the box, %s', (_when, showBox) => {
    it.each([
      ['"Free Play"', FREE_PLAY, { open: [], box: ['closed'], screenFilled: 0 }],
      ['a song', PLAY_TWINKLE, { open: [], box: ['closed'], screenFilled: 0 }],
      ['"All songs…"', 'All songs…', { open: ['Songs'], box: ['closed'], screenFilled: 0 }],
      ['"Settings"', 'Settings', { open: ['Settings'], box: ['closed'], screenFilled: 0 }],
      ['"About"', 'About', { open: ['Settings'], box: ['closed'], screenFilled: 0 }],
      ['"Full screen"', 'Full screen', { open: ['Menu'], box: [], screenFilled: 1 }],
    ])('presses %s once, and nothing after it', async (_which, name, after) => {
      giveThePageFullScreen()
      const filePickerOpened = watchFilePicker()
      showBox()
      const pressed = nameOf(line(name))
      const changes = watchBox()

      expect(await holdEnterOn(line(name))).toEqual([pressed])
      expect(changes()).toEqual(after.box)
      expect(open()).toEqual(after.open)
      expect(isWaiting()).toBe(false)
      expect(audio.state.starts).toBe(1)
      expect(requestFullscreen).toHaveBeenCalledTimes(after.screenFilled)
      expect(filePickerOpened()).toBe(0)
    })
  })

  it('on "All songs…" does not go on to press "Import a MIDI file" in the panel', async () => {
    const filePickerOpened = watchFilePicker()
    startApp()
    openBoxWithKeyboard()
    await holdEnterOn(line('All songs…'))

    // The focus went on to the first control of the panel. The key that is
    // still down is not for it: the browser's file picker stays closed.
    expect(open()).toEqual(['Songs'])
    expect(document.activeElement).toBe(button('Import a MIDI file'))
    expect(filePickerOpened()).toBe(0)

    // Let go and pressed again, Enter does press it: the file picker opens, once.
    pressEnterOn(button('Import a MIDI file'))
    expect(filePickerOpened()).toBe(1)
  })

  it('on "All songs…" as the very first thing leaves the Songs panel alone too', async () => {
    const filePickerOpened = watchFilePicker()
    drawApp()
    expect(await holdEnterOn(line('All songs…'))).toEqual(['All songs…'])

    expectStarted()
    expect(open()).toEqual(['Songs'])
    // The Menu button could not take the focus yet: the panel holds it itself.
    expect(document.activeElement).toBe(panel('Songs'))
    expect(filePickerOpened()).toBe(0)
  })

  it('on "Full screen" as the very first thing fills the screen once: the box stays', async () => {
    giveThePageFullScreen()
    drawApp()
    const theBox = box()
    expect(await holdEnterOn(line('Full screen'))).toEqual(['Full screen'])

    expectStarted()
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(exitFullscreen).not.toHaveBeenCalled()
    expect(box()).toBe(theBox)
    expect(document.activeElement).toBe(line('Full screen'))
  })

  it.each([
    ['"Free Play"', FREE_PLAY],
    ['a song', PLAY_TWINKLE],
  ])('on %s closes the box, and the Menu button does not open it again', async (_which, name) => {
    startApp()
    openBoxWithKeyboard()
    const changes = watchBox()
    await holdEnterOn(line(name))

    expect(changes()).toEqual(['closed'])
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    [
      'the close button of the Songs panel',
      (): HTMLElement => {
        openBox()
        clickWithMouse(line('All songs…'))
        return button('Close Songs')
      },
    ],
    [
      '"Play" in the Songs panel',
      (): HTMLElement => {
        openBox()
        clickWithMouse(line('All songs…'))
        return within(panel('Songs')).getByRole('button', { name: PLAY_TWINKLE })
      },
    ],
    [
      '"Stop" on the player line',
      (): HTMLElement => {
        act(() => {
          playSong(TWINKLE)
        })
        return button('Stop')
      },
    ],
  ])('on %s opens no box from the Menu button, where the focus goes', async (_what, find) => {
    startApp()
    const control = find()
    const pressed = nameOf(control)
    const changes = watchBox()

    expect(await holdEnterOn(control)).toEqual([pressed])
    expect(document.activeElement).toBe(menuButton())
    expect(changes()).toEqual([])
    expect(open()).toEqual([])
  })

  it('still repeats on a control that keeps the focus: a stepper goes on counting', async () => {
    startApp()
    openSettingsOn('Sound')
    const up = within(panel('Settings')).getByRole('button', { name: 'Transpose up' })
    expect(settingsStore.get().transpose).toBe(0)

    // The first press and four repeats: five steps. Holding the key is how a stepper is used.
    expect(await holdEnterOn(up, 4)).toEqual(Array<string>(5).fill('Transpose up'))
    expect(settingsStore.get().transpose).toBe(5)
    expect(document.activeElement).toBe(up)
    expect(open()).toEqual(['Settings'])
  })
})

describe('playing the piano while the box is open', () => {
  it('a key of the piano closes the box and plays its note', () => {
    startApp()
    openBox()
    expect(key('keydown', 'KeyA').defaultPrevented).toBe(true)
    expect(open()).toEqual([])
    expect(heldNotes()).toEqual([60])
    expect(audio.state.notesOn).toEqual([60])

    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
    expect(open()).toEqual([])
  })

  it('a key held since before the box opened does not close it: only a new press does', () => {
    startApp()
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    openBox()

    // The key is still down and repeats. That is no new press, and it plays no new note.
    for (let repeat = 0; repeat < 3; repeat++) key('keydown', 'KeyA', { repeat: true })
    expect(open()).toEqual(['Menu'])
    expect(audio.state.notesOn).toEqual([60])

    key('keyup', 'KeyA')
    expect(open()).toEqual(['Menu'])
    key('keydown', 'KeyA')
    expect(open()).toEqual([])
    expect(audio.state.notesOn).toEqual([60, 60])
  })

  it('Space switches sustain and leaves the box open', () => {
    startApp()
    openBox()
    const down = key('keydown', 'Space', { key: ' ' })
    const up = key('keyup', 'Space', { key: ' ' })
    expect([down.defaultPrevented, up.defaultPrevented]).toEqual([true, true])
    expect(sustain()).toBe(true)
    expect(open()).toEqual(['Menu'])

    // Also with a line focused, which Space does not press.
    line('All songs…').focus()
    tap('Space', { key: ' ' })
    expect(sustain()).toBe(false)
    expect(open()).toEqual(['Menu'])
  })

  it.each(['KeyZ', 'Digit1', 'ArrowDown', 'Backspace', 'ShiftLeft', 'Tab', 'Enter', 'F5'])(
    'the key %s, which plays no note, leaves the box open',
    (code) => {
      startApp()
      openBox()
      tap(code)
      expect(open()).toEqual(['Menu'])
      expect(heldNotes()).toEqual([])
      expect(audio.state.notesOn).toEqual([])
    },
  )

  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
    'a key of the piano with %o is a shortcut: the box stays, and no note plays',
    (modifier) => {
      startApp()
      openBox()
      expect(key('keydown', 'KeyA', modifier).defaultPrevented).toBe(false)
      expect(open()).toEqual(['Menu'])
      expect(heldNotes()).toEqual([])
    },
  )

  it('follows the keys the player has chosen: only those that play a note close the box', () => {
    act(() => settingsStore.set({ bindings: { KeyZ: 12 } }))
    startApp()
    openBox()

    // "A" plays nothing any more.
    tap('KeyA')
    expect(open()).toEqual(['Menu'])
    expect(heldNotes()).toEqual([])

    key('keydown', 'KeyZ')
    expect(open()).toEqual([])
    expect(heldNotes()).toEqual([60])
  })

  it('a key of the piano closes the box with a song playing too, and the song plays on', () => {
    // The clock stands still, so the song stays in the silence before its first note.
    vi.useFakeTimers()
    startApp()
    openBox()
    clickWithMouse(line(PLAY_TWINKLE))
    openBox()
    expect(heldNotes()).toEqual([])

    key('keydown', 'KeyK')
    expect(open()).toEqual([])
    expect(heldNotes()).toHaveLength(1)
    expect(player.getState()).toMatchObject({ status: 'playing', songId: TWINKLE })
  })
})

describe('a press of the mouse while the box is open', () => {
  it('on the sky closes it, and the click that follows opens nothing', () => {
    startApp()
    openBox()
    pressMouseOn(sky())
    expect(open()).toEqual([])

    clickWithMouse(sky())
    expect(open()).toEqual([])
    expect(heldNotes()).toEqual([])
  })

  it('on the piano closes it, and plays the key that was pressed', () => {
    startApp()
    openBox()
    piano().getBoundingClientRect = () => ({ left: 0, top: 0, width: 2200, height: 100 }) as DOMRect
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })

    expect(open()).toEqual([])
    expect(heldNotes()).toEqual([48])
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([])
  })

  it.each([
    ['the volume slider', () => within(menu()).getByRole('slider', { name: 'Volume' })],
    ['the sustain switch', () => within(menu()).getByRole('switch', { name: 'Sustain' })],
    ['the empty part of the top bar', () => menu().querySelector('.top-bar__space') as HTMLElement],
    ['the strip under the piano', () => document.querySelector('.stage__piano') as HTMLElement],
  ])('on %s closes it', (_where, target) => {
    startApp()
    openBox()
    pressMouseOn(target())
    expect(open()).toEqual([])
  })

  it('on the player line closes it, and the control that was pressed still works', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    openBox()
    pressMouseOn(button('Pause'))
    expect(open()).toEqual([])
    clickWithMouse(button('Pause'))
    expect(player.getState().status).toBe('paused')
  })

  it('inside the box leaves it open: on a line, on its picture, between the lines', () => {
    startApp()
    openBox()
    pressMouseOn(box())
    pressMouseOn(line(FREE_PLAY))
    pressMouseOn(line(FREE_PLAY).querySelector('svg') as SVGElement)
    pressMouseOn(line(/^Practice/))
    pressMouseOn(screen.getByRole('heading', { level: 1 }))
    pressMouseOn(within(box()).getByText(CLOSE_SENTENCE))
    expect(open()).toEqual(['Menu'])
  })

  it('on a line does not close the box before the click reaches the line', () => {
    startApp()
    openBox()
    pressMouseOn(line('Settings'))
    expect(open()).toEqual(['Menu'])
    clickWithMouse(line('Settings'))
    expect(open()).toEqual(['Settings'])
  })

  it('closes nothing else: a panel stays open at a press beside it', () => {
    startApp()
    openBox()
    clickWithMouse(line('All songs…'))
    pressMouseOn(menu().querySelector('.top-bar__space') as HTMLElement)
    pressMouseOn(document.querySelector('.stage__piano') as HTMLElement)
    expect(open()).toEqual(['Songs'])
  })
})

describe('the menu at the top, the hint and the heading', () => {
  function wait(milliseconds: number): void {
    act(() => {
      vi.advanceTimersByTime(milliseconds)
    })
  }

  function menuIsHidden(): boolean {
    return menu().classList.contains('menu--hidden')
  }

  it('the menu stays, with the mouse cursor, for as long as the app waits to start', () => {
    vi.useFakeTimers()
    drawApp()
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(menuIsHidden()).toBe(false)
    expect(root().className).toBe('app')
  })

  it('the menu stays while the box is open, and hides 2.5 seconds after it has closed', () => {
    vi.useFakeTimers()
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    expect(menuIsHidden()).toBe(true)

    // The mouse moves, which shows the menu, and clicks "Menu".
    fireEvent.mouseMove(sky(), { screenX: 40, screenY: 300 })
    openBox()
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(menuIsHidden()).toBe(false)
    expect(root().className).toBe('app')

    tap('Escape')
    expect(open()).toEqual([])
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(menuIsHidden()).toBe(false)
    wait(1)
    expect(menuIsHidden()).toBe(true)
    expect(root().className).toBe('app cursor-hidden')
  })

  it('the menu hides again after a piano key closed the box', () => {
    vi.useFakeTimers()
    startApp()
    openBox()
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(menuIsHidden()).toBe(false)

    tap('KeyA')
    wait(AUTO_HIDE_DELAY_MS)
    expect(menuIsHidden()).toBe(true)
  })

  it('Tab, pressed while the menu is hidden, shows it with the focus on the Menu button', () => {
    vi.useFakeTimers()
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    expect(menuIsHidden()).toBe(true)

    expect(key('keydown', 'Tab', { key: 'Tab' }).defaultPrevented).toBe(true)
    key('keyup', 'Tab', { key: 'Tab' })
    expect(menuIsHidden()).toBe(false)
    expect(document.activeElement).toBe(menuButton())
    // From there Enter opens the box, and the menu stays for as long as it is open.
    pressEnterOn(menuButton())
    expect(document.activeElement).toBe(line(FREE_PLAY))
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(menuIsHidden()).toBe(false)
  })

  it('the hint that says how to play is not shown while the box is open', () => {
    drawApp()
    expect(hint()).toBe('stage__hint stage__hint--gone')
    clickWithMouse(windowButton())
    expect(hint()).toBe('stage__hint')

    openBox()
    expect(hint()).toBe('stage__hint stage__hint--gone')
    tap('Escape')
    expect(hint()).toBe('stage__hint')

    // The piano key that closes the box is the first note: the hint has done its work.
    openBox()
    tap('KeyA')
    expect(open()).toEqual([])
    expect(hint()).toBe('stage__hint stage__hint--gone')
  })

  it('the name of the app is the main heading while the box is open, and only then', () => {
    drawApp()
    expect(mainHeadings()).toEqual([APP_NAME])
    tap('Enter')
    expect(mainHeadings()).toEqual([])

    openBox()
    expect(mainHeadings()).toEqual([APP_NAME])
    expect(box().contains(screen.getByRole('heading', { level: 1 }))).toBe(true)

    // A panel has a heading of its own, one level down.
    clickWithMouse(line('All songs…'))
    expect(mainHeadings()).toEqual([])
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Songs')
  })
})

describe('what screen readers are told', () => {
  it('the box is a dialog called "Menu", at the start and whenever it is opened again', () => {
    drawApp()
    // The only dialog on the page: the layer it hangs in and the window around it are none.
    expect(open()).toEqual(['Menu'])
    // The Menu button behind it cannot be reached, but it already says the truth.
    expect(menuButton().getAttribute('aria-expanded')).toBe('true')
    expect(menuButton().getAttribute('aria-controls')).toBe(box().id)

    tap('Enter')
    expect(open()).toEqual([])
    openBox()
    expect(open()).toEqual(['Menu'])
    expect(menuButton().getAttribute('aria-controls')).toBe(box().id)
  })

  it('"Click or press any key to start" is read out once: as the name of the window', () => {
    drawApp()
    // The window around the box is a button called by those words. The same
    // words at the foot of the box are for the eye, or they would be read twice.
    expect(screen.getAllByRole('button', { name: START_SENTENCE })).toEqual([windowButton()])
    expect(within(box()).getByText(START_SENTENCE).getAttribute('aria-hidden')).toBe('true')
    expect(windowButton().closest('[aria-hidden="true"]')).toBeNull()
  })

  it('"Click outside or play a key to close" is read out: nothing else says it', () => {
    drawApp()
    // In the box that "Practice" left open when it started the app…
    clickWithMouse(line(/^Practice/))
    expect(within(box()).getByText(CLOSE_SENTENCE).hasAttribute('aria-hidden')).toBe(false)
    expect(screen.queryByRole('button', { name: CLOSE_SENTENCE })).toBeNull()

    // …and in the box that the Menu button opens.
    tap('Escape')
    openBox()
    expect(within(box()).getByText(CLOSE_SENTENCE).hasAttribute('aria-hidden')).toBe(false)
    expect(box().querySelector('[aria-hidden="true"]:not(svg)')).toBeNull()
  })

  it('a song of the box is called "Play" and its title, and described by its length', async () => {
    // Four notes of half a second each.
    await addSong('Tune.mid')
    drawApp()
    const [first, second] = STARTER_SONGS
    const offered = [
      { name: 'Play Tune', length: '0:02' },
      { name: `Play ${first?.title}`, length: formatDuration(first?.duration ?? 0) },
      { name: `Play ${second?.title}`, length: formatDuration(second?.duration ?? 0) },
    ]
    // The player's own song first, then the first two starter songs.
    expect(offered.map((song) => song.name)).toEqual([
      'Play Tune',
      PLAY_TWINKLE,
      'Play Mary Had a Little Lamb',
    ])

    const expectSongsDescribed = (): void => {
      for (const { name, length } of offered) {
        expect(length).toMatch(/^\d+:\d\d$/)
        // The name is "Play" and the title, nothing more: the length is told after it.
        const song = within(box()).getByRole('button', { name, description: length })
        expect(within(song).getByText(length).id).toBe(song.getAttribute('aria-describedby'))
      }
      // No other line of the box is described by anything.
      expect(box().querySelectorAll('[aria-describedby]')).toHaveLength(offered.length)
    }
    expectSongsDescribed()

    // The same in the box that the Menu button opens.
    tap('Enter')
    openBox()
    expectSongsDescribed()
  })

  it('the stage is a region called "Free Play", and the ways to play are lines of the box', () => {
    startApp()
    const stage = screen.getByRole('region', { name: 'Free Play' })
    expect(stage.contains(piano())).toBe(true)
    expect(stage.contains(sky())).toBe(true)
    // The ways to play are not tabs: nothing in the menu or on the stage is one.
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()

    openBox()
    expect(screen.getByRole('region', { name: 'Free Play' })).toBe(stage)
    expect(line(FREE_PLAY).getAttribute('aria-pressed')).toBe('true')
    for (const coming of [line(/^Practice/), line(/^Real-time/)]) {
      expect(coming.getAttribute('aria-disabled')).toBe('true')
    }
  })

  it('ids that point from one element to another all lead somewhere, whatever is open', () => {
    const dangling = (): string[] =>
      [...document.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby]')]
        .flatMap((element) =>
          ['aria-controls', 'aria-labelledby', 'aria-describedby'].flatMap(
            (name) => element.getAttribute(name)?.split(' ') ?? [],
          ),
        )
        .filter((id) => document.getElementById(id) === null)
    const repeated = (): string[] => {
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
      return ids.filter((id, index) => ids.indexOf(id) !== index)
    }

    drawApp()
    expect(dangling()).toEqual([])
    expect(repeated()).toEqual([])

    tap('Enter')
    expect(dangling()).toEqual([])
    act(() => {
      playSong(TWINKLE)
    })
    openBoxWithKeyboard()
    pressEnterOn(button('Song options'))
    expect(open()).toEqual(['Menu'])
    expect(dangling()).toEqual([])
    expect(repeated()).toEqual([])

    for (const opener of ['All songs…', 'Settings', 'About']) {
      if (!open().includes('Menu')) openBox()
      clickWithMouse(line(opener))
      expect(dangling()).toEqual([])
      expect(repeated()).toEqual([])
    }
  })
})

describe('the keyboard focus, for someone who works with the keyboard', () => {
  it('goes to "Free Play" when Enter on the Menu button opens the box', () => {
    startApp()
    openBoxWithKeyboard()
    expect(document.activeElement).toBe(line(FREE_PLAY))
  })

  it('goes on with Tab from the menu into the box, line by line', () => {
    startApp()
    openBoxWithKeyboard()
    // The box comes straight after the menu, and the piano is no stop.
    expect(tabStops()).toEqual(['Menu', 'Volume', 'Sustain', ...LINES_OF_THE_BOX])
  })

  it.each([
    ['Escape', () => tap('Escape')],
    ['Enter on "Free Play"', () => pressEnterOn(line(FREE_PLAY))],
    ['Enter on a song', () => pressEnterOn(line(PLAY_TWINKLE))],
    ['a key of the piano', () => tap('KeyA')],
  ])('is on the Menu button after %s closed the box under a focused line', (_what, close) => {
    startApp()
    openBoxWithKeyboard()
    close()
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())
  })

  it('is on the Menu button after any line of the box had it, not only the first', () => {
    startApp()
    openBoxWithKeyboard()
    line('About').focus()
    tap('Escape')
    expect(document.activeElement).toBe(menuButton())
  })

  it('stays on the Menu button when Enter on it closes the box', () => {
    startApp()
    openBoxWithKeyboard()
    // The focus is taken back to the Menu button (Shift+Tab), then Enter.
    pressEnterOn(menuButton())
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())
  })

  it('stays on "Full screen" when Enter on it was the very first thing: the box stays', () => {
    giveThePageFullScreen()
    drawApp()
    pressEnterOn(line('Full screen'))
    expect(open()).toEqual(['Menu'])
    expect(document.activeElement).toBe(line('Full screen'))
  })

  it('stays on "Full screen" when Enter is pressed on it: the line has not gone away', () => {
    giveThePageFullScreen()
    startApp()
    openBoxWithKeyboard()
    const fullScreen = line('Full screen')
    pressEnterOn(fullScreen)
    expect(document.activeElement).toBe(fullScreen)

    browserShows(document.documentElement)
    expect(document.activeElement).toBe(line('Leave full screen'))
  })

  it.each([
    ['All songs…', 'Songs', 'Import a MIDI file'],
    ['Settings', 'Settings', 'Sound'],
    ['About', 'Settings', 'About'],
  ] as const)(
    'goes into the panel that Enter on "%s" opens, and to the Menu button when that closes',
    (opener, name, firstControl) => {
      startApp()
      openSettingsOn('Sound')
      clickWithMouse(button('Close Settings'))

      openBoxWithKeyboard()
      pressEnterOn(line(opener))
      expect(open()).toEqual([name])
      // On the first control of the panel: for Settings, the tab that is showing.
      expect(nameOf(document.activeElement as Element)).toBe(firstControl)
      expect(panel(name).contains(document.activeElement)).toBe(true)

      tap('Escape')
      expect(open()).toEqual([])
      expect(document.activeElement).toBe(menuButton())
    },
  )

  it('is on the Menu button when a panel closes under one of its controls', () => {
    startApp()
    openSettingsOn('Sound')
    within(panel('Settings')).getByRole('slider', { name: 'Volume' }).focus()
    tap('Escape')
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())

    openBox()
    clickWithMouse(line('All songs…'))
    pressEnterOn(button('Close Songs'))
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())
  })

  it('is on the Menu button when Enter on "Play" closed the Songs panel', () => {
    startApp()
    openBoxWithKeyboard()
    pressEnterOn(line('All songs…'))
    pressEnterOn(within(panel('Songs')).getByRole('button', { name: PLAY_TWINKLE }))

    expect(open()).toEqual([])
    expect(player.getState().status).toBe('playing')
    expect(document.activeElement).toBe(menuButton())
  })

  it('goes to the Menu button when choosing keys ends with the focus on a piano key', () => {
    startApp()
    openSettingsOn('Keys')
    pianoKey(64).focus()
    tap('Escape')

    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())
  })

  it('goes to the Menu button when Enter on "Stop" takes the player line away', () => {
    startApp()
    act(() => {
      playSong(TWINKLE)
    })
    pressEnterOn(button('Stop'))

    expect(playerLine()).toBeNull()
    expect(document.activeElement).toBe(menuButton())
  })

  it('goes into the Songs panel when a file is dropped while a line has it', async () => {
    startApp()
    openBoxWithKeyboard()
    await dropFiles(songFile('Dropped.mid'))
    await screen.findByText('"Dropped" was added.')

    expect(open()).toEqual(['Songs'])
    expect(document.activeElement).toBe(button('Import a MIDI file'))
  })

  it('is let go by Escape once the box is closed, so that the menu can hide', () => {
    startApp()
    openBoxWithKeyboard()
    tap('Escape')
    expect(document.activeElement).toBe(menuButton())
    tap('Escape')
    expect(document.activeElement).toBe(document.body)
  })
})

describe('the keyboard focus, for someone who works with the mouse', () => {
  it('is held by the box itself when a click on the Menu button opens it', () => {
    startApp()
    openBox()
    // No line shows a focus ring, and Tab goes on inside the box.
    expect(document.activeElement).toBe(box())
    expect(box().tabIndex).toBe(-1)
  })

  it.each([
    ['Escape', () => tap('Escape')],
    ['a click on the Menu button', () => clickWithMouse(menuButton())],
    ['a click on "Free Play"', () => clickWithMouse(line(FREE_PLAY))],
    ['a click on a song', () => clickWithMouse(line(PLAY_TWINKLE))],
    ['a key of the piano', () => tap('KeyA')],
    [
      'a press and a click on the sky',
      () => {
        pressMouseOn(sky())
        clickWithMouse(sky())
      },
    ],
  ])("is nowhere after %s closed the box: the keyboard is the piano's", (_what, close) => {
    startApp()
    openBox()
    close()
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(document.body)
  })

  it('is on no line of the box after a click on "Full screen" as the very first thing', () => {
    giveThePageFullScreen()
    drawApp()
    clickWithMouse(line('Full screen'))
    expect(open()).toEqual(['Menu'])
    // No line shows a focus ring: the box holds the focus, or nothing does.
    expect([box(), document.body]).toContain(document.activeElement)
  })

  // The headings and the room around the lines are in the part of the box that
  // scrolls. Tab skips that part, but it can hold the focus, and a browser
  // gives it the focus at a click on it. It is not a line of the box: nobody
  // went there with the keyboard, so the Menu button must not get the focus
  // when the box closes, or the menu would stay on screen while the piano is played.
  it.each([
    ['as the very first click', drawApp],
    [
      'in the box that the Menu button opened',
      (): void => {
        startApp()
        openBox()
      },
    ],
  ])('is nowhere after a click between the lines, %s, and a key of the piano', (_when, showBox) => {
    showBox()
    clickWithMouseOn(within(box()).getByRole('heading', { name: 'Songs' }))
    expect(open()).toEqual(['Menu'])
    // Whatever holds the focus now, it is no line of the box.
    expect(within(box()).getAllByRole('button')).not.toContain(document.activeElement)

    tap('KeyA')
    expect(open()).toEqual([])
    expect(audio.state.notesOn).toEqual([60])
    expect(document.activeElement).toBe(document.body)
  })

  it('is let go by "Full screen" and by a way to play that is coming, which stay', () => {
    giveThePageFullScreen()
    startApp()
    openBox()
    for (const stays of [line('Full screen'), line(/^Practice/)]) {
      clickWithMouse(stays)
      expect(open()).toEqual(['Menu'])
      expect(document.activeElement).toBe(document.body)
    }
  })

  it.each([
    ['All songs…', 'Songs'],
    ['Settings', 'Settings'],
    ['About', 'Settings'],
  ] as const)('is held by the panel itself when a click on "%s" opens it', (opener, name) => {
    startApp()
    openBox()
    clickWithMouse(line(opener))
    expect(document.activeElement).toBe(panel(name))

    // And it is nowhere once the panel is closed with the mouse.
    clickWithMouse(button(`Close ${name}`))
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(document.body)
  })

  it('is not put on the Menu button when a song is closed with the mouse', () => {
    startApp()
    openBox()
    clickWithMouse(line(PLAY_TWINKLE))
    clickWithMouse(button('Stop'))

    expect(playerLine()).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('is taken off a line of the box by a press of the mouse on the sky', () => {
    startApp()
    openBoxWithKeyboard()
    expect(document.activeElement).toBe(line(FREE_PLAY))

    // The press closes the box and the click lets go of the Menu button.
    pressMouseOn(sky())
    clickWithMouse(sky())
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(document.body)
  })
})

describe('when React draws everything twice (StrictMode), as the real page does', () => {
  function drawTwice(): void {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  }

  it('there is one start box and one window around it, and one key starts the app once', () => {
    drawTwice()
    expect(open()).toEqual(['Menu'])
    expect(screen.getAllByRole('button', { name: START_SENTENCE })).toHaveLength(1)
    expect(mainHeadings()).toEqual([APP_NAME])
    expect(document.activeElement).toBe(document.body)

    tap('Enter')
    expectStarted()
    expect(open()).toEqual([])
  })

  it('a line of the box does its one thing once', () => {
    drawTwice()
    clickWithMouse(line(PLAY_TWINKLE))
    expectStarted()
    expect(open()).toEqual([])
    expect(screen.getAllByRole('region', { name: 'Song player' })).toHaveLength(1)
    expect(player.getState()).toMatchObject({ status: 'playing', songId: TWINKLE })
  })

  it('a click on the sentence at the foot starts the app once, and leaves the one box open', () => {
    drawTwice()
    const theBox = box()
    clickWithMouseOn(within(theBox).getByText(START_SENTENCE))
    expectStarted()
    expect(open()).toEqual(['Menu'])
    expect(box()).toBe(theBox)

    // It closes at one press of the mouse outside it, like any other.
    const changes = watchBox()
    pressMouseOn(sky())
    expect(changes()).toEqual(['closed'])
    expect(open()).toEqual([])
  })

  it('Enter held on "All songs…" opens the Songs panel, and presses nothing in it', async () => {
    const filePickerOpened = watchFilePicker()
    drawTwice()
    tap('Enter')
    openBoxWithKeyboard()

    expect(await holdEnterOn(line('All songs…'))).toEqual(['All songs…'])
    expect(open()).toEqual(['Songs'])
    expect(document.activeElement).toBe(button('Import a MIDI file'))
    expect(filePickerOpened()).toBe(0)
  })

  it('the Menu button opens one box, and the focus goes in and comes back', () => {
    drawTwice()
    tap('Enter')
    openBoxWithKeyboard()
    expect(open()).toEqual(['Menu'])
    expect(document.activeElement).toBe(line(FREE_PLAY))

    tap('Escape')
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(menuButton())

    tap('Escape')
    openBox()
    expect(document.activeElement).toBe(box())
  })

  it('one key of the piano closes the box and plays one note', () => {
    drawTwice()
    tap('Enter')
    openBox()
    const heard: string[] = []
    const stop = bus.subscribe((event) => heard.push(`${event.type} ${event.midi}`))
    tap('KeyA')
    stop()

    expect(open()).toEqual([])
    expect(heard).toEqual(['on 60', 'off 60'])
    expect(audio.state.notesOn).toEqual([60])
  })

  it('one press outside closes the box, and nothing listens once the app is gone', () => {
    const added: string[] = []
    const removed: string[] = []
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      added.push(type)
      add(type, listener, options)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
      removed.push(type)
      remove(type, listener, options)
    })

    drawTwice()
    tap('Enter')
    openBox()
    const changes = watchBox()
    pressMouseOn(sky())
    expect(changes()).toEqual(['closed'])

    openBox()
    cleanup()
    expect(added.filter((type) => type === 'pointerdown').length).toBeGreaterThan(0)
    expect([...removed].sort()).toEqual([...added].sort())
  })
})
