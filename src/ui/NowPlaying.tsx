import type { JSX } from 'react'
import { noteName } from '../core/notes'
import type { Midi, NoteNaming } from '../core/types'
import { formatSigned } from './format'

interface NowPlayingProps {
  /** The notes held right now. */
  notes: ReadonlySet<Midi>
  noteNaming: NoteNaming
  /** Shown as a badge when it is not 0, so the player knows why notes sound different. */
  transpose: number
  /**
   * Whether to say how to play while nothing is held. Off while customizing
   * keys, where a click on the piano does something else.
   */
  showHint: boolean
}

/**
 * One line above the piano: the names of the notes being held, lowest first,
 * or a hint when nothing is held. Its height is fixed in the stylesheet, so
 * the piano never moves when the line changes.
 */
export function NowPlaying(props: NowPlayingProps): JSX.Element {
  const { notes, noteNaming, transpose, showHint } = props
  const held = [...notes].sort((a, b) => a - b)

  return (
    <div className="now-playing">
      {held.length > 0 && (
        <ul className="now-playing__notes" aria-label="Notes being played">
          {held.map((midi) => (
            <li key={midi} className="now-playing__note">
              {noteName(midi, noteNaming)}
            </li>
          ))}
        </ul>
      )}
      {held.length === 0 && showHint && (
        <p className="now-playing__hint">Press the keys shown on the piano, or click it</p>
      )}
      {transpose !== 0 && (
        <span className="now-playing__badge">Transposed {formatSigned(transpose)}</span>
      )}
    </div>
  )
}
