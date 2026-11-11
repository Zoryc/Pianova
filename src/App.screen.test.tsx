// @vitest-environment jsdom
/**
 * The whole screen as a player meets it: the real <App /> drawn in a
 * simulated browser and used with real clicks and key presses. Only the sound
 * engine is replaced, by a silent stand-in whose status the tests can set.
 *
 * Covered here: the start overlay, every toolbar control, the Advanced panel,
 * both reset flows, the Transposed badge, the Now playing line, the footer
 * messages, where the keyboard focus goes, keyboard-only use, ARIA and wording.
 */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = {
    status: 'idle' as 'idle' | 'loading' | 'ready' | 'fallback' | 'error',
    /** What start() leads to. */
    startsAs: 'ready' as 'idle' | 'loading' | 'ready' | 'fallback' | 'error',
    starts: 0,
    calls: [] as string[],
  }
  function setStatus(next: typeof state.status): void {
    if (next === state.status) return
    state.status = next
    for (const listener of [...listeners]) listener()
  }
  const engine = {
    start(): Promise<void> {
      state.starts += 1
      setStatus(state.startsAs)
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
      state.calls.push(`on:${midi}:${velocity}`)
    },
    noteOff(midi: number): void {
      state.calls.push(`off:${midi}`)
    },
    setSustain(on: boolean): void {
      state.calls.push(`sustain:${on}`)
    },
    setVolume(volume: number): void {
      state.calls.push(`volume:${volume}`)
    },
    setTranspose(semitones: number): void {
      state.calls.push(`transpose:${semitones}`)
    },
    setReverb(amount: number): void {
      state.calls.push(`reverb:${amount}`)
    },
    setRelease(seconds: number): void {
      state.calls.push(`release:${seconds}`)
    },
    allNotesOff(): void {},
    dispose(): void {},
  }
  return { engine, state, setStatus }
})

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

import { App } from './App'
import { APP_NAME } from './app/appInfo'
import { bus } from './app/pianoApp'
import { DEFAULT_BINDINGS } from './input/keymap'
import { ADVANCED_KEYS, DEFAULT_SETTINGS, STORAGE_KEY, settingsStore } from './state/settings'
import type { Settings } from './state/settings'

type User = ReturnType<typeof userEvent.setup>

const START_TEXT = 'Click or press any key to start'
const HINT_TEXT = 'Press the keys shown on the piano, or click it'

beforeAll(() => {
  // jsdom has no canvas: the light trails simply draw nothing.
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
  // jsdom has no pointer capture: the piano only needs the calls not to throw.
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.hasPointerCapture ??= () => false
})

beforeEach(() => {
  audio.state.status = 'idle'
  audio.state.startsAs = 'ready'
  audio.state.starts = 0
  audio.state.calls.length = 0
  bus.allOff()
  settingsStore.reset()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  bus.allOff()
})

/** Draws the app the way main.tsx does. */
function drawApp(): User {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  return userEvent.setup()
}

/** Draws the app and gets past the start overlay with a click, like most players. */
async function startApp(): Promise<User> {
  const user = drawApp()
  await user.click(screen.getByRole('button', { name: new RegExp(START_TEXT) }))
  return user
}

function setAudioStatus(status: FakeStatus): void {
  act(() => audio.setStatus(status))
}

function saved(): Partial<Settings> {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === null ? {} : (JSON.parse(raw) as Partial<Settings>)
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()].sort((a, b) => a - b)
}

function toolbar(): HTMLElement {
  return screen.getByRole('region', { name: 'Controls' })
}

function advancedButton(): HTMLElement {
  return within(toolbar()).getByRole('button', { name: /^Advanced/ })
}

function advancedPanel(): HTMLElement {
  return screen.getByRole('region', { name: 'Advanced settings' })
}

async function openAdvanced(user: User): Promise<HTMLElement> {
  await user.click(advancedButton())
  return advancedPanel()
}

function customizeButton(): HTMLElement {
  return within(toolbar()).getByRole('button', { name: 'Customize keys' })
}

function keyEditorPanel(): HTMLElement {
  return screen.getByRole('region', { name: 'Customize keys' })
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

/** A piano key by what a screen reader calls it, e.g. "C4, key A". Works in and out of edit mode. */
function pianoKey(label: string): HTMLElement {
  const key = piano().querySelector<HTMLElement>(`.piano-key[aria-label="${label}"]`)
  if (!key) throw new Error(`No piano key is labelled "${label}"`)
  return key
}

function footer(): HTMLElement {
  return screen.getByRole('contentinfo')
}

function nowPlayingLine(): HTMLElement {
  const line = document.querySelector<HTMLElement>('.now-playing')
  if (!line) throw new Error('The Now playing line is missing')
  return line
}

/** The text of an element with single spaces, as it is read. */
function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** True when `first` comes before `second` on the page, as it is read from top to bottom. */
function comesBefore(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

// ---------------------------------------------------------------------------

describe('start overlay', () => {
  it('covers the screen until the first click, and the click starts the sound once', async () => {
    const user = drawApp()
    const overlay = screen.getByRole('button', { name: new RegExp(START_TEXT) })
    expect(overlay.textContent).toContain(APP_NAME)
    expect(document.querySelector('.app')?.hasAttribute('inert')).toBe(true)
    expect(audio.state.starts).toBe(0)

    await user.click(overlay)

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.querySelector('.app')?.hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
    // The overlay is gone, so nothing is left holding the keyboard.
    expect(document.activeElement).toBe(document.body)
  })

  it('goes away on a key press, which neither plays a note nor does anything else', async () => {
    const user = drawApp()

    await user.keyboard('[KeyA>]')
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')
    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([])

    // The next press of the same key is an ordinary note.
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    await user.keyboard('[/KeyA]')
    expect(heldNotes()).toEqual([])
  })

  it.each(['Space', 'Enter', 'Tab', 'Escape', 'ShiftLeft'])(
    'the first press of %s removes the overlay and does nothing else',
    async (code) => {
      const user = drawApp()
      await user.keyboard(`[${code}]`)

      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
      expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()
      expect(document.activeElement).toBe(document.body)
      expect(heldNotes()).toEqual([])
    },
  )

  // Escape and a lone Shift are left out on purpose: a browser does not count
  // them as the player doing something and refuses the sound on them. What
  // the app does about that needs a browser that says so, or a stand-in for
  // one: it is tested in src/App.edge.test.tsx.
  it.each(['Space', 'Enter', 'Tab', 'KeyQ', 'Digit1'])(
    'the first press of %s starts the sound, once',
    async (code) => {
      const user = drawApp()
      await user.keyboard(`[${code}]`)
      expect(audio.state.starts).toBe(1)
    },
  )

  // With Ctrl held a key belongs to the browser: Ctrl+R reloads the page and
  // Ctrl+W closes the tab (W alone is a note). Whether such a press also
  // counts as "any key" for the overlay is left open here.
  it.each([
    ['while the overlay is up', drawApp],
    ['once the app has started', startApp],
  ] as const)('leaves browser shortcuts to the browser %s', async (_when, begin) => {
    await begin()
    for (const [code, key] of [
      ['KeyR', 'r'],
      ['KeyW', 'w'],
    ] as const) {
      // fireEvent returns false when something cancelled the key.
      expect(fireEvent.keyDown(document.body, { code, key, ctrlKey: true }), code).toBe(true)
      fireEvent.keyUp(document.body, { code, key, ctrlKey: true })
    }
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([])
  })

  it('does not start the sound a second time once it runs', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA][KeyS]')
    await user.click(customizeButton())
    await user.click(customizeButton())
    expect(audio.state.starts).toBe(1)
  })
})

// ---------------------------------------------------------------------------

