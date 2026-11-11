// @vitest-environment jsdom
/**
 * The menu at the top of the whole app: when it hides, what keeps it on
 * screen (the mouse over it, the keyboard focus inside it, a panel, a song
 * that is loaded but not playing), the Tab key that brings it back, and the
 * mouse cursor that hides with it.
 *
 * These go through the real app, because what keeps the menu depends on how
 * the pieces hand the mouse and the focus to each other. The sound engine and
 * the sky are stand-ins.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { AUTO_HIDE_DELAY_MS } from './ui/useAutoHide'
import { playSong } from './ui/useSongs'

const A_STARTER_SONG = 'starter:twinkle-twinkle-little-star'

beforeEach(async () => {
  await resetSongs()
  bus.allOff()
  audio.state.status = 'idle'
  audio.state.starts = 0
  vi.useFakeTimers()
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

function tap(code: string, init: KeyboardEventInit = {}): void {
  key('keydown', code, init)
  key('keyup', code, init)
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

function sky(): HTMLElement {
  return document.querySelector('.stage__sky') as HTMLElement
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function wait(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds)
  })
}

function isHidden(): boolean {
  return menu().classList.contains('menu--hidden')
}

let mouseX = 0

/**
 * The mouse goes from one element to another, as a browser reports it: it
 * leaves the first (when that one is still on the page), enters the second,
 * and has moved.
 */
function moveMouse(from: Element | null, to: Element): void {
  mouseX += 7
  if (from?.isConnected) fireEvent.mouseOut(from, { relatedTarget: to })
  fireEvent.mouseOver(to, { relatedTarget: from?.isConnected ? from : null })
  fireEvent.mouseMove(to, { screenX: mouseX, screenY: 300 })
}

describe('the menu stays while the mouse is over it', () => {
  it('over the top bar, and hides 2.5 seconds after the mouse has left it', () => {
    startApp()
    moveMouse(sky(), button('Songs'))
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    moveMouse(button('Songs'), sky())
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
    expect(root().className).toBe('app cursor-hidden')
  })

  it('over the player line of a song that is playing', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    moveMouse(sky(), button('Stop'))
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    moveMouse(button('Stop'), sky())
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)
  })

  it('hides again after a song was closed with the mouse, once the mouse is over the sky', () => {
    // "Close" is in the player line, which goes away under the mouse. A
    // browser sends no "mouse out" for an element that is no longer on the
    // page: the next thing the page hears is the mouse arriving on what is
    // now under it (the sky), coming from the menu. From then on the mouse
    // is not over the menu, and it must hide like any other time.
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    const close = button('Close')
    moveMouse(sky(), close)
    clickWithMouse(close)
    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()

    // What Chrome sends next: the menu is left (told to the menu alone), the sky is entered.
    fireEvent(menu(), new MouseEvent('mouseleave', { bubbles: false, relatedTarget: sky() }))
    fireEvent.mouseOver(sky(), { relatedTarget: menu() })
    fireEvent.mouseMove(sky(), { screenX: 600, screenY: 420 })

    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)
    expect(root().className).toBe('app cursor-hidden')
  })
})

