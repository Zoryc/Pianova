/**
 * The menu at the top of the screen (the top bar, with the player line in
 * it) hides when the mouse is still, so that nothing but the piano and the
 * light is left while playing. The rules are in docs/INTERFACE.md, 5.3.
 *
 * `createAutoHide` holds the rules and knows nothing about the page: it is
 * told what happens and it is given a timer. `useAutoHide` connects it to the
 * mouse, the Tab key and the element that holds the menu.
 *
 * The pointer and the focus over the menu are followed in two ways: the menu
 * says when they come and go, and they are looked up again at whatever the
 * page hears from the mouse and the keyboard. Neither is enough alone (see
 * `watchPage`).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** How long the menu stays on screen after the mouse last moved. */
export const AUTO_HIDE_DELAY_MS = 2500

export interface AutoHideOptions {
  /** The "Hide the menu automatically" setting. While it is false the menu is always shown. */
  enabled: boolean
  /**
   * True while something on screen needs the menu to stay: the start box or
   * a panel is open, the app waits to start, a song is loaded but not playing.
   */
  pinned: boolean
}

/** What the countdown runs on: the page's own timers, unless a test brings its own. */
export interface AutoHideTimer {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface AutoHide {
  isVisible(): boolean
  /** The mouse moved: the menu is shown, and the countdown starts again. */
  activity(): void
  setEnabled(enabled: boolean): void
  setPinned(pinned: boolean): void
  /** Whether the pointer is over the menu. */
  setHovered(hovered: boolean): void
  /** Whether the keyboard focus is inside the menu. */
  setFocused(focused: boolean): void
  /** Stops the countdown. Nothing is reported after this. */
  dispose(): void
}

const PAGE_TIMER: AutoHideTimer = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
}

/**
 * The rules of hiding. The menu starts shown. `onChange` is called each time
 * it goes from shown to hidden or back, and never when nothing changed.
 */
export function createAutoHide(
  options: AutoHideOptions,
  onChange: (visible: boolean) => void,
  timer: AutoHideTimer = PAGE_TIMER,
): AutoHide {
  /** The reasons to stay on screen. While any of them is true the menu does not hide. */
  const reasons = {
    switchedOff: !options.enabled,
    pinned: options.pinned,
    hovered: false,
    focused: false,
  }
  let visible = true
  let counting = false
  let countdown: unknown
  let disposed = false

  function mustStay(): boolean {
    return reasons.switchedOff || reasons.pinned || reasons.hovered || reasons.focused
  }

  function setVisible(next: boolean): void {
    if (visible === next) return
    visible = next
    onChange(next)
  }

  function stopCountdown(): void {
    if (!counting) return
    counting = false
    timer.clearTimeout(countdown)
  }

  /** Shows the menu. With no reason to stay, it hides again once the delay has passed. */
  function showForAWhile(): void {
    stopCountdown()
    setVisible(true)
    if (mustStay()) return
    counting = true
    countdown = timer.setTimeout(() => {
      counting = false
      setVisible(false)
    }, AUTO_HIDE_DELAY_MS)
  }

  function setReason(reason: keyof typeof reasons, value: boolean): void {
    if (disposed) return
    const stayed = mustStay()
    reasons[reason] = value
    // The first reason to stay stops the countdown. When the last one goes
    // away, the menu gets the full delay again before it hides.
    if (mustStay() !== stayed) showForAWhile()
  }

  showForAWhile()

  return {
    isVisible: () => visible,
    activity() {
      if (!disposed) showForAWhile()
    },
    setEnabled: (enabled) => setReason('switchedOff', !enabled),
    setPinned: (pinned) => setReason('pinned', pinned),
    setHovered: (hovered) => setReason('hovered', hovered),
    setFocused: (focused) => setReason('focused', focused),
    dispose() {
      stopCountdown()
      disposed = true
    },
  }
}

/** What the element that holds the menu needs, so that the pointer and focus over it are seen. */
export interface MenuProps {
  ref: RefObject<HTMLElement | null>
  onMouseEnter(): void
  onMouseLeave(): void
  onFocus(): void
  onBlur(): void
}

export interface AutoHideMenu {
  /** False while the menu is hidden. The mouse cursor is hidden with it. */
  visible: boolean
  /** For the element that holds the top bar and the player line. */
  menuProps: MenuProps
}

/**
 * Whether the menu is shown right now. Moving or pressing the mouse shows it;
 * playing with the computer keyboard does not. Tab, pressed while it is
 * hidden, shows it and puts the keyboard focus on its first control, so that
 * someone without a mouse is never left without the menu.
 */
