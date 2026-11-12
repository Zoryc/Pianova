// @vitest-environment jsdom
/**
 * The Look tab of the Settings panel: the theme cards, the colour swatches
 * and the options that fine-tune the light and the screen. Every option is
 * there under its own name, with its explanation, and changes its own
 * setting and no other.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ACCENT_COLOURS, paletteFor, paletteForNote } from '../../core/colour'
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '../../state/settings'
import { LOOK_THEMES } from '../../state/themes'
import type { LookTheme } from '../../state/themes'
import { LookTab } from './LookTab'
import {
  expectSettings,
  explanationOf,
  isChosen,
  namesInOrder,
  option,
  startEachTestFromDefaults,
} from './testSupport'

/** The tab as the panel shows it: drawn again whenever a setting changes. */
function LiveTab(): JSX.Element {
  return <LookTab settings={useSettings()} />
}

function choicesOf(name: string): string[] {
  return within(option(name))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
}

function choice(optionName: string, name: string): HTMLElement {
  return within(option(optionName)).getByRole('button', { name })
}

function themeCard(name: string): HTMLElement {
  return within(option('Theme')).getByRole('button', { name })
}

function themeNamed(name: string): LookTheme {
  const theme = LOOK_THEMES.find((candidate) => candidate.name === name)
  if (!theme) throw new Error(`There is no theme called ${name}.`)
  return theme
}

/**
 * What a click on the card of a theme saves: the look of the theme. "Your
 * colour" is not part of it, and stays the colour the player had.
 */
function lookSavedBy(
  name: string,
  ownColour = DEFAULT_SETTINGS.customColour,
): LookTheme['values'] {
  return { ...themeNamed(name).values, customColour: ownColour }
}

function swatch(name: string): HTMLElement {
  return screen.getByRole('radio', { name })
}

function isChecked(radio: Element): boolean {
  return radio.getAttribute('aria-checked') === 'true'
}

/** The browser's colour picker, which the "Your colour" swatch opens. */
function colourPicker(): HTMLInputElement {
  const picker = document.querySelector<HTMLInputElement>('input[type="color"]')
  if (!picker) throw new Error('The tab has no colour picker.')
  return picker
}

/** What a custom property of an element's own style is set to. */
function styleVariable(element: Element | null, name: string): string {
  return element instanceof HTMLElement ? element.style.getPropertyValue(name) : ''
}

startEachTestFromDefaults()

describe('the Look tab', () => {
  it('starts with the themes, then lists the options that fine-tune the look', () => {
    const { container } = render(<LiveTab />)
    expect(namesInOrder(container)).toEqual([
      'Theme',
      'Fine-tune',
      'Colour',
      'Glow',
      'Background',
      'Light bars',
      'Bar style',
      'Sparks',
      'Key letters on falling notes',
      'Show the notes being played',
      'Hide the menu automatically',
    ])
  })

  it('explains each option in one line', () => {
    render(<LiveTab />)
    const explanations: Readonly<Record<string, string>> = {
      Theme: 'Pick a look. You can fine-tune it below.',
      Colour: 'Rainbow gives every note its own colour.',
      Glow: 'How strongly the light glows.',
      Background: 'What is behind the notes.',
      'Light bars': 'Bars of light for the notes you play and the falling notes of a song.',
      'Bar style': 'Solid bars are filled with light. Neon bars are glowing outlines.',
      Sparks: 'Small sparks where the light meets the keys.',
      'Key letters on falling notes': 'Shows which computer key to press on each note of a song.',
      'Show the notes being played': 'Writes the names of the notes you play above the piano.',
      'Hide the menu automatically': 'The top bar hides when the mouse is still.',
    }
    for (const [name, explanation] of Object.entries(explanations)) {
      expect(explanationOf(option(name)), name).toBe(explanation)
    }
  })
})

