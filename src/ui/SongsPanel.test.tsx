// @vitest-environment jsdom
/**
 * The Songs panel (src/ui/SongsPanel.tsx) as a player uses it: adding songs
 * from files, the two lists, and playing, renaming and deleting a song. The
 * app's real player and library are behind it.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '../app/pianoApp'
import { player, songLibrary } from '../app/songsApp'
import { formatDuration } from '../songs/song'
import { STARTER_SONGS } from '../songs/starterSongs'
import { SongsPanel } from './SongsPanel'
import { settingsStore } from '../state/settings'
import {
  addSong,
  damagedMidiBytes,
  fakeFile,
  hugeFile,
  midiBytes,
  resetSongs,
  songFile,
  unreadableFile,
  unsupportedMidiBytes,
} from './songsTestKit'
import { UNREADABLE_SONG_MESSAGE, importSongFiles } from './useSongs'

const NOT_MIDI = 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.'
const TOO_BIG = 'That file is too big. The limit is 5 MB.'
const NO_NOTES = 'That MIDI file has no notes in it.'
const UNSUPPORTED = 'That kind of MIDI file is not supported yet.'
const DAMAGED = 'That MIDI file seems to be damaged and could not be read.'
const CANNOT_BE_READ =
  'That could not be read. If it is a folder, open it and drop the MIDI files that are in it.'
const EMPTY_LIST = 'No songs of your own yet. Import a MIDI file to add one.'

function openPanel() {
  const onClose = vi.fn()
  const view = render(<SongsPanel id="songs-panel" onClose={onClose} />)
  return { onClose, ...view }
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

/** A press of the mouse. (A click made with Enter has `detail` 0, which is what fireEvent sends.) */
function clickWithMouse(element: HTMLElement): void {
  fireEvent.click(element, { detail: 1 })
}

function clickWithKeyboard(element: HTMLElement): void {
  element.focus()
  fireEvent.click(element, { detail: 0 })
}

function fileField(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (field === null) throw new Error('The panel has no file field.')
  return field
}

/** What the player does in the file picker: chooses these files. */
function chooseFiles(...files: File[]): void {
  fireEvent.change(fileField(), { target: { files } })
}

function messageLine(): HTMLElement {
  return screen.getByRole('status')
}

/** The lines of the message line, problems marked with "!". */
function messages(): string[] {
  return [...messageLine().children].map((line) =>
    line.getAttribute('data-problem') === 'true' ? `! ${line.textContent}` : (line.textContent ?? ''),
  )
}

function ownSongs(): HTMLElement {
  return screen.getByRole('region', { name: 'Your songs' })
}

function starterSongs(): HTMLElement {
  return screen.getByRole('region', { name: 'Starter songs' })
}

/** The titles in a list, top to bottom. */
function titlesIn(list: HTMLElement): string[] {
  return within(list)
    .queryAllByRole('listitem')
    .map((row) => row.querySelector('.song-row__title')?.textContent ?? '')
}

function focused(): Element | null {
  return document.activeElement
}

beforeEach(resetSongs)

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await resetSongs()
  bus.allOff()
})

