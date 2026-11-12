// @vitest-environment jsdom
/**
 * Long random sessions on the assembled app (src/App.tsx): computer keys
 * going down and up in any order, repeats of held keys, the mouse pressing,
 * dragging and letting go on the piano, clicks on the Settings tabs, the
 * ready-made layouts, Lower and Higher, the piano size, the keyboard type,
 * clicks on the sky, another window coming in front.
 *
 * Whatever happens, three things must hold after every step: no note sounds
 * that no held key and no pressed mouse button explains (a stuck note), every
 * computer key plays at most one note and every note has at most one key, and
 * the piano is in selection mode exactly while Settings shows its Keys tab.
 *
 * The runs are seeded, so a failure can be played again.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle' }
  /** The notes the engine was asked to start and not yet to stop. */
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
import { bus } from './app/pianoApp'
import { isBindableCode } from './input/keymap'
import { settingsStore } from './state/settings'
import { noteAtPoint } from './ui/pianoHitTest'
import { resetSongs } from './ui/songsTestKit'

/** Where the piano is on the make-believe screen. */
const BOX = { left: 0, top: 400, width: 1300, height: 150 }

/** Pointer capture, the way a browser does it (the simulated browser has none). */
const captured = new Map<number, Element>()

beforeEach(async () => {
  await resetSongs()
  settingsStore.reset()
  bus.allOff()
  audio.state.status = 'idle'
  audio.sounding.clear()
  captured.clear()
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.setPointerCapture = function (this: Element, pointerId: number): void {
    captured.set(pointerId, this)
  }
  proto.hasPointerCapture = function (this: Element, pointerId: number): boolean {
    return captured.get(pointerId) === this
  }
  proto.releasePointerCapture = function (this: Element, pointerId: number): void {
    if (captured.get(pointerId) === this) captured.delete(pointerId)
  }
})

