// @vitest-environment jsdom
/**
 * How the app shell (src/App.tsx) ties the screen together: the wait for the
 * first click or key press, the colour of the light, the start box and the
 * two panels and what closes them, choosing the computer keys, the labels
 * handed to the piano and to the sky, the menu that hides, and where the
 * keyboard focus goes.
 *
 * The sound engine and the sky are replaced by stand-ins; each has tests of
 * its own. There is no layout here: sizes and positions are tried in a browser.
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
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkyProps } from './ui/sky/Sky'

const audio = vi.hoisted(() => {
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

/** What the stand-in sky was last given. */
const sky = vi.hoisted(() => ({ props: null as unknown }))

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

vi.mock('./ui/sky/Sky', async () => {
  const { createElement } = await import('react')
  return {
    Sky(props: unknown) {
      sky.props = props
      return createElement('canvas', { className: 'sky' })
    },
  }
})

import { App } from './App'
import { APP_NAME } from './app/appInfo'
import { bus } from './app/pianoApp'
import { player, songLibrary } from './app/songsApp'
import { settingsStore } from './state/settings'
import { addSong, resetSongs, songFile } from './ui/songsTestKit'
import { AUTO_HIDE_DELAY_MS } from './ui/useAutoHide'
import { UNREADABLE_SONG_MESSAGE, playSong } from './ui/useSongs'

/** What the start box says while the app waits to start, and once it has started. */
const START_TEXT = 'Click or press any key to start'
const CLOSE_TEXT = 'Click outside or play a key to close'
const HINT = 'Press the keys shown on the piano, or click it'
const A_STARTER_SONG = 'starter:twinkle-twinkle-little-star'
/** The line of the start box that opens each panel. */
const LINE_OF = { Settings: 'Settings', Songs: 'All songs…' } as const

function skyProps(): SkyProps {
  return sky.props as SkyProps
}

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  audio.state.starts = 0
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
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

function tap(code: string): void {
  key('keydown', code)
  key('keyup', code)
}

/**
 * A click with the mouse: its button goes down on the control (the start box
 * listens for that), and the control has the focus when the click arrives.
 */
function clickWithMouse(target: HTMLElement): void {
  fireEvent.pointerDown(target)
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

/** Enter on a focused control: the browser sends a click that no mouse button made. */
function pressEnterOn(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 0 })
}

function drawApp(): void {
  render(<App />)
}

/** Draws the app and starts it with a key press, which also closes the start box. */
function startApp(): void {
  drawApp()
  tap('Enter')
}

/** A file is dropped on the page. */
async function dropFile(name: string): Promise<void> {
  const dataTransfer = { types: ['Files'], files: [songFile(name)], dropEffect: 'none' }
  await act(async () => {
    fireEvent(document.body, createEvent.drop(document.body, { dataTransfer }))
    await Promise.resolve()
  })
}

function root(): HTMLElement {
  return document.querySelector('.app') as HTMLElement
}