export function useAutoHide({ enabled, pinned }: AutoHideOptions): AutoHideMenu {
  const [visible, setVisible] = useState(true)
  const menu = useRef<HTMLElement>(null)
  const autoHide = useRef<AutoHide | null>(null)
  /** True from the Tab press that brings the menu back until the menu is on screen again. */
  const focusOnceShown = useRef(false)

  // Runs once. The two effects after it pass on the options when they change.
  useEffect(() => {
    const created = createAutoHide({ enabled, pinned }, setVisible)
    autoHide.current = created
    setVisible(created.isVisible())
    const stopWatching = watchPage(created, menu, () => {
      focusOnceShown.current = true
    })
    return () => {
      stopWatching()
      created.dispose()
      autoHide.current = null
    }
  }, [])

  useEffect(() => autoHide.current?.setEnabled(enabled), [enabled])
  useEffect(() => {
    // A panel that closes hands the keyboard focus back to its button while
    // React is changing the page, and React passes no events on at that
    // moment: the menu is not told (see onFocus below). So the focus is looked
    // up here, before the reason that kept the menu on screen goes away.
    autoHide.current?.setFocused(holdsFocus(menu.current))
    autoHide.current?.setPinned(pinned)
  }, [pinned])

  // A hidden menu cannot take the focus, so this waits until it is drawn as shown.
  useLayoutEffect(() => {
    if (!visible || !focusOnceShown.current) return
    focusOnceShown.current = false
    if (!menu.current) return
    controlsIn(menu.current)[0]?.focus()
    // The control normally says so itself. In a window that is not in front it cannot.
    autoHide.current?.setFocused(holdsFocus(menu.current))
  }, [visible])

  const menuProps = useMemo<MenuProps>(
    () => ({
      ref: menu,
      onMouseEnter: () => autoHide.current?.setHovered(true),
      onMouseLeave: () => autoHide.current?.setHovered(false),
      onFocus: () => autoHide.current?.setFocused(true),
      // When the focus only moves to the next control of the menu, that control says so at once.
      onBlur: () => autoHide.current?.setFocused(false),
    }),
    [],
  )

  return { visible, menuProps }
}

/**
 * Tells `autoHide` about the mouse and the Tab key, wherever on the page they
 * are used. Returns a function that stops listening.
 */
function watchPage(
  autoHide: AutoHide,
  menu: RefObject<HTMLElement | null>,
  onBroughtBackByTab: () => void,
): () => void {
  let lastX = Number.NaN
  let lastY = Number.NaN

  /*
   * A focused control that is taken off the page (the player line's "Stop"
   * button, pressed with Enter) sends no event, and the menu would wait for
   * ever for the focus to leave. So the focus is looked up again each time
   * the player does something.
   */
  function lookUpFocus(): void {
    autoHide.setFocused(holdsFocus(menu.current))
  }

  /*
   * The menu hears the mouse come and go (onMouseEnter and onMouseLeave), but
   * not always. When what is under the mouse is taken off the page (the player
   * line at "Stop"), nothing tells
   * the menu that the mouse has left it; and a mouse that rests on the menu
   * while the page is drawn never arrives. So where the mouse is, is also
   * read from whatever the browser says about it: that it is over something
   * else (all that Chrome says when the page has changed under a mouse that
   * stands still), that it moves, that one of its buttons is pressed.
   */
  function lookUpPointer(event: MouseEvent): void {
    const under = whatIsUnderMouse(event, menu.current)
    autoHide.setHovered(under instanceof Node && (menu.current?.contains(under) ?? false))
  }

  function onMouseMove(event: MouseEvent): void {
    // Before the check below: a mouse that stands still can be over something else than before.
    lookUpPointer(event)
    // Browsers also send a "move" when the page changes under a mouse that is
    // standing still (a key lights up, the menu slides away). Only a mouse
    // that really is somewhere else has moved.
    if (event.screenX === lastX && event.screenY === lastY) return
    lastX = event.screenX
    lastY = event.screenY
    lookUpFocus()
    autoHide.activity()
  }

  function onMouseDown(event: MouseEvent): void {
    lookUpPointer(event)
    lookUpFocus()
    autoHide.activity()
  }

  function onKeyDown(event: KeyboardEvent): void {
    lookUpFocus()
    if (!isTabAlone(event) || autoHide.isVisible()) return
    // The menu takes the focus itself once it is shown (see useAutoHide).
    event.preventDefault()
    onBroughtBackByTab()
    autoHide.activity()
  }

  window.addEventListener('mouseover', lookUpPointer)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mousedown', onMouseDown)
  // Before anything else on the page sees the key.
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    window.removeEventListener('mouseover', lookUpPointer)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}

/**
 * What the mouse is over, as `event` says. Except when it names the menu
 * itself: once something inside the menu has been taken away from under the
 * mouse (the player line at "Stop"), Chrome goes on naming the menu in its
 * place, also where the menu no longer reaches, and may never say anything
 * else while the mouse stands still. So the page is asked what is at that
 * place. (A test's simulated page cannot say: the event is then believed.)
 */
function whatIsUnderMouse(event: MouseEvent, menu: Element | null): EventTarget | null {
  if (event.target !== menu || typeof document.elementFromPoint !== 'function') return event.target
  return document.elementFromPoint(event.clientX, event.clientY)
}

/** True when the keyboard focus is on something inside `container`. */
function holdsFocus(container: Element | null): boolean {
  return container !== null && container.contains(document.activeElement)
}

/** Tab or Shift+Tab. With Ctrl, Alt or the Windows key it belongs to the browser or the system. */
function isTabAlone(event: KeyboardEvent): boolean {
  return event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey
}

const CONTROLS = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]'

/** The controls inside `container` that the Tab key stops at, in the order of the page. */
export function controlsIn(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(CONTROLS)].filter(isTabStop)
}

function isTabStop(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(':disabled')) return false
  if (element.closest('[hidden], [inert]') !== null) return false
  // Not drawn at all (display: none). Browsers can tell; a test's simulated page cannot.
  return element.checkVisibility?.() ?? true
}
