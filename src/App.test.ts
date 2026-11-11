// @vitest-environment jsdom
/**
 * The parts of the screen, one at a time.
 *
 * Most checks draw a part to a string and look at what is there and at the
 * wording the user is meant to read. The checks at the end draw a part in a
 * simulated browser, to try where the keyboard focus goes. The rules of key
 * presses are tested in src/ui/keyEditorModel.test.ts and
 * src/input/keyboardInput.test.ts.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { APP_NAME } from './app/appInfo'
import { SLOT_COUNT } from './core/layout'
import { DEFAULT_SETTINGS } from './state/settings'
import type { Settings } from './state/settings'
import { AdvancedPanel } from './ui/AdvancedPanel'
import { KeyEditor } from './ui/KeyEditor'
import { ModeTabs } from './ui/ModeTabs'
import { NowPlaying } from './ui/NowPlaying'
import { Toolbar } from './ui/Toolbar'
import { ConfirmButton } from './ui/controls'

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
}

/** The text a user would read, with single spaces between the pieces. */
function textOf(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

function draw(element: ReactElement): { html: string; text: string } {
  const html = renderToString(element)
  return { html, text: textOf(html) }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function noop(): void {}

function toolbar(settings: Settings, editing = false, advancedOpen = false): ReactElement {
  return createElement(Toolbar, {
    settings,
    editing,
    advancedOpen,
    advancedPanelId: 'advanced',
    customizeButtonRef: { current: null },
    onToggleEditing: noop,
    onToggleAdvanced: noop,
  })
}

function advancedPanel(settings: Settings): ReactElement {
  return createElement(AdvancedPanel, { id: 'advanced', settings })
}

describe('App, as first drawn', () => {
  const { html, text } = draw(createElement(App))

  it('shows the name and the three modes', () => {
    expect(html).toContain(`<h1 class="app-title">${APP_NAME}</h1>`)
    expect(text).toContain('Free Play Practice Soon Real-time Soon')
  })

  it('shows the toolbar with the default settings', () => {
    expect(text).toContain('Volume 🔊 80%')
    expect(text).toContain('Sustain Off Space')
    expect(text).toMatch(/Piano position \S+ Lower C3 – C6 Higher \S+ Labels/)
    expect(text).toContain('Labels Keys and notes Keys only Notes only No labels')
    expect(text).toContain('Customize keys')
    expect(text).toContain('Advanced')
  })

  it('keeps the Advanced panel and the key editor closed', () => {
    expect(text).not.toContain('Advanced settings')
    expect(text).not.toContain('Click a piano key')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-pressed="false"')
  })

  it('shows the hint where the notes being played will be', () => {
    expect(text).toContain('Press the keys shown on the piano, or click it')
    expect(text).not.toContain('Transposed')
  })

  it('draws the light trails directly before the whole piano', () => {
    expect(html).toMatch(/<canvas class="note-trails"[^>]*><\/canvas><\/div><div class="piano"/)
    expect(count(html, 'class="piano-key ')).toBe(SLOT_COUNT)
  })

  it('writes the default computer keys on the piano', () => {
    expect(html).toContain('aria-label="C4, key A"')
    expect(html).toContain('aria-label="F5, key &#x27;"')
    expect(html).toContain('aria-label="C3"')
  })

  it('explains the sustain key and says nothing about the sound yet', () => {
    expect(text).toContain('Space turns sustain on and off.')
    expect(text).not.toContain('piano sound')
    expect(text).not.toContain('Sound could not start')
  })

  it('credits the piano recordings at the end of the footer, with a link to their licence', () => {
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'))
    // Without the tags, the credit reads as one sentence.
    expect(footer.replace(/<[^>]+>/g, '')).toMatch(
      /Piano sound: Salamander Grand Piano by Alexander Holm \(CC BY 3\.0\)$/,
    )
    expect(footer).toContain('<a href="https://creativecommons.org/licenses/by/3.0/"')
    expect(footer).toContain('rel="noreferrer">CC BY 3.0</a>')
  })

  it('waits behind the start overlay', () => {
    expect(text).toContain(`${APP_NAME} Click or press any key to start`)
    expect(html).toMatch(/<div class="app" inert=""/)
  })
})

describe('ModeTabs', () => {
  const { html } = draw(createElement(ModeTabs, { tabId: 'tab', panelId: 'panel' }))

  it('marks Free Play as the selected tab of the page below', () => {
    expect(html).toContain('role="tablist"')
    expect(html).toContain('id="tab"')
    expect(html).toContain('role="tab" aria-selected="true" aria-controls="panel">Free Play<')
  })

  it('marks the other modes as not available yet', () => {
    expect(count(html, 'aria-selected="false"')).toBe(2)
    expect(count(html, 'aria-disabled="true"')).toBe(2)
    expect(count(html, 'title="Coming in a later update"')).toBe(2)
    expect(count(html, '>Soon<')).toBe(2)
  })
})

describe('Toolbar', () => {
  it('shows the current values', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      volume: 0.35,
      sustain: true,
      baseOctave: 2,
      noteNaming: 'solfege',
      labelMode: 'notes',
    }
    const { html, text } = draw(toolbar(settings))
    expect(text).toContain('35%')
    expect(text).toContain('Sustain On Space')
    expect(text).toContain('Do2 – Do5')
    expect(html).toContain('role="switch" aria-checked="true" aria-label="Sustain"')
    expect(html).toContain('<option value="notes" selected="">Notes only</option>')
  })

  it('disables Lower and Higher at the ends of the piano', () => {
    const lowest = draw(toolbar({ ...DEFAULT_SETTINGS, baseOctave: 1 })).html
    expect(lowest).toMatch(/class="button" disabled=""><span[^>]*>[^<]+<\/span> Lower/)
    expect(count(lowest, 'disabled=""')).toBe(1)

    const highest = draw(toolbar({ ...DEFAULT_SETTINGS, baseOctave: 5 })).html
    expect(highest).toMatch(/class="button" disabled="">Higher/)
    expect(count(highest, 'disabled=""')).toBe(1)

    expect(count(draw(toolbar(DEFAULT_SETTINGS)).html, 'disabled=""')).toBe(0)
  })

  it('shows when the key editor and the Advanced panel are open', () => {
    const { html } = draw(toolbar(DEFAULT_SETTINGS, true, true))
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-expanded="true" aria-controls="advanced"')
  })

  it('writes the range of the piano where a screen reader hears it change', () => {
    const { html } = draw(toolbar(DEFAULT_SETTINGS))
    expect(html).toContain('<output class="piano-range">C3 – C6</output>')
  })
})

