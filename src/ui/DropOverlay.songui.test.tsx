// @vitest-environment jsdom
/**
 * Dropping files on the page (src/ui/DropOverlay.tsx), one whole drag at a
 * time, the way a browser reports it: in from outside the window, across the
 * page, out, back in, and let go; and the things that are dragged over a page
 * without being files.
 */
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { songLibrary } from '../app/songsApp'
import { DropOverlay } from './DropOverlay'
import { midiBytes, resetSongs, songFile, unreadableFile } from './songsTestKit'
import { useSongMessages } from './useSongs'

const OVERLAY_TEXT = 'Drop the MIDI file to add it'

type DragStep = 'dragEnter' | 'dragOver' | 'dragLeave' | 'drop'

interface Dragged {
  types: string[]
  files: File[]
}

const FILES: Dragged = { types: ['Files'], files: [] }
const TEXT: Dragged = { types: ['text/plain'], files: [] }

/**
 * One step of a drag. `on` is the element under the mouse; `other` is where
 * the mouse came from (dragEnter) or went to (dragLeave): null when that is
 * outside the window.
 */
function drag(step: DragStep, dragged: Dragged, on: Element, other?: Element | null): Event {
  const dataTransfer = { types: dragged.types, files: dragged.files, dropEffect: 'none' }
  const event = createEvent[step](on, { dataTransfer })
  if (other !== undefined) Object.defineProperty(event, 'relatedTarget', { value: other })
  fireEvent(on, event)
  return event
}

function overlay(): HTMLElement | null {
  return screen.queryByText(OVERLAY_TEXT)
}

function titles(): string[] {
  return songLibrary.list().map((song) => song.title)
}

/** The page: two things to drag across, the overlay, and a Songs panel's message line. */
function Page({ onFilesDropped }: { onFilesDropped(): void }) {
  const messages = useSongMessages()
  return (
    <>
      <div data-testid="sky" />
      <div data-testid="piano" />
      <DropOverlay onFilesDropped={onFilesDropped} />
      <ul data-testid="messages">
        {messages.map((message, index) => (
          <li key={index}>{message.text}</li>
        ))}
      </ul>
    </>
  )
}

function drawPage() {
  const onFilesDropped = vi.fn()
  render(<Page onFilesDropped={onFilesDropped} />)
  const sky = screen.getByTestId('sky')
  const piano = screen.getByTestId('piano')
  return { onFilesDropped, sky, piano }
}

function messageLines(): string[] {
  return [...screen.getByTestId('messages').children].map((line) => line.textContent ?? '')
}

beforeEach(resetSongs)

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await resetSongs()
})

describe('one whole drag of a file', () => {
  it('in from outside, across the page, out, back in, and dropped: the overlay follows, the song is added', async () => {
    const { onFilesDropped, sky, piano } = drawPage()

    // In over the sky, from outside the window.
    expect(drag('dragEnter', FILES, sky, null).defaultPrevented).toBe(true)
    expect(overlay()).not.toBeNull()
    expect(drag('dragOver', FILES, sky).defaultPrevented).toBe(true)

    // On to the piano: the browser says "entered the piano" before "left the sky".
    drag('dragEnter', FILES, piano, sky)
    drag('dragLeave', FILES, sky, piano)
    expect(overlay()).not.toBeNull()

    // Out of the window, by the bottom edge.
    drag('dragLeave', FILES, piano, null)
    expect(overlay()).toBeNull()

    // Back in, and let go over the sky.
    drag('dragEnter', FILES, sky, null)
    drag('dragOver', FILES, sky)
    expect(overlay()).not.toBeNull()
    const drop = drag('drop', { types: ['Files'], files: [songFile('Carried.mid')] }, sky)
    expect(drop.defaultPrevented).toBe(true)
    expect(overlay()).toBeNull()
    expect(onFilesDropped).toHaveBeenCalledTimes(1)

    expect(await screen.findByText('"Carried" was added.')).toBeTruthy()
    expect(titles()).toEqual(['Carried'])
  })

  it('that is dropped somewhere else after leaving: nothing is added, nothing is opened', () => {
    const { onFilesDropped, sky } = drawPage()
    drag('dragEnter', FILES, sky, null)
    drag('dragLeave', FILES, sky, null)

    expect(overlay()).toBeNull()
    expect(onFilesDropped).not.toHaveBeenCalled()
    expect(titles()).toEqual([])
    expect(messageLines()).toEqual([])
  })

  it('whose end the page never heard of: the overlay goes at the next movement of the mouse', () => {
    const { onFilesDropped, sky } = drawPage()
    drag('dragEnter', FILES, sky, null)
    expect(overlay()).not.toBeNull()

    // No "left" and no "dropped" ever came. A mouse that moves is not dragging anything.
    fireEvent.pointerMove(sky)
    expect(overlay()).toBeNull()
    expect(onFilesDropped).not.toHaveBeenCalled()
    expect(titles()).toEqual([])
  })
})

