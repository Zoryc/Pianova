// @vitest-environment jsdom
/**
 * The Settings panel inside the whole app: every option of the Sound, Look
 * and About tabs against what is saved, what the sound engine is told and
 * what the screen shows, in both directions (the player changes the control;
 * the saved value changes under the app, as when another tab saves).
 *
 * Also here: Space, which stays the sustain key wherever the focus is; where
 * the focus goes after a click; "Reset all settings"; storage that is full;
 * and what a drag through the colour picker costs.
 *
 * The sound engine and the sky are stand-ins that record what they are told.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkyProps } from './ui/sky/Sky'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle' }
  const engine = {
    start: vi.fn((): Promise<void> => {
      state.status = 'ready'
      for (const listener of [...listeners]) listener()
      return Promise.resolve()
    }),
    getStatus: () => state.status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    setSustain: vi.fn(),
    setVolume: vi.fn(),
    setTranspose: vi.fn(),
    setReverb: vi.fn(),
    setRelease: vi.fn(),
    allNotesOff: vi.fn(),
    dispose: vi.fn(),
  }
  return { engine, state }
})

/**
 * What the stand-in sky was last given, how many times it was drawn, and the
 * colour of the player it was given each time.
 */
const sky = vi.hoisted(() => ({ props: null as unknown, draws: 0, colours: [] as string[] }))

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

vi.mock('./ui/sky/Sky', async () => {
  const { createElement } = await import('react')
  return {
    Sky(props: { customColour: string }) {
      sky.props = props
      sky.draws += 1
      sky.colours.push(props.customColour)
      return createElement('canvas', { className: 'sky' })
    },
  }
})

import { App } from './App'
import { bus } from './app/pianoApp'
import { songLibrary } from './app/songsApp'
import { RELEASE_SECONDS } from './audio/audioEngine'
import { DEFAULT_BINDINGS } from './input/keymap'
import { DEFAULT_SETTINGS, STORAGE_KEY, settingsStore } from './state/settings'
import type { Settings } from './state/settings'
import { addSong, resetSongs } from './ui/songsTestKit'
import { AUTO_HIDE_DELAY_MS } from './ui/useAutoHide'

function skyProps(): SkyProps {
  return sky.props as SkyProps
}

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  vi.clearAllMocks()
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  bus.allOff()
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

function tap(code: string): void {
  key('keydown', code)
  key('keyup', code)
}

/** A click with the mouse: the control has the focus when the click arrives. */
function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
}

/** Enter on a focused control: the browser sends a click that no mouse button made. */
function pressEnterOn(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 0 })
}

/** Draws the app and gets past the start overlay. */
function startApp(): void {
  render(<App />)
  tap('Enter')
}

function root(): HTMLElement {
  return document.querySelector('.app') as HTMLElement
}

function menu(): HTMLElement {
  return document.querySelector('.menu') as HTMLElement
}

function settingsPanel(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Settings' })
}

/** Opens Settings on one of its tabs. (The panel remembers its last tab from test to test.) */
function openSettingsOn(tab: string): HTMLElement {
  if (!screen.queryByRole('dialog', { name: 'Settings' })) {
    clickWithMouse(screen.getByRole('button', { name: 'Settings' }))
  }
  clickWithMouse(within(settingsPanel()).getByRole('tab', { name: tab }))
  return settingsPanel()
}

function tabNamed(name: string): HTMLElement {
  return within(settingsPanel()).getByRole('tab', { name })
}

function shownTab(): string {
  const shown = within(settingsPanel())
    .getAllByRole('tab')
    .filter((tab) => tab.getAttribute('aria-selected') === 'true')
  return shown.map((tab) => tab.textContent).join(',')
}

/** The row of one option of the open tab, found by its name. */
function option(name: string): HTMLElement {
  return within(settingsPanel()).getByRole('group', { name })
}

function sliderOf(name: string): HTMLInputElement {
  return within(option(name)).getByRole('slider') as HTMLInputElement
}

function switchOf(name: string): HTMLElement {
  return within(option(name)).getByRole('switch')
}

function choice(optionName: string, name: string): HTMLElement {
  return within(option(optionName)).getByRole('button', { name })
}

function isOn(control: HTMLElement): boolean {
  return control.getAttribute('aria-checked') === 'true'
}

function isPressed(control: HTMLElement): boolean {
  return control.getAttribute('aria-pressed') === 'true'
}

function slide(slider: HTMLInputElement, percent: number): void {
  fireEvent.change(slider, { target: { value: String(percent) } })
}

function swatch(name: string): HTMLElement {
  return within(settingsPanel()).getByRole('radio', { name })
}

function colourPicker(): HTMLInputElement {
  return settingsPanel().querySelector('input[type="color"]') as HTMLInputElement
}

function themeCard(name: string): HTMLElement {
  return within(option('Theme')).getByRole('button', { name })
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

function light(name: string): string {
  return root().style.getPropertyValue(name)
}

/** The small quiet badges the stage shows next to the sound status, left to right. */
function stageBadges(): string[] {
  return [...document.querySelectorAll('.stage__badge')].map((badge) => badge.textContent ?? '')
}

/** What the About tab says about "Reset all settings" once it is done ('' until then). */
function resetReport(): string {
  return within(settingsPanel()).getByRole('status').textContent ?? ''
}

const RESET_DONE = 'Everything is back to how it was at the start.'

/** The whole settings as another tab of the browser would leave them in storage. */
function saveFromAnotherTab(changes: Partial<Settings> | null): void {
  if (changes === null) window.localStorage.removeItem(STORAGE_KEY)
  else window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settingsStore.get(), ...changes }))
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
  })
}

