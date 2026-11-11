// @vitest-environment jsdom
/**
 * What the app does per event, measured in a simulated browser: how often
 * React draws when a note starts or stops, what it touches on the page, how
 * often the settings are written while a slider moves, and whether listeners
 * pile up when the app is mounted again and again.
 *
 * The numbers asserted here are upper bounds that hold today. They are
 * regression guards: a change that makes every key press redraw twice, or
 * write to localStorage, should fail one of them.
 */
import { Profiler, StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  return { engine, listeners, state }
})

/**
 * How many times the top bar was drawn. Nothing in it changes when a note
 * plays, and the app shell draws it each time it draws itself: a note that
 * makes this number grow has made the whole shell draw again.
 */
const drawn = vi.hoisted(() => ({ topBar: 0 }))

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

vi.mock('./ui/TopBar', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ui/TopBar')>()
  const { createElement } = await import('react')
  type Props = Parameters<typeof original.TopBar>[0]
  return {
    ...original,
    TopBar(props: Props) {
      drawn.topBar += 1
      return createElement(original.TopBar, props)
    },
  }
})

import { App } from './App'
import { bus } from './app/pianoApp'
import { STORAGE_KEY, settingsStore } from './state/settings'
import { installFakeBrowser } from './ui/sky/skyTestKit'
import type { FakeBrowser } from './ui/sky/skyTestKit'
import { closeSong } from './ui/useSongs'

/**
 * jsdom has no canvas: the sky then draws nothing, and follows nothing. Also
 * undoes what the stand-in canvas of the last tests put in its place.
 */
function leaveTheSkyWithoutCanvas(): void {
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
  // The stand-in gave every canvas a size of its own: back to the one every element has (none).
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientHeight')
}

beforeAll(leaveTheSkyWithoutCanvas)

beforeEach(() => {
  window.localStorage.clear()
  act(() => settingsStore.reset())
  bus.allOff()
  audio.state.status = 'idle'
})

afterEach(() => {
  cleanup()
  bus.allOff()
  vi.restoreAllMocks()
})

function key(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init }),
    )
  })
}

/** Draws the app, counts every time React commits a change to the page, and gets past the start overlay. */
function startApp(): { commits: () => number } {
  let commits = 0
  render(
    <Profiler id="app" onRender={() => (commits += 1)}>
      <App />
    </Profiler>,
  )
  key('keydown', 'Enter')
  key('keyup', 'Enter')
  return { commits: () => commits }
}

/** A click with the mouse (`detail: 1` is what a real one carries). */
function click(role: 'button' | 'tab', name: string | RegExp): void {
  fireEvent.click(screen.getByRole(role, { name }), { detail: 1 })
}

