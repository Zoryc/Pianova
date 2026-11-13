// @vitest-environment jsdom
/**
 * The piano on screen, in the whole app, on a stage that has a width: which
 * piano "Auto" shows, what happens to held notes when the window is resized
 * across the widths where "Auto" changes its mind, and how the computer keys
 * and a loaded song follow.
 *
 * There is no layout on the simulated page: the stage is as wide as the test
 * says, and the test plays the part of the browser's resize observer.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkyProps } from './ui/sky/Sky'

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
import { bus } from './app/pianoApp'
import { player } from './app/songsApp'
import { settingsStore } from './state/settings'
import { addSong, resetSongs } from './ui/songsTestKit'
import { LEAD_IN_SECONDS, playSong } from './ui/useSongs'

const A_STARTER_SONG = 'starter:twinkle-twinkle-little-star'
/** How long a song is in the player before its first note sounds, on the test's clock. */
const LEAD_IN_MS = LEAD_IN_SECONDS * 1000

/** How wide the stage is on the test's make-believe screen. */
let stageWidth = 1366
/** The functions to call when the stage changes size, as the browser would. */
let resizeListeners: (() => void)[] = []

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(): void {
    resizeListeners.push(this.callback)
  }
  disconnect(): void {
    resizeListeners = resizeListeners.filter((listener) => listener !== this.callback)
  }
}

function resizeTo(width: number): void {
  stageWidth = width
  act(() => {
    for (const listener of resizeListeners) listener()
  })
}

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  stageWidth = 1366
  resizeListeners = []
  sky.props = null
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  // The stage is as wide as the test says; the piano is 100 high, so a point 90 down is on a white key.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const measured = this.classList.contains('stage') || this.classList.contains('piano')
    const width = measured ? stageWidth : 0
    const height = this.classList.contains('piano') ? 100 : 0
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height } as DOMRect
  })
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  bus.allOff()
  await resetSongs()
})

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

function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

function startApp(): void {
  render(<App />)
  tap('Enter')
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

/** Opens the start box with the Menu button and clicks one of its lines. */
function clickInMenu(line: string): void {
  clickWithMouse(button('Menu'))
  clickWithMouse(button(line))
}

function openSettingsOn(tab: string): HTMLElement {
  if (!screen.queryByRole('dialog', { name: 'Settings' })) clickInMenu('Settings')
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  clickWithMouse(within(settings).getByRole('tab', { name: tab }))
  return settings
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

function pianoKeys(): HTMLElement[] {
  return [...piano().querySelectorAll<HTMLElement>('.piano-key')]
}

/** The lowest and highest note the piano draws. */
function pianoOnScreen(): { first: number; last: number } {
  const notes = pianoKeys().map((pianoKey) => Number(pianoKey.dataset.midi))
  return { first: Math.min(...notes), last: Math.max(...notes) }
}

function skyProps(): SkyProps {
  return sky.props as SkyProps
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()]
}

/** Where a white key is across the piano, in the middle of the key and near its front edge. */
function pointOn(midi: number): { clientX: number; clientY: number } {
  const whites = pianoKeys().filter((pianoKey) => pianoKey.classList.contains('piano-key--white'))
  const index = whites.findIndex((pianoKey) => Number(pianoKey.dataset.midi) === midi)
  if (index < 0) throw new Error(`Note ${midi} is not a white key of this piano.`)
  return { clientX: ((index + 0.5) / whites.length) * stageWidth, clientY: 90 }
}

describe('the piano "Auto" shows in the whole app', () => {
  it.each([
    [1920, 88, { first: 21, last: 108 }],
    [1366, 88, { first: 21, last: 108 }],
    [1000, 61, { first: 36, last: 96 }],
    [800, 49, { first: 36, last: 84 }],
    [700, 37, { first: 48, last: 84 }],
    [0, 37, { first: 48, last: 84 }],
  ])('in a window %ipx wide has %i keys, and the sky is given the same notes', (width, keys, range) => {
    stageWidth = width
    startApp()
    expect(pianoKeys()).toHaveLength(keys)
    expect(pianoOnScreen()).toEqual(range)
    expect(skyProps().range).toEqual(range)
  })

  it('is measured once, also when React draws everything twice', () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    tap('Enter')
    expect(resizeListeners).toHaveLength(1)
    expect(pianoKeys()).toHaveLength(88)
    cleanup()
    expect(resizeListeners).toHaveLength(0)
  })

  it('always holds the keys of the computer keyboard, wherever they sit and whatever its size', () => {
    startApp()
    for (const width of [1366, 1000, 800, 700]) {
      resizeTo(width)
      for (const baseOctave of [1, 2, 3, 4, 5]) {
        act(() => settingsStore.set({ baseOctave }))
        const { first, last } = pianoOnScreen()
        const zoneStart = 12 * (baseOctave + 1)
        expect(first).toBeLessThanOrEqual(zoneStart)
        expect(last).toBeGreaterThanOrEqual(zoneStart + 36)
        // Every one of the 18 default keys is written on a key of the piano.
        expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(18)
        expect(skyProps().range).toEqual({ first, last })
        expect(skyProps().hints.size).toBe(18)
        for (const midi of skyProps().hints.keys()) {
          expect(midi >= first && midi <= last).toBe(true)
        }
      }
    }
  })
})

