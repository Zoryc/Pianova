// @vitest-environment jsdom
/**
 * How the app shell (src/App.tsx) ties the screen together: the start
 * overlay, the colour of the light, the two panels and what closes them,
 * choosing the computer keys, the labels handed to the piano and to the sky,
 * the menu that hides, and where the keyboard focus goes.
 *
 * The sound engine and the sky are replaced by stand-ins; each has tests of
 * its own. There is no layout here: sizes and positions are tried in a browser.
 */
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkyProps } from './ui/sky/Sky'

const audio = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const state = { status: 'idle', starts: 0 }
  const engine = {
    start(): Promise<void> {
      state.starts += 1
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

/** What the stand-in sky was last given. */
const sky = vi.hoisted(() => ({ props: null as unknown }))

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  return { ...original, createAudioEngine: () => audio.engine }
})

vi.mock('./ui/sky/Sky', async () => {
  const { createElement } = await import('react')
  return {
    Sky(props: unknown) {
      sky.props = props
      return createElement('canvas', { className: 'sky' })
    },
  }
})

import { App } from './App'
import { APP_NAME } from './app/appInfo'
import { bus } from './app/pianoApp'
import { player } from './app/songsApp'
import { settingsStore } from './state/settings'
import { addSong, resetSongs, songFile } from './ui/songsTestKit'
import { AUTO_HIDE_DELAY_MS } from './ui/useAutoHide'
import { playSong } from './ui/useSongs'

const START_TEXT = 'Click or press any key to start'
const HINT = 'Press the keys shown on the piano, or click it'
const A_STARTER_SONG = 'starter:twinkle-twinkle-little-star'

function skyProps(): SkyProps {
  return sky.props as SkyProps
}

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  audio.state.starts = 0
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

function drawApp(): void {
  render(<App />)
}

/** Draws the app and gets past the start overlay. */
function startApp(): void {
  drawApp()
  tap('Enter')
}

function root(): HTMLElement {
  return document.querySelector('.app') as HTMLElement
}

