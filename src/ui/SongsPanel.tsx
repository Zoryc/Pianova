import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, JSX, KeyboardEvent, MouseEvent, RefObject } from 'react'
import { songLibrary } from '../app/songsApp'
import { MAX_TITLE_LENGTH, formatDuration } from '../songs/song'
import type { SongSummary } from '../songs/song'
import { useSongList } from '../songs/songLibrary'
import { STARTER_SONGS } from '../songs/starterSongs'
import { FloatingPanel } from './FloatingPanel'
import { importSongFiles, playSong, useSongMessages } from './useSongs'
import type { SongMessage } from './useSongs'
import './songs.css'

export interface SongsPanelProps {
  /** The element id, by which the app finds the panel when it moves the keyboard focus. */
  id: string
  onClose(): void
}

/** What the file picker offers: MIDI files, by their endings and by their kind. */
const MIDI_FILE_TYPES = '.mid,.midi,audio/midi,audio/x-midi'

/**
 * The Songs panel: adding songs from MIDI files, the player's own songs
 * (play, rename, delete) and the built-in starter songs (play only).
 */
export function SongsPanel({ id, onClose }: SongsPanelProps): JSX.Element {
  const ownSongs = useSongList()
  const messages = useSongMessages()
  const importButton = useRef<HTMLButtonElement>(null)
  const ownHeadingId = useId()
  const starterHeadingId = useId()

  function play(songId: string): void {
    // The panel goes away so that the piano is in view. A song that cannot be
    // read is not played: the panel stays, with the reason in its message line.
    if (playSong(songId)) onClose()
  }

  function afterDelete(withKeyboard: boolean): void {
    // The row that had the keyboard focus is gone: the focus goes somewhere that stays.
    if (withKeyboard) importButton.current?.focus()
  }

  return (
    <FloatingPanel id={id} title="Songs" onClose={onClose}>
      <div className="songs">
        <div>
          <ImportControl buttonRef={importButton} />
          <MessageLine messages={messages} />
        </div>

        <section className="songs__group" aria-labelledby={ownHeadingId}>
          <h3 id={ownHeadingId} className="songs__heading">
            Your songs
          </h3>
          {ownSongs.length === 0 ? (
            <p className="songs__empty">No songs of your own yet. Import a MIDI file to add one.</p>
          ) : (
            <ul className="song-list">
              {ownSongs.map((song) => (
                <OwnSongRow key={song.id} song={song} onPlay={play} onDeleted={afterDelete} />
              ))}
            </ul>
          )}
        </section>

        <section className="songs__group" aria-labelledby={starterHeadingId}>
          <h3 id={starterHeadingId} className="songs__heading">
            Starter songs
          </h3>
          <ul className="song-list">
            {STARTER_SONGS.map((song) => (
              <li key={song.id} className="song-row">
                <SongTitleAndLength song={song} />
                <span className="song-row__actions">
                  <PlayButton song={song} onPlay={play} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </FloatingPanel>
  )
}

interface ImportControlProps {
  buttonRef: RefObject<HTMLButtonElement | null>
}

/** The import button. The browser's own file field is hidden and opened by the button. */
function ImportControl({ buttonRef }: ImportControlProps): JSX.Element {
  const fileField = useRef<HTMLInputElement>(null)

  function importChosenFiles(event: ChangeEvent<HTMLInputElement>): void {
    const field = event.currentTarget
    void importSongFiles(Array.from(field.files ?? []))
    // Emptied, so that choosing the same file again counts as a new choice.
    field.value = ''
  }

  return (
    <div className="songs__import">
      <button
        ref={buttonRef}
        type="button"
        className="button button--primary"
        onClick={() => fileField.current?.click()}
      >
        Import a MIDI file
      </button>
      <span className="songs__import-hint">or drop a MIDI file anywhere on this page</span>
      <input
        ref={fileField}
        type="file"
        hidden
        multiple
        accept={MIDI_FILE_TYPES}
        onChange={importChosenFiles}
      />
    </div>
  )
}

/** Always on the page, with or without text, so that screen readers announce what appears in it. */
function MessageLine({ messages }: { messages: readonly SongMessage[] }): JSX.Element {
  return (
    <div className="songs__messages" role="status">
      {messages.map((message, index) => (
        <p key={index} className="songs__message" data-problem={message.isProblem}>
          {message.text}
        </p>
      ))}
    </div>
  )
}

/** What a song's row shows in place of its buttons: nothing, the name field, or "Delete?". */
type RowMode = 'resting' | 'renaming' | 'deleting'

interface OwnSongRowProps {
  song: SongSummary
  onPlay(songId: string): void
  /** The song was deleted. `withKeyboard` says whether "Yes" was pressed with the keyboard. */
  onDeleted(withKeyboard: boolean): void
}

/** One of the player's own songs: Play, Rename (in place) and Delete (after asking, in place). */
function OwnSongRow({ song, onPlay, onDeleted }: OwnSongRowProps): JSX.Element {
  const [mode, setMode] = useState<RowMode>('resting')
  const renameButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const noButton = useRef<HTMLButtonElement>(null)
  /** The button that gets the keyboard focus once the row has changed, if any. */
  const focusNext = useRef<RefObject<HTMLButtonElement | null> | null>(null)

  /*
   * Changing the row swaps its buttons, so the button that was pressed
   * disappears. For someone working with the keyboard alone the focus would
   * disappear with it. It is moved on instead: to "No", the answer that
   * changes nothing, when the question appears, and back to the button that
   * was pressed first once the row is at rest again.
   */
  useLayoutEffect(() => {
    focusNext.current?.current?.focus()
    focusNext.current = null
  }, [mode])

  function show(next: RowMode, focus: RefObject<HTMLButtonElement | null> | null): void {
    focusNext.current = focus
    setMode(next)
  }

  if (mode === 'renaming') {
    return (
      <li className="song-row">
        <RenameForm
          title={song.title}
          onSave={(title, withKeyboard) => {
            songLibrary.rename(song.id, title)
            show('resting', withKeyboard ? renameButton : null)
          }}
          onCancel={(withKeyboard) => show('resting', withKeyboard ? renameButton : null)}
        />
      </li>
    )
  }

  return (
    <li className="song-row">
      <SongTitleAndLength song={song} />
      {mode === 'deleting' ? (
        <span key="question" className="confirm" role="group" aria-label={`Delete ${song.title}`}>
          <span className="confirm__question">Delete?</span>
          <button
            type="button"
            className="button button--danger"
            onClick={(event) => {
              // "Yes" appears about where "Delete" was. The second click of a
              // double-click on "Delete" can land on it, and is not an answer.
              if (event.detail > 1) return
              // A song that is in the player is closed there too: see followLibrary in useSongs.ts.
              songLibrary.remove(song.id)
              onDeleted(usedKeyboard(event))
            }}
          >
            Yes
          </button>
          <button
            ref={noButton}
            type="button"
            className="button"
            onClick={(event) => show('resting', usedKeyboard(event) ? deleteButton : null)}
          >
            No
          </button>
        </span>
      ) : (
        <span key="actions" className="song-row__actions">
          <PlayButton song={song} onPlay={onPlay} />
          <button
            ref={renameButton}
            type="button"
            className="button button--quiet"
            aria-label={`Rename ${song.title}`}
            onClick={() => show('renaming', null)}
          >
            Rename
          </button>
          <button
            ref={deleteButton}
            type="button"
            className="button button--quiet"
            aria-label={`Delete ${song.title}`}
            onClick={(event) => show('deleting', usedKeyboard(event) ? noButton : null)}
          >
            Delete
          </button>
        </span>
      )}
    </li>
  )
}

function SongTitleAndLength({ song }: { song: { title: string; duration: number } }): JSX.Element {
  return (
    <>
      <span className="song-row__title" title={song.title}>
        {song.title}
      </span>
      <span className="song-row__length">{formatDuration(song.duration)}</span>
    </>
  )
}

interface PlayButtonProps {
  song: { id: string; title: string }
  onPlay(songId: string): void
}

function PlayButton({ song, onPlay }: PlayButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="button"
      aria-label={`Play ${song.title}`}
      onClick={() => onPlay(song.id)}
    >
      Play
    </button>
  )
}

interface RenameFormProps {
  /** The name the song has now. */
  title: string
  /** `withKeyboard` is true when the keyboard was used, which then keeps its place in the list. */
  onSave(title: string, withKeyboard: boolean): void
  onCancel(withKeyboard: boolean): void
}

/** The name of a song as a text field, in the song's own row. Enter saves, Escape cancels. */
function RenameForm({ title, onSave, onCancel }: RenameFormProps): JSX.Element {
  const [name, setName] = useState(title)
  const field = useRef<HTMLInputElement>(null)

  // The whole name is selected, so that typing replaces it.
  useLayoutEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])

  function handleKey(event: KeyboardEvent<HTMLInputElement>): void {
    // An Enter that only confirms a character being composed (Japanese, Chinese…) is not ours.
    if (event.nativeEvent.isComposing) return
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    // The focus moves to a button while the key is still down. Without this
    // the browser would go on to press that button with the same Enter.
    event.preventDefault()
    if (event.key === 'Enter') onSave(name, true)
    else onCancel(true)
  }

  return (
    <>
      <input
        ref={field}
        className="song-row__name"
        type="text"
        aria-label="Song name"
        maxLength={MAX_TITLE_LENGTH}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={handleKey}
      />
      <span className="song-row__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={(event) => onSave(name, usedKeyboard(event))}
        >
          Save
        </button>
        <button
          type="button"
          className="button"
          onClick={(event) => onCancel(usedKeyboard(event))}
        >
          Cancel
        </button>
      </span>
    </>
  )
}

/** `detail` is 0 when the "click" was Enter on the focused button, not a press of the mouse. */
function usedKeyboard(event: MouseEvent): boolean {
  return event.detail === 0
}
