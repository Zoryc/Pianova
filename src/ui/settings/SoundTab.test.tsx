// @vitest-environment jsdom
/**
 * The Sound tab of the Settings panel: every option is there under its own
 * name, with its explanation, and changes its own setting and no other.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'react'
import { describe, expect, it } from 'vitest'
import { MAX_TRANSPOSE, settingsStore, useSettings } from '../../state/settings'
import { SoundTab } from './SoundTab'
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
  return <SoundTab settings={useSettings()} />
}

function slider(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('slider', { name })
}

function setSlider(name: string, percent: number): void {
  fireEvent.change(slider(name), { target: { value: String(percent) } })
}

startEachTestFromDefaults()

describe('the Sound tab', () => {
  it('lists the everyday options, then the advanced ones', () => {
    const { container } = render(<LiveTab />)
    expect(namesInOrder(container)).toEqual([
      'Volume',
      'Sustain',
      'Advanced',
      'Touch',
      'Room echo',
      'Note fade-out',
      'Transpose',
    ])
  })

  it('explains each option in one line', () => {
    render(<LiveTab />)
    expect(explanationOf(option('Volume'))).toBe('')
    expect(explanationOf(option('Sustain'))).toBe(
      'Notes keep ringing after you let go. Space also turns it on and off.',
    )
    expect(explanationOf(option('Touch'))).toBe('How hard each note is played.')
    expect(explanationOf(option('Room echo'))).toBe('Adds the echo of a room. 0 is none.')
    expect(explanationOf(option('Note fade-out'))).toBe('How long a note rings after you let go.')
    expect(explanationOf(option('Transpose'))).toBe('Shifts every note up or down. 0 is normal.')
  })

  it('sets the volume, from 0 to 100%', () => {
    render(<LiveTab />)
    expect(slider('Volume').value).toBe('80')
    expect(slider('Volume').min).toBe('0')

    setSlider('Volume', 35)

    expectSettings({ volume: 0.35 })
    expect(slider('Volume').value).toBe('35')
    expect(within(option('Volume')).getByText('35%')).toBeTruthy()
  })

  it('turns sustain on and off', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)
    const sustain = screen.getByRole('switch', { name: 'Sustain' })
    expect(sustain.getAttribute('aria-checked')).toBe('false')

    await user.click(sustain)
    expectSettings({ sustain: true })
    expect(sustain.getAttribute('aria-checked')).toBe('true')

    await user.click(sustain)
    expectSettings({})
  })

  it('sets how hard notes are played, from 10 to 100%', () => {
    render(<LiveTab />)
    expect(slider('Touch').min).toBe('10')

    setSlider('Touch', 55)

    expectSettings({ velocity: 0.55 })
  })

  it('sets the room echo, from 0 to 100%', () => {
    render(<LiveTab />)
    expect(slider('Room echo').value).toBe('15')
    expect(slider('Room echo').min).toBe('0')

    setSlider('Room echo', 60)

    expectSettings({ reverb: 0.6 })
  })

  it.each([
    ['Short', 'short'],
    ['Long', 'long'],
  ] as const)('sets the note fade-out to %s', async (name, release) => {
    const user = userEvent.setup()
    render(<LiveTab />)
    const choices = within(option('Note fade-out'))
    expect(choices.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Short',
      'Normal',
      'Long',
    ])
    expect(isChosen(choices.getByRole('button', { name: 'Normal' }))).toBe(true)

    await user.click(choices.getByRole('button', { name }))

    expectSettings({ release })
    expect(isChosen(choices.getByRole('button', { name }))).toBe(true)
    expect(isChosen(choices.getByRole('button', { name: 'Normal' }))).toBe(false)
  })

  it('shifts the notes up and down one step at a time', async () => {
    const user = userEvent.setup()
    render(<LiveTab />)
    const transpose = within(option('Transpose'))
    expect(transpose.getByRole('status').textContent).toBe('0')

    await user.click(transpose.getByRole('button', { name: 'Transpose up' }))
    await user.click(transpose.getByRole('button', { name: 'Transpose up' }))
    expectSettings({ transpose: 2 })
    expect(transpose.getByRole('status').textContent).toBe('+2')

    await user.click(transpose.getByRole('button', { name: 'Transpose down' }))
    await user.click(transpose.getByRole('button', { name: 'Transpose down' }))
    await user.click(transpose.getByRole('button', { name: 'Transpose down' }))
    expectSettings({ transpose: -1 })
    expect(transpose.getByRole('status').textContent).toBe('−1')
  })

  it('stops shifting at an octave either way', () => {
    render(<LiveTab />)
    const up = screen.getByRole<HTMLButtonElement>('button', { name: 'Transpose up' })
    const down = screen.getByRole<HTMLButtonElement>('button', { name: 'Transpose down' })

    act(() => settingsStore.set({ transpose: MAX_TRANSPOSE }))
    expect(up.disabled).toBe(true)
    expect(down.disabled).toBe(false)

    act(() => settingsStore.set({ transpose: -MAX_TRANSPOSE }))
    expect(up.disabled).toBe(false)
    expect(down.disabled).toBe(true)
  })
})