function menu(): HTMLElement {
  return document.querySelector('.menu') as HTMLElement
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function panel(name: 'Settings' | 'Songs'): HTMLElement | null {
  return screen.queryByRole('dialog', { name })
}

function openPanel(name: 'Settings' | 'Songs'): HTMLElement {
  if (!panel(name)) clickWithMouse(button(name))
  return screen.getByRole('dialog', { name })
}

/** Opens Settings on one of its tabs. (The panel remembers its last tab from test to test.) */
function openSettingsOn(tab: string): HTMLElement {
  const settings = openPanel('Settings')
  clickWithMouse(within(settings).getByRole('tab', { name: tab }))
  return settings
}

function piano(): HTMLElement {
  return screen.getByRole('group', { name: 'Piano' })
}

function pianoKey(midi: number): HTMLElement {
  return piano().querySelector(`.piano-key[data-midi="${midi}"]`) as HTMLElement
}

function isChoosingKeys(): boolean {
  return piano().classList.contains('piano--editing')
}

function emptySky(): HTMLElement {
  return document.querySelector('.stage__sky') as HTMLElement
}

function heldNotes(): number[] {
  return [...bus.getActiveNotes()]
}

describe('before the first click or key press', () => {
  it('waits behind the start overlay, with everything else out of reach', () => {
    drawApp()
    expect(button(new RegExp(START_TEXT)).textContent).toContain(APP_NAME)
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(true)
    expect(audio.state.starts).toBe(0)
  })

  it('starts at the first key press, which plays no note', () => {
    drawApp()
    const press = key('keydown', 'KeyA')

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(audio.state.starts).toBe(1)
    expect(press.defaultPrevented).toBe(true)
    expect(heldNotes()).toEqual([])

    key('keyup', 'KeyA')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('starts at a click', () => {
    drawApp()
    clickWithMouse(button(new RegExp(START_TEXT)))
    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(audio.state.starts).toBe(1)
  })

  it('asks for the sound once at the click that starts it, not twice', () => {
    // A sound that takes its time: it has not started yet while the click travels up the page.
    vi.spyOn(audio.engine, 'start').mockImplementation(() => {
      audio.state.starts += 1
      return Promise.resolve()
    })
    drawApp()
    clickWithMouse(button(new RegExp(START_TEXT)))
    expect(audio.state.starts).toBe(1)

    // Every later click asks again for as long as the sound has not started.
    clickWithMouse(emptySky())
    expect(audio.state.starts).toBe(2)
  })

  it('starts at a dropped file too: the Songs panel is not left behind the overlay', async () => {
    drawApp()
    const dataTransfer = { types: ['Files'], files: [songFile('Dropped.mid')], dropEffect: 'none' }

    await act(async () => {
      fireEvent(document.body, createEvent.drop(document.body, { dataTransfer }))
      await Promise.resolve()
    })

    expect(screen.queryByText(START_TEXT)).toBeNull()
    expect(document.querySelector('.app__screen')?.hasAttribute('inert')).toBe(false)
    expect(await screen.findByText('"Dropped" was added.')).toBeTruthy()
    // The panel can be used: it has taken the keyboard focus, as after a click on "Songs".
    expect(document.activeElement).toBe(panel('Songs'))

    // A drop is not what the browser waits for: the sound starts at the next click or key press.
    expect(audio.state.starts).toBe(0)
    key('keydown', 'KeyA')
    expect(audio.state.starts).toBe(1)
    expect(heldNotes()).toEqual([60])
  })

  it('leaves the function keys to the browser, and keyboard shortcuts alone', () => {
    drawApp()
    expect(key('keydown', 'KeyR', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(screen.getByText(START_TEXT)).toBeTruthy()

    expect(key('keydown', 'F5').defaultPrevented).toBe(false)
    expect(screen.queryByText(START_TEXT)).toBeNull()
  })

  it('does not ask for sound before the browser has counted a click or key press', () => {
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false } })
    try {
      drawApp()
      key('keydown', 'Escape')
      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(audio.state.starts).toBe(0)

      vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } })
      tap('KeyA')
      expect(audio.state.starts).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('tries the sound again at the next click after it failed', () => {
    startApp()
    expect(audio.state.starts).toBe(1)
    act(() => {
      audio.state.status = 'error'
    })

    clickWithMouse(emptySky())
    expect(audio.state.starts).toBe(2)
  })

  it('keeps "how to play" back until the overlay is gone', () => {
    drawApp()
    expect(screen.getByText(HINT).className).toBe('stage__hint stage__hint--gone')
    tap('Enter')
    expect(screen.getByText(HINT).className).toBe('stage__hint')
  })

  it('keeps the menu on screen', () => {
    vi.useFakeTimers()
    drawApp()
    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 4)
    })
    expect(menu().className).toBe('menu')
    expect(root().className).toBe('app')
  })
})

describe('the light', () => {
  function light(): Record<string, string> {
    const style = root().style
    const names = ['--light', '--light-bright', '--light-deep', '--light-ink', '--glow']
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
  }

  it('is red at first: the colours the stylesheet starts with', () => {
    drawApp()
    expect(light()).toEqual({
      '--light': '#ff2a2a',
      '--light-bright': '#ffd4d4',
      '--light-deep': '#8c0000',
      '--light-ink': '#000000',
      '--glow': '0.6',
    })
  })

  it('follows the colour and the glow the player chooses', () => {
    startApp()
    act(() => settingsStore.set({ accent: 'blue', glow: 0.25 }))
    expect(light()['--light']).toBe('#2f8bff')
    expect(light()['--glow']).toBe('0.25')

    act(() => settingsStore.set({ accent: 'custom', customColour: '#000080' }))
    // A colour too dark to show on black is lifted, and what is written on it turns white.
    expect(light()['--light']).toBe('#0000fc')
    expect(light()['--light-ink']).toBe('#ffffff')

    act(() => settingsStore.set({ accent: 'rainbow' }))
    expect(light()['--light']).toBe('#9c7aff')
  })

  it('reaches the start overlay too, which is inside the element that carries it', () => {
    drawApp()
    expect(root().contains(screen.getByText(START_TEXT))).toBe(true)
  })
})

