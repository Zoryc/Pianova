/**
 * The few style rules the shell's behaviour hangs on, read as text: how the
 * menu is taken away (so that Tab cannot reach it and the mouse goes through
 * it), the hidden cursor, what in the sky lets a click through to the sky,
 * which layer lies over which, the gap an open panel leaves above the piano,
 * and where the top bar puts its parts. There is no layout engine here: this
 * is a code review written down as checks. They look at what a rule does,
 * not at how it is spelled.
 */
import { describe, expect, it } from 'vitest'

interface FileReader {
  readFileSync(path: URL, encoding: 'utf8'): string
}

// The test runner empties stylesheets that are imported, so the files are read
// from disk. (Loaded this way because the project has no Node type definitions.)
const fileSystemModule = 'node:fs'
const files = (await import(/* @vite-ignore */ fileSystemModule)) as FileReader

function readStyles(path: string): string {
  return files.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

const chromeCss = readStyles('./chrome.css')
const startBoxCss = readStyles('./startBox.css')
const stageCss = readStyles('./stage.css')
const skyCss = readStyles('./sky/sky.css')
const appCss = readStyles('../styles/app.css')
const themeCss = readStyles('../styles/theme.css')

/** The declarations of every rule of `css` whose selector list has exactly `selector` in it. */
function rule(css: string, selector: string): string {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => (match[1] ?? '').split(',').some((part) => part.trim() === selector))
    .map((match) => match[2] ?? '')
  if (found.length === 0) throw new Error(`There is no rule for "${selector}"`)
  return found.join(';')
}

/** The value of one property in a rule, or undefined when the rule does not set it. */
function value(css: string, selector: string, property: string): string | undefined {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule(css, selector))
  return found?.[1]?.trim().replace(/\s+/g, ' ')
}

/** The parts of a value that is a list with commas. */
function list(written: string | undefined): string[] {
  return (written ?? '').split(',').flatMap((part) => (part.trim() === '' ? [] : [part.trim()]))
}

/** A time as a stylesheet writes it ("160ms", "0.16s", "0s"), in milliseconds. */
function milliseconds(written: string | undefined): number {
  const amount = Number.parseFloat(written ?? '')
  return written?.endsWith('ms') ? amount : amount * 1000
}

/** One thing a rule changes gradually: how long the change takes, and how long it waits first. */
interface Change {
  property: string
  duration: number
  delay: number
}

/** The `transition` of a rule, one entry for each property it names. How the change is eased is left out. */
function changes(css: string, selector: string): Change[] {
  return list(value(css, selector, 'transition')).map((part) => {
    const [property = '', ...rest] = part.split(' ')
    const times = rest.filter((word) => /^[\d.]+m?s$/.test(word))
    return { property, duration: milliseconds(times[0] ?? '0s'), delay: milliseconds(times[1] ?? '0s') }
  })
}

/**
 * What `css` says only for the windows that match `query` (the inside of
 * "@media query { … }"), and what it says for every window (all the rest).
 */
function splitMedia(css: string, query: string): { matching: string; always: string } {
  const opening = `@media ${query}`
  const start = css.indexOf(opening)
  if (start < 0) throw new Error(`There is no "${opening}"`)
  const inside = css.indexOf('{', start) + 1
  let end = inside
  for (let depth = 1; depth > 0 && end < css.length; end++) {
    if (css[end] === '{') depth += 1
    if (css[end] === '}') depth -= 1
  }
  return { matching: css.slice(inside, end - 1), always: css.slice(0, start) + css.slice(end) }
}

/** The room a rule leaves under what is in its box, in pixels: from `padding-bottom`, or from `padding`. */
function paddingBottom(css: string, selector: string): number {
  const own = value(css, selector, 'padding-bottom')
  if (own !== undefined) return Number.parseFloat(own)
  const [top = '', , bottom = top] = (value(css, selector, 'padding') ?? '').split(' ')
  return Number.parseFloat(bottom)
}

