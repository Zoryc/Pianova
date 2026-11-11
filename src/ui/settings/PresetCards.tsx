import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX, MouseEvent, RefObject } from 'react'
import { DEFAULT_BASE_OCTAVE, slotToMidi } from '../../core/layout'
import { isBlackKey } from '../../core/notes'
import { KEY_PRESETS, matchingPreset } from '../../input/keymap'
import type { Bindings, KeyPreset } from '../../input/keymap'
import { ChoiceCard, ChoiceGroup, CustomLabel } from './ChoiceGroup'

interface PresetCardsProps {
  /** The player's keys as they are now. */
  bindings: Bindings
  /** The player chose a layout (and, where it was asked, confirmed the choice). */
  onApply(preset: KeyPreset): void
}

/** "Replace your own keys with this layout?", waiting for its answer. */
interface Question {
  preset: KeyPreset
  /** The keys the question was asked about. Once they change, it no longer stands. */
  bindings: Bindings
}

/**
 * The ready-made key layouts, one card each. A click applies the layout at
 * once. When the player's keys are their own (they match no layout), the
 * click asks first, in the same place where "Custom" is written, because
 * the layout would replace keys the player chose one by one.
 */
export function PresetCards({ bindings, onApply }: PresetCardsProps): JSX.Element {
  const current = matchingPreset(bindings)
  const [asked, setAsked] = useState<Question | null>(null)
  const question = asked !== null && asked.bindings === bindings ? asked.preset : null

  const noButton = useRef<HTMLButtonElement>(null)
  /** The card the question is about: the keyboard focus goes back to it once it is answered. */
  const askedCard = useRef<HTMLButtonElement | null>(null)
  /** True when the button that was just pressed was pressed with the keyboard. */
  const pressedWithKeyboard = useRef(false)

  /*
   * For someone working with the keyboard alone, the question would appear
   * somewhere the focus is not, and its two answers would take the focus away
   * with them when they disappear. So the focus is moved: to "No", the answer
   * that changes nothing, when the question appears, and back to the card
   * once it is answered. After a click with the mouse nothing is moved.
   */
  useLayoutEffect(() => {
    if (!pressedWithKeyboard.current) return
    pressedWithKeyboard.current = false
    const next = question === null ? askedCard.current : noButton.current
    next?.focus()
  }, [question])

  function noteHowItWasPressed(event: MouseEvent): void {
    // `detail` is 0 when the "click" was Enter on the focused button.
    pressedWithKeyboard.current = event.detail === 0
  }

  function choose(preset: KeyPreset, event: MouseEvent<HTMLButtonElement>): void {
    if (preset.id === current) return
    if (current !== null) {
      onApply(preset)
      return
    }
    noteHowItWasPressed(event)
    askedCard.current = event.currentTarget
    setAsked({ preset, bindings })
  }

  function answer(replace: boolean, event: MouseEvent): void {
    noteHowItWasPressed(event)
    setAsked(null)
    if (replace && question !== null) onApply(question)
  }

  return (
    <ChoiceGroup
      label="Key layout"
      aside={
        question === null ? (
          current === null && <CustomLabel />
        ) : (
          <ReplaceQuestion layoutName={question.name} noButton={noButton} onAnswer={answer} />
        )
      }
    >
      <div className="choice-cards choice-cards--presets">
        {KEY_PRESETS.map((preset) => (
          <ChoiceCard
            key={preset.id}
            name={preset.name}
            description={preset.description}
            chosen={preset.id === current}
            asking={preset.id === question?.id}
            onClick={(event) => choose(preset, event)}
          >
            <KeyboardPicture bindings={preset.bindings} />
          </ChoiceCard>
        ))}
      </div>
    </ChoiceGroup>
  )
}

interface ReplaceQuestionProps {
  /** The name of the layout the question is about. */
  layoutName: string
  noButton: RefObject<HTMLButtonElement | null>
  onAnswer(replace: boolean, event: MouseEvent): void
}

/** The question and its two answers, in one line, like the other confirmations of the app. */
function ReplaceQuestion({ layoutName, noButton, onAnswer }: ReplaceQuestionProps): JSX.Element {
  const questionId = useId()
  return (
    <span className="confirm" role="group" aria-label={layoutName} aria-describedby={questionId}>
      <span id={questionId} className="confirm__question">
        Replace your own keys with this layout?
      </span>
      <button
        type="button"
        className="button button--danger"
        onClick={(event) => onAnswer(true, event)}
      >
        Yes
      </button>
      <button
        ref={noButton}
        type="button"
        className="button"
        onClick={(event) => onAnswer(false, event)}
      >
        No
      </button>
    </span>
  )
}

/**
 * The character keys of a keyboard as physical positions, row by row from the
 * digits down. `indent` is how far to the right the row starts, in keys: the
 * rows of a keyboard are not lined up.
 */
const KEYBOARD_ROWS: readonly { indent: number; codes: readonly string[] }[] = [
  { indent: 0, codes: ['Backquote', ...digitKeys('1234567890'), 'Minus', 'Equal'] },
  { indent: 1.5, codes: [...letterKeys('QWERTYUIOP'), 'BracketLeft', 'BracketRight'] },
  { indent: 1.75, codes: [...letterKeys('ASDFGHJKL'), 'Semicolon', 'Quote'] },
  { indent: 2.25, codes: [...letterKeys('ZXCVBNM'), 'Comma', 'Period', 'Slash'] },
]

/** The codes of the letter keys that a US keyboard prints these letters on. */
function letterKeys(letters: string): string[] {
  return [...letters].map((letter) => `Key${letter}`)
}

function digitKeys(digits: string): string[] {
  return [...digits].map((digit) => `Digit${digit}`)
}

/**
 * A tiny picture of a keyboard showing which of its keys a layout uses: the
 * ones that play white piano keys are drawn light, the ones that play black
 * piano keys dark. It is decoration: the description says the same in words.
 */
function KeyboardPicture({ bindings }: { bindings: Bindings }): JSX.Element {
  return (
    <span className="keyboard-picture" aria-hidden="true">
      {KEYBOARD_ROWS.map((row) => (
        <span
          key={row.indent}
          className="keyboard-picture__row"
          style={{ '--indent': row.indent } as CSSProperties}
        >
          {row.codes.map((code) => (
            <span
              key={code}
              className="keyboard-picture__key"
              data-plays={pianoKeyPlayed(bindings, code)}
            />
          ))}
        </span>
      ))}
    </span>
  )
}

/** The colour of the piano key that a computer key plays in a layout, if it plays one at all. */
function pianoKeyPlayed(bindings: Bindings, code: string): 'white' | 'black' | undefined {
  const slot = Object.hasOwn(bindings, code) ? bindings[code] : undefined
  if (slot === undefined) return undefined
  // A piano key is white or black wherever the player's keys sit: they move by whole octaves.
  return isBlackKey(slotToMidi(slot, DEFAULT_BASE_OCTAVE)) ? 'black' : 'white'
}
