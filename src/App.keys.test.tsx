// @vitest-environment jsdom
/**
 * The computer keys and the piano in the assembled app (src/App.tsx), under
 * the unhappy paths: keys held down while something changes under them, the
 * keyboard zone at every position of every piano size, changing one key in
 * every awkward way, and the ready-made layouts.
 *
 * The sound engine and the sky are replaced by stand-ins; each has tests of
 * its own. There is no layout here, so the piano has the size the test gives
 * the "Piano size" setting.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle' }
  /** "on 60" / "off 60", as the engine was told. */
  const heard: string[] = []
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
      heard.push(`on ${midi}`)
    },
    noteOff(midi: number): void {
      heard.push(`off ${midi}`)
    },
    setSustain(): void {},
    setVolume(): void {},
    setTranspose(): void {},
    setReverb(): void {},
    setRelease(): void {},
    allNotesOff(): void {},
    dispose(): void {},
  }
  return { engine, state, heard }
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
import {
  MAX_BASE_OCTAVE,
  MIN_BASE_OCTAVE,
  PIANO_SIZES,
  SLOT_COUNT,
  slotToMidi,
} from './core/layout'
import { isBlackKey, noteName } from './core/notes'
import { DEFAULT_BINDINGS, KEY_PRESETS, isBindableCode } from './input/keymap'
import type { Bindings } from './input/keymap'
import { STORAGE_KEY, settingsStore } from './state/settings'
import { resetSongs } from './ui/songsTestKit'

const UNUSABLE = "That key can't be used. Try a letter, number or symbol key."

interface NodeFiles {
  readFileSync(path: string, encoding: 'utf8'): string
}

interface NodeUrls {
  fileURLToPath(url: string): string
}

// The test runner empties stylesheets that are imported, so the piano's is read
// from disk. (Loaded this way because the project has no Node type definitions.)
const nodeFilesModule = 'node:fs'
const nodeUrlsModule = 'node:url'
const { readFileSync } = (await import(/* @vite-ignore */ nodeFilesModule)) as NodeFiles
const { fileURLToPath } = (await import(/* @vite-ignore */ nodeUrlsModule)) as NodeUrls
const pianoCssPath = fileURLToPath(import.meta.url.replace(/[^/]*$/, 'ui/piano.css'))