function menu(): HTMLElement {
  return document.querySelector('.menu') as HTMLElement
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

/** The start box, the small menu the app opens with. Null while it is closed. */
function startBox(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Menu' })
}

/** Opens the start box with the mouse on the Menu button, unless it is open already. */
function openStartBox(): HTMLElement {
  if (!startBox()) clickWithMouse(button('Menu'))
  return screen.getByRole('dialog', { name: 'Menu' })
}

/** A line of the start box, which must be open. */
function line(name: string | RegExp): HTMLElement {
  return within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('button', { name })
}

function panel(name: 'Settings' | 'Songs'): HTMLElement | null {
  return screen.queryByRole('dialog', { name })
}

/** Opens a panel with the mouse: the Menu button, then the panel's line of the start box. */
function openPanel(name: 'Settings' | 'Songs'): HTMLElement {
  if (!panel(name)) {
    openStartBox()
    clickWithMouse(line(LINE_OF[name]))
  }
  return screen.getByRole('dialog', { name })
}

/** Opens Settings on one of its tabs. (The panel remembers its last tab from test to test.) */
function openSettingsOn(tab: string): HTMLElement {
  const settings = openPanel('Settings')
  clickWithMouse(within(settings).getByRole('tab', { name: tab }))
  return settings
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

function pianoKey(midi: number): HTMLElement {
  return piano().querySelector(`.piano-key[data-midi="${midi}"]`) as HTMLElement
}

function isChoosingKeys(): boolean {
  return piano().classList.contains('piano--editing')
}

function emptySky(): HTMLElement {
  return document.querySelector('.stage__sky') as HTMLElement
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()]
}

/** True when `later` comes after `earlier` on the page, which is the order the Tab key follows. */
function follows(earlier: Node, later: Node): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('before the first click or key press', () => {
  it('waits with the start box open, and everything else out of reach', () => {
    drawApp()
    const box = startBox() as HTMLElement
    expect(within(box).getByRole('heading', { level: 1 }).textContent).toBe(APP_NAME)
    expect(within(box).getByText(START_TEXT)).toBeTruthy()

    const screenBehind = document.querySelector('.app__screen') as HTMLElement
    expect(screenBehind.hasAttribute('inert')).toBe(true)
    // The box and the window around it, which is one button, are not behind: they can be used.
    expect(screenBehind.contains(box)).toBe(false)
    expect(screenBehind.contains(button(START_TEXT))).toBe(false)
    expect(box.contains(button(START_TEXT))).toBe(false)
    expect(audio.state.starts).toBe(0)
  })

  it('starts at the first key press, which closes the start box and plays no note', () => {
    drawApp()
    const press = key('keydown', 'KeyA')

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
    expect(press.defaultPrevented).toBe(true)
    expect(heldNotes()).toEqual([])

    key('keyup', 'KeyA')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('starts at a click on the window around the start box, which closes the box', () => {
    drawApp()
    clickWithMouse(button(START_TEXT))
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
  })

  it.each([
    ['Free Play', /^Free Play/, () => expect(panel('Settings') ?? panel('Songs')).toBeNull()],
    ['All songs…', 'All songs…', () => expect(panel('Songs')).not.toBeNull()],
    ['Settings', 'Settings', () => expect(panel('Settings')).not.toBeNull()],
    ['a song', /^Play Twinkle/, () => expect(player.getState().status).toBe('playing')],
  ] as const)(
    'starts at a click on a line of the start box (%s), which also does what it says',
    (_line, name, hasDoneWhatItSays) => {
      drawApp()
      clickWithMouse(line(name))

      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(startBox()).toBeNull()
      expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
      expect(audio.state.starts).toBe(1)
      hasDoneWhatItSays()
    },
  )

  it('starts at a click on the start box where it has no line, and the box stays open', () => {
    drawApp()
    const box = startBox() as HTMLElement
    // On the name of the app: the words that say "click" are in this box too.
    clickWithMouse(within(box).getByRole('heading', { level: 1 }))

    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
    // The same box: the window around it is no start button any more, and
    // its last sentence says how to close it.
    expect(startBox()).toBe(box)
    expect(screen.queryByRole('button', { name: START_TEXT })).toBeNull()
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(within(box).getByText(CLOSE_TEXT)).toBeTruthy()

    // The app has started under it: a key of the piano plays, and takes the box away.
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    expect(startBox()).toBeNull()
  })

  // One click on the start box can say "start" twice: a line closes the box,
  // which starts the app, and a click anywhere on the box starts it too. The
  // sound must still be asked for once. A second ask would only show with a
  // sound that takes its time: one that has not started yet while the click
  // travels up the page.
  it.each<[string, (box: HTMLElement) => HTMLElement]>([
    ['the window around the start box', () => button(START_TEXT)],
    ['the line "Free Play"', () => line(/^Free Play/)],
    ['a song', () => line(/^Play Twinkle/)],
    ['the line "All songs…"', () => line('All songs…')],
    ['the line "Settings"', () => line('Settings')],
    ['the line "About"', () => line('About')],
    ['a way to play that is not built yet', () => line(/^Practice/)],
    ['the name of the app', (box) => within(box).getByRole('heading', { level: 1 })],
    ['the title of a list', (box) => within(box).getByRole('heading', { name: 'Songs' })],
    ['the sentence at the foot of the box', (box) => within(box).getByText(START_TEXT)],
    ['the box itself, between two lines', (box) => box],
  ])('asks for the sound once, not twice, at a first click on %s', (_where, clicked) => {
    vi.spyOn(audio.engine, 'start').mockImplementation(() => {
      audio.state.starts += 1
      return Promise.resolve()
    })
    drawApp()
    clickWithMouse(clicked(startBox() as HTMLElement))
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)

    // Every later click asks again for as long as the sound has not started.
    clickWithMouse(emptySky())
    expect(audio.state.starts).toBe(2)
  })

  it('starts at a dropped file too: the Songs panel is not left behind the start box', async () => {
    drawApp()
    await dropFile('Dropped.mid')

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(await screen.findByText('"Dropped" was added.')).toBeTruthy()
    // The panel can be used: it has taken the keyboard focus, as when the mouse opens it.
    expect(document.activeElement).toBe(panel('Songs'))

    // A drop is not what the browser waits for: the sound starts at the next click or key press.
    expect(audio.state.starts).toBe(0)
    key('keydown', 'KeyA')
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([60])
  })

  it('leaves the function keys to the browser, and keyboard shortcuts alone', () => {
    drawApp()
    expect(key('keydown', 'KeyR', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(screen.getByText(START_TEXT)).toBeTruthy()

    expect(key('keydown', 'F5').defaultPrevented).toBe(false)
    expect(screen.queryByText(START_TEXT)).toBeNull()
  })

  it('leaves the Tab key to the browser and goes on waiting: Tab walks along the start box', () => {
    drawApp()
    expect(key('keydown', 'Tab', { key: 'Tab' }).defaultPrevented).toBe(false)
    key('keyup', 'Tab', { key: 'Tab' })

    expect(screen.getByText(START_TEXT)).toBeTruthy()
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(true)
    expect(audio.state.starts).toBe(0)
  })

  it('leaves Enter to the line of the start box that has the focus, which starts the app', () => {
    drawApp()
    const settingsLine = line('Settings')
    settingsLine.focus()
    for (const code of ['Enter', 'NumpadEnter']) {
      expect(key('keydown', code).defaultPrevented).toBe(false)
      key('keyup', code)
    }
    expect(screen.getByText(START_TEXT)).toBeTruthy()
    expect(audio.state.starts).toBe(0)

    // What the browser does with an Enter that is left to it: it clicks the line.
    pressEnterOn(settingsLine)
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
    expect(startBox()).toBeNull()
    expect(panel('Settings')).not.toBeNull()
  })

  it('starts at Enter when the focus is on the window around the start box, not on a line', () => {
    drawApp()
    button(START_TEXT).focus()
    expect(key('keydown', 'Enter').defaultPrevented).toBe(true)

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect(audio.state.starts).toBe(1)
  })

  it('does not ask for sound before the browser has counted a click or key press', () => {
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } })
    try {
      drawApp()
      key('keydown', 'Escape')
      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(audio.state.starts).toBe(0)

      vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } })
      tap('KeyA')
      expect(audio.state.starts).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('tries the sound again at the next click after it failed', () => {
    startApp()
    expect(audio.state.starts).toBe(1)
    act(() => {
      audio.state.status = 'error'
    })

    clickWithMouse(emptySky())
    expect(audio.state.starts).toBe(2)
  })

  it('keeps "how to play" back until the app has started', () => {
    drawApp()
    expect(screen.getByText(HINT).className).toBe('stage__hint stage__hint--gone')
    tap('Enter')
    expect(screen.getByText(HINT).className).toBe('stage__hint')
  })

  it('keeps the menu on screen', () => {
    vi.useFakeTimers()
    drawApp()
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 4)
    })
    expect(menu().className).toBe('menu')
    expect(root().className).toBe('app')
  })
})