describe('the two panels', () => {
  it('are closed at first', () => {
    startApp()
    expect(panel('Settings')).toBeNull()
    expect(panel('Songs')).toBeNull()
    expect(button('Settings').getAttribute('aria-expanded')).toBe('false')
    expect(button('Songs').getAttribute('aria-expanded')).toBe('false')
  })

  it('open from their buttons, which point at them, and close from them again', () => {
    startApp()
    clickWithMouse(button('Settings'))
    expect(button('Settings').getAttribute('aria-expanded')).toBe('true')
    expect(button('Settings').getAttribute('aria-controls')).toBe(panel('Settings')?.id)

    clickWithMouse(button('Settings'))
    expect(panel('Settings')).toBeNull()
    expect(button('Settings').hasAttribute('aria-controls')).toBe(false)

    clickWithMouse(button('Songs'))
    expect(button('Songs').getAttribute('aria-controls')).toBe(panel('Songs')?.id)
    clickWithMouse(button('Songs'))
    expect(panel('Songs')).toBeNull()
  })

  it('are never open together: opening one closes the other', () => {
    startApp()
    openPanel('Settings')
    clickWithMouse(button('Songs'))
    expect(panel('Songs')).not.toBeNull()
    expect(panel('Settings')).toBeNull()
    expect(button('Settings').getAttribute('aria-expanded')).toBe('false')

    clickWithMouse(button('Settings'))
    expect(panel('Settings')).not.toBeNull()
    expect(panel('Songs')).toBeNull()
  })

  it.each(['Settings', 'Songs'] as const)('%s closes with its own close button', (name) => {
    startApp()
    openPanel(name)
    clickWithMouse(button(`Close ${name}`))
    expect(panel(name)).toBeNull()
  })

  it.each(['Settings', 'Songs'] as const)('%s closes at Escape, and that is all', (name) => {
    startApp()
    openPanel(name)
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(panel(name)).toBeNull()
    expect(heldNotes()).toEqual([])
  })

  it('leave Escape to the browser when none is open', () => {
    startApp()
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
  })

  it.each(['Settings', 'Songs'] as const)('%s closes at a click on the empty sky', (name) => {
    startApp()
    openPanel(name)
    clickWithMouse(emptySky())
    expect(panel(name)).toBeNull()
  })

  it('stay open at a click on the piano or inside the panel', () => {
    startApp()
    const settings = openSettingsOn('Sound')
    fireEvent.click(pianoKey(60))
    fireEvent.click(piano())
    fireEvent.click(settings)
    clickWithMouse(within(settings).getByRole('switch', { name: 'Sustain' }))
    expect(panel('Settings')).not.toBeNull()
    expect(settingsStore.get().sustain).toBe(true)
  })

  it('let the piano play under them', () => {
    startApp()
    openSettingsOn('Look')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
    key('keyup', 'KeyA')
    expect(panel('Settings')).not.toBeNull()
  })

  it('come before the piano for the Tab key, and after the menu', () => {
    startApp()
    const settings = openPanel('Settings')
    const follows = (earlier: Node, later: Node): boolean =>
      (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(menu(), settings)).toBe(true)
    expect(follows(settings, piano())).toBe(true)
  })

  it('leave a text field its own Escape', async () => {
    await addSong('Tune.mid')
    startApp()
    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: 'Rename Tune' }))
    const field = within(songs).getByRole('textbox', { name: 'Song name' })
    field.focus()

    fireEvent.keyDown(field, { code: 'Escape', key: 'Escape' })

    expect(panel('Songs')).not.toBeNull()
    expect(within(songs).queryByRole('textbox', { name: 'Song name' })).toBeNull()
  })

  it('open on Songs when a file is dropped on the page', async () => {
    startApp()
    openPanel('Settings')
    const dataTransfer = { types: ['Files'], files: [songFile('Dropped.mid')], dropEffect: 'none' }

    await act(async () => {
      fireEvent(document.body, createEvent.drop(document.body, { dataTransfer }))
      await Promise.resolve()
    })

    expect(panel('Settings')).toBeNull()
    expect(await screen.findByText('"Dropped" was added.')).toBeTruthy()
    expect(panel('Songs')).not.toBeNull()
  })
})

