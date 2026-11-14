// @vitest-environment jsdom
/**
 * The app shell under rough handling: Escape in every situation, clicks that
 * must and must not close a panel or the start box, going back and forth
 * between Settings and Songs, choosing keys while notes are held, the focus
 * after a click with the mouse, Space with every kind of control focused, the
 * start box before the first click, the sound status, what screen readers
 * are told, and React drawing everything twice.
 *
 * The sound engine and the sky are stand-ins; each has tests of its own.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
import { settingsStore } from './state/settings'
import { addSong, resetSongs } from './ui/songsTestKit'
import { LEAD_IN_SECONDS, closeSong, playSong } from './ui/useSongs'

const START_TEXT = 'Click or press any key to start'
const HINT = 'Press the keys shown on the piano, or click it'
const A_STARTER_SONG = 'starter:twinkle-twinkle-little-star'

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  audio.state.starts = 0
  audio.state.notesOn = []
  audio.state.notesOff = []
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
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

/** Draws the app and starts it: the first key press takes the start box away. */
function startApp(): void {
  render(<App />)
  tap('Enter')
}

function menu(): HTMLElement {
  return document.querySelector('.menu') as HTMLElement
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function panel(name: 'Settings' | 'Songs'): HTMLElement | null {
  return screen.queryByRole('dialog', { name })
}

/** The start box: the small menu the app opens with, and that the Menu button opens again. */
function startBox(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Menu' })
}

/** The start box, opened with a click on the Menu button when it is not open already. */
function openStartBox(): HTMLElement {
  if (!startBox()) clickWithMouse(button('Menu'))
  return screen.getByRole('dialog', { name: 'Menu' })
}

/** The line of the start box that opens each panel. */
const LINE_OF = { Settings: 'Settings', Songs: 'All songs…' } as const

/** Opens a panel with the mouse: the Menu button, then the panel's line of the start box. */
function openPanel(name: 'Settings' | 'Songs'): HTMLElement {
  if (!panel(name)) {
    clickWithMouse(within(openStartBox()).getByRole('button', { name: LINE_OF[name] }))
  }
  return screen.getByRole('dialog', { name })
}

/** Opens a panel with the keyboard alone: Enter on "Menu", then Enter on the panel's line. */
function openPanelWithEnter(name: 'Settings' | 'Songs'): HTMLElement {
  if (!startBox()) pressEnterOn(button('Menu'))
  pressEnterOn(button(LINE_OF[name]))
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

function sustain(): boolean {
  return settingsStore.get().sustain
}

describe('Escape', () => {
  it('closes the panel when a slider or a button inside it has the focus', () => {
    startApp()
    const settings = openSettingsOn('Sound')
    within(settings).getByRole('slider', { name: 'Volume' }).focus()
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(panel('Settings')).toBeNull()
    // The slider went away with the panel: the focus is on the Menu button, which the
    // panel was opened through, not lost.
    expect(document.activeElement).toBe(button('Menu'))
    key('keyup', 'Escape')

    openSettingsOn('Sound')
    button('Close Settings').focus()
    tap('Escape')
    expect(panel('Settings')).toBeNull()
    expect(document.activeElement).toBe(button('Menu'))
  })

  it('closes the start box like a panel: a line that had the focus hands it to "Menu"', () => {
    startApp()
    // Opened with Enter, the box puts the focus on its first line.
    pressEnterOn(button('Menu'))
    expect(document.activeElement).toBe(button(/Free Play/))
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(startBox()).toBeNull()
    expect(document.activeElement).toBe(button('Menu'))
    key('keyup', 'Escape')
    expect(button('Menu').getAttribute('aria-expanded')).toBe('false')

    // Opened with the mouse, the box holds the focus itself: nothing is given the
    // focus when it closes, and nothing is left for a second press to take back.
    clickWithMouse(button('Menu'))
    expect(document.activeElement).toBe(startBox())
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    key('keyup', 'Escape')
    expect(startBox()).toBeNull()
    expect(document.activeElement).toBe(document.body)
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
  })

  it('pressed in the Labels drop-down belongs to the drop-down: the panel stays', () => {
    startApp()
    const settings = openSettingsOn('Piano')
    const labels = within(settings).getByRole('combobox', { name: 'Labels on the keys' })
    labels.focus()

    expect(key('keydown', 'Escape', { key: 'Escape' }).defaultPrevented).toBe(false)
    key('keyup', 'Escape', { key: 'Escape' })
    expect(panel('Settings')).not.toBeNull()
    // The drop-down has let go of the keyboard: the next Escape is for the panel.
    expect(document.activeElement).not.toBe(labels)

    tap('Escape')
    expect(panel('Settings')).toBeNull()
  })

  it('held down after cancelling a rename does not go on to close the Songs panel', async () => {
    await addSong('Tune.mid')
    startApp()
    const songs = openPanel('Songs')
    pressEnterOn(within(songs).getByRole('button', { name: 'Rename Tune' }))
    const field = within(songs).getByRole('textbox', { name: 'Song name' })

    fireEvent.keyDown(field, { code: 'Escape', key: 'Escape' })
    expect(within(songs).queryByRole('textbox', { name: 'Song name' })).toBeNull()
    // The key is still down, and the focus is now on a button of the panel.
    for (let repeat = 0; repeat < 4; repeat++) {
      expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    }
    expect(panel('Songs')).not.toBeNull()

    key('keyup', 'Escape')
    tap('Escape')
    expect(panel('Songs')).toBeNull()
  })

  it('held down after it closed a panel does nothing more, and is not kept from the browser', () => {
    startApp()
    openPanel('Songs')
    key('keydown', 'Escape')
    expect(panel('Songs')).toBeNull()
    expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(false)
    expect(heldNotes()).toEqual([])
  })

  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
    'with %o is a shortcut of the browser or the system: nothing closes',
    (modifier) => {
      startApp()
      openSettingsOn('Keys')
      fireEvent.click(pianoKey(64))

      expect(key('keydown', 'Escape', modifier).defaultPrevented).toBe(false)
      expect(pianoKey(64).classList.contains('is-selected')).toBe(true)
      expect(panel('Settings')).not.toBeNull()
    },
  )

  it('never plays a note or changes sustain, whatever it closes', () => {
    startApp()
    const before = settingsStore.get()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    tap('Escape')
    tap('Escape')
    tap('Escape')
    expect(heldNotes()).toEqual([])
    expect(audio.state.notesOn).toEqual([])
    expect(settingsStore.get()).toBe(before)
  })

  it('deselects first even when the focus is on the selected piano key itself', () => {
    startApp()
    openSettingsOn('Keys')
    pianoKey(64).focus()
    fireEvent.keyDown(pianoKey(64), { key: 'Enter', code: 'Enter' })
    expect(pianoKey(64).classList.contains('is-selected')).toBe(true)

    tap('Escape')
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(panel('Settings')).not.toBeNull()
    expect(document.activeElement).toBe(pianoKey(64))
  })

  describe('with everything open that it can take back', () => {
    /** What Escape can take back, as it stands on the page right now. */
    function open(): string[] {
      const found: string[] = []
      if (piano().querySelector('.is-selected')) found.push('a piano key waiting')
      if (screen.queryByRole('group', { name: 'Song options' })) found.push('the song options')
      if (panel('Settings')) found.push('the panel')
      if (startBox()) found.push('the start box')
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

    /** A song loaded, Settings on its Keys tab, a piano key waiting, the song options opened with Enter. */
    function openEverything(): void {
      startApp()
      act(() => {
        playSong(A_STARTER_SONG)
      })
      openSettingsOn('Keys')
      fireEvent.click(pianoKey(64))
      pressEnterOn(button('Song options'))
      expect(open()).toEqual([
        'a piano key waiting',
        'the song options',
        'the panel',
        'the focus in the menu',
      ])
    }

    it('takes back one thing at each press, always in the same order, then leaves the key to the browser', () => {
      openEverything()
      const before = settingsStore.get()

      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(open()).toEqual(['the song options', 'the panel', 'the focus in the menu'])
      key('keyup', 'Escape')

      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(open()).toEqual(['the panel', 'the focus in the menu'])
      key('keyup', 'Escape')

      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(open()).toEqual(['the focus in the menu'])
      expect(isChoosingKeys()).toBe(false)
      key('keyup', 'Escape')

      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(open()).toEqual([])
      expect(document.activeElement).toBe(document.body)
      key('keyup', 'Escape')

      // Nothing is left: the key is the browser's (it leaves full screen with it).
      expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
      key('keyup', 'Escape')

      // Escape is not a button of the player, and it plays and changes nothing.
      expect(screen.getByRole('region', { name: 'Song player' })).toBeTruthy()
      expect(heldNotes()).toEqual([])
      expect(settingsStore.get()).toBe(before)
    })

    it('held down, never takes back a second thing, at whichever step it is held', () => {
      openEverything()

      key('keydown', 'Escape')
      expect(holdEscape()).toBe(true)
      expect(open()).toEqual(['the song options', 'the panel', 'the focus in the menu'])
      key('keyup', 'Escape')

      key('keydown', 'Escape')
      expect(holdEscape()).toBe(true)
      expect(open()).toEqual(['the panel', 'the focus in the menu'])
      key('keyup', 'Escape')

      key('keydown', 'Escape')
      expect(holdEscape()).toBe(true)
      expect(open()).toEqual(['the focus in the menu'])
      key('keyup', 'Escape')

      key('keydown', 'Escape')
      // Nothing is left for a new press to take back: the repeats are the browser's.
      expect(holdEscape()).toBe(false)
      expect(open()).toEqual([])
    })

    it('takes the start box back like a panel: after the song options, before the focus', () => {
      // The box and a panel are never open together, and no piano key can wait without Settings.
      startApp()
      act(() => {
        playSong(A_STARTER_SONG)
      })
      clickWithMouse(button('Menu'))
      pressEnterOn(button('Song options'))
      expect(open()).toEqual(['the song options', 'the start box', 'the focus in the menu'])

      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(holdEscape()).toBe(true)
      expect(open()).toEqual(['the start box', 'the focus in the menu'])
      key('keyup', 'Escape')

      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(holdEscape()).toBe(true)
      expect(open()).toEqual(['the focus in the menu'])
      key('keyup', 'Escape')

      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(holdEscape()).toBe(false)
      expect(open()).toEqual([])
      key('keyup', 'Escape')

      expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
      // The song is still there: Escape is not a button of the player.
      expect(screen.getByRole('region', { name: 'Song player' })).toBeTruthy()
      expect(heldNotes()).toEqual([])
    })
  })
})

describe('what a click closes', () => {
  it('nothing, on the empty part of the top bar', () => {
    startApp()
    openPanel('Settings')
    fireEvent.click(menu().querySelector('.top-bar__space') as HTMLElement, { detail: 1 })
    // The edge of the bar around its controls, and the keycap that only says what Space does.
    fireEvent.click(menu().querySelector('.top-bar') as HTMLElement, { detail: 1 })
    fireEvent.click(within(menu()).getByText('Space'), { detail: 1 })
    fireEvent.click(menu(), { detail: 1 })
    expect(panel('Settings')).not.toBeNull()
  })

  it('nothing, on the strip under the piano', () => {
    startApp()
    openPanel('Songs')
    fireEvent.click(document.querySelector('.stage__piano') as HTMLElement, { detail: 1 })
    expect(panel('Songs')).not.toBeNull()
  })

  it('nothing, when a drag that started on a slider of the panel is let go over the sky', () => {
    // The browser sends that click to what the slider and the sky have in common, not to the sky.
    startApp()
    const settings = openSettingsOn('Sound')
    const volume = within(settings).getByRole('slider', { name: 'Volume' })
    volume.focus()
    fireEvent.mouseDown(volume)
    fireEvent.mouseUp(emptySky())
    fireEvent.click(document.querySelector('.app__screen') as HTMLElement, { detail: 1 })

    expect(panel('Settings')).not.toBeNull()
    // The slider has let go of the keyboard all the same.
    expect(document.activeElement).not.toBe(volume)
  })

  it('nothing, when a drag that started on the sky is let go over the piano', () => {
    startApp()
    openPanel('Settings')
    fireEvent.mouseDown(emptySky())
    fireEvent.mouseUp(piano())
    fireEvent.click(screen.getByRole('region', { name: 'Free Play' }), { detail: 1 })
    expect(panel('Settings')).not.toBeNull()
  })

  it('nothing, with the right or the middle mouse button on the sky', () => {
    startApp()
    openPanel('Settings')
    fireEvent.contextMenu(emptySky())
    fireEvent(emptySky(), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(panel('Settings')).not.toBeNull()
  })

  it('the panel and the key selection with it, on the empty sky', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    clickWithMouse(emptySky())
    expect(panel('Settings')).toBeNull()
    expect(isChoosingKeys()).toBe(false)

    // The selection is not waiting behind the closed panel: the next key plays.
    key('keydown', 'KeyM', { key: 'm' })
    expect(settingsStore.get().bindings.KeyM).toBeUndefined()
    openPanel('Settings')
    expect(isChoosingKeys()).toBe(true)
    expect(piano().querySelector('.is-selected')).toBeNull()
  })

  it('nothing at all when no panel is open', () => {
    startApp()
    const before = settingsStore.get()
    clickWithMouse(emptySky())
    expect(settingsStore.get()).toBe(before)
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).toBeNull()
    expect(startBox()).toBeNull()
  })

  it('the start box, at a press of the mouse anywhere but on it and on the Menu button', () => {
    startApp()
    const box = openStartBox()

    // On the box: its name, the picture behind it, a heading, a way to play that is not built yet.
    fireEvent.pointerDown(box)
    fireEvent.pointerDown(within(box).getByRole('heading', { level: 1 }))
    fireEvent.pointerDown(box.querySelector('.start-box__picture') as SVGElement)
    fireEvent.pointerDown(within(box).getByRole('heading', { name: 'Play' }))
    const practice = within(box).getByRole('button', { name: /Practice/ })
    fireEvent.pointerDown(practice)
    clickWithMouse(practice)
    expect(startBox()).toBe(box)

    // The Menu button closes the box with its click. The press that comes before
    // the click must not close it first, or the click would open it again.
    fireEvent.pointerDown(button('Menu'))
    expect(startBox()).toBe(box)
    clickWithMouse(button('Menu'))
    expect(startBox()).toBeNull()

    // Anywhere else: the empty part of the top bar, which leaves a panel open, and the sky.
    openStartBox()
    fireEvent.pointerDown(menu().querySelector('.top-bar__space') as HTMLElement)
    expect(startBox()).toBeNull()
    openStartBox()
    fireEvent.pointerDown(emptySky())
    expect(startBox()).toBeNull()
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).toBeNull()
  })
})