describe('the light', () => {
  function light(): Record<string, string> {
    const style = root().style
    const names = ['--light', '--light-bright', '--light-deep', '--light-ink', '--glow']
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
  }

  it('is red at first: the colours the stylesheet starts with', () => {
    drawApp()
    expect(light()).toEqual({
      '--light': '#ff2a2a',
      '--light-bright': '#ffd4d4',
      '--light-deep': '#8c0000',
      '--light-ink': '#000000',
      '--glow': '0.6',
    })
  })

  it('follows the colour and the glow the player chooses', () => {
    startApp()
    act(() => settingsStore.set({ accent: 'blue', glow: 0.25 }))
    expect(light()['--light']).toBe('#2f8bff')
    expect(light()['--glow']).toBe('0.25')

    act(() => settingsStore.set({ accent: 'custom', customColour: '#000080' }))
    // A colour too dark to show on black is lifted, and what is written on it turns white.
    expect(light()['--light']).toBe('#0000fc')
    expect(light()['--light-ink']).toBe('#ffffff')

    act(() => settingsStore.set({ accent: 'rainbow' }))
    expect(light()['--light']).toBe('#9c7aff')
  })

  it('reaches the start box too, which is inside the element that carries it', () => {
    drawApp()
    expect(root().contains(screen.getByText(START_TEXT))).toBe(true)
    expect(root().contains(startBox())).toBe(true)

    // Where the Menu button puts it once the app has started, as well.
    tap('Enter')
    expect(root().contains(openStartBox())).toBe(true)
  })
})

describe('the start box', () => {
  it('is closed once the app has started', () => {
    startApp()
    expect(startBox()).toBeNull()
    expect(button('Menu').getAttribute('aria-expanded')).toBe('false')
    expect(button('Menu').hasAttribute('aria-controls')).toBe(false)
  })

  it('opens from the Menu button, which points at it, and closes from it again', () => {
    drawApp()
    // While the app waits to start, the box is open and the button says so.
    expect(button('Menu').getAttribute('aria-expanded')).toBe('true')
    expect(button('Menu').getAttribute('aria-controls')).toBe(startBox()?.id)
    tap('Enter')

    clickWithMouse(button('Menu'))
    expect(startBox()).not.toBeNull()
    expect(button('Menu').getAttribute('aria-expanded')).toBe('true')
    expect(button('Menu').getAttribute('aria-controls')).toBe(startBox()?.id)

    clickWithMouse(button('Menu'))
    expect(startBox()).toBeNull()
    expect(button('Menu').getAttribute('aria-expanded')).toBe('false')
    expect(button('Menu').hasAttribute('aria-controls')).toBe(false)
  })

  it('says how to close it once the app has started, where the window is no start button', () => {
    startApp()
    const box = openStartBox()
    expect(within(box).getByText(CLOSE_TEXT)).toBeTruthy()
    expect(within(box).getByRole('heading', { level: 1 }).textContent).toBe(APP_NAME)
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(screen.queryByRole('button', { name: START_TEXT })).toBeNull()
  })

  it('comes before the piano for the Tab key, and after the menu', () => {
    startApp()
    const box = openStartBox()
    expect(follows(menu(), box)).toBe(true)
    expect(follows(box, piano())).toBe(true)
  })

  it('closes at "Free Play", the way of playing that is on, and keeps a loaded song loaded', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    openStartBox()
    expect(line(/^Free Play/).getAttribute('aria-pressed')).toBe('true')

    clickWithMouse(line(/^Free Play/))
    expect(startBox()).toBeNull()
    expect(panel('Settings') ?? panel('Songs')).toBeNull()
    expect(player.getState()).toMatchObject({ status: 'playing', songId: A_STARTER_SONG })
  })

  it('closes at Escape, and that is all', () => {
    startApp()
    openStartBox()
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(startBox()).toBeNull()
    expect(heldNotes()).toEqual([])
  })

  it('closes at a press of the mouse outside it, not inside it or on the Menu button', () => {
    startApp()
    const box = openStartBox()
    fireEvent.pointerDown(box)
    fireEvent.pointerDown(within(box).getByRole('heading', { level: 1 }))
    fireEvent.pointerDown(line('Settings'))
    fireEvent.pointerDown(button('Menu'))
    expect(startBox()).toBe(box)

    fireEvent.pointerDown(emptySky())
    expect(startBox()).toBeNull()

    // The rest of the menu is outside the box as well.
    openStartBox()
    fireEvent.pointerDown(within(menu()).getByRole('slider', { name: 'Volume' }))
    expect(startBox()).toBeNull()
  })

  it('closes at a computer key that plays a note, and the note is played', () => {
    startApp()
    openStartBox()
    key('keydown', 'KeyA')
    expect(startBox()).toBeNull()
    expect(heldNotes()).toEqual([60])
  })

  it('stays open at a computer key that plays no note', () => {
    startApp()
    const box = openStartBox()
    tap('KeyQ')
    tap('Enter')
    tap('Space')
    expect(startBox()).toBe(box)
    expect(heldNotes()).toEqual([])
    // Space is still the sustain key.
    expect(settingsStore.get().sustain).toBe(true)
  })

  it('keeps "how to play" back while it is open', () => {
    startApp()
    expect(screen.getByText(HINT).className).toBe('stage__hint')
    openStartBox()
    expect(screen.getByText(HINT).className).toBe('stage__hint stage__hint--gone')
    tap('Escape')
    expect(screen.getByText(HINT).className).toBe('stage__hint')
  })

  it('makes way for the Songs panel when a file is dropped on the page', async () => {
    startApp()
    openStartBox()
    await dropFile('Dropped.mid')

    expect(startBox()).toBeNull()
    expect(await screen.findByText('"Dropped" was added.')).toBeTruthy()
    expect(panel('Songs')).not.toBeNull()
  })
})

