// @vitest-environment jsdom
/**
 * The on-screen piano and the light trails inside the real <App />: what a
 * mouse or a finger on the piano does to the rest of the app, and what the
 * rest of the app (moving the piano, Customize keys, hiding the page) does to
 * a key that a pointer is holding.
 *
 * Only the sound engine is replaced (by a silent one that writes down what it
 * is asked to play). The canvas is a stand-in that counts the bars on it, and
 * the browser's frame clock is driven by the tests.
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
import { KEY_RECTS } from './core/keyGeometry'
import type { NoteEvent } from './core/types'
import { settingsStore } from './state/settings'
import { BLACK_KEY_HEIGHT } from './ui/pianoHitTest'

type User = ReturnType<typeof userEvent.setup>

const BOX = { left: 100, top: 300, width: 2200, height: 200 }

// ---------------------------------------------------------------------------
// Stand-ins for what the simulated browser lacks
// ---------------------------------------------------------------------------

const captured = new Map<number, Element>()

/** Counts the bars on the canvas since it was last wiped. */
const canvas = { bars: 0 }

const frames = { pending: new Map<number, FrameRequestCallback>(), nextId: 1, now: 1000 }

function frame(ms = 16): void {
  frames.now += ms
  const callbacks = [...frames.pending.values()]
  frames.pending.clear()
  for (const callback of callbacks) callback(frames.now)
}

function playFrames(count: number): void {
  for (let i = 0; i < count; i++) frame()
}

let busEvents: string[] = []
let stopLogging: () => void = () => {}

beforeEach(() => {
  audio.state.status = 'idle'
  audio.state.calls.length = 0
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
  captured.clear()
  canvas.bars = 0
  frames.pending.clear()
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

  const context = {
    canvas: null as HTMLCanvasElement | null,
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    setTransform(): void {},
    clearRect(): void {
      canvas.bars = 0
    },
    createLinearGradient: () => ({ addColorStop(): void {} }),
    save(): void {},
    restore(): void {},
    beginPath(): void {},
    roundRect(): void {
      canvas.bars++
    },
    fill(): void {},
    fillRect(): void {},
  }
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    context.canvas = this
    return context
  } as unknown as HTMLCanvasElement['getContext']
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => 2200 })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => 160 })

  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const id = frames.nextId++
    frames.pending.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    frames.pending.delete(id)
  })
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: false,
    addEventListener(): void {},
    removeEventListener(): void {},
  }))
})