describe('going back and forth between Settings and Songs, through the start box', () => {
  /** The names of the start box ("Menu") and of the panels that are on the page right now. */
  function dialogs(): string[] {
    return screen.getAllByRole('dialog').map((dialog) => {
      const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
      return dialog.getAttribute('aria-label') ?? title?.textContent ?? ''
    })
  }

  it('never shows two of the box and the panels, and never leaves a piano key waiting', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))

    for (let round = 0; round < 3; round++) {
      // The Menu button puts the start box in the place of Settings.
      clickWithMouse(button('Menu'))
      expect(dialogs()).toEqual(['Menu'])
      expect(button('Menu').getAttribute('aria-expanded')).toBe('true')
      expect(isChoosingKeys()).toBe(false)
      expect(piano().querySelector('.is-selected')).toBeNull()

      clickWithMouse(button('All songs…'))
      expect(dialogs()).toEqual(['Songs'])
      expect(button('Menu').getAttribute('aria-expanded')).toBe('false')
      expect(isChoosingKeys()).toBe(false)
      expect(piano().querySelector('.is-selected')).toBeNull()

      clickWithMouse(button('Menu'))
      expect(dialogs()).toEqual(['Menu'])
      expect(button('Menu').getAttribute('aria-expanded')).toBe('true')

      clickWithMouse(button('Settings'))
      expect(dialogs()).toEqual(['Settings'])
      expect(button('Menu').getAttribute('aria-expanded')).toBe('false')
      expect(isChoosingKeys()).toBe(true)
      expect(piano().querySelector('.is-selected')).toBeNull()
    }
  })

  it('with the keyboard, puts the focus in what opens and gives it back to the Menu button', () => {
    startApp()
    // Enter on "Menu": the focus is on the first line of the start box.
    pressEnterOn(button('Menu'))
    expect(document.activeElement).toBe(button(/Free Play/))
    pressEnterOn(button('Settings'))
    expect(startBox()).toBeNull()
    expect(panel('Settings')?.contains(document.activeElement)).toBe(true)

    // Shift+Tab back to the menu, then Enter on "Menu" and on "All songs…".
    pressEnterOn(button('Menu'))
    expect(panel('Settings')).toBeNull()
    expect(document.activeElement).toBe(button(/Free Play/))
    pressEnterOn(button('All songs…'))
    expect(startBox()).toBeNull()
    expect(panel('Songs')?.contains(document.activeElement)).toBe(true)

    tap('Escape')
    expect(document.activeElement).toBe(button('Menu'))
  })

  it('keeps a note that is held on the keyboard while the box and the panels change', () => {
    startApp()
    openSettingsOn('Sound')
    key('keydown', 'KeyA')
    clickWithMouse(button('Menu'))
    clickWithMouse(button('All songs…'))
    expect(panel('Songs')).not.toBeNull()
    clickWithMouse(button('Menu'))
    clickWithMouse(button('Settings'))
    clickWithMouse(button('Close Settings'))
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('keeps the start box open while a held key repeats: only a new press closes it', () => {
    startApp()
    key('keydown', 'KeyA')
    clickWithMouse(button('Menu'))
    expect(startBox()).not.toBeNull()

    // The key is still down, and the computer sends its press again and again.
    // That is not playing the piano: the note goes on, and the box stays.
    for (let repeat = 0; repeat < 4; repeat++) {
      expect(key('keydown', 'KeyA', { repeat: true }).defaultPrevented).toBe(true)
    }
    expect(startBox()).not.toBeNull()
    expect(heldNotes()).toEqual([60])

    // A key that is pressed now is played, and takes the box away.
    key('keydown', 'KeyS')
    expect(startBox()).toBeNull()
    expect(heldNotes()).toEqual([60, 62])
    key('keyup', 'KeyA')
    key('keyup', 'KeyS')
    expect(heldNotes()).toEqual([])
  })
})

