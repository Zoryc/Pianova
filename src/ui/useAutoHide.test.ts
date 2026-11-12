// @vitest-environment jsdom
/**
 * When the menu hides and when it comes back.
 *
 * The rules are tried first on their own, with a clock that only moves when
 * the test says so. Then the hook is tried on a small page, to see that the
 * mouse, the Tab key and the focus reach those rules.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, createElement, useLayoutEffect } from 'react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_HIDE_DELAY_MS, controlsIn, createAutoHide, useAutoHide } from './useAutoHide'
import type { AutoHide, AutoHideOptions, AutoHideTimer } from './useAutoHide'

const DELAY = AUTO_HIDE_DELAY_MS

/** A clock that stands still until `advance` is called. */
function fakeClock(): { timer: AutoHideTimer; advance(ms: number): void; waiting(): number } {
  let now = 0
  let lastHandle = 0
  const waiting = new Map<number, { due: number; handler: () => void }>()

  function nextDue(until: number): number | undefined {
    let next: number | undefined
    for (const [handle, { due }] of waiting) {
      if (due <= until && (next === undefined || due < (waiting.get(next)?.due ?? 0))) next = handle
    }
    return next
  }

  return {
    timer: {
      setTimeout(handler, ms) {
        lastHandle += 1
        waiting.set(lastHandle, { due: now + ms, handler })
        return lastHandle
      },
      clearTimeout(handle) {
        waiting.delete(handle as number)
      },
    },
    advance(ms) {
      const until = now + ms
      for (let handle = nextDue(until); handle !== undefined; handle = nextDue(until)) {
        const { due, handler } = waiting.get(handle) ?? { due: until, handler: () => undefined }
        waiting.delete(handle)
        now = due
        handler()
      }
      now = until
    },
    waiting: () => waiting.size,
  }
}

interface Rig {
  autoHide: AutoHide
  /** Every change reported so far, oldest first. */
  changes: boolean[]
  advance(ms: number): void
  /** How many countdowns are running. */
  waiting(): number
}

function rig(options: Partial<AutoHideOptions> = {}): Rig {
  const clock = fakeClock()
  const changes: boolean[] = []
  const autoHide = createAutoHide(
    { enabled: true, pinned: false, ...options },
    (visible) => changes.push(visible),
    clock.timer,
  )
  return { autoHide, changes, advance: clock.advance, waiting: clock.waiting }
}

describe('createAutoHide: the mouse', () => {
  it('starts shown and hides 2.5 seconds later', () => {
    const { autoHide, changes, advance } = rig()
    expect(DELAY).toBe(2500)
    expect(autoHide.isVisible()).toBe(true)

    advance(DELAY - 1)
    expect(autoHide.isVisible()).toBe(true)
    expect(changes).toEqual([])

    advance(1)
    expect(autoHide.isVisible()).toBe(false)
    expect(changes).toEqual([false])
  })

  it('counts from the last movement, not from the first', () => {
    const { autoHide, advance } = rig()
    advance(2000)
    autoHide.activity()
    advance(2000)
    autoHide.activity()

    advance(DELAY - 1)
    expect(autoHide.isVisible()).toBe(true)
    advance(1)
    expect(autoHide.isVisible()).toBe(false)
  })

  it('comes back when the mouse moves, and hides again', () => {
    const { autoHide, changes, advance } = rig()
    advance(DELAY)
    autoHide.activity()
    expect(autoHide.isVisible()).toBe(true)
    advance(DELAY)
    expect(autoHide.isVisible()).toBe(false)
    expect(changes).toEqual([false, true, false])
  })

  it('reports a change only when there is one', () => {
    const { autoHide, changes, advance } = rig()
    for (let move = 0; move < 50; move += 1) {
      autoHide.activity()
      advance(100)
    }
    expect(changes).toEqual([])
    advance(60_000)
    expect(changes).toEqual([false])
  })

  it('never runs more than one countdown, and none once it is hidden', () => {
    const { autoHide, advance, waiting } = rig()
    for (let move = 0; move < 100; move += 1) autoHide.activity()
    expect(waiting()).toBe(1)
    advance(DELAY)
    expect(waiting()).toBe(0)
  })
})