/** The stylesheet of the piano, without its comments. */
const pianoCss = readFileSync(pianoCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** What the stylesheet gives one property of the line that marks the keyboard zone. */
function zoneLineStyle(property: string): string {
  const declarations = /\.piano__zone\s*\{([^{}]*)\}/.exec(pianoCss)?.[1] ?? ''
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(declarations)
  return found?.[1]?.trim().replace(/\s+/g, ' ') ?? ''
}

beforeEach(async () => {
  await resetSongs()
  settingsStore.reset()
  bus.allOff()
  audio.state.status = 'idle'
  audio.heard.length = 0
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
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

/** Draws the app and gets past the start overlay. */
function startApp(): void {
  render(<App />)
  tap('Enter')
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function panel(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Settings' })
}

/** Opens Settings on one of its tabs. (The panel remembers its last tab from test to test.) */
function openSettingsOn(tab: string): HTMLElement {
  if (!panel()) clickWithMouse(button('Settings'))
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

function pianoKey(midi: number): HTMLElement {
  return piano().querySelector(`.piano-key[data-midi="${midi}"]`) as HTMLElement
}

function keycap(midi: number): string | undefined {
  return pianoKey(midi).querySelector('.piano-key__cap')?.textContent ?? undefined
}

function selectedKeys(): number[] {
  return [...piano().querySelectorAll<HTMLElement>('.is-selected')].map((element) =>
    Number(element.dataset.midi),
  )
}

function litKeys(): number[] {
  return [...piano().querySelectorAll<HTMLElement>('.is-lit')].map((element) =>
    Number(element.dataset.midi),
  )
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

/** The line of the Keys tab that says what the last change did. */
function message(): string {
  return document.querySelector('.change-key__message')?.textContent ?? ''
}

function lead(): string {
  return document.querySelector('.change-key__lead')?.textContent ?? ''
}

function layoutCard(name: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'Key layout' })).getByRole('button', { name })
}

function chosenLayouts(): string[] {
  return KEY_PRESETS.map((preset) => preset.name).filter(
    (name) => layoutCard(name).getAttribute('aria-pressed') === 'true',
  )
}

function saysCustom(): boolean {
  return (
    within(screen.getByRole('group', { name: 'Key layout' })).queryByText('Custom') !== null
  )
}

/** Every sound the engine was asked to start has been stopped again. */
function nothingLeftSounding(): boolean {
  const sounding = new Map<string, number>()
  for (const entry of audio.heard) {
    const [what, midi] = entry.split(' ') as [string, string]
    sounding.set(midi, (sounding.get(midi) ?? 0) + (what === 'on' ? 1 : -1))
  }
  return [...sounding.values()].every((count) => count <= 0)
}

const ZONE_POSITIONS = Array.from(
  { length: MAX_BASE_OCTAVE - MIN_BASE_OCTAVE + 1 },
  (_, index) => MIN_BASE_OCTAVE + index,
)

describe('the keyboard zone on every piano', () => {
  const cases = PIANO_SIZES.flatMap((size) =>
    ZONE_POSITIONS.map((baseOctave) => ({ size, baseOctave })),
  )

  it.each(cases)(
    'a piano of $size keys with the keys sitting at octave $baseOctave shows every note the computer keys play',
    ({ size, baseOctave }) => {
      act(() => settingsStore.set({ pianoSize: size, baseOctave }))
      startApp()

      const shown = pianoKeys().map((element) => Number(element.dataset.midi))
      expect(shown).toHaveLength(size)
      // No gaps and no repeats: a real run of piano keys.
      expect(shown).toEqual(shown.map((_, index) => (shown[0] ?? 0) + index))
      expect(shown[0]).toBeGreaterThanOrEqual(21)
      expect(shown.at(-1)).toBeLessThanOrEqual(108)

      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        const midi = slotToMidi(slot, baseOctave)
        expect(pianoKey(midi), `the key of ${noteName(midi)}`).not.toBeNull()
        expect(pianoKey(midi).dataset.slot).toBe(String(slot))
      }
      // Exactly 37 keys belong to the zone, whatever the piano.
      expect(piano().querySelectorAll('.piano-key[data-slot]')).toHaveLength(SLOT_COUNT)
    },
  )

  it.each(cases)(
    'on $size keys at octave $baseOctave every default key lights the piano key that carries its letter',
    ({ size, baseOctave }) => {
      act(() => settingsStore.set({ pianoSize: size, baseOctave }))
      startApp()

      for (const [code, slot] of Object.entries(DEFAULT_BINDINGS)) {
        const midi = slotToMidi(slot, baseOctave)
        key('keydown', code)
        expect(litKeys(), code).toEqual([midi])
        expect(pianoKey(midi).getAttribute('aria-pressed')).toBe('true')
        expect(keycap(midi)).toBeDefined()
        key('keyup', code)
        expect(litKeys(), code).toEqual([])
      }
      expect(nothingLeftSounding()).toBe(true)
    },
  )

  it('keys outside the zone carry no keycap, only their note, and say so to screen readers', () => {
    act(() => settingsStore.set({ pianoSize: 88, baseOctave: 3 }))
    startApp()

    const outside = pianoKeys().filter((element) => element.dataset.slot === undefined)
    expect(outside).toHaveLength(88 - SLOT_COUNT)
    for (const element of outside) {
      const midi = Number(element.dataset.midi)
      expect(element.querySelector('.piano-key__cap')).toBeNull()
      expect(element.getAttribute('aria-label')).toBe(noteName(midi))
      expect(element.getAttribute('aria-pressed')).toBe('false')
      expect(element.hasAttribute('aria-disabled')).toBe(false)
    }
  })

  it('marks the zone with a line only on a piano that is larger than it', () => {
    act(() => settingsStore.set({ pianoSize: 37 }))
    startApp()
    expect(piano().querySelector('.piano__zone')).toBeNull()

    for (const size of [49, 61, 88] as const) {
      for (const baseOctave of ZONE_POSITIONS) {
        act(() => settingsStore.set({ pianoSize: size, baseOctave }))
        const line = piano().querySelector<HTMLElement>('.piano__zone')
        expect(line, `${size} keys at octave ${baseOctave}`).not.toBeNull()

        const first = pianoKey(slotToMidi(0, baseOctave))
        const last = pianoKey(slotToMidi(SLOT_COUNT - 1, baseOctave))
        const left = Number.parseFloat(first.style.left)
        const right = Number.parseFloat(last.style.left) + Number.parseFloat(last.style.width)
        expect(Number.parseFloat(line?.style.left ?? '')).toBeCloseTo(left, 3)
        expect(Number.parseFloat(line?.style.width ?? '')).toBeCloseTo(right - left, 3)
        // On the piano from end to end, never past its edges.
        expect(left).toBeGreaterThanOrEqual(0)
        expect(right).toBeLessThanOrEqual(100 + 1e-9)
      }
    }
  })

  it('gives that line a dark edge of its own, so that a pale light still shows on pale keys', () => {
    // White light on the ivory keys of the Classic style: a line in the light
    // alone could hardly be told from the keys it is drawn on.
    expect(zoneLineStyle('background')).toContain('var(--light)')
    const edge = zoneLineStyle('box-shadow')

    // The dark of the stage, and not one more glow in the colour of the light.
    expect(edge).toContain('var(--stage-bg)')
    expect(edge).not.toContain('var(--light')
    // A hairline: no part of it is wider than a pixel.
    const lengths = [...edge.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]))
    expect(lengths.length).toBeGreaterThan(0)
    for (const length of lengths) expect(Math.abs(length)).toBeLessThanOrEqual(1)
  })

  it('"Auto" in a window too small to measure is the smallest piano, which is exactly the zone', () => {
    startApp()
    expect(settingsStore.get().pianoSize).toBe('auto')
    expect(pianoKeys()).toHaveLength(37)
    expect(piano().querySelectorAll('.piano-key[data-slot]')).toHaveLength(37)
  })
})