describe('choosing the computer keys', () => {
  it('is on exactly while Settings shows its Keys tab', () => {
    startApp()
    expect(isChoosingKeys()).toBe(false)

    const settings = openSettingsOn('Keys')
    expect(isChoosingKeys()).toBe(true)

    clickWithMouse(within(settings).getByRole('tab', { name: 'Piano' }))
    expect(isChoosingKeys()).toBe(false)
    clickWithMouse(within(settings).getByRole('tab', { name: 'Keys' }))
    expect(isChoosingKeys()).toBe(true)

    clickWithMouse(button('Close Settings'))
    expect(isChoosingKeys()).toBe(false)
  })

  it('is on again when Settings opens on the Keys tab it was left on', () => {
    startApp()
    openSettingsOn('Keys')
    clickWithMouse(emptySky())
    expect(isChoosingKeys()).toBe(false)

    openPanel('Settings')
    expect(isChoosingKeys()).toBe(true)
  })

  it('ends when the Songs panel takes the place of Settings', () => {
    startApp()
    openSettingsOn('Keys')
    clickWithMouse(button('Songs'))
    expect(isChoosingKeys()).toBe(false)
  })

  it('works under StrictMode, where React draws everything twice', () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    tap('Enter')
    openSettingsOn('Keys')
    expect(isChoosingKeys()).toBe(true)
    tap('Escape')
    expect(isChoosingKeys()).toBe(false)
    expect(panel('Settings')).toBeNull()
  })

  it('always shows the keycaps, whatever the Labels setting, which it leaves alone', () => {
    act(() => settingsStore.set({ labelMode: 'none' }))
    startApp()
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(0)

    openSettingsOn('Keys')
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(18)
    expect(settingsStore.get().labelMode).toBe('none')

    tap('Escape')
    expect(piano().querySelectorAll('.piano-key__cap')).toHaveLength(0)
  })

  it('gives a piano key the next computer key pressed, and says so in the tab', () => {
    startApp()
    const settings = openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    expect(pianoKey(64).classList.contains('is-selected')).toBe(true)
    expect(within(settings).getByText('Press a key for E4…')).toBeTruthy()

    key('keydown', 'KeyM', { key: 'm' })
    key('keyup', 'KeyM', { key: 'm' })

    expect(settingsStore.get().bindings.KeyM).toBe(16)
    expect(heldNotes()).toEqual([])
    expect(pianoKey(64).getAttribute('aria-label')).toBe('E4, key M')
    expect(within(settings).getByText(/"M" now plays E4\./)).toBeTruthy()

    key('keydown', 'KeyM', { key: 'm' })
    expect(heldNotes()).toEqual([64])
  })

  it('keeps "how to play" back, where a click on the piano does something else', () => {
    startApp()
    openSettingsOn('Keys')
    expect(screen.getByText(HINT).className).toBe('stage__hint stage__hint--gone')
    tap('Escape')
    expect(screen.getByText(HINT).className).toBe('stage__hint')
  })
})