describe('Theme', () => {
  it('shows the six themes as cards, each with its name and what it looks like', () => {
    render(<LiveTab />)
    const cards = within(option('Theme')).getAllByRole('button')

    expect(cards.map((card) => card.textContent)).toEqual([
      'EmberRed light on black.',
      'MidnightBlue light under the stars.',
      'AuroraSoft purple haze and glass keys.',
      'GoldWarm gold and plenty of sparks.',
      'MonoWhite lines, nothing else.',
      'PrismEvery note has its own colour.',
    ])
    expect(explanationOf(themeCard('Aurora'))).toBe('Soft purple haze and glass keys.')
  })

  it('marks the theme the settings match: Ember, as the app starts', () => {
    render(<LiveTab />)
    const chosen = within(option('Theme')).getAllByRole('button').filter(isChosen)

    expect(chosen).toEqual([themeCard('Ember')])
    expect(within(option('Theme')).queryByText('Custom')).toBeNull()
  })

  it.each(LOOK_THEMES.map((theme) => theme.name))(
    'applies the look of %s with one click, and marks its card',
    async (name) => {
      const user = userEvent.setup()
      render(<LiveTab />)

      await user.click(themeCard(name))

      expectSettings(lookSavedBy(name))
      expect(within(option('Theme')).getAllByRole('button').filter(isChosen)).toEqual([
        themeCard(name),
      ])
    },
  )

  it('leaves everything that is not the look as it was', async () => {
    const user = userEvent.setup()
    const mine = { volume: 0.3, pianoSize: 61, showTrails: false, showKeyHints: false } as const
    settingsStore.set(mine)
    render(<LiveTab />)

    await user.click(themeCard('Gold'))

    expectSettings({ ...mine, ...lookSavedBy('Gold') })
  })

  it('leaves "Your colour" as the player made it, whichever theme is picked', async () => {
    const user = userEvent.setup()
    settingsStore.set({ accent: 'custom', customColour: '#00c2a8' })
    render(<LiveTab />)

    for (const theme of LOOK_THEMES) {
      await user.click(themeCard(theme.name))
      expectSettings(lookSavedBy(theme.name, '#00c2a8'))
    }

    // The colour is one click away, as it was before the themes were tried.
    await user.click(swatch('Your colour'))
    expectSettings({ ...lookSavedBy('Prism', '#00c2a8'), accent: 'custom' })
  })

  it('says "Custom" once the look matches no theme, until a theme is picked again', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)

    await user.click(choice('Sparks', 'Lots'))

    expect(within(option('Theme')).getByText('Custom')).toBeTruthy()
    expect(within(option('Theme')).getAllByRole('button').filter(isChosen)).toEqual([])

    await user.click(themeCard('Mono'))
    expect(within(option('Theme')).queryByText('Custom')).toBeNull()
  })

  it('can still be fine-tuned after a theme was picked', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)
    await user.click(themeCard('Midnight'))

    await user.click(choice('Background', 'Aurora'))

    expectSettings({ ...lookSavedBy('Midnight'), background: 'aurora' })
  })

  it.each(LOOK_THEMES)('draws the picture of $name in its own colours', (theme) => {
    render(<LiveTab />)
    const picture = themeCard(theme.name).querySelector('.theme-preview')
    const { accent, customColour, background, barStyle, keyStyle, glow } = theme.values
    const light = paletteFor(accent, customColour)

    expect(picture?.getAttribute('aria-hidden')).toBe('true')
    expect(picture?.getAttribute('data-background')).toBe(background)
    expect(picture?.getAttribute('data-bar-style')).toBe(barStyle)
    expect(styleVariable(picture ?? null, '--preview-light')).toBe(light.light)
    expect(styleVariable(picture ?? null, '--preview-bright')).toBe(light.bright)
    expect(styleVariable(picture ?? null, '--preview-deep')).toBe(light.deep)
    expect(styleVariable(picture ?? null, '--preview-glow')).toBe(String(glow))
    expect(picture?.querySelector('.mini-keys')?.getAttribute('data-key-style')).toBe(keyStyle)
  })

  it.each([
    ['Mono', 0],
    ['Ember', 3],
    ['Gold', 8],
  ])('draws the sparks of %s: %i of them', (name, sparks) => {
    render(<LiveTab />)
    expect(themeCard(name).querySelectorAll('.theme-preview__spark')).toHaveLength(sparks)
  })

  it('gives every bar of the Prism picture the colour of its own note', () => {
    render(<LiveTab />)
    const bars = themeCard('Prism').querySelectorAll('.theme-preview__bar')
    const colours = [...bars].map((bar) => styleVariable(bar, '--bar-light'))

    expect(colours).toEqual(
      [60, 64, 67, 70].map((midi) => paletteForNote(midi, 'rainbow', '').light),
    )
    expect(new Set(colours).size).toBe(4)
  })

  it('lights the keys of the notes still held, each in the colour of its note', () => {
    render(<LiveTab />)
    const lit = themeCard('Prism').querySelectorAll('.mini-keys__key[data-lit]')

    // The two bars that stand on the keys, on C and on G.
    expect([...lit].map((key) => styleVariable(key, '--key-light'))).toEqual(
      [60, 67].map((midi) => paletteForNote(midi, 'rainbow', '').light),
    )
    expect(themeCard('Gold').querySelectorAll('.mini-keys__key[data-lit]')).toHaveLength(2)
    expect(themeCard('Prism').querySelectorAll('.mini-keys__key')).toHaveLength(12)
  })

  it('gives every bar of the other pictures the one colour of the theme', () => {
    render(<LiveTab />)
    const bars = themeCard('Gold').querySelectorAll('.theme-preview__bar')

    expect(bars).toHaveLength(4)
    for (const bar of bars) {
      expect(styleVariable(bar, '--bar-light')).toBe(ACCENT_COLOURS.amber)
    }
  })
})