describe('header and tabs', () => {
  it('shows the app name as the page heading', async () => {
    await startApp()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(APP_NAME)
  })

  it('offers the three modes as real tabs, Free Play selected, the others not available yet', async () => {
    await startApp()
    const tablist = screen.getByRole('tablist')
    expect(tablist.getAttribute('aria-label')).toBeTruthy()

    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.firstChild?.textContent)).toEqual([
      'Free Play',
      'Practice',
      'Real-time',
    ])
    expect(tabs.map((tab) => tab.querySelector('.mode-tab__badge')?.textContent)).toEqual([
      undefined,
      'Soon',
      'Soon',
    ])

    const [freePlay, practice, realTime] = tabs as [HTMLElement, HTMLElement, HTMLElement]
    expect(freePlay.getAttribute('aria-selected')).toBe('true')
    expect(freePlay.getAttribute('aria-disabled')).not.toBe('true')
    for (const tab of [practice, realTime]) {
      expect(tab.getAttribute('aria-selected')).toBe('false')
      expect(tab.getAttribute('aria-disabled')).toBe('true')
      expect(tab.getAttribute('title')).toBe('Coming in a later update')
    }
  })

  it('ties the selected tab to the page below it, both ways', async () => {
    await startApp()
    const freePlay = screen.getByRole('tab', { name: 'Free Play' })
    const panel = screen.getByRole('tabpanel')
    expect(freePlay.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(freePlay.id)
    expect(panel.contains(toolbar())).toBe(true)
    expect(panel.contains(piano())).toBe(true)
  })

  it('does nothing when a mode that is not built yet is clicked', async () => {
    const user = await startApp()
    await user.click(screen.getByRole('tab', { name: /Practice/ }))
    expect(screen.getByRole('tab', { name: 'Free Play' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByRole('tab', { name: /Practice/ }).getAttribute('aria-selected')).toBe(
      'false',
    )
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
  })
})

// ---------------------------------------------------------------------------

describe('toolbar', () => {
  it('volume: the slider is named, moves the setting, the percentage and the sound', async () => {
    await startApp()
    const slider = within(toolbar()).getByRole('slider', { name: 'Volume' })
    expect((slider as HTMLInputElement).value).toBe('80')
    expect(slider.getAttribute('aria-valuetext')).toBe('80%')
    expect(within(toolbar()).getByText('80%')).toBeTruthy()

    fireEvent.change(slider, { target: { value: '35' } })

    expect(settingsStore.get().volume).toBe(0.35)
    expect(saved().volume).toBe(0.35)
    expect((slider as HTMLInputElement).value).toBe('35')
    expect(slider.getAttribute('aria-valuetext')).toBe('35%')
    expect(within(toolbar()).getByText('35%')).toBeTruthy()
    expect(audio.state.calls).toContain('volume:0.35')
  })

  it('volume: goes all the way down to 0% and up to 100%', async () => {
    await startApp()
    const slider = within(toolbar()).getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    expect(slider.min).toBe('0')
    expect(slider.max).toBe('100')

    fireEvent.change(slider, { target: { value: '0' } })
    expect(settingsStore.get().volume).toBe(0)
    expect(within(toolbar()).getByText('0%')).toBeTruthy()

    fireEvent.change(slider, { target: { value: '100' } })
    expect(settingsStore.get().volume).toBe(1)
    expect(within(toolbar()).getByText('100%')).toBeTruthy()
  })

  it('sustain: a click switches it on and off, in words and for screen readers', async () => {
    const user = await startApp()
    const sustain = within(toolbar()).getByRole('switch', { name: 'Sustain' })
    expect(sustain.getAttribute('aria-checked')).toBe('false')
    expect(textOf(sustain)).toBe('Off')
    // The hint that Space does the same.
    expect(within(toolbar()).getByText('Space')).toBeTruthy()

    await user.click(sustain)
    expect(settingsStore.get().sustain).toBe(true)
    expect(saved().sustain).toBe(true)
    expect(sustain.getAttribute('aria-checked')).toBe('true')
    expect(textOf(sustain)).toBe('On')
    expect(audio.state.calls.at(-1)).toBe('sustain:true')

    await user.click(sustain)
    expect(settingsStore.get().sustain).toBe(false)
    expect(sustain.getAttribute('aria-checked')).toBe('false')
    expect(textOf(sustain)).toBe('Off')
    expect(audio.state.calls.at(-1)).toBe('sustain:false')
  })

  it('sustain: Space switches it too, and the switch on screen follows', async () => {
    const user = await startApp()
    const sustain = within(toolbar()).getByRole('switch', { name: 'Sustain' })

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(sustain.getAttribute('aria-checked')).toBe('true')

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(false)
    expect(sustain.getAttribute('aria-checked')).toBe('false')
  })

  it('piano position: Lower and Higher move the range shown between them and on the piano', async () => {
    const user = await startApp()
    const lower = within(toolbar()).getByRole('button', { name: 'Lower' })
    const higher = within(toolbar()).getByRole('button', { name: 'Higher' })
    expect(within(toolbar()).getByText('C3 – C6')).toBeTruthy()
    expect(textOf(lower)).toMatch(/^◀︎? ?Lower$/)
    expect(textOf(higher)).toMatch(/^Higher ?▶︎?$/)

    await user.click(lower)
    expect(settingsStore.get().baseOctave).toBe(2)
    expect(saved().baseOctave).toBe(2)
    expect(within(toolbar()).getByText('C2 – C5')).toBeTruthy()
    // The same computer key now plays the note one step lower on the piano.
    expect(pianoKey('C3, key A')).toBeTruthy()

    await user.click(higher)
    await user.click(higher)
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(within(toolbar()).getByText('C4 – C7')).toBeTruthy()
    expect(pianoKey('C5, key A')).toBeTruthy()
  })

  it('piano position: the buttons are disabled at the two ends', async () => {
    const user = await startApp()
    const lower = within(toolbar()).getByRole('button', { name: 'Lower' }) as HTMLButtonElement
    const higher = within(toolbar()).getByRole('button', { name: 'Higher' }) as HTMLButtonElement

    await user.click(lower)
    await user.click(lower)
    expect(within(toolbar()).getByText('C1 – C4')).toBeTruthy()
    expect(lower.disabled).toBe(true)
    expect(higher.disabled).toBe(false)
    await user.click(lower)
    expect(settingsStore.get().baseOctave).toBe(1)

    for (let step = 0; step < 4; step += 1) await user.click(higher)
    expect(within(toolbar()).getByText('C5 – C8')).toBeTruthy()
    expect(higher.disabled).toBe(true)
    expect(lower.disabled).toBe(false)
    await user.click(higher)
    expect(settingsStore.get().baseOctave).toBe(5)
  })

  it('piano position: moving the piano lets go of a note that is held', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])

    await user.click(within(toolbar()).getByRole('button', { name: 'Higher' }))
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls).toContain('off:60')

    await user.keyboard('[/KeyA]')
    expect(heldNotes()).toEqual([])
  })

  it.each([
    ['Keys only', 'keys', true, false],
    ['Notes only', 'notes', false, true],
    ['No labels', 'none', false, false],
    ['Keys and notes', 'both', true, true],
  ] as const)('labels: "%s" is saved and changes what is written on the keys', async (option, mode, caps, notes) => {
    const user = await startApp()
    // Start from a different mode, so that choosing this one is a change.
    act(() => settingsStore.set({ labelMode: mode === 'both' ? 'none' : 'both' }))
    const select = within(toolbar()).getByRole('combobox', { name: 'Labels' }) as HTMLSelectElement

    await user.selectOptions(select, option)

    expect(settingsStore.get().labelMode).toBe(mode)
    expect(saved().labelMode).toBe(mode)
    expect(select.value).toBe(mode)
    expect(piano().querySelectorAll('.piano-key__cap').length > 0).toBe(caps)
    expect(piano().querySelectorAll('.piano-key__note').length > 0).toBe(notes)
  })

  it('labels: offers the four choices in plain words', async () => {
    await startApp()
    const select = within(toolbar()).getByRole('combobox', { name: 'Labels' })
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Keys and notes',
      'Keys only',
      'Notes only',
      'No labels',
    ])
  })

  it('customize keys: the button opens and closes the panel and says so with aria-pressed', async () => {
    const user = await startApp()
    const button = customizeButton()
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()

    await user.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(textOf(keyEditorPanel())).toContain(
      'Click a piano key, then press the key you want to use for it.',
    )

    await user.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()
  })

  it('advanced: closed at first; the button opens and closes the panel and says so with aria-expanded', async () => {
    const user = await startApp()
    const button = advancedButton()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Advanced settings')).toBeNull()

    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const panel = advancedPanel()
    expect(button.getAttribute('aria-controls')).toBe(panel.id)
    // Directly under the toolbar: after it, and before the line of the notes being played.
    expect(comesBefore(toolbar(), panel)).toBe(true)
    expect(comesBefore(panel, nowPlayingLine())).toBe(true)

    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Advanced settings')).toBeNull()
  })

  it('every control has a visible plain-word label', async () => {
    await startApp()
    const labels = [...toolbar().querySelectorAll('.field__label')].map((label) => label.textContent)
    expect(labels).toEqual(['Volume', 'Sustain', 'Piano position', 'Labels'])
  })
})

// ---------------------------------------------------------------------------