describe('resizing the window while notes are held', () => {
  it('lets go of every note when "Auto" picks another piano: keyboard, mouse and song alike', () => {
    startApp()
    key('keydown', 'KeyA')
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, ...pointOn(72) })
    act(() => bus.noteOn(84, 'playback'))
    expect(heldNotes()).toEqual([60, 72, 84])

    resizeTo(1000)
    expect(pianoKeys()).toHaveLength(61)
    expect(heldNotes()).toEqual([])
    expect(piano().querySelector('.is-lit')).toBeNull()
  })

  it('does not start the held key again by itself, and lets it play once it is pressed again', () => {
    startApp()
    key('keydown', 'KeyA')
    resizeTo(1000)

    key('keydown', 'KeyA', { repeat: true })
    expect(heldNotes()).toEqual([])
    key('keyup', 'KeyA')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('does not let the mouse, still held, start notes on the new piano until it is pressed again', () => {
    startApp()
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, ...pointOn(72) })
    expect(heldNotes()).toEqual([72])

    resizeTo(800)
    fireEvent.pointerMove(piano(), { buttons: 1, pointerId: 1, clientX: 300, clientY: 90 })
    fireEvent.pointerMove(piano(), { buttons: 1, pointerId: 1, clientX: 500, clientY: 90 })
    expect(heldNotes()).toEqual([])
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 500, clientY: 90 })

    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, ...pointOn(60) })
    expect(heldNotes()).toEqual([60])
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, ...pointOn(60) })
    expect(heldNotes()).toEqual([])
  })

  it('goes through every piano and back without leaving a note behind', () => {
    startApp()
    // One pixel under and one pixel over each width where "Auto" changes its mind.
    const steps = [
      [1351, 61],
      [935, 49],
      [753, 37],
      [754, 49],
      [936, 61],
      [1352, 88],
    ] as const
    for (const [width, keys] of steps) {
      key('keydown', 'KeyA')
      key('keydown', 'KeyK')
      expect(heldNotes()).toEqual([60, 72])
      resizeTo(width)
      expect(pianoKeys()).toHaveLength(keys)
      expect(heldNotes()).toEqual([])
      key('keyup', 'KeyA')
      key('keyup', 'KeyK')
      expect(heldNotes()).toEqual([])
    }
  })

  it('keeps the held notes when the piano stays the same one', () => {
    startApp()
    key('keydown', 'KeyA')
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, ...pointOn(72) })

    resizeTo(1500)
    resizeTo(1352)
    resizeTo(1920)
    expect(heldNotes()).toEqual([60, 72])

    key('keyup', 'KeyA')
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 10, clientY: 90 })
    expect(heldNotes()).toEqual([])
  })

  it('keeps the held notes when the player asked for a fixed size', () => {
    act(() => settingsStore.set({ pianoSize: 61 }))
    startApp()
    key('keydown', 'KeyA')
    resizeTo(500)
    resizeTo(2000)
    expect(pianoKeys()).toHaveLength(61)
    expect(heldNotes()).toEqual([60])
  })

  it('keeps the piano key that is waiting for a computer key', () => {
    startApp()
    const settings = openSettingsOn('Keys')
    fireEvent.click(piano().querySelector('.piano-key[data-midi="64"]') as HTMLElement)
    expect(within(settings).getByText('Press a key for E4…')).toBeTruthy()

    resizeTo(700)
    expect(pianoKeys()).toHaveLength(37)
    expect(piano().querySelector('.is-selected')?.getAttribute('data-midi')).toBe('64')
    expect(within(settings).getByText('Press a key for E4…')).toBeTruthy()

    key('keydown', 'KeyM', { key: 'm' })
    expect(settingsStore.get().bindings.KeyM).toBe(16)
  })
})

