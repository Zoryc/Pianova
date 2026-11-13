// @vitest-environment jsdom
/**
 * The stage (src/ui/Stage.tsx): which piano it shows for the window it is
 * in, that the sky and the piano are given the same one, and the quiet words
 * it writes over the sky.
 *
 * The sky itself is replaced by a stand-in that remembers what it was given:
 * its drawing is tested in src/ui/sky. There is no layout here, so the width
 * of the stage is whatever the test says it is.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioStatus } from '../audio/audioEngine'
import type { PianoRange } from '../core/layout'
import { NoteBus } from '../core/noteBus'
import type { Midi } from '../core/types'
import { DEFAULT_SETTINGS } from '../state/settings'
import type { Settings } from '../state/settings'
import { Stage } from './Stage'
import type { StageProps } from './Stage'
import type { FallingSource, SkyProps } from './sky/Sky'

const HINT = 'Press the keys shown on the piano, or click it'

/** What the stand-in sky was last given. */
const sky = vi.hoisted(() => ({ props: null as unknown }))

vi.mock('./sky/Sky', async () => {
  const { createElement } = await import('react')
  return {
    Sky(props: unknown) {
      sky.props = props
      return createElement('canvas', { className: 'sky' })
    },
  }
})

function skyProps(): SkyProps {
  return sky.props as SkyProps
}

/** How wide the stage is on the test's make-believe screen. */
let stageWidth = 1366
/** The functions to call when the stage changes size, as the browser would. */
let resizeListeners: (() => void)[] = []

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(): void {
    resizeListeners.push(this.callback)
  }
  disconnect(): void {
    resizeListeners = resizeListeners.filter((listener) => listener !== this.callback)
  }
}

function resizeTo(width: number): void {
  stageWidth = width
  act(() => {
    for (const listener of resizeListeners) listener()
  })
}

beforeEach(() => {
  stageWidth = 1366
  resizeListeners = []
  sky.props = null
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.classList.contains('stage') ? stageWidth : 0
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0 } as DOMRect
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const HOME_ROW_LABELS: ReadonlyMap<number, string> = new Map([
  [12, 'A'],
  [13, 'W'],
  [14, 'S'],
  [16, 'D'],
])

function stageProps(overrides: Partial<StageProps> = {}): StageProps {
  return {
    id: 'the-stage',
    label: 'Free Play',
    bus: new NoteBus(),
    settings: DEFAULT_SETTINGS,
    keyLabels: HOME_ROW_LABELS,
    hints: new Map(),
    falling: null,
    audioStatus: 'ready',
    showHint: true,
    editMode: false,
    selectedSlot: null,
    onSelectSlot: vi.fn(),
    onNoteDown: vi.fn(),
    onNoteUp: vi.fn(),
    onRangeChange: vi.fn(),
    onSkyClick: vi.fn(),
    ...overrides,
  }
}

function drawStage(overrides: Partial<StageProps> = {}) {
  const props = stageProps(overrides)
  const view = render(<Stage {...props} />)
  return {
    props,
    redraw(changes: Partial<StageProps>) {
      Object.assign(props, changes)
      view.rerender(<Stage {...props} />)
    },
  }
}

function withSettings(changes: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...changes }
}

function pianoKeys(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.piano-key')]
}

/** The lowest and highest note the piano draws. */
function pianoOnScreen(): PianoRange {
  const notes = pianoKeys().map((key) => Number(key.dataset.midi))
  return { first: Math.min(...notes), last: Math.max(...notes) }
}

function pianoKey(midi: Midi): HTMLElement {
  const key = document.querySelector<HTMLElement>(`.piano-key[data-midi="${midi}"]`)
  if (!key) throw new Error(`The piano has no key for note ${midi}.`)
  return key
}

function hint(): HTMLElement {
  return screen.getByText(HINT)
}