afterEach(() => {
  cleanup()
  stopLogging()
  bus.allOff()
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

function toolbarButton(name: string | RegExp): HTMLElement {
  return within(screen.getByRole('region', { name: 'Controls' })).getByRole('button', { name })
}

function held(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function litSlots(): string[] {
  return [...piano().querySelectorAll<HTMLElement>('.piano-key.is-lit')].map((key) => key.dataset.slot ?? '?')
}

/** A point on the visible part of a key: black keys high up, white keys below the black ones. */
function pointOn(slot: number): { clientX: number; clientY: number } {
  const rect = KEY_RECTS[slot]
  if (!rect) throw new Error(`no key for slot ${slot}`)
  const heightShare = rect.black ? BLACK_KEY_HEIGHT / 2 : (1 + BLACK_KEY_HEIGHT) / 2
  return {
    clientX: BOX.left + (rect.left + rect.width / 2) * BOX.width,
    clientY: BOX.top + heightShare * BOX.height,
  }
}

function send(target: EventTarget, type: string, init: PointerEventInit): void {
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
  })
}

/** A finger (or the mouse) on the piano, sending what a browser sends. */
function pointer(pointerId: number, pointerType: 'mouse' | 'touch' = 'touch') {
  const base = { pointerId, pointerType, isPrimary: true }
  return {
    down(slot: number): void {
      send(pianoKey(slot), 'pointerdown', { ...base, button: 0, buttons: 1, ...pointOn(slot) })
    },
    move(slot: number): void {
      send(captured.get(pointerId) ?? piano(), 'pointermove', { ...base, button: -1, buttons: 1, ...pointOn(slot) })
    },
    /** Lifts the pointer the way Chrome does it: release, end of capture, then a click on the element that had the capture. */
    up(slot: number): void {
      const target = captured.get(pointerId) ?? pianoKey(slot)
      send(target, 'pointerup', { ...base, button: 0, buttons: 0, ...pointOn(slot) })
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
    const mouse = pointer(1, 'mouse')

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

  it('keeps a note that the keyboard and the mouse both hold until the last of them lets go', async () => {
    const user = await startApp()
    const mouse = pointer(1, 'mouse')
    await user.keyboard('[KeyA>]')
    mouse.down(C4)
    await user.keyboard('[/KeyA]')
    expect(held()).toEqual([60])
    expect(audio.state.calls.filter((call) => call.startsWith('off'))).toEqual([])
    mouse.up(C4)
    expect(held()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('off'))).toEqual(['off 60'])
  })

  it('gives the keyboard back to the piano when a key is pressed while the Labels drop-down has focus', async () => {
    const user = await startApp()
    const labels = screen.getByRole('combobox', { name: 'Labels' })
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

  it('draws a trail for a pointer note and goes idle after it', async () => {
    await startApp()
    const finger = pointer(5)
    expect(frames.pending.size).toBe(0)
    finger.down(C4)
    playFrames(10)
    expect(canvas.bars).toBe(1)
    finger.up(C4)
    playFrames(200)
    expect(canvas.bars).toBe(0)
    expect(frames.pending.size).toBe(0)
  })
})

describe('no stuck notes: a pointer is holding a key when…', () => {
  it('…the piano is moved higher with another finger', async () => {
    const user = await startApp()
    const finger = pointer(5)
    finger.down(C4)
    expect(held()).toEqual([60])

    await user.click(toolbarButton(/Higher/))
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(held()).toEqual([])
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])
    expect(litSlots()).toEqual([])

    // The finger is still down: sliding and lifting it starts nothing and stops nothing more.
    finger.move(D4)
    finger.up(D4)
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])
    // The next press plays the key's new note.
    finger.down(C4)
    expect(held()).toEqual([72])
    finger.up(C4)
    expect(held()).toEqual([])
  })

  it('…the piano is moved while the computer keyboard also holds a note: the trails end up idle', async () => {
    const user = await startApp()
    const finger = pointer(5)
    await user.keyboard('[KeyA>]')
    finger.down(E4)
    playFrames(10)
    expect(canvas.bars).toBe(2)

    await user.click(toolbarButton(/Lower/))
    expect(held()).toEqual([])
    expect(canvas.bars).toBe(0)
    playFrames(3)
    expect(frames.pending.size).toBe(0)

    await user.keyboard('[/KeyA]')
    finger.up(E4)
    expect(held()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('on'))).toHaveLength(2)
    expect(audio.state.calls.filter((call) => call.startsWith('off'))).toHaveLength(2)
  })

  it('…"Customize keys" is switched on: the note stops and lifting the finger selects nothing', async () => {
    const user = await startApp()
    const finger = pointer(5)
    finger.down(C4)

    await user.click(toolbarButton('Customize keys'))
    expect(held()).toEqual([])
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])

    finger.move(D4)
    finger.up(D4)
    expect(audio.state.calls).toEqual(['on 60 0.8', 'off 60'])
    expect(piano().querySelector('[aria-pressed="true"]')).toBeNull()
    expect(screen.getByText('Click a piano key, then press the key you want to use for it.')).toBeTruthy()
  })

  it('…the page is hidden: the note stops, and the same key plays again afterwards', async () => {
    await startApp()
    const mouse = pointer(1, 'mouse')
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

  it('…the app is taken off the screen', async () => {
    await startApp()
    pointer(5).down(C4)
    pointer(6).down(E4)
    cleanup()
    expect(held()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('off')).sort()).toEqual(['off 60', 'off 64'])
  })
})

