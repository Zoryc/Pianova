// @vitest-environment jsdom
/**
 * The app shell under rough handling: Escape in every situation, clicks that
 * must and must not close a panel, going back and forth between Settings and
 * Songs, choosing keys while notes are held, the focus after a click with the
 * mouse, Space with every kind of control focused, the start overlay, the
 * sound status, what screen readers are told, and React drawing everything
 * twice.
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

/** Draws the app and gets past the start overlay. */
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

function openPanel(name: 'Settings' | 'Songs'): HTMLElement {
  if (!panel(name)) clickWithMouse(button(name))
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
    // The slider went away with the panel: the focus is on the button that opens it, not lost.
    expect(document.activeElement).toBe(button('Settings'))
    key('keyup', 'Escape')

    openSettingsOn('Sound')
    button('Close Settings').focus()
    tap('Escape')
    expect(panel('Settings')).toBeNull()
    expect(document.activeElement).toBe(button('Settings'))
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
  })
})

describe('what a click closes', () => {
  it('nothing, on the empty part of the top bar', () => {
    startApp()
    openPanel('Settings')
    fireEvent.click(menu().querySelector('.top-bar__space') as HTMLElement, { detail: 1 })
    fireEvent.click(menu().querySelector('.top-bar__name') as HTMLElement, { detail: 1 })
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
    fireEvent.click(screen.getByRole('tabpanel', { name: 'Free Play' }), { detail: 1 })
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
  })
})