afterEach(async () => {
  cleanup()
  const proto = Element.prototype as unknown as Record<string, unknown>
  delete proto.setPointerCapture
  delete proto.hasPointerCapture
  delete proto.releasePointerCapture
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
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

function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

/** The notes the piano shows right now. */
function shownRange(): { first: number; last: number } {
  const keys = piano().querySelectorAll<HTMLElement>('.piano-key')
  return {
    first: Number(keys[0]?.dataset.midi),
    last: Number(keys[keys.length - 1]?.dataset.midi),
  }
}

interface Point {
  /** Shares of the piano's width and height. Outside 0..1 is off the piano. */
  x: number
  y: number
}

/**
 * One mouse, sending what a browser sends: once the piano has captured it, its
 * events go to the piano wherever it is, and the capture ends after the release.
 */
class Mouse {
  isDown = false
  private at: Point = { x: 0.5, y: 0.5 }
  private pressedOn: number | null = null

  private init(extra: PointerEventInit = {}): PointerEventInit {
    return {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      buttons: this.isDown ? 1 : 0,
      button: -1,
      clientX: BOX.left + this.at.x * BOX.width,
      clientY: BOX.top + this.at.y * BOX.height,
      ...extra,
    }
  }

  private send(type: string, extra: PointerEventInit = {}): void {
    const target = captured.get(1) ?? piano()
    act(() => {
      target.dispatchEvent(new PointerEvent(type, this.init(extra)))
    })
  }

  private onPiano(): boolean {
    return this.at.x >= 0 && this.at.x < 1 && this.at.y >= 0 && this.at.y < 1
  }

  private keyUnder(): HTMLElement | null {
    const midi = noteAtPoint(this.at.x, this.at.y, shownRange())
    return midi === null ? null : piano().querySelector(`.piano-key[data-midi="${midi}"]`)
  }

  down(at: Point): void {
    this.at = at
    this.isDown = true
    this.pressedOn = noteAtPoint(at.x, at.y, shownRange())
    this.send('pointerdown', { button: 0 })
  }

  move(at: Point): void {
    this.at = at
    // A mouse that is neither over the piano nor captured by it sends the piano nothing.
    if (this.onPiano() || captured.has(1)) this.send('pointermove')
  }

  up(): void {
    this.isDown = false
    if (this.onPiano() || captured.has(1)) this.send('pointerup', { button: 0 })
    const holder = captured.get(1)
    if (holder) {
      captured.delete(1)
      act(() => {
        holder.dispatchEvent(new PointerEvent('lostpointercapture', this.init()))
      })
    }
    // Pressed and let go on the same key: the browser also sends a click to it.
    const under = this.keyUnder()
    if (under && Number(under.dataset.midi) === this.pressedOn) fireEvent.click(under, { detail: 1 })
    this.pressedOn = null
  }
}

/** Keys that can play notes, and the keys the app gives a job of their own. */
const CODES = [
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyK',
  'KeyZ',
  'KeyQ',
  'Digit2',
  'Semicolon',
  'Numpad1',
  'Space',
  'Escape',
  'Backspace',
  'Enter',
  'ShiftLeft',
  'Tab',
  'Delete',
]

/** The character a key types, as far as the app cares. */
function typed(code: string): string {
  return code.startsWith('Key') ? code.slice('Key'.length).toLowerCase() : code
}

/**
 * One run is 600 steps on the whole app: a second or two when it runs alone,
 * many times that when the machine runs the other test files at the same time.
 */
const RUN_TIMEOUT_MS = 60_000

describe('a long random session with the computer keys and the mouse', () => {
  /** The last runs draw the app the way development does: React draws everything twice. */
  const RUNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((run) => ({ run, strict: run > 9 }))

  it.each(RUNS)(
    'leaves no note stuck and keeps one key per note (run $run)',
    { timeout: RUN_TIMEOUT_MS },
    ({ run, strict }) => {
      let seed = run * 7919
      const next = (limit: number): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed % limit
      }
      /** Mostly on the piano, sometimes just off one of its edges. */
      const somewhere = (): Point => ({ x: (next(1100) - 50) / 1000, y: (next(1100) - 50) / 1000 })

      render(
        strict ? (
          <StrictMode>
            <App />
          </StrictMode>
        ) : (
          <App />
        ),
      )
      key('keydown', 'Enter')
      key('keyup', 'Enter')
      piano().getBoundingClientRect = () =>
        ({
          ...BOX,
          x: BOX.left,
          y: BOX.top,
          right: BOX.left + BOX.width,
          bottom: BOX.top + BOX.height,
          toJSON: () => ({}),
        }) as DOMRect

      /** The computer keys that are physically down. */
      const down = new Set<string>()
      const mouse = new Mouse()
      /** How many notes each kind of input started: the session must really have played. */
      const started = { keyboard: 0, pointer: 0 }
      const stopCounting = bus.subscribe((event) => {
        if (event.type === 'on' && (event.source === 'keyboard' || event.source === 'pointer')) {
          started[event.source] += 1
        }
      })
      const log: string[] = []
      const lately = (): string => log.slice(-14).join(' | ')

      function check(): void {
        const bindings = settingsStore.get().bindings
        const slots = Object.values(bindings)
        expect(new Set(slots).size, lately()).toBe(slots.length)
        expect(Object.keys(bindings).every(isBindableCode), lately()).toBe(true)

        const editing = piano().classList.contains('piano--editing')
        const dialog = screen.queryByRole('dialog', { name: 'Settings' })
        const onKeysTab =
          dialog !== null &&
          within(dialog).getByRole('tab', { name: 'Keys' }).getAttribute('aria-selected') === 'true'
        expect(editing, lately()).toBe(onKeysTab)
        expect(piano().querySelectorAll('.is-selected').length, lately()).toBeLessThanOrEqual(
          editing ? 1 : 0,
        )

        // A note that neither a held key nor the pressed mouse explains is a stuck note.
        const holders = [...down].filter(isBindableCode).length + (mouse.isDown ? 1 : 0)
        const held = bus.getActiveNotes()
        expect(held.size, lately()).toBeLessThanOrEqual(holders)
        expect([...audio.sounding].sort(), lately()).toEqual([...held].sort())
        const lit = [...piano().querySelectorAll<HTMLElement>('.is-lit')].map((element) =>
          Number(element.dataset.midi),
        )
        // Every sounding note that the piano shows is lit, and nothing else is.
        const { first, last } = shownRange()
        expect(lit.sort(), lately()).toEqual(
          [...held].filter((midi) => midi >= first && midi <= last).sort(),
        )
      }

      for (let step = 0; step < 600; step++) {
        const action = next(120)
        if (action < 28) {
          const code = CODES[next(CODES.length)] ?? 'KeyA'
          if (!down.has(code)) {
            down.add(code)
            key('keydown', code, { key: typed(code) })
            log.push(`down ${code}`)
          }
        } else if (action < 50) {
          const held = [...down]
          const code = held[next(Math.max(1, held.length))]
          if (code !== undefined) {
            down.delete(code)
            key('keyup', code, { key: typed(code) })
            log.push(`up ${code}`)
          }
        } else if (action < 56) {
          const held = [...down]
          const code = held[next(Math.max(1, held.length))]
          if (code !== undefined) {
            key('keydown', code, { key: typed(code), repeat: true })
            log.push(`repeat ${code}`)
          }
        } else if (action < 76) {
          const at = somewhere()
          const where = `${at.x.toFixed(2)},${at.y.toFixed(2)}`
          if (!mouse.isDown) {
            mouse.down(at)
            log.push(`mouse down ${where}`)
          } else if (next(3) === 0) {
            mouse.up()
            log.push('mouse up')
          } else {
            mouse.move(at)
            log.push(`mouse to ${where}`)
          }
        } else if (action < 91) {
          const sizes = ['auto', 88, 61, 49, 37] as const
          const pianoSize = sizes[next(sizes.length)] ?? 'auto'
          act(() => settingsStore.set({ pianoSize }))
          log.push(`piano size ${pianoSize}`)
        } else if (action < 93) {
          const types = ['auto', 'qwerty', 'azerty', 'qwertz'] as const
          act(() => settingsStore.set({ keyboardType: types[next(types.length)] ?? 'auto' }))
          log.push('keyboard type')
        } else if (action < 94) {
          // Another window comes in front: whatever is still down is no longer heard about.
          act(() => {
            window.dispatchEvent(new Event('blur'))
          })
          log.push('window loses focus')
          expect([...bus.getActiveNotes()], lately()).toEqual([])
        } else if (mouse.isDown) {
          // The one mouse is busy on the piano: it cannot click anything else.
        } else if (action < 100) {
          const dialog = screen.queryByRole('dialog', { name: 'Settings' })
          if (dialog === null) {
            clickWithMouse(screen.getByRole('button', { name: 'Settings' }))
            log.push('open Settings')
          } else {
            const tabs = ['Sound', 'Keys', 'Piano', 'Keys', 'Keys']
            const tab = tabs[next(tabs.length)] ?? 'Keys'
            clickWithMouse(within(dialog).getByRole('tab', { name: tab }))
            log.push(`tab ${tab}`)
          }
        } else if (action < 105) {
          const name = next(2) === 0 ? /Lower/ : /Higher/
          const target = screen.queryByRole('button', { name }) as HTMLButtonElement | null
          if (target && !target.disabled) {
            clickWithMouse(target)
            log.push(`click ${String(name)}`)
          }
        } else if (action < 111) {
          const group = screen.queryByRole('group', { name: 'Key layout' })
          const buttons = group ? within(group).getAllByRole('button') : []
          const target = buttons[next(Math.max(1, buttons.length))]
          if (target) {
            clickWithMouse(target)
            log.push(`click "${(target.textContent ?? '').slice(0, 14)}"`)
          }
        } else if (action < 115) {
          const answers = screen.queryAllByRole('button', { name: /Reset to default keys|^Yes$/ })
          const target = answers[next(Math.max(1, answers.length))]
          if (target) {
            clickWithMouse(target)
            log.push('click reset / Yes')
          }
        } else {
          clickWithMouse(document.querySelector('.stage__sky') as HTMLElement)
          log.push('click sky')
        }
        check()
      }

      if (mouse.isDown) mouse.up()
      check()
      for (const code of [...down]) {
        down.delete(code)
        key('keyup', code, { key: typed(code) })
        check()
      }
      stopCounting()
      expect([...bus.getActiveNotes()], lately()).toEqual([])
      expect([...audio.sounding], lately()).toEqual([])
      expect(started.keyboard).toBeGreaterThan(0)
      expect(started.pointer).toBeGreaterThan(0)
    },
  )
})
