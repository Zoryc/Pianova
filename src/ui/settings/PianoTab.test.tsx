// @vitest-environment jsdom
/**
 * The Piano tab of the Settings panel: every option is there under its own
 * name, with its explanation, and changes its own setting and no other. The
 * drop-down for the labels also has to give the keyboard back to the piano.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'react'
import { describe, expect, it } from 'vitest'
import { useSettings } from '../../state/settings'
import { PianoTab } from './PianoTab'
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
  return <PianoTab settings={useSettings()} />
}

function choicesOf(name: string): string[] {
  return within(option(name))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
}

function choice(optionName: string, name: string): HTMLElement {
  return within(option(optionName)).getByRole('button', { name })
}

startEachTestFromDefaults()

describe('the Piano tab', () => {
  it('lists its options in order', () => {
    const { container } = render(<LiveTab />)
    expect(namesInOrder(container)).toEqual([
      'Piano size',
      'Key style',
      'Key effect',
      'Labels on the keys',
      'Note names',
    ])
  })

  it('explains each option in one line', () => {
    render(<LiveTab />)
    expect(explanationOf(option('Piano size'))).toBe(
      'How many keys the piano has. Auto picks the biggest piano that fits your window. 88 is a full piano.',
    )
    expect(explanationOf(option('Key style'))).toBe(
      'Classic is ivory and black. Midnight is dark keys that glow. Glass is see-through.',
    )
    expect(explanationOf(option('Key effect'))).toBe(
      'What a key does when you play it. Try each one on the piano below.',
    )
    expect(explanationOf(option('Labels on the keys'))).toBe('')
    expect(explanationOf(option('Note names'))).toBe('How notes are written on the piano.')
  })

  describe('Piano size', () => {
    it('offers Auto and the four sizes, in keys', () => {
      render(<LiveTab />)
      expect(choicesOf('Piano size')).toEqual(['Auto', '88', '61', '49', '37'])
      expect(isChosen(choice('Piano size', 'Auto'))).toBe(true)
      // The numbers are followed by what they count.
      expect(option('Piano size').textContent).toContain('37keys')
    })

    it.each([88, 61, 49, 37] as const)('sets a piano of %i keys', async (pianoSize) => {
      const user = userEvent.setup()
      render(<LiveTab />)

      await user.click(choice('Piano size', String(pianoSize)))

      // The number itself is saved, not the text on the button.
      expectSettings({ pianoSize })
      expect(isChosen(choice('Piano size', String(pianoSize)))).toBe(true)
      expect(isChosen(choice('Piano size', 'Auto'))).toBe(false)
    })

    it('goes back to Auto', async () => {
      const user = userEvent.setup()
      render(<LiveTab />)
      await user.click(choice('Piano size', '49'))

      await user.click(choice('Piano size', 'Auto'))

      expectSettings({})
    })
  })

  describe('Key style', () => {
    it('offers the three styles, Classic chosen at first', () => {
      render(<LiveTab />)
      expect(choicesOf('Key style')).toEqual(['Classic', 'Midnight', 'Glass'])
      expect(isChosen(choice('Key style', 'Classic'))).toBe(true)
    })

    it.each([
      ['Midnight', 'midnight'],
      ['Glass', 'glass'],
    ] as const)('sets the %s keys', async (name, keyStyle) => {
      const user = userEvent.setup()
      render(<LiveTab />)

      await user.click(choice('Key style', name))

      expectSettings({ keyStyle })
      expect(isChosen(choice('Key style', name))).toBe(true)
      expect(isChosen(choice('Key style', 'Classic'))).toBe(false)
    })

    it.each([
      ['Classic', 'classic'],
      ['Midnight', 'midnight'],
      ['Glass', 'glass'],
    ])('draws three keys in the %s style next to its name', (name, keyStyle) => {
      render(<LiveTab />)
      const picture = choice('Key style', name).querySelector('.mini-keys')

      expect(picture?.getAttribute('data-key-style')).toBe(keyStyle)
      expect(picture?.querySelectorAll('.mini-keys__key--white')).toHaveLength(3)
      expect(picture?.querySelectorAll('.mini-keys__key--black')).toHaveLength(2)
      // A picture only: the name says it all to a screen reader.
      expect(picture?.getAttribute('aria-hidden')).toBe('true')
      expect(choice('Key style', name).textContent).toBe(name)
    })
  })

  describe('Key effect', () => {
    it('offers the effect the piano has always had first, then the five others', () => {
      render(<LiveTab />)
      expect(choicesOf('Key effect')).toEqual(['Glow', 'Press', 'Fill', 'Ripple', 'Edge', 'Pop'])
      expect(isChosen(choice('Key effect', 'Glow'))).toBe(true)
    })

    it.each([
      ['Press', 'press'],
      ['Fill', 'fill'],
      ['Ripple', 'ripple'],
      ['Edge', 'edge'],
      ['Pop', 'pop'],
    ] as const)('sets the %s effect', async (name, keyEffect) => {
      const user = userEvent.setup()
      render(<LiveTab />)

      await user.click(choice('Key effect', name))

      expectSettings({ keyEffect })
      expect(isChosen(choice('Key effect', name))).toBe(true)
      expect(isChosen(choice('Key effect', 'Glow'))).toBe(false)
    })

    it('goes back to Glow', async () => {
      const user = userEvent.setup()
      render(<LiveTab />)
      await user.click(choice('Key effect', 'Pop'))

      await user.click(choice('Key effect', 'Glow'))

      expectSettings({})
    })
  })

  describe('Note names', () => {
    it('writes notes as C D E or as Do Ré Mi', async () => {
      const user = userEvent.setup()
      render(<LiveTab />)
      expect(choicesOf('Note names')).toEqual(['C D E', 'Do Ré Mi'])
      expect(isChosen(choice('Note names', 'C D E'))).toBe(true)

      await user.click(choice('Note names', 'Do Ré Mi'))
      expectSettings({ noteNaming: 'solfege' })
      expect(isChosen(choice('Note names', 'Do Ré Mi'))).toBe(true)

      await user.click(choice('Note names', 'C D E'))
      expectSettings({})
    })
  })
})

describe('Labels on the keys', () => {
  function drawLabels(): HTMLSelectElement {
    render(<LiveTab />)
    return screen.getByRole<HTMLSelectElement>('combobox', { name: 'Labels on the keys' })
  }

  /** What has the keyboard focus: an element, or `document.body` when nothing has it. */
  function focused(): Element | null {
    return document.activeElement
  }

  it('offers the four choices, "Keys and notes" at first', () => {
    const labels = drawLabels()
    expect([...labels.options].map((choice) => choice.textContent)).toEqual([
      'Keys and notes',
      'Keys only',
      'Notes only',
      'No labels',
    ])
    expect(labels.selectedOptions[0]?.textContent).toBe('Keys and notes')
  })

  it.each([
    ['Keys only', 'keys'],
    ['Notes only', 'notes'],
    ['No labels', 'none'],
  ] as const)('sets "%s"', async (name, labelMode) => {
    const user = userEvent.setup()
    const labels = drawLabels()

    await user.selectOptions(labels, name)

    expectSettings({ labelMode })
    expect(labels.selectedOptions[0]?.textContent).toBe(name)
  })

  it('lets go of the keyboard as soon as a choice is made', () => {
    const labels = drawLabels()
    labels.focus()

    // A choice made with the arrow keys while the list is closed: there is no click.
    fireEvent.change(labels, { target: { value: 'notes' } })

    expectSettings({ labelMode: 'notes' })
    expect(focused()).toBe(document.body)
  })

  it.each(['Escape', 'Enter'])('lets go when its list is closed with %s, no new choice', (key) => {
    const labels = drawLabels()
    labels.focus()
    // The browser gives the key down to the open list: the page only sees the key come up.
    fireEvent.keyUp(labels, { key })
    expect(focused()).toBe(document.body)
    expectSettings({})
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
    expectSettings({})
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