describe('Escape, one thing at a time', () => {
  it('first lets go of the piano key that is waiting, then closes the panel', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(panel('Settings')).not.toBeNull()
    expect(isChoosingKeys()).toBe(true)
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(panel('Settings')).toBeNull()
    expect(isChoosingKeys()).toBe(false)
  })

  it('held down after cancelling a selection does not also close the panel', () => {
    startApp()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))

    key('keydown', 'Escape')
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    }
    expect(panel('Settings')).not.toBeNull()
    expect(isChoosingKeys()).toBe(true)
  })

  it('changes no key and no setting', () => {
    startApp()
    const before = settingsStore.get()
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    tap('Escape')
    tap('Escape')
    expect(settingsStore.get()).toBe(before)
  })

  function songOptions(): HTMLElement | null {
    return screen.queryByRole('group', { name: 'Song options' })
  }

  it('closes the song options before the panel, and the panel at the next press', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    openPanel('Songs')
    clickWithMouse(button('Song options'))
    expect(songOptions()).not.toBeNull()

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(songOptions()).toBeNull()
    expect(panel('Songs')).not.toBeNull()

    // Still held down: it has closed its one thing.
    for (let repeat = 0; repeat < 5; repeat++) {
      expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    }
    expect(panel('Songs')).not.toBeNull()
    key('keyup', 'Escape')

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(panel('Songs')).toBeNull()
    // Escape is not a button of the player: the song goes on.
    expect(player.getState().status).toBe('playing')
  })

  it('held down since before the song options were opened does not close them', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    key('keydown', 'Escape')
    clickWithMouse(button('Song options'))

    expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    expect(songOptions()).not.toBeNull()

    key('keyup', 'Escape')
    tap('Escape')
    expect(songOptions()).toBeNull()
  })

  it('lets go of the piano key that is waiting before it closes the song options', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    openSettingsOn('Keys')
    fireEvent.click(pianoKey(64))
    clickWithMouse(button('Song options'))
    expect(pianoKey(64).classList.contains('is-selected')).toBe(true)

    tap('Escape')
    expect(piano().querySelector('.is-selected')).toBeNull()
    expect(songOptions()).not.toBeNull()

    tap('Escape')
    expect(songOptions()).toBeNull()
    expect(panel('Settings')).not.toBeNull()
  })

  it('closes song options that were used with the keyboard, then lets go of the menu', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    pressEnterOn(button('Song options'))
    within(songOptions() as HTMLElement).getByRole('switch', { name: 'Melody only' }).focus()

    // 1. The options close. The focus is not lost with them: it is on their button.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(songOptions()).toBeNull()
    expect(document.activeElement).toBe(button('Song options'))
    // Held down, it does not go on to take the focus away.
    expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(button('Song options'))
    key('keyup', 'Escape')

    // 2. The menu lets go of the keyboard.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(document.body)
    // Held down after that, there is nothing left to take back.
    expect(key('keydown', 'Escape', { repeat: true }).defaultPrevented).toBe(false)
    key('keyup', 'Escape')

    // 3. Nothing is left: the key is the browser's.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
    expect(screen.getByRole('region', { name: 'Song player' })).toBeTruthy()
  })

  it('closes a panel, then lets go of the button the focus went back to', () => {
    startApp()
    pressEnterOn(button('Settings'))

    tap('Escape')
    expect(panel('Settings')).toBeNull()
    expect(document.activeElement).toBe(button('Settings'))

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(document.body)
    expect(heldNotes()).toEqual([])
  })

  it('takes the keyboard focus off any control of the menu, and changes nothing with it', () => {
    startApp()
    const before = settingsStore.get()
    for (const control of [
      within(menu()).getByRole('slider', { name: 'Volume' }),
      within(menu()).getByRole('switch', { name: 'Sustain' }),
      screen.getByRole('tab', { name: 'Free Play' }),
    ]) {
      control.focus()
      expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(document.body)
      key('keyup', 'Escape')
    }
    expect(settingsStore.get()).toBe(before)
  })
})

describe('the labels', () => {
  function keycap(midi: number): string | undefined {
    return pianoKey(midi).querySelector('.piano-key__cap')?.textContent ?? undefined
  }

  it('on the piano are the letters of the keyboard type the player chose', () => {
    startApp()
    expect(keycap(60)).toBe('A')
    expect(keycap(61)).toBe('W')

    act(() => settingsStore.set({ keyboardType: 'azerty' }))
    expect(keycap(60)).toBe('Q')
    expect(keycap(61)).toBe('Z')

    act(() => settingsStore.set({ keyboardType: 'qwertz' }))
    expect(keycap(60)).toBe('A')
    expect(keycap(68)).toBe('Z')
  })

  it('on falling notes say which computer key plays each note', () => {
    startApp()
    const hints = skyProps().hints
    expect(hints.size).toBe(18)
    expect(hints.get(60)).toBe('A')
    expect(hints.get(61)).toBe('W')
    expect(hints.get(77)).toBe("'")
    expect(hints.has(59)).toBe(false)
  })

  it('on falling notes move with the computer keys and follow the keyboard type', () => {
    startApp()
    act(() => settingsStore.set({ baseOctave: 2, keyboardType: 'azerty' }))
    expect(skyProps().hints.get(48)).toBe('Q')
    expect(skyProps().hints.get(60)).toBe('K')
    expect(skyProps().hints.has(66)).toBe(false)
  })

  it('on falling notes are none at all when the player switched them off', () => {
    startApp()
    act(() => settingsStore.set({ showKeyHints: false }))
    expect(skyProps().hints.size).toBe(0)

    act(() => settingsStore.set({ showKeyHints: true }))
    expect(skyProps().hints.get(60)).toBe('A')
  })

  it('on falling notes are one and the same map until a label changes', () => {
    // The sky draws again whenever it is given another map.
    startApp()
    const before = skyProps().hints
    act(() => settingsStore.set({ volume: 0.3, accent: 'green', sustain: true }))
    tap('KeyA')
    openPanel('Settings')
    expect(skyProps().hints).toBe(before)

    act(() => settingsStore.set({ showKeyHints: false }))
    const none = skyProps().hints
    act(() => settingsStore.set({ volume: 0.5 }))
    expect(skyProps().hints).toBe(none)
  })
})

