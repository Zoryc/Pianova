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
import { ModeTabs } from './ui/ModeTabs'
import { TopBar } from './ui/TopBar'
import type { PanelName } from './ui/TopBar'
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

/** The top bar as the app draws it: shown, with one of the two panels open or none. */
function topBar(settings: Settings, openPanel: PanelName | null = null): ReactElement {
  return createElement(TopBar, {
    settings,
    openPanel,
    songsPanelId: 'songs',
    settingsPanelId: 'settings',
    onToggleSongs: noop,
    onToggleSettings: noop,
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
    modeTabId: 'tab',
    modePanelId: 'panel',
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

  it('shows the name and the three modes', () => {
    expect(html).toContain(`<h1 class="top-bar__name">${APP_NAME}</h1>`)
    expect(text).toContain('Free Play Practice Soon Real-time Soon')
  })

  it('shows the top bar with the default settings, and nothing else in it', () => {
    expect(menu).toContain('aria-label="Volume" aria-valuetext="80%" value="80"')
    expect(menu).toContain('role="switch" aria-checked="false" aria-label="Sustain"')
    // Everything the bar says, left to right. The rest is in Settings.
    expect(textOf(menu)).toBe(
      `${APP_NAME} Free Play Practice Soon Real-time Soon Sustain Off Space Songs Settings`,
    )
  })

  it('keeps the Settings and Songs panels closed, and no piano key waits to be chosen', () => {
    expect(html).toContain('<div class="app__panels"></div>')
    expect(html).not.toContain('role="dialog"')
    expect(text).not.toContain('Click a piano key')
    expect(html).not.toContain('piano--editing')
    expect(count(html, 'aria-expanded="false"')).toBe(2)
    expect(html).not.toContain('aria-expanded="true"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).not.toContain('aria-pressed="true"')
  })

  it('shows the hint where the notes being played will be', () => {
    expect(text).toContain('Press the keys shown on the piano, or click it')
    expect(text).not.toContain('Transposed')
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

  it('waits behind the start overlay, which is not part of what it covers', () => {
    expect(text).toContain(`${APP_NAME} Click or press any key to start`)
    expect(html).toMatch(/^<div class="app"[^>]*><div class="app__screen" inert="">/)
    expect(count(html, 'inert=""')).toBe(1)
    const screenEnd = html.indexOf('</div><button type="button" class="start-overlay">')
    expect(screenEnd).toBeGreaterThan(html.indexOf('class="stage__piano"'))
  })
})

describe('ModeTabs', () => {
  const { html } = draw(createElement(ModeTabs, { tabId: 'tab', panelId: 'panel' }))

  it('marks Free Play as the selected tab of the page below', () => {
    expect(html).toContain('role="tablist"')
    expect(html).toContain('id="tab"')
    expect(html).toContain('role="tab" aria-selected="true" aria-controls="panel">Free Play<')
  })

  it('marks the other modes as not available yet', () => {
    expect(count(html, 'aria-selected="false"')).toBe(2)
    expect(count(html, 'aria-disabled="true"')).toBe(2)
    expect(count(html, 'title="Coming in a later update"')).toBe(2)
    expect(count(html, '>Soon<')).toBe(2)
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

  it('shows which of its two panels is open, and points at it', () => {
    const settingsOpen = draw(topBar(DEFAULT_SETTINGS, 'settings')).html
    expect(settingsOpen).toContain('aria-expanded="true" aria-controls="settings">Settings</button>')
    expect(settingsOpen).toContain('aria-expanded="false">Songs</button>')

    const songsOpen = draw(topBar(DEFAULT_SETTINGS, 'songs')).html
    expect(songsOpen).toContain('aria-expanded="true" aria-controls="songs">Songs</button>')
    expect(songsOpen).toContain('aria-expanded="false">Settings</button>')

    // A closed panel is not on the page: there is nothing to point at.
    const closed = draw(topBar(DEFAULT_SETTINGS)).html
    expect(count(closed, 'aria-expanded="false"')).toBe(2)
    expect(closed).not.toContain('aria-controls="settings"')
    expect(closed).not.toContain('aria-controls="songs"')
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
      'Light bars On Bars of light for the notes being played.',
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

/** Draws the app and gets past the start overlay. */
function startApp(): void {
  render(createElement(App))
  tap('Enter')
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

function settingsPanel(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Settings' })
}

/** Opens Settings on one of its tabs, with the mouse. (The panel remembers its last tab from test to test.) */
function openSettingsOn(tab: string): HTMLElement {
  if (!settingsPanel()) clickWithMouse(button('Settings'))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  clickWithMouse(within(settings).getByRole('tab', { name: tab }))
  return settings
}

/** The same with the keyboard alone: Enter on the "Settings" button, then on the tab. */
function openSettingsWithKeyboardOn(tab: string): HTMLElement {
  pressEnterOn(button('Settings'))
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

function transposedBadge(): string | null {
  return document.querySelector('.stage__badge')?.textContent ?? null
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
    expect(transposedBadge()).toBe('Transposed −3')

    act(() => settingsStore.set({ transpose: 2 }))
    key('keydown', 'KeyG')
    key('keydown', 'KeyA')
    key('keydown', 'KeyD')
    // The names are those of the keys pressed; the badge says why they sound different.
    expect(noteNames()).toEqual(['C4', 'E4', 'G4'])
    expect(transposedBadge()).toBe('Transposed +2')
    expect(hint().className).toBe('stage__hint stage__hint--gone')

    act(() => settingsStore.set({ transpose: 0 }))
    expect(transposedBadge()).toBeNull()
    expect(noteNames()).toEqual(['C4', 'E4', 'G4'])
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

  it.each(['Close Settings', 'Reset to default keys'])(
    'hands the keyboard focus back to the "Settings" button when it closes while "%s" has it',
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
      expect(focused()).toBe(button('Settings'))
    },
  )

  it('leaves the focus alone when it closes and none of its controls has it', () => {
    startApp()
    // Opened with the mouse, which leaves the keyboard to the piano.
    const settings = openSettingsOn('Keys')
    expect(settings.contains(focused())).toBe(false)
    const focusSettingsButton = vi.spyOn(button('Settings'), 'focus')

    tap('Escape')

    expect(settingsPanel()).toBeNull()
    expect(focusSettingsButton).not.toHaveBeenCalled()
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