describe('what is dragged without being a file', () => {
  it('shows nothing and is left to the browser, also right after a drag of files', () => {
    const { onFilesDropped, sky } = drawPage()
    drag('dragEnter', FILES, sky, null)
    drag('dragLeave', FILES, sky, null)

    expect(drag('dragEnter', TEXT, sky, null).defaultPrevented).toBe(false)
    expect(drag('dragOver', TEXT, sky).defaultPrevented).toBe(false)
    expect(overlay()).toBeNull()
    expect(drag('drop', TEXT, sky).defaultPrevented).toBe(false)
    expect(onFilesDropped).not.toHaveBeenCalled()
  })
})

describe('what is dropped', () => {
  it('is added when it was let go the moment it came in, before the overlay was ever shown', async () => {
    const { onFilesDropped, sky } = drawPage()
    drag('drop', { types: ['Files'], files: [songFile('Fast.mid')] }, sky)

    expect(onFilesDropped).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('"Fast" was added.')).toBeTruthy()
  })

  it('twice in a row gives two songs, and the page is told each time', async () => {
    const { onFilesDropped, sky } = drawPage()
    await act(async () => {
      drag('drop', { types: ['Files'], files: [songFile('One.mid')] }, sky)
      await Promise.resolve()
    })
    expect(await screen.findByText('"One" was added.')).toBeTruthy()
    await act(async () => {
      drag('drop', { types: ['Files'], files: [songFile('Two.mid')] }, sky)
      await Promise.resolve()
    })

    expect(await screen.findByText('"Two" was added.')).toBeTruthy()
    expect(onFilesDropped).toHaveBeenCalledTimes(2)
    expect(titles()).toEqual(['Two', 'One'])
  })

  it('is told apart file by file: a real file, a folder, a text file and a song, together', async () => {
    const { sky } = drawPage()
    const files = [
      new File([Uint8Array.from(midiBytes({ notes: [60, 62] }))], 'Real.mid'),
      // A folder comes as something that cannot be read.
      unreadableFile('My music'),
      new File(['Dear diary'], 'diary.txt'),
      songFile('Kit.mid'),
    ]
    drag('drop', { types: ['Files'], files }, sky)

    expect(await screen.findByText('2 songs were added.')).toBeTruthy()
    expect(messageLines()).toEqual([
      '2 songs were added.',
      // Nothing is wrong with the folder, and the player is told what to do with it.
      'My music: That could not be read. ' +
        'If it is a folder, open it and drop the MIDI files that are in it.',
      'diary.txt: That file is not a MIDI file. MIDI files usually end in .mid or .midi.',
    ])
    expect(titles()).toEqual(['Kit', 'Real'])
  })

  it('is a folder and nothing else: the player reads what to do, and nothing about damage', async () => {
    const { onFilesDropped, sky } = drawPage()
    drag('drop', { types: ['Files'], files: [unreadableFile('My music')] }, sky)

    expect(
      await screen.findByText(
        'That could not be read. If it is a folder, open it and drop the MIDI files that are in it.',
      ),
    ).toBeTruthy()
    expect(messageLines()).toHaveLength(1)
    expect(messageLines()[0]).not.toMatch(/damaged/)
    expect(onFilesDropped).toHaveBeenCalledTimes(1)
    expect(titles()).toEqual([])
  })
})