describe('Lower and Higher', () => {
  function lower(): HTMLButtonElement {
    return button(/Lower/) as HTMLButtonElement
  }

  function higher(): HTMLButtonElement {
    return button(/Higher/) as HTMLButtonElement
  }

  it('stop at both ends of the piano, where the button is switched off', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    openSettingsOn('Keys')

    for (let press = 0; press < 10; press++) {
      if (!lower().disabled) clickWithMouse(lower())
    }
    expect(settingsStore.get().baseOctave).toBe(MIN_BASE_OCTAVE)
    expect(lower().disabled).toBe(true)
    expect(screen.getByText('C1 – C4')).toBeTruthy()
    // A click that gets through anyway (the button was just switched off) moves nothing.
    fireEvent.click(lower())
    expect(settingsStore.get().baseOctave).toBe(MIN_BASE_OCTAVE)

    for (let press = 0; press < 10; press++) {
      if (!higher().disabled) clickWithMouse(higher())
    }
    expect(settingsStore.get().baseOctave).toBe(MAX_BASE_OCTAVE)
    expect(higher().disabled).toBe(true)
    expect(screen.getByText('C5 – C8')).toBeTruthy()
    expect(pianoKey(108).dataset.slot).toBe('36')
  })

  it('let go of the notes held when the keys move, and the keys play their new notes at the next press', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    openSettingsOn('Keys')

    key('keydown', 'KeyA')
    key('keydown', 'KeyD')
    expect(heldNotes()).toEqual([60, 64])

    clickWithMouse(lower())
    expect(heldNotes()).toEqual([])
    expect(litKeys()).toEqual([])

    // Still down: the repeats a held key sends start nothing.
    expect(key('keydown', 'KeyA', { repeat: true }).defaultPrevented).toBe(true)
    expect(heldNotes()).toEqual([])

    key('keyup', 'KeyA')
    key('keyup', 'KeyD')
    expect(heldNotes()).toEqual([])

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([48])
    key('keyup', 'KeyA')
    expect(nothingLeftSounding()).toBe(true)
  })

  it('keep the piano key that is waiting for a computer key, and name its new note', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    expect(lead()).toBe('Press a key for E4…')

    clickWithMouse(higher())
    expect(selectedKeys()).toEqual([76])
    expect(lead()).toBe('Press a key for E5…')

    tap('KeyM', { key: 'm' })
    expect(settingsStore.get().bindings.KeyM).toBe(16)
    expect(message()).toContain('"M" now plays E5.')
  })
})