describe('the sound follows the settings', () => {
  it('is told every saved sound setting as soon as the app is drawn', () => {
    settingsStore.set({ volume: 0.3, sustain: true, transpose: -2, reverb: 0.5, release: 'long' })
    render(<App />)

    expect(audio.engine.setVolume).toHaveBeenLastCalledWith(0.3)
    expect(audio.engine.setSustain).toHaveBeenLastCalledWith(true)
    expect(audio.engine.setTranspose).toHaveBeenLastCalledWith(-2)
    expect(audio.engine.setReverb).toHaveBeenLastCalledWith(0.5)
    expect(audio.engine.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS.long)
  })

  it('follows every control of the Sound tab', () => {
    startApp()
    openSettingsOn('Sound')

    slide(sliderOf('Volume'), 45)
    expect(audio.engine.setVolume).toHaveBeenLastCalledWith(0.45)

    clickWithMouse(switchOf('Sustain'))
    expect(audio.engine.setSustain).toHaveBeenLastCalledWith(true)

    slide(sliderOf('Room echo'), 0)
    expect(audio.engine.setReverb).toHaveBeenLastCalledWith(0)

    clickWithMouse(choice('Note fade-out', 'Short'))
    expect(audio.engine.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS.short)

    clickWithMouse(choice('Transpose', 'Transpose up'))
    clickWithMouse(choice('Transpose', 'Transpose up'))
    expect(audio.engine.setTranspose).toHaveBeenLastCalledWith(2)
    // The stage says so too, and that sustain is on, for when the panel and the menu are away.
    expect(stageBadges()).toEqual(['Transposed +2', 'Sustain on'])
  })

  it('plays the next note as hard as Touch says, down to its lowest', () => {
    startApp()
    openSettingsOn('Sound')

    slide(sliderOf('Touch'), 40)
    tap('KeyA')
    expect(audio.engine.noteOn).toHaveBeenLastCalledWith(60, 0.4)

    // Below what the slider reaches: the lowest it has, never silence.
    slide(sliderOf('Touch'), 0)
    tap('KeyA')
    expect(audio.engine.noteOn).toHaveBeenLastCalledWith(60, 0.1)
    expect(sliderOf('Touch').value).toBe('10')
  })

  it('does not tell the engine again about what did not change', () => {
    startApp()
    openSettingsOn('Sound')
    vi.clearAllMocks()

    slide(sliderOf('Volume'), 45)

    expect(audio.engine.setVolume).toHaveBeenCalledTimes(1)
    expect(audio.engine.setSustain).not.toHaveBeenCalled()
    expect(audio.engine.setTranspose).not.toHaveBeenCalled()
    expect(audio.engine.setReverb).not.toHaveBeenCalled()
    expect(audio.engine.setRelease).not.toHaveBeenCalled()
  })

  it('follows what another tab of the browser saved, and shows it on the controls', () => {
    startApp()
    openSettingsOn('Sound')

    saveFromAnotherTab({ volume: 0.2, sustain: true, transpose: 5, reverb: 1, release: 'long' })

    expect(audio.engine.setVolume).toHaveBeenLastCalledWith(0.2)
    expect(audio.engine.setSustain).toHaveBeenLastCalledWith(true)
    expect(audio.engine.setTranspose).toHaveBeenLastCalledWith(5)
    expect(audio.engine.setReverb).toHaveBeenLastCalledWith(1)
    expect(audio.engine.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS.long)

    expect(sliderOf('Volume').value).toBe('20')
    expect(isOn(switchOf('Sustain'))).toBe(true)
    expect(sliderOf('Room echo').value).toBe('100')
    expect(isPressed(choice('Note fade-out', 'Long'))).toBe(true)
    expect(within(option('Transpose')).getByRole('status').textContent).toBe('+5')
  })

  it('keeps the two volume sliders and the two sustain switches saying the same', () => {
    startApp()
    openSettingsOn('Sound')
    const barVolume = within(menu()).getByRole('slider', { name: 'Volume' }) as HTMLInputElement
    const barSustain = within(menu()).getByRole('switch', { name: 'Sustain' })

    slide(sliderOf('Volume'), 12)
    expect(barVolume.value).toBe('12')
    slide(barVolume, 77)
    expect(sliderOf('Volume').value).toBe('77')
    expect(sliderOf('Volume').getAttribute('aria-valuetext')).toBe('77%')

    clickWithMouse(switchOf('Sustain'))
    expect(isOn(barSustain)).toBe(true)
    clickWithMouse(barSustain)
    expect(isOn(switchOf('Sustain'))).toBe(false)

    tap('Space')
    expect(isOn(barSustain)).toBe(true)
    expect(isOn(switchOf('Sustain'))).toBe(true)
    expect(switchOf('Sustain').textContent).toBe('On')
  })

  it('stops at an octave either way however fast the buttons are clicked', () => {
    startApp()
    openSettingsOn('Sound')
    const up = choice('Transpose', 'Transpose up') as HTMLButtonElement
    const down = choice('Transpose', 'Transpose down') as HTMLButtonElement

    for (let click = 0; click < 30; click += 1) fireEvent.click(up, { detail: 1 })
    expect(settingsStore.get().transpose).toBe(12)
    expect(up.disabled).toBe(true)
    expect(audio.engine.setTranspose).toHaveBeenLastCalledWith(12)

    for (let click = 0; click < 60; click += 1) fireEvent.click(down, { detail: 1 })
    expect(settingsStore.get().transpose).toBe(-12)
    expect(down.disabled).toBe(true)
    expect(within(option('Transpose')).getByRole('status').textContent).toBe('−12')
  })
})