describe('the hidden menu', () => {
  it('slides and fades for 160 ms, and is truly gone only once that is over', () => {
    const shown = changes(chromeCss, '.menu')
    const change = (property: string): Change | undefined =>
      shown.find((each) => each.property === property)
    expect(change('opacity')?.duration).toBe(160)
    expect(change('transform')?.duration).toBe(160)
    expect(value(chromeCss, '.menu--hidden', 'opacity')).toBe('0')
    // Gone for Tab, for the mouse and for screen readers, not merely see-through.
    expect(value(chromeCss, '.menu--hidden', 'visibility')).toBe('hidden')

    // Coming back, it can be seen and reached at once.
    expect(change('visibility')).toEqual({ property: 'visibility', duration: 0, delay: 0 })
    expect(value(chromeCss, '.menu', 'transition-delay')).toBeUndefined()
    // Going away, it is truly gone only when the slide is over. The hidden rule
    // says how long that waits: in a `transition` of its own, or as a delay for
    // each entry of the list above.
    const delays = list(value(chromeCss, '.menu--hidden', 'transition-delay'))
    const ownDelay = changes(chromeCss, '.menu--hidden').find(
      (each) => each.property === 'visibility',
    )?.delay
    const listedDelay = delays[shown.findIndex((each) => each.property === 'visibility')]
    expect(ownDelay ?? milliseconds(listedDelay)).toBe(160)
  })

  it('keeps its place while hidden, so that nothing under it moves', () => {
    const hidden = rule(chromeCss, '.menu--hidden')
    expect(hidden).not.toMatch(/display\s*:/)
    expect(hidden).not.toMatch(/(?:^|;)\s*(?:height|position)\s*:/)
  })

  it('takes the mouse cursor with it, over everything on the screen', () => {
    // The piano keys and the buttons set a cursor of their own, in rules that are
    // just as specific: "!important" is what makes the hidden cursor win over them.
    expect(value(chromeCss, '.cursor-hidden', 'cursor')).toMatch(/^none\s*!important$/)
    expect(value(chromeCss, '.cursor-hidden *', 'cursor')).toMatch(/^none\s*!important$/)
  })
})

describe('a click on the sky', () => {
  it.each([
    ['the canvas', skyCss, '.sky'],
    ['the words that say how to play', stageCss, '.stage__hint'],
    ['the sound status and the note names', stageCss, '.stage__foot'],
    ['the light line', stageCss, '.stage__line'],
    ['the box an open panel lives in', appCss, '.app__panels'],
    // It lies over the whole window, the menu and the piano too, and it stays
    // there with the box when the first click was on a line that leaves the
    // box open. All that is under it is reached through it.
    ['the layer the start box hangs in when the app opens', startBoxCss, '.start-layer'],
  ])('goes through %s', (_what, css, selector) => {
    expect(value(css, selector, 'pointer-events')).toBe('none')
  })

  it('does not go through the panel itself', () => {
    expect(value(chromeCss, '.floating-panel', 'pointer-events')).toBe('auto')
  })

  it('does not go through the start box either, which lives in the same box as a panel', () => {
    expect(value(startBoxCss, '.start-box', 'pointer-events')).toBe('auto')
  })
})