describe('AdvancedPanel', () => {
  it('explains every option in plain words', () => {
    const { text } = draw(advancedPanel(DEFAULT_SETTINGS))
    expect(text).toContain(
      'Advanced settings Optional. The piano works well without changing any of these.',
    )
    expect(text).toContain('Touch 80% How hard each note is played.')
    expect(text).toContain('Transpose − 0 + Shifts every note up or down. 0 is normal.')
    expect(text).toContain('Note names C D E Do Ré Mi')
    expect(text).toContain('Room echo 15% Adds the echo of a room. 0 is none.')
    expect(text).toContain(
      'Note fade-out Short Normal Long How long a note rings after you let go.',
    )
    expect(text).toContain('Light trails On Glowing trails above the keys.')
    expect(text).toContain('Reset advanced settings')
  })

  it('keeps the reset button last, after the options it resets', () => {
    const { text } = draw(advancedPanel(DEFAULT_SETTINGS))
    expect(text.endsWith('Glowing trails above the keys. Reset advanced settings')).toBe(true)
  })

  it('shows the current values', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      velocity: 0.5,
      transpose: -3,
      noteNaming: 'solfege',
      reverb: 0,
      release: 'long',
      showTrails: false,
    }
    const { html, text } = draw(advancedPanel(settings))
    expect(text).toContain('Touch 50%')
    expect(text).toContain('Transpose − −3 +')
    expect(text).toContain('Room echo 0%')
    expect(text).toContain('Light trails Off')
    expect(html).toContain('aria-pressed="true">Do Ré Mi</button>')
    expect(html).toContain('aria-pressed="false">C D E</button>')
    expect(html).toContain('aria-pressed="true">Long</button>')
    expect(html).toMatch(/<input class="slider" type="range" min="10" max="100"[^>]* value="50"/)
  })

  it('stops the transpose buttons at twelve notes either way', () => {
    const highest = draw(advancedPanel({ ...DEFAULT_SETTINGS, transpose: 12 }))
    expect(highest.text).toContain('Transpose − +12 +')
    expect(highest.html).toContain('aria-label="Transpose up" disabled=""')
    expect(highest.html).not.toContain('aria-label="Transpose down" disabled=""')

    const lowest = draw(advancedPanel({ ...DEFAULT_SETTINGS, transpose: -12 }))
    expect(lowest.text).toContain('Transpose − −12 +')
    expect(lowest.html).toContain('aria-label="Transpose down" disabled=""')
    expect(lowest.html).not.toContain('aria-label="Transpose up" disabled=""')
  })
})