describe('the screen follows the look', () => {
  it('has no glow at all at 0% and the full glow at 100%', () => {
    startApp()
    openSettingsOn('Look')

    slide(sliderOf('Glow'), 0)
    expect(settingsStore.get().glow).toBe(0)
    expect(light('--glow')).toBe('0')
    expect(skyProps().glow).toBe(0)
    expect(sliderOf('Glow').getAttribute('aria-valuetext')).toBe('0%')

    slide(sliderOf('Glow'), 100)
    expect(settingsStore.get().glow).toBe(1)
    expect(light('--glow')).toBe('1')
    expect(skyProps().glow).toBe(1)
  })

  it('gives the sky every option of the Look tab', () => {
    startApp()
    openSettingsOn('Look')

    clickWithMouse(choice('Background', 'Stars'))
    clickWithMouse(choice('Bar style', 'Neon'))
    clickWithMouse(choice('Sparks', 'Lots'))
    clickWithMouse(switchOf('Light bars'))
    clickWithMouse(swatch('Green'))

    expect(skyProps()).toMatchObject({
      background: 'stars',
      barStyle: 'neon',
      sparks: 'lots',
      showBars: false,
      accent: 'green',
    })
    expect(light('--light')).toBe('#2bd96b')
  })

  it('takes a whole theme at one click: the light, the sky and the keys', () => {
    startApp()
    openSettingsOn('Look')

    clickWithMouse(themeCard('Aurora'))

    expect(isPressed(themeCard('Aurora'))).toBe(true)
    expect(isPressed(themeCard('Ember'))).toBe(false)
    expect(light('--light')).toBe('#a45cff')
    expect(light('--glow')).toBe('0.8')
    expect(piano().getAttribute('data-key-style')).toBe('glass')
    expect(skyProps()).toMatchObject({ background: 'aurora', barStyle: 'neon', sparks: 'some' })
    expect(swatch('Purple').getAttribute('aria-checked')).toBe('true')
    expect(sliderOf('Glow').value).toBe('80')
    expect(isPressed(choice('Background', 'Aurora'))).toBe(true)
  })

  it('leaves "Your colour" as the player made it when a theme is tried', () => {
    startApp()
    openSettingsOn('Look')
    fireEvent.change(colourPicker(), { target: { value: '#ff66cc' } })
    expect(light('--light')).toBe('#ff66cc')

    clickWithMouse(themeCard('Midnight'))
    expect(light('--light')).toBe('#2f8bff')
    expect(skyProps()).toMatchObject({ accent: 'blue', customColour: '#ff66cc' })

    // Back to the colour of the player: it is the one they made, not the blue of the theme.
    clickWithMouse(swatch('Your colour'))
    expect(light('--light')).toBe('#ff66cc')
    expect(isPressed(themeCard('Midnight'))).toBe(false)
    expect(option('Theme').textContent).toContain('Custom')
  })

  it('marks the theme another tab of the browser chose', () => {
    startApp()
    openSettingsOn('Look')

    saveFromAnotherTab({
      accent: 'white',
      background: 'black',
      barStyle: 'neon',
      sparks: 'off',
      keyStyle: 'midnight',
      glow: 0.4,
    })

    expect(isPressed(themeCard('Mono'))).toBe(true)
    expect(light('--light')).toBe('#e8ecff')
    expect(light('--light-ink')).toBe('#000000')
    expect(piano().getAttribute('data-key-style')).toBe('midnight')
  })

  it('writes what is on a control filled with the light in black or white, whichever reads', () => {
    startApp()
    openSettingsOn('Look')

    for (const [colour, ink] of [
      ['#ffffff', '#000000'],
      ['#ffff00', '#000000'],
      ['#000000', '#ffffff'],
      ['#00007f', '#ffffff'],
      ['#7f0000', '#ffffff'],
    ] as const) {
      fireEvent.change(colourPicker(), { target: { value: colour } })
      expect(light('--light-ink'), `ink on ${colour}`).toBe(ink)
    }
  })

  it('stops writing the names of the notes above the piano when that is switched off', () => {
    startApp()
    openSettingsOn('Look')

    key('keydown', 'KeyA')
    expect(screen.getByRole('list', { name: 'Notes being played' }).textContent).toBe('C4')

    clickWithMouse(switchOf('Show the notes being played'))
    expect(screen.queryByRole('list', { name: 'Notes being played' })).toBeNull()
    key('keyup', 'KeyA')
  })

  it('keeps the menu on screen once "Hide the menu automatically" is off, and hides it again when it is back on', () => {
    vi.useFakeTimers()
    startApp()
    openSettingsOn('Look')

    clickWithMouse(switchOf('Hide the menu automatically'))
    tap('Escape')
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 4)
    })
    expect(menu().classList.contains('menu--hidden')).toBe(false)
    expect(document.querySelector('.stage')?.classList.contains('stage--below-menu')).toBe(true)

    act(() => settingsStore.set({ autoHideMenu: true }))
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS + 100)
    })
    expect(menu().classList.contains('menu--hidden')).toBe(true)
    expect(document.querySelector('.stage')?.classList.contains('stage--below-menu')).toBe(false)
  })

  it('takes the letters off the falling notes when that is switched off, and puts them back', () => {
    startApp()
    openSettingsOn('Look')
    expect(skyProps().hints.size).toBe(Object.keys(DEFAULT_BINDINGS).length)

    clickWithMouse(switchOf('Key letters on falling notes'))
    expect(skyProps().hints.size).toBe(0)

    clickWithMouse(switchOf('Key letters on falling notes'))
    expect(skyProps().hints.get(60)).toBe('A')
  })
})