describe('going back and forth between Settings and Songs', () => {
  it('never shows two panels, and never leaves a piano key waiting', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))

    for (let round = 0; round < 3; round++) {
      clickWithMouse(button('Songs'))
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(isChoosingKeys()).toBe(false)
      expect(piano().querySelector('.is-selected')).toBeNull()

      clickWithMouse(button('Settings'))
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(isChoosingKeys()).toBe(true)
      expect(piano().querySelector('.is-selected')).toBeNull()
    }
    expect(button('Settings').getAttribute('aria-expanded')).toBe('true')
    expect(button('Songs').getAttribute('aria-expanded')).toBe('false')
  })

  it('with the keyboard, puts the focus in the panel that opens and gives it back to its button', () => {
    startApp()
    pressEnterOn(button('Settings'))
    expect(panel('Settings')?.contains(document.activeElement)).toBe(true)

    // Shift+Tab back to the menu, then Enter on "Songs".
    pressEnterOn(button('Songs'))
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')?.contains(document.activeElement)).toBe(true)

    tap('Escape')
    expect(document.activeElement).toBe(button('Songs'))
  })

  it('keeps a note that is held on the keyboard while the panels change', () => {
    startApp()
    openSettingsOn('Sound')
    key('keydown', 'KeyA')
    clickWithMouse(button('Songs'))
    clickWithMouse(button('Settings'))
    clickWithMouse(button('Close Settings'))
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
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
    pressEnterOn(button('Settings'))
    const settings = screen.getByRole('dialog', { name: 'Settings' })
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

  it('is not put on "Songs" when a song is closed with the mouse after a picker was opened', () => {
    // Opening the colour picker or the file picker makes a second click that
    // no mouse button made. It must not be taken for the keyboard.
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const settings = openSettingsOn('Look')
    clickWithMouse(within(settings).getByRole('radio', { name: 'Your colour' }))
    clickWithMouse(button('Songs'))
    clickWithMouse(button('Import a MIDI file'))
    clickWithMouse(button('Close Songs'))

    clickWithMouse(button('Close'))
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

  it('does so once per tap with any control of the menu focused, and never presses that control', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const controls = menu().querySelectorAll<HTMLElement>('button, input')
    expect(controls.length).toBeGreaterThanOrEqual(12)

    let expected = sustain()
    for (const control of controls) {
      const pressed = vi.fn()
      control.addEventListener('click', pressed)
      control.focus()
      expect(tapSpace()).toBe(true)
      expected = !expected
      expect(sustain()).toBe(expected)
      expect(pressed).not.toHaveBeenCalled()
    }
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

    for (const tab of ['Sound', 'Keys', 'Piano', 'Look', 'About']) {
      pressEnterOn(button('Settings'))
      const settings = screen.getByRole('dialog', { name: 'Settings' })
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
    'goes with Tab through the menu, then the open panel, then the piano keys being chosen',
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

      // No panel: the top bar, then the player line under it. The piano is not a stop.
      expect(names(await tabStops())).toEqual([
        'Free Play',
        'Volume',
        'Sustain',
        'Songs',
        'Settings',
        'Pause',
        'Stop',
        'Position in the song',
        'Speed',
        'Song options▾',
        'Close',
      ])

      // Settings, opened with Enter: the focus is on its chosen tab; Tab carries on inside it.
      openSettingsOn('Keys')
      clickWithMouse(button('Close Settings'))
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

describe('the start overlay', () => {
  it('is the only thing that can be reached until the first click or key press', () => {
    render(<App />)
    const screenBehind = document.querySelector('.app__screen') as HTMLElement
    expect(screenBehind.hasAttribute('inert')).toBe(true)
    expect(screenBehind.contains(button(new RegExp(START_TEXT)))).toBe(false)
    expect(button(new RegExp(START_TEXT)).textContent).toContain(APP_NAME)
  })

  it('takes Space as the first key: sustain stays off, also when Space is let go after it is gone', () => {
    render(<App />)
    expect(key('keydown', 'Space').defaultPrevented).toBe(true)
    expect(screen.queryByText(START_TEXT)).toBeNull()
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

  it('takes Escape and Tab as a start like any key, and opens or closes nothing with them', () => {
    render(<App />)
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(screen.queryByText(START_TEXT)).toBeNull()
    cleanup()

    render(<App />)
    expect(key('keydown', 'Tab', { key: 'Tab' }).defaultPrevented).toBe(true)
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.activeElement).toBe(document.body)
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

  it('is taken away by a click, and the click plays nothing and opens nothing', () => {
    render(<App />)
    clickWithMouse(button(new RegExp(START_TEXT)))
    expect(screen.queryByText(START_TEXT)).toBeNull()
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
    expect((document.querySelector('.app__screen') as HTMLElement).hasAttribute('inert')).toBe(false)
  })

  it('asks for sound again at each key until the browser has counted one', () => {
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } })
    render(<App />)
    key('keydown', 'ShiftLeft', { key: 'Shift', shiftKey: true })
    key('keyup', 'ShiftLeft', { key: 'Shift' })
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
    ['a button', () => button('Songs')],
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

    clickWithMouse(button('Close'))
    // The key is still down: its note is named now, with the next one.
    key('keydown', 'KeyS')
    expect(noteNames()).toEqual(['C4', 'D4'])
  })

  it('say how to play until the first note, and never again: not after a panel, not after a song', () => {
    startApp()
    const hint = (): string => screen.getByText(HINT).className
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
    clickWithMouse(button('Close'))
    expect(hint()).toBe('stage__hint stage__hint--gone')
  })
})

describe('what screen readers are told', () => {
  it('the modes are tabs, and the stage is the page of the one that is chosen', () => {
    startApp()
    const modes = screen.getByRole('tablist', { name: 'Modes' })
    const tabs = within(modes).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Free Play', 'PracticeSoon', 'Real-timeSoon'])

    const [freePlay, ...coming] = tabs
    const stage = screen.getByRole('tabpanel', { name: 'Free Play' })
    expect(freePlay?.getAttribute('aria-selected')).toBe('true')
    expect(freePlay?.getAttribute('aria-controls')).toBe(stage.id)
    expect(stage.getAttribute('aria-labelledby')).toBe(freePlay?.id)
    expect(stage.contains(piano())).toBe(true)

    for (const tab of coming) {
      expect(tab.getAttribute('aria-selected')).toBe('false')
      expect(tab.getAttribute('aria-disabled')).toBe('true')
      expect(tab.tabIndex).toBe(-1)
      expect(tab.title).toBe('Coming in a later update')
    }
  })

  it('every control of the menu has a name, with a song loaded too', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const names = [...menu().querySelectorAll<HTMLElement>('button, input')].map(
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

  it('the name of the app is the one main heading, and a panel has its own below it', () => {
    startApp()
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([APP_NAME])
    openPanel('Songs')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Songs')
  })

  it('ids that point from one element to another all lead somewhere, whatever is open', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const dangling = (): string[] =>
      [...document.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby]')]
        .flatMap((element) =>
          ['aria-controls', 'aria-labelledby', 'aria-describedby'].flatMap(
            (name) => element.getAttribute(name)?.split(' ') ?? [],
          ),
        )
        .filter((id) => document.getElementById(id) === null)

    expect(dangling()).toEqual([])
    clickWithMouse(button('Song options'))
    expect(dangling()).toEqual([])
    for (const tab of ['Sound', 'Keys', 'Piano', 'Look', 'About']) {
      openSettingsOn(tab)
      expect(dangling()).toEqual([])
    }
    openPanel('Songs')
    expect(dangling()).toEqual([])

    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
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

  it('leaves no listener on the window or the document when the app goes away', () => {
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

    drawTwice()
    tap('Enter')
    openSettingsOn('Keys')
    clickWithMouse(button('Songs'))
    act(() => {
      playSong(A_STARTER_SONG)
    })
    clickWithMouse(button('Song options'))
    cleanup()

    // React itself listens on the document for as long as the page lives: only the app's own count.
    const ours = (list: string[]): string[] =>
      list.filter((entry) => !entry.startsWith('document ') || /visibilitychange|fullscreen/.test(entry)).sort()
    expect(ours(added).length).toBeGreaterThan(0)
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