describe('choosing the computer keys while notes are held', () => {
  it('lets go of a key held on the keyboard when it starts, and the key plays again after', () => {
    startApp()
    openSettingsOn('Sound')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    clickWithMouse(screen.getByRole('tab', { name: 'Keys' }))
    expect(isChoosingKeys()).toBe(true)
    expect(heldNotes()).toEqual([])

    // The key is still down and repeats: it does not start the note again.
    key('keydown', 'KeyA', { repeat: true })
    expect(heldNotes()).toEqual([])
    key('keyup', 'KeyA')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('lets a note played on the Keys tab ring until its key is let go, also after the panel closed', () => {
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    clickWithMouse(emptySky())
    expect(isChoosingKeys()).toBe(false)
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
    expect(audio.state.notesOff).toEqual([60])
  })

  it('does not take a key that was already down when a piano key was selected', () => {
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyA', { key: 'a' })
    fireEvent.click(pianoKey(64))
    expect(heldNotes()).toEqual([])

    for (let repeat = 0; repeat < 3; repeat++) key('keydown', 'KeyA', { key: 'a', repeat: true })
    expect(pianoKey(64).classList.contains('is-selected')).toBe(true)
    expect(settingsStore.get().bindings.KeyA).toBe(12)

    key('keyup', 'KeyA', { key: 'a' })
    key('keydown', 'KeyA', { key: 'a' })
    expect(settingsStore.get().bindings.KeyA).toBe(16)
    expect(heldNotes()).toEqual([])
    key('keyup', 'KeyA', { key: 'a' })
    expect(heldNotes()).toEqual([])
  })

  it('lets go of a note held with the mouse when it starts, and the mouse then plays nothing', () => {
    startApp()
    // Settings was last on the Keys tab: opened with Enter, it starts choosing keys at once.
    openSettingsOn('Keys')
    clickWithMouse(button('Close Settings'))

    piano().getBoundingClientRect = () => ({ left: 0, top: 0, width: 2200, height: 100 }) as DOMRect
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([48])

    // The start box on the way to Settings leaves the note alone.
    pressEnterOn(button('Menu'))
    expect(heldNotes()).toEqual([48])
    pressEnterOn(button('Settings'))
    expect(isChoosingKeys()).toBe(true)
    expect(heldNotes()).toEqual([])

    fireEvent.pointerMove(piano(), { buttons: 1, pointerId: 1, clientX: 250, clientY: 90 })
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 250, clientY: 90 })
    expect(heldNotes()).toEqual([])
    expect(audio.state.notesOn).toEqual([48])
  })

  it('plays nothing with the mouse while it is on, and plays again once it is over', () => {
    startApp()
    openSettingsOn('Keys')
    piano().getBoundingClientRect = () => ({ left: 0, top: 0, width: 2200, height: 100 }) as DOMRect
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([])
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })

    tap('Escape')
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([48])
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([])
  })
})