describe('Space is the sustain key, wherever the keyboard focus is in Settings', () => {
  /** Puts the focus on a control and presses Space the way a keyboard does. */
  async function pressSpaceOn(control: HTMLElement): Promise<void> {
    const user = userEvent.setup()
    control.focus()
    expect(document.activeElement).toBe(control)
    await user.keyboard('[Space]')
  }

  it('on a tab: sustain changes, the tab does not', async () => {
    startApp()
    openSettingsOn('Sound')

    await pressSpaceOn(tabNamed('Look'))

    expect(settingsStore.get().sustain).toBe(true)
    expect(shownTab()).toBe('Sound')
  })

  it('on a switch of the Look tab: sustain changes, the switch does not', async () => {
    startApp()
    openSettingsOn('Look')

    await pressSpaceOn(switchOf('Light bars'))

    expect(settingsStore.get().sustain).toBe(true)
    expect(settingsStore.get().showTrails).toBe(true)
  })

  it('on the Sustain switch itself: one tap changes it once, not twice', async () => {
    startApp()
    openSettingsOn('Sound')

    await pressSpaceOn(switchOf('Sustain'))
    expect(settingsStore.get().sustain).toBe(true)
    expect(isOn(switchOf('Sustain'))).toBe(true)

    await pressSpaceOn(switchOf('Sustain'))
    expect(settingsStore.get().sustain).toBe(false)
  })

  it('on a theme card, a colour, a choice and a slider: nothing but sustain changes', async () => {
    startApp()
    openSettingsOn('Look')

    await pressSpaceOn(themeCard('Gold'))
    await pressSpaceOn(swatch('Blue'))
    await pressSpaceOn(choice('Background', 'Night'))
    await pressSpaceOn(sliderOf('Glow'))

    expect(settingsStore.get()).toEqual({ ...DEFAULT_SETTINGS, sustain: false })
    expect(audio.engine.setSustain).toHaveBeenCalledWith(true)
  })

  it('on "Your colour": the colour picker is not opened', async () => {
    startApp()
    openSettingsOn('Look')
    const opened = vi.fn()
    colourPicker().addEventListener('click', opened)

    await pressSpaceOn(swatch('Your colour'))

    expect(opened).not.toHaveBeenCalled()
    expect(settingsStore.get().accent).toBe('red')
    expect(settingsStore.get().sustain).toBe(true)
  })

  it('on "Reset all settings" and on its Yes: nothing is reset', async () => {
    startApp()
    act(() => settingsStore.set({ volume: 0.31 }))
    openSettingsOn('About')

    await pressSpaceOn(screen.getByRole('button', { name: 'Reset all settings' }))
    expect(screen.queryByText('Really reset?')).toBeNull()

    pressEnterOn(screen.getByRole('button', { name: 'Reset all settings' }))
    await pressSpaceOn(screen.getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get().volume).toBe(0.31)
    expect(screen.getByText('Really reset?')).toBeTruthy()
  })
})