describe('changing one key', () => {
  function startChanging(midi: number): void {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(midi))
  }

  it('ignores the repeats of a key that was already down when the piano key was clicked', () => {
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyJ', { key: 'j' })
    expect(heldNotes()).toEqual([71])

    fireEvent.click(pianoKey(64))
    // Choosing a piano key makes the piano go quiet.
    expect(heldNotes()).toEqual([])

    for (let repeat = 0; repeat < 4; repeat++) {
      expect(key('keydown', 'KeyJ', { key: 'j', repeat: true }).defaultPrevented).toBe(true)
    }
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(selectedKeys()).toEqual([64])

    key('keyup', 'KeyJ', { key: 'j' })
    expect(selectedKeys()).toEqual([64])
    expect(heldNotes()).toEqual([])

    // Pressed again, it is the player's choice.
    key('keydown', 'KeyJ', { key: 'j' })
    expect(settingsStore.get().bindings.KeyJ).toBe(16)
    expect(message()).toBe('"J" now plays E4. "D" no longer plays a note. B4 has no key now.')
    expect(heldNotes()).toEqual([])

    // Still down after the change: its repeats play nothing, its release is quiet.
    key('keydown', 'KeyJ', { key: 'j', repeat: true })
    expect(heldNotes()).toEqual([])
    key('keyup', 'KeyJ', { key: 'j' })
    expect(nothingLeftSounding()).toBe(true)
  })

  it('removes the key with Backspace and with Delete, and the old key then plays nothing', () => {
    startChanging(60)
    const backspace = key('keydown', 'Backspace', { key: 'Backspace' })
    expect(backspace.defaultPrevented).toBe(true)
    key('keyup', 'Backspace')
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()
    expect(message()).toBe('C4 has no key now.')
    expect(keycap(60)).toBeUndefined()
    expect(pianoKey(60).getAttribute('aria-label')).toBe('C4')

    tap('KeyA', { key: 'a' })
    expect(audio.heard).toEqual([])

    fireEvent.click(pianoKey(62))
    tap('Delete', { key: 'Delete' })
    expect(settingsStore.get().bindings.KeyS).toBeUndefined()
    expect(message()).toBe('D4 has no key now.')
    expect(selectedKeys()).toEqual([])
  })

  it('says the same when the piano key had no computer key to remove', () => {
    startChanging(48)
    tap('Backspace', { key: 'Backspace' })
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(message()).toBe('C3 has no key now.')
    expect(selectedKeys()).toEqual([])
  })

  it.each([
    ['Enter', 'Enter'],
    ['Space', ' '],
    ['Tab', 'Tab'],
    ['ArrowLeft', 'ArrowLeft'],
    ['ShiftLeft', 'Shift'],
    ['CapsLock', 'CapsLock'],
    ['NumpadEnter', 'Enter'],
    ['PageDown', 'PageDown'],
  ])('refuses %s, keeps waiting and keeps that key from doing anything else', (code, keyName) => {
    startChanging(60)
    const before = settingsStore.get()

    expect(key('keydown', code, { key: keyName }).defaultPrevented).toBe(true)
    key('keyup', code, { key: keyName })

    expect(message()).toBe(UNUSABLE)
    expect(selectedKeys()).toEqual([60])
    expect(settingsStore.get()).toBe(before)
    expect(panel()).not.toBeNull()
  })

  it('leaves the function keys to the browser, and says they cannot be used', () => {
    startChanging(60)
    expect(key('keydown', 'F5', { key: 'F5' }).defaultPrevented).toBe(false)
    expect(message()).toBe(UNUSABLE)
    expect(selectedKeys()).toEqual([60])
  })

  it('never takes a key pressed with Ctrl, Alt or the Windows key: those are shortcuts', () => {
    startChanging(60)
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      const press = key('keydown', 'KeyM', { key: 'm', [modifier]: true })
      expect(press.defaultPrevented).toBe(false)
      key('keyup', 'KeyM', { key: 'm', [modifier]: true })
    }
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(selectedKeys()).toEqual([60])
    expect(message()).toBe('')
  })

  it('takes a key pressed with Shift as that key alone: one key, one note', () => {
    startChanging(60)
    key('keydown', 'ShiftLeft', { key: 'Shift', shiftKey: true })
    key('keydown', 'KeyM', { key: 'M', shiftKey: true })
    key('keyup', 'KeyM', { key: 'M', shiftKey: true })
    key('keyup', 'ShiftLeft', { key: 'Shift' })

    expect(settingsStore.get().bindings.KeyM).toBe(12)
    expect(message()).toBe('"M" now plays C4. "A" no longer plays a note.')

    // With or without Shift, the key plays its note.
    key('keydown', 'KeyM', { key: 'm' })
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyM', { key: 'm' })
    key('keydown', 'KeyM', { key: 'M', shiftKey: true })
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyM', { key: 'M', shiftKey: true })
    expect(nothingLeftSounding()).toBe(true)
  })

  it('gives a key that is already used elsewhere to the new piano key, and says what lost its key', () => {
    startChanging(60)
    tap('KeyK', { key: 'k' })

    expect(settingsStore.get().bindings.KeyK).toBe(12)
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()
    expect(message()).toBe('"K" now plays C4. "A" no longer plays a note. C5 has no key now.')
    expect(keycap(60)).toBe('K')
    expect(keycap(72)).toBeUndefined()

    // One key = one note: K plays C4 and nothing else, A plays nothing.
    key('keydown', 'KeyK')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyK')
    tap('KeyA')
    expect(heldNotes()).toEqual([])
  })

  it('changes nothing when the piano key is given the key it already has', () => {
    startChanging(60)
    tap('KeyA', { key: 'a' })

    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(message()).toBe('"A" now plays C4.')
    expect(selectedKeys()).toEqual([])
    expect(chosenLayouts()).toEqual(['Home row'])
  })

  it('takes an accent key that types nothing by itself (a "dead" key)', () => {
    act(() => settingsStore.set({ keyboardType: 'azerty' }))
    startChanging(60)
    tap('BracketLeft', { key: 'Dead' })

    expect(settingsStore.get().bindings.BracketLeft).toBe(12)
    expect(settingsStore.get().customLabels).toEqual({})
    expect(message()).toBe('"^" now plays C4. "Q" no longer plays a note.')
    expect(keycap(60)).toBe('^')
  })

  // 150 changes on the whole app: well over a second alone, and many times that
  // when the machine runs the other test files at the same time.
  it('keeps one key per note through a long run of changes', { timeout: 30_000 }, () => {
    startApp()
    openSettingsOn('Keys')
    const codes = ['KeyA', 'KeyK', 'Digit1', 'Numpad5', 'Slash', 'KeyZ', 'Semicolon', 'IntlBackslash']
    let seed = 7
    const next = (limit: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % limit
    }

    for (let step = 0; step < 150; step++) {
      const midi = 48 + next(SLOT_COUNT)
      fireEvent.click(pianoKey(midi))
      const choice = next(codes.length + 2)
      if (choice === codes.length) tap('Backspace', { key: 'Backspace' })
      else if (choice === codes.length + 1) tap('Escape', { key: 'Escape' })
      else tap(codes[choice] ?? 'KeyA', { key: 'x' })

      const bindings = settingsStore.get().bindings
      const slots = Object.values(bindings)
      expect(new Set(slots).size).toBe(slots.length)
      expect(Object.keys(bindings).every(isBindableCode)).toBe(true)
      // What is drawn is what is saved: one keycap per bound key.
      expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(slots.length)
      expect(selectedKeys()).toEqual([])
    }
    expect(panel()).not.toBeNull()
    expect(heldNotes()).toEqual([])
  })

  it('ends when another tab of Settings is shown, and the next key press plays', () => {
    startChanging(64)
    clickWithMouse(screen.getByRole('tab', { name: 'Piano' }))

    expect(selectedKeys()).toEqual([])
    expect(piano().classList.contains('piano--editing')).toBe(false)
    key('keydown', 'KeyM', { key: 'm' })
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    key('keyup', 'KeyM', { key: 'm' })

    // Back on the Keys tab nothing is waiting any more and the last message is gone.
    clickWithMouse(screen.getByRole('tab', { name: 'Keys' }))
    expect(selectedKeys()).toEqual([])
    expect(lead()).toBe('Click a piano key below, then press the key you want to use for it.')
    expect(message()).toBe('')
  })

  it.each(['the close button', 'a click on the sky', 'the Settings button', 'the Songs button'])(
    'ends when the panel is closed with %s, and the next key press plays',
    (how) => {
      startChanging(64)
      if (how === 'the close button') clickWithMouse(button('Close Settings'))
      else if (how === 'a click on the sky') {
        clickWithMouse(document.querySelector('.stage__sky') as HTMLElement)
      } else if (how === 'the Settings button') clickWithMouse(button('Settings'))
      else clickWithMouse(button('Songs'))

      expect(panel()).toBeNull()
      expect(piano().classList.contains('piano--editing')).toBe(false)
      expect(piano().querySelector('.is-selected')).toBeNull()

      key('keydown', 'KeyD', { key: 'd' })
      expect(heldNotes()).toEqual([64])
      expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
      key('keyup', 'KeyD', { key: 'd' })
    },
  )

  it('is cancelled by "Reset to default keys", which puts every key back', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(60))
    tap('KeyM', { key: 'm' })
    fireEvent.click(pianoKey(64))
    expect(selectedKeys()).toEqual([64])

    clickWithMouse(button('Reset to default keys'))
    // Asking changes nothing yet.
    expect(selectedKeys()).toEqual([64])
    expect(settingsStore.get().bindings.KeyM).toBe(12)
    clickWithMouse(button('Yes'))

    expect(selectedKeys()).toEqual([])
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(settingsStore.get().customLabels).toEqual({})
    expect(message()).toBe('The default keys are back.')
    expect(chosenLayouts()).toEqual(['Home row'])

    // The key pressed next plays: it is not taken for the piano key that was waiting.
    key('keydown', 'KeyM', { key: 'm' })
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    key('keyup', 'KeyM', { key: 'm' })
  })

  it('only lets keys of the zone be chosen on a large piano: the others are out of reach', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    openSettingsOn('Keys')

    for (const midi of [21, 47, 85, 108]) {
      fireEvent.click(pianoKey(midi))
      expect(selectedKeys(), noteName(midi)).toEqual([])
      expect(pianoKey(midi).getAttribute('aria-disabled')).toBe('true')
      expect(pianoKey(midi).tabIndex).toBe(-1)
    }
    expect(lead()).toBe('Click a piano key below, then press the key you want to use for it.')

    for (const midi of [48, 84]) {
      fireEvent.click(pianoKey(midi))
      expect(selectedKeys()).toEqual([midi])
      expect(pianoKey(midi).getAttribute('aria-pressed')).toBe('true')
      expect(pianoKey(midi).hasAttribute('aria-disabled')).toBe(false)
    }
  })

  it('says pressed only for the key that is waiting, also while notes sound', () => {
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyA')
    expect(litKeys()).toEqual([60])
    // While choosing keys, "pressed" means "selected".
    expect(pianoKey(60).getAttribute('aria-pressed')).toBe('false')
    key('keyup', 'KeyA')

    fireEvent.click(pianoKey(62))
    const pressed = pianoKeys().filter((element) => element.getAttribute('aria-pressed') === 'true')
    expect(pressed.map((element) => Number(element.dataset.midi))).toEqual([62])
  })
})