describe('no note is left sounding', () => {
  /** A note from each of the three places notes come from: a computer key, the mouse, a song. */
  function holdThreeNotes(): void {
    key('keydown', 'KeyA')
    piano().getBoundingClientRect = () => ({ left: 0, top: 0, width: 2200, height: 100 }) as DOMRect
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    act(() => bus.noteOn(84, 'playback'))
    expect(heldNotes()).toEqual([60, 48, 84])
  }

  function pageBecomes(state: 'hidden' | 'visible'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState
  })

  it('when the page is hidden behind another tab, whoever was holding it', () => {
    startApp()
    holdThreeNotes()
    pageBecomes('hidden')
    expect(heldNotes()).toEqual([])

    // What is let go later, back on the page, changes nothing; the same keys play again.
    pageBecomes('visible')
    key('keyup', 'KeyA')
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([])
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('when the page is left', () => {
    startApp()
    holdThreeNotes()
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(heldNotes()).toEqual([])
  })

  it('from the keyboard or the mouse when another window comes in front; a song plays on', () => {
    startApp()
    holdThreeNotes()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(heldNotes()).toEqual([84])

    key('keyup', 'KeyA')
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([84])
  })

  it('when every setting is reset while a key is down, and the piano becomes another one', () => {
    act(() => settingsStore.set({ pianoSize: 61, baseOctave: 4 }))
    startApp()
    const settings = openSettingsOn('About')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([72])

    clickWithMouse(within(settings).getByRole('button', { name: 'Reset all settings' }))
    clickWithMouse(within(settings).getByRole('button', { name: 'Yes' }))
    expect(settingsStore.get().baseOctave).toBe(3)
    expect(heldNotes()).toEqual([])

    key('keyup', 'KeyA')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('when the keys are moved lower with a key down: it is let go, and plays the new note next time', () => {
    startApp()
    const settings = openSettingsOn('Keys')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    clickWithMouse(within(settings).getByRole('button', { name: /Lower/ }))
    expect(heldNotes()).toEqual([])
    key('keydown', 'KeyA', { repeat: true })
    expect(heldNotes()).toEqual([])
    key('keyup', 'KeyA')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([48])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })
})

describe('the keyboard focus after a click with the mouse', () => {
  it('stays on a slider while it is dragged, and is let go when the mouse button is', () => {
    startApp()
    const settings = openSettingsOn('Look')
    const glow = within(settings).getByRole('slider', { name: 'Glow' })
    glow.focus()
    fireEvent.mouseDown(glow)
    fireEvent.change(glow, { target: { value: '30' } })
    expect(document.activeElement).toBe(glow)
    expect(settingsStore.get().glow).toBe(0.3)

    fireEvent.mouseUp(glow)
    fireEvent.click(glow, { detail: 1 })
    expect(document.activeElement).not.toBe(glow)
  })

  it('stays on the Labels drop-down whose list the click opened', () => {
    startApp()
    const settings = openSettingsOn('Piano')
    const labels = within(settings).getByRole('combobox', { name: 'Labels on the keys' })
    labels.focus()
    fireEvent.pointerDown(labels)
    fireEvent.click(labels, { detail: 1 })
    expect(document.activeElement).toBe(labels)
  })

  it('stays in the text field of a song being renamed', async () => {
    await addSong('Tune.mid')
    startApp()
    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: 'Rename Tune' }))
    const field = within(songs).getByRole('textbox', { name: 'Song name' })
    expect(document.activeElement).toBe(field)

    fireEvent.click(field, { detail: 1 })
    expect(document.activeElement).toBe(field)
    // Typing a note letter there types, and plays nothing.
    expect(key('keydown', 'KeyA', { key: 'a' }).defaultPrevented).toBe(false)
    expect(heldNotes()).toEqual([])
  })

  it.each(['Sound', 'Keys', 'Piano', 'Look', 'About'])(
    'is let go by every button, slider and link of the %s tab',
    (tab) => {
      startApp()
      const settings = openSettingsOn(tab)
      const controls = settings.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input[type="range"], a',
      )
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        if (!control.isConnected) continue
        // A link would leave the page: only what the click does to the focus is looked at.
        if (control.matches('a')) control.addEventListener('click', (event) => event.preventDefault())
        clickWithMouse(control)
        if (!panel('Settings')) break
        expect(settings.contains(document.activeElement) && document.activeElement !== settings).toBe(
          false,
        )
      }
    },
  )

  it('stays where it is for someone who works with Enter, in the panels too', () => {
    startApp()
    const settings = openPanelWithEnter('Settings')
    const sound = within(settings).getByRole('tab', { name: 'Sound' })
    pressEnterOn(sound)
    expect(document.activeElement).toBe(sound)

    const sustainSwitch = within(settings).getByRole('switch', { name: 'Sustain' })
    pressEnterOn(sustainSwitch)
    expect(document.activeElement).toBe(sustainSwitch)
    expect(sustain()).toBe(true)
  })

  it('is let go by "Your colour", which opens the colour picker of the browser', () => {
    const opened = vi.spyOn(HTMLInputElement.prototype, 'click')
    startApp()
    const settings = openSettingsOn('Look')
    const own = within(settings).getByRole('radio', { name: 'Your colour' })
    clickWithMouse(own)

    expect(opened).toHaveBeenCalledTimes(1)
    expect(settingsStore.get().accent).toBe('custom')
    expect(document.activeElement).not.toBe(own)
    expect(panel('Settings')).not.toBeNull()
  })

  it('is not put on "Menu" when a song is closed with the mouse after a picker was opened', () => {
    // Opening the colour picker or the file picker makes a second click that
    // no mouse button made. It must not be taken for the keyboard.
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const settings = openSettingsOn('Look')
    clickWithMouse(within(settings).getByRole('radio', { name: 'Your colour' }))
    openPanel('Songs')
    clickWithMouse(button('Import a MIDI file'))
    clickWithMouse(button('Close Songs'))

    clickWithMouse(button('Stop'))
    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('Space, the sustain key', () => {
  /** One tap of Space on whatever has the focus. True when both the press and the release were kept from the browser. */
  function tapSpace(): boolean {
    const down = key('keydown', 'Space', { key: ' ' })
    const up = key('keyup', 'Space', { key: ' ' })
    return down.defaultPrevented && up.defaultPrevented
  }

  it('turns sustain on and off with nothing focused', () => {
    startApp()
    expect(tapSpace()).toBe(true)
    expect(sustain()).toBe(true)
    expect(tapSpace()).toBe(true)
    expect(sustain()).toBe(false)
  })

  it('does so once per tap on any control of the menu or the start box, and presses none', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const box = openStartBox()
    // The Menu button, the six controls of the song, volume and sustain.
    const inMenu = [...menu().querySelectorAll<HTMLElement>('button, input')]
    expect(inMenu.length).toBeGreaterThanOrEqual(9)
    // The three ways to play, three songs, "All songs…", "Settings" and "About".
    const inBox = [...box.querySelectorAll<HTMLElement>('button')]
    expect(inBox.length).toBeGreaterThanOrEqual(9)

    let expected = sustain()
    for (const control of [...inMenu, ...inBox]) {
      const pressed = vi.fn()
      control.addEventListener('click', pressed)
      control.focus()
      expect(tapSpace()).toBe(true)
      expected = !expected
      expect(sustain()).toBe(expected)
      expect(pressed).not.toHaveBeenCalled()
    }
    // Space is not a key of the piano: the start box is still open, and nothing took its place.
    expect(startBox()).toBe(box)
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).toBeNull()
  })

  it.each(['Sound', 'Keys', 'Piano', 'Look', 'About'])(
    'does so with any button, slider or link of the %s tab focused',
    (tab) => {
      startApp()
      const settings = openSettingsOn(tab)
      const before = { ...settingsStore.get(), sustain: undefined }
      const controls = settings.querySelectorAll<HTMLElement>('button, input[type="range"], a')
      let expected = sustain()
      for (const control of controls) {
        control.focus()
        expect(tapSpace()).toBe(true)
        expected = !expected
        expect(sustain()).toBe(expected)
      }
      // Sustain is all that changed.
      expect({ ...settingsStore.get(), sustain: undefined }).toEqual(before)
      expect(panel('Settings')).not.toBeNull()
    },
  )

  it('does so with the start box itself focused (opened with the mouse)', () => {
    startApp()
    const box = openStartBox()
    expect(document.activeElement).toBe(box)
    expect(tapSpace()).toBe(true)
    expect(sustain()).toBe(true)
    expect(tapSpace()).toBe(true)
    expect(sustain()).toBe(false)
    expect(startBox()).toBe(box)
  })

  it('does so with the panel itself focused (opened with the mouse), and on a piano key being chosen', () => {
    startApp()
    const settings = openSettingsOn('Keys')
    act(() => settings.focus())
    expect(tapSpace()).toBe(true)
    expect(sustain()).toBe(true)

    pianoKey(64).focus()
    expect(tapSpace()).toBe(true)
    expect(sustain()).toBe(false)
    expect(piano().querySelector('.is-selected')).toBeNull()
  })

  it('is not taken when held: one change however long it is down', () => {
    startApp()
    key('keydown', 'Space')
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(key('keydown', 'Space', { repeat: true }).defaultPrevented).toBe(true)
    }
    key('keyup', 'Space')
    expect(sustain()).toBe(true)
  })

  it('types a space in the name of a song, and changes nothing', async () => {
    await addSong('Tune.mid')
    startApp()
    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: 'Rename Tune' }))
    expect(tapSpace()).toBe(false)
    expect(sustain()).toBe(false)
  })

  it('is left to the Labels drop-down when someone reached it with Tab', () => {
    startApp()
    const settings = openSettingsOn('Piano')
    within(settings).getByRole('combobox', { name: 'Labels on the keys' }).focus()
    expect(key('keydown', 'Space', { key: ' ' }).defaultPrevented).toBe(false)
    expect(sustain()).toBe(false)
  })

  it('is not sustain with Ctrl, Alt or the Windows key held', () => {
    startApp()
    for (const modifier of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(key('keydown', 'Space', modifier).defaultPrevented).toBe(false)
      key('keyup', 'Space', modifier)
    }
    expect(sustain()).toBe(false)
  })
})