describe('a song and the piano on screen', () => {
  it('carries on from where it was when the window is resized, arranged for the new piano', () => {
    vi.useFakeTimers()
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    // Into the third note of the tune, the G above middle C.
    act(() => {
      vi.advanceTimersByTime(LEAD_IN_MS + 1400)
    })
    const before = skyProps().falling
    const position = player.getPosition()
    expect(position).toBeGreaterThan(LEAD_IN_SECONDS + 1)
    expect(heldNotes()).toEqual([67])

    resizeTo(700)
    expect(skyProps().falling).not.toBe(before)
    expect(player.getState().status).toBe('playing')
    expect(player.getPosition()).toBeCloseTo(position, 5)
    // The note that was sounding is let go with the old piano.
    expect(heldNotes()).toEqual([])

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(player.getPosition()).toBeGreaterThan(position + 1.5)
  })

  it('plays its first note in full when the computer keys had to move to reach the song', async () => {
    // Low notes: the keys move two octaves down, and on a small piano the piano moves with them.
    await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    vi.useFakeTimers()
    stageWidth = 700
    startApp()
    expect(pianoOnScreen()).toEqual({ first: 48, last: 84 })

    clickInMenu('All songs…')
    clickWithMouse(button('Play Low'))
    expect(settingsStore.get().baseOctave).toBe(1)
    expect(pianoOnScreen()).toEqual({ first: 24, last: 60 })
    expect(player.getState().status).toBe('playing')

    // The first note does not sound at once: for two seconds it is seen falling.
    act(() => {
      vi.advanceTimersByTime(LEAD_IN_MS - 100)
    })
    expect(heldNotes()).toEqual([])
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(heldNotes()).toEqual([36])
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(heldNotes()).toEqual([36])
    // The sky is given the notes at the times the player sounds them: all of them two seconds later.
    const falling = skyProps().falling?.getNotes() ?? []
    expect(falling.map((note) => note.midi)).toEqual([36, 38, 40, 41])
    falling.forEach((note, index) => {
      expect(note.time).toBeCloseTo(LEAD_IN_SECONDS + index * 0.5, 6)
    })
    // Every note of the song has the letter of a computer key on it.
    expect([36, 38, 40, 41].every((midi) => skyProps().hints.has(midi))).toBe(true)
  })

  it('gives the computer keys and the piano back when the song is closed, unless the player moved them', async () => {
    await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    stageWidth = 700
    startApp()
    clickInMenu('All songs…')
    clickWithMouse(button('Play Low'))
    expect(pianoOnScreen()).toEqual({ first: 24, last: 60 })

    // Held on the piano the song brought: let go when the piano the player had comes back.
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([36])
    clickWithMouse(button('Close'))
    expect(settingsStore.get().baseOctave).toBe(3)
    expect(pianoOnScreen()).toEqual({ first: 48, last: 84 })
    expect(skyProps().range).toEqual({ first: 48, last: 84 })
    expect(heldNotes()).toEqual([])
    key('keyup', 'KeyA')

    // Moved by the player while the song was loaded: the keys stay where the player put them.
    clickInMenu('All songs…')
    clickWithMouse(button('Play Low'))
    const settings = openSettingsOn('Keys')
    clickWithMouse(within(settings).getByRole('button', { name: /Higher/ }))
    expect(settingsStore.get().baseOctave).toBe(2)
    clickWithMouse(button('Close'))
    expect(settingsStore.get().baseOctave).toBe(2)
    expect(pianoOnScreen()).toEqual({ first: 36, last: 72 })
  })
})
