// @vitest-environment jsdom
/**
 * Two audits of the whole app (src/App.tsx with everything under it):
 *
 * 1. No stuck notes. Every way a note can start (the computer keyboard, the
 *    mouse on the piano, a song being played) is tried against every moment
 *    at which it could be left sounding: the window losing the focus, the tab
 *    being hidden, the page going away, choosing the computer keys, a ready-made
 *    layout, the keys moving lower or higher, another piano on screen, a reset,
 *    and for a song: pause, stop, a jump, close, delete and its end.
 *
 * 2. Cost. What a note, a tick of a song, a move of the mouse or a step of a
 *    slider makes the app do: how often the app shell is drawn again, how
 *    often something is written to the browser's storage, and whether
 *    listeners or timers pile up over a long session.
 *
 * The sound engine is a stand-in that remembers which notes it was told to
 * sound. The sky is the real one, on the stand-in canvas of skyTestKit.ts.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle' }
  /** The notes the engine was told to sound and has not been told to stop. */
  const sounding = new Set<number>()
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
    allNotesOff(): void {},
    dispose(): void {},
  }
  return { engine, state, sounding }
})

/** How many times the app shell was drawn: the top bar is drawn exactly as often as the app. */
const shell = vi.hoisted(() => ({ renders: 0 }))

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

vi.mock('./ui/TopBar', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ui/TopBar')>()
  const { createElement } = await import('react')
  return {
    ...original,
    TopBar(props: Parameters<typeof original.TopBar>[0]) {
      shell.renders += 1
      return createElement(original.TopBar, props)
    },
  }
})

import { App } from './App'
import { bus } from './app/pianoApp'
import { player, songLibrary } from './app/songsApp'
import { keyRectOf } from './core/pianoGeometry'
import type { NoteEvent } from './core/types'
import { STORAGE_KEY, settingsStore } from './state/settings'
import { installFakeBrowser } from './ui/sky/skyTestKit'
import type { FakeBrowser } from './ui/sky/skyTestKit'
import { addSong, resetSongs } from './ui/songsTestKit'
import { AUTO_HIDE_DELAY_MS } from './ui/useAutoHide'
import { playSong } from './ui/useSongs'

const TWINKLE = 'starter:twinkle-twinkle-little-star'
/** Twinkle, Twinkle: 48 beats at 100 a minute. */
const TWINKLE_SECONDS = 28.8

let browser: FakeBrowser

beforeEach(async () => {
  browser = installFakeBrowser()
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  audio.sounding.clear()
})

afterEach(async () => {
  showPage()
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  bus.allOff()
  await resetSongs()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// What the player does
// ---------------------------------------------------------------------------

function key(type: 'keydown' | 'keyup', code: string): void {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true })
  const target = document.activeElement ?? document.body
  act(() => {
    target.dispatchEvent(event)
  })
}

function tap(code: string): void {
  key('keydown', code)
  key('keyup', code)
}

function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

/** Draws the app and gets past the start overlay. */
function startApp(): void {
  render(<App />)
  tap('Enter')
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function openSettingsOn(tab: string): HTMLElement {
  if (!screen.queryByRole('dialog', { name: 'Settings' })) clickWithMouse(button('Settings'))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  clickWithMouse(within(settings).getByRole('tab', { name: tab }))
  return settings
}

function closeSettings(): void {
  clickWithMouse(button('Close Settings'))
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

function pianoKey(midi: number): HTMLElement {
  return piano().querySelector(`.piano-key[data-midi="${midi}"]`) as HTMLElement
}

/** The notes the piano on screen shows, read from the page. */
function pianoOnScreen(): { first: number; last: number } {
  const notes = [...piano().querySelectorAll<HTMLElement>('.piano-key')].map((pianoKey) =>
    Number(pianoKey.dataset.midi),
  )
  return { first: Math.min(...notes), last: Math.max(...notes) }
}

const PIANO_WIDTH = 2200
const PIANO_HEIGHT = 100

/** Where the middle of a white key is, on a piano box 2200 by 100 at the top-left of the page. */
function pointOnKey(midi: number): { clientX: number; clientY: number } {
  const rect = keyRectOf(midi, pianoOnScreen())
  if (!rect || rect.black) throw new Error(`${midi} is not a white key of the piano on screen.`)
  return { clientX: (rect.left + rect.width / 2) * PIANO_WIDTH, clientY: PIANO_HEIGHT * 0.9 }
}

function mouseDownOnKey(midi: number): void {
  const box = piano()
  box.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: PIANO_WIDTH, height: PIANO_HEIGHT }) as DOMRect
  fireEvent.pointerDown(box, { button: 0, pointerId: 1, ...pointOnKey(midi) })
}