describe('Customize keys on the piano', () => {
  it('selects a key with the mouse without playing it or drawing a trail', async () => {
    const user = await startApp()
    await user.click(toolbarButton('Customize keys'))
    await user.click(pianoKey(D4))

    expect(screen.getByText('Press a key for D4…')).toBeTruthy()
    expect(pianoKey(D4).getAttribute('aria-pressed')).toBe('true')
    expect(pianoKey(D4).classList.contains('is-selected')).toBe(true)
    expect(busEvents).toEqual([])
    expect(frames.pending.size).toBe(0)
    // The mouse did not leave the keyboard focus on the key.
    expect(document.activeElement).toBe(document.body)
  })

  it('selects a key with Tab and Enter, assigns the next key press, and never touches sustain', async () => {
    const user = await startApp()
    const customize = toolbarButton('Customize keys')
    customize.focus()
    await user.keyboard('[Enter]')
    expect(screen.getByRole('region', { name: 'Customize keys' })).toBeTruthy()

    // The piano keys are now Tab stops; walk to the first one.
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
    await user.keyboard('[Escape]')
    await user.tab()
    await user.keyboard('[Enter]')
    expect(screen.getByText('Press a key for D♯3…')).toBeTruthy()

    await user.keyboard('[KeyQ]')
    expect(settingsStore.get().bindings.KeyQ).toBe(3)
    expect(pianoKey(3).getAttribute('aria-label')).toBe('D♯3, key Q')
    expect(piano().querySelector('[aria-pressed="true"]')).toBeNull()
    expect(settingsStore.get().sustain).toBe(false)
    expect(busEvents).toEqual([])

    // The new key plays straight away, and Escape leaves edit mode: the piano
    // keys are Tab stops no longer, and none of them keeps the keyboard.
    await user.keyboard('[KeyQ]')
    expect(busEvents).toEqual(['on 51 keyboard', 'off 51 keyboard'])
    await user.keyboard('[Escape]')
    expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()
    expect(piano().contains(document.activeElement)).toBe(false)
    expect(piano().querySelectorAll('.piano-key[tabindex="0"]')).toHaveLength(0)
  })

  it('keeps Space for sustain while a piano key has the keyboard focus, and selects nothing with it', async () => {
    // The spec (5.5): Space turns sustain on and off "including when a button
    // has focus, without also 'clicking' that button". In Customize keys the
    // piano keys are such buttons; Enter is the key that presses them.
    const user = await startApp()
    await user.click(toolbarButton('Customize keys'))
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
    await user.click(toolbarButton('Customize keys'))
    act(() => pianoKey(C4).focus())
    await user.keyboard('{Enter>6/}')
    expect(screen.getByText('Press a key for C4…')).toBeTruthy()
    // The repeats of a key that is held down are not a new key press: holding
    // Enter is not the user choosing Enter for the note.
    expect(screen.queryByText(/can't be used/)).toBeNull()
  })
})

describe('the stage', () => {
  it('puts the trails canvas directly above the piano, and nothing else', async () => {
    await startApp()
    const stage = document.querySelector('.stage')
    expect([...(stage?.children ?? [])].map((child) => child.className)).toEqual(['stage__trails', 'piano'])
    const trails = stage?.querySelector('.stage__trails')
    expect([...(trails?.children ?? [])].map((child) => child.tagName)).toEqual(['CANVAS'])
  })

  it('is just the piano when Light trails is off, and playing then needs no frames', async () => {
    await startApp()
    act(() => settingsStore.set({ showTrails: false }))
    const stage = document.querySelector('.stage')
    expect([...(stage?.children ?? [])].map((child) => child.className)).toEqual(['piano'])
    const finger = pointer(5)
    finger.down(C4)
    expect(frames.pending.size).toBe(0)
    finger.up(C4)
    expect(held()).toEqual([])
  })

  it('stops the trails at once when Light trails is switched off in the middle of a note', async () => {
    await startApp()
    const finger = pointer(5)
    finger.down(C4)
    playFrames(5)
    expect(frames.pending.size).toBe(1)
    act(() => settingsStore.set({ showTrails: false }))
    expect(frames.pending.size).toBe(0)
    expect(held()).toEqual([60])
    finger.up(C4)
    expect(held()).toEqual([])
  })
})
