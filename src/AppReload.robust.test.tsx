// @vitest-environment jsdom
/**
 * What survives from one visit to the next, with the whole app.
 *
 * Each "visit" loads a fresh copy of every module (as a page load does) over
 * the same window.localStorage, uses the app the way a player would, and goes
 * away. The next visit must show, and hand to the sound engine, exactly what
 * the previous one left behind (spec section 1, point 7), also when the saved
 * data is damaged or the browser refuses to store anything (section 7).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  /** Every call a visit made to the engine, e.g. 'volume:0.5'. */
  const calls: string[] = []
  const state = { status: 'idle' }
  const engine = {
    start(): Promise<void> {
      calls.push('start')
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
    noteOn(midi: number, velocity: number): void {
      calls.push(`on:${midi} at ${velocity}`)
    },
    noteOff(): void {},
    setSustain(on: boolean): void {
      calls.push(`sustain:${on}`)
    },
    setVolume(volume: number): void {
      calls.push(`volume:${volume}`)
    },
    setTranspose(semitones: number): void {
      calls.push(`transpose:${semitones}`)
    },
    setReverb(amount: number): void {
      calls.push(`reverb:${amount}`)
    },
    setRelease(seconds: number): void {
      calls.push(`release:${seconds}`)
    },
    allNotesOff(): void {},
    dispose(): void {},
  }
  return {
    engine,
    calls,
    reset(): void {
      calls.length = 0
      state.status = 'idle'
      listeners.clear()
    },
  }
})

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

const STORAGE_KEY = 'pianoapp.settings.v1'

type TestingLibrary = typeof import('@testing-library/react')

/** The tabs of the Settings panel. */
type SettingsTab = 'Sound' | 'Keys' | 'Piano' | 'Look' | 'About'

/** One page load: fresh modules, the app drawn, and the tools to use it. */
interface Visit {
  screen: TestingLibrary['screen']
  fireEvent: TestingLibrary['fireEvent']
  within: TestingLibrary['within']
  key(type: 'keydown' | 'keyup', code: string, init?: KeyboardEventInit): void
  tap(code: string, init?: KeyboardEventInit): void
  /** A click with the mouse on the button of that name. */
  click(name: string | RegExp): void
  /** Opens Settings, if it is not open, and shows one of its tabs. */
  showSettingsTab(tab: SettingsTab): void
  /** The Settings panel, which must be open. */
  settingsPanel(): HTMLElement
  settings(): import('./state/settings').Settings
  /** Closes the page. */
  leave(): void
}

let openVisits: Visit[] = []

async function visit(): Promise<Visit> {
  vi.resetModules()
  audio.reset()
  // Loaded after the reset, so the app and the test tools share one copy of React.
  const { createElement } = await import('react')
  const library = await import('@testing-library/react')
  const { App } = await import('./App')
  const { settingsStore } = await import('./state/settings')
  const { act, cleanup, fireEvent, render, screen, within } = library

  render(createElement(App))

  const key: Visit['key'] = (type, code, init = {}) => {
    act(() => {
      ;(document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init }),
      )
    })
  }
  const page: Visit = {
    screen,
    fireEvent,
    within,
    key,
    tap(code, init) {
      key('keydown', code, init)
      key('keyup', code, init)
    },
    click(name) {
      fireEvent.click(screen.getByRole('button', { name }), { detail: 1 })
    },
    showSettingsTab(tab) {
      if (!screen.queryByRole('dialog', { name: 'Settings' })) page.click('Settings')
      fireEvent.click(screen.getByRole('tab', { name: tab }), { detail: 1 })
    },
    settingsPanel: () => screen.getByRole('dialog', { name: 'Settings' }),
    settings: () => settingsStore.get(),
    leave() {
      act(() => {
        window.dispatchEvent(new Event('pagehide'))
      })
      cleanup()
      openVisits = openVisits.filter((open) => open !== page)
    },
  }
  openVisits.push(page)
  return page
}