describe('createAutoHide: reasons to stay', () => {
  const reasons = [
    ['the pointer is over the menu', (autoHide: AutoHide, on: boolean) => autoHide.setHovered(on)],
    ['the focus is inside the menu', (autoHide: AutoHide, on: boolean) => autoHide.setFocused(on)],
    ['something pins it', (autoHide: AutoHide, on: boolean) => autoHide.setPinned(on)],
  ] as const

  it.each(reasons)('stays while %s', (_name, set) => {
    const { autoHide, changes, advance, waiting } = rig()
    advance(1000)
    set(autoHide, true)
    expect(waiting()).toBe(0)
    advance(60_000)
    expect(autoHide.isVisible()).toBe(true)

    // When the reason goes, the menu gets the whole delay again.
    set(autoHide, false)
    advance(DELAY - 1)
    expect(autoHide.isVisible()).toBe(true)
    advance(1)
    expect(autoHide.isVisible()).toBe(false)
    expect(changes).toEqual([false])
  })

  it.each(reasons)('comes back at once when %s', (_name, set) => {
    const { autoHide, changes, advance } = rig()
    advance(DELAY)
    set(autoHide, true)
    expect(autoHide.isVisible()).toBe(true)
    advance(60_000)
    expect(changes).toEqual([false, true])
  })

  it('stays until the last reason has gone', () => {
    const { autoHide, advance } = rig()
    autoHide.setHovered(true)
    autoHide.setFocused(true)
    autoHide.setPinned(true)

    autoHide.setHovered(false)
    autoHide.setPinned(false)
    advance(60_000)
    expect(autoHide.isVisible()).toBe(true)

    autoHide.setFocused(false)
    advance(DELAY)
    expect(autoHide.isVisible()).toBe(false)
  })

  it('does not start a countdown when the mouse moves while it must stay', () => {
    const { autoHide, advance, waiting } = rig({ pinned: true })
    autoHide.activity()
    expect(waiting()).toBe(0)
    advance(60_000)
    expect(autoHide.isVisible()).toBe(true)
  })

  it('does not start again when it is told the same thing twice', () => {
    const { autoHide, advance } = rig()
    advance(2000)
    autoHide.setHovered(false)
    autoHide.setPinned(false)
    advance(500)
    expect(autoHide.isVisible()).toBe(false)
  })

  it('can start pinned (the start overlay is up)', () => {
    const { autoHide, advance, waiting } = rig({ pinned: true })
    expect(waiting()).toBe(0)
    advance(60_000)
    expect(autoHide.isVisible()).toBe(true)
    autoHide.setPinned(false)
    advance(DELAY)
    expect(autoHide.isVisible()).toBe(false)
  })
})

describe('createAutoHide: the setting that turns hiding off', () => {
  it('always shows the menu while it is off', () => {
    const { autoHide, changes, advance, waiting } = rig({ enabled: false })
    autoHide.activity()
    autoHide.setHovered(true)
    autoHide.setHovered(false)
    expect(waiting()).toBe(0)
    advance(60_000)
    expect(autoHide.isVisible()).toBe(true)
    expect(changes).toEqual([])
  })

  it('shows a hidden menu at once when it is switched off', () => {
    const { autoHide, changes, advance } = rig()
    advance(DELAY)
    autoHide.setEnabled(false)
    expect(autoHide.isVisible()).toBe(true)
    advance(60_000)
    expect(changes).toEqual([false, true])
  })

  it('hides after the delay when it is switched on', () => {
    const { autoHide, advance } = rig({ enabled: false })
    advance(60_000)
    autoHide.setEnabled(true)
    advance(DELAY - 1)
    expect(autoHide.isVisible()).toBe(true)
    advance(1)
    expect(autoHide.isVisible()).toBe(false)
  })
})

