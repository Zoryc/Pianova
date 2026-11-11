// @vitest-environment jsdom
/**
 * The Songs panel (src/ui/SongsPanel.tsx) in the corners: a very long list,
 * very long names, two songs with the same name, rows that are in the middle
 * of something when the list changes, and real files from the file picker.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus } from '../app/pianoApp'
import { player, songLibrary } from '../app/songsApp'
import { STARTER_SONGS } from '../songs/starterSongs'
import { SongsPanel } from './SongsPanel'
import { addSong, fakeFile, midiBytes, resetSongs, songFile } from './songsTestKit'
import { importSongFiles } from './useSongs'

const NOT_MIDI = 'That file is not a MIDI file. MIDI files usually end in .mid or .midi.'
const UNREADABLE = 'That song could not be read. Delete it and import the MIDI file again.'

function openPanel() {
  const onClose = vi.fn()
  const view = render(<SongsPanel id="songs-panel" onClose={onClose} />)
  return { onClose, ...view }
}

function clickWithMouse(element: HTMLElement): void {
  fireEvent.click(element, { detail: 1 })
}

function chooseFiles(...files: File[]): void {
  const field = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (field === null) throw new Error('The panel has no file field.')
  fireEvent.change(field, { target: { files } })
}

function messages(): string[] {
  const line = document.querySelector('.songs__messages') as HTMLElement
  return [...line.children].map((child) =>
    child.getAttribute('data-problem') === 'true' ? `! ${child.textContent}` : (child.textContent ?? ''),
  )
}

function ownSongs(): HTMLElement {
  return screen.getByRole('region', { name: 'Your songs' })
}

function ownRows(): HTMLElement[] {
  return within(ownSongs()).queryAllByRole('listitem')
}

function titlesShown(): string[] {
  return ownRows().map((row) => row.querySelector('.song-row__title')?.textContent ?? '(busy)')
}

beforeEach(resetSongs)

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await resetSongs()
  bus.allOff()
})

describe('a very long list', () => {
  it('shows three hundred songs, newest first, above the starter songs, and plays the last of them', async () => {
    const files = Array.from({ length: 300 }, (_, index) =>
      fakeFile(`Song ${index + 1}.mid`, midiBytes({ notes: [60 + (index % 12), 62] })),
    )
    const { onClose } = openPanel()
    await act(() => importSongFiles(files))

    expect(messages()).toEqual(['300 songs were added.'])
    const shown = titlesShown()
    expect(shown).toHaveLength(300)
    expect(shown[0]).toBe('Song 300')
    expect(shown[299]).toBe('Song 1')
    const starters = within(screen.getByRole('region', { name: 'Starter songs' })).getAllByRole('listitem')
    expect(starters).toHaveLength(STARTER_SONGS.length)

    clickWithMouse(screen.getByRole('button', { name: 'Play Song 1' }))
    expect(player.getState()).toMatchObject({ status: 'playing', title: 'Song 1' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('very long names', () => {
  it('are shown whole when the mouse rests on them, and never get longer than 80 characters', async () => {
    const longName = 'An evening tune with a name that goes on and on, for much longer than a name should'
    expect(longName.length).toBeGreaterThan(80)
    openPanel()
    await act(() => importSongFiles([songFile(`${longName}.mid`)]))

    const cut = longName.slice(0, 80).trim()
    expect(messages()).toEqual([`"${cut}" was added.`])
    const title = ownRows()[0]?.querySelector<HTMLElement>('.song-row__title')
    expect(title?.textContent).toBe(cut)
    expect(title?.title).toBe(cut)

    clickWithMouse(screen.getByRole('button', { name: `Rename ${cut}` }))
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Song name' })
    expect(field.maxLength).toBe(80)
    // Pasted text can be longer than the field lets anyone type.
    fireEvent.change(field, { target: { value: 'x'.repeat(200) } })
    clickWithMouse(screen.getByRole('button', { name: 'Save' }))
    expect(songLibrary.list()[0]?.title).toBe('x'.repeat(80))
  })

  it('of files that could not be added are written out in the message, one line for each file', async () => {
    openPanel()
    const longFile = `${'very-long-file-name-'.repeat(12)}.txt`
    await act(() =>
      importSongFiles([new File(['hello'], longFile), new File(['hello'], 'short.txt')]),
    )
    expect(messages()).toEqual([`! ${longFile}: ${NOT_MIDI}`, `! short.txt: ${NOT_MIDI}`])
  })
})

describe('two songs with the same name', () => {
  async function addTwins(): Promise<{ older: string; newer: string }> {
    const older = await addSong('Twin.mid', { notes: [60, 62] })
    await act(() => importSongFiles([songFile('Twin.mid', { notes: [72, 74, 76] })]))
    const newer = songLibrary.list().find((song) => song.id !== older.id)
    if (!newer) throw new Error('The second song was not added.')
    return { older: older.id, newer: newer.id }
  }

  it('are two rows, and "Delete" takes away the one whose row it is in', async () => {
    const { older, newer } = await addTwins()
    openPanel()
    expect(titlesShown()).toEqual(['Twin', 'Twin'])

    const lowerRow = ownRows()[1] as HTMLElement
    clickWithMouse(within(lowerRow).getByRole('button', { name: 'Delete Twin' }))
    clickWithMouse(within(lowerRow).getByRole('button', { name: 'Yes' }))

    expect(songLibrary.list().map((song) => song.id)).toEqual([newer])
    expect(songLibrary.get(older)).toBeNull()
    expect(titlesShown()).toEqual(['Twin'])
  })

  it('are played and renamed one by one', async () => {
    const { older, newer } = await addTwins()
    openPanel()
    const [upperRow, lowerRow] = ownRows() as [HTMLElement, HTMLElement]

    clickWithMouse(within(lowerRow).getByRole('button', { name: 'Play Twin' }))
    expect(player.getState().songId).toBe(older)

    clickWithMouse(within(upperRow).getByRole('button', { name: 'Rename Twin' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Song name' }), { target: { value: 'First' } })
    clickWithMouse(screen.getByRole('button', { name: 'Save' }))
    expect(songLibrary.list().map((song) => [song.id, song.title])).toEqual([
      [newer, 'First'],
      [older, 'Twin'],
    ])
    // The song in the player is the other one: it keeps its name.
    expect(player.getState().title).toBe('Twin')
  })
})

describe('a row that is in the middle of something', () => {
  it('keeps its question when a new song arrives above it, and "Yes" still deletes the right song', async () => {
    await addSong('Older.mid')
    await addSong('Old.mid')
    openPanel()
    clickWithMouse(screen.getByRole('button', { name: 'Delete Old' }))
    expect(screen.getByRole('group', { name: 'Delete Old' })).toBeTruthy()

    await act(() => importSongFiles([songFile('Brand new.mid')]))
    expect(songLibrary.list().map((song) => song.title)).toEqual(['Brand new', 'Old', 'Older'])
    const question = screen.getByRole('group', { name: 'Delete Old' })
    expect(ownRows()[1]?.contains(question)).toBe(true)

    clickWithMouse(within(question).getByRole('button', { name: 'Yes' }))
    expect(songLibrary.list().map((song) => song.title)).toEqual(['Brand new', 'Older'])
  })

  it('keeps the name being typed when another song is deleted or added', async () => {
    await addSong('Keep.mid')
    await addSong('Drop.mid')
    openPanel()
    clickWithMouse(screen.getByRole('button', { name: 'Rename Keep' }))
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Song name' })
    fireEvent.change(field, { target: { value: 'Half typed' } })

    clickWithMouse(screen.getByRole('button', { name: 'Delete Drop' }))
    clickWithMouse(screen.getByRole('button', { name: 'Yes' }))
    await act(() => importSongFiles([songFile('Brand new.mid')]))

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Song name' }).value).toBe('Half typed')
    clickWithMouse(screen.getByRole('button', { name: 'Save' }))
    expect(songLibrary.list().map((song) => song.title)).toEqual(['Brand new', 'Half typed'])
  })

  it('cannot be played or deleted by accident while its name is being typed', async () => {
    await addSong('Mine.mid')
    openPanel()
    clickWithMouse(screen.getByRole('button', { name: 'Rename Mine' }))

    const row = ownRows()[0] as HTMLElement
    expect(within(row).getAllByRole('button').map((control) => control.textContent)).toEqual([
      'Save',
      'Cancel',
    ])
  })

  it('goes back to rest when the panel is closed and opened again: nothing is deleted or renamed', async () => {
    await addSong('Mine.mid')
    const { unmount } = openPanel()
    clickWithMouse(screen.getByRole('button', { name: 'Delete Mine' }))
    unmount()

    openPanel()
    expect(screen.queryByText('Delete?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Mine' })).toBeTruthy()
    expect(songLibrary.list().map((song) => song.title)).toEqual(['Mine'])
  })
})

describe('the keyboard in the list', () => {
  it('goes row by row: Play, Rename, Delete, then the next song', async () => {
    await addSong('Second.mid')
    await addSong('First.mid')
    openPanel()
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Import a MIDI file' }).focus()

    const visited: (string | null)[] = []
    for (let count = 0; count < 7; count += 1) {
      await user.tab()
      visited.push(document.activeElement?.getAttribute('aria-label') ?? null)
    }
    expect(visited).toEqual([
      'Play First',
      'Rename First',
      'Delete First',
      'Play Second',
      'Rename Second',
      'Delete Second',
      `Play ${STARTER_SONGS[0]?.title}`,
    ])
  })

  it('has "No" under the finger when "Delete?" is asked, with "Yes" one step back', async () => {
    await addSong('Mine.mid')
    openPanel()
    const user = userEvent.setup()
    const remove = screen.getByRole('button', { name: 'Delete Mine' })
    remove.focus()
    fireEvent.click(remove, { detail: 0 })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'No' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes' }))
    // Nothing was deleted by walking about.
    expect(songLibrary.list().map((song) => song.title)).toEqual(['Mine'])
  })
})

describe('files from the file picker', () => {
  it('are read as the browser hands them over: real files, not stand-ins', async () => {
    openPanel()
    const bytes = Uint8Array.from(midiBytes({ notes: [60, 64, 67] }))
    const real = new File([bytes], 'Real one.mid', { type: 'audio/midi' })
    chooseFiles(real)

    expect(await screen.findByText('"Real one" was added.')).toBeTruthy()
    expect(titlesShown()).toEqual(['Real one'])
    expect(songLibrary.list()[0]).toMatchObject({ noteCount: 3, duration: 1.5 })
  })

  it('leave the message alone when the picker is closed without choosing anything', async () => {
    openPanel()
    chooseFiles(songFile('One.mid'))
    expect(await screen.findByText('"One" was added.')).toBeTruthy()

    chooseFiles()
    await act(() => Promise.resolve())
    expect(messages()).toEqual(['"One" was added.'])
  })

  it('say "not a MIDI file" for an empty file and for a picture, and add neither', async () => {
    openPanel()
    const picture = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], 'holiday.png')
    chooseFiles(new File([], 'empty.mid'), picture)

    expect(await screen.findByText(`empty.mid: ${NOT_MIDI}`)).toBeTruthy()
    expect(messages()).toEqual([`! empty.mid: ${NOT_MIDI}`, `! holiday.png: ${NOT_MIDI}`])
    expect(songLibrary.list()).toEqual([])
    expect(screen.getByText('No songs of your own yet. Import a MIDI file to add one.')).toBeTruthy()
  })
})

describe('a song whose saved notes are gone', () => {
  it('says so once however often "Play" is pressed, and can still be deleted', async () => {
    const song = await addSong('Lost.mid')
    window.localStorage.removeItem(`pianoapp.song.v1.${song.id}`)
    // Another song is read, so that the library no longer has the lost one at hand.
    const other = await addSong('Other.mid')
    songLibrary.get(other.id)
    const { onClose } = openPanel()

    clickWithMouse(screen.getByRole('button', { name: 'Play Lost' }))
    clickWithMouse(screen.getByRole('button', { name: 'Play Lost' }))
    expect(messages()).toEqual([`! ${UNREADABLE}`])
    expect(onClose).not.toHaveBeenCalled()
    expect(player.getState().status).toBe('empty')

    clickWithMouse(screen.getByRole('button', { name: 'Delete Lost' }))
    clickWithMouse(screen.getByRole('button', { name: 'Yes' }))
    expect(titlesShown()).toEqual(['Other'])
  })
})