describe('React work per note', () => {
  it('draws at most once when a note starts and at most once when it stops', () => {
    const { commits } = startApp()
    const litKeys = (): number => document.querySelectorAll('.piano-key.is-lit').length

    const before = commits()
    key('keydown', 'KeyA')
    expect(litKeys()).toBe(1)
    expect(commits() - before).toBeLessThanOrEqual(1)
    key('keyup', 'KeyA')
    expect(litKeys()).toBe(0)
    expect(commits() - before).toBeLessThanOrEqual(2)
  })

  it('draws only the stage for a note: the app shell, its menu and an open panel are left alone', () => {
    startApp()
    // The counter works: a change of setting makes the shell draw itself, and the top bar with it.
    const atStart = drawn.topBar
    act(() => settingsStore.set({ volume: 0.5 }))
    expect(drawn.topBar).toBeGreaterThan(atStart)
    click('button', 'Settings')

    const before = drawn.topBar
    // The very first note also takes "how to play" off the screen.
    key('keydown', 'KeyA')
    key('keyup', 'KeyA')
    // A chord, by the keyboard, the mouse and a song at once.
    key('keydown', 'KeyS')
    act(() => bus.noteOn(64, 'pointer'))
    act(() => bus.noteOn(67, 'playback'))
    expect(document.querySelectorAll('.piano-key.is-lit')).toHaveLength(3)
    act(() => bus.noteOff(67, 'playback'))
    act(() => bus.noteOff(64, 'pointer'))
    key('keyup', 'KeyS')
    act(() => bus.noteOn(72, 'playback'))
    act(() => bus.allOff())
    expect(document.querySelectorAll('.piano-key.is-lit')).toHaveLength(0)

    expect(drawn.topBar - before).toBe(0)
  })

  it('draws nothing new for the repeats of a held key', () => {
    const { commits } = startApp()
    key('keydown', 'KeyA')

    const before = commits()
    const topBarBefore = drawn.topBar
    for (let repeat = 0; repeat < 50; repeat++) key('keydown', 'KeyA', { repeat: true })
    // React may run the app's own function once more before it sees that
    // nothing changed; it never gets as far as the top bar or the piano.
    expect(commits() - before).toBeLessThanOrEqual(1)
    expect(drawn.topBar - topBarBefore).toBe(0)
  })

  it('draws nothing when a second input joins a note that is already held', () => {
    const { commits } = startApp()
    key('keydown', 'KeyA')

    const before = commits()
    act(() => bus.noteOn(60, 'playback'))
    act(() => bus.noteOff(60, 'playback'))
    expect(commits() - before).toBe(0)
  })

  it('draws nothing new for a key that plays no note', () => {
    const { commits } = startApp()
    const before = commits()
    const topBarBefore = drawn.topBar
    for (let press = 0; press < 20; press++) {
      key('keydown', 'KeyZ')
      key('keyup', 'KeyZ')
    }
    expect(commits() - before).toBeLessThanOrEqual(1)
    expect(drawn.topBar - topBarBefore).toBe(0)
  })

  it('changes one piano key out of 37, and adds or removes nothing but the name of the note above the piano', () => {
    startApp()
    expect(document.querySelectorAll('.piano-key')).toHaveLength(37)
    const records: MutationRecord[] = []
    const observer = new MutationObserver((batch) => {
      records.push(...batch)
    })
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })

    key('keydown', 'KeyA')
    key('keyup', 'KeyA')
    records.push(...observer.takeRecords())
    observer.disconnect()

    const pianoKey = screen.getByRole('button', { name: 'C4, key A' })
    // The strip above the light line: the sound status, the "Transposed" badge and the note names.
    const strip = document.querySelector('.stage__foot')
    expect(strip).not.toBeNull()

    const touchedKeys = new Set<Element>()
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      const pianoKeyTouched = target?.closest('.piano-key')
      if (pianoKeyTouched) touchedKeys.add(pianoKeyTouched)
    }
    expect([...touchedKeys]).toEqual([pianoKey])

    const structural = records.filter((record) => record.type !== 'attributes')
    expect(structural.filter((record) => !strip?.contains(record.target))).toEqual([])

    // In that strip, the list of note names is all that came and went: once on, once off.
    const isNoteNames = (node: Node): boolean =>
      node instanceof Element && node.classList.contains('stage__notes')
    const added = structural.flatMap((record) => [...record.addedNodes])
    const removed = structural.flatMap((record) => [...record.removedNodes])
    expect(added).toHaveLength(1)
    expect(removed).toHaveLength(1)
    expect([...added, ...removed].every(isNoteNames)).toBe(true)
    expect(added[0]?.textContent).toBe('C4')
    expect(document.querySelector('.stage__notes')).toBeNull()
  })
})

describe('settings writes', () => {
  it('writes nothing to localStorage while notes are played', () => {
    startApp()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    for (const code of ['KeyA', 'KeyS', 'KeyD', 'KeyF']) {
      key('keydown', code)
      key('keyup', code)
    }
    expect(setItem).not.toHaveBeenCalled()
  })

  it('writes at most once per step of a dragged slider, and nothing when the value stays put', () => {
    startApp()
    const slider = screen.getByRole('slider', { name: 'Volume' })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    // 80% → 20%, one step at a time, as a slow drag does.
    for (let percent = 79; percent >= 20; percent--) {
      fireEvent.change(slider, { target: { value: String(percent) } })
    }
    expect(setItem.mock.calls.length).toBeLessThanOrEqual(60)
    expect(settingsStore.get().volume).toBe(0.2)

    // The pointer rests: the browser keeps reporting the same value.
    const writes = setItem.mock.calls.length
    for (let again = 0; again < 20; again++) {
      fireEvent.change(slider, { target: { value: '20' } })
    }
    expect(setItem.mock.calls.length).toBe(writes)

    // Whatever was written last is the full, current state.
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    expect(saved).toEqual(settingsStore.get())
  })

  it('saves a small text, also after every key of the piano was given a computer key', () => {
    startApp()
    const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => `Key${letter}`)
    const digits = [...'0123456789'].map((digit) => `Digit${digit}`)
    const codes = [...letters, ...digits, 'Minus']
    expect(codes).toHaveLength(37)

    act(() =>
      settingsStore.set({
        bindings: Object.fromEntries(codes.map((code, slot) => [code, slot])),
        // The longest label the settings accept, for every key.
        customLabels: Object.fromEntries(codes.map((code) => [code, 'WWWWWW'])),
      }),
    )

    expect(document.querySelectorAll('.piano-key__cap')).toHaveLength(37)
    const text = window.localStorage.getItem(STORAGE_KEY) ?? ''
    expect(text.length).toBeGreaterThan(0)
    expect(text.length).toBeLessThan(2048)
  })
})