function noteNames(): string[] {
  const list = screen.queryByRole('list', { name: 'Notes being played' })
  return list ? within(list).getAllByRole('listitem').map((item) => item.textContent ?? '') : []
}

function play(bus: NoteBus, ...notes: Midi[]): void {
  act(() => {
    for (const midi of notes) bus.noteOn(midi, 'keyboard')
  })
}

function release(bus: NoteBus, ...notes: Midi[]): void {
  act(() => {
    for (const midi of notes) bus.noteOff(midi, 'keyboard')
  })
}

const A_SONG: FallingSource = { getNotes: () => [], getPosition: () => 0, isPlaying: () => false }

describe('the piano it shows', () => {
  // A white key must be at least 26px wide: 52, 36 and 29 white keys need 1352, 936 and 754px.
  it.each([
    [1920, 88],
    [1366, 88],
    [1352, 88],
    [1351, 61],
    [936, 61],
    [935, 49],
    [800, 49],
    [754, 49],
    [753, 37],
    [400, 37],
  ])('on "Auto", %ipx wide, is the largest piano with comfortable keys: %i', (width, keys) => {
    stageWidth = width
    drawStage()
    expect(pianoKeys()).toHaveLength(keys)
  })

  it.each([88, 61, 49, 37] as const)('has the %i keys the player asked for', (size) => {
    stageWidth = 400
    drawStage({ settings: withSettings({ pianoSize: size }) })
    expect(pianoKeys()).toHaveLength(size)

    resizeTo(2560)
    expect(pianoKeys()).toHaveLength(size)
  })

  it('is the smallest piano where nothing can be measured', () => {
    stageWidth = 0
    vi.stubGlobal('ResizeObserver', undefined)
    drawStage()
    expect(pianoKeys()).toHaveLength(37)
  })

  it('still fits the window in a browser that cannot watch sizes', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    drawStage()
    expect(pianoKeys()).toHaveLength(88)
  })

  it('changes with the window, and goes back', () => {
    drawStage()
    expect(pianoKeys()).toHaveLength(88)

    resizeTo(1000)
    expect(pianoKeys()).toHaveLength(61)
    resizeTo(700)
    expect(pianoKeys()).toHaveLength(37)
    resizeTo(1366)
    expect(pianoKeys()).toHaveLength(88)
  })

  it('stops watching the window when it goes away', () => {
    const view = render(<Stage {...stageProps()} />)
    expect(resizeListeners).toHaveLength(1)
    view.unmount()
    expect(resizeListeners).toHaveLength(0)
  })

  it('watches the window once, also when React draws it twice', () => {
    render(
      <StrictMode>
        <Stage {...stageProps()} />
      </StrictMode>,
    )
    expect(resizeListeners).toHaveLength(1)
    expect(pianoKeys()).toHaveLength(88)
  })

  it.each([
    [88, 3, { first: 21, last: 108 }],
    [61, 3, { first: 36, last: 96 }],
    [49, 3, { first: 36, last: 84 }],
    [49, 5, { first: 60, last: 108 }],
    [37, 1, { first: 24, last: 60 }],
  ] as const)(
    'with %i keys and the computer keys from C%i, shows the notes that hold them',
    (size, baseOctave, range) => {
      drawStage({ settings: withSettings({ pianoSize: size, baseOctave }) })
      expect(pianoOnScreen()).toEqual(range)
    },
  )
})