function savedText(): string | null {
  return window.localStorage.getItem(STORAGE_KEY)
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
})

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  for (const open of [...openVisits]) open.leave()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('from one visit to the next', () => {
  it('nothing is written by a visit in which nothing was changed', async () => {
    const page = await visit()
    page.tap('Enter')
    page.tap('KeyA')
    page.leave()
    expect(savedText()).toBeNull()
  })

  it('everything the player changed is back, on screen and in the sound', async () => {
    const first = await visit()
    first.tap('Enter') // gets past the start overlay
    first.fireEvent.change(first.screen.getByRole('slider', { name: 'Volume' }), {
      target: { value: '50' },
    })
    first.tap('Space') // sustain on

    // Settings, tab by tab.
    first.showSettingsTab('Sound')
    first.click('Transpose up')
    first.click('Transpose up')
    first.click('Long')
    first.fireEvent.change(first.screen.getByRole('slider', { name: 'Room echo' }), {
      target: { value: '40' },
    })
    first.fireEvent.change(first.screen.getByRole('slider', { name: 'Touch' }), {
      target: { value: '30' },
    })

    first.showSettingsTab('Piano')
    first.fireEvent.change(first.screen.getByRole('combobox', { name: 'Labels on the keys' }), {
      target: { value: 'keys' },
    })
    first.click('Do Ré Mi')
    first.click('61')
    first.click('Glass')

    first.showSettingsTab('Look')
    first.fireEvent.click(first.screen.getByRole('radio', { name: 'Blue' }), { detail: 1 })
    first.fireEvent.click(first.screen.getByRole('switch', { name: 'Light bars' }), { detail: 1 })

    // The Keys tab: the computer keys move one octave higher, and the lowest
    // piano key they can play gets the Z key.
    first.showSettingsTab('Keys')
    first.click(/Higher/)
    first.fireEvent.click(first.screen.getByRole('button', { name: 'Do4' }), { detail: 1 })
    first.tap('KeyZ', { key: 'z' })
    first.click('Close Settings')
    const left = first.settings()
    first.leave()

    const second = await visit()
    expect(second.settings()).toEqual(left)
    expect(second.settings()).toMatchObject({
      volume: 0.5,
      sustain: true,
      baseOctave: 4,
      labelMode: 'keys',
      transpose: 2,
      noteNaming: 'solfege',
      release: 'long',
      reverb: 0.4,
      velocity: 0.3,
      pianoSize: 61,
      keyStyle: 'glass',
      accent: 'blue',
      showTrails: false,
    })
    expect(second.settings().bindings.KeyZ).toBe(0)

    // The sound engine was given the saved values before the first note.
    expect(audio.calls).toEqual(
      expect.arrayContaining(['volume:0.5', 'sustain:true', 'transpose:2', 'reverb:0.4', 'release:2.5']),
    )
    expect(audio.calls).not.toContain('start')

    // And the screen shows them: the menu, the stage and the piano first.
    second.tap('Enter')
    const { screen } = second
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveProperty('value', '50')
    expect(screen.getByRole('switch', { name: 'Sustain' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Transposed +2')).toBeTruthy()
    expect(screen.getByText('Sustain on')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Do4, key Z' })).toBeTruthy()
    const piano = screen.getByRole('group', { name: 'Piano' })
    expect(piano.querySelectorAll('.piano-key')).toHaveLength(61)
    expect(piano.querySelectorAll('.piano-key__note')).toHaveLength(0)
    expect(piano.getAttribute('data-key-style')).toBe('glass')
    const light = document.querySelector<HTMLElement>('.app')?.style.getPropertyValue('--light')
    expect(light).toBe('#2f8bff')
    // Closed again: an open panel is not something the app remembers.
    expect(screen.queryByRole('dialog')).toBeNull()

    // Then Settings, which opens on its first tab: the tab last used is not remembered either.
    second.click('Settings')
    const inSettings = second.within(second.settingsPanel())
    const isChosen = (name: string): string | null =>
      inSettings.getByRole('button', { name }).getAttribute('aria-pressed')
    const isOn = (name: string): string | null =>
      inSettings.getByRole('switch', { name }).getAttribute('aria-checked')
    const firstTab = inSettings.getByRole('tab', { name: 'Sound' })
    expect(firstTab.getAttribute('aria-selected')).toBe('true')
    expect(inSettings.getByRole('slider', { name: 'Volume' })).toHaveProperty('value', '50')
    expect(isOn('Sustain')).toBe('true')
    expect(inSettings.getByRole('slider', { name: 'Touch' })).toHaveProperty('value', '30')
    expect(inSettings.getByRole('slider', { name: 'Room echo' })).toHaveProperty('value', '40')
    expect(isChosen('Long')).toBe('true')
    expect(inSettings.getByText('+2')).toBeTruthy()

    second.showSettingsTab('Keys')
    expect(inSettings.getByText('Do4 – Do7')).toBeTruthy()

    second.showSettingsTab('Piano')
    expect(inSettings.getByRole('combobox', { name: 'Labels on the keys' })).toHaveProperty(
      'value',
      'keys',
    )
    expect(isChosen('Do Ré Mi')).toBe('true')
    expect(isChosen('61')).toBe('true')
    expect(isChosen('Glass')).toBe('true')

    second.showSettingsTab('Look')
    const blue = inSettings.getByRole('radio', { name: 'Blue' })
    expect(blue.getAttribute('aria-checked')).toBe('true')
    expect(isOn('Light bars')).toBe('false')
    second.click('Close Settings')

    // The key the player chose plays, as hard as the saved Touch says.
    second.tap('KeyZ', { key: 'z' })
    expect(audio.calls).toContain('on:60 at 0.3')
  })

  it('keys put back to the default stay at the default', async () => {
    const first = await visit()
    first.tap('Enter')
    first.showSettingsTab('Keys')
    first.fireEvent.click(first.screen.getByRole('button', { name: 'C3' }), { detail: 1 })
    first.tap('KeyZ', { key: 'z' })
    expect(first.settings().bindings.KeyZ).toBe(0)
    expect(first.settings().customLabels).toEqual({ KeyZ: 'Z' })
    first.click('Reset to default keys')
    first.click('Yes')
    first.leave()

    const second = await visit()
    expect(second.settings().bindings.KeyZ).toBeUndefined()
    expect(second.settings().customLabels).toEqual({})
    expect(second.screen.getByRole('button', { name: 'C3' })).toBeTruthy()
    expect(second.screen.getByRole('button', { name: 'C4, key A' })).toBeTruthy()
  })
})

describe('a visit that finds damaged or hostile saved data', () => {
  const cases: readonly [name: string, saved: string][] = [
    ['text that is not JSON', '{"volume":0.5,'],
    ['JSON of the wrong kind', '[1,2,3]'],
    ['null', 'null'],
    ['an empty text', ''],
    [
      'fields of the wrong types',
      '{"bindings":[1,2],"customLabels":"x","baseOctave":"3","volume":null,"sustain":"yes","labelMode":7}',
    ],
    [
      'markup and oversized labels',
      '{"bindings":{"KeyQ":0,"KeyA":"x"},"customLabels":{"KeyQ":"<img>","KeyA":"<script>takeOver()</script>"}}',
    ],
    ['numbers out of range', '{"baseOctave":99,"volume":-5,"transpose":1e999,"velocity":0}'],
    ['names found on every object', '{"__proto__":{"volume":0},"constructor":1,"bindings":{"toString":3}}'],
  ]

  it.each(cases)('draws the whole app and plays: %s', async (_name, saved) => {
    window.localStorage.setItem(STORAGE_KEY, saved)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    const page = await visit()
    page.tap('Enter')

    expect(document.querySelectorAll('.piano-key')).toHaveLength(37)
    expect(document.querySelectorAll('.piano script, .piano img')).toHaveLength(0)
    expect(page.screen.getByRole('slider', { name: 'Volume' })).toBeTruthy()
    // Using the app still works, and what it saves next is clean.
    page.tap('Space')
    expect(page.settings().sustain).toBe(true)
    expect(JSON.parse(savedText() ?? 'null')).toEqual(page.settings())
    expect(errors).not.toHaveBeenCalled()
  })
})

describe('a browser that refuses to store anything', () => {
  it('the app still starts, plays and changes settings when every storage call throws', async () => {
    const refuse = (): never => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    const page = await visit()
    page.tap('Enter')
    page.tap('Space')
    page.showSettingsTab('Keys')
    page.click(/Higher/)
    page.fireEvent.click(page.screen.getByRole('button', { name: 'C4' }), { detail: 1 })
    page.tap('KeyZ', { key: 'z' })

    expect(page.settings()).toMatchObject({ sustain: true, baseOctave: 4 })
    expect(page.settings().bindings.KeyZ).toBe(0)
    expect(page.screen.getByRole('button', { name: 'C4, key Z' })).toBeTruthy()
    expect(errors).not.toHaveBeenCalled()
  })

  it('the app still starts when merely touching window.localStorage throws', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError')
      },
    })
    try {
      const page = await visit()
      page.tap('Enter')
      page.tap('Space')
      expect(page.settings().sustain).toBe(true)
      expect(document.querySelectorAll('.piano-key')).toHaveLength(37)
      page.leave()
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real)
    }
  })
})
