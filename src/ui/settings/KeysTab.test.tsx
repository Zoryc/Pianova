// @vitest-environment jsdom
/**
 * The Keys tab of the Settings panel, with the app's real key editor: the
 * ready-made layouts, changing one key at a time, where the keys sit, the
 * keyboard type and the way back to the default keys.
 *
 * The piano is not drawn here. A button stands for the one thing it does for
 * this tab: selecting the piano key that waits for a computer key. The rules
 * of the key presses themselves are tested in src/ui/keyEditorModel.test.ts.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { describe, expect, it } from 'vitest'
import { MAX_BASE_OCTAVE, MIN_BASE_OCTAVE } from '../../core/layout'
import { DEFAULT_BINDINGS, KEY_PRESETS, assignBinding } from '../../input/keymap'
import type { Bindings, KeyPreset } from '../../input/keymap'
import { settingsStore, useSettings } from '../../state/settings'
import { useKeyEditor } from '../useKeyEditor'
import { KeysTab } from './KeysTab'
import {
  expectSettings,
  explanationOf,
  isChosen,
  namesInOrder,
  option,
  startEachTestFromDefaults,
} from './testSupport'

/** Slots of the default piano position: middle C and the C above it. */
const C4 = 12
const C5 = 24

/** The default keys with one more key, for the lowest note: keys of the player's own. */
const OWN_KEYS: Bindings = assignBinding(DEFAULT_BINDINGS, 'KeyZ', 0).bindings

/**
 * The tab as the app runs it: the key editor is open while the tab shows, it
 * sees every key press first, and a piano key can be selected.
 */
function LiveTab(): JSX.Element {
  const settings = useSettings()
  const keyEditor = useKeyEditor(null)
  const latestEditor = useRef(keyEditor)

  useEffect(() => {
    latestEditor.current = keyEditor
  })

  useEffect(() => {
    latestEditor.current.open()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (latestEditor.current.handleKey(event)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <KeysTab settings={settings} keyEditor={keyEditor} />
      <button type="button" onClick={() => keyEditor.select(C4)}>
        the piano key C4
      </button>
    </>
  )
}

function preset(name: string): KeyPreset {
  const found = KEY_PRESETS.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`There is no key layout called ${name}.`)
  return found
}

function layoutCards(): HTMLElement[] {
  return within(option('Key layout')).getAllByRole('button')
}

function layoutCard(name: string): HTMLElement {
  return within(option('Key layout')).getByRole('button', { name })
}

function chosenLayouts(): HTMLElement[] {
  return KEY_PRESETS.map((candidate) => layoutCard(candidate.name)).filter(isChosen)
}

function customLabel(): HTMLElement | null {
  return within(option('Key layout')).queryByText('Custom')
}

function question(): HTMLElement | null {
  return screen.queryByText('Replace your own keys with this layout?')
}

function answer(name: 'Yes' | 'No'): HTMLElement {
  return within(option('Key layout')).getByRole('button', { name })
}

/** Enter on the focused button: the browser sends a click that no mouse button made. */
function pressEnterOn(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 0 })
}

/** A click with the mouse. The app then takes the focus off the button. */
function clickWithMouse(target: HTMLElement): void {
  target.focus()
  fireEvent.click(target, { detail: 1 })
  target.blur()
}

function selectPianoKey(): void {
  clickWithMouse(screen.getByRole('button', { name: 'the piano key C4' }))
}

/** A key of the computer keyboard goes down, wherever the focus is. */
function pressKey(code: string, key: string): boolean {
  return fireEvent.keyDown(document.body, { code, key })
}

function changeOneKey(): HTMLElement {
  return screen.getByRole('region', { name: 'Change one key' })
}

function resultMessage(): string {
  return within(changeOneKey()).getByRole('status').textContent ?? ''
}

startEachTestFromDefaults()

describe('the Keys tab', () => {
  it('has everything about the computer keys, top to bottom', () => {
    const { container } = render(<LiveTab />)
    expect(namesInOrder(container)).toEqual([
      'Key layout',
      'Change one key',
      'Where your keys sit',
      'Keyboard type',
    ])
    // The way back to the default keys comes last.
    const reset = screen.getByRole('button', { name: 'Reset to default keys' })
    const afterKeyboardType =
      option('Keyboard type').compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(afterKeyboardType).toBeTruthy()
  })
})