describe('what lies over what', () => {
  function layer(name: string): number {
    return Number(value(themeCss, ':root', name))
  }

  /** True when a rule stretches its element to the four edges of what it is in, however written. */
  function reachesEveryEdge(selector: string): boolean {
    const edges = ['top', 'right', 'bottom', 'left'].every((edge) =>
      /^0(px)?$/.test(value(startBoxCss, selector, edge) ?? ''),
    )
    return edges || /^0(px)?$/.test(value(startBoxCss, selector, 'inset') ?? '')
  }

  it('is the stage, then a panel, then the menu, then the start box while the app waits', () => {
    expect(layer('--layer-panel')).toBeGreaterThan(0)
    expect(layer('--layer-menu')).toBeGreaterThan(layer('--layer-panel'))
    expect(layer('--layer-overlay')).toBeGreaterThan(layer('--layer-menu'))

    expect(value(appCss, '.app__panels', 'z-index')).toBe('var(--layer-panel)')
    expect(value(chromeCss, '.menu', 'z-index')).toBe('var(--layer-menu)')
    // Until the first click the box hangs in a layer of its own, over everything.
    expect(value(startBoxCss, '.start-layer', 'z-index')).toBe('var(--layer-overlay)')
    // Opened with the Menu button it is where the panels are, and takes their
    // layer: it names none of its own, which would lift it over the menu.
    expect(value(startBoxCss, '.start-box', 'z-index')).toBeUndefined()
  })

  it('has a start layer that covers the whole window whatever is behind it', () => {
    // Taken out of the flow of the page and stretched to its four edges, however that is written.
    expect(value(startBoxCss, '.start-layer', 'position')).toMatch(/^(fixed|absolute)$/)
    expect(reachesEveryEdge('.start-layer')).toBe(true)
  })

  it('makes the whole of that layer one button, with the start box lying over it', () => {
    // The unseen button that starts the app is as large as the layer it is in.
    expect(value(startBoxCss, '.start-layer__window', 'position')).toBe('absolute')
    expect(reachesEveryEdge('.start-layer__window')).toBe(true)
    expect(value(startBoxCss, '.start-layer__window', 'pointer-events')).toBe('auto')
    // The box comes after the button on the page. It lies over it, so that its
    // lines can be clicked, only because it has a place in the stack as well.
    expect(value(startBoxCss, '.start-box', 'position')).toBe('relative')
    expect(value(startBoxCss, '.start-layer__window', 'z-index')).toBeUndefined()
  })

  it('gives the start layer one place in the stack, and its window button none at all', () => {
    const numbered = [...startBoxCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => /(?:^|;)\s*z-index\s*:/.test(match[2] ?? ''))
      .flatMap((match) => (match[1] ?? '').split(',').map((selector) => selector.trim()))
      .filter((selector) => selector.includes('.start-layer'))
    // The layer is given its place over the menu once, for every window: a
    // second rule, for low windows say, could put it under the menu there.
    // And the button is given none, not even while it is pressed or has the
    // focus: that would lift it over the lines of the box.
    expect(numbered).toEqual(['.start-layer'])
  })

  // The app puts an open box between the menu and the piano. The layer does
  // the same with its own room at the top and at the bottom, so that the box
  // does not jump when the first click moves it from one to the other.
  it('keeps the waiting start box where it is put later: under the bar, above the piano', () => {
    // The three lengths of the padding. A space inside brackets does not start a new one.
    const [top, sides, bottom] = (value(startBoxCss, '.start-layer', 'padding') ?? '').split(
      /\s+(?![^(]*\))/,
    )
    expect(sides).toBe('0')

    // At the top: the bar, the room under it that is still the menu's, and
    // the room the box of the panels leaves above a panel (the first length
    // of its padding).
    const underTheBar = Number.parseFloat(value(chromeCss, '.menu', 'padding-bottom') ?? '')
    const aboveAPanel = Number.parseFloat(value(appCss, '.app__panels', 'padding') ?? '')
    expect(value(chromeCss, '.top-bar', 'min-height')).toBe('var(--top-bar-height)')
    expect(top).toBe(`calc(var(--top-bar-height) + ${underTheBar + aboveAPanel}px)`)

    // At the bottom: the piano, never higher than 34% of the window, the 2%
    // of room under it, and the gap a panel leaves above it in a low window.
    const pianoCss = readStyles('./piano.css')
    expect(value(pianoCss, '.piano', 'max-height')).toBe('34dvh')
    expect(value(stageCss, '.stage__piano', 'padding-bottom')).toBe('max(8px, 2dvh)')
    const { always } = splitMedia(appCss, '(min-height: 560px)')
    expect(bottom).toBe(`calc(36dvh + ${paddingBottom(always, '.app__panels')}px)`)
  })
})