function mouseUpOnKey(midi: number): void {
  fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, ...pointOnKey(midi) })
}

function loseWindowFocus(): void {
  act(() => {
    window.dispatchEvent(new Event('blur'))
  })
}

function hidePage(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/** Undoes `hidePage`: the page says again what the test browser says. */
function showPage(): void {
  delete (document as { visibilityState?: string }).visibilityState
}

function leavePage(): void {
  act(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
}

function wait(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds)
  })
}

function startSong(id: string): void {
  act(() => {
    playSong(id)
  })
}

// ---------------------------------------------------------------------------
// What is checked
// ---------------------------------------------------------------------------

function heldNotes(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function soundingInEngine(): number[] {
  return [...audio.sounding].sort((a, b) => a - b)
}

function litKeys(): number[] {
  return [...piano().querySelectorAll<HTMLElement>('.piano-key.is-lit')].map((lit) =>
    Number(lit.dataset.midi),
  )
}

/** Nothing held on the bus, nothing sounding in the engine, no key lit on the piano. */
function expectSilence(): void {
  expect(heldNotes()).toEqual([])
  expect(soundingInEngine()).toEqual([])
  expect(litKeys()).toEqual([])
}

/** Collects the notes that start from now on. Call the returned function to stop collecting. */
function notesStartedFromNow(): { started: number[]; stop(): void } {
  const started: number[] = []
  const stop = bus.subscribe((event: NoteEvent) => {
    if (event.type === 'on') started.push(event.midi)
  })
  return { started, stop }
}

// ---------------------------------------------------------------------------
// 1. No stuck notes
// ---------------------------------------------------------------------------

describe('a note of the computer keyboard never stays stuck', () => {
  it('stops when its key is let go', () => {
    startApp()
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    expect(soundingInEngine()).toEqual([60])
    expect(litKeys()).toEqual([60])
    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops when the window loses the focus, and the key plays again afterwards', () => {
    startApp()
    key('keydown', 'KeyA')
    key('keydown', 'KeyD')
    loseWindowFocus()
    expectSilence()

    // The keys were let go while another window had the focus: their key-ups never arrive.
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops when the tab is hidden', () => {
    startApp()
    key('keydown', 'KeyA')
    hidePage()
    expectSilence()
  })

  it('stops when the page goes away', () => {
    startApp()
    key('keydown', 'KeyA')
    leavePage()
    expectSilence()
  })

  it('stops when the app is taken off the page', () => {
    startApp()
    key('keydown', 'KeyA')
    cleanup()
    expect(heldNotes()).toEqual([])
    expect(soundingInEngine()).toEqual([])
  })

  it('stops when the computer keys are about to be chosen, and plays again in that tab', () => {
    startApp()
    key('keydown', 'KeyA')
    openSettingsOn('Keys')
    expectSilence()

    key('keyup', 'KeyA')
    // With no piano key selected the keyboard plays as always, so a layout can be tried.
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops when a piano key is selected to get a new computer key', () => {
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    fireEvent.click(pianoKey(62), { detail: 1 })
    expectSilence()
    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops at its own key-up after a ready-made layout took that key away', () => {
    startApp()
    const settings = openSettingsOn('Keys')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    // In "Two octaves" the A key plays nothing.
    const card = within(settings).getByText('Two octaves').closest('button') as HTMLElement
    clickWithMouse(card)
    expect(Object.hasOwn(settingsStore.get().bindings, 'KeyA')).toBe(false)

    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops at its own key-up after a ready-made layout gave that key another note', () => {
    startApp()
    const settings = openSettingsOn('Keys')
    // Home row: S is D4. Two octaves: S is C♯3.
    key('keydown', 'KeyS')
    expect(heldNotes()).toEqual([62])

    const card = within(settings).getByText('Two octaves').closest('button') as HTMLElement
    clickWithMouse(card)
    key('keyup', 'KeyS')
    expectSilence()

    key('keydown', 'KeyS')
    expect(heldNotes()).toEqual([49])
    key('keyup', 'KeyS')
    expectSilence()
  })

  it('stops when the computer keys move lower or higher', () => {
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyA')
    clickWithMouse(button(/Higher/))
    expect(settingsStore.get().baseOctave).toBe(4)
    expectSilence()
    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops when the piano on screen becomes another one', () => {
    startApp()
    const settings = openSettingsOn('Piano')
    key('keydown', 'KeyA')
    clickWithMouse(within(settings).getByRole('button', { name: /^61/ }))
    expect(settingsStore.get().pianoSize).toBe(61)
    expectSilence()
  })

  it('stops when every setting is reset and the keys move back with it', () => {
    act(() => settingsStore.set({ baseOctave: 4, pianoSize: 61 }))
    startApp()
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([72])

    act(() => settingsStore.reset())
    expectSilence()
    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops at its key-up when the reset changed the keys but not where they sit', () => {
    startApp()
    key('keydown', 'KeyA')
    act(() => settingsStore.set({ bindings: { KeyQ: 0 } }))
    act(() => settingsStore.reset())
    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops at its key-up even when the keyboard focus went into a text field meanwhile', async () => {
    const song = await addSong('tune.mid')
    startApp()
    key('keydown', 'KeyA')
    clickWithMouse(button('Songs'))
    clickWithMouse(button(`Rename ${song.title}`))
    const field = screen.getByRole('textbox')
    field.focus()

    key('keyup', 'KeyA')
    expectSilence()
  })
})

describe('a note of the mouse never stays stuck', () => {
  it('stops when the button is let go', () => {
    startApp()
    mouseDownOnKey(60)
    expect(heldNotes()).toEqual([60])
    expect(soundingInEngine()).toEqual([60])
    mouseUpOnKey(60)
    expectSilence()
  })

  it('stops when the window loses the focus, and the piano plays again afterwards', () => {
    startApp()
    mouseDownOnKey(60)
    loseWindowFocus()
    expectSilence()

    mouseDownOnKey(64)
    expect(heldNotes()).toEqual([64])
    mouseUpOnKey(64)
    expectSilence()
  })

  it('stops when the tab is hidden, and the button let go later starts nothing', () => {
    startApp()
    mouseDownOnKey(60)
    hidePage()
    expectSilence()

    showPage()
    mouseUpOnKey(60)
    expectSilence()
    mouseDownOnKey(62)
    expect(heldNotes()).toEqual([62])
    mouseUpOnKey(62)
    expectSilence()
  })

  it('stops when the page goes away', () => {
    startApp()
    mouseDownOnKey(60)
    leavePage()
    expectSilence()
  })

  it('stops when the app is taken off the page', () => {
    startApp()
    mouseDownOnKey(60)
    cleanup()
    expect(heldNotes()).toEqual([])
    expect(soundingInEngine()).toEqual([])
  })

  it('stops when the piano on screen becomes another one, or the keys move', () => {
    startApp()
    mouseDownOnKey(60)
    act(() => settingsStore.set({ pianoSize: 61 }))
    expectSilence()

    mouseDownOnKey(60)
    expect(heldNotes()).toEqual([60])
    act(() => settingsStore.set({ baseOctave: 2 }))
    expectSilence()
  })

  it('stops when the computer keys are about to be chosen', () => {
    startApp()
    mouseDownOnKey(60)
    act(() => settingsStore.set({ labelMode: 'none' }))
    expect(heldNotes()).toEqual([60])

    openSettingsOn('Keys')
    expectSilence()
    // In that tab a press on the piano selects a key: it plays nothing.
    mouseDownOnKey(64)
    expectSilence()
  })

  it('held together with the same note on the keyboard: the note stops when both let go', () => {
    startApp()
    key('keydown', 'KeyA')
    mouseDownOnKey(60)
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([60])
    expect(soundingInEngine()).toEqual([60])
    mouseUpOnKey(60)
    expectSilence()
  })
})

describe('a note of a song never stays stuck', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  /** Starts Twinkle, Twinkle and waits until its first note (middle C) sounds. */
  function playUntilFirstNote(): void {
    startApp()
    startSong(TWINKLE)
    wait(100)
    expect(heldNotes()).toEqual([60])
    expect(soundingInEngine()).toEqual([60])
    expect(litKeys()).toEqual([60])
  }

  it('stops at Pause, and nothing more starts until Play', () => {
    playUntilFirstNote()
    clickWithMouse(button('Pause'))
    expectSilence()

    const { started, stop } = notesStartedFromNow()
    wait(5000)
    stop()
    expect(started).toEqual([])
    expectSilence()
  })

  it('stops at Stop', () => {
    playUntilFirstNote()
    clickWithMouse(button('Stop'))
    expectSilence()
    wait(3000)
    expectSilence()
    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
  })

  it('stops at a jump to another place in the song', () => {
    playUntilFirstNote()
    fireEvent.change(screen.getByRole('slider', { name: 'Position in the song' }), {
      target: { value: '10' },
    })
    expectSilence()
    expect(player.getState().status).toBe('playing')
  })

  it('stops at Close', () => {
    playUntilFirstNote()
    clickWithMouse(button('Close'))
    expectSilence()

    const { started, stop } = notesStartedFromNow()
    wait(3000)
    stop()
    expect(started).toEqual([])
  })

  it('stops when the song is deleted while it plays', async () => {
    vi.useRealTimers()
    const song = await addSong('tune.mid', { notes: [60, 62, 64, 65] })
    vi.useFakeTimers()
    startApp()
    startSong(song.id)
    wait(100)
    expect(heldNotes()).toEqual([60])

    act(() => songLibrary.remove(song.id))
    expectSilence()
    expect(player.getState().status).toBe('empty')
    const { started, stop } = notesStartedFromNow()
    wait(3000)
    stop()
    expect(started).toEqual([])
  })

  it('stops at the end of the song', () => {
    playUntilFirstNote()
    wait((TWINKLE_SECONDS + 1) * 1000)
    expectSilence()
    expect(player.getState()).toMatchObject({ status: 'stopped', position: 0 })
  })

  it('stops when the tab is hidden: the song is paused there', () => {
    playUntilFirstNote()
    hidePage()
    expectSilence()
    expect(player.getState().status).toBe('paused')

    const { started, stop } = notesStartedFromNow()
    wait(5000)
    stop()
    expect(started).toEqual([])
  })

  it('goes on while another window has the focus, and still ends in silence', () => {
    playUntilFirstNote()
    loseWindowFocus()
    expect(player.getState().status).toBe('playing')
    wait((TWINKLE_SECONDS + 1) * 1000)
    expectSilence()
  })

  it('stops when the piano on screen becomes another one, and the song carries on', () => {
    playUntilFirstNote()
    act(() => settingsStore.set({ pianoSize: 61 }))
    expectSilence()
    expect(player.getState().status).toBe('playing')

    wait(700)
    expect(heldNotes()).toEqual([60])
    wait((TWINKLE_SECONDS + 1) * 1000)
    expectSilence()
  })

  it('stops when the computer keys move lower or higher, and the song carries on', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    playUntilFirstNote()
    act(() => settingsStore.set({ baseOctave: 2 }))
    expectSilence()
    expect(player.getState().status).toBe('playing')
    wait((TWINKLE_SECONDS + 1) * 1000)
    expectSilence()
  })

  it('stops when the computer keys are about to be chosen, and the song carries on', () => {
    playUntilFirstNote()
    openSettingsOn('Keys')
    expectSilence()
    wait((TWINKLE_SECONDS + 1) * 1000)
    expectSilence()
  })

  it('played together with the same note on the keyboard: silence once both have let go', () => {
    playUntilFirstNote()
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    // The song lets go of its middle C (after 0.54 s); the player still holds it.
    wait(480)
    expect(heldNotes()).toEqual([60])
    expect(soundingInEngine()).toEqual([60])
    clickWithMouse(button('Pause'))
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expectSilence()
  })

  it('stops for good when another song takes its place', () => {
    playUntilFirstNote()
    startSong('starter:ode-to-joy')
    // The first note of the new song is not due yet: the old one must be gone.
    expect(heldNotes()).toEqual([])
    wait(100)
    expect(heldNotes()).toEqual([71])
    clickWithMouse(button('Close'))
    expectSilence()
  })

  it('starts no more notes once the app has been taken off the page', () => {
    playUntilFirstNote()
    cleanup()
    expect(heldNotes()).toEqual([])

    const { started, stop } = notesStartedFromNow()
    wait(3000)
    stop()
    // Nobody is left to stop a song that plays on with no screen.
    expect(started).toEqual([])
    expect(soundingInEngine()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. Cost
// ---------------------------------------------------------------------------

describe('how often the app shell is drawn again', () => {
  it('not once for the notes of the computer keyboard or the mouse', () => {
    startApp()
    shell.renders = 0
    for (const code of ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK']) tap(code)
    key('keydown', 'KeyA')
    key('keydown', 'KeyD')
    key('keydown', 'KeyG')
    key('keyup', 'KeyA')
    key('keyup', 'KeyD')
    key('keyup', 'KeyG')
    mouseDownOnKey(60)
    mouseUpOnKey(60)
    expect(shell.renders).toBe(0)
  })

  it('not once for the notes of a song with a panel open', () => {
    vi.useFakeTimers()
    startApp()
    startSong(TWINKLE)
    openSettingsOn('Look')
    shell.renders = 0
    const { started, stop } = notesStartedFromNow()
    // Eight notes start and stop, and the player reports its position about fifty times.
    wait(5000)
    stop()
    expect(started.length).toBeGreaterThanOrEqual(7)
    expect(player.getState().position).toBeGreaterThan(4.5)
    expect(shell.renders).toBe(0)
  })

  it('once when the menu hides during a song, and not at each tick', () => {
    vi.useFakeTimers()
    startApp()
    startSong(TWINKLE)
    shell.renders = 0
    wait(AUTO_HIDE_DELAY_MS + 5000)
    expect(document.querySelector('.menu')?.classList.contains('menu--hidden')).toBe(true)
    expect(shell.renders).toBeLessThanOrEqual(1)
  })

  it('not once while the mouse moves over a menu that is already shown', () => {
    vi.useFakeTimers()
    startApp()
    act(() => {
      fireEvent.mouseMove(window, { screenX: 1, screenY: 1 })
    })
    shell.renders = 0
    for (let step = 0; step < 200; step++) {
      act(() => {
        fireEvent.mouseMove(window, { screenX: 10 + step, screenY: 20 + step })
      })
    }
    expect(shell.renders).toBe(0)
  })

  it('once to show a hidden menu, however far the mouse then moves', () => {
    vi.useFakeTimers()
    startApp()
    wait(AUTO_HIDE_DELAY_MS + 10)
    expect(document.querySelector('.menu')?.classList.contains('menu--hidden')).toBe(true)
    shell.renders = 0
    for (let step = 0; step < 100; step++) {
      act(() => {
        fireEvent.mouseMove(window, { screenX: 300 + step, screenY: 200 })
      })
    }
    expect(shell.renders).toBe(1)
  })

  it('once for each step of a slider, and not at all for a step to the value it has', () => {
    startApp()
    const settings = openSettingsOn('Look')
    const glow = within(settings).getByRole('slider', { name: 'Glow' })
    shell.renders = 0
    for (const value of [10, 20, 30, 40, 50]) fireEvent.change(glow, { target: { value } })
    expect(settingsStore.get().glow).toBe(0.5)
    expect(shell.renders).toBe(5)
  })
})

describe("what is written to the browser's storage", () => {
  function watchStorage(): { writes: string[] } {
    const writes: string[] = []
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      name: string,
      value: string,
    ) {
      writes.push(name)
      original.call(this, name, value)
    })
    return { writes }
  }

  it('nothing for notes, mouse moves or a song that plays', () => {
    vi.useFakeTimers()
    startApp()
    startSong(TWINKLE)
    const { writes } = watchStorage()

    for (const code of ['KeyA', 'KeyS', 'KeyD']) tap(code)
    for (let step = 0; step < 50; step++) {
      act(() => {
        fireEvent.mouseMove(window, { screenX: step, screenY: step })
      })
    }
    wait(6000)
    clickWithMouse(button('Pause'))
    fireEvent.change(screen.getByRole('slider', { name: 'Position in the song' }), {
      target: { value: '3' },
    })
    clickWithMouse(button('Play'))
    wait(1000)
    clickWithMouse(button('Stop'))

    expect(writes).toEqual([])
  })

  it('one small write of the settings for each step of a slider, never more', () => {
    startApp()
    const { writes } = watchStorage()
    const volume = screen.getByRole('slider', { name: 'Volume' })
    for (let percent = 79; percent >= 60; percent--) {
      fireEvent.change(volume, { target: { value: String(percent) } })
    }
    expect(writes).toEqual(Array.from({ length: 20 }, () => STORAGE_KEY))
    expect(window.localStorage.getItem(STORAGE_KEY)?.length).toBeLessThan(2000)
  })

  it('nothing for opening and closing the panels or changing the Settings tab', () => {
    startApp()
    const { writes } = watchStorage()
    for (const tab of ['Sound', 'Keys', 'Piano', 'Look', 'About']) openSettingsOn(tab)
    closeSettings()
    clickWithMouse(button('Songs'))
    clickWithMouse(button('Close Songs'))
    expect(writes).toEqual([])
  })

  it('the speed of a song: only the small list of songs, never its notes again', async () => {
    const song = await addSong('tune.mid', { notes: [60, 62, 64, 65] })
    startApp()
    startSong(song.id)
    const { writes } = watchStorage()
    const speed = screen.getByRole('slider', { name: 'Speed' })
    for (const percent of [95, 90, 85]) fireEvent.change(speed, { target: { value: String(percent) } })

    expect(writes.length).toBe(3)
    expect(writes.every((name) => name === 'pianoapp.songs.v1')).toBe(true)
  })
})

describe('a long session', () => {
  /**
   * The page's timers and clock are moved by hand, as elsewhere in this file,
   * but the animation frames stay with the stand-in browser, which counts them.
   */
  function useFakeClock(): void {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    })
  }

  /** Counts the listeners on the window and on the document, by kind of event. */
  function countListeners(): { counts: Map<string, number>; restore(): void } {
    const counts = new Map<string, number>()
    const restores: (() => void)[] = []
    for (const [name, target] of [
      ['window', window],
      ['document', document],
    ] as const) {
      const add = target.addEventListener.bind(target)
      const remove = target.removeEventListener.bind(target)
      const bump = (type: string, by: number): void => {
        const kind = `${name}:${type}`
        counts.set(kind, (counts.get(kind) ?? 0) + by)
      }
      target.addEventListener = ((type: string, ...rest: unknown[]) => {
        bump(type, 1)
        return (add as (...args: unknown[]) => void)(type, ...rest)
      }) as typeof target.addEventListener
      target.removeEventListener = ((type: string, ...rest: unknown[]) => {
        bump(type, -1)
        return (remove as (...args: unknown[]) => void)(type, ...rest)
      }) as typeof target.removeEventListener
      restores.push(() => {
        target.addEventListener = add
        target.removeEventListener = remove
      })
    }
    return {
      counts,
      restore() {
        for (const restore of restores) restore()
      },
    }
  }

  /** How many listeners the note bus has (its list is private to the type checker only). */
  function busListeners(): number {
    return (bus as unknown as { listeners: Set<unknown> }).listeners.size
  }

  function oneRoundOfEverything(): void {
    for (const tab of ['Sound', 'Keys', 'Piano', 'Look', 'About']) openSettingsOn(tab)
    closeSettings()

    clickWithMouse(button('Songs'))
    clickWithMouse(button(/^Play Twinkle/))
    wait(700)
    tap('KeyA')
    clickWithMouse(button('Pause'))
    clickWithMouse(button('Play'))
    fireEvent.change(screen.getByRole('slider', { name: 'Position in the song' }), {
      target: { value: '12' },
    })
    clickWithMouse(button('Song options'))
    clickWithMouse(button('Song options'))
    wait(300)
    clickWithMouse(button('Close'))

    for (const code of ['KeyA', 'KeyD', 'KeyG']) tap(code)
    act(() => {
      fireEvent.mouseMove(window, { screenX: Math.random() * 1000, screenY: Math.random() * 500 })
    })
    browser.playUntilIdle()
    // Long enough for the menu to hide again and every afterglow to end.
    wait(AUTO_HIDE_DELAY_MS + 500)
    browser.playUntilIdle()
  }

  it('leaves no listener, timer or animation frame behind, round after round', () => {
    useFakeClock()
    const listeners = countListeners()
    try {
      startApp()
      oneRoundOfEverything()
      const after = {
        listeners: new Map(listeners.counts),
        timers: vi.getTimerCount(),
        busListeners: busListeners(),
        observers: browser.observers(),
        motionListeners: browser.motionListeners(),
      }

      for (let round = 0; round < 12; round++) oneRoundOfEverything()

      expect(Object.fromEntries(listeners.counts)).toEqual(Object.fromEntries(after.listeners))
      expect(vi.getTimerCount()).toBe(after.timers)
      expect(busListeners()).toBe(after.busListeners)
      expect(browser.observers()).toBe(after.observers)
      expect(browser.motionListeners()).toBe(after.motionListeners)
      expect(browser.frames.pending.size).toBe(0)
      expectSilence()
    } finally {
      listeners.restore()
    }
  })

  it('asks for no animation frame and runs no timer while nothing happens', () => {
    useFakeClock()
    startApp()
    tap('KeyA')
    browser.playUntilIdle()
    wait(AUTO_HIDE_DELAY_MS + 500)
    browser.playUntilIdle()

    const framesBefore = browser.frames.requested
    wait(60_000)
    expect(browser.frames.requested).toBe(framesBefore)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a song that is paused costs one slow timer and no animation frames', () => {
    useFakeClock()
    startApp()
    startSong(TWINKLE)
    wait(1000)
    browser.play(1)
    clickWithMouse(button('Pause'))
    // The afterglow of the last note, then nothing.
    browser.playUntilIdle()
    wait(1000)
    browser.playUntilIdle()

    const framesBefore = browser.frames.requested
    wait(60_000)
    expect(browser.frames.requested).toBe(framesBefore)
    // The sky looks ten times a second whether the song has moved; the menu stays, so no countdown.
    expect(vi.getTimerCount()).toBe(1)
    expectSilence()
  })

  it('a song that plays runs the player and the sky, and stops both at its end', () => {
    useFakeClock()
    startApp()
    startSong(TWINKLE)
    wait(500)
    // The player's own timer, the sky's look at the song, and the countdown of the menu.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(3)
    expect(browser.frames.pending.size).toBe(1)

    wait((TWINKLE_SECONDS + 1) * 1000)
    browser.playUntilIdle()
    wait(1000)
    browser.playUntilIdle()
    expect(player.getState().status).toBe('stopped')
    expect(browser.frames.pending.size).toBe(0)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('takes everything away with the app: listeners, timers and frames', () => {
    useFakeClock()
    const listeners = countListeners()
    try {
      const busBefore = busListeners()
      startApp()
      startSong(TWINKLE)
      wait(500)
      clickWithMouse(button('Close'))
      cleanup()

      const left = [...listeners.counts].filter(([, count]) => count !== 0)
      expect(left).toEqual([])
      expect(busListeners()).toBe(busBefore)
      expect(browser.observers()).toBe(0)
      expect(browser.motionListeners()).toBe(0)
      expect(browser.frames.pending.size).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      listeners.restore()
    }
  })
})