describe('Key layout', () => {
  it('shows the three layouts as cards, each with its name and what it does', () => {
    render(<LiveTab />)

    expect(layoutCards().map((card) => card.textContent)).toEqual(
      KEY_PRESETS.map((candidate) => `${candidate.name}${candidate.description}`),
    )
    expect(layoutCards().map((card) => card.textContent)).toEqual([
      'Home rowThe middle row plays the white keys, the row above plays the black keys.',
      'Two octavesTwo rows for a low octave, two rows for a high octave.',
      'White keys onlyThree rows, three octaves, no black keys. Good for simple tunes.',
    ])
    expect(explanationOf(layoutCard('Two octaves'))).toBe(
      'Two rows for a low octave, two rows for a high octave.',
    )
  })

  it('marks the layout the keys match: Home row, as the app starts', () => {
    render(<LiveTab />)
    expect(chosenLayouts()).toEqual([layoutCard('Home row')])
    expect(customLabel()).toBeNull()
  })

  it.each(['Two octaves', 'White keys only'])('applies %s at once', async (name) => {
    const user = userEvent.setup()
    render(<LiveTab />)

    await user.click(layoutCard(name))

    expectSettings({ bindings: preset(name).bindings })
    expect(chosenLayouts()).toEqual([layoutCard(name)])
    expect(question()).toBeNull()
  })

  it('goes from one layout to another and back without asking', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)

    await user.click(layoutCard('White keys only'))
    await user.click(layoutCard('Two octaves'))
    await user.click(layoutCard('Home row'))

    expectSettings({})
    expect(question()).toBeNull()
  })

  it('does nothing when the layout already in use is clicked', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)
    selectPianoKey()

    await user.click(layoutCard('Home row'))

    expectSettings({})
    // The piano key is still waiting: nothing was applied.
    expect(within(changeOneKey()).getByText('Press a key for C4…')).toBeTruthy()
  })

  it('draws, on each card, which keys of the keyboard the layout uses', () => {
    render(<LiveTab />)
    for (const candidate of KEY_PRESETS) {
      const picture = layoutCard(candidate.name).querySelector('.keyboard-picture')
      const slots = Object.values(candidate.bindings)
      const blackKeys = slots.filter((slot) => [1, 3, 6, 8, 10].includes(slot % 12)).length

      expect(picture?.getAttribute('aria-hidden'), candidate.name).toBe('true')
      expect(picture?.querySelectorAll('.keyboard-picture__row')).toHaveLength(4)
      expect(picture?.querySelectorAll('[data-plays="black"]'), candidate.name).toHaveLength(
        blackKeys,
      )
      expect(picture?.querySelectorAll('[data-plays="white"]'), candidate.name).toHaveLength(
        slots.length - blackKeys,
      )
    }
  })

  it('keeps the labels captured from the player keyboard when a layout is applied', async () => {
    const user = userEvent.setup()
    settingsStore.set({ customLabels: { KeyQ: 'A' } })
    render(<LiveTab />)

    await user.click(layoutCard('Two octaves'))

    expectSettings({ bindings: preset('Two octaves').bindings, customLabels: { KeyQ: 'A' } })
  })

  it('lets go of a piano key that was waiting, and forgets the last message', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)
    selectPianoKey()
    pressKey('Enter', 'Enter')
    expect(resultMessage()).toMatch(/^That key can't be used/)

    await user.click(layoutCard('Two octaves'))

    expect(resultMessage()).toBe('')
    expect(
      within(changeOneKey()).getByText(
        'Click a piano key below, then press the key you want to use for it.',
      ),
    ).toBeTruthy()
    // The next key press plays: it is not taken for the piano key that was waiting.
    expect(pressKey('KeyQ', 'q')).toBe(true)
    expectSettings({ bindings: preset('Two octaves').bindings })
  })

  describe("when the keys are the player's own", () => {
    function drawWithOwnKeys(): void {
      settingsStore.set({ bindings: OWN_KEYS })
      render(<LiveTab />)
    }

    it('says "Custom" and marks no card', () => {
      drawWithOwnKeys()
      expect(customLabel()).not.toBeNull()
      expect(chosenLayouts()).toEqual([])
    })

    it('says "Custom" as soon as one key is changed', () => {
      render(<LiveTab />)
      expect(customLabel()).toBeNull()

      selectPianoKey()
      pressKey('KeyZ', 'z')

      expect(customLabel()).not.toBeNull()
      expect(chosenLayouts()).toEqual([])
    })

    it('asks before a layout replaces them, and changes nothing until answered', async () => {
      const user = userEvent.setup()
      drawWithOwnKeys()

      await user.click(layoutCard('Two octaves'))

      expect(question()).not.toBeNull()
      expect(answer('Yes')).toBeTruthy()
      expect(answer('No')).toBeTruthy()
      // The question takes the place of "Custom".
      expect(customLabel()).toBeNull()
      expectSettings({ bindings: OWN_KEYS })
    })

    it('names the question after the layout it is about', async () => {
      const user = userEvent.setup()
      drawWithOwnKeys()

      await user.click(layoutCard('White keys only'))

      const asked = screen.getByRole('group', { name: 'White keys only' })
      expect(explanationOf(asked)).toBe('Replace your own keys with this layout?')
      expect(asked.textContent).toBe('Replace your own keys with this layout?YesNo')
      expect(layoutCard('White keys only').hasAttribute('data-asking')).toBe(true)
      expect(layoutCard('Two octaves').hasAttribute('data-asking')).toBe(false)
    })

    it('applies the layout on Yes', async () => {
      const user = userEvent.setup()
      drawWithOwnKeys()
      await user.click(layoutCard('Two octaves'))

      await user.click(answer('Yes'))

      expectSettings({ bindings: preset('Two octaves').bindings })
      expect(chosenLayouts()).toEqual([layoutCard('Two octaves')])
      expect(question()).toBeNull()
      expect(customLabel()).toBeNull()
    })

    it('keeps the keys on No', async () => {
      const user = userEvent.setup()
      drawWithOwnKeys()
      await user.click(layoutCard('Two octaves'))

      await user.click(answer('No'))

      expectSettings({ bindings: OWN_KEYS })
      expect(question()).toBeNull()
      expect(customLabel()).not.toBeNull()
      expect(layoutCard('Two octaves').hasAttribute('data-asking')).toBe(false)
    })

    it('asks about the card clicked last', async () => {
      const user = userEvent.setup()
      drawWithOwnKeys()
      await user.click(layoutCard('Two octaves'))

      await user.click(layoutCard('Home row'))
      expect(screen.getByRole('group', { name: 'Home row' })).toBeTruthy()
      expect(screen.queryByRole('group', { name: 'Two octaves' })).toBeNull()

      await user.click(answer('Yes'))
      expectSettings({})
    })

    it('drops the question when the keys change before it is answered', async () => {
      const user = userEvent.setup()
      drawWithOwnKeys()
      await user.click(layoutCard('Two octaves'))

      // The player changes one more key instead of answering.
      selectPianoKey()
      pressKey('KeyX', 'x')

      expect(question()).toBeNull()
      expect(customLabel()).not.toBeNull()
      expect(settingsStore.get().bindings).toEqual(
        assignBinding(OWN_KEYS, 'KeyX', C4).bindings,
      )
    })

    it('used with the keyboard, moves the focus to "No", then back to the card', () => {
      drawWithOwnKeys()

      pressEnterOn(layoutCard('Two octaves'))
      expect(document.activeElement).toBe(answer('No'))

      pressEnterOn(answer('No'))
      expect(document.activeElement).toBe(layoutCard('Two octaves'))

      pressEnterOn(layoutCard('Two octaves'))
      pressEnterOn(answer('Yes'))
      expect(document.activeElement).toBe(layoutCard('Two octaves'))
      expectSettings({ bindings: preset('Two octaves').bindings })
    })

    it('used with the mouse, never takes the focus', () => {
      drawWithOwnKeys()

      clickWithMouse(layoutCard('Two octaves'))
      expect(document.activeElement).toBe(document.body)

      clickWithMouse(answer('No'))
      expect(document.activeElement).toBe(document.body)
    })
  })
})