describe('the menu and the full-screen button', () => {
  /** The element the make-believe browser is showing full screen, or null. */
  let fullscreenElement: Element | null = null

  beforeEach(() => {
    fullscreenElement = null
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true })
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    document.documentElement.requestFullscreen = () => Promise.resolve()
    document.exitFullscreen = () => Promise.resolve()
  })

  afterEach(() => {
    const page = document as unknown as Record<string, unknown>
    delete page.fullscreenEnabled
    delete page.fullscreenElement
    delete page.exitFullscreen
    delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen
  })

  function browserShows(element: Element | null): void {
    act(() => {
      fullscreenElement = element
      document.dispatchEvent(new Event('fullscreenchange'))
    })
  }

  it('has the button at the end of the bar, and it lets go of the keyboard after a click', () => {
    startApp()
    const controls = [...menu().querySelectorAll('button')]
    const fullScreen = button('Full screen')
    expect(controls[controls.length - 1]).toBe(fullScreen)

    clickWithMouse(fullScreen)
    expect(document.activeElement).toBe(document.body)
    browserShows(document.documentElement)
    expect(button('Leave full screen')).toBe(fullScreen)
  })

  it('hides after full screen was started with the mouse, once the mouse is over the sky', () => {
    // The button changes its picture when the screen is filled, so the
    // picture the mouse was on is taken off the page. In full screen the page
    // has moved up under the mouse, which is now over the sky. As after
    // "Close" above, the browser sends no "mouse out" for the picture that
    // is gone: it only says that the sky is entered, coming from the button.
    startApp()
    const fullScreen = button('Full screen')
    const picture = fullScreen.querySelector('path') as SVGPathElement
    moveMouse(sky(), picture)
    fireEvent.click(picture, { detail: 1 })
    browserShows(document.documentElement)
    expect(picture.isConnected).toBe(false)

    fireEvent(menu(), new MouseEvent('mouseleave', { bubbles: false, relatedTarget: sky() }))
    fireEvent.mouseOver(sky(), { relatedTarget: fullScreen })
    fireEvent.mouseMove(sky(), { screenX: 1500, screenY: 130 })

    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)
  })
})

describe('the menu stays while the keyboard focus is inside it', () => {
  it('after Tab brought it back, for as long as the focus stays', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)

    const press = key('keydown', 'Tab', { key: 'Tab' })
    expect(press.defaultPrevented).toBe(true)
    expect(isHidden()).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Free Play' }))
    expect(root().className).toBe('app')

    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
  })

  it('and still lets the piano play, without a note for the Tab key', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    tap('Tab', { key: 'Tab' })
    expect([...bus.getActiveNotes()]).toEqual([])

    key('keydown', 'KeyA')
    expect([...bus.getActiveNotes()]).toEqual([60])
    key('keyup', 'KeyA')
    expect([...bus.getActiveNotes()]).toEqual([])
  })

  it('hides 2.5 seconds after a click elsewhere took the focus out of it', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    tap('Tab', { key: 'Tab' })
    const focused = document.activeElement as HTMLElement

    // A press on the sky: the browser takes the focus off the menu.
    fireEvent.mouseDown(sky())
    act(() => focused.blur())
    fireEvent.click(sky(), { detail: 1 })

    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
  })

  it('when Escape closed a panel that was opened with Enter: the focus is back on its button', () => {
    startApp()
    pressEnterOn(button('Settings'))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()

    tap('Escape')
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
    expect(document.activeElement).toBe(button('Settings'))

    // Nothing is touched: the focus is in the menu, so the menu stays.
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(document.activeElement).toBe(button('Settings'))
    expect(isHidden()).toBe(false)
  })

  it('when the panel was closed with Enter on its own close button', () => {
    startApp()
    pressEnterOn(button('Songs'))
    pressEnterOn(button('Close Songs'))
    expect(document.activeElement).toBe(button('Songs'))

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when Enter on "Play" closed the Songs panel and the song plays', () => {
    startApp()
    pressEnterOn(button('Songs'))
    const songs = screen.getByRole('dialog', { name: 'Songs' })
    pressEnterOn(within(songs).getByRole('button', { name: /^Play Twinkle/ }))
    expect(player.getState().status).toBe('playing')
    expect(document.activeElement).toBe(button('Songs'))

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when choosing keys ended with the focus on a piano key, which goes to "Settings"', () => {
    startApp()
    clickWithMouse(button('Settings'))
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    clickWithMouse(within(settings).getByRole('tab', { name: 'Keys' }))
    const pianoKey = document.querySelector('.piano-key[data-midi="64"]') as HTMLElement
    pianoKey.focus()

    tap('Escape')
    expect(document.activeElement).toBe(button('Settings'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when Enter on "Close" took the player line away, and the focus went to "Songs"', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    pressEnterOn(button('Close'))
    expect(document.activeElement).toBe(button('Songs'))

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })
})