describe('Colour', () => {
  const NAMES = ['Red', 'Amber', 'Blue', 'Green', 'Purple', 'White', 'Rainbow', 'Your colour']

  it('is a group of round swatches of which one is chosen: red, as the app starts', () => {
    render(<LiveTab />)
    const group = screen.getByRole('radiogroup', { name: 'Colour' })
    const swatches = within(group).getAllByRole('radio')

    expect(swatches.map((radio) => radio.getAttribute('aria-label') ?? radio.textContent)).toEqual(
      NAMES,
    )
    expect(swatches.filter(isChecked)).toEqual([swatch('Red')])
  })

  it.each([
    ['Amber', 'amber'],
    ['Blue', 'blue'],
    ['Green', 'green'],
    ['Purple', 'purple'],
    ['White', 'white'],
    ['Rainbow', 'rainbow'],
  ] as const)('sets the light to %s', async (name, accent) => {
    const user = userEvent.setup()
    render(<LiveTab />)

    await user.click(swatch(name))

    expectSettings({ accent })
    expect(screen.getAllByRole('radio').filter(isChecked)).toEqual([swatch(name)])
  })

  it('goes back to red', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)
    await user.click(swatch('Blue'))

    await user.click(swatch('Red'))

    expectSettings({})
  })

  it('shows each named colour on its swatch', () => {
    render(<LiveTab />)
    for (const [accent, colour] of Object.entries(ACCENT_COLOURS)) {
      const name = `${accent.charAt(0).toUpperCase()}${accent.slice(1)}`
      expect(styleVariable(swatch(name).querySelector('.swatch__dot'), '--swatch'), name).toBe(
        colour,
      )
    }
  })

  it('shows the colours of all twelve notes on the Rainbow swatch', () => {
    render(<LiveTab />)
    const wheel = styleVariable(swatch('Rainbow').querySelector('.swatch__dot'), '--swatch')

    expect(wheel.startsWith('conic-gradient(')).toBe(true)
    for (let note = 0; note < 12; note++) {
      expect(wheel, `note ${note}`).toContain(paletteForNote(note, 'rainbow', '').light)
    }
  })

  describe('with the arrow keys', () => {
    it('is one stop for the Tab key: the chosen colour', () => {
      render(<LiveTab />)
      const stops = screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0)
      expect(stops).toEqual([swatch('Red')])
    })

    it('moves to the next or the previous colour and chooses it at once', async () => {
      const user = userEvent.setup()
      render(<LiveTab />)
      swatch('Red').focus()

      await user.keyboard('{ArrowRight}')
      expectSettings({ accent: 'amber' })
      expect(document.activeElement).toBe(swatch('Amber'))
      expect(swatch('Amber').tabIndex).toBe(0)
      expect(swatch('Red').tabIndex).toBe(-1)

      await user.keyboard('{ArrowDown}')
      expectSettings({ accent: 'blue' })
      expect(document.activeElement).toBe(swatch('Blue'))

      await user.keyboard('{ArrowLeft}{ArrowUp}')
      expectSettings({})
      expect(document.activeElement).toBe(swatch('Red'))
    })

    it('goes round at either end', async () => {
      const user = userEvent.setup()
      render(<LiveTab />)
      swatch('Red').focus()

      await user.keyboard('{ArrowLeft}')
      expectSettings({ accent: 'custom' })
      expect(document.activeElement).toBe(swatch('Your colour'))

      await user.keyboard('{ArrowRight}')
      expectSettings({})
      expect(document.activeElement).toBe(swatch('Red'))
    })

    it('reaches "Your colour" without opening the colour picker', async () => {
      const user = userEvent.setup()
      render(<LiveTab />)
      const openPicker = vi.spyOn(colourPicker(), 'click')
      swatch('Rainbow').focus()
      act(() => settingsStore.set({ accent: 'rainbow' }))

      await user.keyboard('{ArrowRight}')

      expectSettings({ accent: 'custom' })
      expect(openPicker).not.toHaveBeenCalled()
    })

    it('leaves the arrows to the browser when Alt is held (Back and Forward)', () => {
      render(<LiveTab />)
      swatch('Red').focus()

      expect(fireEvent.keyDown(swatch('Red'), { key: 'ArrowRight', altKey: true })).toBe(true)
      expectSettings({})
    })

    it('leaves every other key alone, so that the piano can use it', () => {
      render(<LiveTab />)
      swatch('Red').focus()

      for (const key of ['a', ' ', 'Enter', 'Home']) {
        expect(fireEvent.keyDown(swatch('Red'), { key }), key).toBe(true)
      }
      expectSettings({})
    })
  })

  describe('Your colour', () => {
    it('is the colour of the light once chosen, and opens the colour picker', async () => {
      const user = userEvent.setup()
      render(<LiveTab />)
      const openPicker = vi.spyOn(colourPicker(), 'click')

      await user.click(swatch('Your colour'))

      expectSettings({ accent: 'custom' })
      expect(isChecked(swatch('Your colour'))).toBe(true)
      expect(openPicker).toHaveBeenCalledTimes(1)
    })

    it('makes the colour picked there the colour of the light', () => {
      render(<LiveTab />)
      expect(colourPicker().value).toBe(DEFAULT_SETTINGS.customColour)

      fireEvent.change(colourPicker(), { target: { value: '#00c2a8' } })

      expectSettings({ accent: 'custom', customColour: '#00c2a8' })
      expect(colourPicker().value).toBe('#00c2a8')
      expect(isChecked(swatch('Your colour'))).toBe(true)
    })

    it('shows the colour on its swatch, as the light will be', () => {
      render(<LiveTab />)
      const dot = swatch('Your colour').querySelector('.swatch__dot')

      act(() => settingsStore.set({ customColour: '#00c2a8' }))
      expect(styleVariable(dot, '--swatch')).toBe('#00c2a8')

      // Too dark to show on the black stage: the light is made lighter, and so is the swatch.
      act(() => settingsStore.set({ customColour: '#000000' }))
      expect(styleVariable(dot, '--swatch')).toBe(paletteFor('custom', '#000000').light)
      expect(styleVariable(dot, '--swatch')).not.toBe('#000000')
    })

    it('keeps the colour picker out of the way: the swatch is the control', () => {
      render(<LiveTab />)
      expect(colourPicker().tabIndex).toBe(-1)
      expect(colourPicker().getAttribute('aria-hidden')).toBe('true')
    })

    it('keeps the colour when another one is chosen, and comes back to it', async () => {
      const user = userEvent.setup()
      render(<LiveTab />)
      fireEvent.change(colourPicker(), { target: { value: '#00c2a8' } })

      await user.click(swatch('Green'))
      expectSettings({ accent: 'green', customColour: '#00c2a8' })

      await user.click(swatch('Your colour'))
      expectSettings({ accent: 'custom', customColour: '#00c2a8' })
    })
  })
})

