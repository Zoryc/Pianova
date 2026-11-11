// @vitest-environment jsdom
/**
 * The entry point (main.tsx), the page it is loaded from (index.html), and
 * the rule that whatever shows the app's name on the screen reads it from
 * APP_NAME.
 *
 * The name is replaced here by a made-up one. Wherever the screen still showed
 * the real one, it would have been typed in by hand.
 */
import { act, fireEvent, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import indexHtml from '../index.html?raw'

const MADE_UP_NAME = 'Quiet Otter Keys'

vi.mock('./app/appInfo', () => ({ APP_NAME: 'Quiet Otter Keys' }))

vi.mock('./audio/audioEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('./audio/audioEngine')>()
  const silentEngine = {
    start: () => Promise.resolve(),
    getStatus: () => 'idle' as const,
    subscribe: () => () => {},
    noteOn() {},
    noteOff() {},
    setSustain() {},
    setVolume() {},
    setTranspose() {},
    setReverb() {},
    setRelease() {},
    allNotesOff() {},
    dispose() {},
  }
  return { ...original, createAudioEngine: () => silentEngine }
})

/** The name the app really has today, read past the mock. */
let realName = ''

beforeAll(async () => {
  const real = await vi.importActual<typeof import('./app/appInfo')>('./app/appInfo')
  realName = real.APP_NAME
  // jsdom has no canvas: the sky simply draws nothing.
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
})

/** Everything on the page right now, as the browser holds it. */
function wholePage(): string {
  return document.documentElement.outerHTML
}

describe('main.tsx', () => {
  it('draws the app in #root and puts APP_NAME in the browser tab, the heading and the start overlay', async () => {
    document.title = 'not set yet'
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)

    await act(async () => {
      await import('./main')
    })

    expect(document.title).toBe(MADE_UP_NAME)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(MADE_UP_NAME)
    const overlay = screen.getByRole('button', { name: /Click or press any key to start/ })
    expect(overlay.textContent).toContain(MADE_UP_NAME)
    expect(root.querySelector('.app')).not.toBeNull()

    // Nowhere on the screen is the name typed in by hand, also with every
    // panel open. (The name of today is a placeholder that no other word on
    // the screen contains, which is what lets this tell a hand-typed copy.)
    expect(realName).not.toBe('')
    expect(wholePage()).not.toContain(realName)

    fireEvent.click(overlay)
    expect(screen.queryByRole('button', { name: /Click or press any key to start/ })).toBeNull()
    expect(wholePage()).not.toContain(realName)

    // Settings, on each of its tabs. "About" names the app, from APP_NAME too.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    for (const name of ['Sound', 'Keys', 'Piano', 'Look', 'About']) {
      const tab = within(settings).getByRole('tab', { name })
      fireEvent.click(tab)
      expect(tab.getAttribute('aria-selected')).toBe('true')
      expect(wholePage(), `Settings, ${name}`).not.toContain(realName)
    }
    expect(within(settings).getByRole('heading', { level: 3 }).textContent).toBe(MADE_UP_NAME)

    // Songs, then the player line of a song and its options.
    fireEvent.click(screen.getByRole('button', { name: 'Songs' }))
    const songs = screen.getByRole('dialog', { name: 'Songs' })
    expect(wholePage(), 'Songs').not.toContain(realName)
    const playButtons = within(songs).getAllByRole('button', { name: /^Play / })
    fireEvent.click(playButtons[0] as HTMLElement)
    const playerLine = screen.getByRole('region', { name: 'Song player' })
    const songOptions = within(playerLine).getByRole('button', { name: /^Song options/ })
    fireEvent.click(songOptions)
    expect(songOptions.getAttribute('aria-expanded')).toBe('true')
    expect(wholePage(), 'the player line').not.toContain(realName)

    // The song is put away again, so that nothing goes on playing after this test.
    fireEvent.click(within(playerLine).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Song player' })).toBeNull()

    // With all of that on the page, the name still showed in its three places.
    expect(document.title).toBe(MADE_UP_NAME)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(MADE_UP_NAME)
  })
})

describe('index.html', () => {
  const page = new DOMParser().parseFromString(indexHtml, 'text/html')

  it('is an English page with the element the app is drawn in and the script that draws it', () => {
    expect(page.documentElement.getAttribute('lang')).toBe('en')
    expect(page.querySelector('meta[charset]')?.getAttribute('charset')?.toLowerCase()).toBe('utf-8')
    expect(page.querySelector('meta[name="viewport"]')?.getAttribute('content')).toContain(
      'width=device-width',
    )
    expect(page.getElementById('root')).not.toBeNull()
    const script = page.querySelector('script[type="module"]')
    expect(script?.getAttribute('src')).toBe('/src/main.tsx')
  })

  // The one other place where the name is written, as appInfo.ts says: a page
  // cannot read APP_NAME before its script has run, and this title is what the
  // tab shows until then. A rename has to change both; this notices when the
  // second one was forgotten.
  it('has the app name as its title, so the tab says the same before and after the app loads', () => {
    expect(realName).not.toBe('')
    expect(page.querySelector('title')?.textContent?.trim()).toBe(realName)
  })

  it('loads nothing from another site: no external images, fonts, styles or scripts', () => {
    const urls = [...page.querySelectorAll('[src], [href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    )
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url.startsWith('/') || url.startsWith('data:'), url.slice(0, 40)).toBe(true)
    }
  })
})