describe('Change one key', () => {
  it('starts with the instruction', () => {
    render(<LiveTab />)
    expect(changeOneKey().textContent).toBe(
      'Change one keyClick a piano key below, then press the key you want to use for it.',
    )
  })

  it('asks for a key once a piano key is selected, and says how to get out', () => {
    render(<LiveTab />)

    selectPianoKey()

    expect(changeOneKey().textContent).toBe(
      'Change one keyPress a key for C4…Esc = cancel · Backspace = remove this key',
    )
  })

  it('gives the key pressed next to the piano key, and says what that did', () => {
    render(<LiveTab />)
    selectPianoKey()

    // The press is used up: it must not play a note as well.
    expect(pressKey('KeyK', 'k')).toBe(false)

    expectSettings({
      bindings: assignBinding(DEFAULT_BINDINGS, 'KeyK', C4).bindings,
      customLabels: { KeyK: 'K' },
    })
    expect(resultMessage()).toBe('"K" now plays C4. "A" no longer plays a note. C5 has no key now.')
    expect(settingsStore.get().bindings).not.toHaveProperty('KeyA')
    expect(Object.values(settingsStore.get().bindings)).not.toContain(C5)
    // Nothing is waiting any more: the instruction is back.
    expect(changeOneKey().textContent).toContain('Click a piano key below')
  })

  it('removes the key of the piano key on Backspace', () => {
    render(<LiveTab />)
    selectPianoKey()

    pressKey('Backspace', 'Backspace')

    expect(resultMessage()).toBe('C4 has no key now.')
    expect(settingsStore.get().bindings).not.toHaveProperty('KeyA')
  })

  it('cancels on Escape and changes nothing', () => {
    render(<LiveTab />)
    selectPianoKey()

    expect(pressKey('Escape', 'Escape')).toBe(false)

    expectSettings({})
    expect(resultMessage()).toBe('')
    expect(changeOneKey().textContent).toContain('Click a piano key below')
  })

  it('refuses a key that cannot play a note and keeps waiting', () => {
    render(<LiveTab />)
    selectPianoKey()

    pressKey('Enter', 'Enter')

    expect(resultMessage()).toBe("That key can't be used. Try a letter, number or symbol key.")
    expect(within(changeOneKey()).getByText('Press a key for C4…')).toBeTruthy()
    expectSettings({})
  })

  it('lets the keyboard play as usual while no piano key is selected', () => {
    render(<LiveTab />)
    expect(pressKey('KeyK', 'k')).toBe(true)
    expectSettings({})
  })

  it('writes the note as the player chose to read notes', () => {
    settingsStore.set({ noteNaming: 'solfege' })
    render(<LiveTab />)

    selectPianoKey()

    expect(within(changeOneKey()).getByText('Press a key for Do4…')).toBeTruthy()
  })

  it('names the key as the chosen keyboard type prints it', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)
    await user.click(within(option('Keyboard type')).getByRole('button', { name: 'AZERTY' }))
    selectPianoKey()

    pressKey('KeyQ', 'q')

    expect(resultMessage()).toBe('"A" now plays C4. "Q" no longer plays a note.')
  })

  // A screen reader speaks text that changes inside a live region it already
  // knows. So the prompt, the hint and the result are three regions that are
  // on the page before a piano key is selected, and stay the same elements.
  it('announces the prompt, the hint and the result to screen readers', () => {
    render(<LiveTab />)
    const liveRegions = [...changeOneKey().querySelectorAll('[aria-live="polite"]')]
    const result = within(changeOneKey()).getByRole('status')
    expect(liveRegions).toHaveLength(2)
    expect(liveRegions[1]?.textContent).toBe('')
    expect(result.textContent).toBe('')

    selectPianoKey()

    const prompt = within(changeOneKey()).getByText('Press a key for C4…')
    const wayOut = within(changeOneKey()).getByText('Esc = cancel · Backspace = remove this key')
    expect(prompt).toBe(liveRegions[0])
    expect(wayOut).toBe(liveRegions[1])

    pressKey('Enter', 'Enter')
    // The same element gets the text: that is what makes a screen reader speak it.
    expect(within(changeOneKey()).getByRole('status')).toBe(result)
    expect(result.textContent).toMatch(/^That key can't be used/)
  })
})

