// @vitest-environment jsdom
/**
 * The menu at the top of the whole app: when it hides, what keeps it on
 * screen (the mouse over it, the keyboard focus inside it, the start box, a
 * panel, a song that is loaded but not playing), the Tab key that brings it
 * back, and the mouse cursor that hides with it.
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

/** Draws the app and starts it: the first key press takes the start box away. */
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

function panel(name: 'Settings' | 'Songs'): HTMLElement | null {
  return screen.queryByRole('dialog', { name })
}

/** The start box: the small menu the app opens with, and that the Menu button opens again. */
function startBox(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Menu' })
}

/** The line of the start box that opens each panel. */
const LINE_OF = { Settings: 'Settings', Songs: 'All songs…' } as const

/** Opens a panel with the mouse: the Menu button, then the panel's line of the start box. */
function openPanel(name: 'Settings' | 'Songs'): HTMLElement {
  if (!startBox()) clickWithMouse(button('Menu'))
  clickWithMouse(button(LINE_OF[name]))
  return screen.getByRole('dialog', { name })
}

/** Opens a panel with the keyboard alone: Enter on "Menu", then Enter on the panel's line. */
function openPanelWithEnter(name: 'Settings' | 'Songs'): HTMLElement {
  if (!startBox()) pressEnterOn(button('Menu'))
  pressEnterOn(button(LINE_OF[name]))
  return screen.getByRole('dialog', { name })
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

/**
 * What the page hears after the part of the menu under the mouse was taken off
 * the page. A browser sends no "mouse out" for an element that is gone, so
 * nothing tells the menu that the mouse has left it. What comes instead
 * depends on the browser, and on whether the mouse moves: a menu that only
 * coped with one of these would stay on screen for good after the others.
 * `from` is the part of the menu the mouse was over.
 */
const AFTER_THE_MENU_CHANGED_UNDER_THE_MOUSE: readonly [string, (from: Element) => void][] = [
  [
    'the mouse moves on over the sky',
    (from) => {
      // The menu is left (told to the menu alone), the sky is entered, and the mouse is somewhere new.
      fireEvent(menu(), new MouseEvent('mouseleave', { bubbles: false, relatedTarget: sky() }))
      fireEvent.mouseOver(sky(), { relatedTarget: from })
      mouseX += 7
      fireEvent.mouseMove(sky(), { screenX: mouseX, screenY: 300 })
    },
  ],
  [
    'the mouse stands still, and the browser sends a "move" to where it already is',
    () => fireEvent.mouseMove(sky(), { screenX: mouseX, screenY: 300 }),
  ],
  [
    'the mouse stands still, and the browser only says that it is over the sky now',
    (from) => fireEvent.mouseOver(sky(), { relatedTarget: from }),
  ],
]

describe('the menu stays while the mouse is over it', () => {
  it('over the top bar, and hides 2.5 seconds after the mouse has left it', () => {
    startApp()
    moveMouse(sky(), button('Menu'))
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    moveMouse(button('Menu'), sky())
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
    moveMouse(sky(), button('Restart'))
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    moveMouse(button('Restart'), sky())
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)
  })

  // "Stop" is in the player line, which goes away under the mouse: the mouse
  // is then over the sky, and the menu must hide like any other time.
  it.each(AFTER_THE_MENU_CHANGED_UNDER_THE_MOUSE)(
    'hides again after a song was closed with the mouse, which is then over the sky (%s)',
    (_what, browserSays) => {
      startApp()
      act(() => {
        playSong(A_STARTER_SONG)
      })
      const close = button('Stop')
      moveMouse(sky(), close)
      wait(AUTO_HIDE_DELAY_MS * 2)
      expect(isHidden()).toBe(false)

      clickWithMouse(close)
      expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()
      browserSays(menu())

      wait(AUTO_HIDE_DELAY_MS - 1)
      expect(isHidden()).toBe(false)
      wait(1)
      expect(isHidden()).toBe(true)
      expect(root().className).toBe('app cursor-hidden')
    },
  )

  it('is seen under a mouse that was already resting on it when the app started', () => {
    // Until the app started, the window around the start box covered the menu:
    // the mouse never "entered" it. The first thing the page hears is a move
    // over the bar.
    startApp()
    mouseX += 7
    fireEvent.mouseMove(button('Menu'), { screenX: mouseX, screenY: 300 })
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)
  })
})