describe('Advanced panel', () => {
  it('opens with its heading, the reassuring sentence and the six options, each explained', async () => {
    const user = await startApp()
    const panel = await openAdvanced(user)

    expect(within(panel).getByRole('heading', { name: 'Advanced settings' })).toBeTruthy()
    expect(
      within(panel).getByText('Optional. The piano works well without changing any of these.'),
    ).toBeTruthy()

    const labels = [...panel.querySelectorAll('.field__label')].map((label) => label.textContent)
    expect(labels).toEqual([
      'Touch',
      'Transpose',
      'Note names',
      'Room echo',
      'Note fade-out',
      'Light trails',
    ])
    for (const sentence of [
      'How hard each note is played.',
      'Shifts every note up or down. 0 is normal.',
      'Adds the echo of a room. 0 is none.',
      'How long a note rings after you let go.',
      'Glowing trails above the keys.',
    ]) {
      expect(within(panel).getByText(sentence)).toBeTruthy()
    }
    // Every option has a one-line explanation, including the one the spec gives no sentence for.
    for (const field of panel.querySelectorAll('.field')) {
      expect(field.querySelector('.field__hint')?.textContent?.trim()).toBeTruthy()
    }
  })

  it('touch: a slider from 10% to 100% that sets how hard notes are played', async () => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    const slider = within(panel).getByRole('slider', { name: 'Touch' }) as HTMLInputElement
    expect(slider.min).toBe('10')
    expect(slider.max).toBe('100')
    expect(slider.value).toBe('80')

    fireEvent.change(slider, { target: { value: '45' } })
    expect(settingsStore.get().velocity).toBe(0.45)
    expect(saved().velocity).toBe(0.45)
    expect(slider.getAttribute('aria-valuetext')).toBe('45%')
    expect(within(panel).getByText('45%')).toBeTruthy()

    // The very next note is played that hard.
    await user.keyboard('[KeyA]')
    expect(audio.state.calls).toContain('on:60:0.45')

    fireEvent.change(slider, { target: { value: '10' } })
    expect(settingsStore.get().velocity).toBe(0.1)
    expect(within(panel).getByText('10%')).toBeTruthy()
  })

  it('transpose: − and + step the value, written with its sign', async () => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    const down = within(panel).getByRole('button', { name: 'Transpose down' })
    const up = within(panel).getByRole('button', { name: 'Transpose up' })
    const value = panel.querySelector('.stepper__value') as HTMLElement
    expect(down.textContent).toBe('−')
    expect(up.textContent).toBe('+')
    expect(value.textContent).toBe('0')

    await user.click(up)
    await user.click(up)
    expect(settingsStore.get().transpose).toBe(2)
    expect(saved().transpose).toBe(2)
    expect(value.textContent).toBe('+2')
    expect(audio.state.calls.at(-1)).toBe('transpose:2')

    for (let step = 0; step < 5; step += 1) await user.click(down)
    expect(settingsStore.get().transpose).toBe(-3)
    expect(value.textContent).toBe('−3')
    expect(audio.state.calls.at(-1)).toBe('transpose:-3')
  })

  it('transpose: stops at 12 either way', async () => {
    const user = await startApp()
    act(() => settingsStore.set({ transpose: 11 }))
    const panel = await openAdvanced(user)
    const down = within(panel).getByRole('button', { name: 'Transpose down' }) as HTMLButtonElement
    const up = within(panel).getByRole('button', { name: 'Transpose up' }) as HTMLButtonElement

    await user.click(up)
    expect(settingsStore.get().transpose).toBe(12)
    expect(up.disabled).toBe(true)
    await user.click(up)
    expect(settingsStore.get().transpose).toBe(12)
    expect(panel.querySelector('.stepper__value')?.textContent).toBe('+12')

    act(() => settingsStore.set({ transpose: -11 }))
    expect(up.disabled).toBe(false)
    await user.click(down)
    expect(settingsStore.get().transpose).toBe(-12)
    expect(down.disabled).toBe(true)
    expect(panel.querySelector('.stepper__value')?.textContent).toBe('−12')
  })

  it('note names: "Do Ré Mi" renames the notes everywhere on the screen, "C D E" puts them back', async () => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    const letters = within(panel).getByRole('button', { name: 'C D E' })
    const solfege = within(panel).getByRole('button', { name: 'Do Ré Mi' })
    expect(letters.getAttribute('aria-pressed')).toBe('true')
    expect(solfege.getAttribute('aria-pressed')).toBe('false')

    await user.click(solfege)
    expect(settingsStore.get().noteNaming).toBe('solfege')
    expect(saved().noteNaming).toBe('solfege')
    expect(letters.getAttribute('aria-pressed')).toBe('false')
    expect(solfege.getAttribute('aria-pressed')).toBe('true')
    expect(within(toolbar()).getByText('Do3 – Do6')).toBeTruthy()
    expect(pianoKey('Do4, key A')).toBeTruthy()
    await user.keyboard('[KeyA>][KeyG>]')
    expect(
      within(nowPlayingLine())
        .getAllByRole('listitem')
        .map((note) => note.textContent),
    ).toEqual(['Do4', 'Sol4'])
    await user.keyboard('[/KeyA][/KeyG]')

    await user.click(letters)
    expect(settingsStore.get().noteNaming).toBe('letters')
    expect(within(toolbar()).getByText('C3 – C6')).toBeTruthy()
    expect(pianoKey('C4, key A')).toBeTruthy()
  })

  it('room echo: a slider from 0% to 100%', async () => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    const slider = within(panel).getByRole('slider', { name: 'Room echo' }) as HTMLInputElement
    expect(slider.min).toBe('0')
    expect(slider.max).toBe('100')
    expect(slider.value).toBe('15')

    fireEvent.change(slider, { target: { value: '60' } })
    expect(settingsStore.get().reverb).toBe(0.6)
    expect(saved().reverb).toBe(0.6)
    expect(within(panel).getByText('60%')).toBeTruthy()
    expect(audio.state.calls.at(-1)).toBe('reverb:0.6')

    fireEvent.change(slider, { target: { value: '0' } })
    expect(settingsStore.get().reverb).toBe(0)
    expect(audio.state.calls.at(-1)).toBe('reverb:0')
  })

  it.each([
    ['Short', 'short', 0.25],
    ['Long', 'long', 2.5],
    ['Normal', 'normal', 1],
  ] as const)('note fade-out: "%s" is saved and passed on to the sound', async (label, release, seconds) => {
    const user = await startApp()
    act(() => settingsStore.set({ release: release === 'normal' ? 'long' : 'normal' }))
    const panel = await openAdvanced(user)
    const options = ['Short', 'Normal', 'Long'].map((name) =>
      within(panel).getByRole('button', { name }),
    )

    await user.click(within(panel).getByRole('button', { name: label }))

    expect(settingsStore.get().release).toBe(release)
    expect(saved().release).toBe(release)
    expect(options.map((option) => option.getAttribute('aria-pressed'))).toEqual(
      ['Short', 'Normal', 'Long'].map((name) => String(name === label)),
    )
    expect(audio.state.calls.at(-1)).toBe(`release:${seconds}`)
  })

  it('light trails: switching them off removes the canvas, switching them on brings it back', async () => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    const trails = within(panel).getByRole('switch', { name: 'Light trails' })
    expect(trails.getAttribute('aria-checked')).toBe('true')
    expect(textOf(trails)).toBe('On')
    const stage = piano().parentElement as HTMLElement
    expect(stage.querySelector('canvas')).not.toBeNull()

    await user.click(trails)
    expect(settingsStore.get().showTrails).toBe(false)
    expect(saved().showTrails).toBe(false)
    expect(trails.getAttribute('aria-checked')).toBe('false')
    expect(textOf(trails)).toBe('Off')
    expect(document.querySelector('canvas')).toBeNull()
    // The stage is then just the piano.
    expect([...stage.children]).toEqual([piano()])

    await user.click(trails)
    expect(settingsStore.get().showTrails).toBe(true)
    expect(stage.querySelector('canvas')).not.toBeNull()
    // The canvas sits directly on top of the piano, and is hidden from screen readers.
    expect(stage.firstElementChild?.contains(stage.querySelector('canvas'))).toBe(true)
    expect(stage.lastElementChild).toBe(piano())
    expect(stage.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('stays open, with what was set, while the player plays and uses the toolbar', async () => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    await user.click(within(panel).getByRole('button', { name: 'Transpose up' }))

    await user.keyboard('[KeyA][Space]')
    await user.click(within(toolbar()).getByRole('button', { name: 'Lower' }))

    expect(advancedButton().getAttribute('aria-expanded')).toBe('true')
    expect(advancedPanel().querySelector('.stepper__value')?.textContent).toBe('+1')
  })
})

// ---------------------------------------------------------------------------