describe('someone with the keyboard alone', () => {
  it('can press every button and link with Enter: the app never keeps Enter from the browser', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    for (const control of menu().querySelectorAll<HTMLElement>('button')) {
      control.focus()
      expect(key('keydown', 'Enter', { key: 'Enter' }).defaultPrevented).toBe(false)
      key('keyup', 'Enter', { key: 'Enter' })
    }

    // The lines of the start box, which Enter on "Menu" opens.
    pressEnterOn(button('Menu'))
    const lines = (startBox() as HTMLElement).querySelectorAll<HTMLElement>('button')
    expect(lines.length).toBeGreaterThanOrEqual(9)
    for (const line of lines) {
      line.focus()
      expect(key('keydown', 'Enter', { key: 'Enter' }).defaultPrevented).toBe(false)
      key('keyup', 'Enter', { key: 'Enter' })
    }
    // Enter is not a key of the piano either: the box is still open.
    expect(startBox()).not.toBeNull()

    for (const tab of ['Sound', 'Keys', 'Piano', 'Look', 'About']) {
      const settings = openPanelWithEnter('Settings')
      pressEnterOn(within(settings).getByRole('tab', { name: tab }))
      for (const control of settings.querySelectorAll<HTMLElement>('button, a')) {
        control.focus()
        expect(key('keydown', 'Enter', { key: 'Enter' }).defaultPrevented).toBe(false)
      }
      pressEnterOn(button('Close Settings'))
    }
  })

  it('can move every slider with the arrow keys, Home and End', () => {
    startApp()
    const settings = openSettingsOn('Sound')
    for (const slider of within(settings).getAllByRole('slider')) {
      slider.focus()
      for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
        expect(key('keydown', code, { key: code }).defaultPrevented).toBe(false)
      }
    }
    within(menu()).getByRole('slider', { name: 'Volume' }).focus()
    expect(key('keydown', 'ArrowRight', { key: 'ArrowRight' }).defaultPrevented).toBe(false)
  })

  it('still plays the piano with a button or a slider focused', () => {
    startApp()
    const settings = openSettingsOn('Sound')
    within(settings).getByRole('slider', { name: 'Volume' }).focus()
    expect(key('keydown', 'KeyA').defaultPrevented).toBe(true)
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')

    button('Close Settings').focus()
    key('keydown', 'KeyK')
    expect(heldNotes()).toEqual([72])
    key('keyup', 'KeyK')
    expect(panel('Settings')).not.toBeNull()
  })

  // Dozens of presses of Tab, each of which works out what can take the focus: slow when
  // many test files run side by side, so it gets more time than the usual five seconds.
  it(
    'goes with Tab through the menu, the start box, the open panel and the piano keys being chosen',
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup()
      startApp()
      act(() => {
        playSong(A_STARTER_SONG)
      })

      /** What the next presses of Tab stop at, until the focus leaves the page. */
      async function tabStops(): Promise<HTMLElement[]> {
        const stops: HTMLElement[] = []
        for (let press = 0; press < 80; press++) {
          await user.tab()
          if (document.activeElement === document.body) break
          stops.push(document.activeElement as HTMLElement)
        }
        return stops
      }
      const names = (stops: HTMLElement[]): string[] =>
        stops.map((stop) => stop.getAttribute('aria-label') ?? stop.textContent ?? '')

      // Nothing open: the Menu button, the controls of the song, then volume and
      // sustain. The piano is not a stop.
      expect(names(await tabStops())).toEqual([
        'Menu',
        'Pause',
        'Restart',
        'Stop',
        'Position in the song',
        'Speed',
        'Song options▾',
        'Volume',
        'Sustain',
      ])

      // The start box, opened with Enter: the focus is on its first line, and Tab
      // carries on through the others. The ways to play that are not built yet are
      // not stops, and nothing comes after the box.
      button('Menu').focus()
      await user.keyboard('[Enter]')
      const box = screen.getByRole('dialog', { name: 'Menu' })
      expect(document.activeElement).toBe(within(box).getByRole('button', { name: /Free Play/ }))
      const lines = await tabStops()
      expect(lines.every((line) => box.contains(line))).toBe(true)
      expect(names(lines)).toEqual([
        'Play Twinkle, Twinkle, Little Star',
        'Play Mary Had a Little Lamb',
        'Play Ode to Joy',
        'All songs…',
        'Settings',
        'About',
      ])

      // Settings, opened with Enter: the focus is on its chosen tab; Tab carries on inside it.
      openSettingsOn('Keys')
      clickWithMouse(button('Close Settings'))
      button('Menu').focus()
      await user.keyboard('[Enter]')
      button('Settings').focus()
      await user.keyboard('[Enter]')
      const settings = screen.getByRole('dialog', { name: 'Settings' })
      expect(document.activeElement).toBe(within(settings).getByRole('tab', { name: 'Keys' }))

      const stops = await tabStops()
      const inPanel = stops.filter((stop) => settings.contains(stop))
      const onPiano = stops.filter((stop) => piano().contains(stop))
      expect(inPanel.length).toBeGreaterThan(5)
      expect(onPiano).toHaveLength(37)
      // The panel first, then the piano, and nothing else.
      expect(stops).toEqual([...inPanel, ...onPiano])
      expect(inPanel[0]).toBe(button('Close Settings'))
    },
  )

  it('is not held up by Tab or Enter while a piano key is waiting: both say so, Escape lets go', async () => {
    const user = userEvent.setup()
    startApp()
    const settings = openSettingsOn('Keys')
    pianoKey(64).focus()
    await user.keyboard('[Enter]')
    expect(pianoKey(64).classList.contains('is-selected')).toBe(true)

    await user.keyboard('[Tab]')
    expect(document.activeElement).toBe(pianoKey(64))
    expect(within(settings).getByText(/That key can't be used/)).toBeTruthy()

    await user.keyboard('[Escape]')
    expect(piano().querySelector('.is-selected')).toBeNull()
    await user.tab()
    expect(document.activeElement).toBe(pianoKey(65))
  })

  it('reaches the piano keys with Tab only while keys are being chosen, and only those that can be', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    const tabStops = (): number => piano().querySelectorAll('.piano-key[tabindex="0"]').length
    expect(tabStops()).toBe(0)

    openSettingsOn('Keys')
    expect(piano().querySelectorAll('.piano-key')).toHaveLength(88)
    expect(tabStops()).toBe(37)
    expect(pianoKey(21).getAttribute('aria-disabled')).toBe('true')

    tap('Escape')
    expect(tabStops()).toBe(0)
  })
})