describe('the options that fine-tune the look', () => {
  function slider(name: string): HTMLInputElement {
    return screen.getByRole<HTMLInputElement>('slider', { name })
  }

  it('sets how strongly the light glows, from 0 to 100%', () => {
    render(<LiveTab />)
    expect(slider('Glow').value).toBe('60')
    expect(slider('Glow').min).toBe('0')

    fireEvent.change(slider('Glow'), { target: { value: '25' } })

    expectSettings({ glow: 0.25 })
    expect(within(option('Glow')).getByText('25%')).toBeTruthy()
  })

  it.each([
    ['Background', ['Black', 'Night', 'Stars', 'Aurora'], 'Black'],
    ['Bar style', ['Solid', 'Neon'], 'Solid'],
    ['Sparks', ['Off', 'Some', 'Lots'], 'Some'],
  ])('offers the choices of %s', (name, choices, first) => {
    render(<LiveTab />)
    expect(choicesOf(name)).toEqual(choices)
    expect(isChosen(choice(name, first))).toBe(true)
  })

  it.each([
    ['Background', 'Night', { background: 'night' }],
    ['Background', 'Stars', { background: 'stars' }],
    ['Background', 'Aurora', { background: 'aurora' }],
    ['Bar style', 'Neon', { barStyle: 'neon' }],
    ['Sparks', 'Off', { sparks: 'off' }],
    ['Sparks', 'Lots', { sparks: 'lots' }],
  ] as const)('sets %s to %s', async (name, choiceName, change) => {
    const user = userEvent.setup()
    render(<LiveTab />)

    await user.click(choice(name, choiceName))

    expectSettings(change)
    expect(within(option(name)).getAllByRole('button').filter(isChosen)).toEqual([
      choice(name, choiceName),
    ])
  })

  it.each([
    ['Light bars', 'showTrails'],
    ['Key letters on falling notes', 'showKeyHints'],
    ['Show the notes being played', 'showNoteNames'],
    ['Hide the menu automatically', 'autoHideMenu'],
  ] as const)('turns "%s" off and on again', async (name, setting) => {
    const user = userEvent.setup()
    render(<LiveTab />)
    const onOff = screen.getByRole('switch', { name })
    expect(onOff.getAttribute('aria-checked')).toBe('true')

    await user.click(onOff)
    expectSettings({ [setting]: false })
    expect(onOff.getAttribute('aria-checked')).toBe('false')

    await user.click(onOff)
    expectSettings({})
  })
})