describe('createAutoHide: the end', () => {
  it('stops its countdown and says nothing more', () => {
    const { autoHide, changes, advance, waiting } = rig()
    autoHide.dispose()
    expect(waiting()).toBe(0)

    autoHide.activity()
    expect(waiting()).toBe(0)
    autoHide.setPinned(true)
    autoHide.setPinned(false)
    expect(waiting()).toBe(0)
    autoHide.setEnabled(false)
    advance(60_000)
    expect(changes).toEqual([])

    // Ending it twice is harmless.
    autoHide.dispose()
  })

  it("uses the page's own timers unless it is given others", () => {
    vi.useFakeTimers()
    try {
      const changes: boolean[] = []
      const autoHide = createAutoHide({ enabled: true, pinned: false }, (visible) =>
        changes.push(visible),
      )
      vi.advanceTimersByTime(DELAY - 1)
      expect(changes).toEqual([])
      vi.advanceTimersByTime(1)
      expect(changes).toEqual([false])

      autoHide.activity()
      autoHide.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

interface PageProps extends Partial<AutoHideOptions> {
  secondButton?: boolean
  /** Whether the page has a panel that gives the focus to the menu when it goes away. */
  panel?: boolean
}

/** A page with a menu of two buttons, and one button that is not part of the menu. */
function Page({ secondButton = true, panel = false, ...options }: PageProps): ReactElement {
  const menu = useAutoHide({ enabled: true, pinned: false, ...options })
  return createElement(
    'div',
    null,
    createElement(
      'header',
      { ...menu.menuProps, 'data-testid': 'menu', 'data-shown': String(menu.visible) },
      createElement('button', { type: 'button' }, 'First'),
      secondButton && createElement('button', { type: 'button' }, 'Second'),
    ),
    createElement('button', { type: 'button' }, 'Outside'),
    panel && createElement(PanelThatGivesTheFocusBack),
  )
}

/**
 * Like a panel of the app: as it is taken off the page it puts the keyboard
 * focus on a button of the menu. It does so from a clean-up that React runs
 * while it is changing the page, which is when React passes no events on.
 */
function PanelThatGivesTheFocusBack(): null {
  useLayoutEffect(() => () => button('First').focus(), [])
  return null
}

function isShown(): boolean {
  return screen.getByTestId('menu').getAttribute('data-shown') === 'true'
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

function focus(element: HTMLElement): void {
  act(() => element.focus())
}

describe('useAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the menu at first and hides it 2.5 seconds later', () => {
    render(createElement(Page))
    expect(isShown()).toBe(true)
    wait(DELAY - 1)
    expect(isShown()).toBe(true)
    wait(1)
    expect(isShown()).toBe(false)
  })

  it('brings it back when the mouse moves anywhere on the page', () => {
    render(createElement(Page))
    wait(DELAY)
    fireEvent.mouseMove(document.body, { screenX: 300, screenY: 200 })
    expect(isShown()).toBe(true)
    wait(DELAY)
    expect(isShown()).toBe(false)
  })

  it('does not take a mouse that stands still for one that moves', () => {
    render(createElement(Page))
    fireEvent.mouseMove(document.body, { screenX: 300, screenY: 200 })
    wait(2000)
    // What a browser sends when the page changes under the mouse: a "move" to where it already is.
    fireEvent.mouseMove(document.body, { screenX: 300, screenY: 200 })
    wait(500)
    expect(isShown()).toBe(false)

    fireEvent.mouseMove(document.body, { screenX: 300, screenY: 200 })
    expect(isShown()).toBe(false)
    fireEvent.mouseMove(document.body, { screenX: 300, screenY: 201 })
    expect(isShown()).toBe(true)
  })

  it('brings it back when a mouse button is pressed', () => {
    render(createElement(Page))
    wait(DELAY)
    fireEvent.mouseDown(document.body)
    expect(isShown()).toBe(true)
  })

  it('stays hidden while the piano is played with the computer keyboard', () => {
    render(createElement(Page))
    wait(DELAY)
    const keys = [
      ['a', 'KeyA'],
      [' ', 'Space'],
      ['Escape', 'Escape'],
      ['Shift', 'ShiftLeft'],
    ]
    for (const [key, code] of keys) {
      expect(fireEvent.keyDown(document.body, { key, code })).toBe(true)
      fireEvent.keyUp(document.body, { key, code })
    }
    expect(isShown()).toBe(false)
  })

  it('stays while the pointer is over the menu', () => {
    render(createElement(Page))
    fireEvent.mouseEnter(screen.getByTestId('menu'))
    wait(60_000)
    expect(isShown()).toBe(true)

    fireEvent.mouseLeave(screen.getByTestId('menu'))
    wait(DELAY - 1)
    expect(isShown()).toBe(true)
    wait(1)
    expect(isShown()).toBe(false)
  })

  it('sees that the mouse has left when what was under it is taken off the page', () => {
    const { rerender } = render(createElement(Page))
    fireEvent.mouseEnter(screen.getByTestId('menu'))
    fireEvent.mouseMove(button('Second'), { screenX: 40, screenY: 20 })
    // The button under the mouse goes away. Nothing tells the menu that the mouse has left it.
    rerender(createElement(Page, { secondButton: false }))

    // The mouse moves on, over the rest of the page.
    fireEvent.mouseMove(button('Outside'), { screenX: 41, screenY: 60 })
    wait(DELAY - 1)
    expect(isShown()).toBe(true)
    wait(1)
    expect(isShown()).toBe(false)
  })

  it('sees it also when the mouse stands still from then on', () => {
    const { rerender } = render(createElement(Page))
    fireEvent.mouseEnter(screen.getByTestId('menu'))
    fireEvent.mouseMove(button('Second'), { screenX: 40, screenY: 20 })
    rerender(createElement(Page, { secondButton: false }))

    // What a browser sends when the page changes under the mouse: a "move" to
    // where it already is, for what is under it now.
    fireEvent.mouseMove(button('Outside'), { screenX: 40, screenY: 20 })
    wait(DELAY - 1)
    expect(isShown()).toBe(true)
    wait(1)
    expect(isShown()).toBe(false)
  })

  it('sees it when the browser only says what the mouse is over now', () => {
    const { rerender } = render(createElement(Page))
    fireEvent.mouseEnter(screen.getByTestId('menu'))
    fireEvent.mouseMove(button('Second'), { screenX: 40, screenY: 20 })
    rerender(createElement(Page, { secondButton: false }))

    // Some browsers send no "move" at all for a mouse that stands still: only
    // that it is over something else, having come from the menu.
    fireEvent.mouseOver(button('Outside'), { relatedTarget: screen.getByTestId('menu') })
    wait(DELAY - 1)
    expect(isShown()).toBe(true)
    wait(1)
    expect(isShown()).toBe(false)
  })

  describe('when the browser names the menu itself as what the mouse is over', () => {
    /** The simulated page cannot say what is at a place. A browser can: here the test answers for it. */
    function pageSaysMouseIsOver(element: Element | null) {
      const lookUp = vi.fn((_x: number, _y: number) => element)
      document.elementFromPoint = lookUp
      return lookUp
    }

    afterEach(() => {
      Reflect.deleteProperty(document, 'elementFromPoint')
    })

    it('asks the page, and sees that the mouse is somewhere the menu no longer reaches', () => {
      const { rerender } = render(createElement(Page))
      const menu = screen.getByTestId('menu')
      fireEvent.mouseEnter(menu)
      fireEvent.mouseMove(button('Second'), { screenX: 40, screenY: 60 })
      // The button under the mouse goes away, and the menu gets shorter.
      rerender(createElement(Page, { secondButton: false }))

      // Chrome then names the menu in place of what went away, although the
      // mouse is now over the rest of the page; it may never say anything else.
      const lookUp = pageSaysMouseIsOver(button('Outside'))
      fireEvent.mouseOver(menu, { clientX: 40, clientY: 60, relatedTarget: menu })
      wait(DELAY - 1)
      expect(isShown()).toBe(true)
      wait(1)
      expect(isShown()).toBe(false)
      // The page was asked about the place the browser gave for the mouse.
      expect(lookUp).toHaveBeenCalledWith(40, 60)
    })

    it('keeps the menu when the page says so too: the mouse is between two of its controls', () => {
      render(createElement(Page))
      const menu = screen.getByTestId('menu')
      pageSaysMouseIsOver(menu)
      fireEvent.mouseOver(menu, { clientX: 200, clientY: 10 })
      wait(60_000)
      expect(isShown()).toBe(true)
    })

    it('does not ask the page about anything else: a control of the menu is the menu', () => {
      render(createElement(Page))
      const lookUp = pageSaysMouseIsOver(button('Outside'))
      fireEvent.mouseOver(button('First'), { clientX: 20, clientY: 10 })
      expect(lookUp).not.toHaveBeenCalled()
      wait(60_000)
      expect(isShown()).toBe(true)
    })

    it('takes the browser at its word where the page cannot be asked', () => {
      render(createElement(Page))
      fireEvent.mouseOver(screen.getByTestId('menu'), { clientX: 200, clientY: 10 })
      wait(60_000)
      expect(isShown()).toBe(true)
    })
  })

  it('sees a mouse that was on the menu before the page could hear it arrive', () => {
    render(createElement(Page))
    fireEvent.mouseMove(button('First'), { screenX: 40, screenY: 20 })
    wait(60_000)
    expect(isShown()).toBe(true)

    // A "move" to the same place says so too: the mouse is still over the menu.
    fireEvent.mouseMove(button('First'), { screenX: 40, screenY: 20 })
    wait(60_000)
    expect(isShown()).toBe(true)
  })

  it('sees where the mouse is when one of its buttons is pressed', () => {
    render(createElement(Page))
    fireEvent.mouseDown(button('First'))
    wait(60_000)
    expect(isShown()).toBe(true)

    fireEvent.mouseDown(button('Outside'))
    wait(DELAY)
    expect(isShown()).toBe(false)
  })

  it('stays while the keyboard focus is inside the menu', () => {
    render(createElement(Page))
    focus(button('First'))
    wait(60_000)
    expect(isShown()).toBe(true)

    // From one control of the menu to the next: still inside.
    focus(button('Second'))
    wait(60_000)
    expect(isShown()).toBe(true)

    focus(button('Outside'))
    wait(DELAY - 1)
    expect(isShown()).toBe(true)
    wait(1)
    expect(isShown()).toBe(false)
  })

  it('does not wait for ever for a focused control that was taken off the page', () => {
    const { rerender } = render(createElement(Page))
    focus(button('Second'))
    rerender(createElement(Page, { secondButton: false }))
    expect(document.activeElement).toBe(document.body)

    // The next thing the player does is enough to notice: here, a note.
    fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' })
    wait(DELAY)
    expect(isShown()).toBe(false)
  })

  it('stays while it is pinned, and for 2.5 seconds after', () => {
    const { rerender } = render(createElement(Page, { pinned: true }))
    wait(60_000)
    expect(isShown()).toBe(true)

    rerender(createElement(Page, { pinned: false }))
    wait(DELAY - 1)
    expect(isShown()).toBe(true)
    wait(1)
    expect(isShown()).toBe(false)

    rerender(createElement(Page, { pinned: true }))
    expect(isShown()).toBe(true)
  })

  it('stays when what pinned it goes away and leaves the keyboard focus inside the menu', () => {
    // A panel that closes: the menu is no longer pinned, and the panel has put
    // the focus on a button of the menu without the menu being told.
    const { rerender } = render(createElement(Page, { pinned: true, panel: true }))
    rerender(createElement(Page, { pinned: false, panel: false }))
    expect(document.activeElement).toBe(button('First'))

    wait(60_000)
    expect(isShown()).toBe(true)

    focus(button('Outside'))
    wait(DELAY - 1)
    expect(isShown()).toBe(true)
    wait(1)
    expect(isShown()).toBe(false)
  })

  it('never hides while the setting is off', () => {
    const { rerender } = render(createElement(Page, { enabled: false }))
    fireEvent.mouseMove(document.body, { screenX: 1, screenY: 1 })
    wait(60_000)
    expect(isShown()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    rerender(createElement(Page, { enabled: true }))
    wait(DELAY)
    expect(isShown()).toBe(false)

    rerender(createElement(Page, { enabled: false }))
    expect(isShown()).toBe(true)
  })

  describe('Tab', () => {
    it('brings a hidden menu back and puts the focus on its first control', () => {
      render(createElement(Page))
      wait(DELAY)
      const leftToBrowser = fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' })
      expect(leftToBrowser).toBe(false)
      expect(isShown()).toBe(true)
      expect(document.activeElement).toBe(button('First'))

      // The focus is inside it now, so it stays.
      wait(60_000)
      expect(isShown()).toBe(true)
    })

    it('keeps the menu when the focused control cannot say that it has the focus', () => {
      // A window that is not in front moves the focus without sending the event.
      const silence = (event: Event): void => event.stopPropagation()
      window.addEventListener('focusin', silence, true)
      try {
        render(createElement(Page))
        wait(DELAY)
        fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' })
        expect(document.activeElement).toBe(button('First'))
        wait(60_000)
        expect(isShown()).toBe(true)
      } finally {
        window.removeEventListener('focusin', silence, true)
      }
    })

    it('does the same with Shift held', () => {
      render(createElement(Page))
      wait(DELAY)
      const shiftTab = { key: 'Tab', code: 'Tab', shiftKey: true }
      expect(fireEvent.keyDown(document.body, shiftTab)).toBe(false)
      expect(document.activeElement).toBe(button('First'))
    })

    it('is left to the browser while the menu is shown', () => {
      render(createElement(Page))
      focus(button('Outside'))
      expect(fireEvent.keyDown(button('Outside'), { key: 'Tab', code: 'Tab' })).toBe(true)
      expect(document.activeElement).toBe(button('Outside'))
    })

    it.each(['ctrlKey', 'altKey', 'metaKey'])('is left alone with %s held', (modifier) => {
      render(createElement(Page))
      wait(DELAY)
      const event = { key: 'Tab', code: 'Tab', [modifier]: true }
      expect(fireEvent.keyDown(document.body, event)).toBe(true)
      expect(isShown()).toBe(false)
    })

    it('does not move the focus when the menu comes back for another reason', () => {
      render(createElement(Page))
      wait(DELAY)
      fireEvent.mouseMove(document.body, { screenX: 5, screenY: 5 })
      expect(isShown()).toBe(true)
      expect(document.activeElement).toBe(document.body)
    })
  })

  it('lets go of the page when it is taken off the screen', () => {
    const listen = vi.spyOn(window, 'addEventListener')
    const stopListening = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(createElement(Page))
    const added = listen.mock.calls.map((call) => call.slice(0, 3))
    expect(added.map(([type]) => type).sort()).toEqual([
      'keydown',
      'mousedown',
      'mousemove',
      'mouseover',
    ])

    unmount()
    expect(stopListening.mock.calls.map((call) => call.slice(0, 3))).toEqual(added)
    expect(vi.getTimerCount()).toBe(0)
    // Nothing is listening any more: these would warn or throw otherwise.
    fireEvent.mouseOver(document.body)
    fireEvent.mouseMove(document.body, { screenX: 9, screenY: 9 })
    fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' })
    wait(60_000)
  })

  it('works when React draws everything twice (StrictMode)', () => {
    render(createElement(StrictMode, null, createElement(Page)))
    expect(vi.getTimerCount()).toBe(1)
    wait(DELAY)
    expect(isShown()).toBe(false)
    fireEvent.mouseMove(document.body, { screenX: 2, screenY: 2 })
    expect(isShown()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('controlsIn', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  function page(html: string): HTMLElement {
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)
    return container
  }

  it('lists what the Tab key stops at, in the order of the page', () => {
    const container = page(`
      <button id="a">A</button>
      <p>Text <a id="b" href="#x">link</a> <a id="no-link">not a link</a></p>
      <input id="c" type="range" />
      <select id="d"><option>One</option></select>
      <textarea id="e"></textarea>
      <div id="f" tabindex="0">Custom</div>
    `)
    const ids = controlsIn(container).map((control) => control.id)
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('leaves out what Tab skips', () => {
    const container = page(`
      <button id="disabled" disabled>Disabled</button>
      <button id="skipped" tabindex="-1">Skipped</button>
      <input id="secret" type="hidden" />
      <div hidden><button id="hidden">Hidden</button></div>
      <div inert><button id="inert">Inert</button></div>
      <fieldset disabled><button id="in-disabled-group">In a disabled group</button></fieldset>
      <button id="kept">Kept</button>
    `)
    expect(controlsIn(container).map((control) => control.id)).toEqual(['kept'])
  })

  it('is empty for a part of the page without controls', () => {
    expect(controlsIn(page('<p>Nothing to press here.</p>'))).toEqual([])
  })
})
