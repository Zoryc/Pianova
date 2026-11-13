// @vitest-environment jsdom
/**
 * The start box (src/ui/StartBox.tsx) on a small page of its own: what it
 * shows, which songs it offers, what each of its lines asks the app for, how
 * it differs while the app waits to start, what screen readers are told of
 * it, where the keyboard focus goes when it opens and when it closes, and
 * which presses of the mouse close it. The app's real song library is behind it.
 *
 * The simulated page has no full screen of its own, so the tests of the
 * full-screen line give it one.
 */
import {
  act,
  cleanup,
  fireEvent,
  isInaccessible,
  render,
  screen,
  within,
} from '@testing-library/react'
import { StrictMode, useRef } from 'react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_NAME } from '../app/appInfo'
import { songLibrary } from '../app/songsApp'
import { formatDuration } from '../songs/song'
import { STARTER_SONGS } from '../songs/starterSongs'
import { CLOSE_SENTENCE, START_BOX_SONGS, START_SENTENCE, StartBox } from './StartBox'
import { addSong, resetSongs } from './songsTestKit'

const TAGLINE = 'A piano you play with your computer keyboard.'
const FREE_PLAY = 'Free PlayPlay anything you like'
const PRACTICE = 'PracticeThe song waits for youSoon'
const REAL_TIME = 'Real-timeYour timing is scoredSoon'

/** The starter songs the box offers when the player has no songs: the first ones. */
const FIRST_STARTERS = STARTER_SONGS.slice(0, START_BOX_SONGS)

/** What the box needs to know of a song to offer it. */
type SongOffered = (typeof STARTER_SONGS)[number]

/** What the box asks the app for: a stand-in for each thing, which counts how often it is asked. */
function appStandIn() {
  return {
    onClose: vi.fn<() => void>(),
    onPlaySong: vi.fn<(songId: string) => void>(),
    onShowSongs: vi.fn<() => void>(),
    onShowSettings: vi.fn<() => void>(),
    onShowAbout: vi.fn<() => void>(),
  }
}

type AppStandIn = ReturnType<typeof appStandIn>

/**
 * Everything the box has asked for so far, one entry for each call:
 * "onClose", "onPlaySong starter:…". (A line hands its click on to what it
 * calls; only the song is written down.)
 */
function asked(app: AppStandIn): string[] {
  return Object.entries(app).flatMap(([name, callback]) =>
    callback.mock.calls.map(([first]) => (typeof first === 'string' ? `${name} ${first}` : name)),
  )
}

interface PageProps {
  open: boolean
  /** True until the first click or key press. */
  waitingToStart?: boolean
  /** Whether the box hangs over the whole window. As the app has it: while it waits to start. */
  overWindow?: boolean
  /** What the box calls. Left out by the tests that only look. */
  app?: AppStandIn
  /** False once the button that opens the box has been taken off the page. */
  menuButton?: boolean
}

/** The Menu button with its picture, another button, a piece of sky, and the box while open. */
function Page(props: PageProps): ReactElement {
  const { open, waitingToStart = false, app = appStandIn(), menuButton = true } = props
  const { overWindow = waitingToStart } = props
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <>
      {menuButton && (
        <button ref={opener} type="button">
          <svg data-testid="menu-picture" aria-hidden="true" />
          Menu
        </button>
      )}
      <button type="button">Elsewhere</button>
      <div data-testid="sky" />
      {open && (
        <StartBox
          id="start-box"
          overWindow={overWindow}
          waitingToStart={waitingToStart}
          opener={opener}
          {...app}
        />
      )}
    </>
  )
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

function box(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Menu' })
}

/** A line of the box, by the name a screen reader gives it. */
function line(name: string | RegExp): HTMLElement {
  return within(box()).getByRole('button', { name })
}

function freePlay(): HTMLElement {
  return line(/^Free Play/)
}

/** The two ways to play that are announced but not built yet. */
function comingModes(): HTMLElement[] {
  return [line(/^Practice/), line(/^Real-time/)]
}

/** The lines of the box, top to bottom: each by its label for screen readers, or else its words. */
function lineNames(): string[] {
  return within(box())
    .getAllByRole('button')
    .map((each) => each.getAttribute('aria-label') ?? each.textContent ?? '')
}

/** The lines that play a song, top to bottom. */
function songLines(): string[] {
  return lineNames().filter((name) => name.startsWith('Play '))
}

function wayOut(): HTMLElement {
  return box().querySelector('.start-box__way-out') as HTMLElement
}

/** The unseen button that is the whole window around the box, while the app waits to start. */
function windowButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: START_SENTENCE })
}

function sky(): HTMLElement {
  return screen.getByTestId('sky')
}

function focused(): Element | null {
  return document.activeElement
}

/** Opens the box the way someone without a mouse does: the Menu button has the focus. */
function openFromMenuButton(page: ReactElement): ReturnType<typeof render> {
  const view = render(<Page open={false} />)
  button('Menu').focus()
  view.rerender(page)
  return view
}

/** How often the page has started and stopped listening for presses of the mouse on the window. */
function watchPressListeners(): { added(): number; removed(): number } {
  const added = vi.spyOn(window, 'addEventListener')
  const removed = vi.spyOn(window, 'removeEventListener')
  const presses = (spy: typeof added): number =>
    spy.mock.calls.filter(([type]) => type === 'pointerdown').length
  return { added: () => presses(added), removed: () => presses(removed) }
}

