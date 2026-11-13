// @vitest-environment jsdom
/**
 * The parts of the screen, one at a time.
 *
 * Most checks draw a part to a string and look at what is there and at the
 * wording the user is meant to read. The checks at the end draw the app in a
 * simulated browser, to try what the words over the sky say while notes are
 * played and where the keyboard focus goes when Settings closes. The rules of
 * key presses are tested in src/ui/keyEditorModel.test.ts and
 * src/input/keyboardInput.test.ts; the drop-down for the labels and the lines
 * that guide the choice of a computer key are tested with their tabs, in
 * src/ui/settings/PianoTab.test.tsx and src/ui/settings/KeysTab.test.tsx.
 *
 * The sound engine is replaced by a silent one, so that starting the app in
 * the simulated browser starts no real sound.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle' }
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
    noteOn(): void {},
    noteOff(): void {},
    setSustain(): void {},
    setVolume(): void {},
    setTranspose(): void {},
    setReverb(): void {},
    setRelease(): void {},
    allNotesOff(): void {},
    dispose(): void {},
  }
  return { engine, state }
})

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

import { App } from './App'
import { APP_NAME } from './app/appInfo'
import { bus } from './app/pianoApp'
import { SLOT_COUNT } from './core/layout'
import { DEFAULT_SETTINGS, settingsStore } from './state/settings'
import type { Settings } from './state/settings'
import { StartBox } from './ui/StartBox'
import { TopBar } from './ui/TopBar'
import { ConfirmButton } from './ui/controls'
import { KeysTab } from './ui/settings/KeysTab'
import { LookTab } from './ui/settings/LookTab'
import { PianoTab } from './ui/settings/PianoTab'
import { SoundTab } from './ui/settings/SoundTab'
import type { KeyEditor } from './ui/useKeyEditor'

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
}

/** The text a user would read, with single spaces between the pieces. */
function textOf(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

function draw(element: ReactElement): { html: string; text: string } {
  const html = renderToString(element)
  return { html, text: textOf(html) }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function noop(): void {}

/** The top bar as the app draws it: shown, with the start box open or closed. */
function topBar(settings: Settings, startBoxOpen = false): ReactElement {
  return createElement(TopBar, {
    settings,
    startBoxOpen,
    startBoxId: 'start-box',
    onToggleStartBox: noop,
    menu: {
      visible: true,
      menuProps: {
        ref: { current: null },
        onMouseEnter: noop,
        onMouseLeave: noop,
        onFocus: noop,
        onBlur: noop,
      },
    },
  })
}

/** The start box as the app draws it once it has started: opened with the Menu button. */
function startBox(): ReactElement {
  return createElement(StartBox, {
    id: 'start-box',
    overWindow: false,
    waitingToStart: false,
    opener: { current: null },
    onClose: noop,
    onPlaySong: noop,
    onShowSongs: noop,
    onShowSettings: noop,
    onShowAbout: noop,
  })
}

/** The computer keys being chosen, with no piano key waiting for one: what the Keys tab starts with. */
const KEY_EDITOR: KeyEditor = {
  editing: true,
  selectedSlot: null,
  message: null,
  open: noop,
  close: noop,
  select: noop,
  applyPreset: noop,
  resetKeys: noop,
  handleKey: () => false,
}

function soundTab(settings: Settings): { html: string; text: string } {
  return draw(createElement(SoundTab, { settings }))
}

function pianoTab(settings: Settings): { html: string; text: string } {
  return draw(createElement(PianoTab, { settings }))
}

function lookTab(settings: Settings): { html: string; text: string } {
  return draw(createElement(LookTab, { settings }))
}

function keysTab(settings: Settings): { html: string; text: string } {
  return draw(createElement(KeysTab, { settings, keyEditor: KEY_EDITOR }))
}

describe('App, as first drawn', () => {
  const { html, text } = draw(createElement(App))
  const menu = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
  /** Where the screen ends and what lies over it begins: the start box, in its window. */
  const screenEnd = html.indexOf('<div class="start-layer">')
  const screenHtml = html.slice(0, screenEnd)
  const startLayer = html.slice(screenEnd)

  it('shows the name and the three ways to play, in the start box', () => {
    expect(startLayer).toContain(`<h1 class="start-box__name">${APP_NAME}</h1>`)
    // The name is the one main heading of the page: the bar has none.
    expect(count(html, '<h1')).toBe(1)
    expect(textOf(startLayer)).toContain(
      'Play Free Play Play anything you like Practice The song waits for you Soon ' +
        'Real-time Your timing is scored Soon',
    )
    // The stage is called by the way of playing that is on.
    expect(screenHtml).toContain('class="stage" role="region" aria-label="Free Play"')
  })

  it('shows the top bar with the default settings, and nothing else in it', () => {
    expect(menu).toContain('aria-label="Volume" aria-valuetext="80%" value="80"')
    expect(menu).toContain('role="switch" aria-checked="false" aria-label="Sustain"')
    // Everything the bar says, left to right. The rest is in the start box.
    expect(textOf(menu)).toBe('Menu Sustain Off Space')
  })

  it('keeps the Settings and Songs panels closed, and no piano key waits to be chosen', () => {
    expect(html).toContain('<div class="app__panels"></div>')
    // The one thing that is open is the start box, and the Menu button, the
    // only button that opens anything, says so and points at it.
    expect(count(html, 'role="dialog"')).toBe(1)
    expect(count(html, 'aria-expanded=')).toBe(1)
    const pointedAt = /aria-expanded="true" aria-controls="([^"]+)"/.exec(menu)?.[1]
    expect(startLayer).toContain(
      `<section id="${pointedAt}" class="start-box" role="dialog" aria-label="Menu"`,
    )
    expect(text).not.toContain('Click a piano key')
    expect(html).not.toContain('piano--editing')
    // No key of the piano is pressed in. The one line that is, is the way to
    // play that is on, in the start box.
    expect(screenHtml).toContain('aria-pressed="false"')
    expect(screenHtml).not.toContain('aria-pressed="true"')
    expect(count(startLayer, 'aria-pressed=')).toBe(1)
  })

  it('shows the hint where the notes being played will be', () => {
    expect(text).toContain('Press the keys shown on the piano, or click it')
    expect(text).not.toContain('Transposed')
    expect(text).not.toContain('Sustain on')
  })

  it('draws the sky directly before the whole piano', () => {
    expect(html).toContain('<div class="stage__sky"><canvas class="sky" aria-hidden="true"></canvas>')
    // The light line closes the sky, and the piano follows it at once.
    expect(html).toMatch(
      /<div class="stage__line" aria-hidden="true"><\/div><\/div><div class="stage__piano"><div class="piano"/,
    )
    expect(count(html, '<canvas')).toBe(1)
    expect(count(html, 'class="piano-key ')).toBe(SLOT_COUNT)
  })

  it('writes the default computer keys on the piano', () => {
    expect(html).toContain('aria-label="C4, key A"')
    expect(html).toContain('aria-label="F5, key &#x27;"')
    expect(html).toContain('aria-label="C3"')
  })

  it('explains the sustain key and says nothing about the sound yet', () => {
    // Next to the Sustain switch: the key that works it, and what that key does.
    expect(menu).toMatch(
      /Sustain<span class="switch__state">Off<\/span><\/button><kbd class="keycap" title="Space turns sustain on and off">Space<\/kbd>/,
    )
    // The line for the sound is there, empty.
    expect(html).toContain('<span class="stage__status" role="status" data-status="idle"></span>')
    expect(text).not.toContain('piano sound')
    expect(text).not.toContain('Sound could not start')
  })

  it('waits behind the start box, which is not part of what it covers', () => {
    // The box says what the app is, and ends with how to start it.
    const said = textOf(startLayer)
    expect(said.startsWith(`${APP_NAME} A piano you play with your computer keyboard. `)).toBe(true)
    expect(said.endsWith(' Click or press any key to start')).toBe(true)
    expect(html).toMatch(/^<div class="app"[^>]*><div class="app__screen" inert="">/)
    expect(count(html, 'inert=""')).toBe(1)
    // The screen is closed before the box begins. The whole window around
    // the box is one unseen button, which is called by what the box says.
    const overTheScreen =
      '</div><div class="start-layer"><button type="button" class="start-layer__window" ' +
      'aria-label="Click or press any key to start"></button><section '
    expect(html.slice(screenEnd - '</div>'.length).startsWith(overTheScreen)).toBe(true)
    expect(screenEnd).toBeGreaterThan(html.indexOf('class="stage__piano"'))
  })
})

