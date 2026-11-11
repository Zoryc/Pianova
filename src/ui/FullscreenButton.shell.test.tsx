// @vitest-environment jsdom
/**
 * The full-screen button: not there where the browser cannot go full screen,
 * what it asks the browser for, how it follows the browser when full screen
 * starts or ends some other way (Escape), and a browser that says no.
 *
 * The simulated page has no full screen of its own, so the test gives it one.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FullscreenButton } from './FullscreenButton'

/** The element the make-believe browser is showing full screen, or null. */
let fullscreenElement: Element | null = null

function giveThePageFullScreen(enabled: boolean | undefined): void {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => enabled })
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  })
}

/** The browser goes into or out of full screen and says so, as it does a moment after being asked. */
function browserShows(element: Element | null): void {
  act(() => {
    fullscreenElement = element
    document.dispatchEvent(new Event('fullscreenchange'))
  })
}

/**
 * Where the test runner says that a promise failed and nobody was listening.
 * (A real page has an event for that; the simulated one leaves it to the runner.)
 */
interface FailureWatch {
  on(event: 'unhandledRejection', listener: () => void): void
  off(event: 'unhandledRejection', listener: () => void): void
}
const runner = (globalThis as unknown as { process: FailureWatch }).process

const request = vi.fn<() => Promise<void>>()
const exit = vi.fn<() => Promise<void>>()

beforeEach(() => {
  fullscreenElement = null
  request.mockReset().mockResolvedValue(undefined)
  exit.mockReset().mockResolvedValue(undefined)
  giveThePageFullScreen(true)
  document.documentElement.requestFullscreen = request
  document.exitFullscreen = exit
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  const page = document as unknown as Record<string, unknown>
  delete page.fullscreenEnabled
  delete page.fullscreenElement
  delete page.exitFullscreen
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen
})

function theButton(): HTMLElement {
  return screen.getByRole('button')
}

describe('FullscreenButton', () => {
  it.each([undefined, false])('is not drawn where full screen is not possible (%s)', (enabled) => {
    giveThePageFullScreen(enabled)
    render(<FullscreenButton />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is named "Full screen", for the mouse and for screen readers, and is a plain button', () => {
    render(<FullscreenButton />)
    expect(theButton().getAttribute('aria-label')).toBe('Full screen')
    expect(theButton().title).toBe('Full screen')
    expect(theButton().getAttribute('type')).toBe('button')
    expect(theButton().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('asks the browser to fill the screen with the whole page, once per click', () => {
    render(<FullscreenButton />)
    fireEvent.click(theButton())
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.contexts[0]).toBe(document.documentElement)
    expect(exit).not.toHaveBeenCalled()
  })

  it('keeps its name until the browser says that the screen is filled', () => {
    render(<FullscreenButton />)
    fireEvent.click(theButton())
    expect(theButton().getAttribute('aria-label')).toBe('Full screen')

    browserShows(document.documentElement)
    expect(theButton().getAttribute('aria-label')).toBe('Leave full screen')
    expect(theButton().title).toBe('Leave full screen')
  })

  it('leaves full screen when it is clicked again', () => {
    render(<FullscreenButton />)
    browserShows(document.documentElement)
    fireEvent.click(theButton())
    expect(exit).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()

    browserShows(null)
    expect(theButton().getAttribute('aria-label')).toBe('Full screen')
  })

  it('follows a full screen that ended without it (Escape)', () => {
    render(<FullscreenButton />)
    browserShows(document.documentElement)
    browserShows(null)
    expect(theButton().getAttribute('aria-label')).toBe('Full screen')

    fireEvent.click(theButton())
    expect(request).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  it('knows that the screen is already filled when it is first drawn', () => {
    fullscreenElement = document.documentElement
    render(<FullscreenButton />)
    expect(theButton().getAttribute('aria-label')).toBe('Leave full screen')
  })

  it('stays as it is, and nothing fails, when the browser says no', async () => {
    const unhandled = vi.fn()
    runner.on('unhandledRejection', unhandled)
    try {
      request.mockRejectedValue(new TypeError('Fullscreen request denied'))
      exit.mockRejectedValue(new TypeError('Not in full screen'))
      render(<FullscreenButton />)

      fireEvent.click(theButton())
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
      expect(theButton().getAttribute('aria-label')).toBe('Full screen')

      browserShows(document.documentElement)
      fireEvent.click(theButton())
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
      expect(theButton().getAttribute('aria-label')).toBe('Leave full screen')
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      runner.off('unhandledRejection', unhandled)
    }
  })

  it('copes with an older browser that answers the request with nothing', () => {
    request.mockReturnValue(undefined as unknown as Promise<void>)
    render(<FullscreenButton />)
    expect(() => fireEvent.click(theButton())).not.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('stops listening to the browser when it is taken off the page', () => {
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const changes = (spy: typeof added): number =>
      spy.mock.calls.filter(([type]) => type === 'fullscreenchange').length

    render(
      <StrictMode>
        <FullscreenButton />
      </StrictMode>,
    )
    cleanup()
    expect(changes(added)).toBeGreaterThan(0)
    expect(changes(removed)).toBe(changes(added))
  })
})
