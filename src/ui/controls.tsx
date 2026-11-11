/**
 * The small building blocks of the top bar and the panels. Their look is in
 * src/ui/chrome.css, which also styles the plain classes used next to them
 * (.button, .select, .keycap).
 *
 * On/off and choice controls are buttons rather than checkboxes and radio
 * inputs, because Space belongs to the piano (it is the sustain key).
 */
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent, ReactNode } from 'react'
import './chrome.css'
import { formatPercent, toPercent } from './format'

interface FieldProps {
  /** The plain word shown above the control. */
  label: string
  /** One line explaining what the control does. */
  hint?: string
  children: ReactNode
}

/** A control with its visible label above it and, optionally, a one-line explanation below. */
export function Field({ label, hint, children }: FieldProps): JSX.Element {
  const labelId = useId()
  const hintId = useId()
  return (
    <div
      className="field"
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
    >
      <span id={labelId} className="field__label">
        {label}
      </span>
      <div className="field__control">{children}</div>
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
    </div>
  )
}

interface PercentSliderProps {
  /** What the slider sets, for screen readers. */
  label: string
  /** The current value as a fraction: 0.8 is shown as 80%. */
  value: number
  /** The lowest fraction the slider reaches. Defaults to 0. */
  min?: number
  onChange(value: number): void
}

/** A slider from `min` to 100%, with the percentage written next to it. */
export function PercentSlider(props: PercentSliderProps): JSX.Element {
  const { label, value, min = 0, onChange } = props
  return (
    <>
      <input
        className="slider"
        type="range"
        min={toPercent(min)}
        max={100}
        step={1}
        value={toPercent(value)}
        aria-label={label}
        aria-valuetext={formatPercent(value)}
        onChange={(event) => onChange(Number(event.currentTarget.value) / 100)}
      />
      <span className="slider__value" aria-hidden="true">
        {formatPercent(value)}
      </span>
    </>
  )
}

interface SwitchProps {
  /** What is switched on or off, for screen readers. */
  label: string
  on: boolean
  onChange(on: boolean): void
}

/** An on/off switch that says "On" or "Off" in words as well as showing it. */
export function Switch({ label, on, onChange }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__state">{on ? 'On' : 'Off'}</span>
    </button>
  )
}

interface SegmentedProps<Value extends string> {
  value: Value
  options: readonly { value: Value; label: string }[]
  onChange(value: Value): void
}

/** A row of options of which exactly one is chosen. Put it in a Field, which names it. */
export function Segmented<Value extends string>(props: SegmentedProps<Value>): JSX.Element {
  const { value, options, onChange } = props
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface StepperProps {
  /** What is being stepped; names the two buttons for screen readers ("Transpose down"). */
  label: string
  value: number
  min: number
  max: number
  /** How the value is written between the two buttons. */
  format(value: number): string
  onChange(value: number): void
}

/** A whole number with a − button and a + button around it. */
export function Stepper({ label, value, min, max, format, onChange }: StepperProps): JSX.Element {
  return (
    <div className="stepper">
      <button
        type="button"
        className="button button--round"
        aria-label={`${label} down`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output className="stepper__value">{format(value)}</output>
      <button
        type="button"
        className="button button--round"
        aria-label={`${label} up`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  )
}

interface ConfirmButtonProps {
  /** The text of the button, e.g. "Reset to default keys". */
  label: string
  /** Called once the user has answered Yes. */
  onConfirm(): void
}

/** A reset button that asks "Really reset?" in its own place before doing anything. */
export function ConfirmButton({ label, onConfirm }: ConfirmButtonProps): JSX.Element {
  const [asking, setAsking] = useState(false)
  const resetButton = useRef<HTMLButtonElement>(null)
  const noButton = useRef<HTMLButtonElement>(null)
  /** True when the button that was just pressed was pressed with the keyboard. */
  const pressedWithKeyboard = useRef(false)

  /*
   * Asking and answering swap the buttons, so the button that was pressed
   * disappears. For someone working with the keyboard alone the focus would
   * disappear with it. It is moved on instead: to "No", the answer that
   * changes nothing, when the question appears, and back to the reset button
   * once the question is answered.
   */
  useLayoutEffect(() => {
    if (!pressedWithKeyboard.current) return
    pressedWithKeyboard.current = false
    const next = asking ? noButton.current : resetButton.current
    next?.focus()
  }, [asking])

  function show(question: boolean, event: MouseEvent): void {
    // `detail` is 0 when the "click" was Enter on the focused button.
    pressedWithKeyboard.current = event.detail === 0
    setAsking(question)
  }

  if (!asking) {
    return (
      <button
        ref={resetButton}
        type="button"
        className="button"
        onClick={(event) => show(true, event)}
      >
        {label}
      </button>
    )
  }

  return (
    <span className="confirm" role="group" aria-label={label}>
      <span className="confirm__question">Really reset?</span>
      <button
        type="button"
        className="button button--danger"
        onClick={(event) => {
          show(false, event)
          onConfirm()
        }}
      >
        Yes
      </button>
      <button
        ref={noButton}
        type="button"
        className="button"
        onClick={(event) => show(false, event)}
      >
        No
      </button>
    </span>
  )
}