describe('listeners', () => {
  /*
   * Here the sky draws for real, on a stand-in canvas with a stand-in frame
   * clock and resize observer: it then follows the bus, the window and the
   * size of its box, like everything else that is counted below.
   */
  let browser: FakeBrowser

  beforeEach(() => {
    browser = installFakeBrowser()
  })

  afterEach(() => {
    cleanup()
    // A test that stopped half-way must not leave its song playing into the next one.
    closeSong()
    vi.unstubAllGlobals()
    leaveTheSkyWithoutCanvas()
  })

  /** Counts add/remove calls on a target and tells how many listeners are still attached. */
  function track(target: EventTarget): () => number {
    let attached = 0
    const add = target.addEventListener.bind(target)
    const remove = target.removeEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation((...args: Parameters<typeof add>) => {
      attached += 1
      add(...args)
    })
    vi.spyOn(target, 'removeEventListener').mockImplementation(
      (...args: Parameters<typeof remove>) => {
        attached -= 1
        remove(...args)
      },
    )
    return () => attached
  }

  /**
   * Counts the consumers that subscribe to the bus from now on and tells how
   * many of them have not unsubscribed again.
   */
  function trackBus(): () => number {
    let subscribed = 0
    const subscribe = bus.subscribe.bind(bus)
    vi.spyOn(bus, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = subscribe(listener)
      let counted = true
      subscribed += 1
      return () => {
        if (counted) subscribed -= 1
        counted = false
        unsubscribe()
      }
    })
    return () => subscribed
  }

  it('are all removed again when the app goes away, however often it is mounted', () => {
    // React itself puts a listener on the document the first time it draws
    // anything, and keeps it for good. Drawing something else first leaves
    // only the app's own listeners to be counted, from its very first mount.
    render(<p>Not the app</p>)
    cleanup()

    const onWindow = track(window)
    const onDocument = track(document)
    const onBus = trackBus()
    const engineBefore = audio.listeners.size

    for (let round = 0; round < 10; round++) {
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      )
      key('keydown', 'Enter')
      key('keyup', 'Enter')
      key('keydown', 'KeyA')
      // Both panels, one after the other, then the Keys tab, where the computer keys are chosen.
      click('button', 'Songs')
      click('button', 'Settings')
      click('tab', 'Keys')
      expect(document.querySelector('.piano--editing')).not.toBeNull()
      // A note is being held, and its light is rising, when the app goes away.
      key('keydown', 'KeyS')
      expect([...bus.getActiveNotes()]).toEqual([62])
      expect(browser.frames.pending.size).toBeGreaterThan(0)
      cleanup()
    }

    expect(onWindow()).toBe(0)
    expect(onDocument()).toBe(0)
    expect(onBus()).toBe(0)
    expect(audio.listeners.size).toBe(engineBefore)
    expect([...bus.getActiveNotes()]).toEqual([])
    // Nothing of the sky is left either: no resize observer, no listener, no frame waiting.
    expect(browser.observers()).toBe(0)
    expect(browser.motionListeners()).toBe(0)
    expect(browser.frames.pending.size).toBe(0)
  })

  it('do not grow while the app is used', () => {
    // Counted from before the app is drawn, so that every consumer that
    // unsubscribes later is one whose subscription was counted too.
    const onBus = trackBus()
    render(<App />)
    key('keydown', 'Enter')
    key('keyup', 'Enter')
    const onWindow = track(window)
    const onDocument = track(document)
    const busBefore = onBus()
    const observersBefore = browser.observers()
    const motionListenersBefore = browser.motionListeners()
    expect(busBefore).toBeGreaterThan(0)
    expect(observersBefore).toBeGreaterThan(0)

    for (let round = 0; round < 5; round++) {
      key('keydown', 'KeyA')
      key('keyup', 'KeyA')
      // Settings, on the tab where the computer keys are chosen and moved, and closed again.
      click('button', 'Settings')
      click('tab', 'Keys')
      expect(document.querySelector('.piano--editing')).not.toBeNull()
      click('button', /Higher/)
      click('button', /Lower/)
      click('button', 'Close Settings')
      expect(document.querySelector('.piano--editing')).toBeNull()
      // The other panel, and closed again.
      click('button', 'Songs')
      click('button', 'Close Songs')
      // A song: played from the Songs panel, its options opened, and closed.
      click('button', 'Songs')
      click('button', /^Play Twinkle/)
      expect(screen.getByRole('region', { name: 'Song player' })).toBeTruthy()
      click('button', /^Song options/)
      click('button', 'Close')
      expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()
      act(() => settingsStore.set({ showTrails: round % 2 === 0 }))
    }

    expect(onWindow()).toBe(0)
    expect(onDocument()).toBe(0)
    expect(onBus()).toBe(busBefore)
    expect(browser.observers()).toBe(observersBefore)
    expect(browser.motionListeners()).toBe(motionListenersBefore)
  })
})
