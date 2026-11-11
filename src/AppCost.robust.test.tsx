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

/** How many times the toolbar was drawn. It never changes when a note plays. */
const drawn = vi.hoisted(() => ({ toolbar: 0 }))

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

vi.mock('./ui/Toolbar', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ui/Toolbar')>()
  const { createElement } = await import('react')
  type Props = Parameters<typeof original.Toolbar>[0]
  return {
    ...original,
    Toolbar(props: Props) {
      drawn.toolbar += 1
      return createElement(original.Toolbar, props)
    },
  }
})

import { App } from './App'
import { bus } from './app/pianoApp'
import { STORAGE_KEY, settingsStore } from './state/settings'

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
})

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

  it('draws nothing new for the repeats of a held key', () => {
    const { commits } = startApp()
    key('keydown', 'KeyA')

    const before = commits()
    const toolbarBefore = drawn.toolbar
    for (let repeat = 0; repeat < 50; repeat++) key('keydown', 'KeyA', { repeat: true })
    // React may run the app's own function once more before it sees that
    // nothing changed; it never gets as far as the toolbar or the piano.
    expect(commits() - before).toBeLessThanOrEqual(1)
    expect(drawn.toolbar - toolbarBefore).toBe(0)
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
    const toolbarBefore = drawn.toolbar
    for (let press = 0; press < 20; press++) {
      key('keydown', 'KeyZ')
      key('keyup', 'KeyZ')
    }
    expect(commits() - before).toBeLessThanOrEqual(1)
    expect(drawn.toolbar - toolbarBefore).toBe(0)
  })

  it('changes one piano key out of 37, and adds or removes nothing outside the "now playing" line', () => {
    startApp()
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
    const nowPlaying = document.querySelector('.now-playing')
    expect(nowPlaying).not.toBeNull()

    const touchedKeys = new Set<Element>()
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      const pianoKeyTouched = target?.closest('.piano-key')
      if (pianoKeyTouched) touchedKeys.add(pianoKeyTouched)
    }
    expect([...touchedKeys]).toEqual([pianoKey])

    const structural = records.filter(
      (record) => record.type !== 'attributes' && !nowPlaying?.contains(record.target),
    )
    expect(structural).toEqual([])
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
      fireEvent.click(screen.getByRole('button', { name: 'Customize keys' }), { detail: 1 })
      fireEvent.click(screen.getByRole('button', { name: /Advanced/ }), { detail: 1 })
      cleanup()
    }

    expect(onWindow()).toBe(0)
    expect(onDocument()).toBe(0)
    expect(onBus()).toBe(0)
    expect(audio.listeners.size).toBe(engineBefore)
    expect([...bus.getActiveNotes()]).toEqual([])
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

    for (let round = 0; round < 5; round++) {
      key('keydown', 'KeyA')
      key('keyup', 'KeyA')
      fireEvent.click(screen.getByRole('button', { name: /Higher/ }), { detail: 1 })
      fireEvent.click(screen.getByRole('button', { name: /Lower/ }), { detail: 1 })
      fireEvent.click(screen.getByRole('button', { name: 'Customize keys' }), { detail: 1 })
      fireEvent.click(screen.getByRole('button', { name: 'Done' }), { detail: 1 })
      act(() => settingsStore.set({ showTrails: round % 2 === 0 }))
    }

    expect(onWindow()).toBe(0)
    expect(onDocument()).toBe(0)
    expect(onBus()).toBe(busBefore)
  })
})
