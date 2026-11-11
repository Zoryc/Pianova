import { useId } from 'react'
import type { JSX } from 'react'
import { MAX_BASE_OCTAVE, MIN_BASE_OCTAVE } from '../../core/layout'
import type { KeyboardType } from '../../core/types'
import { settingsStore } from '../../state/settings'
import type { Settings } from '../../state/settings'
import { ConfirmButton, Field, Segmented } from '../controls'
import { pianoRangeLabel } from '../format'
import { slotNoteName } from '../keyEditorModel'
import type { KeyEditor } from '../useKeyEditor'
import { PresetCards } from './PresetCards'

interface KeysTabProps {
  settings: Settings
  /** The state of "change one key" and the actions on the player's keys. */
  keyEditor: KeyEditor
}

const KEYBOARD_TYPE_OPTIONS: readonly { value: KeyboardType; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'qwerty', label: 'QWERTY' },
  { value: 'azerty', label: 'AZERTY' },
  { value: 'qwertz', label: 'QWERTZ' },
]

/*
 * ◀ and ▶ are followed by a "text style" mark (U+FE0E), so that they are
 * drawn as plain shapes in the colour of the text and never as colour emoji.
 */
const ARROW_LOWER = '◀︎'
const ARROW_HIGHER = '▶︎'

/**
 * Everything about the computer keys: a ready-made layout, changing one key
 * at a time on the piano below, which notes the keys sit on, the letters
 * printed on the player's keyboard, and a way back to the default keys.
 */
export function KeysTab({ settings, keyEditor }: KeysTabProps): JSX.Element {
  const { baseOctave } = settings
  const { selectedSlot } = keyEditor

  return (
    <>
      <PresetCards bindings={settings.bindings} onApply={keyEditor.applyPreset} />

      <ChangeOneKey
        selectedNote={selectedSlot === null ? null : slotNoteName(settings, selectedSlot)}
        message={keyEditor.message}
      />

      <Field
        label="Where your keys sit"
        hint="Moves your computer keys to lower or higher notes."
      >
        <button
          type="button"
          className="button"
          disabled={baseOctave <= MIN_BASE_OCTAVE}
          onClick={() => settingsStore.set({ baseOctave: baseOctave - 1 })}
        >
          <span aria-hidden="true">{ARROW_LOWER}</span> Lower
        </button>
        {/* An <output>, so that screen readers say the new notes when the keys move. */}
        <output className="keys-range">{pianoRangeLabel(baseOctave, settings.noteNaming)}</output>
        <button
          type="button"
          className="button"
          disabled={baseOctave >= MAX_BASE_OCTAVE}
          onClick={() => settingsStore.set({ baseOctave: baseOctave + 1 })}
        >
          Higher <span aria-hidden="true">{ARROW_HIGHER}</span>
        </button>
      </Field>

      <Field
        label="Keyboard type"
        hint="Which letters are printed on your keyboard. Auto works it out when the browser can."
      >
        <Segmented
          value={settings.keyboardType}
          options={KEYBOARD_TYPE_OPTIONS}
          onChange={(keyboardType) => settingsStore.set({ keyboardType })}
        />
      </Field>

      <div className="settings-actions">
        <ConfirmButton label="Reset to default keys" onConfirm={keyEditor.resetKeys} />
      </div>
    </>
  )
}

interface ChangeOneKeyProps {
  /** Name of the piano key waiting for a computer key ("C4"), or null when none is selected. */
  selectedNote: string | null
  /** What the last action did, or null. */
  message: string | null
}

/**
 * What to do to change one key, and what the last change did. It only
 * explains and reports: the piano under the panel is where a key is clicked,
 * and the key presses are handled by the app (see useKeyEditor).
 */
function ChangeOneKey({ selectedNote, message }: ChangeOneKeyProps): JSX.Element {
  const titleId = useId()
  return (
    <section
      className="change-key"
      aria-labelledby={titleId}
      data-waiting={selectedNote === null ? undefined : true}
    >
      <h3 id={titleId} className="settings-label">
        Change one key
      </h3>
      {/* Screen readers announce it when it changes: it says what the next key press does. */}
      <p className="change-key__lead" aria-live="polite">
        {selectedNote === null
          ? 'Click a piano key below, then press the key you want to use for it.'
          : `Press a key for ${selectedNote}…`}
      </p>
      <p className="change-key__detail">
        {/* Both are always present, so that screen readers announce their text as it appears. */}
        <span className="change-key__hint" aria-live="polite">
          {selectedNote !== null && 'Esc = cancel · Backspace = remove this key'}
        </span>
        <span className="change-key__message" role="status">
          {message}
        </span>
      </p>
    </section>
  )
}