describe('the two panels', () => {
  it('are closed at first', () => {
    startApp()
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).toBeNull()
    // So is the start box they open from: the Menu button says that nothing is open.
    expect(startBox()).toBeNull()
    expect(button('Menu').getAttribute('aria-expanded')).toBe('false')
  })

  it('open from their lines of the start box, which they take the place of', () => {
    startApp()
    clickWithMouse(button('Menu'))
    clickWithMouse(line('Settings'))
    expect(panel('Settings')).not.toBeNull()
    expect(startBox()).toBeNull()
    // The Menu button speaks for the start box, which is closed, not for the panel.
    expect(button('Menu').getAttribute('aria-expanded')).toBe('false')
    expect(button('Menu').hasAttribute('aria-controls')).toBe(false)

    // The Menu button puts the start box back in the panel's place.
    clickWithMouse(button('Menu'))
    expect(panel('Settings')).toBeNull()
    expect(button('Menu').getAttribute('aria-controls')).toBe(startBox()?.id)

    clickWithMouse(line('All songs…'))
    expect(panel('Songs')).not.toBeNull()
    expect(startBox()).toBeNull()
    clickWithMouse(button('Menu'))
    expect(panel('Songs')).toBeNull()
    expect(startBox()).not.toBeNull()
  })

  it('open on the About tab of Settings from the line "About" of the start box', () => {
    startApp()
    openSettingsOn('Sound')
    clickWithMouse(button('Close Settings'))

    clickWithMouse(button('Menu'))
    clickWithMouse(line('About'))
    expect(startBox()).toBeNull()
    const about = within(panel('Settings') as HTMLElement).getByRole('tab', { name: 'About' })
    expect(about.getAttribute('aria-selected')).toBe('true')
  })

  it('are never open together, nor with the start box: opening one closes the other', () => {
    startApp()
    openPanel('Settings')
    // The way from one panel to the other goes through the start box.
    clickWithMouse(button('Menu'))
    expect(startBox()).not.toBeNull()
    expect(panel('Settings')).toBeNull()

    clickWithMouse(line('All songs…'))
    expect(panel('Songs')).not.toBeNull()
    expect(panel('Settings')).toBeNull()
    expect(startBox()).toBeNull()

    clickWithMouse(button('Menu'))
    clickWithMouse(line('Settings'))
    expect(panel('Settings')).not.toBeNull()
    expect(panel('Songs')).toBeNull()
    expect(startBox()).toBeNull()
  })

  it.each(['Settings', 'Songs'] as const)('%s closes with its own close button', (name) => {
    startApp()
    openPanel(name)
    clickWithMouse(button(`Close ${name}`))
    expect(panel(name)).toBeNull()
  })

  it.each(['Settings', 'Songs'] as const)('%s closes at Escape, and that is all', (name) => {
    startApp()
    openPanel(name)
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(panel(name)).toBeNull()
    expect(heldNotes()).toEqual([])
  })

  it('leave Escape to the browser when none is open', () => {
    startApp()
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
  })

  it.each(['Settings', 'Songs'] as const)('%s closes at a click on the empty sky', (name) => {
    startApp()
    openPanel(name)
    clickWithMouse(emptySky())
    expect(panel(name)).toBeNull()
  })

  it('stay open at a click on the piano or inside the panel', () => {
    startApp()
    const settings = openSettingsOn('Sound')
    fireEvent.click(pianoKey(60))
    fireEvent.click(piano())
    fireEvent.click(settings)
    clickWithMouse(within(settings).getByRole('switch', { name: 'Sustain' }))
    expect(panel('Settings')).not.toBeNull()
    expect(settingsStore.get().sustain).toBe(true)
  })

  it('let the piano play under them', () => {
    startApp()
    openSettingsOn('Look')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(panel('Settings')).not.toBeNull()
  })

  it('come before the piano for the Tab key, and after the menu', () => {
    startApp()
    const settings = openPanel('Settings')
    expect(follows(menu(), settings)).toBe(true)
    expect(follows(settings, piano())).toBe(true)
  })

  it('leave a text field its own Escape', async () => {
    await addSong('Tune.mid')
    startApp()
    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: 'Rename Tune' }))
    const field = within(songs).getByRole('textbox', { name: 'Song name' })
    field.focus()

    fireEvent.keyDown(field, { code: 'Escape', key: 'Escape' })

    expect(panel('Songs')).not.toBeNull()
    expect(within(songs).queryByRole('textbox', { name: 'Song name' })).toBeNull()
  })

  it('open on Songs when a file is dropped on the page', async () => {
    startApp()
    openPanel('Settings')
    await dropFile('Dropped.mid')

    expect(panel('Settings')).toBeNull()
    expect(await screen.findByText('"Dropped" was added.')).toBeTruthy()
    expect(panel('Songs')).not.toBeNull()
  })
})

describe('choosing the computer keys', () => {
  it('is on exactly while Settings shows its Keys tab', () => {
    startApp()
    expect(isChoosingKeys()).toBe(false)

    const settings = openSettingsOn('Keys')
    expect(isChoosingKeys()).toBe(true)

    clickWithMouse(within(settings).getByRole('tab', { name: 'Piano' }))
    expect(isChoosingKeys()).toBe(false)
    clickWithMouse(within(settings).getByRole('tab', { name: 'Keys' }))
    expect(isChoosingKeys()).toBe(true)

    clickWithMouse(button('Close Settings'))
    expect(isChoosingKeys()).toBe(false)
  })

  it('is on again when Settings opens on the Keys tab it was left on', () => {
    startApp()
    openSettingsOn('Keys')
    clickWithMouse(emptySky())
    expect(isChoosingKeys()).toBe(false)

    openPanel('Settings')
    expect(isChoosingKeys()).toBe(true)
  })

  it('ends when the start box, and then the Songs panel, takes the place of Settings', () => {
    startApp()
    openSettingsOn('Keys')
    expect(isChoosingKeys()).toBe(true)

    clickWithMouse(button('Menu'))
    expect(panel('Settings')).toBeNull()
    expect(isChoosingKeys()).toBe(false)

    clickWithMouse(line('All songs…'))
    expect(panel('Songs')).not.toBeNull()
    expect(isChoosingKeys()).toBe(false)
  })

  it('works under StrictMode, where React draws everything twice', () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    tap('Enter')
    openSettingsOn('Keys')
    expect(isChoosingKeys()).toBe(true)
    tap('Escape')
    expect(isChoosingKeys()).toBe(false)
    expect(panel('Settings')).toBeNull()
  })

  it('always shows the keycaps, whatever the Labels setting, which it leaves alone', () => {
    act(() => settingsStore.set({ labelMode: 'none' }))
    startApp()
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(0)

    openSettingsOn('Keys')
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(18)
    expect(settingsStore.get().labelMode).toBe('none')

    tap('Escape')
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(0)
  })

  it('gives a piano key the next computer key pressed, and says so in the tab', () => {
    startApp()
    const settings = openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    expect(pianoKey(64).classList.contains('is-selected')).toBe(true)
    expect(within(settings).getByText('Press a key for E4…')).toBeTruthy()

    key('keydown', 'KeyM', { key: 'm' })
    key('keyup', 'KeyM', { key: 'm' })

    expect(settingsStore.get().bindings.KeyM).toBe(16)
    expect(heldNotes()).toEqual([])
    expect(pianoKey(64).getAttribute('aria-label')).toBe('E4, key M')
    expect(within(settings).getByText(/"M" now plays E4\./)).toBeTruthy()

    key('keydown', 'KeyM', { key: 'm' })
    expect(heldNotes()).toEqual([64])
  })

  it('keeps "how to play" back, where a click on the piano does something else', () => {
    startApp()
    openSettingsOn('Keys')
    expect(screen.getByText(HINT).className).toBe('stage__hint stage__hint--gone')
    tap('Escape')
    expect(screen.getByText(HINT).className).toBe('stage__hint')
  })
})

