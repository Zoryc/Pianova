// @vitest-environment jsdom
/**
 * The on-screen piano and the light above it inside the real <App />: what
 * the mouse on the piano does to the rest of the app, and what the rest of
 * the app (moving the computer keys, choosing them in Settings, hiding the
 * page) does to a key that the mouse is holding.
 *
 * Only the sound engine is replaced (by a silent one that writes down what it
 * is asked to play). The sky is the real one: it draws on a stand-in canvas
 * that remembers the bars on it, and the browser's frame clock is driven by
 * the tests (src/ui/sky/skyTestKit.ts).
 *
 * Nothing is measured here, so the piano is the smallest one: 37 keys, C3 to
 * C6, which is exactly the keys the computer keyboard can reach.
 */
import { StrictMode } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const state = { status: 'idle' as 'idle' | 'ready', calls: [] as string[] }
  const listeners = new Set<() => void>()
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
    noteOn(midi: number, velocity?: number): void {
      state.calls.push(`on ${midi} ${velocity}`)
    },
    noteOff(midi: number): void {
      state.calls.push(`off ${midi}`)
    },
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
import { bus } from './app/pianoApp'
import type { PianoRange } from './core/layout'
import { keyRects } from './core/pianoGeometry'
import type { NoteEvent } from './core/types'
import { settingsStore } from './state/settings'
import { BLACK_KEY_HEIGHT } from './ui/pianoHitTest'
import { installFakeBrowser } from './ui/sky/skyTestKit'
import type { FakeBrowser, PaintedBar } from './ui/sky/skyTestKit'

type User = ReturnType<typeof userEvent.setup>

/** Where the piano is on the make-believe screen. */
const BOX = { left: 100, top: 300, width: 2200, height: 200 }

/**
 * The piano this page draws: the 37 keys from C3 to C6. A key's place on it,
 * counted from the lowest key, is also its slot: its place among the keys the
 * computer keyboard can reach.
 */
const PIANO: PianoRange = { first: 48, last: 84 }
/** The piano with all its keys, A0 to C8, for the test that asks for it. */
const FULL_PIANO: PianoRange = { first: 21, last: 108 }

// ---------------------------------------------------------------------------
// Stand-ins for what the simulated browser lacks
// ---------------------------------------------------------------------------

const captured = new Map<number, Element>()

/** The canvas, the frame clock and the size watcher of the test's make-believe browser. */
let browser: FakeBrowser

let busEvents: string[] = []
let stopLogging: () => void = () => {}

beforeEach(() => {
  audio.state.status = 'idle'
  audio.state.calls.length = 0
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
  captured.clear()
  busEvents = []
  stopLogging = bus.subscribe((event: NoteEvent) => {
    busEvents.push(`${event.type} ${event.midi} ${event.source}`)
  })

  const elementProto = Element.prototype as unknown as Record<string, unknown>
  elementProto.setPointerCapture = function (this: Element, pointerId: number): void {
    captured.set(pointerId, this)
  }
  elementProto.hasPointerCapture = function (this: Element, pointerId: number): boolean {
    return captured.get(pointerId) === this
  }
  elementProto.releasePointerCapture = function (this: Element, pointerId: number): void {
    if (captured.get(pointerId) === this) captured.delete(pointerId)
  }

  browser = installFakeBrowser()
})

afterEach(() => {
  cleanup()
  stopLogging()
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  const elementProto = Element.prototype as unknown as Record<string, unknown>
  delete elementProto.setPointerCapture
  delete elementProto.hasPointerCapture
  delete elementProto.releasePointerCapture
  const canvasProto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  delete canvasProto.clientWidth
  delete canvasProto.clientHeight
})

// ---------------------------------------------------------------------------

async function startApp(): Promise<User> {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /Click or press any key to start/ }))
  piano().getBoundingClientRect = () =>
    ({
      x: BOX.left,
      y: BOX.top,
      left: BOX.left,
      top: BOX.top,
      width: BOX.width,
      height: BOX.height,
      right: BOX.left + BOX.width,
      bottom: BOX.top + BOX.height,
      toJSON: () => ({}),
    }) as DOMRect
  busEvents.length = 0
  audio.state.calls.length = 0
  return user
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