describe('StartBox', () => {
  const { html, text } = draw(startBox())
  /** Each line of the box that can be pressed: the button, with what is written in it. */
  const lines = html.match(/<button.*?<\/button>/g) ?? []

  /** The line that begins with these words. */
  function line(name: string): string {
    const found = lines.find((each) => textOf(each).startsWith(name))
    if (found === undefined) throw new Error(`The start box has no line "${name}"`)
    return found
  }

  it('marks Free Play as the way to play that is on', () => {
    // A line that is pressed in, not a tab: the ways to play are no row of tabs.
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('role="tab"')
    expect(line('Free Play')).toMatch(
      /^<button type="button" class="start-box__row" aria-pressed="true"><svg class="icon"/,
    )
    expect(textOf(line('Free Play'))).toBe('Free Play Play anything you like')
    // Of all the lines it is the only one that says whether it is pressed in.
    expect(count(html, 'aria-pressed=')).toBe(1)
  })

  it('marks the other ways to play as not available yet', () => {
    expect(count(html, 'aria-disabled="true"')).toBe(2)
    expect(count(html, 'title="Coming in a later update"')).toBe(2)
    expect(count(html, '>Soon<')).toBe(2)
    // Each of them, greyed out and not reached with the Tab key.
    const notYet =
      '<button type="button" class="start-box__row" aria-disabled="true" tabindex="-1" ' +
      'title="Coming in a later update">'
    expect(line('Practice').startsWith(notYet)).toBe(true)
    expect(textOf(line('Practice'))).toBe('Practice The song waits for you Soon')
    expect(line('Real-time').startsWith(notYet)).toBe(true)
    expect(textOf(line('Real-time'))).toBe('Real-time Your timing is scored Soon')
  })

  it('says everything in order: the name, the ways to play, a few songs, and the rest', () => {
    // A dialog called "Menu", like the button that opens it.
    const opening = '<section id="start-box" class="start-box" role="dialog" aria-label="Menu" '
    expect(html.startsWith(opening)).toBe(true)
    expect(text).toBe(
      `${APP_NAME} A piano you play with your computer keyboard. ` +
        'Play Free Play Play anything you like Practice The song waits for you Soon ' +
        'Real-time Your timing is scored Soon ' +
        'Songs Twinkle, Twinkle, Little Star 0:28 Mary Had a Little Lamb 0:17 Ode to Joy 0:34 ' +
        'All songs… Settings About Click outside or play a key to close',
    )
    // A song is called by what its line does, for someone who hears the lines read out.
    expect(line('Ode to Joy')).toContain('aria-label="Play Ode to Joy"')
  })
})

