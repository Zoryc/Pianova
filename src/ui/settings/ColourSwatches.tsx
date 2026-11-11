import { useRef } from 'react'
import type { CSSProperties, JSX, KeyboardEvent } from 'react'
import { ACCENT_COLOURS, paletteFor, paletteForNote } from '../../core/colour'
import type { AccentChoice, AccentName } from '../../core/types'

interface ColourSwatchesProps {
  /** What the swatches choose, for screen readers. */
  label: string
  accent: AccentChoice
  /** The player's own colour, '#rrggbb'. */
  customColour: string
  onAccentChange(accent: AccentChoice): void
  /** The player picked a colour of their own in the browser's colour picker. */
  onCustomColourChange(customColour: string): void
}

const NAMED_COLOURS: readonly { value: AccentName; name: string }[] = [
  { value: 'red', name: 'Red' },
  { value: 'amber', name: 'Amber' },
  { value: 'blue', name: 'Blue' },
  { value: 'green', name: 'Green' },
  { value: 'purple', name: 'Purple' },
  { value: 'white', name: 'White' },
]

/** In the order they are shown, which is also the order the arrow keys follow. */
const CHOICES: readonly AccentChoice[] = [
  ...NAMED_COLOURS.map((colour) => colour.value),
  'rainbow',
  'custom',
]

const NOTES_IN_AN_OCTAVE = 12

/** The colours of the twelve notes, from C round to the next C: the wheel ends where it began. */
const RAINBOW_COLOURS = Array.from(
  { length: NOTES_IN_AN_OCTAVE + 1 },
  (_, note) => paletteForNote(note, 'rainbow', '').light,
)
const RAINBOW_WHEEL = `conic-gradient(${RAINBOW_COLOURS.join(', ')})`

/**
 * The colour of the light, as round swatches of which one is chosen: six
 * named colours, Rainbow (a colour for every note) and the player's own
 * colour, which opens the browser's colour picker.
 *
 * It is a radio group made of buttons, because Space belongs to the piano:
 * the arrow keys move from one colour to the next and choose it at once.
 */
export function ColourSwatches(props: ColourSwatchesProps): JSX.Element {
  const { label, accent, customColour, onAccentChange, onCustomColourChange } = props
  const group = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return
    const step = stepOfKey(event.key)
    if (step === null) return
    event.preventDefault()
    const next = choiceAfter(accent, step)
    onAccentChange(next)
    group.current?.querySelector<HTMLElement>(`[data-accent="${next}"]`)?.focus()
  }

  return (
    <div
      ref={group}
      className="swatches"
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
    >
      {NAMED_COLOURS.map((colour) => (
        <Swatch
          key={colour.value}
          choice={colour.value}
          name={colour.name}
          fill={ACCENT_COLOURS[colour.value]}
          checked={colour.value === accent}
          onChoose={() => onAccentChange(colour.value)}
        />
      ))}

      <Swatch
        choice="rainbow"
        name="Rainbow"
        showName
        fill={RAINBOW_WHEEL}
        checked={accent === 'rainbow'}
        onChoose={() => onAccentChange('rainbow')}
      />

      <span className="swatch-own">
        <Swatch
          choice="custom"
          name="Your colour"
          showName
          fill={paletteFor('custom', customColour).light}
          checked={accent === 'custom'}
          onChoose={() => {
            onAccentChange('custom')
            // Opens the browser's colour picker, next to the swatch.
            picker.current?.click()
          }}
        />
        {/*
         * The browser's own colour picker. The swatch above opens it: that is
         * the control the player sees and reaches with the keyboard.
         */}
        <input
          ref={picker}
          className="swatch-own__picker"
          type="color"
          value={customColour}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => onCustomColourChange(event.currentTarget.value)}
        />
      </span>
    </div>
  )
}

interface SwatchProps {
  choice: AccentChoice
  /** The plain name of the colour. */
  name: string
  /** True to write the name next to the colour: for a choice that a colour alone cannot show. */
  showName?: boolean
  /** A colour or a gradient. */
  fill: string
  checked: boolean
  onChoose(): void
}

/** One radio button of the group: a round patch of colour. */
function Swatch({ choice, name, showName, fill, checked, onChoose }: SwatchProps): JSX.Element {
  return (
    <button
      type="button"
      className={showName ? 'swatch swatch--named' : 'swatch'}
      role="radio"
      aria-checked={checked}
      aria-label={showName ? undefined : name}
      title={showName ? undefined : name}
      // Only the chosen colour is reached with Tab; the arrow keys do the rest.
      tabIndex={checked ? 0 : -1}
      // Lets the arrow keys find the swatch to move the focus to.
      data-accent={choice}
      onClick={onChoose}
    >
      <span className="swatch__dot" style={{ '--swatch': fill } as CSSProperties} />
      {showName && name}
    </button>
  )
}

/** The arrow keys of a radio group: right and down go on, left and up go back. */
function stepOfKey(key: string): 1 | -1 | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return 1
    case 'ArrowLeft':
    case 'ArrowUp':
      return -1
    default:
      return null
  }
}

/** The choice `step` places further along, going round at either end. */
function choiceAfter(accent: AccentChoice, step: number): AccentChoice {
  const index = CHOICES.indexOf(accent)
  return CHOICES[(index + step + CHOICES.length) % CHOICES.length] ?? accent
}