describe('the piano on screen', () => {
  it('is the one the sky draws its light for', () => {
    startApp()
    for (const pianoSize of [88, 61, 49, 37, 'auto'] as const) {
      act(() => settingsStore.set({ pianoSize }))
      const notes = [...piano().querySelectorAll<HTMLElement>('.piano-key')].map((pianoKey) =>
        Number(pianoKey.dataset.midi),
      )
      expect(skyProps().range).toEqual({ first: Math.min(...notes), last: Math.max(...notes) })
    }
  })

  it('lets go of every held note when it becomes another piano', () => {
    startApp()
    key('keydown', 'KeyA')
    act(() => bus.noteOn(72, 'pointer'))
    expect(heldNotes()).toEqual([60, 72])

    act(() => settingsStore.set({ pianoSize: 61 }))
    expect(heldNotes()).toEqual([])

    // The key is still down: letting go of it later does nothing, and it plays again after that.
    key('keyup', 'KeyA')
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('lets go of every held note when the computer keys move lower or higher', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])

    act(() => settingsStore.set({ baseOctave: 4 }))
    expect(heldNotes()).toEqual([])
  })

  it('keeps held notes when something else changes', () => {
    startApp()
    key('keydown', 'KeyA')
    act(() => settingsStore.set({ accent: 'amber', keyStyle: 'glass', volume: 0.4 }))
    act(() => settingsStore.set({ labelMode: 'none', sustain: true }))
    clickWithMouse(button('Songs'))
    expect(heldNotes()).toEqual([60])
  })

  it('lets go of every held note when the app goes away', () => {
    startApp()
    key('keydown', 'KeyA')
    cleanup()
    expect(heldNotes()).toEqual([])
  })

  it('plays the notes of the mouse as hard as the Touch setting says', () => {
    act(() => settingsStore.set({ velocity: 0.35 }))
    startApp()
    const heard: number[] = []
    const stop = bus.subscribe((event) => {
      if (event.type === 'on') heard.push(event.velocity)
    })

    piano().getBoundingClientRect = () => ({ left: 0, top: 0, width: 2200, height: 100 }) as DOMRect
    // The first white key. Nothing is measured here, so the piano is the smallest: it starts at C3.
    fireEvent.pointerDown(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    expect(heldNotes()).toEqual([48])
    fireEvent.pointerUp(piano(), { button: 0, pointerId: 1, clientX: 50, clientY: 90 })
    stop()

    expect(heard).toEqual([0.35])
    expect(heldNotes()).toEqual([])
  })
})

describe('a song in the player', () => {
  it('gives the sky its falling notes, and takes them away when it is closed', () => {
    startApp()
    expect(skyProps().falling).toBeNull()
    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()

    act(() => {
      playSong(A_STARTER_SONG)
    })
    const falling = skyProps().falling
    expect(falling?.getNotes().length).toBe(42)
    expect(falling?.isPlaying()).toBe(true)
    expect(menu().contains(screen.getByRole('region', { name: 'Song player' }))).toBe(true)
    expect(document.querySelector('.song-progress')).not.toBeNull()
    expect(menu().contains(document.querySelector('.song-progress'))).toBe(false)

    clickWithMouse(button('Close'))
    expect(skyProps().falling).toBeNull()
    expect(document.querySelector('.song-progress')).toBeNull()
  })

  it('is started from the Songs panel, which then gets out of the way', () => {
    startApp()
    const songs = openPanel('Songs')
    clickWithMouse(within(songs).getByRole('button', { name: /^Play Twinkle/ }))

    expect(panel('Songs')).toBeNull()
    expect(player.getState().status).toBe('playing')
    expect(button('Pause')).toBeTruthy()
  })

  it('is arranged for the piano on screen', () => {
    act(() => settingsStore.set({ pianoSize: 88 }))
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const onFullPiano = skyProps().falling

    act(() => settingsStore.set({ pianoSize: 37 }))
    expect(skyProps().range).toEqual({ first: 48, last: 84 })
    expect(skyProps().falling).not.toBe(onFullPiano)
    expect(skyProps().falling?.getNotes().length).toBe(42)
  })
})