describe('TopBar', () => {
  it('shows the current values', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, volume: 0.35, sustain: true }
    const { html, text } = draw(topBar(settings))
    expect(html).toContain('aria-label="Volume" aria-valuetext="35%" value="35"')
    expect(text).toContain('Sustain On Space')
    expect(html).toContain('role="switch" aria-checked="true" aria-label="Sustain"')
  })

  it('shows whether the start box is open, and points at it', () => {
    /** The first button of the bar, with what is written in it. */
    const firstButton = (html: string): string => /<button.*?<\/button>/.exec(html)?.[0] ?? ''
    const MENU_BUTTON = '<button type="button" class="button top-bar__menu" '

    const open = draw(topBar(DEFAULT_SETTINGS, true)).html
    const whileOpen = firstButton(open)
    const pointing = `${MENU_BUTTON}aria-expanded="true" aria-controls="start-box">`
    expect(whileOpen.startsWith(pointing)).toBe(true)
    expect(textOf(whileOpen)).toBe('Menu')
    expect(count(open, 'aria-expanded=')).toBe(1)

    // A closed box is not on the page: there is nothing to point at.
    const closed = draw(topBar(DEFAULT_SETTINGS)).html
    const whileClosed = firstButton(closed)
    expect(whileClosed.startsWith(`${MENU_BUTTON}aria-expanded="false">`)).toBe(true)
    expect(textOf(whileClosed)).toBe('Menu')
    expect(count(closed, 'aria-expanded=')).toBe(1)
    expect(closed).not.toContain('aria-controls')
  })
})