describe('the start box, while the app waits for the first click or key press', () => {
  it('is all that can be reached, with the window around it: the screen behind them cannot', () => {
    render(<App />)
    const screenBehind = document.querySelector('.app__screen') as HTMLElement
    expect(screenBehind.hasAttribute('inert')).toBe(true)
    expect(screenBehind.contains(document.querySelector('.top-bar__menu'))).toBe(true)

    // The window around the box is one button, named after what it does. The box
    // carries the name of the app, and says the same in so many words.
    const box = startBox() as HTMLElement
    expect(screenBehind.contains(button(START_TEXT))).toBe(false)
    expect(screenBehind.contains(box)).toBe(false)
    expect(button(START_TEXT).contains(box)).toBe(false)
    expect(within(box).getByRole('heading', { level: 1 }).textContent).toBe(APP_NAME)
    expect(within(box).getByText(START_TEXT)).toBeTruthy()
  })

  it('takes Space as the first key: sustain stays off, also when Space is let go after it is gone', () => {
    render(<App />)
    expect(key('keydown', 'Space').defaultPrevented).toBe(true)
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect(key('keyup', 'Space').defaultPrevented).toBe(true)
    expect(sustain()).toBe(false)

    tap('Space')
    expect(sustain()).toBe(true)
  })

  it('plays nothing for the key that started the app, however long it is held', () => {
    render(<App />)
    key('keydown', 'KeyA')
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(key('keydown', 'KeyA', { repeat: true }).defaultPrevented).toBe(true)
    }
    expect(heldNotes()).toEqual([])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
    expect(audio.state.notesOn).toEqual([])
    expect(audio.state.notesOff).toEqual([])

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('takes Escape as a start like any key, and opens or closes nothing else with it', () => {
    render(<App />)
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves Tab to the browser, which moves through the box: the app goes on waiting', () => {
    render(<App />)
    expect(key('keydown', 'Tab', { key: 'Tab' }).defaultPrevented).toBe(false)
    key('keyup', 'Tab', { key: 'Tab' })
    expect(key('keydown', 'Tab', { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(false)
    key('keyup', 'Tab', { key: 'Tab', shiftKey: true })

    expect(screen.getByText(START_TEXT)).toBeTruthy()
    expect(startBox()).not.toBeNull()
    expect((document.querySelector('.app__screen') as HTMLElement).hasAttribute('inert')).toBe(true)
    expect(audio.state.starts).toBe(0)
    expect(heldNotes()).toEqual([])

    // What Tab stops at: the window around the box, then the lines of the box that
    // can be chosen. Nothing of the screen behind them is among these.
    const layer = document.querySelector('.start-layer') as HTMLElement
    const stops = [...layer.querySelectorAll<HTMLElement>('button')].filter(
      (control) => control.tabIndex >= 0,
    )
    expect(stops.map((stop) => stop.getAttribute('aria-label') ?? stop.textContent)).toEqual([
      START_TEXT,
      'Free PlayPlay anything you like',
      'Play Twinkle, Twinkle, Little Star',
      'Play Mary Had a Little Lamb',
      'Play Ode to Joy',
      'All songs…',
      'Settings',
      'About',
    ])
  })

  it('leaves Enter to the line of the box that has the focus: its click starts the app', () => {
    render(<App />)
    const settingsLine = button('Settings')
    settingsLine.focus()
    // The key itself starts nothing; the browser then clicks the line.
    expect(key('keydown', 'Enter', { key: 'Enter' }).defaultPrevented).toBe(false)
    expect(key('keydown', 'NumpadEnter', { key: 'Enter' }).defaultPrevented).toBe(false)
    expect(screen.getByText(START_TEXT)).toBeTruthy()
    expect(audio.state.starts).toBe(0)

    pressEnterOn(settingsLine)
    key('keyup', 'Enter', { key: 'Enter' })
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect((document.querySelector('.app__screen') as HTMLElement).hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
    // The line did what it says, and the key played nothing.
    expect(panel('Settings')).not.toBeNull()
    expect(heldNotes()).toEqual([])
  })

  it('takes Enter as a start like any key when the focus is on the window around the box', () => {
    render(<App />)
    button(START_TEXT).focus()
    expect(key('keydown', 'Enter', { key: 'Enter' }).defaultPrevented).toBe(true)
    key('keyup', 'Enter', { key: 'Enter' })
    expect(startBox()).toBeNull()
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).toBeNull()
    expect(audio.state.starts).toBe(1)
  })

  /** The panels that are open. */
  function openPanels(): string[] {
    return (['Settings', 'Songs'] as const).filter((name) => panel(name) !== null)
  }

  it.each<[string, string | RegExp, () => void]>([
    ['"Free Play"', /Free Play/, () => expect(openPanels()).toEqual([])],
    [
      'of a song',
      'Play Ode to Joy',
      () => {
        expect(openPanels()).toEqual([])
        expect(screen.getByRole('region', { name: 'Song player' })).toBeTruthy()
        expect(player.getState().status).toBe('playing')
      },
    ],
    ['"All songs…"', 'All songs…', () => expect(openPanels()).toEqual(['Songs'])],
    ['"Settings"', 'Settings', () => expect(openPanels()).toEqual(['Settings'])],
    [
      '"About"',
      'About',
      () => {
        expect(openPanels()).toEqual(['Settings'])
        const about = screen.getByRole('tab', { name: 'About' })
        expect(about.getAttribute('aria-selected')).toBe('true')
      },
    ],
  ])('is started by a click on its line %s, which does what it says', (_line, name, itDid) => {
    render(<App />)
    clickWithMouse(button(name))
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect((document.querySelector('.app__screen') as HTMLElement).hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([])
    itDid()

    // The app has started: the next key is a note.
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('does not start at Ctrl, Alt or the Windows key, alone or with a letter', () => {
    render(<App />)
    key('keydown', 'ControlLeft', { key: 'Control', ctrlKey: true })
    key('keydown', 'AltLeft', { key: 'Alt', altKey: true })
    key('keydown', 'MetaLeft', { key: 'Meta', metaKey: true })
    key('keydown', 'KeyL', { ctrlKey: true })
    expect(screen.getByText(START_TEXT)).toBeTruthy()
    expect(audio.state.starts).toBe(0)
  })

  it('is taken away by a click on the window around it, which plays and opens nothing', () => {
    render(<App />)
    clickWithMouse(button(START_TEXT))
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect(heldNotes()).toEqual([])
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).toBeNull()
    expect(audio.state.starts).toBe(1)
  })

  it('does not come back, whatever happens to the sound afterwards', () => {
    startApp()
    act(() => {
      audio.state.status = 'error'
      audio.tell()
    })
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(startBox()).toBeNull()
    expect((document.querySelector('.app__screen') as HTMLElement).hasAttribute('inert')).toBe(false)
  })

  it('asks for sound again at each key until the browser has counted one', () => {
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } })
    render(<App />)
    // Escape starts the app, but no browser counts it as a go-ahead for sound.
    tap('Escape')
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(audio.state.starts).toBe(0)

    tap('Escape')
    expect(audio.state.starts).toBe(0)

    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } })
    key('keydown', 'KeyA')
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([60])
  })
})

