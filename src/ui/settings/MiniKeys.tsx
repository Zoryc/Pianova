import type { CSSProperties, JSX } from 'react'
import type { LightPalette } from '../../core/colour'
import type { PianoRange } from '../../core/layout'
import { keyRects } from '../../core/pianoGeometry'
import type { KeyRect } from '../../core/pianoGeometry'
import type { KeyStyle, Midi } from '../../core/types'

interface MiniKeysProps {
  keyStyle: KeyStyle
  /** The notes to draw: a few keys of a piano. */
  range: PianoRange
  /** The keys drawn lit, each with the light of its own note. */
  lit?: ReadonlyMap<Midi, LightPalette>
}

/**
 * A tiny picture of a few piano keys in one of the key styles, laid out like
 * the real piano. It is decoration: the words next to it say what it shows.
 */
export function MiniKeys({ keyStyle, range, lit }: MiniKeysProps): JSX.Element {
  return (
    <span className="mini-keys" data-key-style={keyStyle} aria-hidden="true">
      {keyRects(range).map((rect) => (
        <MiniKey key={rect.midi} rect={rect} light={lit?.get(rect.midi)} />
      ))}
    </span>
  )
}

function MiniKey({ rect, light }: { rect: KeyRect; light: LightPalette | undefined }): JSX.Element {
  const colour = rect.black ? 'black' : 'white'
  const style = {
    left: percent(rect.left),
    width: percent(rect.width),
    '--key-light': light?.light,
    '--key-light-bright': light?.bright,
  } as CSSProperties

  return (
    <span
      className={`mini-keys__key mini-keys__key--${colour}`}
      data-lit={light ? true : undefined}
      style={style}
    />
  )
}

function percent(fraction: number): string {
  return `${fraction * 100}%`
}