describe('a note held while its key is given away', () => {
  it('stops when the piano key is clicked, and the old key is quiet from then on', () => {
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyA')
    expect(audio.heard).toEqual(['on 60'])

    // A is still down while its piano key is clicked and given to another key.
    fireEvent.click(pianoKey(60))
    expect(audio.heard).toEqual(['on 60', 'off 60'])
    tap('KeyM', { key: 'm' })
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()

    key('keydown', 'KeyA', { repeat: true })
    key('keyup', 'KeyA')
    expect(audio.heard).toEqual(['on 60', 'off 60'])
    expect(heldNotes()).toEqual([])
  })

  it('stops at its own release when a layout takes its key away while it sounds', () => {
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    // "Two octaves" has no note on A.
    clickWithMouse(layoutCard('Two octaves'))
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()

    key('keydown', 'KeyA', { repeat: true })
    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
    expect(nothingLeftSounding()).toBe(true)
  })

  it('stops the note it started, not the one it now plays, when a layout moves its key', () => {
    startApp()
    openSettingsOn('Keys')
    // Home row: S is D4. Two octaves: S is C♯3.
    key('keydown', 'KeyS')
    expect(heldNotes()).toEqual([62])
    clickWithMouse(layoutCard('Two octaves'))

    key('keyup', 'KeyS')
    expect(heldNotes()).toEqual([])
    key('keydown', 'KeyS')
    expect(heldNotes()).toEqual([49])
    key('keyup', 'KeyS')
    expect(nothingLeftSounding()).toBe(true)
  })

  it('stops when the keys are reset while it sounds', () => {
    act(() => settingsStore.set({ bindings: { KeyM: 12 } }))
    startApp()
    openSettingsOn('Keys')
    key('keydown', 'KeyM')
    expect(heldNotes()).toEqual([60])

    clickWithMouse(button('Reset to default keys'))
    clickWithMouse(button('Yes'))
    key('keyup', 'KeyM')
    expect(heldNotes()).toEqual([])
    expect(nothingLeftSounding()).toBe(true)
  })
})