describe('the sound status', () => {
  function status(): HTMLElement {
    return document.querySelector('.stage__status') as HTMLElement
  }

  function setStatus(next: string): void {
    act(() => {
      audio.state.status = next
      audio.tell()
    })
  }

  it('says what the sound is doing, in an element that screen readers follow', () => {
    startApp()
    expect(status().getAttribute('role')).toBe('status')
    expect(status().textContent).toBe('')

    setStatus('loading')
    expect(status().textContent).toBe('Loading piano sound…')
    setStatus('fallback')
    expect(status().textContent).toBe('Using basic sound (piano sound could not be loaded).')
    setStatus('error')
    expect(status().textContent).toBe('Sound could not start. Click anywhere to try again.')
    expect(status().dataset.status).toBe('error')
    setStatus('ready')
    expect(status().textContent).toBe('')
  })

  it.each([
    ['the sky', () => emptySky()],
    ['a piano key', () => pianoKey(60)],
    ['the top bar', () => menu()],
    ['the Menu button', () => button('Menu')],
  ])('tries again at a click on %s after the sound could not start', (_where, target) => {
    startApp()
    setStatus('error')
    clickWithMouse(target())
    expect(audio.state.starts).toBe(2)
    expect(status().textContent).toBe('')
  })

  it('tries again at a key press too, and that key plays its note', () => {
    startApp()
    setStatus('error')
    key('keydown', 'KeyA')
    expect(audio.state.starts).toBe(2)
    expect(heldNotes()).toEqual([60])
  })

  it('does not ask again while the basic sound is in use or the piano sound is loading', () => {
    startApp()
    setStatus('fallback')
    clickWithMouse(emptySky())
    tap('KeyA')
    setStatus('loading')
    clickWithMouse(emptySky())
    tap('KeyA')
    expect(audio.state.starts).toBe(1)
  })

  it('stands next to the Transposed badge, written with a real minus sign', () => {
    act(() => settingsStore.set({ transpose: -3 }))
    startApp()
    setStatus('loading')
    const strip = document.querySelector('.stage__sound') as HTMLElement
    expect(strip.textContent).toBe('Loading piano sound…Transposed −3')

    act(() => settingsStore.set({ transpose: 2 }))
    expect(strip.textContent).toBe('Loading piano sound…Transposed +2')
    act(() => settingsStore.set({ transpose: 0 }))
    expect(strip.textContent).toBe('Loading piano sound…')
  })

  it('has a "Sustain on" badge after it for as long as sustain is on, whatever switched it on', () => {
    startApp()
    const strip = document.querySelector('.stage__sound') as HTMLElement
    expect(strip.textContent).toBe('')

    // Space, which is how sustain gets switched on without the player meaning to.
    tap('Space')
    expect(strip.textContent).toBe('Sustain on')
    tap('Space')
    expect(strip.textContent).toBe('')

    // The pill in the menu, and the switch in Settings.
    clickWithMouse(within(menu()).getByRole('switch', { name: 'Sustain' }))
    expect(strip.textContent).toBe('Sustain on')
    const settings = openSettingsOn('Sound')
    clickWithMouse(within(settings).getByRole('switch', { name: 'Sustain' }))
    expect(strip.textContent).toBe('')
    clickWithMouse(within(settings).getByRole('switch', { name: 'Sustain' }))
    expect(strip.textContent).toBe('Sustain on')

    // It is a quiet badge like "Transposed", which comes first; the sound status is not part of it.
    act(() => settingsStore.set({ transpose: -3 }))
    setStatus('loading')
    expect(strip.textContent).toBe('Loading piano sound…Transposed −3Sustain on')
    expect([...strip.querySelectorAll('.stage__badge')].map((badge) => badge.textContent)).toEqual([
      'Transposed −3',
      'Sustain on',
    ])
    expect(status().textContent).toBe('Loading piano sound…')

    // "Reset all settings" switches sustain off: the badge goes with it.
    openSettingsOn('About')
    clickWithMouse(button('Reset all settings'))
    clickWithMouse(button('Yes'))
    expect(strip.textContent).toBe('Loading piano sound…')
  })

  it('shows the badge from the first picture when sustain was left on at the last visit', () => {
    act(() => settingsStore.set({ sustain: true }))
    startApp()
    expect((document.querySelector('.stage__sound') as HTMLElement).textContent).toBe('Sustain on')
    // Also while a song is loaded, when the names of the notes are not shown.
    act(() => {
      playSong(A_STARTER_SONG)
    })
    expect((document.querySelector('.stage__sound') as HTMLElement).textContent).toBe('Sustain on')
  })
})

describe('the words over the sky, in the whole app', () => {
  function noteNames(): string[] {
    return [...document.querySelectorAll('.stage__note')].map((note) => note.textContent ?? '')
  }

  it('name at most eight held notes, lowest first, then count the rest', () => {
    startApp()
    const codes = ['KeyK', 'KeyJ', 'KeyH', 'KeyG', 'KeyF', 'KeyD', 'KeyS', 'KeyA', 'KeyW', 'KeyE']
    for (const code of codes) key('keydown', code)
    expect(noteNames()).toEqual(['C4', 'C♯4', 'D4', 'D♯4', 'E4', 'F4', 'G4', 'A4', '+2'])

    key('keyup', 'KeyK')
    key('keyup', 'KeyJ')
    expect(noteNames()).toEqual(['C4', 'C♯4', 'D4', 'D♯4', 'E4', 'F4', 'G4', 'A4'])
    for (const code of codes) key('keyup', code)
    expect(document.querySelector('.stage__notes')).toBeNull()
  })

  it('do not name the notes while a song is loaded, and name them again once it is closed', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    key('keydown', 'KeyA')
    expect(noteNames()).toEqual([])

    clickWithMouse(button('Stop'))
    // The key is still down: its note is named now, with the next one.
    key('keydown', 'KeyS')
    expect(noteNames()).toEqual(['C4', 'D4'])
  })

  it('say how to play until the first note, and never again: not after a panel, not after a song', () => {
    render(<App />)
    const hint = (): string => screen.getByText(HINT).className
    // Not before the app has started, and not while the start box is open over the sky.
    expect(hint()).toBe('stage__hint stage__hint--gone')
    tap('Enter')
    expect(hint()).toBe('stage__hint')
    clickWithMouse(button('Menu'))
    expect(hint()).toBe('stage__hint stage__hint--gone')
    tap('Escape')
    expect(hint()).toBe('stage__hint')

    openSettingsOn('Keys')
    expect(hint()).toBe('stage__hint stage__hint--gone')
    tap('Escape')
    expect(hint()).toBe('stage__hint')

    tap('KeyA')
    expect(hint()).toBe('stage__hint stage__hint--gone')
    openSettingsOn('Keys')
    tap('Escape')
    act(() => {
      playSong(A_STARTER_SONG)
    })
    clickWithMouse(button('Stop'))
    expect(hint()).toBe('stage__hint stage__hint--gone')
  })
})