describe('Escape, one thing at a time', () => {
  it('first lets go of the piano key that is waiting, then closes the panel', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(panel('Settings')).not.toBeNull()
    expect(isChoosingKeys()).toBe(true)
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(panel('Settings')).toBeNull()
    expect(isChoosingKeys()).toBe(false)
  })

  it('held down after cancelling a selection does not also close the panel', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))

    key('keydown', 'Escape')
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    }
    expect(panel('Settings')).not.toBeNull()
    expect(isChoosingKeys()).toBe(true)
  })

  it('changes no key and no setting', () => {
    startApp()
    const before = settingsStore.get()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    tap('Escape')
    tap('Escape')
    expect(settingsStore.get()).toBe(before)
  })

  function songOptions(): HTMLElement | null {
    return screen.queryByRole('group', { name: 'Song options' })
  }

  it('closes the song options before the panel, and the panel at the next press', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    openPanel('Songs')
    clickWithMouse(button('Song options'))
    expect(songOptions()).not.toBeNull()

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(songOptions()).toBeNull()
    expect(panel('Songs')).not.toBeNull()

    // Still held down: it has closed its one thing.
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    }
    expect(panel('Songs')).not.toBeNull()
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(panel('Songs')).toBeNull()
    // Escape is not a button of the player: the song goes on.
    expect(player.getState().status).toBe('playing')
  })

  it('held down since before the song options were opened does not close them', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    key('keydown', 'Escape')
    clickWithMouse(button('Song options'))

    expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    expect(songOptions()).not.toBeNull()

    key('keyup', 'Escape')
    tap('Escape')
    expect(songOptions()).toBeNull()
  })

  it('lets go of the piano key that is waiting before it closes the song options', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    clickWithMouse(button('Song options'))
    expect(pianoKey(64).classList.contains('is-selected')).toBe(true)

    tap('Escape')
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(songOptions()).not.toBeNull()

    tap('Escape')
    expect(songOptions()).toBeNull()
    expect(panel('Settings')).not.toBeNull()
  })

  it('closes song options that were used with the keyboard, then lets go of the menu', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    pressEnterOn(button('Song options'))
    within(songOptions() as HTMLElement).getByRole('switch', { name: 'Melody only' }).focus()

    // 1. The options close. The focus is not lost with them: it is on their button.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(songOptions()).toBeNull()
    expect(document.activeElement).toBe(button('Song options'))
    // Held down, it does not go on to take the focus away.
    expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(button('Song options'))
    key('keyup', 'Escape')

    // 2. The menu lets go of the keyboard.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(document.body)
    // Held down after that, there is nothing left to take back.
    expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(false)
    key('keyup', 'Escape')

    // 3. Nothing is left: the key is the browser's.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
    expect(screen.getByRole('region', { name: 'Song player' })).toBeTruthy()
  })

  it('closes the song options before the start box, and the box at the next press', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    openStartBox()
    // With Enter: a press of the mouse on the player line would close the start box.
    pressEnterOn(button('Song options'))
    expect(songOptions()).not.toBeNull()
    expect(startBox()).not.toBeNull()

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(songOptions()).toBeNull()
    expect(startBox()).not.toBeNull()

    // Still held down: it has closed its one thing.
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    }
    expect(startBox()).not.toBeNull()
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(startBox()).toBeNull()
    expect(player.getState().status).toBe('playing')
  })

  it('closes a panel, then lets go of the Menu button the focus went back to', () => {
    startApp()
    // With the keyboard alone: Enter on the Menu button, then on "Settings" in the start box.
    pressEnterOn(button('Menu'))
    pressEnterOn(line('Settings'))
    expect(panel('Settings')).not.toBeNull()

    tap('Escape')
    expect(panel('Settings')).toBeNull()
    expect(document.activeElement).toBe(button('Menu'))

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(document.body)
    expect(heldNotes()).toEqual([])
  })

  it('closes the start box, then lets go of the Menu button the focus went back to', () => {
    startApp()
    pressEnterOn(button('Menu'))
    expect(startBox()?.contains(document.activeElement)).toBe(true)

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(startBox()).toBeNull()
    expect(document.activeElement).toBe(button('Menu'))
    // Held down, it does not go on to take the focus away.
    expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(button('Menu'))
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(document.body)
    key('keyup', 'Escape')

    // Nothing is left: the key is the browser's.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
  })

  it('takes the keyboard focus off any control of the menu, and changes nothing with it', () => {
    startApp()
    const before = settingsStore.get()
    for (const control of [
      within(menu()).getByRole('button', { name: 'Menu' }),
      within(menu()).getByRole('slider', { name: 'Volume' }),
      within(menu()).getByRole('switch', { name: 'Sustain' }),
    ]) {
      control.focus()
      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(document.body)
      key('keyup', 'Escape')
    }
    expect(settingsStore.get()).toBe(before)
  })
})

