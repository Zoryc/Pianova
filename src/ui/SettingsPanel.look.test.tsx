// @vitest-environment jsdom
/**
 * The Settings panel read as a player reads it and as docs/INTERFACE.md 5.4
 * writes it: every name, every choice and every explanation of the Sound,
 * Look and About tabs, word for word, typed here from the spec and not from
 * the code. Then the same panel for someone who cannot use a mouse: every
 * control has a name and is reached with the keyboard.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { APP_NAME } from '../app/appInfo'
import { settingsStore, useSettings } from '../state/settings'
import { SettingsPanel } from './SettingsPanel'
import { startEachTestFromDefaults } from './settings/testSupport'
import type { KeyEditor } from './useKeyEditor'

type TabName = 'Sound' | 'Keys' | 'Piano' | 'Look' | 'About'

/** A key editor that does nothing: these tests are not about the keys. */
function idleEditor(): KeyEditor {
  return {
    editing: false,
    selectedSlot: null,
    message: null,
    open: vi.fn(),
    close: vi.fn(),
    select: vi.fn(),
    applyPreset: vi.fn(),
    resetKeys: vi.fn(),
    handleKey: vi.fn(() => false),
  }
}

/** The panel as the app shows it: drawn again whenever a setting changes. */
function LivePanel(): JSX.Element {
  return (
    <SettingsPanel
      id="settings"
      settings={useSettings()}
      keyEditor={idleEditor()}
      layoutMap={null}
      onClose={() => undefined}
    />
  )
}

function showTab(name: TabName): HTMLElement {
  if (!screen.queryByRole('dialog')) render(<LivePanel />)
  fireEvent.click(screen.getByRole('tab', { name }))
  return screen.getByRole('tabpanel')
}

/** One option as the player reads it: its name, its choices in order, its explanation. */
interface Row {
  name: string
  choices: string[]
  hint: string
}

/** The rows of the page that is showing, top to bottom. Titles are rows with a name only. */
function rows(page: HTMLElement): Row[] {
  const found: Row[] = []
  for (const element of page.querySelectorAll('.field, .choice-group, h3')) {
    if (element.tagName === 'H3') {
      found.push({ name: element.textContent ?? '', choices: [], hint: '' })
      continue
    }
    const group = element as HTMLElement
    const name = group.querySelector('.field__label, .settings-label')?.textContent ?? ''
    const hint = group.querySelector('.field__hint, .settings-hint')?.textContent ?? ''
    found.push({ name, choices: choicesOf(group), hint })
  }
  return found
}

/** The choices of one option, as written on them (or as a screen reader names them). */
function choicesOf(group: HTMLElement): string[] {
  const named = (control: Element): string =>
    control.getAttribute('aria-label') ??
    control.querySelector('.choice-card__name')?.textContent ??
    control.textContent ??
    ''
  return [...group.querySelectorAll('button, input[type="range"]')].map((control) =>
    control instanceof HTMLInputElement
      ? `slider ${control.min}–${control.max}%`
      : control.getAttribute('role') === 'switch'
        ? 'on/off'
        : named(control),
  )
}

startEachTestFromDefaults()

describe('the Sound tab, word for word', () => {
  it('has the options of the spec, in its order, with its explanations', () => {
    expect(rows(showTab('Sound'))).toEqual([
      { name: 'Volume', choices: ['slider 0–100%'], hint: '' },
      {
        name: 'Sustain',
        choices: ['on/off'],
        hint: 'Notes keep ringing after you let go. Space also turns it on and off.',
      },
      { name: 'Advanced', choices: [], hint: '' },
      { name: 'Touch', choices: ['slider 10–100%'], hint: 'How hard each note is played.' },
      {
        name: 'Room echo',
        choices: ['slider 0–100%'],
        hint: 'Adds the echo of a room. 0 is none.',
      },
      {
        name: 'Note fade-out',
        choices: ['Short', 'Normal', 'Long'],
        hint: 'How long a note rings after you let go.',
      },
      {
        name: 'Transpose',
        choices: ['Transpose down', 'Transpose up'],
        hint: 'Shifts every note up or down. 0 is normal.',
      },
    ])
  })

  it('writes the − and the + of Transpose on its two buttons, and 0 between them', () => {
    const transpose = within(showTab('Sound')).getByRole('group', { name: 'Transpose' })
    expect(within(transpose).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '−',
      '+',
    ])
    expect(within(transpose).getByRole('status').textContent).toBe('0')
  })
})