describe('the menu is pinned', () => {
  it('before the app is started, whatever the mouse does', () => {
    render(<App />)
    moveMouse(null, document.body)
    wait(AUTO_HIDE_DELAY_MS * 2)
    moveMouse(null, document.body)
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
    expect(root().className).toBe('app')
  })

  it('from the start of the app for a full 2.5 seconds, not from when the page was drawn', () => {
    render(<App />)
    wait(AUTO_HIDE_DELAY_MS * 3)
    tap('Enter')
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
  })

  it.each(['Settings', 'Songs'] as const)('while %s is open, however long', (name) => {
    startApp()
    clickWithMouse(button(name))
    wait(AUTO_HIDE_DELAY_MS * 10)
    expect(isHidden()).toBe(false)
    expect(root().className).toBe('app')
  })

  it('while one panel takes the place of the other', () => {
    startApp()
    clickWithMouse(button('Settings'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    clickWithMouse(button('Songs'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    clickWithMouse(button('Settings'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when a song that was playing with the menu hidden comes to its end', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)

    act(() => player.seek(player.getState().duration))
    wait(50)
    expect(player.getState().status).toBe('stopped')
    expect(isHidden()).toBe(false)
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
  })

  it('no longer once the paused song is closed and the focus has left the menu', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    act(() => player.pause())
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)

    pressEnterOn(button('Close'))
    expect(document.activeElement).toBe(button('Songs'))
    act(() => button('Songs').blur())
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
  })
})

describe('Tab, pressed while the menu is hidden', () => {
  it('brings the menu back during a song, with the focus on its first control', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)

    expect(key('keydown', 'Tab', { key: 'Tab' }).defaultPrevented).toBe(true)
    expect(isHidden()).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Free Play' }))
    expect(player.getState().status).toBe('playing')
  })

  it('is left to the browser while the menu is shown', () => {
    startApp()
    expect(key('keydown', 'Tab', { key: 'Tab' }).defaultPrevented).toBe(false)
  })

  it('is left to the browser with Ctrl or Alt held (they switch tabs and windows)', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    expect(key('keydown', 'Tab', { key: 'Tab', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(key('keydown', 'Tab', { key: 'Tab', altKey: true }).defaultPrevented).toBe(false)
    expect(isHidden()).toBe(true)
  })

  it('is not needed when the player switched hiding off: the menu is there', () => {
    act(() => settingsStore.set({ autoHideMenu: false }))
    startApp()
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
    expect(key('keydown', 'Tab', { key: 'Tab' }).defaultPrevented).toBe(false)
    expect(root().className).toBe('app')
  })
})

describe('an idle screen', () => {
  it('runs no timer once the menu has hidden, and one countdown at most while it is shown', () => {
    startApp()
    expect(vi.getTimerCount()).toBe(1)
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    tap('KeyA')
    tap('Space')
    expect(vi.getTimerCount()).toBe(0)

    for (let move = 0; move < 20; move++) moveMouse(null, sky())
    expect(vi.getTimerCount()).toBe(1)
    wait(AUTO_HIDE_DELAY_MS)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the mouse cursor', () => {
  it('comes back with a press of the mouse, so that nobody clicks blind', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    expect(root().className).toBe('app cursor-hidden')

    fireEvent.mouseDown(sky())
    expect(root().className).toBe('app')
  })

  it('stays hidden while the piano is played with the keyboard', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    tap('KeyA')
    tap('KeyK')
    tap('Escape')
    expect(root().className).toBe('app cursor-hidden')
    expect(isHidden()).toBe(true)
  })

  it('is never hidden while a panel is open or the start overlay is up', () => {
    render(<App />)
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(root().className).toBe('app')
    tap('Enter')
    clickWithMouse(button('Settings'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(root().className).toBe('app')
  })
})