describe('the tabs of Settings', () => {
  it('explain every advanced option in plain words', () => {
    const sound = soundTab(DEFAULT_SETTINGS).text
    expect(sound).toContain('Advanced Touch 80% How hard each note is played.')
    expect(sound).toContain('Room echo 15% Adds the echo of a room. 0 is none.')
    expect(sound).toContain(
      'Note fade-out Short Normal Long How long a note rings after you let go.',
    )
    expect(sound).toContain('Transpose − 0 + Shifts every note up or down. 0 is normal.')
    // The advanced options come last, after the everyday ones.
    expect(sound.endsWith('Transpose − 0 + Shifts every note up or down. 0 is normal.')).toBe(true)
    expect(sound.indexOf('Advanced')).toBeGreaterThan(sound.indexOf('Sustain'))

    expect(pianoTab(DEFAULT_SETTINGS).text).toContain(
      'Note names C D E Do Ré Mi How notes are written on the piano.',
    )
    expect(lookTab(DEFAULT_SETTINGS).text).toContain(
      'Light bars On Bars of light for the notes you play and the falling notes of a song.',
    )
  })

  it('show the current values', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      baseOctave: 2,
      labelMode: 'notes',
      velocity: 0.5,
      transpose: -3,
      noteNaming: 'solfege',
      reverb: 0,
      release: 'long',
      showTrails: false,
    }

    const sound = soundTab(settings)
    expect(sound.text).toContain('Touch 50%')
    expect(sound.text).toContain('Transpose − −3 +')
    expect(sound.text).toContain('Room echo 0%')
    expect(sound.html).toContain('aria-pressed="true">Long</button>')
    expect(sound.html).toContain('aria-pressed="false">Normal</button>')
    expect(sound.html).toMatch(/<input class="slider" type="range" min="10" max="100"[^>]* value="50"/)

    const piano = pianoTab(settings).html
    expect(piano).toContain('aria-pressed="true">Do Ré Mi</button>')
    expect(piano).toContain('aria-pressed="false">C D E</button>')
    expect(piano).toContain('<option value="notes" selected="">Notes only</option>')
    expect(count(piano, 'selected=""')).toBe(1)

    expect(lookTab(settings).text).toContain('Light bars Off')
    expect(keysTab(settings).text).toContain('Lower Do2 – Do5 Higher')
  })

  it('stop the transpose buttons at twelve notes either way', () => {
    const highest = soundTab({ ...DEFAULT_SETTINGS, transpose: 12 })
    expect(highest.text).toContain('Transpose − +12 +')
    expect(highest.html).toContain('aria-label="Transpose up" disabled=""')
    expect(highest.html).not.toContain('aria-label="Transpose down" disabled=""')

    const lowest = soundTab({ ...DEFAULT_SETTINGS, transpose: -12 })
    expect(lowest.text).toContain('Transpose − −12 +')
    expect(lowest.html).toContain('aria-label="Transpose down" disabled=""')
    expect(lowest.html).not.toContain('aria-label="Transpose up" disabled=""')
  })

  it('disable Lower and Higher at the ends of the piano', () => {
    const lowest = keysTab({ ...DEFAULT_SETTINGS, baseOctave: 1 }).html
    expect(lowest).toMatch(/class="button" disabled=""><span[^>]*>[^<]+<\/span> Lower/)
    expect(count(lowest, 'disabled=""')).toBe(1)

    const highest = keysTab({ ...DEFAULT_SETTINGS, baseOctave: 5 }).html
    expect(highest).toMatch(/class="button" disabled="">Higher/)
    expect(count(highest, 'disabled=""')).toBe(1)

    expect(count(keysTab(DEFAULT_SETTINGS).html, 'disabled=""')).toBe(0)
  })

  it('write the notes the computer keys reach where a screen reader hears them change', () => {
    const { html } = keysTab(DEFAULT_SETTINGS)
    expect(html).toContain('<output class="keys-range">C3 – C6</output>')
  })
})