describe('NowPlaying', () => {
  function nowPlaying(
    notes: number[],
    noteNaming: Settings['noteNaming'],
    transpose: number,
    showHint = true,
  ) {
    const props = { notes: new Set(notes), noteNaming, transpose, showHint }
    return draw(createElement(NowPlaying, props))
  }

  it('names the held notes, lowest first', () => {
    expect(nowPlaying([67, 60, 64], 'letters', 0).text).toBe('C4 E4 G4')
  })

  it('follows the note naming', () => {
    expect(nowPlaying([67, 60, 64], 'solfege', 0).text).toBe('Do4 Mi4 Sol4')
  })

  it('says when the piano is transposed', () => {
    expect(nowPlaying([67, 60, 64], 'letters', 2).text).toBe('C4 E4 G4 Transposed +2')
    expect(nowPlaying([], 'letters', -3).text).toBe(
      'Press the keys shown on the piano, or click it Transposed −3',
    )
  })

  it('keeps the hint to itself while keys are being customized', () => {
    expect(nowPlaying([], 'letters', 0, false).text).toBe('')
    expect(nowPlaying([60], 'letters', 0, false).text).toBe('C4')
  })
})

describe('KeyEditor', () => {
  function editor(selectedNote: string | null, message: string | null) {
    return draw(
      createElement(KeyEditor, {
        selectedNote,
        message,
        onReset: noop,
        onDone: noop,
        returnFocusTo: { current: null },
      }),
    )
  }

  it('starts with the instruction', () => {
    expect(editor(null, null).text).toBe(
      'Click a piano key, then press the key you want to use for it. Reset to default keys Done',
    )
  })

  it('asks for a key once a piano key is selected', () => {
    const { text } = editor('C4', null)
    expect(text).toContain('Press a key for C4…')
    expect(text).toContain('Esc = cancel · Backspace = remove this key')
    expect(text).not.toContain('Click a piano key')
  })

  it('reports what the last action did', () => {
    const { html, text } = editor(null, '"K" now plays C4.')
    expect(text).toContain('Click a piano key, then press the key you want to use for it.')
    expect(html).toContain('role="status">&quot;K&quot; now plays C4.</span>')
  })

  it('has screen readers announce what it asks for and how to get out', () => {
    const waiting = editor('C4', null).html
    expect(waiting).toContain('class="key-editor__lead" aria-live="polite">Press a key for C4…<')
    expect(waiting).toContain(
      'class="key-editor__hint" aria-live="polite">Esc = cancel · Backspace = remove this key<',
    )
    // The line for the hint is there before its text: otherwise the text is not announced.
    expect(editor(null, null).html).toContain(
      '<span class="key-editor__hint" aria-live="polite"></span>',
    )
  })
})

// ---------------------------------------------------------------------------
// Where the keyboard focus goes, tried in a simulated browser.
// ---------------------------------------------------------------------------

afterEach(cleanup)

/** What has the keyboard focus: an element, or `document.body` when nothing has it. */
function focused(): Element | null {
  return document.activeElement
}

describe('Labels drop-down', () => {
  function drawLabels(): HTMLElement {
    render(toolbar(DEFAULT_SETTINGS))
    return screen.getByRole('combobox', { name: 'Labels' })
  }

  it.each(['Escape', 'Enter'])('lets go when its list is closed with %s, no new choice', (key) => {
    const labels = drawLabels()
    labels.focus()
    // The browser gives the key down to the open list: the page only sees the key come up.
    fireEvent.keyUp(labels, { key })
    expect(focused()).toBe(document.body)
  })

  it('keeps the keyboard while Enter is still down, so the list can take the choice first', () => {
    const labels = drawLabels()
    labels.focus()
    expect(fireEvent.keyDown(labels, { key: 'Enter', code: 'Enter' })).toBe(true)
    expect(focused()).toBe(labels)
  })

  it('lets go when the choice it already shows is picked again', () => {
    const labels = drawLabels()
    // The click that opens the list is made by a mouse button…
    labels.focus()
    fireEvent.click(labels, { detail: 1 })
    expect(focused()).toBe(labels)
    // …the one a browser sends when a choice is picked in the list is not.
    fireEvent.click(labels, { detail: 0 })
    expect(focused()).toBe(document.body)
  })

  it.each([
    ['a note key', 'KeyK', 'k'],
    ['a key that has no note yet', 'KeyN', 'n'],
    ['Space', 'Space', ' '],
  ])('opened with the mouse, lets go at %s and uses that key up', (_name, code, key) => {
    const labels = drawLabels()
    fireEvent.pointerDown(labels)
    labels.focus()

    // fireEvent returns false when the key was kept from the drop-down, which
    // would otherwise jump to the choice that starts with that letter.
    expect(fireEvent.keyDown(labels, { code, key })).toBe(false)
    expect(focused()).toBe(document.body)
  })

  it.each([
    ['the arrow keys', { code: 'ArrowDown', key: 'ArrowDown' }],
    ['Tab', { code: 'Tab', key: 'Tab' }],
    ['a browser shortcut', { code: 'KeyK', key: 'k', ctrlKey: true }],
  ])('opened with the mouse, still leaves %s to the drop-down', (_name, press) => {
    const labels = drawLabels()
    fireEvent.pointerDown(labels)
    labels.focus()
    expect(fireEvent.keyDown(labels, press)).toBe(true)
    expect(focused()).toBe(labels)
  })

  it('reached with Tab, keeps every key: it is a place where the player types', () => {
    const labels = drawLabels()
    labels.focus()
    for (const [code, key] of [
      ['KeyK', 'k'],
      ['KeyN', 'n'],
      ['Space', ' '],
    ]) {
      expect(fireEvent.keyDown(labels, { code, key }), code).toBe(true)
    }
    expect(focused()).toBe(labels)
  })

  it('forgets the mouse once it has let go of the keyboard', () => {
    const labels = drawLabels()
    fireEvent.pointerDown(labels)
    labels.focus()
    labels.blur()

    // Back on it with Tab this time.
    labels.focus()
    expect(fireEvent.keyDown(labels, { code: 'KeyK', key: 'k' })).toBe(true)
    expect(focused()).toBe(labels)
  })
})

