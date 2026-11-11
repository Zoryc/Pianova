import { useId } from 'react'
import type { JSX, MouseEvent, ReactNode } from 'react'

interface ChoiceGroupProps {
  /** The plain words that name the choice. */
  label: string
  /** One line explaining it. */
  hint?: string
  /** Shown at the end of the label's row: what the cards cannot say themselves. */
  aside?: ReactNode
  /** The cards. */
  children: ReactNode
}

/**
 * A choice made by picking one card out of a few (the themes, the key
 * layouts). The name and the explanation come first, then the cards over the
 * full width of the panel.
 */
export function ChoiceGroup({ label, hint, aside, children }: ChoiceGroupProps): JSX.Element {
  const labelId = useId()
  const hintId = useId()
  return (
    <div
      className="choice-group"
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
    >
      <div className="choice-group__head">
        <div className="choice-group__text">
          <span id={labelId} className="settings-label">
            {label}
          </span>
          {hint && (
            <p id={hintId} className="settings-hint">
              {hint}
            </p>
          )}
        </div>
        <div className="choice-group__aside">{aside}</div>
      </div>
      {children}
    </div>
  )
}

interface ChoiceCardProps {
  name: string
  /** One line saying what choosing the card gives. */
  description: string
  /** True for the card of the current choice. */
  chosen: boolean
  /** True while a question about this card waits for its answer. */
  asking?: boolean
  onClick(event: MouseEvent<HTMLButtonElement>): void
  /** The tiny picture at the top of the card. */
  children: ReactNode
}

/** One card of a choice: a picture, a name and a line of description. The card is a button. */
export function ChoiceCard(props: ChoiceCardProps): JSX.Element {
  const { name, description, chosen, asking = false, onClick, children } = props
  const nameId = useId()
  const descriptionId = useId()
  return (
    <button
      type="button"
      className="choice-card"
      aria-pressed={chosen}
      aria-labelledby={nameId}
      aria-describedby={descriptionId}
      data-asking={asking ? true : undefined}
      onClick={onClick}
    >
      {children}
      <span id={nameId} className="choice-card__name">
        {name}
      </span>
      <span id={descriptionId} className="choice-card__description">
        {description}
      </span>
    </button>
  )
}

/** Says, quietly, that none of the cards is the current choice: the player has made their own. */
export function CustomLabel(): JSX.Element {
  return <span className="choice-group__custom">Custom</span>
}