describe('the sky and the piano', () => {
  it.each([
    [1920, 'auto'],
    [1000, 'auto'],
    [700, 'auto'],
    [1366, 61],
    [1366, 49],
    [1366, 37],
  ] as const)('show the same notes (stage %ipx wide, size %s)', (width, pianoSize) => {
    stageWidth = width
    for (const baseOctave of [1, 2, 3, 4, 5]) {
      drawStage({ settings: withSettings({ pianoSize, baseOctave }) })
      expect(skyProps().range).toEqual(pianoOnScreen())
      cleanup()
    }
  })

  it('still do after the window changed', () => {
    drawStage()
    resizeTo(820)
    expect(skyProps().range).toEqual(pianoOnScreen())
    expect(skyProps().range).toEqual({ first: 36, last: 84 })
  })

  it('tells the app which piano is on screen: the first one, then each new one', () => {
    const { props, redraw } = drawStage()
    const reported = (): PianoRange | undefined => vi.mocked(props.onRangeChange).mock.lastCall?.[0]
    expect(reported()).toEqual({ first: 21, last: 108 })

    redraw({ settings: withSettings({ pianoSize: 61 }) })
    expect(reported()).toEqual({ first: 36, last: 96 })

    redraw({ settings: withSettings({ pianoSize: 61, baseOctave: 5 }) })
    expect(reported()).toEqual({ first: 48, last: 108 })

    resizeTo(700)
    expect(reported()).toEqual({ first: 48, last: 108 })

    redraw({ settings: withSettings({ pianoSize: 'auto', baseOctave: 5 }) })
    expect(reported()).toEqual({ first: 72, last: 108 })
  })

  it('says nothing when the piano stays the same', () => {
    const { props, redraw } = drawStage()
    const calls = vi.mocked(props.onRangeChange).mock.calls.length

    redraw({ settings: withSettings({ volume: 0.2, accent: 'blue', labelMode: 'none' }) })
    redraw({ audioStatus: 'loading' })
    resizeTo(1400)
    // The full piano is the full piano wherever the computer keys sit.
    redraw({ settings: withSettings({ baseOctave: 1 }) })

    expect(props.onRangeChange).toHaveBeenCalledTimes(calls)
  })

  it('reports to the newest function it was given', () => {
    const { redraw } = drawStage()
    const newer = vi.fn()
    redraw({ onRangeChange: newer })
    expect(newer).not.toHaveBeenCalled()

    redraw({ settings: withSettings({ pianoSize: 37 }) })
    expect(newer).toHaveBeenCalledWith({ first: 48, last: 84 })
  })

  it('puts the canvas, then the light line, in the sky, and the piano after the sky', () => {
    drawStage()
    const stage = screen.getByRole('region', { name: 'Free Play' })
    const [skyBox, pianoBox] = [...stage.children]
    expect(stage.children).toHaveLength(2)
    expect(skyBox?.className).toBe('stage__sky')
    expect(skyBox?.firstElementChild?.matches('canvas.sky')).toBe(true)
    expect(skyBox?.lastElementChild?.className).toBe('stage__line')
    expect(skyBox?.lastElementChild?.getAttribute('aria-hidden')).toBe('true')
    expect(pianoBox?.className).toBe('stage__piano')
    expect(pianoBox?.firstElementChild).toBe(screen.getByRole('group', { name: 'Piano' }))
  })

  it('is a region of the page, called by the way of playing it is given', () => {
    const { redraw } = drawStage()
    const stage = screen.getByRole('region')
    expect(stage.id).toBe('the-stage')
    expect(stage.getAttribute('aria-label')).toBe('Free Play')
    // The name is written on the stage itself, not borrowed from another part of the page.
    expect(stage.hasAttribute('aria-labelledby')).toBe(false)

    redraw({ label: 'Practice' })
    expect(screen.getByRole('region', { name: 'Practice' })).toBe(stage)
  })

  it('lets the sky start below a menu that is always shown', () => {
    const { redraw } = drawStage()
    expect(screen.getByRole('region').className).toBe('stage')

    redraw({ settings: withSettings({ autoHideMenu: false }) })
    expect(screen.getByRole('region').className).toBe('stage stage--below-menu')
  })
})