describe('the menu and the full-screen line of the start box', () => {
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

  /** The start box, opened with a click on the Menu button, which the mouse then leaves. */
  function openStartBox(): HTMLElement {
    moveMouse(sky(), button('Menu'))
    clickWithMouse(button('Menu'))
    const box = startBox() as HTMLElement
    moveMouse(button('Menu'), box)
    return box
  }

  it('has the line in the foot of the box, and it lets go of the keyboard after a click', () => {
    startApp()
    const box = openStartBox()
    const foot = [...box.querySelectorAll('.start-box__foot button')]
    const fullScreen = button('Full screen')
    expect(foot.map((line) => line.textContent)).toEqual(['Settings', 'Full screen', 'About'])
    expect(foot[1]).toBe(fullScreen)
    expect(menu().contains(fullScreen)).toBe(false)

    clickWithMouse(fullScreen)
    expect(document.activeElement).toBe(document.body)
    browserShows(document.documentElement)
    expect(button('Leave full screen')).toBe(fullScreen)
    // The box stays: the player is still choosing.
    expect(startBox()).toBe(box)
  })

  // The line is in the start box, not in the menu: when the screen is filled
  // and the line changes its picture, nothing of the menu goes away under the
  // mouse. What keeps the menu then is the box, which stays open after the
  // click. Once the box has closed, the menu hides like any other time.
  it('keeps the menu on screen after a click on the line, until a note has closed the box', () => {
    startApp()
    const box = openStartBox()
    const fullScreen = button('Full screen')
    const picture = fullScreen.querySelector('path') as SVGPathElement
    moveMouse(box, picture)
    fireEvent.click(picture, { detail: 1 })
    browserShows(document.documentElement)
    // The line shows another picture now: the one that was clicked is off the page.
    expect(picture.isConnected).toBe(false)

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(startBox()).toBe(box)
    expect(isHidden()).toBe(false)

    // A note is played: the box goes away, and nothing keeps the menu any more.
    tap('KeyA')
    expect(startBox()).toBeNull()
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
  })

  it('lets the menu hide once a press on the sky has closed the box, in full screen too', () => {
    startApp()
    const box = openStartBox()
    const fullScreen = button('Full screen')
    moveMouse(box, fullScreen)
    clickWithMouse(fullScreen)
    browserShows(document.documentElement)
    // The mouse leaves the line for the sky: the box is still open, and still keeps the menu.
    moveMouse(fullScreen, sky())

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(startBox()).toBe(box)
    expect(isHidden()).toBe(false)

    // A press of the mouse on the sky, where the mouse is, closes the box.
    fireEvent.pointerDown(sky())
    fireEvent.mouseDown(sky())
    fireEvent.click(sky(), { detail: 1 })
    expect(startBox()).toBeNull()
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
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
    // The first control of the menu.
    expect(document.activeElement).toBe(button('Menu'))
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

  it('until Escape lets go of it: the menu then hides like any other time, and Tab brings it back', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    // A slip onto Tab while playing: the menu is back, with the focus on "Menu".
    tap('Tab', { key: 'Tab' })
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(false)

    expect(key('keydown', 'Escape').defaultPrevented).toBe(true)
    key('keyup', 'Escape')
    expect(document.activeElement).toBe(document.body)
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
    expect(root().className).toBe('app cursor-hidden')

    // With nothing left to take back, Escape is the browser's. Tab still brings the menu back.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
    key('keyup', 'Escape')
    expect(isHidden()).toBe(true)
    tap('Tab', { key: 'Tab' })
    expect(isHidden()).toBe(false)
    expect(document.activeElement).toBe(button('Menu'))
  })

  it.each<[string, () => void]>([
    ['a panel', () => void openPanelWithEnter('Settings')],
    ['the start box', () => pressEnterOn(button('Menu'))],
  ])(
    'through an Escape that is held down after it closed %s: only a new press lets go',
    (_what, openWithEnter) => {
      startApp()
      openWithEnter()
      expect(menu().contains(document.activeElement)).toBe(false)
      key('keydown', 'Escape')
      for (let repeat = 0; repeat < 5; repeat++) key('keydown', 'Escape', { repeat: true })
      key('keyup', 'Escape')
      expect(panel('Settings')).toBeNull()
      expect(startBox()).toBeNull()
      // What had the focus is gone: the Menu button has it now.
      expect(document.activeElement).toBe(button('Menu'))
      wait(AUTO_HIDE_DELAY_MS * 2)
      expect(isHidden()).toBe(false)

      tap('Escape')
      expect(document.activeElement).toBe(document.body)
      wait(AUTO_HIDE_DELAY_MS)
      expect(isHidden()).toBe(true)
    },
  )

  it('and after Escape let go of it, for as long as something else keeps the menu', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    act(() => player.pause())
    button('Play').focus()

    tap('Escape')
    expect(document.activeElement).toBe(document.body)
    // A song that is loaded and not playing keeps the menu; Escape is not a button of the player.
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
    expect(player.getState().status).toBe('paused')

    // The mouse over the bar keeps it too, once the song plays again.
    act(() => player.play())
    button('Pause').focus()
    moveMouse(sky(), button('Pause'))
    tap('Escape')
    expect(document.activeElement).toBe(document.body)
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)

    moveMouse(button('Pause'), sky())
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)
  })

  it('when Escape closed a panel that was opened with Enter: the focus is on "Menu"', () => {
    startApp()
    const settings = openPanelWithEnter('Settings')
    expect(settings.contains(document.activeElement)).toBe(true)

    tap('Escape')
    expect(panel('Settings')).toBeNull()
    expect(document.activeElement).toBe(button('Menu'))

    // Nothing is touched: the focus is in the menu, so the menu stays.
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(document.activeElement).toBe(button('Menu'))
    expect(isHidden()).toBe(false)
  })

  it('when the panel was closed with Enter on its own close button', () => {
    startApp()
    openPanelWithEnter('Songs')
    pressEnterOn(button('Close Songs'))
    expect(document.activeElement).toBe(button('Menu'))

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when Enter on "Play" closed the Songs panel and the song plays', () => {
    startApp()
    const songs = openPanelWithEnter('Songs')
    pressEnterOn(within(songs).getByRole('button', { name: /^Play Twinkle/ }))
    expect(panel('Songs')).toBeNull()
    expect(player.getState().status).toBe('playing')
    expect(document.activeElement).toBe(button('Menu'))

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when Enter on a song of the start box closed the box and the song plays', () => {
    startApp()
    pressEnterOn(button('Menu'))
    pressEnterOn(button(/^Play Twinkle/))
    expect(startBox()).toBeNull()
    expect(player.getState().status).toBe('playing')
    expect(document.activeElement).toBe(button('Menu'))

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when Enter on "Free Play" closed the start box', () => {
    startApp()
    pressEnterOn(button('Menu'))
    expect(document.activeElement).toBe(button(/Free Play/))
    pressEnterOn(button(/Free Play/))
    expect(startBox()).toBeNull()
    expect(document.activeElement).toBe(button('Menu'))

    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when choosing keys ended with the focus on a piano key, which goes to "Menu"', () => {
    startApp()
    const settings = openPanel('Settings')
    clickWithMouse(within(settings).getByRole('tab', { name: 'Keys' }))
    const pianoKey = document.querySelector('.piano-key[data-midi="64"]') as HTMLElement
    pianoKey.focus()

    tap('Escape')
    expect(document.activeElement).toBe(button('Menu'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)
  })

  it('when Enter on "Stop" took the player line away, and the focus went to "Menu"', () => {
    startApp()
    act(() => {
      playSong(A_STARTER_SONG)
    })
    pressEnterOn(button('Stop'))
    expect(document.activeElement).toBe(button('Menu'))

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

  it.each<[string, () => void]>([
    ['the start box', () => clickWithMouse(button('Menu'))],
    ['Settings', () => void openPanel('Settings')],
    ['Songs', () => void openPanel('Songs')],
  ])('while %s is open, however long', (_what, open) => {
    startApp()
    open()
    wait(AUTO_HIDE_DELAY_MS * 10)
    expect(isHidden()).toBe(false)
    expect(root().className).toBe('app')
  })

  it('while the start box and the panels take the place of one another', () => {
    startApp()
    // Each panel is opened from the start box, which the Menu button puts in its place.
    for (const line of ['Settings', 'All songs…', 'Settings']) {
      clickWithMouse(button('Menu'))
      wait(AUTO_HIDE_DELAY_MS * 2)
      expect(isHidden()).toBe(false)
      clickWithMouse(button(line))
      wait(AUTO_HIDE_DELAY_MS * 2)
      expect(isHidden()).toBe(false)
    }
    expect(panel('Settings')).not.toBeNull()
  })

  it('no longer once the start box has closed: the menu then hides after 2.5 seconds', () => {
    startApp()
    clickWithMouse(button('Menu'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(isHidden()).toBe(false)

    // Escape closes the box, which held the focus itself: nothing is left in the menu.
    tap('Escape')
    expect(startBox()).toBeNull()
    wait(AUTO_HIDE_DELAY_MS - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)
    expect(root().className).toBe('app cursor-hidden')
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

    pressEnterOn(button('Stop'))
    expect(document.activeElement).toBe(button('Menu'))
    act(() => button('Menu').blur())
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
    expect(document.activeElement).toBe(button('Menu'))
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

describe('the countdown of the menu', () => {
  // That the menu never has more than one countdown waiting, and none while it
  // is hidden or has a reason to stay, is counted on its own clock in
  // src/ui/useAutoHide.shell.test.ts. Here: what the player sees of it.
  it('starts again at every move of the mouse, and is not put off by playing the piano', () => {
    startApp()
    wait(AUTO_HIDE_DELAY_MS)
    expect(isHidden()).toBe(true)

    // Twenty moves, a tenth of a second apart: the menu is back at the first one.
    for (let move = 0; move < 20; move++) {
      moveMouse(null, sky())
      expect(isHidden()).toBe(false)
      wait(100)
    }
    // 2.5 seconds after the first move, which is 0.5 seconds after the last one, it is still there.
    wait(500)
    expect(isHidden()).toBe(false)

    // A note and Space: the piano is played, the mouse has not moved.
    tap('KeyA')
    tap('Space')
    wait(AUTO_HIDE_DELAY_MS - 100 - 500 - 1)
    expect(isHidden()).toBe(false)
    wait(1)
    expect(isHidden()).toBe(true)

    // Once hidden it stays hidden, however long nothing moves and whatever is played.
    tap('KeyA')
    tap('Space')
    wait(AUTO_HIDE_DELAY_MS * 4)
    expect(isHidden()).toBe(true)
    expect(root().className).toBe('app cursor-hidden')
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
    // Nothing is open and the focus is not in the menu: Escape is left to the browser.
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false)
    key('keyup', 'Escape')
    expect(root().className).toBe('app cursor-hidden')
    expect(isHidden()).toBe(true)
  })

  it('is never hidden while the app waits to start, or with the start box or a panel open', () => {
    render(<App />)
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(root().className).toBe('app')
    tap('Enter')
    clickWithMouse(button('Menu'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(root().className).toBe('app')
    clickWithMouse(button('Settings'))
    wait(AUTO_HIDE_DELAY_MS * 2)
    expect(root().className).toBe('app')
  })
})