describe('what screen readers are told', () => {
  it('the modes are lines of the start box; the stage is named after the one that is on', () => {
    startApp()
    // They are not tabs: with no panel open, the page has no tabs and no page of a tab.
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tabpanel')).toBeNull()
    const box = openStartBox()
    const modes = within(within(box).getByRole('region', { name: 'Play' })).getAllByRole('button')
    expect(modes.map((mode) => mode.textContent)).toEqual([
      'Free PlayPlay anything you like',
      'PracticeThe song waits for youSoon',
      'Real-timeYour timing is scoredSoon',
    ])

    const [freePlay, ...coming] = modes
    expect(freePlay?.getAttribute('aria-pressed')).toBe('true')
    expect(freePlay?.hasAttribute('aria-disabled')).toBe(false)
    expect(freePlay?.tabIndex).toBe(0)
    // The stage is a part of the page with a name of its own: the name of that line.
    const stage = screen.getByRole('region', { name: 'Free Play' })
    expect(stage.contains(piano())).toBe(true)
    expect(stage.contains(box)).toBe(false)

    for (const mode of coming) {
      expect(mode.hasAttribute('aria-pressed')).toBe(false)
      expect(mode.getAttribute('aria-disabled')).toBe('true')
      expect(mode.tabIndex).toBe(-1)
      expect(mode.title).toBe('Coming in a later update')
    }
  })

  it('the start box is a dialog that the Menu button points at for as long as it is open', () => {
    render(<App />)
    const menuButton = document.querySelector('.top-bar__menu') as HTMLElement
    // The app opens with it, and the Menu button says so behind it.
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    expect(menuButton.getAttribute('aria-controls')).toBe(startBox()?.id)

    tap('Enter')
    expect(button('Menu')).toBe(menuButton)
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
    expect(menuButton.hasAttribute('aria-controls')).toBe(false)

    clickWithMouse(menuButton)
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    expect(menuButton.getAttribute('aria-controls')).toBe(startBox()?.id)
    expect(startBox()?.id).toBeTruthy()

    // A panel is not the start box: while one is open, the Menu button points at nothing.
    clickWithMouse(button('Settings'))
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
    expect(menuButton.hasAttribute('aria-controls')).toBe(false)
  })

  it('every control of the menu and of the start box has a name, with a song loaded too', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const controls = [
      ...menu().querySelectorAll<HTMLElement>('button, input'),
      ...openStartBox().querySelectorAll<HTMLElement>('button'),
    ]
    expect(controls.length).toBeGreaterThanOrEqual(18)
    const names = controls.map(
      (control) => control.getAttribute('aria-label') ?? control.textContent ?? '',
    )
    expect(names.every((name) => name.trim() !== '')).toBe(true)
    expect(within(menu()).getByRole('slider', { name: 'Volume' }).getAttribute('aria-valuetext')).toBe(
      '80%',
    )
    expect(within(menu()).getByRole('switch', { name: 'Sustain' }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('the name of the app, in the start box, is the one main heading; a panel has its own', () => {
    const headings = (level: number): (string | null)[] =>
      screen.queryAllByRole('heading', { level }).map((heading) => heading.textContent)

    // The app opens with the start box: the name, and under it the headings of its two lists.
    render(<App />)
    expect(headings(1)).toEqual([APP_NAME])
    expect(headings(2)).toEqual(['Play', 'Songs'])
    expect(startBox()?.contains(screen.getByRole('heading', { level: 1 }))).toBe(true)

    // The name is in the box and nowhere else: it goes away with the box, and comes back with it.
    tap('Enter')
    expect(screen.queryAllByRole('heading')).toEqual([])
    openStartBox()
    expect(headings(1)).toEqual([APP_NAME])
    expect(headings(2)).toEqual(['Play', 'Songs'])

    openPanel('Songs')
    expect(headings(1)).toEqual([])
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Songs')
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
    /** The ids that more than one element has. */
    const repeated = (): string[] => {
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
      return ids.filter((id, index) => ids.indexOf(id) !== index)
    }

    // The app opens with the start box, which the Menu button behind it points at.
    render(<App />)
    expect(dangling()).toEqual([])
    expect(repeated()).toEqual([])
    tap('Enter')
    act(() => {
      playSong(A_STARTER_SONG)
    })

    expect(dangling()).toEqual([])
    clickWithMouse(button('Song options'))
    expect(dangling()).toEqual([])
    // The start box again, this time opened with the Menu button.
    openStartBox()
    expect(dangling()).toEqual([])
    expect(repeated()).toEqual([])
    for (const tab of ['Sound', 'Keys', 'Piano', 'Look', 'About']) {
      openSettingsOn(tab)
      expect(dangling()).toEqual([])
    }
    openPanel('Songs')
    expect(dangling()).toEqual([])
    expect(repeated()).toEqual([])
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

  it('one key press is one note, and one tap of Space one change of sustain', () => {
    drawTwice()
    tap('Enter')
    const heard: string[] = []
    const stop = bus.subscribe((event) => heard.push(`${event.type} ${event.midi}`))

    key('keydown', 'KeyA')
    key('keyup', 'KeyA')
    tap('Space')
    stop()

    expect(heard).toEqual(['on 60', 'off 60'])
    expect(audio.state.notesOn).toEqual([60])
    expect(audio.state.notesOff).toEqual([60])
    expect(sustain()).toBe(true)
    expect(audio.state.starts).toBe(1)
  })

  /** Writes down each listener put on the window or the document, and each one taken off. */
  function followListeners(): { added: string[]; removed: string[] } {
    const added: string[] = []
    const removed: string[] = []
    for (const [name, target] of [
      ['window', window],
      ['document', document],
    ] as const) {
      const add = target.addEventListener.bind(target)
      const remove = target.removeEventListener.bind(target)
      vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
        added.push(`${name} ${type}`)
        add(type, listener, options)
      })
      vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
        removed.push(`${name} ${type}`)
        remove(type, listener, options)
      })
    }
    return { added, removed }
  }

  // React itself listens on the document for as long as the page lives: only the app's own count.
  function ours(list: string[]): string[] {
    const isOurs = (entry: string): boolean =>
      !entry.startsWith('document ') || /visibilitychange|fullscreen/.test(entry)
    return list.filter(isOurs).sort()
  }

  it('leaves no listener on the window or the document when the app goes away', () => {
    const { added, removed } = followListeners()

    drawTwice()
    tap('Enter')
    openSettingsOn('Keys')
    openPanel('Songs')
    act(() => {
      playSong(A_STARTER_SONG)
    })
    clickWithMouse(button('Song options'))
    cleanup()

    expect(ours(added).length).toBeGreaterThan(0)
    expect(ours(removed)).toEqual(ours(added))
  })

  it('nor when it goes away with the start box open, which listens to the mouse', () => {
    const { added, removed } = followListeners()

    // Before the first click the box does not listen: the window around it is a button.
    drawTwice()
    cleanup()
    expect(added).not.toContain('window pointerdown')
    expect(ours(added).length).toBeGreaterThan(0)
    expect(ours(removed)).toEqual(ours(added))

    // Opened with the Menu button, it listens for a press of the mouse anywhere else.
    drawTwice()
    tap('Enter')
    openPanel('Songs')
    openStartBox()
    expect(added).toContain('window pointerdown')
    cleanup()
    expect(ours(removed)).toEqual(ours(added))
  })

  it('leaves no timer running and no note held when the app goes away', () => {
    vi.useFakeTimers()
    drawTwice()
    tap('Enter')
    act(() => {
      playSong(A_STARTER_SONG)
    })
    // Past the song's lead-in, into its third note (G4), with a key of the keyboard held too.
    act(() => {
      vi.advanceTimersByTime(LEAD_IN_SECONDS * 1000 + 1300)
    })
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([67, 60])
    cleanup()

    expect(heldNotes()).toEqual([])
    // The song belongs to the page, not to the screen: it is still loaded, but it
    // has stopped there. No clock is left running and no note of it starts later.
    expect(player.getState().status).toBe('paused')
    expect(vi.getTimerCount()).toBe(0)
    const started: number[] = []
    const stop = bus.subscribe((event) => {
      if (event.type === 'on') started.push(event.midi)
    })
    vi.advanceTimersByTime(3000)
    stop()
    expect(started).toEqual([])

    act(() => closeSong())
    expect(heldNotes()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('plays once per key after the screen was taken off the page and drawn again', () => {
    drawTwice()
    tap('Enter')
    cleanup()
    drawTwice()
    tap('Enter')

    key('keydown', 'KeyA')
    expect(audio.state.notesOn).toEqual([60])
    tap('Space')
    expect(sustain()).toBe(true)
  })
})