describe('the ready-made layouts', () => {
  function playsOneNotePerKey(bindings: Bindings): void {
    for (const [code, slot] of Object.entries(bindings)) {
      key('keydown', code)
      expect(heldNotes(), code).toEqual([slotToMidi(slot, 3)])
      key('keyup', code)
      expect(heldNotes(), code).toEqual([])
    }
  }

  it.each(KEY_PRESETS)('"$name" plays one note per key, and with Shift held the same note', (preset) => {
    startApp()
    openSettingsOn('Keys')
    if (preset.name !== 'Home row') clickWithMouse(layoutCard(preset.name))

    expect(chosenLayouts()).toEqual([preset.name])
    expect(saysCustom()).toBe(false)
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(
      Object.keys(preset.bindings).length,
    )
    playsOneNotePerKey(preset.bindings)

    for (const [code, slot] of Object.entries(preset.bindings)) {
      key('keydown', code, { shiftKey: true })
      expect(heldNotes(), code).toEqual([slotToMidi(slot, 3)])
      key('keyup', code, { shiftKey: true })
    }
    expect(nothingLeftSounding()).toBe(true)
  })

  it('"White keys only" plays no black key, "Two octaves" plays both colours', () => {
    const white = KEY_PRESETS.find((preset) => preset.id === 'white-keys')
    const two = KEY_PRESETS.find((preset) => preset.id === 'two-octaves')
    expect(Object.values(white?.bindings ?? {}).some((slot) => isBlackKey(slotToMidi(slot, 3)))).toBe(
      false,
    )
    const colours = Object.values(two?.bindings ?? {}).map((slot) => isBlackKey(slotToMidi(slot, 3)))
    expect(colours.filter(Boolean)).toHaveLength(13)
    expect(colours.filter((black) => !black)).toHaveLength(19)
  })

  it('sit on the same physical keys whatever the keyboard: only the letters drawn change', () => {
    startApp()
    openSettingsOn('Keys')
    clickWithMouse(layoutCard('White keys only'))
    const bindings = settingsStore.get().bindings

    expect(keycap(48)).toBe('Z')
    expect(keycap(60)).toBe('A')
    expect(keycap(72)).toBe('Q')

    clickWithMouse(button('AZERTY'))
    expect(settingsStore.get().bindings).toBe(bindings)
    // The same three physical keys, as a French keyboard prints them.
    expect(keycap(48)).toBe('W')
    expect(keycap(60)).toBe('Q')
    expect(keycap(72)).toBe('A')
    expect(chosenLayouts()).toEqual(['White keys only'])

    clickWithMouse(button('QWERTZ'))
    expect(settingsStore.get().bindings).toBe(bindings)
    expect(keycap(48)).toBe('Y')
    expect(keycap(81)).toBe('Z')
    expect(chosenLayouts()).toEqual(['White keys only'])

    key('keydown', 'KeyZ')
    expect(heldNotes()).toEqual([48])
    key('keyup', 'KeyZ')
  })

  it('show "Custom" exactly while the keys match no layout', () => {
    startApp()
    openSettingsOn('Keys')
    expect(saysCustom()).toBe(false)
    expect(chosenLayouts()).toEqual(['Home row'])

    // One key moved.
    fireEvent.click(pianoKey(48))
    tap('KeyZ', { key: 'z' })
    expect(saysCustom()).toBe(true)
    expect(chosenLayouts()).toEqual([])

    // And taken back off: the keys are the Home row again.
    fireEvent.click(pianoKey(48))
    tap('Backspace', { key: 'Backspace' })
    expect(saysCustom()).toBe(false)
    expect(chosenLayouts()).toEqual(['Home row'])

    // One key removed.
    fireEvent.click(pianoKey(60))
    tap('Delete', { key: 'Delete' })
    expect(saysCustom()).toBe(true)

    // The same key given back.
    fireEvent.click(pianoKey(60))
    tap('KeyA', { key: 'a' })
    expect(saysCustom()).toBe(false)
    expect(chosenLayouts()).toEqual(['Home row'])

    // Where the keys sit and what is printed on them are not part of a layout.
    clickWithMouse(button(/Lower/))
    clickWithMouse(button('AZERTY'))
    expect(saysCustom()).toBe(false)
    expect(chosenLayouts()).toEqual(['Home row'])
  })

  it('ask before replacing keys of the player own, and let go of the piano key that was waiting', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(48))
    tap('KeyZ', { key: 'z' })
    const own = settingsStore.get().bindings

    fireEvent.click(pianoKey(50))
    expect(selectedKeys()).toEqual([50])
    clickWithMouse(layoutCard('White keys only'))
    expect(screen.getByText('Replace your own keys with this layout?')).toBeTruthy()
    expect(settingsStore.get().bindings).toBe(own)

    clickWithMouse(button('No'))
    expect(settingsStore.get().bindings).toBe(own)
    expect(screen.queryByText('Replace your own keys with this layout?')).toBeNull()
    expect(saysCustom()).toBe(true)

    clickWithMouse(layoutCard('White keys only'))
    clickWithMouse(button('Yes'))
    expect(chosenLayouts()).toEqual(['White keys only'])
    expect(selectedKeys()).toEqual([])
    expect(lead()).toBe('Click a piano key below, then press the key you want to use for it.')

    // The next key plays: nothing is waiting for it.
    key('keydown', 'KeyZ')
    expect(heldNotes()).toEqual([48])
    key('keyup', 'KeyZ')
  })

  it('ask too when every key was removed: an empty set of keys is still the player own', () => {
    act(() => settingsStore.set({ bindings: {} }))
    startApp()
    openSettingsOn('Keys')
    expect(saysCustom()).toBe(true)
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(0)

    clickWithMouse(layoutCard('Home row'))
    expect(screen.getByText('Replace your own keys with this layout?')).toBeTruthy()
    clickWithMouse(button('Yes'))
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
  })
})