/** The element the make-believe browser is showing full screen, or null. */
let fullscreenElement: Element | null = null
const requestFullscreen = vi.fn<() => Promise<void>>()
const exitFullscreen = vi.fn<() => Promise<void>>()

/** Makes the simulated page one that can go full screen, as a browser's page can. */
function giveThePageFullScreen(): void {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true })
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  })
  document.documentElement.requestFullscreen = requestFullscreen
  document.exitFullscreen = exitFullscreen
}

/** The browser goes into or out of full screen and says so, a moment after being asked. */
function browserShows(element: Element | null): void {
  act(() => {
    fullscreenElement = element
    document.dispatchEvent(new Event('fullscreenchange'))
  })
}

beforeEach(async () => {
  await resetSongs()
  fullscreenElement = null
  requestFullscreen.mockReset().mockResolvedValue(undefined)
  exitFullscreen.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  const page = document as unknown as Record<string, unknown>
  delete page.fullscreenEnabled
  delete page.fullscreenElement
  delete page.exitFullscreen
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen
  await resetSongs()
})

describe('StartBox: what it shows', () => {
  it('is a dialog called "Menu", with the id it was given', () => {
    render(<Page open />)
    expect(box().id).toBe('start-box')
    expect(box().tagName).toBe('SECTION')
    expect(box().className).toBe('start-box')
    expect(box().getAttribute('aria-label')).toBe('Menu')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('has the name of the app as the main heading of the page, then what the app is', () => {
    render(<Page open />)
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings.map((heading) => heading.textContent)).toEqual([APP_NAME])
    const [name] = headings as [HTMLElement]
    expect(name.className).toBe('start-box__name')
    expect(box().contains(name)).toBe(true)

    const tagline = name.nextElementSibling as HTMLElement
    expect(tagline.tagName).toBe('P')
    expect(tagline.textContent).toBe(TAGLINE)
    // The small picture behind the name says nothing to a screen reader.
    const picture = name.parentElement?.querySelector('svg')
    expect(picture?.getAttribute('aria-hidden')).toBe('true')
  })

  it('has two columns, "Play" and "Songs", each a list named by its own heading', () => {
    render(<Page open />)
    const headings = within(box()).getAllByRole('heading', { level: 2 })
    expect(headings.map((heading) => heading.textContent)).toEqual(['Play', 'Songs'])

    const play = within(box()).getByRole('region', { name: 'Play' })
    const songs = within(box()).getByRole('region', { name: 'Songs' })
    // Side by side in the same row of the box, "Play" first.
    expect([...(play.parentElement?.children ?? [])]).toEqual([play, songs])
    expect(play.parentElement?.className).toBe('start-box__columns')

    const linesIn = (column: HTMLElement): (string | null)[] =>
      within(within(column).getByRole('list'))
        .getAllByRole('listitem')
        .map((item) => {
          const [only, ...others] = within(item).getAllByRole('button')
          expect(others).toEqual([])
          return only?.getAttribute('aria-label') ?? only?.textContent ?? null
        })
    expect(linesIn(play)).toEqual([FREE_PLAY, PRACTICE, REAL_TIME])
    expect(linesIn(songs)).toEqual([
      ...FIRST_STARTERS.map((song) => `Play ${song.title}`),
      'All songs…',
    ])
  })

  it('shows "Free Play" as the way to play that is on, and no other line as chosen', () => {
    render(<Page open />)
    expect(freePlay().getAttribute('aria-pressed')).toBe('true')
    expect(freePlay().textContent).toBe(FREE_PLAY)
    expect(freePlay().querySelector('.start-box__note')?.textContent).toBe('Play anything you like')
    expect(freePlay().getAttribute('aria-disabled')).toBeNull()
    expect(freePlay().tabIndex).toBe(0)
    expect([...box().querySelectorAll('[aria-pressed="true"]')]).toEqual([freePlay()])
  })

  it('announces the two ways to play that are coming: "Soon", and not reached with Tab', () => {
    render(<Page open />)
    const [practice, realTime] = comingModes() as [HTMLElement, HTMLElement]
    expect(practice.textContent).toBe(PRACTICE)
    expect(practice.querySelector('.start-box__note')?.textContent).toBe('The song waits for you')
    expect(realTime.textContent).toBe(REAL_TIME)
    expect(realTime.querySelector('.start-box__note')?.textContent).toBe('Your timing is scored')

    for (const coming of [practice, realTime]) {
      expect(coming.getAttribute('aria-disabled')).toBe('true')
      expect(coming.tabIndex).toBe(-1)
      expect(coming.title).toBe('Coming in a later update')
      expect(coming.querySelector('.start-box__badge')?.textContent).toBe('Soon')
      expect(coming.getAttribute('aria-pressed')).not.toBe('true')
      // Not switched off for good: a screen reader still finds the line and reads why.
      expect((coming as HTMLButtonElement).disabled).toBe(false)
    }
  })

  it('ends with a foot: Settings, About, and how to leave', () => {
    render(<Page open />)
    const foot = box().lastElementChild as HTMLElement
    expect(foot.tagName).toBe('FOOTER')
    expect(foot.className).toBe('start-box__foot')
    expect([...foot.children].map((part) => part.textContent)).toEqual([
      'Settings',
      'About',
      CLOSE_SENTENCE,
    ])
    expect(wayOut().tagName).toBe('P')
    expect(foot.lastElementChild).toBe(wayOut())
  })

  it('has its lines in reading order, and Tab stops at all but the two that are coming', () => {
    render(<Page open />)
    const starters = FIRST_STARTERS.map((song) => `Play ${song.title}`)
    expect(lineNames()).toEqual([
      FREE_PLAY,
      PRACTICE,
      REAL_TIME,
      ...starters,
      'All songs…',
      'Settings',
      'About',
    ])

    const tabStops = within(box())
      .getAllByRole('button')
      .filter((each) => each.tabIndex >= 0)
      .map((each) => each.getAttribute('aria-label') ?? each.textContent)
    expect(tabStops).toEqual([FREE_PLAY, ...starters, 'All songs…', 'Settings', 'About'])
  })

  it('does not make the part that scrolls a stop of the Tab key: only its lines are stops', () => {
    render(<Page open />)
    const scrolls = box().querySelector('.start-box__body') as HTMLElement
    // The two lists scroll when the window is low. The head and the foot stay in view.
    expect(scrolls.contains(within(box()).getByRole('region', { name: 'Play' }))).toBe(true)
    expect(scrolls.contains(within(box()).getByRole('region', { name: 'Songs' }))).toBe(true)
    expect(scrolls.contains(screen.getByRole('heading', { level: 1 }))).toBe(false)
    expect(scrolls.contains(line('Settings'))).toBe(false)
    expect(scrolls.contains(wayOut())).toBe(false)

    // A browser stops at a part that scrolls, unless that part says otherwise.
    // (The simulated page never would: the box has to say it in so many words.)
    expect(scrolls.getAttribute('tabindex')).toBe('-1')
    // Nor is it a control of any kind: it has no name and no role to read out.
    expect(scrolls.getAttribute('role')).toBeNull()
    expect(scrolls.getAttribute('aria-label')).toBeNull()
  })

  it('makes every line a plain button, and hides every picture from screen readers', () => {
    render(<Page open />)
    const lines = within(box()).getAllByRole('button')
    expect(lines.map((each) => each.getAttribute('type'))).toEqual(lines.map(() => 'button'))
    expect(lines.map((each) => each.className)).toEqual(lines.map(() => 'start-box__row'))

    const pictures = [...box().querySelectorAll('svg')]
    expect(pictures.length).toBeGreaterThan(0)
    expect(pictures.map((picture) => picture.getAttribute('aria-hidden'))).toEqual(
      pictures.map(() => 'true'),
    )
  })
})

describe('StartBox: the songs it offers', () => {
  it('offers three songs', () => {
    expect(START_BOX_SONGS).toBe(3)
  })

  it('offers the first starter songs while the player has none, each with its length', () => {
    render(<Page open />)
    expect(songLines()).toEqual(FIRST_STARTERS.map((song) => `Play ${song.title}`))
    expect(songLines()[0]).toBe('Play Twinkle, Twinkle, Little Star')

    for (const song of FIRST_STARTERS) {
      const songLine = line(`Play ${song.title}`)
      const title = songLine.querySelector('.start-box__title') as HTMLElement
      expect(title.textContent).toBe(song.title)
      // A title too long for its column is cut: the whole of it shows when the mouse rests on it.
      expect(title.title).toBe(song.title)
      const length = songLine.querySelector('.start-box__length') as HTMLElement
      expect(length.textContent).toBe(formatDuration(song.duration))
      expect(songLine.textContent).toBe(`${song.title}${formatDuration(song.duration)}`)
    }
  })

  it('calls a song line "Play" and the title, and describes it by its length', async () => {
    await addSong('Mine.mid', { notes: [60, 62, 64, 65, 67, 69] })
    render(<Page open />)
    const [first, second] = FIRST_STARTERS as [SongOffered, SongOffered]
    const offered = [
      { title: 'Mine', length: '0:03' },
      { title: first.title, length: formatDuration(first.duration) },
      { title: second.title, length: formatDuration(second.duration) },
    ]

    const lengths: Element[] = []
    for (const { title, length } of offered) {
      // The name is "Play" and the title, and no more: a screen reader tells the length after it.
      const songLine = within(box()).getByRole('button', {
        name: `Play ${title}`,
        description: length,
      })
      expect(songLine.getAttribute('aria-label')).toBe(`Play ${title}`)
      // What describes the line is the length written on it, not a second copy.
      const describedBy = document.getElementById(songLine.getAttribute('aria-describedby') ?? '')
      expect(describedBy).toBe(songLine.querySelector('.start-box__length'))
      lengths.push(describedBy as Element)
    }
    // Each line points at its own length.
    expect(new Set(lengths).size).toBe(offered.length)
    expect(new Set(lengths.map((length) => length.id)).size).toBe(offered.length)

    // No other line of the box is described by anything.
    const described = [...box().querySelectorAll('[aria-describedby]')]
    expect(described).toEqual(offered.map(({ title }) => line(`Play ${title}`)))
  })

  it('goes on describing a song by its length when the songs change', async () => {
    render(<Page open />)
    const tune = await addSong('Tune.mid')
    act(() => songLibrary.rename(tune.id, 'Air'))

    for (const name of songLines()) {
      const songLine = line(name)
      const length = songLine.querySelector('.start-box__length') as HTMLElement
      expect(length.id).not.toBe('')
      expect(songLine.getAttribute('aria-describedby')).toBe(length.id)
      expect(document.querySelectorAll(`[id="${length.id}"]`)).toHaveLength(1)
    }
    expect(within(box()).getByRole('button', { name: 'Play Air', description: '0:02' })).toBe(
      line('Play Air'),
    )
  })

  it("puts the player's own songs first, newest first, then starter songs", async () => {
    await addSong('First.mid', { notes: [60, 62] })
    await addSong('Second.mid', { notes: [60, 62, 64, 65, 67, 69] })
    render(<Page open />)

    expect(songLines()).toEqual(['Play Second', 'Play First', `Play ${STARTER_SONGS[0]?.title}`])
    expect(line('Play Second').querySelector('.start-box__length')?.textContent).toBe('0:03')
    expect(line('Play First').querySelector('.start-box__length')?.textContent).toBe('0:01')
    expect(line('Play First').querySelector('.start-box__title')?.textContent).toBe('First')
  })

  it('never offers more than three, however many songs the player has', async () => {
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) await addSong(`${name}.mid`)
    render(<Page open />)

    expect(songLines()).toEqual(['Play Five', 'Play Four', 'Play Three'])
    expect(songLines()).toHaveLength(START_BOX_SONGS)
    // The others, and every starter song, are behind "All songs…".
    expect(within(box()).queryByRole('button', { name: /Twinkle/ })).toBeNull()
    expect(line('All songs…')).toBeTruthy()
  })

  it('has "All songs…" after the songs, whatever they are', async () => {
    render(<Page open />)
    expect(lineNames()[3 + START_BOX_SONGS]).toBe('All songs…')
    expect(line('All songs…').textContent).toBe('All songs…')

    await addSong('Mine.mid')
    expect(songLines()).toHaveLength(START_BOX_SONGS)
    expect(lineNames()[3 + START_BOX_SONGS]).toBe('All songs…')
  })

  it('follows the library while open: a song added, renamed or deleted shows at once', async () => {
    render(<Page open />)
    const [first, second, third] = FIRST_STARTERS.map((song) => `Play ${song.title}`)

    const tune = await addSong('Tune.mid')
    expect(songLines()).toEqual(['Play Tune', first, second])

    act(() => songLibrary.rename(tune.id, 'Air'))
    expect(songLines()).toEqual(['Play Air', first, second])
    expect(line('Play Air').querySelector('.start-box__title')?.textContent).toBe('Air')

    act(() => songLibrary.remove(tune.id))
    expect(songLines()).toEqual([first, second, third])
  })
})