describe('Where your keys sit', () => {
  function lower(): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>('button', { name: 'Lower' })
  }

  function higher(): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>('button', { name: 'Higher' })
  }

  function range(): string {
    return within(option('Where your keys sit')).getByRole('status').textContent ?? ''
  }

  it('shows the notes the keys can play, between "Lower" and "Higher"', () => {
    render(<LiveTab />)
    const row = option('Where your keys sit')
    expect(row.textContent).toContain('◀︎ LowerC3 – C6Higher ▶︎')
    expect(explanationOf(row)).toBe('Moves your computer keys to lower or higher notes.')
  })

  it('moves the keys lower and higher', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)

    await user.click(lower())
    expectSettings({ baseOctave: 2 })
    expect(range()).toBe('C2 – C5')

    await user.click(higher())
    await user.click(higher())
    expectSettings({ baseOctave: 4 })
    expect(range()).toBe('C4 – C7')
  })

  it('stops at either end of the piano', () => {
    render(<LiveTab />)

    act(() => settingsStore.set({ baseOctave: MIN_BASE_OCTAVE }))
    expect(lower().disabled).toBe(true)
    expect(higher().disabled).toBe(false)

    act(() => settingsStore.set({ baseOctave: MAX_BASE_OCTAVE }))
    expect(lower().disabled).toBe(false)
    expect(higher().disabled).toBe(true)
  })

  it('writes the notes as the player chose to read notes', () => {
    settingsStore.set({ noteNaming: 'solfege' })
    render(<LiveTab />)
    expect(range()).toBe('Do3 – Do6')
  })
})