describe('the keyboard type', () => {
  it('changes the letters on the piano and in the messages, never which key plays which note', () => {
    startApp()
    openSettingsOn('Keys')

    clickWithMouse(button('AZERTY'))
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(keycap(60)).toBe('Q')
    expect(keycap(76)).toBe('M')
    expect(keycap(77)).toBe('Ù')
    expect(pianoKey(60).getAttribute('aria-label')).toBe('C4, key Q')

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')

    fireEvent.click(pianoKey(48))
    tap('KeyQ', { key: 'a' })
    expect(message()).toBe('"A" now plays C3.')
    expect(keycap(48)).toBe('A')

    clickWithMouse(button('QWERTY'))
    expect(keycap(48)).toBe('Q')
    expect(keycap(60)).toBe('A')
  })

  it('"Auto" uses the letter the key typed when the player chose it, where the browser knows no better', () => {
    startApp()
    openSettingsOn('Keys')
    // A French keyboard in a browser that cannot say what is printed on the keys.
    fireEvent.click(pianoKey(48))
    tap('KeyQ', { key: 'a' })

    expect(settingsStore.get().customLabels).toEqual({ KeyQ: 'A' })
    expect(keycap(48)).toBe('A')
    expect(message()).toBe('"A" now plays C3.')
    // The keys nobody pressed keep the letters of a US keyboard.
    expect(keycap(60)).toBe('A')
  })

  it('keeps the list of letters it learned as short as the keys that were chosen', () => {
    startApp()
    openSettingsOn('Keys')
    for (let round = 0; round < 6; round++) {
      fireEvent.click(pianoKey(48 + round))
      tap('KeyQ', { key: round % 2 === 0 ? 'a' : 'q' })
      fireEvent.click(pianoKey(48 + round))
      tap('KeyZ', { key: 'w' })
    }

    // Twelve changes made with two keys: a letter for each of the two at most,
    // however often they were chosen. (Q plays nothing by now; whether its
    // letter is still remembered is up to the app.)
    const learned = settingsStore.get().customLabels
    expect(Object.keys(learned).filter((code) => code !== 'KeyQ' && code !== 'KeyZ')).toEqual([])
    // The key that plays a note has the letter it typed the last time it was chosen.
    expect(settingsStore.get().bindings.KeyZ).toBe(5)
    expect(learned.KeyZ).toBe('W')
    expect(keycap(53)).toBe('W')
  })
})

