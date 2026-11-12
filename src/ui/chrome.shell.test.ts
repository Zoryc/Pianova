/**
 * The few style rules the shell's behaviour hangs on, read as text: how the
 * menu is taken away (so that Tab cannot reach it and the mouse goes through
 * it), the hidden cursor, what in the sky lets a click through to the sky,
 * which layer lies over which, and the gap an open panel leaves above the
 * piano. There is no layout engine here: this is a code review written down
 * as checks. They look at what a rule does, not at how it is spelled.
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
  ])('goes through %s', (_what, css, selector) => {
    expect(value(css, selector, 'pointer-events')).toBe('none')
  })

  it('does not go through the panel itself', () => {
    expect(value(chromeCss, '.floating-panel', 'pointer-events')).toBe('auto')
  })
})

describe('what lies over what', () => {
  function layer(name: string): number {
    return Number(value(themeCss, ':root', name))
  }

  it('is the stage, then a panel, then the menu, then the start overlay', () => {
    expect(layer('--layer-panel')).toBeGreaterThan(0)
    expect(layer('--layer-menu')).toBeGreaterThan(layer('--layer-panel'))
    expect(layer('--layer-overlay')).toBeGreaterThan(layer('--layer-menu'))

    expect(value(appCss, '.app__panels', 'z-index')).toBe('var(--layer-panel)')
    expect(value(chromeCss, '.menu', 'z-index')).toBe('var(--layer-menu)')
    expect(value(chromeCss, '.start-overlay', 'z-index')).toBe('var(--layer-overlay)')
  })

  it('has a start overlay that covers the whole window whatever is behind it', () => {
    // Taken out of the flow of the page and stretched to its four edges, however that is written.
    expect(value(chromeCss, '.start-overlay', 'position')).toMatch(/^(fixed|absolute)$/)
    const reachesEveryEdge = ['top', 'right', 'bottom', 'left'].every((edge) =>
      /^0(px)?$/.test(value(chromeCss, '.start-overlay', edge) ?? ''),
    )
    const inset = value(chromeCss, '.start-overlay', 'inset') ?? ''
    expect(reachesEveryEdge || /^0(px)?$/.test(inset)).toBe(true)
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
  it('drops the volume slider below 900px, and by then the modes that are still to come', () => {
    const narrow = [...chromeCss.matchAll(/@media \(max-width: (\d+)px\)\s*\{([\s\S]*?\})\s*\}/g)].map(
      (match) => ({ width: Number(match[1]), rules: match[2] ?? '' }),
    )
    const volume = narrow.find(({ rules }) => rules.includes('.top-bar__volume'))
    const comingModes = narrow.find(({ rules }) => rules.includes(".mode-tab[aria-disabled='true']"))

    expect(volume?.width).toBe(899)
    expect(volume?.rules).toMatch(/display:\s*none/)
    expect(comingModes?.rules).toMatch(/display:\s*none/)
    expect(comingModes?.width).toBeGreaterThanOrEqual(899)
  })
})