describe('what the sky is given', () => {
  it('follows the look the player chose', () => {
    const bus = new NoteBus()
    const hints = new Map([[60, 'A']])
    const settings = withSettings({
      showTrails: false,
      barStyle: 'neon',
      sparks: 'lots',
      glow: 0.25,
      background: 'aurora',
      accent: 'custom',
      customColour: '#123456',
    })
    drawStage({ bus, settings, hints, falling: A_SONG })

    expect(skyProps()).toEqual({
      bus,
      range: { first: 21, last: 108 },
      showBars: false,
      barStyle: 'neon',
      sparks: 'lots',
      glow: 0.25,
      background: 'aurora',
      accent: 'custom',
      customColour: '#123456',
      falling: A_SONG,
      hints,
    })
    expect(skyProps().bus).toBe(bus)
    expect(skyProps().hints).toBe(hints)
    expect(skyProps().falling).toBe(A_SONG)
  })

  it('has no falling notes in free play', () => {
    drawStage()
    expect(skyProps().falling).toBeNull()
    expect(skyProps().showBars).toBe(true)
  })
})

describe('a click on the sky', () => {
  it('is reported, wherever in the sky it lands', () => {
    const { props } = drawStage()

    fireEvent.click(document.querySelector('.stage__sky') as HTMLElement)
    expect(props.onSkyClick).toHaveBeenCalledTimes(1)
    fireEvent.click(hint())
    expect(props.onSkyClick).toHaveBeenCalledTimes(2)
  })

  it('is not a click on the piano', () => {
    const { props } = drawStage()
    fireEvent.click(pianoKey(60))
    fireEvent.click(screen.getByRole('group', { name: 'Piano' }))
    expect(props.onSkyClick).not.toHaveBeenCalled()
  })
})

describe('how to play', () => {
  it('is written over the sky until the first note', () => {
    const bus = new NoteBus()
    drawStage({ bus })
    expect(hint().className).toBe('stage__hint')

    play(bus, 60)
    expect(hint().className).toBe('stage__hint stage__hint--gone')
  })

  it('does not come back when the note stops, or later', () => {
    const bus = new NoteBus()
    const { redraw } = drawStage({ bus })
    play(bus, 60)
    release(bus, 60)
    expect(hint().className).toBe('stage__hint stage__hint--gone')

    redraw({ settings: withSettings({ volume: 0.1 }) })
    redraw({ showHint: false })
    redraw({ showHint: true })
    expect(hint().className).toBe('stage__hint stage__hint--gone')
  })

  it('goes at a note played by the mouse or by a song as well', () => {
    for (const source of ['pointer', 'playback'] as const) {
      const bus = new NoteBus()
      drawStage({ bus })
      act(() => bus.noteOn(64, source))
      expect(hint().className).toBe('stage__hint stage__hint--gone')
      cleanup()
    }
  })

  it('is kept back while the app says so, and shown once it may', () => {
    const { redraw } = drawStage({ showHint: false })
    expect(hint().className).toBe('stage__hint stage__hint--gone')

    redraw({ showHint: true })
    expect(hint().className).toBe('stage__hint')
  })

  it('is gone from the start when a note is already held', () => {
    const bus = new NoteBus()
    bus.noteOn(60, 'keyboard')
    drawStage({ bus })
    expect(hint().className).toBe('stage__hint stage__hint--gone')
  })
})