function pianoKey(slot: number): HTMLElement {
  const key = piano().querySelector<HTMLElement>(`.piano-key[data-slot="${slot}"]`)
  if (!key) throw new Error(`no piano key for slot ${slot}`)
  return key
}

/** Every key of the piano on screen, lowest first. */
function pianoKeys(): HTMLElement[] {
  return [...piano().querySelectorAll<HTMLElement>('.piano-key')]
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function settingsPanel(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Settings' })
}

/**
 * Opens Settings with the mouse, on one of its tabs. (The panel remembers its
 * last tab from one test to the next.) The Keys tab is where the computer keys
 * are chosen: while it shows, a click on a piano key selects it.
 */
async function openSettingsOn(user: User, tab: string): Promise<HTMLElement> {
  if (!settingsPanel()) await user.click(button('Settings'))
  const panel = screen.getByRole('dialog', { name: 'Settings' })
  await user.click(within(panel).getByRole('tab', { name: tab }))
  return panel
}

/** True while a click on a piano key selects it instead of playing it. */
function isChoosingKeys(): boolean {
  return piano().classList.contains('piano--editing')
}

function held(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function litSlots(): string[] {
  return [...piano().querySelectorAll<HTMLElement>('.piano-key.is-lit')].map((key) => key.dataset.slot ?? '?')
}

/** The notes of the keys that are lit, whether the computer keys can reach them or not. */
function litNotes(): number[] {
  return [...piano().querySelectorAll<HTMLElement>('.piano-key.is-lit')].map((key) => Number(key.dataset.midi))
}

function skyCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>('.stage__sky > canvas.sky')
  if (!canvas) throw new Error('there is no sky above the piano')
  return canvas
}

/** The bars of light on the sky right now. */
function bars(): PaintedBar[] {
  return browser.contextOf(skyCanvas()).bars
}

/** How high up a key the mouse is, from its far end (0) to its near end (1). */
const ON_THE_BLACK_KEYS = BLACK_KEY_HEIGHT / 2
const BELOW_THE_BLACK_KEYS = (1 + BLACK_KEY_HEIGHT) / 2

/**
 * A point on a key, given the key's place on the piano counted from its
 * lowest key. Without a height: on its visible part (black keys high up, white
 * keys below the black ones).
 */
function pointOn(
  place: number,
  heightShare?: number,
  range: PianoRange = PIANO,
): { clientX: number; clientY: number } {
  const rect = keyRects(range)[place]
  if (!rect) throw new Error(`the piano has no key number ${place}`)
  const share = heightShare ?? (rect.black ? ON_THE_BLACK_KEYS : BELOW_THE_BLACK_KEYS)
  return {
    clientX: BOX.left + (rect.left + rect.width / 2) * BOX.width,
    clientY: BOX.top + share * BOX.height,
  }
}

function send(target: EventTarget, type: string, init: PointerEventInit): void {
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
  })
}

/**
 * The mouse on the piano, sending what a browser sends. Keys are given by
 * their place on the piano the mouse was told about (the 37-key one unless
 * said otherwise), counted from its lowest key.
 */
function theMouse(range: PianoRange = PIANO) {
  const pointerId = 1
  const base = { pointerId, pointerType: 'mouse', isPrimary: true }
  const keyAt = (place: number): HTMLElement => pianoKeys()[place] ?? piano()
  return {
    down(place: number, heightShare?: number): void {
      const point = pointOn(place, heightShare, range)
      send(keyAt(place), 'pointerdown', { ...base, button: 0, buttons: 1, ...point })
    },
    /** One move, straight to that key, however far away it is. */
    move(place: number, heightShare?: number): void {
      const target = captured.get(pointerId) ?? piano()
      const point = pointOn(place, heightShare, range)
      send(target, 'pointermove', { ...base, button: -1, buttons: 1, ...point })
    },
    /** Lets go of the button the way Chrome does it: release, end of capture, then a click on the element that had the capture. */
    up(place: number): void {
      const target = captured.get(pointerId) ?? keyAt(place)
      const point = pointOn(place, undefined, range)
      send(target, 'pointerup', { ...base, button: 0, buttons: 0, ...point })
      if (captured.delete(pointerId)) send(target, 'lostpointercapture', base)
      act(() => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
      })
    },
  }
}