describe('the tabs of Settings, in the app', () => {
  it('move with the arrow keys without playing a note or closing anything', async () => {
    const user = userEvent.setup()
    startApp()
    pressEnterOn(screen.getByRole('button', { name: 'Settings' }))
    openSettingsOn('Sound')
    tabNamed('Sound').focus()
    vi.clearAllMocks()

    await user.keyboard('[ArrowRight][ArrowRight][ArrowRight]')
    expect(shownTab()).toBe('Look')
    expect(document.activeElement).toBe(tabNamed('Look'))

    await user.keyboard('[End]')
    expect(shownTab()).toBe('About')
    await user.keyboard('[ArrowRight]')
    expect(shownTab()).toBe('Sound')
    await user.keyboard('[Home][ArrowLeft]')
    expect(shownTab()).toBe('About')

    expect(audio.engine.noteOn).not.toHaveBeenCalled()
    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('still play the piano from the keyboard while a tab has the focus', async () => {
    const user = userEvent.setup()
    startApp()
    openSettingsOn('Look')
    tabNamed('Look').focus()

    await user.keyboard('[KeyA>]')
    expect([...bus.getActiveNotes()]).toEqual([60])
    await user.keyboard('[/KeyA]')
    expect([...bus.getActiveNotes()]).toEqual([])
    expect(shownTab()).toBe('Look')
  })

  it('are a tab list tied to the page they show', () => {
    startApp()
    openSettingsOn('Look')
    const list = within(settingsPanel()).getByRole('tablist')
    const page = within(settingsPanel()).getByRole('tabpanel')

    expect(list.getAttribute('aria-label')).toBe('Settings')
    expect(within(list).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Sound',
      'Keys',
      'Piano',
      'Look',
      'About',
    ])
    expect(tabNamed('Look').getAttribute('aria-controls')).toBe(page.id)
    expect(page.getAttribute('aria-labelledby')).toBe(tabNamed('Look').id)
    // A tab that is not showing points at nothing: its page is not on the screen.
    for (const name of ['Sound', 'Keys', 'Piano', 'About']) {
      expect(tabNamed(name).getAttribute('aria-controls')).toBeNull()
      expect(tabNamed(name).getAttribute('aria-selected')).toBe('false')
      expect(tabNamed(name).tabIndex).toBe(-1)
    }
    expect(tabNamed('Look').tabIndex).toBe(0)
  })

  it('open again on the tab that was last used, also after everything was reset', () => {
    startApp()
    openSettingsOn('About')
    clickWithMouse(screen.getByRole('button', { name: 'Reset all settings' }))
    clickWithMouse(screen.getByRole('button', { name: 'Yes' }))
    tap('Escape')
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()

    clickWithMouse(screen.getByRole('button', { name: 'Settings' }))
    expect(shownTab()).toBe('About')
  })
})

describe('after a click with the mouse in Settings', () => {
  /** Nothing in the panel keeps the keyboard: the next key press goes to the piano alone. */
  function expectFocusReleased(control: HTMLElement): void {
    clickWithMouse(control)
    const focused = document.activeElement
    expect(focused === document.body || focused === settingsPanel(), describe(control)).toBe(true)
  }

  function describe(control: HTMLElement): string {
    return `focus after a click on <${control.tagName.toLowerCase()}> "${control.textContent}"`
  }

  it('no control of the Sound tab keeps the keyboard focus', () => {
    startApp()
    openSettingsOn('Sound')

    expectFocusReleased(tabNamed('Sound'))
    expectFocusReleased(sliderOf('Volume'))
    expectFocusReleased(switchOf('Sustain'))
    expectFocusReleased(choice('Note fade-out', 'Long'))
    expectFocusReleased(choice('Transpose', 'Transpose up'))
    expectFocusReleased(choice('Transpose', 'Transpose down'))
  })

  it('no control of the Look tab keeps the keyboard focus', () => {
    startApp()
    openSettingsOn('Look')

    expectFocusReleased(themeCard('Gold'))
    expectFocusReleased(swatch('Blue'))
    expectFocusReleased(swatch('Rainbow'))
    expectFocusReleased(swatch('Your colour'))
    expectFocusReleased(sliderOf('Glow'))
    expectFocusReleased(choice('Sparks', 'Lots'))
    expectFocusReleased(switchOf('Light bars'))
  })

  it('no control of the About tab keeps the keyboard focus, the link included', () => {
    startApp()
    openSettingsOn('About')
    const link = within(settingsPanel()).getByRole('link', { name: 'CC BY 3.0' })
    // jsdom does not open pages: the link only has to take and give back the focus.
    link.addEventListener('click', (event) => event.preventDefault())

    expectFocusReleased(link)
    expectFocusReleased(screen.getByRole('button', { name: 'Reset all settings' }))
    expectFocusReleased(screen.getByRole('button', { name: 'No' }))
  })

  it('a note played next shows no focus ring candidate: the piano has the keyboard', () => {
    startApp()
    openSettingsOn('Look')
    clickWithMouse(swatch('Your colour'))

    tap('KeyA')
    expect(audio.engine.noteOn).toHaveBeenLastCalledWith(60, DEFAULT_SETTINGS.velocity)
    expect(settingsStore.get().accent).toBe('custom')
  })
})

describe('with the keyboard alone in Settings', () => {
  it('Enter on a control keeps the focus on it', () => {
    startApp()
    pressEnterOn(screen.getByRole('button', { name: 'Settings' }))
    openSettingsOn('Look')

    for (const control of [
      themeCard('Gold'),
      swatch('Blue'),
      choice('Sparks', 'Lots'),
      switchOf('Light bars'),
    ]) {
      pressEnterOn(control)
      expect(document.activeElement).toBe(control)
    }
    expect(settingsStore.get()).toMatchObject({ accent: 'blue', sparks: 'lots', showTrails: false })
  })

  it('"Your colour" takes Enter: it becomes the colour, the picker opens, the focus stays', () => {
    startApp()
    openSettingsOn('Look')
    const opened = vi.fn()
    colourPicker().addEventListener('click', opened)

    pressEnterOn(swatch('Your colour'))

    expect(opened).toHaveBeenCalledTimes(1)
    expect(settingsStore.get().accent).toBe('custom')
    expect(document.activeElement).toBe(swatch('Your colour'))
  })

  it('answers "Reset all settings" with No without losing its place, and nothing changes', () => {
    startApp()
    act(() => settingsStore.set({ accent: 'green', volume: 0.4, baseOctave: 2 }))
    const before = settingsStore.get()
    openSettingsOn('About')

    pressEnterOn(screen.getByRole('button', { name: 'Reset all settings' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No' }))
    pressEnterOn(screen.getByRole('button', { name: 'No' }))

    expect(settingsStore.get()).toBe(before)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset all settings' }))
  })

  it('answers "Reset all settings" with Yes and is back on the button', () => {
    startApp()
    act(() => settingsStore.set({ accent: 'green', volume: 0.4 }))
    openSettingsOn('About')

    pressEnterOn(screen.getByRole('button', { name: 'Reset all settings' }))
    pressEnterOn(screen.getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset all settings' }))
  })
})

describe('closing Settings after working in it with the keyboard', () => {
  function settingsButton(): HTMLElement {
    return screen.getByRole('button', { name: 'Settings' })
  }

  it('gives the focus back to the Settings button when it was opened with Enter', () => {
    startApp()
    pressEnterOn(settingsButton())
    openSettingsOn('Look')
    switchOf('Light bars').focus()

    tap('Escape')

    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
    expect(document.activeElement).toBe(settingsButton())
  })

  it('gives the focus back to the Settings button when it was opened with the mouse and then used with Tab', () => {
    startApp()
    clickWithMouse(settingsButton())
    // The panel was opened with the mouse; from here on the player uses the
    // keyboard: Tab goes to the tabs, the arrow keys to the Look tab.
    const tab = tabNamed(shownTab())
    tab.focus()
    expect(settingsPanel().contains(document.activeElement)).toBe(true)

    tap('Escape')

    // The control that had the focus is gone with the panel. The focus is not
    // lost: it is on the button that opens the panel again.
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
    expect(document.activeElement).toBe(settingsButton())
  })

  it('leaves the keyboard to the piano when the panel was only ever used with the mouse', () => {
    startApp()
    clickWithMouse(settingsButton())
    openSettingsOn('Look')
    clickWithMouse(switchOf('Light bars'))

    clickWithMouse(within(settingsPanel()).getByRole('button', { name: 'Close Settings' }))

    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('"Reset all settings"', () => {
  it('puts the sound, the look, the piano and the keys back, on screen and in the engine', () => {
    startApp()
    act(() =>
      settingsStore.set({
        bindings: { KeyQ: 0 },
        customLabels: { KeyQ: 'q' },
        baseOctave: 1,
        volume: 0.1,
        sustain: true,
        labelMode: 'none',
        velocity: 0.2,
        transpose: 7,
        noteNaming: 'solfege',
        reverb: 0.9,
        release: 'short',
        showTrails: false,
        pianoSize: 49,
        keyStyle: 'glass',
        keyboardType: 'azerty',
        accent: 'custom',
        customColour: '#123456',
        glow: 0.05,
        background: 'aurora',
        barStyle: 'neon',
        sparks: 'off',
        showKeyHints: false,
        showNoteNames: false,
        autoHideMenu: false,
      }),
    )
    openSettingsOn('About')

    clickWithMouse(screen.getByRole('button', { name: 'Reset all settings' }))
    clickWithMouse(screen.getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(DEFAULT_SETTINGS)
    expect(audio.engine.setVolume).toHaveBeenLastCalledWith(DEFAULT_SETTINGS.volume)
    expect(audio.engine.setSustain).toHaveBeenLastCalledWith(false)
    expect(audio.engine.setTranspose).toHaveBeenLastCalledWith(0)
    expect(audio.engine.setReverb).toHaveBeenLastCalledWith(DEFAULT_SETTINGS.reverb)
    expect(audio.engine.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS.normal)
    expect(light('--light')).toBe('#ff2a2a')
    expect(light('--glow')).toBe('0.6')
    expect(piano().getAttribute('data-key-style')).toBe('classic')
    expect(stageBadges()).toEqual([])
    // The panel stays where it was, the question is gone and the tab says it is done.
    expect(shownTab()).toBe('About')
    expect(screen.queryByText('Really reset?')).toBeNull()
    expect(resetReport()).toBe(RESET_DONE)

    tap('KeyA')
    expect(audio.engine.noteOn).toHaveBeenLastCalledWith(60, DEFAULT_SETTINGS.velocity)
  })

  it('says that it is done, also when nothing on the screen could show it', () => {
    startApp()
    // Options of the sound that leave no trace on the piano, the stage or the menu.
    act(() => settingsStore.set({ velocity: 0.3, reverb: 0.7, release: 'long' }))
    openSettingsOn('About')
    expect(resetReport()).toBe('')

    clickWithMouse(screen.getByRole('button', { name: 'Reset all settings' }))
    // Asking is not doing.
    expect(resetReport()).toBe('')
    clickWithMouse(screen.getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(resetReport()).toBe(RESET_DONE)
  })

  it('lets go of the notes that were held, so that none is left ringing', () => {
    startApp()
    act(() => settingsStore.set({ baseOctave: 2 }))
    openSettingsOn('About')
    key('keydown', 'KeyA')
    expect([...bus.getActiveNotes()]).toEqual([48])

    clickWithMouse(screen.getByRole('button', { name: 'Reset all settings' }))
    clickWithMouse(screen.getByRole('button', { name: 'Yes' }))

    expect([...bus.getActiveNotes()]).toEqual([])
    key('keyup', 'KeyA')
    expect([...bus.getActiveNotes()]).toEqual([])
  })

  it('changes nothing on No, however the question was reached', () => {
    startApp()
    act(() => settingsStore.set({ accent: 'amber', transpose: -3, bindings: { KeyZ: 5 } }))
    const before = settingsStore.get()
    const saved = window.localStorage.getItem(STORAGE_KEY)
    openSettingsOn('About')

    clickWithMouse(screen.getByRole('button', { name: 'Reset all settings' }))
    clickWithMouse(screen.getByRole('button', { name: 'No' }))

    expect(settingsStore.get()).toBe(before)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(saved)
    expect(screen.getByRole('button', { name: 'Reset all settings' })).toBeTruthy()
    // Nothing was reset, and the tab does not say that anything was.
    expect(resetReport()).toBe('')
  })

  it('forgets the question when the tab is left: coming back does not find a "Yes" waiting', () => {
    startApp()
    openSettingsOn('About')
    clickWithMouse(screen.getByRole('button', { name: 'Reset all settings' }))

    openSettingsOn('Look')
    openSettingsOn('About')

    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset all settings' })).toBeTruthy()
  })

  it('leaves the songs of the player alone', async () => {
    startApp()
    await addSong('my-tune.mid')
    openSettingsOn('About')

    clickWithMouse(screen.getByRole('button', { name: 'Reset all settings' }))
    clickWithMouse(screen.getByRole('button', { name: 'Yes' }))

    expect(songLibrary.list().map((song) => song.title)).toContain('my-tune')
  })
})

describe('"Reset to default keys", next to "Reset all settings"', () => {
  const MINE: Partial<Settings> = {
    bindings: { KeyQ: 0, KeyW: 2 },
    customLabels: { KeyQ: 'q' },
    baseOctave: 4,
    keyboardType: 'azerty',
    accent: 'custom',
    customColour: '#00c2a8',
    volume: 0.3,
    pianoSize: 61,
  }

  it('puts back the keys and nothing else: the colour, the sound and the piano stay', () => {
    startApp()
    act(() => settingsStore.set(MINE))
    openSettingsOn('Keys')

    clickWithMouse(screen.getByRole('button', { name: 'Reset to default keys' }))
    clickWithMouse(screen.getByRole('button', { name: 'Yes' }))

    expect(settingsStore.get()).toEqual({
      ...DEFAULT_SETTINGS,
      ...MINE,
      bindings: DEFAULT_BINDINGS,
      customLabels: {},
    })
    expect(light('--light')).toBe('#00c2a8')
    expect(within(settingsPanel()).getByText('The default keys are back.')).toBeTruthy()
  })

  it('changes nothing on No', () => {
    startApp()
    act(() => settingsStore.set(MINE))
    const before = settingsStore.get()
    openSettingsOn('Keys')

    clickWithMouse(screen.getByRole('button', { name: 'Reset to default keys' }))
    clickWithMouse(screen.getByRole('button', { name: 'No' }))

    expect(settingsStore.get()).toBe(before)
    expect(within(settingsPanel()).queryByText('The default keys are back.')).toBeNull()
  })
})

describe('a slider that has the keyboard focus', () => {
  it('keeps the keys that move it, and gives the piano the keys that play notes', () => {
    startApp()
    openSettingsOn('Sound')
    const volume = sliderOf('Volume')
    volume.focus()

    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp']) {
      // Not used up by the app: the browser moves the slider.
      expect(key('keydown', code, { key: code }).defaultPrevented, code).toBe(false)
      key('keyup', code, { key: code })
    }
    expect(audio.engine.noteOn).not.toHaveBeenCalled()

    expect(key('keydown', 'KeyA').defaultPrevented).toBe(true)
    expect(audio.engine.noteOn).toHaveBeenLastCalledWith(60, DEFAULT_SETTINGS.velocity)
    key('keyup', 'KeyA')
    expect(document.activeElement).toBe(volume)
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })
})

describe('storage that is full or refuses to save', () => {
  function refuseToSave(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
  }

  it('does not stop a setting from changing on screen and in the sound', () => {
    startApp()
    openSettingsOn('Look')
    refuseToSave()

    expect(() => clickWithMouse(themeCard('Midnight'))).not.toThrow()
    expect(isPressed(themeCard('Midnight'))).toBe(true)
    expect(light('--light')).toBe('#2f8bff')

    openSettingsOn('Sound')
    slide(sliderOf('Volume'), 10)
    expect(audio.engine.setVolume).toHaveBeenLastCalledWith(0.1)
    expect(sliderOf('Volume').value).toBe('10')
  })

  it('does not stop "Reset all settings"', () => {
    startApp()
    act(() => settingsStore.set({ accent: 'blue' }))
    openSettingsOn('About')
    refuseToSave()

    clickWithMouse(screen.getByRole('button', { name: 'Reset all settings' }))
    expect(() => clickWithMouse(screen.getByRole('button', { name: 'Yes' }))).not.toThrow()

    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(light('--light')).toBe('#ff2a2a')
  })
})

describe('what another tab of the browser leaves in storage', () => {
  it('is cleaned before it reaches the screen or the sound', () => {
    startApp()
    openSettingsOn('Look')

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        volume: 99,
        glow: -4,
        accent: 'custom',
        customColour: 'red; background: url(//example.invalid)',
        background: '<script>',
        transpose: 1e300,
        sustain: 'yes',
        bindings: { KeyA: 999, constructor: 3, KeyB: 5 },
      }),
    )
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })

    expect(audio.engine.setVolume).toHaveBeenLastCalledWith(1)
    expect(audio.engine.setTranspose).toHaveBeenLastCalledWith(12)
    expect(light('--glow')).toBe('0')
    // Not a colour: the light is the default red, and nothing of the text reaches the page.
    expect(light('--light')).toBe('#ff2a2a')
    expect(root().getAttribute('style')).not.toContain('url')
    expect(skyProps().background).toBe('black')
    expect(settingsStore.get().sustain).toBe(false)
    // Of the keys, only the one that is a real key on a real note is kept.
    expect(settingsStore.get().bindings).toEqual({ KeyB: 5 })
  })

  it('goes back to the defaults when the other tab cleared everything', () => {
    startApp()
    act(() => settingsStore.set({ accent: 'blue', volume: 0.5 }))
    openSettingsOn('Look')

    window.localStorage.clear()
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })

    expect(settingsStore.get()).toEqual(DEFAULT_SETTINGS)
    expect(swatch('Red').getAttribute('aria-checked')).toBe('true')
    expect(audio.engine.setVolume).toHaveBeenLastCalledWith(DEFAULT_SETTINGS.volume)
  })

  it('is left alone when the change is about something else the site saved', () => {
    startApp()
    act(() => settingsStore.set({ accent: 'blue' }))
    const before = settingsStore.get()

    window.localStorage.removeItem(STORAGE_KEY)
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }))
    })

    expect(settingsStore.get()).toBe(before)
  })

  it('is not written back by this tab: it is only read', () => {
    startApp()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const garbage = '{"volume": 0.25, "left-by": "another version"}'
    window.localStorage.setItem(STORAGE_KEY, garbage)
    writes.mockClear()

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })

    expect(settingsStore.get().volume).toBe(0.25)
    expect(writes).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(garbage)
  })

  it('is what this tab builds on at its next change: neither tab loses what the other chose', () => {
    startApp()
    saveFromAnotherTab({ bindings: { KeyQ: 0 }, accent: 'green' })

    // This tab was opened first. Its next change is saved on top of what the other tab saved.
    act(() => settingsStore.set({ volume: 0.3 }))

    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Settings
    expect(saved).toEqual({
      ...DEFAULT_SETTINGS,
      bindings: { KeyQ: 0 },
      accent: 'green',
      volume: 0.3,
    })
  })
})