describe('the notes being played', () => {
  it('are named, lowest first', () => {
    const bus = new NoteBus()
    drawStage({ bus })
    expect(noteNames()).toEqual([])

    play(bus, 67, 60, 64)
    expect(noteNames()).toEqual(['C4', 'E4', 'G4'])

    release(bus, 64)
    expect(noteNames()).toEqual(['C4', 'G4'])
    release(bus, 60, 67)
    expect(noteNames()).toEqual([])
  })

  it('are written the way the player reads notes', () => {
    const bus = new NoteBus()
    drawStage({ bus, settings: withSettings({ noteNaming: 'solfege' }) })
    play(bus, 60, 61, 67)
    expect(noteNames()).toEqual(['Do4', 'Do♯4', 'Sol4'])
  })

  it('stay one line long: eight names, then how many more', () => {
    const bus = new NoteBus()
    drawStage({ bus })

    play(bus, 60, 62, 64, 65, 67, 69, 71, 72)
    expect(noteNames()).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'])

    play(bus, 74)
    expect(noteNames()).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', '+1'])

    play(bus, 48, 50)
    expect(noteNames()).toEqual(['C3', 'D3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', '+3'])
  })

  it('are left out when the player switched them off', () => {
    const bus = new NoteBus()
    const { redraw } = drawStage({ bus, settings: withSettings({ showNoteNames: false }) })
    play(bus, 60)
    expect(noteNames()).toEqual([])

    redraw({ settings: DEFAULT_SETTINGS })
    expect(noteNames()).toEqual(['C4'])
  })

  it('are left out while a song is loaded', () => {
    const bus = new NoteBus()
    const { redraw } = drawStage({ bus, falling: A_SONG })
    play(bus, 60)
    expect(noteNames()).toEqual([])

    redraw({ falling: null })
    expect(noteNames()).toEqual(['C4'])
  })

  it('are not read out: they change too fast', () => {
    const bus = new NoteBus()
    drawStage({ bus })
    play(bus, 60, 64)
    const list = screen.getByRole('list', { name: 'Notes being played' })
    expect(list.closest('[role="status"], [aria-live]')).toBeNull()
  })

  it('light the keys of the piano', () => {
    const bus = new NoteBus()
    drawStage({ bus })
    play(bus, 60, 61)
    expect(pianoKey(60).classList.contains('is-lit')).toBe(true)
    expect(pianoKey(61).classList.contains('is-lit')).toBe(true)
    expect(document.querySelectorAll('.piano-key.is-lit')).toHaveLength(2)

    release(bus, 60, 61)
    expect(document.querySelectorAll('.piano-key.is-lit')).toHaveLength(0)
  })

  it('follow another bus when the stage is given one', () => {
    const first = new NoteBus()
    const second = new NoteBus()
    const { redraw } = drawStage({ bus: first })
    play(first, 60)

    redraw({ bus: second })
    expect(noteNames()).toEqual([])
    play(second, 72)
    expect(noteNames()).toEqual(['C5'])
  })
})