describe('ConfirmButton', () => {
  const LABEL = 'Reset to default keys'

  function button(name: string): HTMLElement {
    return screen.getByRole('button', { name })
  }

  /** Enter on the focused button: the browser sends a click that no mouse button made. */
  function pressEnterOn(target: HTMLElement): void {
    target.focus()
    fireEvent.click(target, { detail: 0 })
  }

  /** A click with the mouse. The app then takes the focus off the button, as App.tsx does. */
  function clickWithMouse(target: HTMLElement): void {
    target.focus()
    fireEvent.click(target, { detail: 1 })
    target.blur()
  }

  it('asks before it does anything', () => {
    const onConfirm = vi.fn()
    render(createElement(ConfirmButton, { label: LABEL, onConfirm }))

    clickWithMouse(button(LABEL))
    expect(screen.getByText('Really reset?')).toBeTruthy()
    clickWithMouse(button('No'))
    expect(onConfirm).not.toHaveBeenCalled()

    clickWithMouse(button(LABEL))
    clickWithMouse(button('Yes'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Really reset?')).toBeNull()
  })

  it('used with the keyboard, moves the focus to "No", then back once answered', () => {
    const onConfirm = vi.fn()
    render(createElement(ConfirmButton, { label: LABEL, onConfirm }))

    pressEnterOn(button(LABEL))
    expect(focused()).toBe(button('No'))
    pressEnterOn(button('No'))
    expect(focused()).toBe(button(LABEL))
    expect(onConfirm).not.toHaveBeenCalled()

    pressEnterOn(button(LABEL))
    pressEnterOn(button('Yes'))
    expect(focused()).toBe(button(LABEL))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('used with the mouse, never takes the focus', () => {
    render(createElement(ConfirmButton, { label: LABEL, onConfirm: noop }))

    clickWithMouse(button(LABEL))
    expect(focused()).toBe(document.body)
    clickWithMouse(button('No'))
    expect(focused()).toBe(document.body)
  })
})

describe('KeyEditor, when it closes', () => {
  /** Draws the panel next to a button that stands for "Customize keys" in the toolbar. */
  function drawEditor(): { opener: HTMLElement; close(): void } {
    const opener = document.createElement('button')
    document.body.append(opener)
    const view = render(
      createElement(KeyEditor, {
        selectedNote: null,
        message: null,
        onReset: noop,
        onDone: noop,
        returnFocusTo: { current: opener },
      }),
    )
    return {
      opener,
      close() {
        view.unmount()
        opener.remove()
      },
    }
  }

  it.each(['Done', 'Reset to default keys'])(
    'hands the keyboard focus on when "%s" has it',
    (name) => {
      const editor = drawEditor()
      screen.getByRole('button', { name }).focus()
      const focusOpener = vi.spyOn(editor.opener, 'focus')

      editor.close()

      expect(focusOpener).toHaveBeenCalledTimes(1)
    },
  )

  it('leaves the focus alone when none of its buttons has it', () => {
    const editor = drawEditor()
    const focusOpener = vi.spyOn(editor.opener, 'focus')

    editor.close()

    expect(focusOpener).not.toHaveBeenCalled()
    expect(focused()).toBe(document.body)
  })
})