describe('Keyboard type', () => {
  function type(name: string): HTMLElement {
    return within(option('Keyboard type')).getByRole('button', { name })
  }

  it('offers Auto and three kinds of keyboard', () => {
    render(<LiveTab />)
    const types = within(option('Keyboard type')).getAllByRole('button')

    expect(types.map((button) => button.textContent)).toEqual([
      'Auto',
      'QWERTY',
      'AZERTY',
      'QWERTZ',
    ])
    expect(types.filter(isChosen)).toEqual([type('Auto')])
    expect(explanationOf(option('Keyboard type'))).toBe(
      'Which letters are printed on your keyboard. Auto works it out when the browser can.',
    )
  })

  it.each([
    ['QWERTY', 'qwerty'],
    ['AZERTY', 'azerty'],
    ['QWERTZ', 'qwertz'],
  ] as const)('sets %s, and leaves the keys themselves alone', async (name, keyboardType) => {
    const user = userEvent.setup()
    render(<LiveTab />)

    await user.click(type(name))

    expectSettings({ keyboardType })
    expect(isChosen(type(name))).toBe(true)
    expect(isChosen(type('Auto'))).toBe(false)
  })
})

describe('Reset to default keys', () => {
  function drawWithOwnKeys(): void {
    settingsStore.set({ bindings: OWN_KEYS, customLabels: { KeyZ: 'W' }, volume: 0.3 })
    render(<LiveTab />)
  }

  it('asks before it does anything', async () => {
    const user = userEvent.setup()
    drawWithOwnKeys()

    await user.click(screen.getByRole('button', { name: 'Reset to default keys' }))
    expect(screen.getByText('Really reset?')).toBeTruthy()
    expectSettings({ bindings: OWN_KEYS, customLabels: { KeyZ: 'W' }, volume: 0.3 })

    await user.click(screen.getByRole('button', { name: 'No' }))
    expectSettings({ bindings: OWN_KEYS, customLabels: { KeyZ: 'W' }, volume: 0.3 })
  })

  it('puts the Home row keys back on Yes, and nothing but the keys', async () => {
    const user = userEvent.setup()
    drawWithOwnKeys()

    await user.click(screen.getByRole('button', { name: 'Reset to default keys' }))
    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expectSettings({ volume: 0.3 })
    expect(resultMessage()).toBe('The default keys are back.')
    expect(chosenLayouts()).toEqual([layoutCard('Home row')])
    expect(customLabel()).toBeNull()
  })
})