const C4 = 12
const D4 = 14
const E4 = 16

// ===========================================================================

describe('playing the on-screen piano', () => {
  it('sends a pointer note through the bus, as hard as the Touch setting says, and lights the key', async () => {
    await startApp()
    act(() => settingsStore.set({ velocity: 0.35 }))
    const mouse = theMouse()

    mouse.down(C4)
    expect(busEvents).toEqual(['on 60 pointer'])
    expect(audio.state.calls).toEqual(['on 60 0.35'])
    expect(litSlots()).toEqual([String(C4)])
    expect(pianoKey(C4).getAttribute('aria-pressed')).toBe('true')

    mouse.move(D4)
    mouse.up(D4)
    expect(busEvents).toEqual(['on 60 pointer', 'off 60 pointer', 'on 62 pointer', 'off 62 pointer'])
    expect(audio.state.calls).toEqual(['on 60 0.35', 'off 60', 'on 62 0.35', 'off 62'])
    expect(litSlots()).toEqual([])
    expect(held()).toEqual([])
  })

  it('plays every key on the way when the mouse glides across the piano in one move', async () => {
    await startApp()
    const mouse = theMouse()

    // Along the far end of the keys, where the black keys lie between the white ones.
    mouse.down(C4, ON_THE_BLACK_KEYS)
    mouse.move(E4, ON_THE_BLACK_KEYS)
    expect(busEvents).toEqual([
      'on 60 pointer',
      'off 60 pointer',
      'on 61 pointer',
      'off 61 pointer',
      'on 62 pointer',
      'off 62 pointer',
      'on 63 pointer',
      'off 63 pointer',
      'on 64 pointer',
    ])
    // Only the key under the mouse is left lit and sounding.
    expect(litSlots()).toEqual([String(E4)])
    expect(held()).toEqual([64])

    // Down the same key to its near end, then back along there, where there are only white keys.
    busEvents.length = 0
    mouse.move(E4, BELOW_THE_BLACK_KEYS)
    expect(busEvents).toEqual([])
    mouse.move(C4, BELOW_THE_BLACK_KEYS)
    expect(busEvents).toEqual(['off 64 pointer', 'on 62 pointer', 'off 62 pointer', 'on 60 pointer'])

    mouse.up(C4)
    expect(held()).toEqual([])
    expect(litSlots()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('on'))).toHaveLength(7)
    expect(audio.state.calls.filter((call) => call.startsWith('off'))).toHaveLength(7)
  })

  it('plays the keys the computer keyboard cannot reach, at both ends of the full piano, each with its light', async () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    await startApp()
    expect(pianoKeys()).toHaveLength(88)
    const mouse = theMouse(FULL_PIANO)
    const skyWidth = browser.size.width

    // The lowest key of a piano: A0.
    mouse.down(0)
    expect(busEvents).toEqual(['on 21 pointer'])
    expect(audio.state.calls).toEqual(['on 21 0.8'])
    expect(litNotes()).toEqual([21])
    browser.play(0.2)
    expect(bars()).toHaveLength(1)
    expect(bars()[0]?.x).toBeGreaterThanOrEqual(0)
    expect(bars()[0]?.x).toBeLessThan(skyWidth / 52)
    mouse.up(0)
    expect(held()).toEqual([])
    browser.playUntilIdle()

    // The highest: C8.
    mouse.down(87)
    expect(held()).toEqual([108])
    expect(litNotes()).toEqual([108])
    browser.play(0.2)
    expect(bars()).toHaveLength(1)
    const highest = bars()[0]
    expect((highest?.x ?? 0) + (highest?.width ?? 0)).toBeLessThanOrEqual(skyWidth)
    expect(highest?.x).toBeGreaterThan(skyWidth - skyWidth / 52)
    mouse.up(87)
    expect(held()).toEqual([])
    expect(litNotes()).toEqual([])
    expect(audio.state.calls).toEqual(['on 21 0.8', 'off 21', 'on 108 0.8', 'off 108'])
  })

  it('keeps a note that the keyboard and the mouse both hold until the last of them lets go', async () => {
    const user = await startApp()
    const mouse = theMouse()
    await user.keyboard('[KeyA>]')
    mouse.down(C4)
    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([60])
    expect(audio.state.calls.filter((call) => call.startsWith('off'))).toEqual([])
    mouse.up(C4)
    expect(held()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('off'))).toEqual(['off 60'])
  })

  it('gives the keyboard back to the piano when a piano key is clicked while the Labels drop-down has focus', async () => {
    const user = await startApp()
    const settings = await openSettingsOn(user, 'Piano')
    const labels = within(settings).getByRole('combobox', { name: 'Labels on the keys' })
    labels.focus()
    // While the drop-down has the keyboard, letters are for it and play nothing.
    await user.keyboard('[KeyA]')
    expect(busEvents).toEqual([])

    await user.click(pianoKey(E4))
    expect(document.activeElement).toBe(document.body)
    busEvents.length = 0
    await user.keyboard('[KeyA]')
    expect(busEvents).toEqual(['on 60 keyboard', 'off 60 keyboard'])
  })

  it('plays again straight after a choice is made in the Labels drop-down', async () => {
    const user = await startApp()
    const settings = await openSettingsOn(user, 'Piano')
    const labels = within(settings).getByRole('combobox', { name: 'Labels on the keys' })

    await user.selectOptions(labels, 'Notes only')
    expect(settingsStore.get().labelMode).toBe('notes')
    // The drop-down did not keep the keyboard: the letter keys are the piano's again.
    expect(document.activeElement).toBe(document.body)
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(0)

    await user.keyboard('[KeyA]')
    expect(busEvents).toEqual(['on 60 keyboard', 'off 60 keyboard'])
  })

  it('draws a bar of light for a pointer note and goes idle after it', async () => {
    await startApp()
    const mouse = theMouse()
    expect(browser.frames.pending.size).toBe(0)
    mouse.down(C4)
    browser.play(0.2)
    expect(bars()).toHaveLength(1)

    // The bar stands on the key that is played: the sky and the piano are the same width.
    const bar = bars()[0]
    const key = keyRects(PIANO)[C4]
    if (!bar || !key) throw new Error('no bar, or no key, to compare')
    const skyWidth = browser.size.width
    expect(bar.x + bar.width / 2).toBeCloseTo((key.left + key.width / 2) * skyWidth, 6)
    expect(bar.width).toBeLessThanOrEqual(key.width * skyWidth)
    expect(bar.height).toBeGreaterThan(0)

    mouse.up(C4)
    browser.playUntilIdle()
    expect(bars()).toHaveLength(0)
    expect(browser.frames.pending.size).toBe(0)
  })
})

