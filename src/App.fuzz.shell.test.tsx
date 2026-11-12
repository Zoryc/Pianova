// @vitest-environment jsdom
/**
 * The whole app under a long, shuffled run of what a player can do to its
 * shell: keys down and up, clicks on the menu, the panels, their tabs, the
 * sky and the piano, the mouse moving and standing still, the window being
 * resized, a song loaded, paused and closed, settings changing under it all.
 *
 * After every step a few plain truths must hold, whatever came before:
 * one panel at most, keys are being chosen exactly while Settings shows its
 * Keys tab, the menu is on screen whenever something pins it, the cursor is
 * hidden exactly while the menu is, the stage says "Sustain on" exactly while
 * sustain is on, and no note sounds that nobody is holding. And every press
 * of Escape takes back one thing, the first there is in its fixed order.
 *
 * A second set of runs is about Escape alone, which the first set seldom
 * meets with much open: a piano key that waits, the song options, a panel,
 * the focus here and there, and the key pressed, held down and let go.
 *
 * The shuffling is seeded, so a failure can be run again.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { player } from './app/songsApp'
import { settingsStore } from './state/settings'
import { resetSongs } from './ui/songsTestKit'
import { playSong } from './ui/useSongs'

const A_STARTER_SONG = 'starter:twinkle-twinkle-little-star'
const SETTINGS_TABS = ['Sound', 'Keys', 'Piano', 'Look', 'About'] as const
/** A run takes about a second by itself, and several times that when many test files run side by side. */
const RUN_TIMEOUT_MS = 20_000
/** Keys that play a note, one that plays none, and the keys the shell itself listens to. */
const CODES = ['KeyA', 'KeyS', 'KeyK', 'Quote', 'KeyM', 'Space', 'Escape', 'Enter', 'Tab'] as const

/** A small seeded generator of numbers from 0 up to (not including) 1. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** How wide the stage is on the test's make-believe screen. */
let stageWidth = 1366
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

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  stageWidth = 1366
  resizeListeners = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const measured = this.classList.contains('stage') || this.classList.contains('piano')
    const width = measured ? stageWidth : 0
    const height = this.classList.contains('piano') ? 100 : 0
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height } as DOMRect
  })
  vi.useFakeTimers()
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

function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

function menu(): HTMLElement {
  return document.querySelector('.menu') as HTMLElement
}

function sky(): HTMLElement {
  return document.querySelector('.stage__sky') as HTMLElement
}

function piano(): HTMLElement {
  return document.querySelector('.piano') as HTMLElement
}

/*
 * The page is looked up by class here, not by role: a run asks thousands of
 * times, and finding by role works out the role of every element each time.
 * That the classes carry the right roles and names is tested elsewhere.
 */

function dialog(name: 'Settings' | 'Songs'): HTMLElement | null {
  const open = [...document.querySelectorAll<HTMLElement>('.floating-panel')]
  return open.find((panel) => panel.querySelector('.floating-panel__title')?.textContent === name) ?? null
}

function menuButton(name: string): HTMLElement {
  const found = [...menu().querySelectorAll<HTMLElement>('button')].find(
    (button) => button.textContent === name,
  )
  if (!found) throw new Error(`The menu has no "${name}" button.`)
  return found
}

function settingsTab(name: string): HTMLElement | null {
  const tabs = [...document.querySelectorAll<HTMLElement>('.floating-panel .tab')]
  return tabs.find((tab) => tab.textContent === name) ?? null
}

function closeSongButton(): HTMLElement | null {
  const buttons = [...document.querySelectorAll<HTMLElement>('.player-line button')]
  return buttons.find((button) => button.textContent === 'Close') ?? null
}

function songOptionsButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.player-line button[aria-expanded]')
}

function songOptions(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.song-options')
}

/** What a press of Escape can take back, listed in the order in which it does. */
interface Open {
  waitingPianoKey: boolean
  songOptions: boolean
  panel: boolean
  focusInMenu: boolean
  /** Not taken back by itself: the focus is on a control inside the open panel (not on the panel). */
  focusInPanel: boolean
}

function whatIsOpen(): Open {
  const panel = document.querySelector('.floating-panel')
  const focused = document.activeElement
  return {
    waitingPianoKey: piano().querySelector('.is-selected') !== null,
    songOptions: songOptions() !== null,
    panel: panel !== null,
    focusInMenu: menu().contains(focused),
    focusInPanel: panel !== null && panel !== focused && panel.contains(focused),
  }
}