describe('the labels', () => {
  function keycap(midi: number): string | undefined {
    return pianoKey(midi).querySelector('.piano-key__cap')?.textContent ?? undefined
  }

  it('on the piano are the letters of the keyboard type the player chose', () => {
    startApp()
    expect(keycap(60)).toBe('A')
    expect(keycap(61)).toBe('W')

    act(() => settingsStore.set({ keyboardType: 'azerty' }))
    expect(keycap(60)).toBe('Q')
    expect(keycap(61)).toBe('Z')

    act(() => settingsStore.set({ keyboardType: 'qwertz' }))
    expect(keycap(60)).toBe('A')
    expect(keycap(68)).toBe('Z')
  })

  it('on falling notes say which computer key plays each note', () => {
    startApp()
    const hints = skyProps().hints
    expect(hints.size).toBe(18)
    expect(hints.get(60)).toBe('A')
    expect(hints.get(61)).toBe('W')
    expect(hints.get(77)).toBe("'")
    expect(hints.has(59)).toBe(false)
  })

  it('on falling notes move with the computer keys and follow the keyboard type', () => {
    startApp()
    act(() => settingsStore.set({ baseOctave: 2, keyboardType: 'azerty' }))
    expect(skyProps().hints.get(48)).toBe('Q')
    expect(skyProps().hints.get(60)).toBe('K')
    expect(skyProps().hints.has(66)).toBe(false)
  })

  it('on falling notes are none at all when the player switched them off', () => {
    startApp()
    act(() => settingsStore.set({ showKeyHints: false }))
    expect(skyProps().hints.size).toBe(0)

    act(() => settingsStore.set({ showKeyHints: true }))
    expect(skyProps().hints.get(60)).toBe('A')
  })

  it('on falling notes are one and the same map until a label changes', () => {
    // The sky draws again whenever it is given another map.
    startApp()
    const before = skyProps().hints
    act(() => settingsStore.set({ volume: 0.3, accent: 'green', sustain: true }))
    tap('KeyA')
    openPanel('Settings')
    expect(skyProps().hints).toBe(before)

    act(() => settingsStore.set({ showKeyHints: false }))
    const none = skyProps().hints
    act(() => settingsStore.set({ volume: 0.5 }))
    expect(skyProps().hints).toBe(none)
  })
})

describe('the piano on screen', () => {
  it('is the one the sky draws its light for', () => {
    startApp()
    for (const pianoSize of [88, 61, 49, 37, 'auto'] as const) {
      act(() => settingsStore.set({ pianoSize }))
      const notes = [...piano().querySelectorAll<HTMLElement>('.piano-key')].map((pianoKey) =>
        Number(pianoKey.dataset.midi),
      )
      expect(skyProps().range).toEqual({ first: Math.min(...notes), last: Math.max(...notes) })
    }
  })

  it('lets go of every held note when it becomes another piano', () => {
    startApp()
    key('keydown', 'KeyA')
    act(() => bus.noteOn(72, 'pointer'))
    expect(heldNotes()).toEqual([60, 72])

    act(() => settingsStore.set({ pianoSize: 61 }))
    expect(heldNotes()).toEqual([])

    // The key is still down: letting go of it later does nothing, and it plays again after that.
    key('keyup', 'KeyA')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('lets go of every held note when the computer keys move lower or higher', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    act(() => settingsStore.set({ baseOctave: 4 }))
    expect(heldNotes()).toEqual([])
  })

  it('keeps held notes when something else changes', () => {
    startApp()
    key('keydown', 'KeyA')
    act(() => settingsStore.set({ accent: 'amber', keyStyle: 'glass', volume: 0.4 }))
    act(() => settingsStore.set({ labelMode: 'none', sustain: true }))
    openPanel('Songs')
    expect(panel('Songs')).not.toBeNull()
    expect(heldNotes()).toEqual([60])
  })

  it('lets go of every held note when the app goes away', () => {
    startApp()
    key('keydown', 'KeyA')
    cleanup()
    expect(heldNotes()).toEqual([])
  })

  it('plays the notes of the mouse as hard as the Touch setting says', () => {
    act(() => settingsStore.set({ velocity: 0.35 }))
    startApp()
    const heard: number[] = []
    const stop = bus.subscribe((event) => {
      if (event.type === 'on') heard.push(event.velocity)
    })

    piano().getBoundingClientRect = () => ({ left: 0, top: 0, width: 2200, height: 100 }) as DOMRect
    // The first white key. Nothing is measured here, so the piano is the smallest: it starts at C3.
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([48])
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    stop()

    expect(heard).toEqual([0.35])
    expect(heldNotes()).toEqual([])
  })
})

describe('a song in the player', () => {
  it('gives the sky its falling notes, and takes them away when it is closed', () => {
    startApp()
    expect(skyProps().falling).toBeNull()
    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()

    act(() => {
      playSong(A_STARTER_SONG)
    })
    const falling = skyProps().falling
    expect(falling?.getNotes().length).toBe(42)
    expect(falling?.isPlaying()).toBe(true)
    expect(menu().contains(screen.getByRole('region', { name: 'Song player' }))).toBe(true)
    expect(document.querySelector('.song-progress')).not.toBeNull()
    expect(menu().contains(document.querySelector('.song-progress'))).toBe(false)

    clickWithMouse(button('Close'))
    expect(skyProps().falling).toBeNull()
    expect(document.querySelector('.song-progress')).toBeNull()
  })

  it('is started from the Songs panel, which then gets out of the way', () => {
    startApp()
    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: /^Play Twinkle/ }))

    expect(panel('Songs')).toBeNull()
    expect(player.getState().status).toBe('playing')
    expect(button('Pause')).toBeTruthy()
  })

  it('is started from the start box, which then gets out of the way', () => {
    startApp()
    clickWithMouse(button('Menu'))
    clickWithMouse(line(/^Play Twinkle/))

    expect(startBox()).toBeNull()
    expect(panel('Songs')).toBeNull()
    expect(player.getState()).toMatchObject({ status: 'playing', songId: A_STARTER_SONG })
    expect(button('Pause')).toBeTruthy()
  })

  it('that cannot be read is not started from the start box: the Songs panel says so', async () => {
    const lost = await addSong('Lost.mid')
    window.localStorage.removeItem(`pianoapp.song.v1.${lost.id}`)
    expect(songLibrary.get(lost.id)).toBeNull()
    startApp()
    clickWithMouse(button('Menu'))
    clickWithMouse(line('Play Lost'))

    expect(startBox()).toBeNull()
    expect(player.getState().status).toBe('empty')
    expect(within(panel('Songs') as HTMLElement).getByText(UNREADABLE_SONG_MESSAGE)).toBeTruthy()
  })

  it('is arranged for the piano on screen', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const onFullPiano = skyProps().falling

    act(() => settingsStore.set({ pianoSize: 37 }))
    expect(skyProps().range).toEqual({ first: 48, last: 84 })
    expect(skyProps().falling).not.toBe(onFullPiano)
    expect(skyProps().falling?.getNotes().length).toBe(42)
  })
})