describe.each([
  ['opened with the Menu button', false],
  ['while the app waits to start', true],
])('StartBox: what its lines ask the app for (%s)', (_when, waitingToStart) => {
  function openBox(): AppStandIn {
    const app = appStandIn()
    render(<Page open waitingToStart={waitingToStart} app={app} />)
    return app
  }

  it('"Free Play" asks to close the box, once', () => {
    const app = openBox()
    fireEvent.click(freePlay())
    expect(asked(app)).toEqual(['onClose'])
  })

  it('a starter song asks to play that song, once', () => {
    const app = openBox()
    fireEvent.click(line('Play Mary Had a Little Lamb'))
    expect(asked(app)).toEqual(['onPlaySong starter:mary-had-a-little-lamb'])
    // The id of the song, and nothing else with it.
    expect(app.onPlaySong.mock.calls).toEqual([['starter:mary-had-a-little-lamb']])
  })

  it("a song of the player's own asks to play that song, and no other", async () => {
    const older = await addSong('Older.mid')
    const newer = await addSong('Newer.mid')
    const app = openBox()

    fireEvent.click(line('Play Older'))
    expect(asked(app)).toEqual([`onPlaySong ${older.id}`])
    fireEvent.click(line('Play Newer'))
    expect(asked(app)).toEqual([`onPlaySong ${older.id}`, `onPlaySong ${newer.id}`])
  })

  it.each([
    ['All songs…', 'onShowSongs'],
    ['Settings', 'onShowSettings'],
    ['About', 'onShowAbout'],
  ])('"%s" asks for just that, once', (name, expected) => {
    const app = openBox()
    fireEvent.click(line(name))
    expect(asked(app)).toEqual([expected])
  })

  it('the two ways to play that are coming ask for nothing', () => {
    const app = openBox()
    for (const coming of comingModes()) fireEvent.click(coming)
    expect(asked(app)).toEqual([])
  })

  // The app sees to it that such a click starts it. The box itself stays: it
  // must not ask to be closed, nor for anything else.
  it('a click between the lines asks for nothing: the box stays open', () => {
    const app = openBox()
    fireEvent.click(box())
    fireEvent.click(screen.getByRole('heading', { level: 1 }))
    fireEvent.click(box().querySelector('.start-box__picture') as SVGElement)
    fireEvent.click(box().querySelector('.start-box__picture rect') as SVGElement)
    fireEvent.click(screen.getByText(TAGLINE))
    fireEvent.click(screen.getByRole('heading', { level: 2, name: 'Play' }))
    fireEvent.click(screen.getByRole('heading', { level: 2, name: 'Songs' }))
    for (const list of within(box()).getAllByRole('list')) fireEvent.click(list)
    fireEvent.click(box().querySelector('.start-box__body') as HTMLElement)
    fireEvent.click(box().lastElementChild as HTMLElement)
    fireEvent.click(wayOut())
    expect(asked(app)).toEqual([])
  })

  // A real click lands on the picture or the words of a line, almost never on its own edge.
  it('a click on what is drawn inside a line asks what the line asks, once', () => {
    const app = openBox()
    const ode = line('Play Ode to Joy')
    fireEvent.click(freePlay().querySelector('svg path') as SVGElement)
    fireEvent.click(freePlay().querySelector('.start-box__note') as HTMLElement)
    fireEvent.click(ode.querySelector('.start-box__title') as HTMLElement)
    fireEvent.click(ode.querySelector('.start-box__length') as HTMLElement)
    fireEvent.click(line('All songs…').querySelector('svg') as SVGElement)
    fireEvent.click(line('Settings').querySelector('svg circle') as SVGElement)
    expect(asked(app)).toEqual([
      'onClose',
      'onClose',
      'onPlaySong starter:ode-to-joy',
      'onPlaySong starter:ode-to-joy',
      'onShowSongs',
      'onShowSettings',
    ])
  })

  it('a click on what is drawn inside a way to play that is coming asks for nothing', () => {
    const app = openBox()
    for (const coming of comingModes()) {
      fireEvent.click(coming.querySelector('svg') as SVGElement)
      fireEvent.click(coming.querySelector('.start-box__words') as HTMLElement)
      fireEvent.click(coming.querySelector('.start-box__note') as HTMLElement)
      fireEvent.click(coming.querySelector('.start-box__badge') as HTMLElement)
    }
    expect(asked(app)).toEqual([])
  })
})