describe('a drag through the colour picker', () => {
  /** Sixty different colours, as a second of dragging sends them. Returns them in order. */
  function drag(steps: number): string[] {
    const colours: string[] = []
    for (let step = 0; step < steps; step += 1) {
      const channel = (step * 4).toString(16).padStart(2, '0')
      const colour = `#${channel}80ff`
      colours.push(colour)
      fireEvent.change(colourPicker(), { target: { value: colour } })
    }
    return colours
  }

  /** A list without the entries that only repeat the one before them. */
  function withoutRepeats(list: readonly string[]): string[] {
    return list.filter((entry, index) => entry !== list[index - 1])
  }

  it('shows every colour at once: the light, the swatch and the sky', () => {
    startApp()
    openSettingsOn('Look')

    drag(60)

    expect(settingsStore.get()).toMatchObject({ accent: 'custom', customColour: '#ec80ff' })
    expect(light('--light')).toBe('#ec80ff')
    expect(skyProps()).toMatchObject({ accent: 'custom', customColour: '#ec80ff' })
    expect(swatch('Your colour').getAttribute('aria-checked')).toBe('true')
    expect(option('Theme').textContent).toContain('Custom')
  })

  it('saves each colour once, and gives the sky every one of them as it comes', () => {
    startApp()
    openSettingsOn('Look')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    sky.colours.length = 0

    const dragged = drag(60)

    expect(writes.mock.calls.filter(([name]) => name === STORAGE_KEY)).toHaveLength(60)
    // However often the app is drawn, the sky gets each colour in turn: none left out, none late.
    expect(withoutRepeats(sky.colours)).toEqual(dragged)
  })

  it('saves nothing and draws nothing when the picker reports the colour it already has', () => {
    startApp()
    openSettingsOn('Look')
    const picker = colourPicker()
    // The last move of a drag: the picker reports the colour while it is still open...
    fireEvent.input(picker, { target: { value: '#123456' } })
    expect(settingsStore.get()).toMatchObject({ accent: 'custom', customColour: '#123456' })
    const before = settingsStore.get()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    sky.draws = 0

    // ...and reports the same colour once more when it is closed.
    fireEvent.change(picker, { target: { value: '#123456' } })
    // React keeps a report of the value it already has to itself. This is
    // what the app would do with one that got through: save the same colour.
    act(() => settingsStore.set({ accent: 'custom', customColour: '#123456' }))

    expect(writes).not.toHaveBeenCalled()
    expect(sky.draws).toBe(0)
    expect(settingsStore.get()).toBe(before)
  })

  it('leaves the other open controls of the app as they were', () => {
    startApp()
    openSettingsOn('Look')
    act(() => settingsStore.set({ volume: 0.33, transpose: 3 }))

    drag(20)

    expect(settingsStore.get()).toMatchObject({ volume: 0.33, transpose: 3, glow: 0.6 })
    expect(audio.engine.setVolume).toHaveBeenLastCalledWith(0.33)
  })
})