describe('the gap an open panel leaves above the piano', () => {
  /** The gap in pixels: in a window at least 560px high, and in a lower one. */
  function gap(): { high: number; low: number } {
    const { matching, always } = splitMedia(appCss, '(min-height: 560px)')
    return { high: paddingBottom(matching, '.app__panels'), low: paddingBottom(always, '.app__panels') }
  }

  it('is 12px in a low window, and 44px in a window at least 560px high', () => {
    expect(gap()).toEqual({ high: 44, low: 12 })
  })

  it('is then enough for the line of words above the piano, which a panel would otherwise cover', () => {
    // The line (the sound status, its badges, the names of the notes) stands at
    // the bottom of the sky, where the box of the panel ends too.
    expect(value(stageCss, '.stage__foot', 'bottom')).toBe('0')
    const lineHeight = Number(value(themeCss, 'body', 'line-height'))
    const letters = ['.stage__note', '.stage__sound'].map((selector) =>
      Number.parseFloat(value(stageCss, selector, 'font-size') ?? ''),
    )
    // A badge has a hairline above and below its words.
    const hairlines = 2 * Number.parseFloat(value(stageCss, '.stage__badge', 'border') ?? '')
    const lineOfWords =
      paddingBottom(stageCss, '.stage__foot') + Math.max(...letters) * lineHeight + hairlines

    expect(lineOfWords).toBeGreaterThan(gap().low)
    expect(lineOfWords).toBeLessThanOrEqual(gap().high)
  })
})

describe('the top bar in a narrow window', () => {
  it('drops the volume slider below 900px, and nothing else: the Menu button always stays', () => {
    const narrow = [...chromeCss.matchAll(/@media \(max-width: (\d+)px\)\s*\{([\s\S]*?\})\s*\}/g)].map(
      (match) => ({ width: Number(match[1]), rules: match[2] ?? '' }),
    )
    const volume = narrow.find(({ rules }) => rules.includes('.top-bar__volume'))

    expect(volume?.width).toBe(899)
    expect(volume?.rules).toMatch(/display:\s*none/)

    // The ways to play, the songs and Settings are in the start box, and the
    // Menu button is the only way to it. So in no window, however narrow, is
    // anything else of the bar taken away.
    const takenAway = [...chromeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => /display\s*:\s*none/.test(match[2] ?? ''))
      .flatMap((match) => (match[1] ?? '').split(',').map((selector) => selector.trim()))
      .filter((selector) => selector.includes('.top-bar'))
    expect(takenAway).toEqual(['.top-bar__volume'])
    // One block of rules for narrow windows is all the bar has.
    expect(narrow.filter(({ rules }) => rules.includes('.top-bar'))).toHaveLength(1)
  })
})

describe('the top bar with a song loaded', () => {
  /** Where a rule puts its element in the grid of the bar: "row / column", as it is written. */
  function place(css: string, selector: string): string | undefined {
    return value(css, selector, 'grid-area')
  }

  it('has the Menu button, the room, volume and sustain in its first row, left to right', () => {
    expect(value(chromeCss, '.top-bar', 'display')).toBe('grid')
    // The room is the one column that stretches, and it may shrink to nothing.
    expect(value(chromeCss, '.top-bar', 'grid-template-columns')).toBe(
      'auto minmax(0, 1fr) auto auto',
    )
    expect(place(chromeCss, '.top-bar__menu')).toBe('1 / 1')
    expect(place(chromeCss, '.top-bar__space')).toBe('1 / 2')
    expect(place(chromeCss, '.top-bar__volume')).toBe('1 / 3')
    expect(place(chromeCss, '.top-bar__sustain')).toBe('1 / 4')
  })

  it('gives the player line a row of its own under them, across the whole bar', () => {
    const { always } = splitMedia(chromeCss, '(min-width: 1650px)')
    expect(place(always, '.top-bar > .player-line')).toBe('2 / 1 / auto / -1')
    // There it may be as wide as the bar, which has edges of its own, and no
    // wider than 1120px in a bar that is wider.
    expect(value(always, '.top-bar > .player-line', 'width')).toBe('min(1120px, 100%)')
    // The bar grows by that row: it is at least as high as one row, not exactly.
    expect(value(chromeCss, '.top-bar', 'min-height')).toBe('var(--top-bar-height)')
    expect(value(chromeCss, '.top-bar', 'height')).toBeUndefined()
  })

  it('puts the player line in the room of the first row from 1650px: one bar, not two', () => {
    const { matching } = splitMedia(chromeCss, '(min-width: 1650px)')
    expect(place(matching, '.top-bar > .player-line')).toBe('1 / 2')
    // It fills that room, in place of the width it has in a row of its own.
    expect(value(matching, '.top-bar > .player-line', 'width')).toBe('auto')
  })
})