/** The same after one press of Escape: the first of them is gone, the others are as they were. */
function afterEscape(before: Open): Open {
  if (before.waitingPianoKey) return { ...before, waitingPianoKey: false }
  if (before.songOptions) return { ...before, songOptions: false }
  // A control of the panel that had the focus goes away with it: the focus is
  // then on the button that opens the panel, which is in the menu.
  if (before.panel) {
    const focusInMenu = before.focusInMenu || before.focusInPanel
    return { ...before, panel: false, focusInPanel: false, focusInMenu }
  }
  return { ...before, focusInMenu: false }
}

/** True when there is something for a press of Escape to take back. */
function somethingIsOpen(open: Open): boolean {
  return open.waitingPianoKey || open.songOptions || open.panel || open.focusInMenu
}

describe('the shell, through 20 shuffled runs of 140 steps', () => {
  const runs = Array.from({ length: 20 }, (_, run) => run + 1)
  it.each(runs)('run %i', { timeout: RUN_TIMEOUT_MS }, (seed) => {
    const random = seeded(seed * 104729)
    const pick = <Item,>(items: readonly Item[]): Item =>
      items[Math.floor(random() * items.length)] as Item
    const problems = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(<App />)
    key('keydown', 'Enter')
    key('keyup', 'Enter')

    /** The computer keys that are physically down, and whether the mouse button is down on the piano. */
    const keysDown = new Set<string>()
    let mouseDownOnPiano = false
    let mouseX = 0

    function step(): string {
      const dice = random()
      if (dice < 0.2) {
        const code = pick(CODES)
        if (keysDown.has(code)) return 'nothing'
        keysDown.add(code)
        const open = whatIsOpen()
        key('keydown', code, { key: code === 'KeyM' ? 'm' : code })
        if (code === 'Escape') {
          const told = `Escape, after: ${story.slice(-12).join(' / ')}`
          expect(whatIsOpen(), told).toEqual(afterEscape(open))
        }
        // What Tab leaves focused in the menu is let go again, as by a click elsewhere.
        if (code === 'Tab' && random() < 0.5) act(() => (document.activeElement as HTMLElement).blur())
        return `down ${code}`
      }
      if (dice < 0.38) {
        const code = pick([...keysDown])
        if (code === undefined) return 'nothing'
        keysDown.delete(code)
        key('keyup', code)
        return `up ${code}`
      }
      if (dice < 0.46) {
        const name = pick(['Settings', 'Songs'] as const)
        clickWithMouse(menuButton(name))
        return `click ${name}`
      }
      if (dice < 0.54) {
        const tab = settingsTab(pick(SETTINGS_TABS))
        if (!tab) return 'nothing'
        clickWithMouse(tab)
        return `tab ${tab.textContent}`
      }
      if (dice < 0.58) {
        clickWithMouse(sky())
        return 'click sky'
      }
      if (dice < 0.66) {
        // The mouse on a white key of the piano: pressed, or let go again.
        const point = { pointerId: 1, clientX: stageWidth * (0.2 + random() * 0.6), clientY: 90 }
        if (mouseDownOnPiano) {
          fireEvent.pointerUp(piano(), { button: 0, ...point })
          // The piano box had caught the mouse: the click that follows is told to the box.
          fireEvent.click(piano(), { detail: 1 })
        } else {
          fireEvent.pointerDown(piano(), { button: 0, ...point })
        }
        mouseDownOnPiano = !mouseDownOnPiano
        return mouseDownOnPiano ? 'mouse down on the piano' : 'mouse up'
      }
      if (dice < 0.7) {
        // A click on one key of the keyboard zone: plays it, or selects it while keys are chosen.
        if (mouseDownOnPiano) return 'nothing'
        const pianoKey = piano().querySelector(`.piano-key[data-slot="${Math.floor(random() * 37)}"]`)
        if (pianoKey) fireEvent.click(pianoKey, { detail: 1 })
        return 'click a piano key'
      }
      if (dice < 0.76) {
        mouseX += 5
        fireEvent.mouseMove(sky(), { screenX: mouseX, screenY: 200 })
        return 'mouse moves'
      }
      if (dice < 0.84) {
        const time = pick([10, 400, 2499, 2500, 2600])
        act(() => {
          vi.advanceTimersByTime(time)
        })
        return `wait ${time}`
      }
      if (dice < 0.88) {
        stageWidth = pick([700, 800, 1000, 1366])
        act(() => {
          for (const listener of resizeListeners) listener()
        })
        return `resize ${stageWidth}`
      }
      if (dice < 0.93) {
        const what = pick(['play', 'pause', 'resume', 'close', 'end', 'options'] as const)
        act(() => {
          if (what === 'play') playSong(A_STARTER_SONG)
          if (what === 'pause') player.pause()
          if (what === 'resume') player.play()
          if (what === 'end') player.seek(player.getState().duration)
        })
        const close = closeSongButton()
        if (what === 'close' && close) clickWithMouse(close)
        // The song options: opened, or closed again, from their button in the player line.
        const options = songOptionsButton()
        if (what === 'options' && options) clickWithMouse(options)
        // A song that was just loaded starts with its options closed.
        if (what === 'play') expect(songOptions(), 'the options of a song that was just loaded').toBeNull()
        return `song ${what}`
      }
      if (dice < 0.97) {
        const { baseOctave, autoHideMenu } = settingsStore.get()
        const change = pick([
          { autoHideMenu: !autoHideMenu },
          { pianoSize: pick(['auto', 88, 61, 49, 37] as const) },
          { baseOctave: Math.min(5, Math.max(1, baseOctave + pick([-1, 1]))) },
          { sustain: random() < 0.5 },
        ])
        act(() => settingsStore.set(change))
        return `set ${JSON.stringify(change)}`
      }
      act(() => {
        window.dispatchEvent(new Event('blur'))
      })
      keysDown.clear()
      mouseDownOnPiano = false
      return 'another window comes in front'
    }

    const story: string[] = []
    for (let count = 0; count < 140; count++) {
      story.push(step())
      const told = `after: ${story.slice(-12).join(' / ')}`

      const settings = dialog('Settings')
      const songs = dialog('Songs')
      expect(document.querySelectorAll('[role="dialog"]').length, told).toBeLessThanOrEqual(1)
      expect(menuButton('Settings').getAttribute('aria-expanded'), told).toBe(String(settings !== null))
      expect(menuButton('Songs').getAttribute('aria-expanded'), told).toBe(String(songs !== null))

      const onKeysTab = settingsTab('Keys')?.getAttribute('aria-selected') === 'true'
      expect(piano().classList.contains('piano--editing'), told).toBe(onKeysTab)
      if (!onKeysTab) expect(piano().querySelector('.is-selected'), told).toBeNull()

      const hidden = menu().classList.contains('menu--hidden')
      const state = player.getState().status
      const pinned =
        settings !== null ||
        songs !== null ||
        state === 'paused' ||
        state === 'stopped' ||
        !settingsStore.get().autoHideMenu
      if (pinned) expect(hidden, told).toBe(false)
      expect(document.querySelector('.app')?.classList.contains('cursor-hidden'), told).toBe(hidden)
      expect(document.querySelector('.player-line') !== null, told).toBe(state !== 'empty')
      expect(songOptionsButton()?.getAttribute('aria-expanded') === 'true', told).toBe(
        songOptions() !== null,
      )

      // Sustain can be switched with Space while the menu is hidden: the stage says when it is on.
      const badges = [...document.querySelectorAll('.stage__badge')].map((badge) => badge.textContent)
      expect(badges.includes('Sustain on'), told).toBe(settingsStore.get().sustain)

      // Nobody holds anything and no song is playing: nothing may sound, and no key may be lit.
      if (keysDown.size === 0 && !mouseDownOnPiano && state !== 'playing') {
        expect([...bus.getActiveNotes()], told).toEqual([])
        expect(piano().querySelector('.is-lit'), told).toBeNull()
      }
      // The keys lit on the piano are the notes that sound, as far as the piano shows them.
      const lit = [...piano().querySelectorAll<HTMLElement>('.is-lit')].map((lit) => Number(lit.dataset.midi))
      const sounding = [...bus.getActiveNotes()].filter(
        (midi) => piano().querySelector(`.piano-key[data-midi="${midi}"]`) !== null,
      )
      expect(lit.sort((a, b) => a - b), told).toEqual(sounding.sort((a, b) => a - b))
    }

    // Everything is let go and the song is closed: silence.
    for (const code of keysDown) key('keyup', code)
    if (mouseDownOnPiano) fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 5, clientY: 90 })
    const close = closeSongButton()
    if (close) clickWithMouse(close)
    expect([...bus.getActiveNotes()]).toEqual([])
    expect(problems).not.toHaveBeenCalled()
  })
})