describe('the sound status', () => {
  it.each<[AudioStatus, string]>([
    ['idle', ''],
    ['loading', 'Loading piano sound…'],
    ['ready', ''],
    ['fallback', 'Using basic sound (piano sound could not be loaded).'],
    ['error', 'Sound could not start. Click anywhere to try again.'],
  ])('while the sound is "%s" reads "%s"', (audioStatus, text) => {
    drawStage({ audioStatus })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(text)
    expect(status.dataset.status).toBe(audioStatus)
  })

  it('is one element that stays, so a change is announced', () => {
    const { redraw } = drawStage({ audioStatus: 'idle' })
    const status = screen.getByRole('status')

    redraw({ audioStatus: 'loading' })
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('Loading piano sound…')
    redraw({ audioStatus: 'ready' })
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('')
  })

  it.each([
    [2, 'Transposed +2'],
    [-3, 'Transposed −3'],
    [12, 'Transposed +12'],
  ])('has "the piano is transposed" next to it (%i)', (transpose, text) => {
    drawStage({ settings: withSettings({ transpose }) })
    const badge = screen.getByText(text)
    expect(badge.parentElement).toBe(screen.getByRole('status').parentElement)
  })

  it('says nothing about transposing at 0', () => {
    drawStage()
    expect(screen.queryByText(/Transposed/)).toBeNull()
  })

  it('has "Sustain on" next to it while sustain is on, and only then', () => {
    const { redraw } = drawStage()
    expect(screen.queryByText(/Sustain/)).toBeNull()

    redraw({ settings: withSettings({ sustain: true }) })
    const badge = screen.getByText('Sustain on')
    expect(badge.className).toBe('stage__badge')
    expect(badge.parentElement).toBe(screen.getByRole('status').parentElement)

    redraw({ settings: withSettings({ sustain: false }) })
    expect(screen.queryByText(/Sustain/)).toBeNull()
  })

  it('writes both badges side by side, after the status', () => {
    drawStage({ audioStatus: 'loading', settings: withSettings({ transpose: -3, sustain: true }) })
    const strip = screen.getByRole('status').parentElement
    expect([...(strip?.children ?? [])].map((part) => part.textContent)).toEqual([
      'Loading piano sound…',
      'Transposed −3',
      'Sustain on',
    ])
  })

  it('does not read the badges out with the status', () => {
    drawStage({ settings: withSettings({ transpose: 2, sustain: true }) })
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('the piano on the stage', () => {
  function keycaps(): string[] {
    return [...document.querySelectorAll('.piano-key__cap')].map((cap) => cap.textContent ?? '')
  }

  it('is drawn in the style and the colour the player chose', () => {
    const bus = new NoteBus()
    drawStage({ bus, settings: withSettings({ keyStyle: 'glass', accent: 'blue' }) })
    expect(screen.getByRole('group', { name: 'Piano' }).dataset.keyStyle).toBe('glass')
    expect(pianoKey(60).style.getPropertyValue('--key-light')).toBe('#2f8bff')
  })

  it('carries the keycaps it is given, on the keys of the computer keyboard', () => {
    drawStage()
    expect(keycaps()).toEqual(['A', 'W', 'S', 'D'])
    expect(pianoKey(60).getAttribute('aria-label')).toBe('C4, key A')
  })

  it('moves the keycaps with the computer keys', () => {
    drawStage({ settings: withSettings({ baseOctave: 2 }) })
    expect(pianoKey(48).getAttribute('aria-label')).toBe('C3, key A')
    expect(pianoKey(60).getAttribute('aria-label')).toBe('C4')
  })

  it.each([
    ['none', []],
    ['notes', []],
    ['keys', ['A', 'W', 'S', 'D']],
    ['both', ['A', 'W', 'S', 'D']],
  ] as const)('with labels "%s" shows the keycaps %j', (labelMode, caps) => {
    drawStage({ settings: withSettings({ labelMode }) })
    expect(keycaps()).toEqual(caps)
  })

  it.each(['none', 'notes', 'keys', 'both'] as const)(
    'always shows the keycaps while the computer keys are chosen (labels "%s")',
    (labelMode) => {
      const { redraw } = drawStage({ settings: withSettings({ labelMode }), editMode: true })
      expect(keycaps()).toEqual(['A', 'W', 'S', 'D'])
      const showsNoteNames = document.querySelectorAll('.piano-key__note').length > 0
      expect(showsNoteNames).toBe(labelMode === 'notes' || labelMode === 'both')

      redraw({ editMode: false })
      const showsKeycaps = labelMode === 'keys' || labelMode === 'both'
      expect(keycaps()).toEqual(showsKeycaps ? ['A', 'W', 'S', 'D'] : [])
    },
  )

  it('selects a key instead of playing it while the computer keys are chosen', () => {
    const { props, redraw } = drawStage({ editMode: true })
    const piano = screen.getByRole('group', { name: 'Piano' })
    expect(piano.classList.contains('piano--editing')).toBe(true)

    fireEvent.click(pianoKey(64))
    expect(props.onSelectSlot).toHaveBeenCalledWith(16)
    expect(props.onNoteDown).not.toHaveBeenCalled()

    redraw({ selectedSlot: 16 })
    expect(pianoKey(64).classList.contains('is-selected')).toBe(true)
  })

  it('selects nothing outside of that', () => {
    const { props } = drawStage({ selectedSlot: 16 })
    fireEvent.click(pianoKey(64))
    expect(props.onSelectSlot).not.toHaveBeenCalled()
    expect(pianoKey(64).classList.contains('is-selected')).toBe(false)
  })
})