describe('the Songs panel', () => {
  it('is a floating panel called "Songs", with the id it was given', () => {
    const { onClose } = openPanel()
    const panel = screen.getByRole('dialog', { name: 'Songs' })
    expect(panel.id).toBe('songs-panel')

    clickWithMouse(button('Close Songs'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers to import a MIDI file, by button or by dropping it', () => {
    openPanel()
    expect(button('Import a MIDI file')).toBeTruthy()
    expect(screen.getByText('or drop a MIDI file anywhere on this page')).toBeTruthy()
  })

  it('says that the player has no songs yet, above the starter songs', () => {
    openPanel()
    expect(within(ownSongs()).getByText(EMPTY_LIST)).toBeTruthy()
    expect(titlesIn(ownSongs())).toEqual([])
    expect(messages()).toEqual([])
  })

  it('lists the starter songs with their length and a Play button, and nothing to rename or delete', () => {
    openPanel()
    const rows = within(starterSongs()).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    STARTER_SONGS.forEach((song, index) => {
      const row = within(rows[index] as HTMLElement)
      expect(row.getByText(song.title)).toBeTruthy()
      expect(row.getByText(formatDuration(song.duration))).toBeTruthy()
      expect(row.getByRole('button', { name: `Play ${song.title}` }).textContent).toBe('Play')
      expect(row.getAllByRole('button')).toHaveLength(1)
    })
    expect(titlesIn(starterSongs())[0]).toBe('Twinkle, Twinkle, Little Star')
  })

  it('lists the songs of the player, newest first, each with its length and three buttons', async () => {
    await addSong('First.mid', { notes: [60, 62] })
    await addSong('Second.mid', { notes: [60, 62, 64, 65, 67, 69] })
    openPanel()

    expect(titlesIn(ownSongs())).toEqual(['Second', 'First'])
    expect(within(ownSongs()).queryByText(EMPTY_LIST)).toBeNull()
    const [second, first] = within(ownSongs()).getAllByRole('listitem') as [HTMLElement, HTMLElement]
    expect(within(second).getByText('0:03')).toBeTruthy()
    expect(within(first).getByText('0:01')).toBeTruthy()
    expect(within(first).getAllByRole('button').map((each) => each.textContent)).toEqual([
      'Play',
      'Rename',
      'Delete',
    ])
  })
})

describe('importing', () => {
  it('opens the file picker for MIDI files, several at once, from the button', () => {
    openPanel()
    const field = fileField()
    expect(field.accept).toBe('.mid,.midi,audio/midi,audio/x-midi')
    expect(field.multiple).toBe(true)
    expect(field.hidden).toBe(true)

    const openPicker = vi.spyOn(field, 'click').mockImplementation(() => {})
    clickWithMouse(button('Import a MIDI file'))
    expect(openPicker).toHaveBeenCalledTimes(1)
  })

  it('adds the chosen file to the list and says so', async () => {
    openPanel()
    chooseFiles(songFile('Moonlight.mid'))

    expect(await screen.findByText('"Moonlight" was added.')).toBeTruthy()
    expect(titlesIn(ownSongs())).toEqual(['Moonlight'])
    expect(button('Play Moonlight')).toBeTruthy()
    expect(messages()).toEqual(['"Moonlight" was added.'])
  })

  it.each([
    ['is not a MIDI file', fakeFile('photo.png', new Uint8Array([137, 80, 78, 71])), NOT_MIDI],
    ['is too big', hugeFile('huge.mid'), TOO_BIG],
    ['has no notes', fakeFile('empty.mid', midiBytes()), NO_NOTES],
    ['is of a kind the app does not read', fakeFile('two.mid', unsupportedMidiBytes()), UNSUPPORTED],
    ['is damaged', fakeFile('cut.mid', damagedMidiBytes()), DAMAGED],
  ])('says so when the file %s, and lists nothing new', async (_what, file, sentence) => {
    openPanel()
    chooseFiles(file)

    expect(await screen.findByText(sentence)).toBeTruthy()
    expect(messages()).toEqual([`! ${sentence}`])
    expect(titlesIn(ownSongs())).toEqual([])
    expect(within(ownSongs()).getByText(EMPTY_LIST)).toBeTruthy()
  })

  it('says what to do about something that cannot be read at all, such as a folder', async () => {
    openPanel()
    chooseFiles(unreadableFile('My songs'))

    expect(await screen.findByText(CANNOT_BE_READ)).toBeTruthy()
    expect(messages()).toEqual([`! ${CANNOT_BE_READ}`])
    expect(titlesIn(ownSongs())).toEqual([])
  })

  it('names the folder when it comes with files that are added', async () => {
    openPanel()
    chooseFiles(songFile('One.mid'), unreadableFile('My songs'))

    expect(await screen.findByText('"One" was added.')).toBeTruthy()
    expect(messages()).toEqual(['"One" was added.', `! My songs: ${CANNOT_BE_READ}`])
  })

  it('adds several files at once and counts them', async () => {
    openPanel()
    chooseFiles(songFile('One.mid'), songFile('Two.mid'), songFile('Three.mid'))

    expect(await screen.findByText('3 songs were added.')).toBeTruthy()
    expect(titlesIn(ownSongs()).sort()).toEqual(['One', 'Three', 'Two'])
  })

  it('names each file of several that could not be added, after the count of those that were', async () => {
    openPanel()
    chooseFiles(songFile('One.mid'), fakeFile('notes.txt', new Uint8Array(20)), songFile('Two.mid'))

    expect(await screen.findByText('2 songs were added.')).toBeTruthy()
    expect(messages()).toEqual(['2 songs were added.', `! notes.txt: ${NOT_MIDI}`])
    expect(titlesIn(ownSongs()).sort()).toEqual(['One', 'Two'])
  })

  it('adds the same file again when it is chosen again', async () => {
    openPanel()
    const bytes = midiBytes({ notes: [60] })
    const emptied = vi.spyOn(fileField(), 'value', 'set')
    chooseFiles(fakeFile('Again.mid', bytes))
    await screen.findByText('"Again" was added.')
    // The field is emptied, or the browser would not report the same choice twice.
    expect(emptied.mock.calls).toEqual([['']])

    chooseFiles(fakeFile('Again.mid', bytes))
    await vi.waitFor(() => expect(titlesIn(ownSongs())).toEqual(['Again', 'Again']))
  })

  it('announces the same message again for the next file', async () => {
    openPanel()
    chooseFiles(fakeFile('photo.png', new Uint8Array(4)))
    await screen.findByText(NOT_MIDI)
    const seen: string[] = []
    const observer = new MutationObserver(() => seen.push(messageLine().textContent ?? ''))
    observer.observe(messageLine(), { childList: true, subtree: true })

    chooseFiles(fakeFile('photo.png', new Uint8Array(4)))
    await vi.waitFor(() => expect(seen).toEqual(['', NOT_MIDI]))
    observer.disconnect()
  })

  it('shows what was added before the panel opened, as after a drop on the page', async () => {
    await act(() => importSongFiles([songFile('Dropped.mid')]))
    render(
      <StrictMode>
        <SongsPanel id="songs-panel" onClose={() => {}} />
      </StrictMode>,
    )
    await act(() => Promise.resolve())
    expect(messages()).toEqual(['"Dropped" was added.'])
  })

  it('opens without the message of last time', async () => {
    const first = openPanel()
    chooseFiles(songFile('One.mid'))
    await screen.findByText('"One" was added.')
    first.unmount()
    await act(() => Promise.resolve())

    openPanel()
    expect(messages()).toEqual([])
    expect(titlesIn(ownSongs())).toEqual(['One'])
  })
})

describe('playing a song from the list', () => {
  it('loads the song, starts it and closes the panel', async () => {
    const song = await addSong('Moonlight.mid')
    const { onClose } = openPanel()
    clickWithMouse(button('Play Moonlight'))

    expect(player.getState()).toMatchObject({ status: 'playing', songId: song.id, title: 'Moonlight' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('plays a starter song the same way', () => {
    const { onClose } = openPanel()
    clickWithMouse(button('Play Ode to Joy'))

    expect(player.getState()).toMatchObject({
      status: 'playing',
      songId: 'starter:ode-to-joy',
      title: 'Ode to Joy',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open and says why when the song cannot be read any more', async () => {
    const song = await addSong('Moonlight.mid')
    window.localStorage.removeItem(`pianoapp.song.v1.${song.id}`)
    const { onClose } = openPanel()
    clickWithMouse(button('Play Moonlight'))

    expect(messages()).toEqual([`! ${UNREADABLE_SONG_MESSAGE}`])
    expect(onClose).not.toHaveBeenCalled()
    expect(player.getState().status).toBe('empty')
  })
})

describe('renaming a song', () => {
  async function startRenaming(title = 'Moonlight'): Promise<HTMLInputElement> {
    await addSong(`${title}.mid`)
    openPanel()
    clickWithMouse(button(`Rename ${title}`))
    return screen.getByRole<HTMLInputElement>('textbox', { name: 'Song name' })
  }

  it('turns the title into a text field with the whole name selected, and Save and Cancel', async () => {
    const field = await startRenaming()
    expect(field.value).toBe('Moonlight')
    expect(focused()).toBe(field)
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Moonlight'.length])
    expect(field.maxLength).toBe(80)

    const row = field.closest('li') as HTMLElement
    expect(within(row).getAllByRole('button').map((each) => each.textContent)).toEqual([
      'Save',
      'Cancel',
    ])
  })

  it('saves the new name with Enter', async () => {
    const user = userEvent.setup()
    const field = await startRenaming()
    await user.clear(field)
    await user.type(field, 'Sonata No. 14{Enter}')

    expect(titlesIn(ownSongs())).toEqual(['Sonata No. 14'])
    expect(songLibrary.list()[0]?.title).toBe('Sonata No. 14')
    expect(screen.queryByRole('textbox')).toBeNull()
    // Someone using the keyboard keeps their place in the list.
    expect(focused()).toBe(button('Rename Sonata No. 14'))
  })

  it('keeps the old name with Escape', async () => {
    const user = userEvent.setup()
    const field = await startRenaming()
    await user.type(field, ' in the dark{Escape}')

    expect(titlesIn(ownSongs())).toEqual(['Moonlight'])
    expect(songLibrary.list()[0]?.title).toBe('Moonlight')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(focused()).toBe(button('Rename Moonlight'))
  })

  it('does not let the browser carry Enter or Escape on to the button that gets the focus', async () => {
    const field = await startRenaming()
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)

    clickWithMouse(button('Rename Moonlight'))
    const again = screen.getByRole('textbox', { name: 'Song name' })
    expect(fireEvent.keyDown(again, { key: 'Escape' })).toBe(false)
  })

  it('leaves other keys to the text field', async () => {
    const field = await startRenaming()
    expect(fireEvent.keyDown(field, { key: 'a', code: 'KeyA' })).toBe(true)
    expect(fireEvent.keyDown(field, { key: ' ', code: 'Space' })).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Song name' })).toBe(field)
  })

  it('does not take the Enter that finishes a character typed in several steps', async () => {
    const field = await startRenaming()
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    expect(screen.getByRole('textbox', { name: 'Song name' })).toBe(field)
  })

  it('saves with the Save button and cancels with the Cancel button', async () => {
    const user = userEvent.setup()
    const field = await startRenaming()
    await user.clear(field)
    await user.type(field, 'Sonata')
    await user.click(button('Save'))
    expect(titlesIn(ownSongs())).toEqual(['Sonata'])

    await user.click(button('Rename Sonata'))
    await user.type(screen.getByRole('textbox', { name: 'Song name' }), ' again')
    await user.click(button('Cancel'))
    expect(titlesIn(ownSongs())).toEqual(['Sonata'])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('gives the focus back to Rename when Save or Cancel is pressed with the keyboard, not with the mouse', async () => {
    await startRenaming()
    clickWithKeyboard(button('Cancel'))
    expect(focused()).toBe(button('Rename Moonlight'))

    clickWithMouse(button('Rename Moonlight'))
    clickWithKeyboard(button('Save'))
    expect(focused()).toBe(button('Rename Moonlight'))

    clickWithMouse(button('Rename Moonlight'))
    clickWithMouse(button('Save'))
    expect(focused()).not.toBe(button('Rename Moonlight'))
  })

  it('tidies the name, and calls a song with no name "Untitled song"', async () => {
    const user = userEvent.setup()
    const field = await startRenaming()
    await user.clear(field)
    await user.type(field, '   Clair   de  lune  {Enter}')
    expect(titlesIn(ownSongs())).toEqual(['Clair de lune'])

    await user.click(button('Rename Clair de lune'))
    await user.clear(screen.getByRole('textbox', { name: 'Song name' }))
    await user.keyboard('{Enter}')
    expect(titlesIn(ownSongs())).toEqual(['Untitled song'])
  })

  it('renames the song in the player too, which keeps playing', async () => {
    const user = userEvent.setup()
    await addSong('Moonlight.mid')
    openPanel()
    clickWithMouse(button('Play Moonlight'))
    clickWithMouse(button('Rename Moonlight'))
    const field = screen.getByRole('textbox', { name: 'Song name' })
    await user.clear(field)
    await user.type(field, 'Sonata{Enter}')

    expect(player.getState()).toMatchObject({ status: 'playing', title: 'Sonata' })
  })
})

describe('deleting a song', () => {
  it('asks "Delete?" in the row before deleting anything', async () => {
    await addSong('Moonlight.mid')
    openPanel()
    clickWithMouse(button('Delete Moonlight'))

    const question = screen.getByRole('group', { name: 'Delete Moonlight' })
    expect(question.textContent).toBe('Delete?YesNo')
    expect(titlesIn(ownSongs())).toEqual(['Moonlight'])
    expect(songLibrary.list()).toHaveLength(1)
  })

  it('keeps the song when the answer is No', async () => {
    await addSong('Moonlight.mid')
    openPanel()
    clickWithMouse(button('Delete Moonlight'))
    clickWithMouse(button('No'))

    expect(titlesIn(ownSongs())).toEqual(['Moonlight'])
    expect(screen.queryByText('Delete?')).toBeNull()
    expect(button('Delete Moonlight').textContent).toBe('Delete')
  })

  it('deletes the song when the answer is Yes, and only that song', async () => {
    await addSong('Moonlight.mid')
    await addSong('Sonata.mid')
    openPanel()
    clickWithMouse(button('Delete Moonlight'))
    clickWithMouse(button('Yes'))

    expect(titlesIn(ownSongs())).toEqual(['Sonata'])
    expect(songLibrary.list().map((song) => song.title)).toEqual(['Sonata'])
  })

  it('does not take the second click of a double-click on Delete for a Yes', async () => {
    await addSong('Moonlight.mid')
    openPanel()
    clickWithMouse(button('Delete Moonlight'))
    fireEvent.click(button('Yes'), { detail: 2 })

    expect(titlesIn(ownSongs())).toEqual(['Moonlight'])
    expect(screen.getByText('Delete?')).toBeTruthy()
    clickWithMouse(button('Yes'))
    expect(titlesIn(ownSongs())).toEqual([])
  })

  it('shows the empty-list sentence again after the last song is deleted', async () => {
    await addSong('Moonlight.mid')
    openPanel()
    clickWithMouse(button('Delete Moonlight'))
    clickWithMouse(button('Yes'))
    expect(within(ownSongs()).getByText(EMPTY_LIST)).toBeTruthy()
  })

  it('takes the song out of the player when it is the one that is playing', async () => {
    const song = await addSong('Moonlight.mid')
    openPanel()
    clickWithMouse(button('Play Moonlight'))
    expect(player.getState().songId).toBe(song.id)

    clickWithMouse(button('Delete Moonlight'))
    clickWithMouse(button('Yes'))
    expect(player.getState()).toMatchObject({ status: 'empty', songId: null })
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('puts the computer keys back where they were when the song that moved them is deleted', async () => {
    await addSong('Low.mid', { notes: [36, 38, 40, 41] })
    openPanel()
    clickWithMouse(button('Play Low'))
    expect(settingsStore.get().baseOctave).toBe(1)

    clickWithMouse(button('Delete Low'))
    clickWithMouse(button('Yes'))
    expect(settingsStore.get().baseOctave).toBe(3)
  })

  it('leaves the player alone when another song is deleted', async () => {
    await addSong('Moonlight.mid')
    await addSong('Sonata.mid')
    openPanel()
    clickWithMouse(button('Play Sonata'))
    clickWithMouse(button('Delete Moonlight'))
    clickWithMouse(button('Yes'))

    expect(player.getState()).toMatchObject({ status: 'playing', title: 'Sonata' })
  })

  it('moves the keyboard focus to No, back to Delete after No, and to the import button after Yes', async () => {
    await addSong('Moonlight.mid')
    openPanel()
    clickWithKeyboard(button('Delete Moonlight'))
    expect(focused()).toBe(button('No'))

    clickWithKeyboard(button('No'))
    expect(focused()).toBe(button('Delete Moonlight'))

    clickWithKeyboard(button('Delete Moonlight'))
    clickWithKeyboard(button('Yes'))
    expect(focused()).toBe(button('Import a MIDI file'))
  })

  it('leaves the focus alone when the mouse is used', async () => {
    await addSong('Moonlight.mid')
    openPanel()
    clickWithMouse(button('Delete Moonlight'))
    expect(focused()).not.toBe(button('No'))

    clickWithMouse(button('No'))
    expect(focused()).not.toBe(button('Delete Moonlight'))
  })
})