describe('the Look tab, word for word', () => {
  it('has the options of the spec, in its order, with its explanations', () => {
    expect(rows(showTab('Look'))).toEqual([
      {
        name: 'Theme',
        choices: ['Ember', 'Midnight', 'Aurora', 'Gold', 'Mono', 'Prism'],
        hint: 'Pick a look. You can fine-tune it below.',
      },
      { name: 'Fine-tune', choices: [], hint: '' },
      {
        name: 'Colour',
        choices: ['Red', 'Amber', 'Blue', 'Green', 'Purple', 'White', 'Rainbow', 'Your colour'],
        hint: 'Rainbow gives every note its own colour.',
      },
      { name: 'Glow', choices: ['slider 0–100%'], hint: 'How strongly the light glows.' },
      {
        name: 'Background',
        choices: ['Black', 'Night', 'Stars', 'Aurora'],
        hint: 'What is behind the notes.',
      },
      {
        name: 'Light bars',
        choices: ['on/off'],
        hint: 'Bars of light for the notes you play and the falling notes of a song.',
      },
      {
        name: 'Bar style',
        choices: ['Solid', 'Neon'],
        hint: 'Solid bars are filled with light. Neon bars are glowing outlines.',
      },
      {
        name: 'Sparks',
        choices: ['Off', 'Some', 'Lots'],
        hint: 'Small sparks where the light meets the keys.',
      },
      {
        name: 'Key effect',
        choices: ['Glow', 'Press', 'Edge', 'Pop'],
        hint: 'What a key does when you play it. Try each one on the piano below.',
      },
      {
        name: 'Key letters on falling notes',
        choices: ['on/off'],
        hint: 'Shows which computer key to press on each note of a song.',
      },
      {
        name: 'Show the notes being played',
        choices: ['on/off'],
        hint: 'Writes the names of the notes you play above the piano.',
      },
      {
        name: 'Hide the menu automatically',
        choices: ['on/off'],
        hint: 'The top bar hides when the mouse is still.',
      },
    ])
  })

  it('describes each theme as the spec does', () => {
    const theme = within(showTab('Look')).getByRole('group', { name: 'Theme' })
    const described = within(theme)
      .getAllByRole('button')
      .map((card) => [
        card.querySelector('.choice-card__name')?.textContent,
        card.querySelector('.choice-card__description')?.textContent,
      ])

    expect(described).toEqual([
      ['Ember', 'Red light on black.'],
      ['Midnight', 'Blue light under the stars.'],
      ['Aurora', 'Soft purple haze and glass keys.'],
      ['Gold', 'Warm gold and plenty of sparks.'],
      ['Mono', 'White lines, nothing else.'],
      ['Prism', 'Every note has its own colour.'],
    ])
  })

  it('says "Custom", and nothing longer, when the look matches no theme', () => {
    const page = showTab('Look')
    act(() => settingsStore.set({ glow: 0.33 }))

    expect(page.querySelector('.choice-group__custom')?.textContent).toBe('Custom')
  })
})

describe('the About tab, word for word', () => {
  it('says what the spec says, in its order', () => {
    const page = showTab('About')
    const lines = [...page.querySelectorAll('h3, p')].map((line) =>
      (line.textContent ?? '').replace(/\s+/g, ' ').trim(),
    )

    expect(lines).toEqual([
      APP_NAME,
      'A piano you play with your computer keyboard.',
      'Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)',
      'Everything stays in your browser. Nothing is uploaded.',
      "Clearing the browser's data for this page removes your settings and songs.",
      'Puts every setting and every key back to how it was at the start.',
    ])
    expect(within(page).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Reset all settings',
    ])
    // Nothing has been reset yet, so nothing says that it was.
    expect(within(page).getByRole('status').textContent).toBe('')
  })

  it('answers "Yes" on "Reset all settings" with one line, said to screen readers too', () => {
    const page = showTab('About')
    const report = within(page).getByRole('status')

    fireEvent.click(within(page).getByRole('button', { name: 'Reset all settings' }), { detail: 1 })
    expect(page.textContent).toContain('Really reset?')
    expect(report.textContent).toBe('')

    fireEvent.click(within(page).getByRole('button', { name: 'Yes' }), { detail: 1 })

    // The line was on the page before its words were: that is what makes a screen reader say them.
    expect(within(page).getByRole('status')).toBe(report)
    expect(report.textContent).toBe('Everything is back to how it was at the start.')
    expect(page.textContent).not.toContain('Really reset?')
  })

  it('links only the name of the licence, to its page, in a new tab that is told nothing', () => {
    const links = within(showTab('About')).getAllByRole('link')

    expect(links).toHaveLength(1)
    expect(links[0]?.textContent).toBe('CC BY 3.0')
    expect(links[0]?.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/3.0/')
    expect(links[0]?.getAttribute('target')).toBe('_blank')
    expect(links[0]?.getAttribute('rel')).toBe('noreferrer')
  })
})