describe('no stuck notes: the mouse is holding a key when…', () => {
  it('…the computer keys move higher', async () => {
    // Loading a song, a reset and the app open in a second window can all
    // move them while the mouse button is down.
    await startApp()
    const mouse = theMouse()
    mouse.down(C4)
    expect(held()).toEqual([60])

    act(() => settingsStore.set({ baseOctave: 4 }))
    expect(held()).toEqual([])
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])
    expect(litSlots()).toEqual([])

    // The button is still down: sliding and letting go starts nothing and stops nothing more.
    mouse.move(D4)
    mouse.up(D4)
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])
    // The next press plays the key's new note.
    mouse.down(C4)
    expect(held()).toEqual([72])
    mouse.up(C4)
    expect(held()).toEqual([])
  })

  it('…every setting is reset with the keyboard, which puts the computer keys back', async () => {
    act(() => settingsStore.set({ baseOctave: 4 }))
    const user = await startApp()
    await openSettingsOn(user, 'About')
    const mouse = theMouse()
    mouse.down(C4)
    expect(held()).toEqual([72])

    // The other hand, on the keyboard: Enter on "Reset all settings", then on "Yes".
    button('Reset all settings').focus()
    await user.keyboard('[Enter]')
    expect(held()).toEqual([72])
    // The question appears with the focus on "No", the answer that changes nothing; "Yes" is one step back.
    expect(document.activeElement).toBe(button('No'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(button('Yes'))
    await user.keyboard('[Enter]')

    expect(settingsStore.get().baseOctave).toBe(3)
    expect(held()).toEqual([])
    expect(audio.state.calls).toEqual(['on 72 0.8', 'off 72'])
    expect(litSlots()).toEqual([])
    // The question is gone, and the keyboard focus was not lost with it.
    expect(document.activeElement).toBe(button('Reset all settings'))

    mouse.move(D4)
    mouse.up(D4)
    expect(audio.state.calls).toEqual(['on 72 0.8', 'off 72'])
    mouse.down(C4)
    expect(held()).toEqual([60])
    mouse.up(C4)
    expect(held()).toEqual([])
  })

  it('…the computer keys move while the keyboard also holds a note: the sky ends up idle', async () => {
    const user = await startApp()
    const mouse = theMouse()
    await user.keyboard('[KeyA>]')
    mouse.down(E4)
    browser.play(0.2)
    expect(bars()).toHaveLength(2)

    act(() => settingsStore.set({ baseOctave: 2 }))
    expect(held()).toEqual([])
    // The piano shows other notes now: the light of the old ones is gone with them.
    expect(bars()).toHaveLength(0)
    browser.play(0.05)
    expect(browser.frames.pending.size).toBe(0)

    await user.keyboard('[/KeyA]')
    mouse.up(E4)
    expect(held()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('on'))).toHaveLength(2)
    expect(audio.state.calls.filter((call) => call.startsWith('off'))).toHaveLength(2)
  })

  it('…the piano becomes another piano, because its size was changed', async () => {
    await startApp()
    const mouse = theMouse()
    mouse.down(C4)
    expect(held()).toEqual([60])

    act(() => settingsStore.set({ pianoSize: 61 }))
    expect(piano().querySelectorAll('.piano-key')).toHaveLength(61)
    expect(held()).toEqual([])
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])
    expect(litSlots()).toEqual([])

    mouse.move(D4)
    mouse.up(D4)
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])

    // The keys are narrower now and start lower: the same place on the screen is the A below middle C.
    mouse.down(C4)
    expect(held()).toEqual([57])
    expect(litNotes()).toEqual([57])
    mouse.up(C4)
    expect(held()).toEqual([])
  })

  it('…Settings opens on its Keys tab: the note stops and letting go of the mouse selects nothing', async () => {
    const user = await startApp()
    // Settings was last left on its Keys tab, so it opens there.
    await openSettingsOn(user, 'Keys')
    await user.click(button('Close Settings'))
    expect(isChoosingKeys()).toBe(false)
    audio.state.calls.length = 0

    const mouse = theMouse()
    mouse.down(C4)
    expect(held()).toEqual([60])

    // The other hand, on the keyboard: Enter on the "Settings" button.
    button('Settings').focus()
    await user.keyboard('[Enter]')
    expect(isChoosingKeys()).toBe(true)
    expect(held()).toEqual([])
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])

    mouse.move(D4)
    mouse.up(D4)
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])
    expect(piano().querySelector('[aria-pressed="true"]')).toBeNull()
    expect(
      screen.getByText('Click a piano key below, then press the key you want to use for it.'),
    ).toBeTruthy()
  })

  it('…the page is hidden: the note stops, and the same key plays again afterwards', async () => {
    await startApp()
    const mouse = theMouse()
    mouse.down(C4)

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('blur'))
    })
    visibility.mockRestore()
    expect(held()).toEqual([])
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])

    // The button came up while the page could not see it. Back on the page:
    mouse.down(C4)
    expect(held()).toEqual([60])
    mouse.up(C4)
    expect(held()).toEqual([])
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60', 'on 60 0.8', 'off 60'])
  })

  it('…the page is left, with a second note held on the keyboard', async () => {
    const user = await startApp()
    const mouse = theMouse()
    mouse.down(C4)
    await user.keyboard('[KeyD>]')
    expect(held()).toEqual([60, 64])

    // The tab is closed, or another page is opened in its place.
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(held()).toEqual([])
    expect(litSlots()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('off')).sort()).toEqual(['off 60', 'off 64'])

    // Should the page come back as it was, what is still down holds nothing, and both play again.
    await user.keyboard('[/KeyD]')
    mouse.up(C4)
    expect(audio.state.calls).toHaveLength(4)
    mouse.down(C4)
    await user.keyboard('[KeyD>]')
    expect(held()).toEqual([60, 64])
    mouse.up(C4)
    await user.keyboard('[/KeyD]')
    expect(held()).toEqual([])
  })

  it('…the app is taken off the screen, with a second note held on the keyboard', async () => {
    const user = await startApp()
    theMouse().down(C4)
    await user.keyboard('[KeyD>]')
    expect(held()).toEqual([60, 64])
    cleanup()
    expect(held()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('off')).sort()).toEqual(['off 60', 'off 64'])
  })
})