describe('the menu', () => {
  function wait(milliseconds: number): void {
    act(() => {
      vi.advanceTimersByTime(milliseconds)
    })
  }

  function isHidden(): boolean {
    return menu().classList.contains('menu--hidden')
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('hides when the mouse has been still for a while, and the mouse cursor with it', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    expect(root().className).toBe('app')

    wait(1)
    expect(isHidden()).toBe(true)
    expect(root().className).toBe('app cursor-hidden')
  })

  it('comes back when the mouse moves, not when the piano is played', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    tap('KeyA')
    expect(isHidden()).toBe(true)

    fireEvent.mouseMove(document.body, { screenX: 10, screenY: 10 })
    expect(isHidden()).toBe(false)
    expect(root().className).toBe('app')
  })

  it('stays while a panel is open, and gets its full time again when it closes', () => {
    startApp()
    openPanel('Settings')
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    tap('Escape')
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
  })

  it('hides while a song plays, and stays while a song is loaded but not playing', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)

    act(() => player.pause())
    expect(isHidden()).toBe(false)
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    act(() => player.play())
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)

    act(() => player.stop())
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
  })

  it('never hides when the player switched that off, and the sky then starts below it', () => {
    act(() => settingsStore.set({ autoHideMenu: false }))
    startApp()
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
    expect(screen.getByRole('tabpanel', { name: 'Free Play' }).className).toBe(
      'stage stage--below-menu',
    )

    act(() => settingsStore.set({ autoHideMenu: true }))
    expect(screen.getByRole('tabpanel', { name: 'Free Play' }).className).toBe('stage')
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)
  })

  // "Close" takes the player line away from under the mouse, which is then
  // over the sky without having moved. Nothing says that it left the menu.
  // What a browser does say then depends on the browser.
  it.each([
    [
      'that the mouse is over the sky now',
      () => fireEvent.mouseOver(emptySky(), { relatedTarget: menu() }),
    ],
    [
      'a "move" to where the mouse already is',
      () => fireEvent.mouseMove(emptySky(), { screenX: 900, screenY: 80 }),
    ],
  ])(
    'hides again after "Close" under a mouse that stands still (the browser says %s)',
    (_what, browserSays) => {
      startApp()
      act(() => {
        playSong(A_STARTER_SONG)
      })
      const close = button('Close')
      fireEvent.mouseOver(close)
      fireEvent.mouseMove(close, { screenX: 900, screenY: 80 })
      wait(AUTO_HIDE_DELAY_MS * 4)
      expect(isHidden()).toBe(false)

      clickWithMouse(close)
      browserSays()

      wait(AUTO_HIDE_DELAY_MS - 1)
      expect(isHidden()).toBe(false)
      wait(1)
      expect(isHidden()).toBe(true)
      expect(root().className).toBe('app cursor-hidden')
    },
  )

  it('hides again once Escape has taken the keyboard focus out of it', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    // Tab brings the menu back and puts the focus in it, where it stays.
    key('keydown', 'Tab', { key: 'Tab' })
    key('keyup', 'Tab', { key: 'Tab' })
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
    expect(menu().contains(document.activeElement)).toBe(true)

    tap('Escape')
    expect(document.activeElement).toBe(document.body)
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)

    key('keydown', 'KeyA')
    expect(heldNotes()).toEqual([60])
  })

  it('leaves a sign on the stage when Space switches sustain while it is hidden', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    expect(within(emptySky()).queryByText('Sustain on')).toBeNull()

    tap('Space')
    expect(isHidden()).toBe(true)
    expect(within(emptySky()).getByText('Sustain on')).toBeTruthy()

    tap('Space')
    expect(within(emptySky()).queryByText('Sustain on')).toBeNull()
  })
})