describe('the menu', () => {
  function wait(milliseconds: number): void {
    act(() => {
      vi.advanceTimersByTime(milliseconds)
    })
  }

  function isHidden(): boolean {
    return menu().classList.contains('menu--hidden')
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('hides when the mouse has been still for a while, and the mouse cursor with it', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    expect(root().className).toBe('app')

    wait(1)
    expect(isHidden()).toBe(true)
    expect(root().className).toBe('app cursor-hidden')
  })

  it('comes back when the mouse moves, not when the piano is played', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    tap('KeyA')
    expect(isHidden()).toBe(true)

    fireEvent.mouseMove(document.body, { screenX: 10, screenY: 10 })
    expect(isHidden()).toBe(false)
    expect(root().className).toBe('app')
  })

  it('stays while a panel is open, and gets its full time again when it closes', () => {
    startApp()
    openPanel('Settings')
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    tap('Escape')
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
  })

  it('stays while the start box is open, and gets its full time again when it closes', () => {
    startApp()
    openStartBox()
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
    expect(root().className).toBe('app')

    tap('Escape')
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
  })

  it('hides while a song plays, and stays while a song is loaded but not playing', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)

    act(() => player.pause())
    expect(isHidden()).toBe(false)
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    act(() => player.play())
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)

    act(() => player.stop())
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
  })

  it('never hides when the player switched that off, and the sky then starts below it', () => {
    act(() => settingsStore.set({ autoHideMenu: false }))
    startApp()
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
    // The stage is the part of the page named after the way of playing that is on.
    expect(screen.getByRole('region', { name: 'Free Play' }).className).toBe(
      'stage stage--below-menu',
    )

    act(() => settingsStore.set({ autoHideMenu: true }))
    expect(screen.getByRole('region', { name: 'Free Play' }).className).toBe('stage')
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)
  })

  // "Close" takes the player line away from under the mouse, which is then
  // over the sky without having moved. Nothing says that it left the menu.
  // What a browser does say then depends on the browser.
  it.each([
    [
      'that the mouse is over the sky now',
      () => fireEvent.mouseOver(emptySky(), { relatedTarget: menu() }),
    ],
    [
      'a "move" to where the mouse already is',
      () => fireEvent.mouseMove(emptySky(), { screenX: 900, screenY: 80 }),
    ],
  ])(
    'hides again after "Close" under a mouse that stands still (the browser says %s)',
    (_what, browserSays) => {
      startApp()
      act(() => {
        playSong(A_STARTER_SONG)
      })
      const close = button('Close')
      fireEvent.mouseOver(close)
      fireEvent.mouseMove(close, { screenX: 900, screenY: 80 })
      wait(AUTO_HIDE_DELAY_MS * 4)
      expect(isHidden()).toBe(false)

      clickWithMouse(close)
      browserSays()

      wait(AUTO_HIDE_DELAY_MS - 1)
      expect(isHidden()).toBe(false)
      wait(1)
      expect(isHidden()).toBe(true)
      expect(root().className).toBe('app cursor-hidden')
    },
  )

  it('hides again once Escape has taken the keyboard focus out of it', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    // Tab brings the menu back and puts the focus on its first control, where it stays.
    key('keydown', 'Tab', { key: 'Tab' })
    key('keyup', 'Tab', { key: 'Tab' })
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
    expect(menu().contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(button('Menu'))

    tap('Escape')
    expect(document.activeElement).toBe(document.body)
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('leaves a sign on the stage when Space switches sustain while it is hidden', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    expect(within(emptySky()).queryByText('Sustain on')).toBeNull()

    tap('Space')
    expect(isHidden()).toBe(true)
    expect(within(emptySky()).getByText('Sustain on')).toBeTruthy()

    tap('Space')
    expect(within(emptySky()).queryByText('Sustain on')).toBeNull()
  })
})