describe('no stuck notes: the keyboard is holding a key when…', () => {
  it('…"Lower" is clicked in Settings: the note stops and the sky ends up idle', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Keys')
    // With no piano key selected the computer keys play as usual, so that the player can try them.
    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([60])
    browser.play(0.2)
    expect(bars()).toHaveLength(1)

    await user.click(button(/Lower/))
    expect(settingsStore.get().baseOctave).toBe(2)
    expect(held()).toEqual([])
    expect(litSlots()).toEqual([])
    expect(bars()).toHaveLength(0)
    browser.play(0.05)
    expect(browser.frames.pending.size).toBe(0)

    // The key is still down: letting go of it stops nothing more, and it then plays its new note.
    await user.keyboard('[/KeyA]')
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])
    await user.keyboard('[KeyA>]')
    expect(held()).toEqual([48])
    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
  })
})

describe('choosing the computer keys on the piano', () => {
  it('selects a key with the mouse without playing it or drawing a bar of light', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Keys')
    await user.click(pianoKey(D4))

    expect(screen.getByText('Press a key for D4…')).toBeTruthy()
    expect(pianoKey(D4).getAttribute('aria-pressed')).toBe('true')
    expect(pianoKey(D4).classList.contains('is-selected')).toBe(true)
    expect(busEvents).toEqual([])
    expect(bars()).toHaveLength(0)
    expect(browser.frames.pending.size).toBe(0)
    // The mouse did not leave the keyboard focus on the key.
    expect(document.activeElement).toBe(document.body)
  })

  it('selects a key with Tab and Enter, assigns the next key press, and never touches sustain', async () => {
    const user = await startApp()
    // Settings, opened and brought to its Keys tab with the keyboard alone.
    button('Settings').focus()
    await user.keyboard('[Enter]')
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    await user.keyboard('[Home][ArrowRight]')
    expect(document.activeElement).toBe(within(settings).getByRole('tab', { name: 'Keys' }))
    expect(isChoosingKeys()).toBe(true)
    expect(within(settings).getByRole('region', { name: 'Change one key' })).toBeTruthy()

    // The piano keys are now Tab stops, after the panel; walk to the first one.
    let guard = 0
    while (document.activeElement !== pianoKey(0)) {
      await user.tab()
      if (++guard > 40) throw new Error('Tab never reached the piano')
    }
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(pianoKey(2))

    await user.keyboard('[Enter]')
    expect(screen.getByText('Press a key for D3…')).toBeTruthy()

    await user.tab() // not a usable key: the selection stays where it is
    expect(document.activeElement).toBe(pianoKey(2))
    // Escape lets go of the piano key that was waiting, and leaves Settings open.
    await user.keyboard('[Escape]')
    expect(piano().querySelector('[aria-pressed="true"]')).toBeNull()
    expect(settingsPanel()).not.toBeNull()
    await user.tab()
    await user.keyboard('[Enter]')
    expect(screen.getByText('Press a key for D♯3…')).toBeTruthy()

    await user.keyboard('[KeyQ]')
    expect(settingsStore.get().bindings.KeyQ).toBe(3)
    expect(pianoKey(3).getAttribute('aria-label')).toBe('D♯3, key Q')
    expect(piano().querySelector('[aria-pressed="true"]')).toBeNull()
    expect(settingsStore.get().sustain).toBe(false)
    expect(busEvents).toEqual([])

    // The new key plays straight away, and Escape closes Settings, which ends
    // the choosing: the piano keys are Tab stops no longer, and the keyboard
    // focus is not left on one of them.
    await user.keyboard('[KeyQ]')
    expect(busEvents).toEqual(['on 51 keyboard', 'off 51 keyboard'])
    await user.keyboard('[Escape]')
    expect(settingsPanel()).toBeNull()
    expect(isChoosingKeys()).toBe(false)
    expect(piano().contains(document.activeElement)).toBe(false)
    expect(document.activeElement).toBe(button('Settings'))
    expect(piano().querySelectorAll('.piano-key[tabindex="0"]')).toHaveLength(0)
  })

  it('keeps Space for sustain while a piano key has the keyboard focus, and selects nothing with it', async () => {
    // docs/ARCHITECTURE.md 5.5: Space turns sustain on and off "including
    // when a button has focus, without also 'clicking' that button". While
    // the computer keys are chosen the piano keys are such buttons; Enter is
    // the key that presses them.
    const user = await startApp()
    await openSettingsOn(user, 'Keys')
    act(() => pianoKey(C4).focus())

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(piano().querySelector('[aria-pressed="true"]')).toBeNull()
    expect(screen.queryByText(/Press a key for/)).toBeNull()

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(false)
    expect(piano().querySelector('[aria-pressed="true"]')).toBeNull()
  })

  it('selects once when Enter is held down on a piano key', async () => {
    const user = await startApp()
    await openSettingsOn(user, 'Keys')
    act(() => pianoKey(C4).focus())
    await user.keyboard('{Enter>6/}')
    expect(screen.getByText('Press a key for C4…')).toBeTruthy()
    // The repeats of a key that is held down are not a new key press: holding
    // Enter is not the user choosing Enter for the note.
    expect(screen.queryByText(/can't be used/)).toBeNull()
  })
})

describe('the stage', () => {
  it('puts the sky directly above the piano, with one canvas in it, and nothing else', async () => {
    await startApp()
    const stage = document.querySelector('.stage')
    expect([...(stage?.children ?? [])].map((child) => child.className)).toEqual(['stage__sky', 'stage__piano'])

    // The canvas comes first: the few words written over the sky lie on top of the light.
    const sky = stage?.querySelector('.stage__sky')
    expect([...(sky?.children ?? [])].map((child) => child.className)).toEqual([
      'sky',
      'stage__hint',
      'stage__foot',
      'stage__line',
    ])
    expect(sky?.firstElementChild).toBe(skyCanvas())
    expect(stage?.querySelectorAll('canvas')).toHaveLength(1)
    expect([...(stage?.querySelector('.stage__piano')?.children ?? [])]).toEqual([piano()])
  })

  it('keeps the sky but draws no bar when Light bars is off, and still comes to rest', async () => {
    await startApp()
    act(() => settingsStore.set({ showTrails: false }))
    const stage = document.querySelector('.stage')
    expect([...(stage?.children ?? [])].map((child) => child.className)).toEqual(['stage__sky', 'stage__piano'])
    expect(stage?.querySelectorAll('canvas')).toHaveLength(1)

    const mouse = theMouse()
    mouse.down(C4)
    browser.play(0.2)
    expect(bars()).toHaveLength(0)
    expect(litSlots()).toEqual([String(C4)])
    mouse.up(C4)
    expect(held()).toEqual([])
    browser.playUntilIdle()
    expect(bars()).toHaveLength(0)
    expect(browser.frames.pending.size).toBe(0)
  })

  it('takes the bars away when Light bars is switched off in the middle of a note, and gives the note its bar back when it is switched on', async () => {
    const user = await startApp()
    const settings = await openSettingsOn(user, 'Look')
    const lightBars = within(settings).getByRole('switch', { name: 'Light bars' })
    await user.keyboard('[KeyA>]')
    browser.play(0.1)
    expect(bars()).toHaveLength(1)

    await user.click(lightBars)
    expect(settingsStore.get().showTrails).toBe(false)
    browser.frame()
    expect(bars()).toHaveLength(0)
    expect(held()).toEqual([60])

    // The note was already held when the bars came back: it has its light all the same.
    await user.click(lightBars)
    expect(settingsStore.get().showTrails).toBe(true)
    browser.play(0.1)
    expect(bars()).toHaveLength(1)

    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([])
    browser.playUntilIdle()
    expect(bars()).toHaveLength(0)
    expect(browser.frames.pending.size).toBe(0)
  })
})