describe('StartBox: the full-screen line', () => {
  it('is not there where the browser cannot go full screen', () => {
    render(<Page open />)
    expect(within(box()).queryByRole('button', { name: /full screen/i })).toBeNull()
    expect(screen.queryByText(/full screen/i)).toBeNull()
  })

  it('stands between Settings and About, with "Full screen" written on it', () => {
    giveThePageFullScreen()
    render(<Page open />)
    expect(lineNames().slice(-3)).toEqual(['Settings', 'Full screen', 'About'])

    const fullScreen = line('Full screen')
    expect(fullScreen.className).toBe('start-box__row')
    expect(fullScreen.textContent).toBe('Full screen')
    // The words are on the line itself: it needs no other name and no tooltip.
    expect(fullScreen.getAttribute('aria-label')).toBeNull()
    expect(fullScreen.getAttribute('title')).toBeNull()
    expect(fullScreen.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(fullScreen.parentElement).toBe(box().lastElementChild)
  })

  it('asks the browser to fill the screen, and nothing of the app: the box stays', () => {
    giveThePageFullScreen()
    const app = appStandIn()
    render(<Page open app={app} />)
    fireEvent.click(line('Full screen'))

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(exitFullscreen).not.toHaveBeenCalled()
    expect(asked(app)).toEqual([])
    expect(box()).toBeTruthy()
  })

  it('reads "Leave full screen" once the screen is filled, and leaves it at a click', () => {
    giveThePageFullScreen()
    const app = appStandIn()
    render(<Page open app={app} />)
    browserShows(document.documentElement)

    expect(within(box()).queryByRole('button', { name: 'Full screen' })).toBeNull()
    const leave = line('Leave full screen')
    expect(leave.textContent).toBe('Leave full screen')
    expect(leave.getAttribute('aria-label')).toBeNull()
    expect(lineNames().slice(-3)).toEqual(['Settings', 'Leave full screen', 'About'])

    fireEvent.click(leave)
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(asked(app)).toEqual([])

    browserShows(null)
    expect(line('Full screen').textContent).toBe('Full screen')
  })

  it('is there while the app waits to start too', () => {
    giveThePageFullScreen()
    const app = appStandIn()
    render(<Page open waitingToStart app={app} />)
    fireEvent.click(line('Full screen'))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(asked(app)).toEqual([])
  })
})

describe('StartBox: while the app waits to start', () => {
  it('hangs in a layer of its own, behind it an unseen button that is the whole window', () => {
    render(<Page open waitingToStart />)
    const layer = document.querySelector('.start-layer') as HTMLElement
    expect(layer.tagName).toBe('DIV')
    // The window comes first: Tab reaches it before the lines of the box.
    expect([...layer.children]).toEqual([windowButton(), box()])

    const around = windowButton() as HTMLElement
    expect(around.className).toBe('start-layer__window')
    expect(around.getAttribute('type')).toBe('button')
    expect(around.getAttribute('aria-label')).toBe(START_SENTENCE)
    expect(around.textContent).toBe('')
    expect(around.tabIndex).toBe(0)
    // The box is not inside the button: its lines are buttons of their own.
    expect(around.contains(box())).toBe(false)
  })

  it('says "Click or press any key to start", to the eye and as the name of the window', () => {
    render(<Page open waitingToStart />)
    expect(START_SENTENCE).toBe('Click or press any key to start')
    expect(wayOut().textContent).toBe(START_SENTENCE)
    expect(screen.getAllByText(START_SENTENCE)).toEqual([wayOut()])
    expect(screen.getAllByRole('button', { name: START_SENTENCE })).toHaveLength(1)
    expect(screen.queryByText(CLOSE_SENTENCE)).toBeNull()
  })

  it('keeps that sentence from screen readers, which hear it as the name of the window', () => {
    render(<Page open waitingToStart />)
    // Read out once: by the button that is the window, not a second time at the foot.
    expect(wayOut().getAttribute('aria-hidden')).toBe('true')
    expect(isInaccessible(wayOut())).toBe(true)
    expect(isInaccessible(windowButton() as HTMLElement)).toBe(false)
    // The rest of the foot is read out as ever.
    expect(isInaccessible(line('Settings'))).toBe(false)
    expect(isInaccessible(line('About'))).toBe(false)
  })

  it('asks to close, which starts the app, at a click on the window around it: once', () => {
    const app = appStandIn()
    render(<Page open waitingToStart app={app} />)
    fireEvent.click(windowButton() as HTMLElement)
    expect(asked(app)).toEqual(['onClose'])
  })

  it('shows the same box as later: the same lines in the same order', () => {
    render(<Page open waitingToStart />)
    expect(box().id).toBe('start-box')
    expect(screen.getAllByRole('heading', { level: 1 }).map((each) => each.textContent)).toEqual([
      APP_NAME,
    ])
    expect(lineNames()).toEqual([
      FREE_PLAY,
      PRACTICE,
      REAL_TIME,
      ...FIRST_STARTERS.map((song) => `Play ${song.title}`),
      'All songs…',
      'Settings',
      'About',
    ])
    // Its lists scroll in a low window, and are no stop of the Tab key here either.
    expect(box().querySelector('.start-box__body')?.getAttribute('tabindex')).toBe('-1')
  })

  it('takes no focus: nobody has opened it', () => {
    render(<Page open waitingToStart />)
    expect(focused()).toBe(document.body)
    // It could hold the focus, as it does later, but it is not given it.
    expect(box().tabIndex).toBe(-1)
  })

  it('leaves the focus on whatever has it', () => {
    const view = render(<Page open={false} />)
    button('Elsewhere').focus()
    view.rerender(<Page open waitingToStart />)
    expect(focused()).toBe(button('Elsewhere'))
  })

  it('moves no focus when it goes away, wherever the focus is', () => {
    const view = render(<Page open waitingToStart />)
    const takenByMenu = vi.fn()
    button('Menu').addEventListener('focus', takenByMenu)

    line('Settings').focus()
    view.rerender(<Page open={false} />)
    // The line went away with the box. What happens to the focus then is the app's business.
    expect(focused()).toBe(document.body)
    expect(takenByMenu).not.toHaveBeenCalled()

    view.rerender(<Page open waitingToStart />)
    button('Elsewhere').focus()
    view.rerender(<Page open={false} />)
    expect(focused()).toBe(button('Elsewhere'))
  })

  it('does not close at a press of the mouse, outside it or anywhere: only a click counts', () => {
    const presses = watchPressListeners()
    const app = appStandIn()
    render(<Page open waitingToStart app={app} />)

    fireEvent.pointerDown(sky())
    fireEvent.pointerDown(button('Elsewhere'))
    fireEvent.pointerDown(document.body)
    fireEvent.pointerDown(windowButton() as HTMLElement)
    fireEvent.pointerDown(box())
    expect(asked(app)).toEqual([])
    // It does not even listen for them.
    expect(presses.added()).toBe(0)
  })

  it('leaves Escape and every other key to the app', () => {
    const app = appStandIn()
    render(<Page open waitingToStart app={app} />)
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
    fireEvent.keyDown(freePlay(), { key: 'a', code: 'KeyA' })
    fireEvent.keyDown(windowButton() as HTMLElement, { key: ' ', code: 'Space' })
    expect(asked(app)).toEqual([])
  })
})

describe('StartBox: still over the window once the app has started', () => {
  // "Full screen" starts the app and leaves the box open. It stays where it hangs.
  it('keeps its layer, without the window button', () => {
    render(<Page open overWindow />)
    const layer = document.querySelector('.start-layer') as HTMLElement
    expect([...layer.children]).toEqual([box()])
    expect(windowButton()).toBeNull()
    expect(wayOut().textContent).toBe(CLOSE_SENTENCE)
    // No button says that sentence in its place: screen readers read it here.
    expect(wayOut().hasAttribute('aria-hidden')).toBe(false)
    expect(isInaccessible(wayOut())).toBe(false)
  })

  it('is the very same box, with the focus where it was, when the app starts under it', () => {
    giveThePageFullScreen()
    const view = render(<Page open waitingToStart />)
    const before = box()
    line('Full screen').focus()

    view.rerender(<Page open overWindow />)
    expect(box()).toBe(before)
    expect(focused()).toBe(line('Full screen'))
    expect(windowButton()).toBeNull()
  })

  it('changes its sentence when the app starts under it, and lets screen readers read it', () => {
    const view = render(<Page open waitingToStart />)
    const sentence = wayOut()
    expect(sentence.textContent).toBe(START_SENTENCE)
    expect(sentence.getAttribute('aria-hidden')).toBe('true')

    view.rerender(<Page open overWindow />)
    expect(wayOut()).toBe(sentence)
    expect(sentence.textContent).toBe(CLOSE_SENTENCE)
    expect(sentence.hasAttribute('aria-hidden')).toBe(false)
    expect(isInaccessible(sentence)).toBe(false)
  })

  it('starts closing at a press of the mouse outside it once the app has started under it', () => {
    const app = appStandIn()
    const view = render(<Page open waitingToStart app={app} />)
    // While the app waits, a press closes nothing: only a click counts.
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual([])

    // "Full screen" or a way to play that is coming was clicked: the app has
    // started and the box is still there. From now on a press outside it closes it.
    view.rerender(<Page open overWindow app={app} />)
    fireEvent.pointerDown(box())
    fireEvent.pointerDown(freePlay())
    fireEvent.pointerDown(button('Menu'))
    expect(asked(app)).toEqual([])
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual(['onClose'])
    fireEvent.pointerDown(button('Elsewhere'))
    expect(asked(app)).toEqual(['onClose', 'onClose'])

    // And it stops for good when the box is taken off the page.
    view.rerender(<Page open={false} app={app} />)
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual(['onClose', 'onClose'])
  })

  it('closes at a press of the mouse outside it, as it does once it is among the panels', () => {
    const app = appStandIn()
    render(<Page open overWindow app={app} />)
    fireEvent.pointerDown(box())
    fireEvent.pointerDown(button('Menu'))
    expect(asked(app)).toEqual([])
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual(['onClose'])
  })
})

describe('StartBox: opened with the Menu button', () => {
  it('has no layer and no window button around it', () => {
    const { container } = render(<Page open />)
    expect(document.querySelector('.start-layer')).toBeNull()
    expect(document.querySelector('.start-layer__window')).toBeNull()
    expect(windowButton()).toBeNull()
    // It is put straight where the app draws it.
    expect(box().parentElement).toBe(container)
  })

  it('says "Click outside or play a key to close"', () => {
    render(<Page open />)
    expect(CLOSE_SENTENCE).toBe('Click outside or play a key to close')
    expect(wayOut().textContent).toBe(CLOSE_SENTENCE)
    expect(screen.queryByText(START_SENTENCE)).toBeNull()
  })

  it('lets screen readers read that sentence: no button says it in its place', () => {
    render(<Page open />)
    expect(wayOut().hasAttribute('aria-hidden')).toBe(false)
    expect(isInaccessible(wayOut())).toBe(false)
    expect(screen.queryByRole('button', { name: CLOSE_SENTENCE })).toBeNull()
    // Only the pictures of the box are kept from them.
    const hidden = [...box().querySelectorAll('[aria-hidden="true"]')]
    expect(hidden.length).toBeGreaterThan(0)
    expect(hidden.filter((each) => !(each instanceof SVGSVGElement))).toEqual([])
  })

  it('leaves Escape and a click outside it to the app: only a press of the mouse closes', () => {
    const app = appStandIn()
    render(<Page open app={app} />)
    fireEvent.keyDown(freePlay(), { key: 'Escape', code: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
    fireEvent.click(button('Elsewhere'))
    fireEvent.click(sky())
    fireEvent.click(document.body)
    expect(asked(app)).toEqual([])
  })
})

describe('StartBox: opened with the keyboard (the Menu button has the focus)', () => {
  it('moves the focus to its first line, "Free Play"', () => {
    openFromMenuButton(<Page open />)
    expect(focused()).toBe(freePlay())
  })

  it('gives the focus back to the Menu button when it closes', () => {
    const view = openFromMenuButton(<Page open />)
    line('Settings').focus()
    view.rerender(<Page open={false} />)
    expect(focused()).toBe(button('Menu'))
  })

  it('gives it back to whichever control it was opened from', () => {
    const view = render(<Page open={false} />)
    button('Elsewhere').focus()
    view.rerender(<Page open />)
    expect(focused()).toBe(freePlay())

    view.rerender(<Page open={false} />)
    expect(focused()).toBe(button('Elsewhere'))
  })

  it('leaves the focus alone when it has gone somewhere else meanwhile', () => {
    const view = openFromMenuButton(<Page open />)
    button('Elsewhere').focus()
    const takenBack = vi.fn()
    button('Menu').addEventListener('focus', takenBack)

    view.rerender(<Page open={false} />)
    expect(focused()).toBe(button('Elsewhere'))
    // Not even for a moment: the Menu button is not told that it has the focus.
    expect(takenBack).not.toHaveBeenCalled()
  })

  it('does not move the focus again when its songs change, or when it is drawn again', async () => {
    const view = openFromMenuButton(<Page open />)
    line('About').focus()

    await addSong('New.mid')
    expect(songLines()[0]).toBe('Play New')
    expect(focused()).toBe(line('About'))

    view.rerender(<Page open app={appStandIn()} />)
    expect(focused()).toBe(line('About'))
  })

  it('copes with the Menu button being gone when it closes', () => {
    const view = openFromMenuButton(<Page open />)
    view.rerender(<Page open menuButton={false} />)
    expect(focused()).toBe(freePlay())

    view.rerender(<Page open={false} menuButton={false} />)
    expect(focused()).toBe(document.body)
  })
})

describe('StartBox: opened with the mouse (nothing has the focus)', () => {
  it('takes the focus itself, so that no line shows a ring and Tab goes on inside it', () => {
    const view = render(<Page open={false} />)
    view.rerender(<Page open />)
    expect(focused()).toBe(box())
    // It can hold the focus, and Tab does not stop at it.
    expect(box().tabIndex).toBe(-1)
  })

  it('leaves nothing focused when it closes', () => {
    const view = render(<Page open />)
    expect(focused()).toBe(box())
    const takenByMenu = vi.fn()
    button('Menu').addEventListener('focus', takenByMenu)

    view.rerender(<Page open={false} />)
    expect(focused()).toBe(document.body)
    expect(takenByMenu).not.toHaveBeenCalled()
  })

  it('leaves nothing focused when one of its lines had the focus: the app sees to that', () => {
    const view = render(<Page open />)
    line('All songs…').focus()
    view.rerender(<Page open={false} />)
    expect(focused()).toBe(document.body)
  })
})

describe('StartBox: a press of the mouse', () => {
  it('anywhere else asks to close, once for each press', () => {
    const app = appStandIn()
    render(<Page open app={app} />)

    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual(['onClose'])
    fireEvent.pointerDown(button('Elsewhere'))
    fireEvent.pointerDown(document.body)
    expect(asked(app)).toEqual(['onClose', 'onClose', 'onClose'])
  })

  it('inside the box asks for nothing: on a line, on its picture, between the lines', () => {
    const app = appStandIn()
    render(<Page open app={app} />)

    fireEvent.pointerDown(box())
    fireEvent.pointerDown(freePlay())
    fireEvent.pointerDown(freePlay().querySelector('svg') as SVGElement)
    for (const coming of comingModes()) fireEvent.pointerDown(coming)
    fireEvent.pointerDown(line('All songs…'))
    fireEvent.pointerDown(screen.getByRole('heading', { level: 1 }))
    fireEvent.pointerDown(wayOut())
    expect(asked(app)).toEqual([])
  })

  it('on the Menu button or its picture asks for nothing: that button closes the box', () => {
    const app = appStandIn()
    render(<Page open app={app} />)

    fireEvent.pointerDown(button('Menu'))
    fireEvent.pointerDown(screen.getByTestId('menu-picture'))
    expect(asked(app)).toEqual([])
  })

  it('goes to the app as it is now: the box never calls an older onClose', () => {
    const before = appStandIn()
    const now = appStandIn()
    const view = render(<Page open app={before} />)
    view.rerender(<Page open app={now} />)

    fireEvent.pointerDown(sky())
    expect(asked(before)).toEqual([])
    expect(asked(now)).toEqual(['onClose'])
  })

  it('is listened for on the window only while the box is on the page', () => {
    const presses = watchPressListeners()
    const app = appStandIn()
    const view = render(<Page open={false} app={app} />)
    expect(presses.added()).toBe(0)
    // No box, nothing to close: a press asks for nothing.
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual([])

    view.rerender(<Page open app={app} />)
    expect(presses.added()).toBe(1)
    expect(presses.removed()).toBe(0)
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual(['onClose'])

    // Drawn again, it goes on listening with what it has: a press still asks once, not twice.
    view.rerender(<Page open app={app} />)
    expect(presses.added()).toBe(1)
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual(['onClose', 'onClose'])

    view.rerender(<Page open={false} app={app} />)
    expect(presses.removed()).toBe(1)
    fireEvent.pointerDown(sky())
    fireEvent.pointerDown(document.body)
    expect(asked(app)).toEqual(['onClose', 'onClose'])
  })
})

describe('StartBox: when React draws everything twice (StrictMode)', () => {
  function twice(page: ReactElement): ReactElement {
    return <StrictMode>{page}</StrictMode>
  }

  it('still moves the focus to "Free Play" and gives it back to the Menu button', () => {
    const view = render(twice(<Page open={false} />))
    button('Menu').focus()
    view.rerender(twice(<Page open />))
    expect(focused()).toBe(freePlay())

    view.rerender(twice(<Page open={false} />))
    expect(focused()).toBe(button('Menu'))
  })

  it('still takes the focus itself after a click with the mouse, and lets go when closed', () => {
    const view = render(twice(<Page open />))
    expect(focused()).toBe(box())
    view.rerender(twice(<Page open={false} />))
    expect(focused()).toBe(document.body)
  })

  it('still takes no focus while the app waits to start', () => {
    render(twice(<Page open waitingToStart />))
    expect(focused()).toBe(document.body)
    expect(screen.getAllByRole('button', { name: START_SENTENCE })).toHaveLength(1)
  })

  it('still asks once for each click on a line, and once for each press outside', () => {
    const app = appStandIn()
    render(twice(<Page open app={app} />))

    fireEvent.click(freePlay())
    fireEvent.click(line('Play Ode to Joy'))
    fireEvent.click(line('All songs…'))
    fireEvent.click(line('Settings'))
    fireEvent.click(line('About'))
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual([
      'onClose',
      'onClose',
      'onPlaySong starter:ode-to-joy',
      'onShowSongs',
      'onShowSettings',
      'onShowAbout',
    ])
  })

  it('still asks once at a click on the window around it', () => {
    const app = appStandIn()
    render(twice(<Page open waitingToStart app={app} />))
    fireEvent.click(windowButton() as HTMLElement)
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual(['onClose'])
  })

  it('leaves no listener on the window when it goes away', () => {
    const presses = watchPressListeners()
    const app = appStandIn()
    const view = render(twice(<Page open app={app} />))
    expect(presses.added()).toBeGreaterThan(0)

    view.rerender(twice(<Page open={false} app={app} />))
    expect(presses.removed()).toBe(presses.added())
    fireEvent.pointerDown(sky())
    expect(asked(app)).toEqual([])
  })
})