describe('keys changed in another tab of the browser', () => {
  /** What the browser does in this tab when another tab of the app saves its settings. */
  function saveFromAnotherTab(bindings: Bindings): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settingsStore.get(), bindings }))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })
  }

  const twoOctaves = KEY_PRESETS.find((preset) => preset.id === 'two-octaves')?.bindings ?? {}

  it('show at once, and a held note still stops at its own release', () => {
    startApp()
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    saveFromAnotherTab(twoOctaves)
    expect(keycap(48)).toBe('Z')
    expect(keycap(60)).toBe('Q')

    key('keyup', 'KeyA')
    expect(heldNotes()).toEqual([])
    tap('KeyA')
    expect(nothingLeftSounding()).toBe(true)
    key('keydown', 'KeyQ')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyQ')
  })

  it('are the keys the next change builds on: one key per note still holds', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(60))
    expect(selectedKeys()).toEqual([60])

    saveFromAnotherTab(twoOctaves)
    expect(chosenLayouts()).toEqual(['Two octaves'])
    expect(selectedKeys()).toEqual([60])

    tap('KeyZ', { key: 'z' })
    const bindings = settingsStore.get().bindings
    expect(bindings.KeyZ).toBe(12)
    // Q played C4 in the other tab's layout and Z played C3: both gave way.
    expect(bindings.KeyQ).toBeUndefined()
    expect(message()).toBe('"Z" now plays C4. "Q" no longer plays a note. C3 has no key now.')
    expect(Object.keys(bindings)).toHaveLength(Object.keys(twoOctaves).length - 1)
    expect(new Set(Object.values(bindings)).size).toBe(Object.keys(bindings).length)
    expect(saysCustom()).toBe(true)
  })
})