describe('Escape, through 16 shuffled runs of 120 steps', () => {
  const runs = Array.from({ length: 16 }, (_, run) => run + 1)
  it.each(runs)('run %i', { timeout: RUN_TIMEOUT_MS }, (seed) => {
    const random = seeded(seed * 15485863)
    const pick = <Item,>(items: readonly Item[]): Item =>
      items[Math.floor(random() * items.length)] as Item
    const problems = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(<App />)
    key('keydown', 'Enter')
    key('keyup', 'Enter')

    let escapeIsDown = false
    const story: string[] = []

    function focus(control: HTMLElement | null): string {
      if (!control) return 'nothing'
      act(() => control.focus())
      return `focus on "${control.textContent}"`
    }

    function step(): string {
      const dice = random()
      if (dice < 0.14) {
        // Settings on its Keys tab, where a click on a piano key makes it wait for a computer key.
        if (!dialog('Settings')) clickWithMouse(menuButton('Settings'))
        const keys = settingsTab('Keys')
        if (keys) clickWithMouse(keys)
        return 'Settings on Keys'
      }
      if (dice < 0.2) {
        const name = pick(['Settings', 'Songs'] as const)
        // With the mouse, or with Enter: the focus then goes into the panel that opens.
        const button = menuButton(name)
        if (random() < 0.5) clickWithMouse(button)
        else {
          button.focus()
          fireEvent.click(button, { detail: 0 })
        }
        return `press ${name}`
      }
      if (dice < 0.34) {
        const pianoKey = piano().querySelector(`.piano-key[data-slot="${Math.floor(random() * 37)}"]`)
        if (pianoKey) fireEvent.click(pianoKey, { detail: 1 })
        return 'click a piano key'
      }
      if (dice < 0.46) {
        const options = songOptionsButton()
        if (!options) return 'nothing'
        if (random() < 0.5) clickWithMouse(options)
        else {
          options.focus()
          fireEvent.click(options, { detail: 0 })
        }
        return 'press Song options'
      }
      if (dice < 0.56) {
        // The focus goes where Tab can take it: into the panel, the song options or the top bar.
        const where = pick(['.floating-panel button', '.song-options button', '.top-bar button'])
        return focus(document.querySelector<HTMLElement>(where))
      }
      if (dice < 0.64) {
        if (random() < 0.6) {
          act(() => {
            playSong(A_STARTER_SONG)
          })
          return 'play a song'
        }
        const close = closeSongButton()
        if (close) clickWithMouse(close)
        return 'close the song'
      }
      if (dice < 0.68) {
        clickWithMouse(sky())
        return 'click sky'
      }

      // Escape: pressed, then held down (it repeats) or let go.
      if (!escapeIsDown) {
        const open = whatIsOpen()
        const press = key('keydown', 'Escape')
        escapeIsDown = true
        const told = `Escape, after: ${story.slice(-12).join(' / ')}`
        expect(whatIsOpen(), told).toEqual(afterEscape(open))
        // It is kept from the browser exactly when there was something to take back.
        expect(press.defaultPrevented, told).toBe(somethingIsOpen(open))
        return 'Escape down'
      }
      if (random() < 0.5) {
        const open = whatIsOpen()
        const focused = document.activeElement
        key('keydown', 'Escape', { repeat: true })
        const told = `Escape held, after: ${story.slice(-12).join(' / ')}`
        expect(whatIsOpen(), told).toEqual(open)
        expect(document.activeElement, told).toBe(focused)
        return 'Escape repeats'
      }
      key('keyup', 'Escape')
      escapeIsDown = false
      return 'Escape up'
    }

    for (let count = 0; count < 120; count++) {
      story.push(step())
      const told = `after: ${story.slice(-12).join(' / ')}`
      expect(document.querySelectorAll('[role="dialog"]').length, told).toBeLessThanOrEqual(1)
      expect(songOptions() === null || document.querySelector('.player-line') !== null, told).toBe(true)
      // Escape never plays a note, and never leaves keys being chosen behind a closed panel.
      expect([...bus.getActiveNotes()], told).toEqual([])
      expect(piano().classList.contains('piano--editing'), told).toBe(
        settingsTab('Keys')?.getAttribute('aria-selected') === 'true',
      )
    }
    expect(problems).not.toHaveBeenCalled()
  })
})