describe('the keyboard focus', () => {
  it('is not taken by the start box while the app waits to start: nobody has opened it', () => {
    drawApp()
    expect(document.activeElement).toBe(document.body)
  })

  it('is given back to the piano after a click with the mouse', () => {
    startApp()
    clickWithMouse(button('Menu'))
    expect(document.activeElement).not.toBe(button('Menu'))
    // A line of the start box hands it to the Menu button, which lets go of it as well.
    clickWithMouse(line('Settings'))
    expect(document.activeElement).not.toBe(button('Menu'))
    expect(menu().contains(document.activeElement)).toBe(false)

    const sustain = within(menu()).getByRole('switch', { name: 'Sustain' })
    clickWithMouse(sustain)
    expect(document.activeElement).not.toBe(sustain)
    const volume = within(menu()).getByRole('slider', { name: 'Volume' })
    clickWithMouse(volume)
    expect(document.activeElement).not.toBe(volume)
  })

  it('stays where it is for someone who presses a button with Enter', () => {
    startApp()
    const sustain = within(menu()).getByRole('switch', { name: 'Sustain' })
    pressEnterOn(sustain)
    expect(document.activeElement).toBe(sustain)
    expect(settingsStore.get().sustain).toBe(true)
  })

  it('goes into the start box opened with Enter, and back to the Menu button at Escape', () => {
    startApp()
    pressEnterOn(button('Menu'))
    // Its first line, not the box itself: Enter then presses something.
    expect(document.activeElement).toBe(line(/^Free Play/))

    tap('Escape')
    expect(startBox()).toBeNull()
    expect(document.activeElement).toBe(button('Menu'))
  })

  it('goes into Settings opened with Enter, and back to the Menu button at Escape', () => {
    startApp()
    // Enter on the Menu button, then on "Settings" in the start box.
    pressEnterOn(button('Menu'))
    pressEnterOn(line('Settings'))
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(settings.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(settings)

    tap('Escape')
    expect(document.activeElement).toBe(button('Menu'))
  })

  it('goes to the Menu button when choosing keys ends while a piano key has it', () => {
    startApp()
    openSettingsOn('Keys')
    pianoKey(64).focus()
    expect(document.activeElement).toBe(pianoKey(64))

    tap('Escape')
    expect(document.activeElement).toBe(button('Menu'))
  })

  it('goes to the Menu button when Enter on "Close" takes the player line away', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    pressEnterOn(button('Close'))

    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()
    expect(document.activeElement).toBe(button('Menu'))
  })

  it('is not put on the Menu button when "Close" is clicked with the mouse', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    clickWithMouse(button('Close'))
    expect(document.activeElement).toBe(document.body)
  })

  describe('when the start box was opened with the mouse', () => {
    it('is held by the box itself, and left nowhere when Escape closes the box', () => {
      startApp()
      const box = openStartBox()
      expect(document.activeElement).toBe(box)

      tap('Escape')
      expect(startBox()).toBeNull()
      expect(document.activeElement).toBe(document.body)
    })

    it('is left nowhere after a click on a line, on the Menu button or on the empty sky', () => {
      startApp()
      openStartBox()
      clickWithMouse(line(/^Free Play/))
      expect(startBox()).toBeNull()
      expect(document.activeElement).toBe(document.body)

      openStartBox()
      clickWithMouse(button('Menu'))
      expect(startBox()).toBeNull()
      expect(document.activeElement).toBe(document.body)

      // A line of the box has the focus when the sky is clicked.
      openStartBox()
      line('Settings').focus()
      clickWithMouse(emptySky())
      expect(startBox()).toBeNull()
      expect(document.activeElement).toBe(document.body)
    })

    it('goes to the Menu button when Escape closes the box under a line that has it', () => {
      startApp()
      openStartBox()
      line('All songs…').focus()

      tap('Escape')
      expect(startBox()).toBeNull()
      expect(document.activeElement).toBe(button('Menu'))
    })

    it('goes to the Menu button at Enter on "Free Play"', () => {
      startApp()
      openStartBox()
      pressEnterOn(line(/^Free Play/))

      expect(startBox()).toBeNull()
      expect(document.activeElement).toBe(button('Menu'))
    })

    it('goes to the Menu button when Enter on a song closes the box', () => {
      startApp()
      openStartBox()
      pressEnterOn(line(/^Play Twinkle/))

      expect(startBox()).toBeNull()
      expect(player.getState().status).toBe('playing')
      expect(document.activeElement).toBe(button('Menu'))
    })

    it('goes to the Menu button when a note is played while a line has it', () => {
      startApp()
      openStartBox()
      line('Settings').focus()

      key('keydown', 'KeyA')
      expect(startBox()).toBeNull()
      expect(heldNotes()).toEqual([60])
      expect(document.activeElement).toBe(button('Menu'))
    })

    it('stays in the menu, which therefore does not hide', () => {
      vi.useFakeTimers()
      startApp()
      openStartBox()
      pressEnterOn(line(/^Free Play/))

      act(() => {
        vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 4)
      })
      expect(document.activeElement).toBe(button('Menu'))
      expect(menu().className).toBe('menu')
    })
  })

  describe('when a panel was opened with the mouse and is then used with the keyboard', () => {
    it('goes to the Menu button when Escape closes the panel under a focused control', () => {
      startApp()
      const settings = openSettingsOn('Sound')
      within(settings).getByRole('slider', { name: 'Volume' }).focus()

      tap('Escape')
      expect(panel('Settings')).toBeNull()
      expect(document.activeElement).toBe(button('Menu'))
    })

    it.each(['Settings', 'Songs'] as const)(
      'goes to the Menu button at Enter on "Close %s"',
      (name) => {
        startApp()
        openPanel(name)
        pressEnterOn(button(`Close ${name}`))

        expect(panel(name)).toBeNull()
        expect(document.activeElement).toBe(button('Menu'))
      },
    )

    it('goes to the Menu button when Enter on "Play" closes the Songs panel', () => {
      startApp()
      const songs = openPanel('Songs')
      pressEnterOn(within(songs).getByRole('button', { name: /^Play Twinkle/ }))

      expect(panel('Songs')).toBeNull()
      expect(document.activeElement).toBe(button('Menu'))
    })

    it('stays in the menu, which therefore does not hide', () => {
      vi.useFakeTimers()
      startApp()
      openPanel('Settings')
      pressEnterOn(button('Close Settings'))

      act(() => {
        vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 4)
      })
      expect(document.activeElement).toBe(button('Menu'))
      expect(menu().className).toBe('menu')
    })
  })

  describe('when a panel was only ever used with the mouse', () => {
    it('is left nowhere when Escape closes the panel, which held it itself', () => {
      startApp()
      const settings = openPanel('Settings')
      expect(document.activeElement).toBe(settings)

      tap('Escape')
      expect(document.activeElement).toBe(document.body)
    })

    it.each(['Settings', 'Songs'] as const)(
      'is left nowhere after a click on "Close %s" or on the empty sky',
      (name) => {
        startApp()
        openPanel(name)
        clickWithMouse(button(`Close ${name}`))
        expect(document.activeElement).toBe(document.body)

        // A control of the panel has the focus when the sky is clicked.
        openPanel(name)
        button(`Close ${name}`).focus()
        clickWithMouse(emptySky())
        expect(panel(name)).toBeNull()
        expect(document.activeElement).toBe(document.body)
      },
    )
  })
})

describe('React work per note', () => {
  it('leaves the menu and the panels alone: only the stage follows the notes', () => {
    startApp()
    const settings = openSettingsOn('Sound')
    const records: MutationRecord[] = []
    const observer = new MutationObserver((batch) => {
      records.push(...batch)
    })
    const everything = { attributes: true, childList: true, characterData: true, subtree: true }
    observer.observe(menu(), everything)
    observer.observe(settings, everything)

    tap('KeyA')
    tap('KeyK')
    records.push(...observer.takeRecords())
    observer.disconnect()

    expect(records).toEqual([])
  })
})