describe('the words a casual player should never meet', () => {
  /** Everything read on the page or said by a screen reader. */
  function everyWord(page: HTMLElement): string {
    const said = ['aria-label', 'aria-valuetext', 'title'].flatMap((attribute) =>
      [...page.querySelectorAll(`[${attribute}]`)].map((element) => element.getAttribute(attribute)),
    )
    return [page.textContent, ...said].join(' \n ')
  }

  const EVERYWHERE = [
    /midi/i,
    /\bbind/i,
    /\bbound\b/i,
    /\bslots?\b/i,
    /semitone/i,
    /velocity/i,
    /reverb/i,
    /\baccent\b/i,
    /\bpresets?\b/i,
    /\bhex\b/i,
    /\brgb\b/i,
    /local ?storage/i,
    /\bundefined\b|\bnull\b|NaN|\[object/,
  ]

  it.each(['Sound', 'Keys', 'Piano', 'Look', 'About'] as const)('are not in the %s tab', (name) => {
    const words = everyWord(showTab(name))
    for (const word of EVERYWHERE) expect(words).not.toMatch(word)
  })

  it('are not in the values either, at the ends of every slider and stepper', () => {
    act(() => settingsStore.set({ volume: 0, velocity: 0.1, reverb: 0, transpose: -12, glow: 0 }))
    expect(everyWord(showTab('Sound'))).not.toMatch(/NaN|undefined|-0|−0/)
    expect(within(showTab('Sound')).getByRole('status').textContent).toBe('−12')

    act(() => settingsStore.set({ volume: 1, velocity: 1, reverb: 1, transpose: 12, glow: 1 }))
    expect(everyWord(showTab('Sound'))).not.toMatch(/NaN|undefined/)
    expect(within(showTab('Sound')).getByRole('status').textContent).toBe('+12')
    expect(within(showTab('Look')).getByRole('slider', { name: 'Glow' })).toHaveProperty(
      'value',
      '100',
    )
  })
})

describe('without a mouse', () => {
  /** What a screen reader calls a control. */
  function nameOf(control: Element): string {
    const labelledBy = control.getAttribute('aria-labelledby')
    if (labelledBy !== null) {
      return labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim()
    }
    return (control.getAttribute('aria-label') ?? control.textContent ?? '').trim()
  }

  it.each(['Sound', 'Look', 'About'] as const)(
    'every control of the %s tab has a name and can take the keyboard focus',
    (name) => {
      const page = showTab(name)
      const controls = [...page.querySelectorAll<HTMLElement>('button, input, select, a')].filter(
        (control) => control.getAttribute('aria-hidden') !== 'true',
      )

      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        expect(nameOf(control), control.outerHTML.slice(0, 80)).not.toBe('')
        // Never a made-up order: the Tab key follows the page.
        expect(control.tabIndex).toBeLessThanOrEqual(0)
        control.focus()
        expect(document.activeElement, nameOf(control)).toBe(control)
      }
    },
  )

  it('reaches every option of the Look tab with Tab alone, one stop for the colours', () => {
    const page = showTab('Look')
    /** The controls of one option at which the Tab key stops. */
    const stopsOf = (option: string): HTMLElement[] =>
      [
        ...within(page)
          .getByRole('group', { name: option })
          .querySelectorAll<HTMLElement>('button, input'),
      ].filter((control) => control.tabIndex === 0)

    for (const option of [
      'Theme',
      'Colour',
      'Glow',
      'Background',
      'Light bars',
      'Bar style',
      'Sparks',
      'Key effect',
      'Key letters on falling notes',
      'Show the notes being played',
      'Hide the menu automatically',
    ]) {
      expect(stopsOf(option).length, option).toBeGreaterThan(0)
    }

    // The colours are one group of radio buttons: Tab stops once, on the chosen
    // colour, and the arrow keys go from there.
    const colourStops = stopsOf('Colour')
    expect(colourStops).toHaveLength(1)
    expect(colourStops[0]?.getAttribute('aria-label')).toBe('Red')
    expect(colourStops[0]?.getAttribute('aria-checked')).toBe('true')
  })

  it('keeps the colour picker of the browser away from the keyboard and from screen readers', () => {
    const picker = showTab('Look').querySelector('input[type="color"]') as HTMLInputElement

    expect(picker.tabIndex).toBe(-1)
    expect(picker.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('radio', { name: 'Your colour' })).not.toBeNull()
  })

  it('says of every on/off option whether it is on, in words and for screen readers', () => {
    const page = showTab('Look')
    act(() => settingsStore.set({ showTrails: false, showKeyHints: true }))

    const bars = within(page).getByRole('switch', { name: 'Light bars' })
    const letters = within(page).getByRole('switch', { name: 'Key letters on falling notes' })
    expect([bars.getAttribute('aria-checked'), bars.textContent]).toEqual(['false', 'Off'])
    expect([letters.getAttribute('aria-checked'), letters.textContent]).toEqual(['true', 'On'])
  })

  it('says of every slider what it sets and where it stands', () => {
    act(() => settingsStore.set({ volume: 0.07, velocity: 0.1, reverb: 1 }))
    const sliders = within(showTab('Sound'))
      .getAllByRole('slider')
      .map((slider) => [
        slider.getAttribute('aria-label'),
        slider.getAttribute('aria-valuetext'),
        (slider as HTMLInputElement).value,
      ])

    expect(sliders).toEqual([
      ['Volume', '7%', '7'],
      ['Touch', '10%', '10'],
      ['Room echo', '100%', '100'],
    ])
  })
})