describe('Reset advanced settings', () => {
  const CHANGED: Partial<Settings> = {
    velocity: 0.3,
    transpose: 5,
    noteNaming: 'solfege',
    reverb: 0.9,
    release: 'long',
    showTrails: false,
    // Not advanced settings: a reset of the panel must leave these alone.
    volume: 0.2,
    sustain: true,
    baseOctave: 2,
    labelMode: 'keys',
    bindings: { KeyZ: 0 },
    customLabels: { KeyZ: 'Z' },
  }

  it('asks first, in its own place, and "No" changes nothing', async () => {
    const user = await startApp()
    act(() => settingsStore.set(CHANGED))
    const before = settingsStore.get()
    const panel = await openAdvanced(user)

    await user.click(within(panel).getByRole('button', { name: 'Reset advanced settings' }))
    expect(within(panel).queryByRole('button', { name: 'Reset advanced settings' })).toBeNull()
    expect(within(panel).getByText('Really reset?')).toBeTruthy()
    expect(settingsStore.get()).toBe(before)

    await user.click(within(panel).getByRole('button', { name: 'No' }))
    expect(settingsStore.get()).toBe(before)
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Reset advanced settings' })).toBeTruthy()
    expect(panel.querySelector('.stepper__value')?.textContent).toBe('+5')
  })

  it('"Yes" puts the six advanced settings back and touches nothing else', async () => {
    const user = await startApp()
    act(() => settingsStore.set(CHANGED))
    const panel = await openAdvanced(user)

    await user.click(within(panel).getByRole('button', { name: 'Reset advanced settings' }))
    await user.click(within(panel).getByRole('button', { name: 'Yes' }))

    const now = settingsStore.get()
    for (const key of ADVANCED_KEYS) expect(now[key]).toEqual(DEFAULT_SETTINGS[key])
    expect(now.volume).toBe(0.2)
    expect(now.sustain).toBe(true)
    expect(now.baseOctave).toBe(2)
    expect(now.labelMode).toBe('keys')
    expect(now.bindings).toEqual({ KeyZ: 0 })
    expect(now.customLabels).toEqual({ KeyZ: 'Z' })
    expect(saved()).toEqual(JSON.parse(JSON.stringify(now)))

    // The screen follows: the panel shows the defaults, the question is gone, the badge too.
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Reset advanced settings' })).toBeTruthy()
    const sliderValue = (name: string): string =>
      (within(panel).getByRole('slider', { name }) as HTMLInputElement).value
    expect(sliderValue('Touch')).toBe('80')
    expect(sliderValue('Room echo')).toBe('15')
    expect(panel.querySelector('.stepper__value')?.textContent).toBe('0')
    const pressed = (name: string): string | null =>
      within(panel).getByRole('button', { name }).getAttribute('aria-pressed')
    expect(pressed('C D E')).toBe('true')
    expect(pressed('Normal')).toBe('true')
    expect(
      within(panel).getByRole('switch', { name: 'Light trails' }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(screen.queryByText(/Transposed/)).toBeNull()
    expect(document.querySelector('canvas')).not.toBeNull()
    expect(within(toolbar()).getByText('C2 – C5')).toBeTruthy()
  })

  it("never uses the browser's own confirm or alert boxes", async () => {
    const confirm = vi.fn(() => true)
    const alert = vi.fn()
    vi.stubGlobal('confirm', confirm)
    vi.stubGlobal('alert', alert)
    try {
      const user = await startApp()
      const panel = await openAdvanced(user)
      await user.click(within(panel).getByRole('button', { name: 'Reset advanced settings' }))
      await user.click(within(panel).getByRole('button', { name: 'Yes' }))
      await user.click(customizeButton())
      await user.click(
        within(keyEditorPanel()).getByRole('button', { name: 'Reset to default keys' }),
      )
      await user.click(within(keyEditorPanel()).getByRole('button', { name: 'Yes' }))
      expect(confirm).not.toHaveBeenCalled()
      expect(alert).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ---------------------------------------------------------------------------

describe('Customize keys and "Reset to default keys"', () => {
  it('assigns a key: click a piano key, press a computer key, read what happened', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    const panel = keyEditorPanel()

    await user.click(pianoKey('C4, key A'))
    expect(textOf(panel)).toContain('Press a key for C4…')
    expect(textOf(panel)).toContain('Esc = cancel · Backspace = remove this key')
    expect(pianoKey('C4, key A').getAttribute('aria-pressed')).toBe('true')

    await user.keyboard('[KeyZ]')
    expect(within(panel).getByRole('status').textContent).toBe(
      '"Z" now plays C4. "A" no longer plays a note.',
    )
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()
    expect(settingsStore.get().customLabels.KeyZ).toBe('Z')
    expect(saved().bindings).toEqual(settingsStore.get().bindings)
    expect(pianoKey('C4, key Z')).toBeTruthy()
    // Nothing is selected any more, the press played nothing, and the first sentence is back.
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([])
    expect(textOf(panel)).toContain('Click a piano key, then press the key you want to use for it.')
  })

  it('says which note lost its key when a key that was in use is moved', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[KeyK]')
    expect(within(keyEditorPanel()).getByRole('status').textContent).toBe(
      '"K" now plays C4. "A" no longer plays a note. C5 has no key now.',
    )
    expect(pianoKey('C4, key K')).toBeTruthy()
    expect(pianoKey('C5')).toBeTruthy()
  })

  it('"Reset to default keys": "No" keeps the player\'s keys, "Yes" brings the default ones back', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[KeyZ]')
    const custom = settingsStore.get().bindings
    const panel = keyEditorPanel()

    await user.click(within(panel).getByRole('button', { name: 'Reset to default keys' }))
    expect(within(panel).getByText('Really reset?')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Reset to default keys' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'No' }))
    expect(settingsStore.get().bindings).toBe(custom)
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(pianoKey('C4, key Z')).toBeTruthy()

    await user.click(within(panel).getByRole('button', { name: 'Reset to default keys' }))
    await user.click(within(panel).getByRole('button', { name: 'Yes' }))
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
    expect(settingsStore.get().customLabels).toEqual({})
    expect(saved().bindings).toEqual(DEFAULT_BINDINGS)
    expect(pianoKey('C4, key A')).toBeTruthy()
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Reset to default keys' })).toBeTruthy()
    // Still customizing: a reset is not "Done".
    expect(customizeButton().getAttribute('aria-pressed')).toBe('true')
  })

  it('a reset of the keys leaves every other setting alone', async () => {
    const user = await startApp()
    const others: Partial<Settings> = {
      volume: 0.2,
      sustain: true,
      baseOctave: 4,
      transpose: 3,
      labelMode: 'keys',
    }
    act(() => settingsStore.set(others))
    await user.click(customizeButton())
    await user.click(pianoKey('C5, key A'))
    await user.keyboard('[KeyZ]')

    await user.click(within(keyEditorPanel()).getByRole('button', { name: 'Reset to default keys' }))
    await user.click(within(keyEditorPanel()).getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get()).toEqual({ ...DEFAULT_SETTINGS, ...others })
  })

  it('"Done" leaves customizing, and so does Escape with nothing selected', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    await user.click(within(keyEditorPanel()).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()
    expect(customizeButton().getAttribute('aria-pressed')).toBe('false')

    await user.click(customizeButton())
    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[Escape]')
    // The first Escape only cancels the selection.
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(keyEditorPanel()).toBeTruthy()
    await user.keyboard('[Escape]')
    expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()
    expect(settingsStore.get().bindings).toEqual(DEFAULT_BINDINGS)
  })

  it('refuses keys that cannot play a note, without toggling sustain or leaving the key', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    await user.click(pianoKey('C4, key A'))

    for (const code of ['Space', 'Enter', 'ArrowUp', 'Tab']) {
      await user.keyboard(`[${code}]`)
      expect(within(keyEditorPanel()).getByRole('status').textContent).toBe(
        "That key can't be used. Try a letter, number or symbol key.",
      )
      expect(pianoKey('C4, key A').classList.contains('is-selected')).toBe(true)
    }
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)

    await user.keyboard('[Backspace]')
    expect(within(keyEditorPanel()).getByRole('status').textContent).toBe('C4 has no key now.')
    expect(pianoKey('C4')).toBeTruthy()
    expect(settingsStore.get().bindings.KeyA).toBeUndefined()
  })

  it('with no piano key selected the keyboard still plays, so the layout can be tried', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    expect(textOf(nowPlayingLine())).toBe('C4')
    await user.keyboard('[/KeyA]')
    expect(heldNotes()).toEqual([])
    // No "click it" hint while a click on the piano means something else.
    expect(screen.queryByText(HINT_TEXT)).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('Transposed badge and Now playing line', () => {
  it('shows the hint while nothing is held and no badge while the transpose is 0', async () => {
    await startApp()
    expect(textOf(nowPlayingLine())).toBe(HINT_TEXT)
    expect(screen.queryByText(/Transposed/)).toBeNull()
  })

  it('shows the badge next to the line as soon as the transpose is not 0, with its sign', async () => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    const up = within(panel).getByRole('button', { name: 'Transpose up' })
    const down = within(panel).getByRole('button', { name: 'Transpose down' })

    await user.click(up)
    await user.click(up)
    expect(within(nowPlayingLine()).getByText('Transposed +2')).toBeTruthy()

    for (let step = 0; step < 5; step += 1) await user.click(down)
    expect(within(nowPlayingLine()).getByText('Transposed −3')).toBeTruthy()

    for (let step = 0; step < 3; step += 1) await user.click(up)
    expect(screen.queryByText(/Transposed/)).toBeNull()
  })

  it('keeps the badge while notes are held, and while the Advanced panel is closed', async () => {
    const user = await startApp()
    act(() => settingsStore.set({ transpose: -12 }))
    expect(within(nowPlayingLine()).getByText('Transposed −12')).toBeTruthy()

    await user.keyboard('[KeyA>]')
    expect(within(nowPlayingLine()).getByText('Transposed −12')).toBeTruthy()
    // The line names the key that is held: the key itself does not change with the transpose.
    expect(within(nowPlayingLine()).getByText('C4')).toBeTruthy()
    await user.keyboard('[/KeyA]')
  })

  it('names the held notes, lowest first, and goes back to the hint when they are let go', async () => {
    const user = await startApp()
    await user.keyboard('[KeyG>][KeyA>][KeyD>]')
    const notes = within(nowPlayingLine()).getAllByRole('listitem')
    expect(notes.map((note) => note.textContent)).toEqual(['C4', 'E4', 'G4'])
    expect(screen.queryByText(HINT_TEXT)).toBeNull()

    await user.keyboard('[/KeyA]')
    expect(
      within(nowPlayingLine())
        .getAllByRole('listitem')
        .map((note) => note.textContent),
    ).toEqual(['E4', 'G4'])

    await user.keyboard('[/KeyG][/KeyD]')
    expect(textOf(nowPlayingLine())).toBe(HINT_TEXT)
  })

  it('names black keys with a sharp sign and follows the piano when it is moved', async () => {
    const user = await startApp()
    await user.keyboard('[KeyW>]')
    expect(textOf(nowPlayingLine())).toBe('C♯4')
    await user.keyboard('[/KeyW]')

    await user.click(within(toolbar()).getByRole('button', { name: 'Lower' }))
    await user.keyboard('[KeyW>]')
    expect(textOf(nowPlayingLine())).toBe('C♯3')
    await user.keyboard('[/KeyW]')
  })

  it('lights the piano key that is held and puts it out again', async () => {
    const user = await startApp()
    const key = pianoKey('C4, key A')
    await user.keyboard('[KeyA>]')
    expect(key.classList.contains('is-lit')).toBe(true)
    expect(key.getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('[/KeyA]')
    expect(key.classList.contains('is-lit')).toBe(false)
    expect(key.getAttribute('aria-pressed')).toBe('false')
  })
})

// ---------------------------------------------------------------------------

describe('footer', () => {
  const SUSTAIN_HINT = 'Space turns sustain on and off.'
  const CREDIT = 'Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)'

  /** What the footer says, part by part, leaving out a part that is empty. */
  function footerParts(): string[] {
    return [...footer().children].map(textOf).filter((text) => text !== '')
  }

  it('always explains the sustain key, and says nothing about the sound while it is ready', async () => {
    await startApp()
    expect(audio.state.status).toBe('ready')
    expect(within(footer()).getByRole('status').textContent).toBe('')
    // Only the hint and, at the end, the credit for the piano recordings.
    expect(footerParts()).toEqual([SUSTAIN_HINT, CREDIT])
  })

  it.each(['loading', 'ready', 'fallback', 'error'] as const)(
    'ends with the credit for the piano sound, linked to its licence, while the sound is "%s"',
    async (status) => {
      audio.state.startsAs = status
      await startApp()
      expect(footerParts().at(-1)).toBe(CREDIT)

      const link = within(footer()).getByRole('link')
      expect(link.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/3.0/')
      // The link is part of the credit, whichever of its words carry it.
      expect(CREDIT).toContain(textOf(link))
      expect(textOf(link)).not.toBe('')
    },
  )

  it.each([
    ['loading', 'Loading piano sound…'],
    ['fallback', 'Using basic sound (piano sound could not be loaded).'],
    ['error', 'Sound could not start. Click anywhere to try again.'],
  ] as const)('says so while the sound is "%s"', async (status, message) => {
    audio.state.startsAs = status
    await startApp()
    expect(within(footer()).getByRole('status').textContent).toBe(message)
    expect(textOf(footer())).toContain(SUSTAIN_HINT)
  })

  it('follows the sound: loading, then nothing once the piano sound is there', async () => {
    audio.state.startsAs = 'loading'
    await startApp()
    const status = within(footer()).getByRole('status')
    expect(status.textContent).toBe('Loading piano sound…')

    setAudioStatus('ready')
    expect(status.textContent).toBe('')
    // The same element is kept, so a screen reader hears the changes.
    expect(within(footer()).getByRole('status')).toBe(status)

    setAudioStatus('fallback')
    expect(status.textContent).toBe('Using basic sound (piano sound could not be loaded).')
  })

  it('after an error, a click anywhere tries again', async () => {
    audio.state.startsAs = 'error'
    const user = await startApp()
    expect(audio.state.starts).toBe(1)
    expect(within(footer()).getByRole('status').textContent).toMatch(/^Sound could not start/)

    // Still failing: the message stays and every click is a new attempt.
    await user.click(screen.getByRole('heading', { level: 1 }))
    expect(audio.state.starts).toBe(2)
    expect(within(footer()).getByRole('status').textContent).toMatch(/^Sound could not start/)

    audio.state.startsAs = 'ready'
    await user.click(footer())
    expect(audio.state.starts).toBe(3)
    expect(within(footer()).getByRole('status').textContent).toBe('')

    // Once it works, clicks no longer start anything.
    await user.click(footer())
    expect(audio.state.starts).toBe(3)
  })

  it.each([
    ['the piano', () => piano()],
    ['a toolbar button', () => customizeButton()],
    ['the empty space of the page', () => document.querySelector('.app') as HTMLElement],
  ] as const)('after an error, a click on %s tries again', async (_where, target) => {
    audio.state.startsAs = 'error'
    const user = await startApp()
    audio.state.startsAs = 'ready'
    await user.click(target())
    expect(audio.state.starts).toBe(2)
    expect(audio.state.status).toBe('ready')
  })

  it('after an error, a key press tries again too', async () => {
    audio.state.startsAs = 'error'
    const user = await startApp()
    audio.state.startsAs = 'loading'
    await user.keyboard('[KeyA]')
    expect(audio.state.starts).toBe(2)
    expect(within(footer()).getByRole('status').textContent).toBe('Loading piano sound…')
  })

  it('does not try again by itself when only the piano sound is missing', async () => {
    audio.state.startsAs = 'fallback'
    const user = await startApp()
    await user.click(footer())
    await user.keyboard('[KeyA]')
    expect(audio.state.starts).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Where the keyboard focus goes
// ---------------------------------------------------------------------------

/** The note the A key plays where the piano stands now (middle C by default). */
function noteOfKeyA(): number {
  return 12 * (settingsStore.get().baseOctave + 1) + 12
}

/** The very next key press is a note, and Space is the sustain key. */
async function expectKeysToPlay(user: User): Promise<void> {
  const sustain = settingsStore.get().sustain
  await user.keyboard('[KeyA>]')
  expect(heldNotes()).toEqual([noteOfKeyA()])
  await user.keyboard('[/KeyA]')
  expect(heldNotes()).toEqual([])
  // Space is the sustain key again, not "press the thing I last clicked".
  await user.keyboard('[Space]')
  expect(settingsStore.get().sustain).toBe(!sustain)
  await user.keyboard('[Space]')
  expect(settingsStore.get().sustain).toBe(sustain)
}

/** Nothing holds the keyboard, and the very next key press is a note. */
async function expectStraightBackToPlaying(user: User): Promise<void> {
  expect(document.activeElement).toBe(document.body)
  await expectKeysToPlay(user)
}

describe('after a click with the mouse the player can go straight back to playing', () => {
  it.each([
    ['the Free Play tab', () => screen.getByRole('tab', { name: 'Free Play' })],
    ['a tab that is not built yet', () => screen.getByRole('tab', { name: /Real-time/ })],
    ['the Sustain switch', () => screen.getByRole('switch', { name: 'Sustain' })],
    ['Lower', () => screen.getByRole('button', { name: 'Lower' })],
    ['Higher', () => screen.getByRole('button', { name: 'Higher' })],
    ['Customize keys', () => customizeButton()],
    ['Advanced', () => advancedButton()],
  ] as const)('toolbar: %s', async (_name, control) => {
    const user = await startApp()
    await user.click(control())
    await expectStraightBackToPlaying(user)
  })

  // A slider is not a place where the player types. Whether or not it keeps
  // the keyboard focus after a click, the keys go on playing.
  it.each(['Volume', 'Touch', 'Room echo'])('the %s slider', async (name) => {
    const user = await startApp()
    await openAdvanced(user)
    await user.click(screen.getByRole('slider', { name }))
    await expectKeysToPlay(user)
  })

  it.each([
    ['Transpose up', 'button', 'Transpose up'],
    ['Transpose down', 'button', 'Transpose down'],
    ['Do Ré Mi', 'button', 'Do Ré Mi'],
    ['C D E', 'button', 'C D E'],
    ['Short', 'button', 'Short'],
    ['Long', 'button', 'Long'],
    ['the Light trails switch', 'switch', 'Light trails'],
    ['Reset advanced settings', 'button', 'Reset advanced settings'],
  ] as const)('Advanced panel: %s', async (_name, role, name) => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    await user.click(within(panel).getByRole(role, { name }))
    await expectStraightBackToPlaying(user)
  })

  it.each(['Yes', 'No'] as const)('Advanced panel: "%s" of the reset question', async (answer) => {
    const user = await startApp()
    const panel = await openAdvanced(user)
    await user.click(within(panel).getByRole('button', { name: 'Reset advanced settings' }))
    await user.click(within(panel).getByRole('button', { name: answer }))
    await expectStraightBackToPlaying(user)
  })

  it.each(['Reset to default keys', 'Done'] as const)('Customize keys: %s', async (name) => {
    const user = await startApp()
    await user.click(customizeButton())
    await user.click(within(keyEditorPanel()).getByRole('button', { name }))
    await expectStraightBackToPlaying(user)
  })

  it('Customize keys: a piano key that was clicked and given a key does not keep the focus', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    await user.click(pianoKey('C4, key A'))
    expect(document.activeElement).toBe(document.body)
    await user.keyboard('[KeyZ]')
    await user.click(within(keyEditorPanel()).getByRole('button', { name: 'Done' }))
    expect(document.activeElement).toBe(document.body)
    await user.keyboard('[KeyZ>]')
    expect(heldNotes()).toEqual([60])
    await user.keyboard('[/KeyZ]')
  })

  it('Enter does not press again the button that was last clicked with the mouse', async () => {
    const user = await startApp()
    await user.click(screen.getByRole('button', { name: 'Higher' }))
    await user.keyboard('[Enter]')
    expect(settingsStore.get().baseOctave).toBe(4)

    await user.click(advancedButton())
    await user.keyboard('[Enter]')
    expect(advancedButton().getAttribute('aria-expanded')).toBe('true')

    await user.click(screen.getByRole('switch', { name: 'Sustain' }))
    await user.keyboard('[Enter]')
    expect(settingsStore.get().sustain).toBe(true)
  })

  it('Labels: once an option is chosen the list lets go of the keyboard', async () => {
    const user = await startApp()
    const select = screen.getByRole('combobox', { name: 'Labels' })
    await user.selectOptions(select, 'Notes only')
    expect(settingsStore.get().labelMode).toBe('notes')
    await expectStraightBackToPlaying(user)
  })

  // The list was opened with a click, which puts the keyboard focus on it, and
  // closed again without a new choice. No value changed, yet the list must let
  // go of the keyboard, or the piano stays silent and a letter changes Labels.
  //
  // There is no drop-down list in this simulated browser, so the page is sent
  // what Chrome and Edge send it. While the list is open the key down goes to
  // the list and only the key up reaches the page. A pick in the list reaches
  // the page as a click that no mouse button made (its `detail` is 0), also
  // when the choice is the one already shown.
  it.each(['Escape', 'Enter'])(
    'Labels: closing the list with %s, without a new choice, gives the keyboard back to the piano',
    async (key) => {
      const user = await startApp()
      const select = screen.getByRole('combobox', { name: 'Labels' })
      await user.click(select)
      expect(document.activeElement).toBe(select)

      fireEvent.keyUp(select, { key, code: key })

      await expectStraightBackToPlaying(user)
      expect(settingsStore.get().labelMode).toBe('both')
    },
  )

  it('Labels: picking the choice it already shows gives the keyboard back to the piano', async () => {
    const user = await startApp()
    const select = screen.getByRole('combobox', { name: 'Labels' })
    await user.click(select)
    expect(document.activeElement).toBe(select)

    fireEvent.click(select, { detail: 0 })

    await expectStraightBackToPlaying(user)
    expect(settingsStore.get().labelMode).toBe('both')
  })
})

// ---------------------------------------------------------------------------
// Keyboard-only use. Space is the sustain key, so Tab and Enter must do.
// ---------------------------------------------------------------------------

/** What a control is called: its aria-label, or else its text without the decoration hidden from screen readers. */
function nameOf(element: Element | null): string {
  if (!element || element === document.body) return '(nothing)'
  const label = element.getAttribute('aria-label')
  if (label !== null) return label
  const copy = element.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return textOf(copy)
}

/** Presses Tab `times` times and returns the name of each control reached. */
async function tabThrough(user: User, times: number): Promise<string[]> {
  const names: string[] = []
  for (let step = 0; step < times; step += 1) {
    await user.tab()
    names.push(nameOf(document.activeElement))
  }
  return names
}

async function tabTo(user: User, target: HTMLElement): Promise<void> {
  for (let step = 0; step < 80 && document.activeElement !== target; step += 1) await user.tab()
  expect(document.activeElement).toBe(target)
}

describe('keyboard only', () => {
  const TOOLBAR_ORDER = [
    'Free Play',
    'Volume',
    'Sustain',
    'Lower',
    'Higher',
    'Labels',
    'Customize keys',
    'Advanced',
  ]

  it('Tab reaches every control in the order of the screen, and none of the 37 piano keys', async () => {
    const user = await startApp()
    expect(await tabThrough(user, TOOLBAR_ORDER.length)).toEqual(TOOLBAR_ORDER)
    expect(piano().querySelectorAll('[tabindex="0"]').length).toBe(0)
    // The modes that are not built are not tab stops.
    expect(screen.getByRole('tab', { name: /Practice/ }).tabIndex).toBe(-1)
    expect(screen.getByRole('tab', { name: /Real-time/ }).tabIndex).toBe(-1)
  })

  it('Tab goes on into the Advanced panel when it is open', async () => {
    const user = await startApp()
    await user.click(advancedButton())
    act(() => settingsStore.set({ transpose: 1 }))
    const names = await tabThrough(user, TOOLBAR_ORDER.length + 11)
    expect(names.slice(TOOLBAR_ORDER.length)).toEqual([
      'Touch',
      'Transpose down',
      'Transpose up',
      'C D E',
      'Do Ré Mi',
      'Room echo',
      'Short',
      'Normal',
      'Long',
      'Light trails',
      'Reset advanced settings',
    ])
  })

  // Enter is what works buttons and switches. Keyboard focus is never dropped
  // on the floor: a button that was pressed with Enter keeps it, so the player
  // can press it again or Tab on from there. (Only a click with the mouse
  // takes the focus off a button.)
  it('Enter presses the focused button, and the focus stays where the player is', async () => {
    const user = await startApp()

    const sustain = screen.getByRole('switch', { name: 'Sustain' })
    await tabTo(user, sustain)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(document.activeElement).toBe(sustain)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().sustain).toBe(false)

    const higher = screen.getByRole('button', { name: 'Higher' })
    await tabTo(user, higher)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().baseOctave).toBe(4)
    expect(document.activeElement).toBe(higher)

    await tabTo(user, advancedButton())
    await user.keyboard('[Enter]')
    expect(advancedButton().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(advancedButton())

    const up = within(advancedPanel()).getByRole('button', { name: 'Transpose up' })
    await tabTo(user, up)
    await user.keyboard('[Enter][Enter]')
    expect(settingsStore.get().transpose).toBe(2)
    expect(document.activeElement).toBe(up)

    const solfege = within(advancedPanel()).getByRole('button', { name: 'Do Ré Mi' })
    await tabTo(user, solfege)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().noteNaming).toBe('solfege')

    const long = within(advancedPanel()).getByRole('button', { name: 'Long' })
    await tabTo(user, long)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().release).toBe('long')

    const trails = within(advancedPanel()).getByRole('switch', { name: 'Light trails' })
    await tabTo(user, trails)
    await user.keyboard('[Enter]')
    expect(settingsStore.get().showTrails).toBe(false)
    expect(document.activeElement).toBe(trails)
  })

  it('the piano keeps playing while a button or a slider has the focus', async () => {
    const user = await startApp()
    for (const control of [
      screen.getByRole('slider', { name: 'Volume' }),
      screen.getByRole('switch', { name: 'Sustain' }),
      customizeButton(),
    ]) {
      await tabTo(user, control)
      await user.keyboard('[KeyA>]')
      expect(heldNotes()).toEqual([60])
      await user.keyboard('[/KeyA]')
      expect(heldNotes()).toEqual([])
    }
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(customizeButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('Space stays the sustain key while a button has the focus, and never presses that button', async () => {
    const user = await startApp()

    await tabTo(user, advancedButton())
    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(advancedButton().getAttribute('aria-expanded')).toBe('false')

    await tabTo(user, customizeButton())
    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(false)
    expect(customizeButton().getAttribute('aria-pressed')).toBe('false')

    // On the Sustain switch itself one tap is one change, not two that cancel out.
    const sustain = screen.getByRole('switch', { name: 'Sustain' })
    await tabTo(user, sustain)
    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(sustain.getAttribute('aria-checked')).toBe('true')
  })

  it('leaves to a focused slider the keys that move it', async () => {
    const user = await startApp()
    const slider = screen.getByRole('slider', { name: 'Volume' })
    await tabTo(user, slider)
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      // fireEvent returns false when something cancelled the key.
      expect(fireEvent.keyDown(slider, { code, key: code }), code).toBe(true)
    }
    expect(heldNotes()).toEqual([])
  })

  it('leaves to the focused Labels list every key, as a place where the player types', async () => {
    const user = await startApp()
    const select = screen.getByRole('combobox', { name: 'Labels' })
    await tabTo(user, select)
    for (const [code, key] of [
      ['ArrowDown', 'ArrowDown'],
      ['ArrowUp', 'ArrowUp'],
      ['Enter', 'Enter'],
      ['Space', ' '],
      ['KeyK', 'k'],
      ['KeyN', 'n'],
    ] as const) {
      expect(fireEvent.keyDown(select, { code, key }), code).toBe(true)
      fireEvent.keyUp(select, { code, key })
    }
    expect(heldNotes()).toEqual([])
    expect(settingsStore.get().sustain).toBe(false)
  })

  it('Tab is never swallowed while playing or while customizing with no piano key selected', async () => {
    const user = await startApp()
    await user.tab()
    expect(nameOf(document.activeElement)).toBe('Free Play')
    await user.tab({ shift: true })
    await tabTo(user, customizeButton())
    await user.keyboard('[Enter]')
    await user.tab()
    expect(nameOf(document.activeElement)).toBe('Advanced')
  })

  it('customizing works with the keyboard alone: Tab to a piano key, Enter, the new key, Escape', async () => {
    const user = await startApp()
    await tabTo(user, customizeButton())
    await user.keyboard('[Enter]')
    expect(customizeButton().getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(customizeButton())

    // While customizing, the piano keys are real tab stops, after the panel's own buttons.
    expect(await tabThrough(user, 4)).toEqual(['Advanced', 'Reset to default keys', 'Done', 'C3'])
    expect(piano().querySelectorAll('button[tabindex="0"]').length).toBe(37)

    const middleC = pianoKey('C4, key A')
    await tabTo(user, middleC)
    await user.keyboard('[Enter]')
    expect(textOf(keyEditorPanel())).toContain('Press a key for C4…')
    expect(middleC.getAttribute('aria-pressed')).toBe('true')

    await user.keyboard('[KeyZ]')
    expect(settingsStore.get().bindings.KeyZ).toBe(12)
    expect(within(keyEditorPanel()).getByRole('status').textContent).toContain('"Z" now plays C4.')
    // The player keeps their place on the piano and can go on to the next key.
    expect(document.activeElement).toBe(middleC)

    // On to the next key, which Escape lets go of again.
    await user.tab()
    await user.keyboard('[Enter]')
    expect(textOf(keyEditorPanel())).toContain('Press a key for C♯4…')
    await user.keyboard('[Escape]')
    expect(piano().querySelector('.is-selected')).toBeNull()

    await user.keyboard('[Escape]')
    expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()
    expect(piano().querySelectorAll('[tabindex="0"]').length).toBe(0)
    // A piano key must not keep the keyboard once customizing is over.
    expect(piano().contains(document.activeElement)).toBe(false)
  })

  // Space is the sustain key everywhere and never presses the button that has
  // the focus. While customizing, the piano keys are such buttons: Enter is
  // the key that selects one.
  it('Space stays the sustain key on a focused piano key while customizing, and does not select it', async () => {
    const user = await startApp()
    await tabTo(user, customizeButton())
    await user.keyboard('[Enter]')
    const middleC = pianoKey('C4, key A')
    await tabTo(user, middleC)

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(true)
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(textOf(keyEditorPanel())).not.toContain('Press a key for')
    expect(document.activeElement).toBe(middleC)

    await user.keyboard('[Space]')
    expect(settingsStore.get().sustain).toBe(false)
    expect(piano().querySelector('.is-selected')).toBeNull()
  })

  it.each(['Enter', 'Space'])(
    'the start overlay is one button, and %s on it starts the app once and does nothing else',
    async (code) => {
      const user = drawApp()
      // Tab is itself "any key", so the overlay only gets the focus from a
      // screen reader or a half-finished click.
      screen.getByRole('button', { name: new RegExp(START_TEXT) }).focus()

      await user.keyboard(`[${code}]`)

      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(audio.state.starts).toBe(1)
      expect(settingsStore.get().sustain).toBe(false)
      expect(document.activeElement).toBe(document.body)
    },
  )

  it('Tab is "any key" too: it starts the app instead of moving the focus', async () => {
    const user = drawApp()
    await user.tab()
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.activeElement).toBe(document.body)
    await user.tab()
    expect(nameOf(document.activeElement)).toBe('Free Play')
  })

  // With the keyboard, Enter on a reset button replaces the button with
  // "Really reset? Yes / No", and the answer puts the button back. Each time
  // the button that had the focus disappears: the focus must move on to the
  // sensible next control instead of falling back to the page.
  it('the reset question takes the keyboard focus, and gives it back when answered', async () => {
    const user = await startApp()
    await user.click(advancedButton())
    const panel = advancedPanel()
    const reset = within(panel).getByRole('button', { name: 'Reset advanced settings' })
    await tabTo(user, reset)

    await user.keyboard('[Enter]')
    expect(within(panel).getByText('Really reset?')).toBeTruthy()
    // The player is on the question (Yes or No), not thrown back to the top of the page.
    const question = within(panel).getByRole('group', { name: 'Reset advanced settings' })
    expect(question.contains(document.activeElement)).toBe(true)

    const no = within(panel).getByRole('button', { name: 'No' })
    no.focus()
    await user.keyboard('[Enter]')
    expect(within(panel).queryByText('Really reset?')).toBeNull()
    expect(document.activeElement).toBe(
      within(panel).getByRole('button', { name: 'Reset advanced settings' }),
    )
  })

  // "Done" disappears with its panel, and the focus must not disappear with it.
  it('Enter on "Done" does not drop the keyboard focus on the floor', async () => {
    const user = await startApp()
    await tabTo(user, customizeButton())
    await user.keyboard('[Enter]')
    const done = within(keyEditorPanel()).getByRole('button', { name: 'Done' })
    await tabTo(user, done)

    await user.keyboard('[Enter]')

    expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()
    // The player should be somewhere sensible (the Customize keys button that
    // opened the panel), not back at the top of the page.
    expect(document.activeElement).not.toBe(document.body)
    expect(toolbar().contains(document.activeElement)).toBe(true)
  })

  // Escape leaves customizing. A piano key that had the focus is then no
  // longer a tab stop, and the focus must not be lost with it either.
  it('Escape on a focused piano key leaves customizing without dropping the keyboard focus on the floor', async () => {
    const user = await startApp()
    await tabTo(user, customizeButton())
    await user.keyboard('[Enter]')
    await tabTo(user, pianoKey('C4, key A'))

    await user.keyboard('[Escape]')

    expect(screen.queryByRole('region', { name: 'Customize keys' })).toBeNull()
    expect(piano().contains(document.activeElement)).toBe(false)
    expect(document.activeElement).not.toBe(document.body)
    expect(toolbar().contains(document.activeElement)).toBe(true)

    // And the piano plays again at once.
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
  })
})

// ---------------------------------------------------------------------------
// What a screen reader is told
// ---------------------------------------------------------------------------

/** Opens everything there is to open, so the whole screen is in the page at once. */
async function openEverything(user: User): Promise<void> {
  await user.click(advancedButton())
  act(() => settingsStore.set({ transpose: 2 }))
  await user.click(within(advancedPanel()).getByRole('button', { name: 'Reset advanced settings' }))
  await user.click(customizeButton())
  await user.click(
    within(keyEditorPanel()).getByRole('button', { name: 'Reset to default keys' }),
  )
  await user.click(pianoKey('C4, key A'))
  await user.keyboard('[Enter]')
}

describe('ARIA', () => {
  it('every id is unique and every aria reference points at something on the page', async () => {
    audio.state.startsAs = 'loading'
    const user = await startApp()
    await openEverything(user)

    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        for (const id of (element.getAttribute(attribute) ?? '').split(/\s+/)) {
          expect(document.getElementById(id), `${attribute}="${id}"`).not.toBeNull()
        }
      }
    }
  })

  it('every button, switch, slider and list has a name', async () => {
    const user = await startApp()
    await openEverything(user)
    const controls = document.querySelectorAll('button, input, select, [role="switch"], [role="tab"]')
    expect(controls.length).toBeGreaterThan(50)
    for (const control of controls) {
      expect(nameOf(control).length, control.outerHTML.slice(0, 80)).toBeGreaterThan(0)
    }
  })

  it('names buttons by their word alone: the arrows, the speaker and the chevron are decoration', async () => {
    await startApp()
    expect(within(toolbar()).getByRole('button', { name: 'Lower' })).toBeTruthy()
    expect(within(toolbar()).getByRole('button', { name: 'Higher' })).toBeTruthy()
    expect(within(toolbar()).getByRole('button', { name: 'Advanced' })).toBeTruthy()
    for (const glyph of ['🔊', '◀', '▶', '▾']) {
      const holder = [...toolbar().querySelectorAll('span')].find(
        (span) => span.children.length === 0 && (span.textContent ?? '').includes(glyph),
      )
      expect(holder?.getAttribute('aria-hidden'), glyph).toBe('true')
    }
  })

  it('groups each control with its visible label and its explanation', async () => {
    const user = await startApp()
    await user.click(advancedButton())
    const groups = [...document.querySelectorAll<HTMLElement>('.field')]
    expect(groups.length).toBe(10)
    for (const group of groups) {
      expect(group.getAttribute('role')).toBe('group')
      const label = document.getElementById(group.getAttribute('aria-labelledby') ?? '')
      expect(label?.textContent).toBe(group.querySelector('.field__label')?.textContent)
      const hint = group.querySelector('.field__hint')
      if (hint) {
        expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')).toBe(hint)
      }
    }
  })

  it('says what a slider is set to in percent', async () => {
    const user = await startApp()
    await user.click(advancedButton())
    const values = screen
      .getAllByRole('slider')
      .map((slider) => `${slider.getAttribute('aria-label')}: ${slider.getAttribute('aria-valuetext')}`)
    expect(values).toEqual(['Volume: 80%', 'Touch: 80%', 'Room echo: 15%'])
  })

  it('makes the piano one named group whose keys say their note, their computer key and whether they are down', async () => {
    const user = await startApp()
    expect(piano().getAttribute('aria-label')).toBe('Piano')
    const keys = [...piano().querySelectorAll('.piano-key')]
    expect(keys.length).toBe(37)
    expect(keys[0]?.getAttribute('aria-label')).toBe('C3')
    expect(keys[12]?.getAttribute('aria-label')).toBe('C4, key A')
    expect(keys[36]?.getAttribute('aria-label')).toBe('C6')
    for (const key of keys) expect(key.getAttribute('aria-pressed')).toBe('false')

    await user.keyboard('[KeyA>]')
    expect(keys[12]?.getAttribute('aria-pressed')).toBe('true')
    await user.keyboard('[/KeyA]')
  })

  it('keeps the two message lines on the page while they are empty, as live regions', async () => {
    const user = await startApp()
    const sound = within(footer()).getByRole('status')
    expect(sound.textContent).toBe('')

    await user.click(customizeButton())
    const result = within(keyEditorPanel()).getByRole('status')
    expect(result.textContent).toBe('')

    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[Enter]')
    // The same element gets the text: that is what makes a screen reader speak it.
    expect(within(keyEditorPanel()).getByRole('status')).toBe(result)
    expect(result.textContent).toMatch(/^That key can't be used/)
  })

  it('names the reset question after what it resets', async () => {
    const user = await startApp()
    await user.click(advancedButton())
    await user.click(within(advancedPanel()).getByRole('button', { name: 'Reset advanced settings' }))
    const question = within(advancedPanel()).getByRole('group', { name: 'Reset advanced settings' })
    expect(textOf(question)).toBe('Really reset?YesNo')
  })

  // Once a piano key is selected every key press belongs to the editor, Tab
  // included. A screen-reader user who selected the key with Enter must be
  // told what is asked for and that Esc gets out, or they are stuck.
  //
  // A screen reader speaks text that changes inside a live region it already
  // knows. So both lines have to be polite live regions that are on the page
  // before the key is selected. (A description added to the key itself would
  // not do: it is not read out for the element that already has the focus.)
  it('tells a screen reader what to do once a piano key is selected', async () => {
    const user = await startApp()
    await tabTo(user, customizeButton())
    await user.keyboard('[Enter]')
    const liveRegions = new Set<Element>(keyEditorPanel().querySelectorAll('[aria-live="polite"]'))

    await tabTo(user, pianoKey('C4, key A'))
    await user.keyboard('[Enter]')

    const prompt = within(keyEditorPanel()).getByText('Press a key for C4…')
    const wayOut = within(keyEditorPanel()).getByText('Esc = cancel · Backspace = remove this key')
    for (const line of [prompt, wayOut]) {
      const region = line.closest('[aria-live="polite"]')
      expect(region, textOf(line)).not.toBeNull()
      expect(region !== null && liveRegions.has(region), textOf(line)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** Everything a player can read or be told by a screen reader, on the whole page. */
function everyWordOnThePage(): string {
  const parts: string[] = [document.body.textContent ?? '']
  for (const attribute of ['aria-label', 'aria-valuetext', 'title', 'placeholder', 'alt']) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      parts.push(element.getAttribute(attribute) ?? '')
    }
  }
  return parts.join(' \n ')
}

/**
 * The words the spec keeps away from the player: "MIDI", "binding" (in any
 * of its forms), "slot" and "octave shift".
 */
const JARGON = [/midi/i, /\bbind/i, /\bbound\b/i, /\bslots?\b/i, /octave shift/i]

describe('wording', () => {
  it('uses no jargon anywhere, with every panel open', async () => {
    audio.state.startsAs = 'fallback'
    const user = await startApp()
    await openEverything(user)
    const words = everyWordOnThePage()
    for (const jargon of JARGON) expect(words).not.toMatch(jargon)
  })

  it('uses no jargon in the messages of the key editor either', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    const messages: string[] = []
    const read = (): void => {
      messages.push(within(keyEditorPanel()).getByRole('status').textContent ?? '')
    }
    await user.click(pianoKey('C4, key A'))
    await user.keyboard('[KeyK]')
    read()
    await user.click(pianoKey('D4, key S'))
    await user.keyboard('[Delete]')
    read()
    await user.click(within(keyEditorPanel()).getByRole('button', { name: 'Reset to default keys' }))
    await user.click(within(keyEditorPanel()).getByRole('button', { name: 'Yes' }))
    read()
    expect(messages[0]).toBe('"K" now plays C4. "A" no longer plays a note. C5 has no key now.')
    expect(messages[1]).toBe('D4 has no key now.')
    expect(messages[2]?.length).toBeGreaterThan(0)
    for (const message of messages) {
      for (const jargon of JARGON) expect(message).not.toMatch(jargon)
    }
  })

  it('shows the same words in the same places whatever is open (nothing renames itself)', async () => {
    const user = await startApp()
    const before = [...toolbar().querySelectorAll('button, .field__label')].map((element) =>
      nameOf(element),
    )
    await user.click(advancedButton())
    await user.click(customizeButton())
    const after = [...toolbar().querySelectorAll('button, .field__label')].map((element) =>
      nameOf(element),
    )
    expect(after).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// Nothing gets stuck, nothing is lost
// ---------------------------------------------------------------------------

describe('no stuck notes and no lost settings', () => {
  it('plays each key press exactly once (the app is drawn twice in development)', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA][KeyS]')
    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([
      'on:60:0.8',
      'on:62:0.8',
    ])
    expect(audio.state.calls.filter((call) => call.startsWith('off:'))).toEqual(['off:60', 'off:62'])
  })

  it('lets go of a held note when Customize keys is opened, and when a piano key is selected', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')
    await user.click(customizeButton())
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')

    await user.keyboard('[KeyS>]')
    expect(heldNotes()).toEqual([62])
    await user.click(pianoKey('C4, key A'))
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyS]')
    expect(heldNotes()).toEqual([])
    // Letting go of S was not "the next key press": C4 still waits for its key.
    expect(pianoKey('C4, key A').classList.contains('is-selected')).toBe(true)
  })

  it('lets go of held notes when the page is hidden, left, or loses the keyboard', async () => {
    const user = await startApp()

    await user.keyboard('[KeyA>]')
    fireEvent(window, new Event('blur'))
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')

    await user.keyboard('[KeyA>]')
    fireEvent(window, new Event('pagehide'))
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')

    await user.keyboard('[KeyA>]')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    visibility.mockRestore()
    expect(heldNotes()).toEqual([])
    await user.keyboard('[/KeyA]')
    expect(textOf(nowPlayingLine())).toBe(HINT_TEXT)
  })

  it('lets go of held notes when the app goes away', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>][KeyD>]')
    expect(heldNotes()).toEqual([60, 64])
    cleanup()
    expect(heldNotes()).toEqual([])
    expect(audio.state.calls).toContain('off:60')
    expect(audio.state.calls).toContain('off:64')
  })

  it('what the player changed on the screen is what a reload would find', async () => {
    const { createSettingsStore } = await import('./state/settings')
    const user = await startApp()

    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '55' } })
    await user.keyboard('[Space]')
    await user.click(screen.getByRole('button', { name: 'Lower' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Labels' }), 'Keys only')
    const panel = await openAdvanced(user)
    fireEvent.change(within(panel).getByRole('slider', { name: 'Touch' }), { target: { value: '60' } })
    await user.click(within(panel).getByRole('button', { name: 'Transpose down' }))
    await user.click(within(panel).getByRole('button', { name: 'Do Ré Mi' }))
    fireEvent.change(within(panel).getByRole('slider', { name: 'Room echo' }), { target: { value: '0' } })
    await user.click(within(panel).getByRole('button', { name: 'Short' }))
    await user.click(within(panel).getByRole('switch', { name: 'Light trails' }))
    await user.click(customizeButton())
    await user.click(pianoKey('Do2'))
    await user.keyboard('[KeyZ]')

    const expected: Settings = {
      ...DEFAULT_SETTINGS,
      volume: 0.55,
      sustain: true,
      baseOctave: 2,
      labelMode: 'keys',
      velocity: 0.6,
      transpose: -1,
      noteNaming: 'solfege',
      reverb: 0,
      release: 'short',
      showTrails: false,
      bindings: { ...DEFAULT_BINDINGS, KeyZ: 0 },
      customLabels: { KeyZ: 'Z' },
    }
    expect(settingsStore.get()).toEqual(expected)
    // A fresh store over the same storage is what the next visit starts from.
    expect(createSettingsStore(window.localStorage).get()).toEqual(expected)
  })

  it('applies the saved settings to the sound and the screen when the app is first drawn', async () => {
    act(() =>
      settingsStore.set({
        volume: 0.3,
        sustain: true,
        transpose: 4,
        reverb: 0.5,
        release: 'long',
        labelMode: 'notes',
        baseOctave: 4,
      }),
    )
    audio.state.calls.length = 0
    drawApp()

    for (const call of ['volume:0.3', 'sustain:true', 'transpose:4', 'reverb:0.5', 'release:2.5']) {
      expect(audio.state.calls).toContain(call)
    }
    expect(within(toolbar()).getByText('30%')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Sustain' }).getAttribute('aria-checked')).toBe('true')
    expect(within(toolbar()).getByText('C4 – C7')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Labels' }) as HTMLSelectElement).value).toBe('notes')
    expect(within(nowPlayingLine()).getByText('Transposed +4')).toBeTruthy()
    // The Advanced panel stays closed even though some of its settings are not the default.
    expect(advancedButton().getAttribute('aria-expanded')).toBe('false')
  })
})

// ---------------------------------------------------------------------------
// The mouse on the piano, as the hint promises ("or click it")
// ---------------------------------------------------------------------------

/** jsdom lays nothing out, so the piano is told where it is: 1100 x 200 at the top left. */
function placePiano(): HTMLElement {
  const box = piano()
  box.getBoundingClientRect = () => new DOMRect(0, 0, 1100, 200)
  return box
}

describe('the mouse on the piano', () => {
  const LOWEST_KEY = { pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: 190 }

  it('a press plays the key under it, as hard as Touch says, and letting go stops it', async () => {
    await startApp()
    act(() => settingsStore.set({ velocity: 0.5 }))
    const box = placePiano()

    fireEvent.pointerDown(box, { ...LOWEST_KEY, button: 0, buttons: 1 })
    expect(heldNotes()).toEqual([48])
    expect(textOf(nowPlayingLine())).toBe('C3')
    expect(pianoKey('C3').classList.contains('is-lit')).toBe(true)
    expect(audio.state.calls).toContain('on:48:0.5')

    fireEvent.pointerUp(box, { ...LOWEST_KEY, button: 0, buttons: 0 })
    expect(heldNotes()).toEqual([])
    expect(textOf(nowPlayingLine())).toBe(HINT_TEXT)
    expect(audio.state.calls).toContain('off:48')
  })

  it('plays nothing while customizing, where a click chooses the key to change', async () => {
    const user = await startApp()
    await user.click(customizeButton())
    const box = placePiano()

    fireEvent.pointerDown(box, { ...LOWEST_KEY, button: 0, buttons: 1 })
    fireEvent.pointerUp(box, { ...LOWEST_KEY, button: 0, buttons: 0 })
    await user.click(pianoKey('C3'))

    expect(audio.state.calls.filter((call) => call.startsWith('on:'))).toEqual([])
    expect(textOf(keyEditorPanel())).toContain('Press a key for C3…')
  })

  it('takes the keyboard away from the Labels list, so the keys play again', async () => {
    const user = await startApp()
    const select = screen.getByRole('combobox', { name: 'Labels' })
    await user.click(select)
    expect(document.activeElement).toBe(select)

    const box = placePiano()
    fireEvent.pointerDown(box, { ...LOWEST_KEY, button: 0, buttons: 1 })
    fireEvent.pointerUp(box, { ...LOWEST_KEY, button: 0, buttons: 0 })

    expect(document.activeElement).toBe(document.body)
    await user.keyboard('[KeyA>]')
    expect(heldNotes()).toEqual([60])
    await user.keyboard('[/KeyA]')
  })
})

// ---------------------------------------------------------------------------
// "Customize keys" is where the computer keys are changed, so while it is open
// the piano always shows them, whatever the Labels choice is for playing. The
// choice itself is not changed.
// ---------------------------------------------------------------------------

describe('Customize keys while the key labels are switched off', () => {
  it.each([
    ['No labels', 'none', false],
    ['Notes only', 'notes', true],
  ] as const)(
    'shows the computer keys on the piano while customizing, even with "%s" chosen for playing',
    async (_name, mode, noteNames) => {
      const user = await startApp()
      act(() => settingsStore.set({ labelMode: mode }))
      expect(piano().querySelectorAll('.piano-key__cap').length).toBe(0)

      await user.click(customizeButton())
      // 18 piano keys have a computer key by default: the player must see them to change them.
      const caps = [...piano().querySelectorAll('.piano-key__cap')].map((cap) => cap.textContent)
      expect(caps).toHaveLength(18)
      expect(caps).toContain('A')
      // Only the computer keys are added: the note names are shown, or not, as the player chose.
      expect(piano().querySelectorAll('.piano-key__note').length > 0).toBe(noteNames)
      // The choice itself stays as it was, on the screen and in what is saved.
      expect((screen.getByRole('combobox', { name: 'Labels' }) as HTMLSelectElement).value).toBe(mode)
      expect(settingsStore.get().labelMode).toBe(mode)
      expect(saved().labelMode).toBe(mode)

      await user.click(within(keyEditorPanel()).getByRole('button', { name: 'Done' }))
      // Back to playing: the labels are as the player chose them.
      expect(settingsStore.get().labelMode).toBe(mode)
      expect(piano().querySelectorAll('.piano-key__cap').length).toBe(0)
    },
  )
})