// ---------------------------------------------------------------------------
// The running app, in a simulated browser.
// ---------------------------------------------------------------------------

const HINT = 'Press the keys shown on the piano, or click it'

beforeAll(() => {
  // The simulated browser has no canvas: the sky then draws nothing, which is all these checks need.
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
})

beforeEach(() => {
  audio.state.status = 'idle'
  bus.allOff()
  settingsStore.reset()
})

afterEach(() => {
  cleanup()
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
})

/** What has the keyboard focus: an element, or `document.body` when nothing has it. */
function focused(): Element | null {
  return document.activeElement
}

/** A key of the computer keyboard goes down or up, on whatever has the keyboard focus. */
function key(type: 'keydown' | 'keyup', code: string): void {
  const target = document.activeElement ?? document.body
  act(() => {
    target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }))
  })
}

function tap(code: string): void {
  key('keydown', code)
  key('keyup', code)
}

/** Enter on the focused control: the browser sends a click that no mouse button made. */
function pressEnterOn(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 0 })
}

/** A click with the mouse: the control has the focus when the click arrives. */
function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

/** Draws the app and starts it with a key press, which takes the start box away too. */
function startApp(): void {
  render(createElement(App))
  tap('Enter')
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

/** The start box, when it is open. */
function openStartBox(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Menu' })
}

/**
 * A line of the start box. When the box is closed, the Menu button opens it
 * first, pressed the way `press` says: with the mouse or with Enter.
 */
function startBoxLine(name: string | RegExp, press: (target: HTMLElement) => void): HTMLElement {
  if (!openStartBox()) press(button('Menu'))
  return within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('button', { name })
}

function settingsPanel(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Settings' })
}

/**
 * Opens Settings on one of its tabs, with the mouse: the Menu button, the
 * "Settings" line of the start box, then the tab. (The panel remembers its
 * last tab from test to test.)
 */
function openSettingsOn(tab: string): HTMLElement {
  if (!settingsPanel()) clickWithMouse(startBoxLine('Settings', clickWithMouse))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  clickWithMouse(within(settings).getByRole('tab', { name: tab }))
  return settings
}

/** The same with the keyboard alone: Enter on the Menu button, on "Settings", then on the tab. */
function openSettingsWithKeyboardOn(tab: string): HTMLElement {
  pressEnterOn(startBoxLine('Settings', pressEnterOn))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  pressEnterOn(within(settings).getByRole('tab', { name: tab }))
  return settings
}

function hint(): HTMLElement {
  return screen.getByText(HINT)
}

/** The names written above the piano, left to right. */
function noteNames(): string[] {
  return [...document.querySelectorAll('.stage__notes .stage__note')].map((name) => name.textContent ?? '')
}

/** The quiet badges next to the sound status, which say why notes sound different. */
function badges(): string[] {
  return [...document.querySelectorAll('.stage__sound .stage__badge')].map(
    (badge) => badge.textContent ?? '',
  )
}

describe('the words over the sky', () => {
  it('name the held notes, lowest first', () => {
    startApp()
    expect(noteNames()).toEqual([])

    // G, then A, then D of the computer keyboard: G4, C4, E4.
    key('keydown', 'KeyG')
    key('keydown', 'KeyA')
    key('keydown', 'KeyD')
    expect(noteNames()).toEqual(['C4', 'E4', 'G4'])

    key('keyup', 'KeyA')
    expect(noteNames()).toEqual(['E4', 'G4'])
    key('keyup', 'KeyG')
    key('keyup', 'KeyD')
    expect(noteNames()).toEqual([])
    expect(document.querySelector('.stage__notes')).toBeNull()
  })

  it('follow the note naming', () => {
    act(() => settingsStore.set({ noteNaming: 'solfege' }))
    startApp()
    key('keydown', 'KeyG')
    key('keydown', 'KeyA')
    key('keydown', 'KeyD')
    expect(noteNames()).toEqual(['Do4', 'Mi4', 'Sol4'])

    act(() => settingsStore.set({ noteNaming: 'letters' }))
    expect(noteNames()).toEqual(['C4', 'E4', 'G4'])
  })

  it('say when the piano is transposed', () => {
    act(() => settingsStore.set({ transpose: -3 }))
    startApp()
    // Nothing played yet: how to play, and why the notes will sound different.
    expect(hint().className).toBe('stage__hint')
    expect(badges()).toEqual(['Transposed −3'])

    act(() => settingsStore.set({ transpose: 2 }))
    key('keydown', 'KeyG')
    key('keydown', 'KeyA')
    key('keydown', 'KeyD')
    // The names are those of the keys pressed; the badge says why they sound different.
    expect(noteNames()).toEqual(['C4', 'E4', 'G4'])
    expect(badges()).toEqual(['Transposed +2'])
    expect(hint().className).toBe('stage__hint stage__hint--gone')

    act(() => settingsStore.set({ transpose: 0 }))
    expect(badges()).toEqual([])
    expect(noteNames()).toEqual(['C4', 'E4', 'G4'])
  })

  // Space switches sustain without showing the menu: the badge is the sign that stays.
  it('say when sustain is on, next to the word about the transposing', () => {
    startApp()
    expect(badges()).toEqual([])

    tap('Space')
    expect(settingsStore.get().sustain).toBe(true)
    expect(badges()).toEqual(['Sustain on'])

    act(() => settingsStore.set({ transpose: 2 }))
    expect(badges()).toEqual(['Transposed +2', 'Sustain on'])

    tap('Space')
    expect(badges()).toEqual(['Transposed +2'])
  })

  it('keep the hint to themselves while the computer keys are being chosen', () => {
    startApp()
    expect(hint().className).toBe('stage__hint')

    openSettingsOn('Keys')
    expect(hint().className).toBe('stage__hint stage__hint--gone')
    expect(noteNames()).toEqual([])

    // The keyboard still plays there, and what it plays is still named.
    key('keydown', 'KeyA')
    expect(noteNames()).toEqual(['C4'])
    expect(hint().className).toBe('stage__hint stage__hint--gone')
  })

  // The start box lies over the middle of the sky, where the hint is written.
  it('keep the hint to themselves while the start box is open', () => {
    startApp()
    expect(hint().className).toBe('stage__hint')

    clickWithMouse(button('Menu'))
    expect(openStartBox()).not.toBeNull()
    expect(hint().className).toBe('stage__hint stage__hint--gone')

    // "Free Play" only closes the box. Nothing was played yet, so the hint is back.
    clickWithMouse(startBoxLine(/^Free Play/, clickWithMouse))
    expect(openStartBox()).toBeNull()
    expect(hint().className).toBe('stage__hint')
  })
})

describe('Settings, in the app', () => {
  it('credits the piano recordings on its About tab, with a link to their licence', () => {
    startApp()
    const settings = openSettingsOn('About')
    const credit = within(settings).getByText(/^Piano sound:/)
    // Without the tags, the credit reads as one sentence.
    expect(credit.textContent).toBe(
      'Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)',
    )
    const licence = within(credit).getByRole('link', { name: 'CC BY 3.0' })
    expect(licence.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/3.0/')
    expect(licence.getAttribute('rel')).toBe('noreferrer')
    expect(licence.getAttribute('target')).toBe('_blank')
  })

  it('opens on its About tab from the "About" line of the start box, which it replaces', () => {
    startApp()
    // Another tab was the last one shown: "About" does not just open what was open before.
    openSettingsOn('Sound')
    tap('Escape')
    expect(settingsPanel()).toBeNull()

    clickWithMouse(startBoxLine('About', clickWithMouse))

    const settings = screen.getByRole('dialog', { name: 'Settings' })
    const chosen = within(settings).getByRole('tab', { selected: true })
    expect(chosen.textContent).toBe('About')
    expect(within(settings).getByText(/^Piano sound:/)).toBeTruthy()
    expect(openStartBox()).toBeNull()
  })

  // The Menu button is the way in to Settings, through the start box, so it
  // is where the focus goes when the control that has it leaves the page.
  it.each(['Close Settings', 'Reset to default keys'])(
    'hands the keyboard focus to the Menu button when it closes while "%s" has it',
    (name) => {
      startApp()
      const settings = openSettingsWithKeyboardOn('Keys')
      const inside = within(settings).getByRole('button', { name })
      inside.focus()
      expect(focused()).toBe(inside)

      // Its own close button is pressed with Enter; from anywhere else, Escape closes it.
      if (name === 'Close Settings') pressEnterOn(inside)
      else tap('Escape')

      expect(settingsPanel()).toBeNull()
      expect(focused()).toBe(button('Menu'))
      // Only Settings was closed: the start box does not come back with the focus.
      expect(openStartBox()).toBeNull()
    },
  )

  it('leaves the focus alone when it closes and none of its controls has it', () => {
    startApp()
    // Opened with the mouse, which leaves the keyboard to the piano.
    const settings = openSettingsOn('Keys')
    expect(settings.contains(focused())).toBe(false)
    const focusMenuButton = vi.spyOn(button('Menu'), 'focus')

    tap('Escape')

    expect(settingsPanel()).toBeNull()
    expect(focusMenuButton).not.toHaveBeenCalled()
    expect(focused()).toBe(document.body)
  })
})

describe('ConfirmButton', () => {
  const LABEL = 'Reset to default keys'

  /** A click with the mouse. The app then takes the focus off the button, as App.tsx does. */
  function clickAndLetGo(target: HTMLElement): void {
    clickWithMouse(target)
    target.blur()
  }

  it('asks before it does anything', () => {
    const onConfirm = vi.fn()
    render(createElement(ConfirmButton, { label: LABEL, onConfirm }))

    clickAndLetGo(button(LABEL))
    expect(screen.getByText('Really reset?')).toBeTruthy()
    clickAndLetGo(button('No'))
    expect(onConfirm).not.toHaveBeenCalled()

    clickAndLetGo(button(LABEL))
    clickAndLetGo(button('Yes'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Really reset?')).toBeNull()
  })

  it('used with the keyboard, moves the focus to "No", then back once answered', () => {
    const onConfirm = vi.fn()
    render(createElement(ConfirmButton, { label: LABEL, onConfirm }))

    pressEnterOn(button(LABEL))
    expect(focused()).toBe(button('No'))
    pressEnterOn(button('No'))
    expect(focused()).toBe(button(LABEL))
    expect(onConfirm).not.toHaveBeenCalled()

    pressEnterOn(button(LABEL))
    pressEnterOn(button('Yes'))
    expect(focused()).toBe(button(LABEL))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('used with the mouse, never takes the focus', () => {
    render(createElement(ConfirmButton, { label: LABEL, onConfirm: noop }))

    clickAndLetGo(button(LABEL))
    expect(focused()).toBe(document.body)
    clickAndLetGo(button('No'))
    expect(focused()).toBe(document.body)
  })
})