describe('the keyboard focus', () => {
  it('is given back to the piano after a click with the mouse', () => {
    startApp()
    clickWithMouse(button('Settings'))
    expect(document.activeElement).not.toBe(button('Settings'))

    const sustain = within(menu()).getByRole('switch', { name: 'Sustain' })
    clickWithMouse(sustain)
    expect(document.activeElement).not.toBe(sustain)
    const volume = within(menu()).getByRole('slider', { name: 'Volume' })
    clickWithMouse(volume)
    expect(document.activeElement).not.toBe(volume)
  })

  it('stays where it is for someone who presses a button with Enter', () => {
    startApp()
    const sustain = within(menu()).getByRole('switch', { name: 'Sustain' })
    pressEnterOn(sustain)
    expect(document.activeElement).toBe(sustain)
    expect(settingsStore.get().sustain).toBe(true)
  })

  it('goes into Settings opened with Enter, and back to its button at Escape', () => {
    startApp()
    pressEnterOn(button('Settings'))
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(settings.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(settings)

    tap('Escape')
    expect(document.activeElement).toBe(button('Settings'))
  })

  it('goes to the Settings button when choosing keys ends while a piano key has it', () => {
    startApp()
    openSettingsOn('Keys')
    pianoKey(64).focus()
    expect(document.activeElement).toBe(pianoKey(64))

    tap('Escape')
    expect(document.activeElement).toBe(button('Settings'))
  })

  it('goes to the Songs button when Enter on "Close" takes the player line away', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    pressEnterOn(button('Close'))

    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()
    expect(document.activeElement).toBe(button('Songs'))
  })

  it('is not put on the Songs button when "Close" is clicked with the mouse', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    clickWithMouse(button('Close'))
    expect(document.activeElement).toBe(document.body)
  })

  describe('when a panel was opened with the mouse and is then used with the keyboard', () => {
    it('goes to the Settings button when Escape closes the panel under a focused control', () => {
      startApp()
      const settings = openSettingsOn('Sound')
      within(settings).getByRole('slider', { name: 'Volume' }).focus()

      tap('Escape')
      expect(panel('Settings')).toBeNull()
      expect(document.activeElement).toBe(button('Settings'))
    })

    it.each(['Settings', 'Songs'] as const)('goes to the %s button at Enter on "Close"', (name) => {
      startApp()
      openPanel(name)
      pressEnterOn(button(`Close ${name}`))

      expect(panel(name)).toBeNull()
      expect(document.activeElement).toBe(button(name))
    })

    it('goes to the Songs button when Enter on "Play" closes the Songs panel', () => {
      startApp()
      const songs = openPanel('Songs')
      pressEnterOn(within(songs).getByRole('button', { name: /^Play Twinkle/ }))

      expect(panel('Songs')).toBeNull()
      expect(document.activeElement).toBe(button('Songs'))
    })

    it('stays in the menu, which therefore does not hide', () => {
      vi.useFakeTimers()
      startApp()
      openPanel('Settings')
      pressEnterOn(button('Close Settings'))

      act(() => {
        vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 4)
      })
      expect(document.activeElement).toBe(button('Settings'))
      expect(menu().className).toBe('menu')
    })
  })

  describe('when a panel was only ever used with the mouse', () => {
    it('is left nowhere when Escape closes the panel, which held it itself', () => {
      startApp()
      const settings = openPanel('Settings')
      expect(document.activeElement).toBe(settings)

      tap('Escape')
      expect(document.activeElement).toBe(document.body)
    })

    it.each(['Settings', 'Songs'] as const)(
      'is left nowhere after a click on "Close %s" or on the empty sky',
      (name) => {
        startApp()
        openPanel(name)
        clickWithMouse(button(`Close ${name}`))
        expect(document.activeElement).toBe(document.body)

        // A control of the panel has the focus when the sky is clicked.
        openPanel(name)
        button(`Close ${name}`).focus()
        clickWithMouse(emptySky())
        expect(panel(name)).toBeNull()
        expect(document.activeElement).toBe(document.body)
      },
    )
  })
})

describe('React work per note', () => {
  it('leaves the menu and the panels alone: only the stage follows the notes', () => {
    startApp()
    const settings = openSettingsOn('Sound')
    const records: MutationRecord[] = []
    const observer = new MutationObserver((batch) => {
      records.push(...batch)
    })
    const everything = { attributes: true, childList: true, characterData: true, subtree: true }
    observer.observe(menu(), everything)
    observer.observe(settings, everything)

    tap('KeyA')
    tap('KeyK')
    records.push(...observer.takeRecords())
    observer.disconnect()

    expect(records).toEqual([])
  })
})
