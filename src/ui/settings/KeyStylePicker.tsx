import type { JSX } from 'react'
import type { PianoRange } from '../../core/layout'
import type { KeyStyle } from '../../core/types'
import { MiniKeys } from './MiniKeys'

interface KeyStylePickerProps {
  value: KeyStyle
  onChange(value: KeyStyle): void
}

const KEY_STYLE_OPTIONS: readonly { value: KeyStyle; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'glass', label: 'Glass' },
]

/** C, D and E, with the two black keys between them. */
const THREE_KEYS: PianoRange = { first: 60, last: 64 }

/**
 * The choice of key style: like the shared `Segmented` control, with a tiny
 * picture of three keys in each style next to its name.
 */
export function KeyStylePicker({ value, onChange }: KeyStylePickerProps): JSX.Element {
  return (
    <div className="segmented">
      {KEY_STYLE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option key-style-option"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <MiniKeys keyStyle={option.value} range={THREE_KEYS} />
          {option.label}
        </button>
      ))}
    </div>
  )
}
