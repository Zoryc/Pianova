// @vitest-environment jsdom
/**
 * Dropping files on the page (src/ui/DropOverlay.tsx): when the overlay
 * shows, what it leaves alone, and what a drop does.
 */
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { songLibrary } from '../app/songsApp'
import { DropOverlay } from './DropOverlay'
import { fakeFile, resetSongs, songFile } from './songsTestKit'

const OVERLAY_TEXT = 'Drop the MIDI file to add it'

/** What is being dragged, as the browser describes it to the page. */
interface Dragged {
  types: string[]
  files: File[]
}

const A_FILE: Dragged = { types: ['Files'], files: [] }
const SOME_TEXT: Dragged = { types: ['text/plain'], files: [] }
const A_LINK: Dragged = { types: ['text/uri-list', 'text/plain', 'text/html'], files: [] }

type DragStep = 'dragEnter' | 'dragOver' | 'dragLeave' | 'drop'

/**
 * One step of a drag over the page, on the element under the mouse. Returns
 * the event, which tells whether the page kept the browser from acting on it.
 */
function drag(step: DragStep, dragged: Dragged, movedOnTo?: Element | null): Event {
  const dataTransfer = { types: dragged.types, files: dragged.files, dropEffect: 'none' }
  const event = createEvent[step](document.body, { dataTransfer })
  if (movedOnTo !== undefined) Object.defineProperty(event, 'relatedTarget', { value: movedOnTo })
  fireEvent(document.body, event)
  return event
}

function dropFiles(...files: File[]): Event {
  return drag('drop', { types: ['Files'], files })
}

function overlay(): HTMLElement | null {
  return screen.queryByText(OVERLAY_TEXT)
}

function titles(): string[] {
  return songLibrary.list().map((song) => song.title)
}

function showOverlay() {
  const onFilesDropped = vi.fn()
  const view = render(<DropOverlay onFilesDropped={onFilesDropped} />)
  return { onFilesDropped, ...view }
}

beforeEach(resetSongs)

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await resetSongs()
})

describe('while nothing is dragged', () => {
  it('is not on the page at all', () => {
    const { container } = showOverlay()
    expect(container.innerHTML).toBe('')
  })
})

describe('while files are dragged over the page', () => {
  it('covers the page with "Drop the MIDI file to add it"', () => {
    showOverlay()
    drag('dragEnter', A_FILE)
    expect(overlay()).not.toBeNull()
    expect(overlay()?.closest('.drop-overlay')).not.toBeNull()
  })

  it('tells the browser that the files may be dropped here, as a copy', () => {
    showOverlay()
    const entered = drag('dragEnter', A_FILE)
    const over = drag('dragOver', A_FILE) as DragEvent
    expect(entered.defaultPrevented).toBe(true)
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer?.dropEffect).toBe('copy')
  })

  it('stays while the drag moves from one part of the page to another', () => {
    showOverlay()
    drag('dragEnter', A_FILE)
    drag('dragLeave', A_FILE, document.body)
    // Not even for a moment: it would flicker as the drag crosses the page.
    expect(overlay()).not.toBeNull()
    drag('dragOver', A_FILE)
    expect(overlay()).not.toBeNull()
  })

  it('goes away when the drag leaves the window', () => {
    showOverlay()
    drag('dragEnter', A_FILE)
    drag('dragLeave', A_FILE, null)
    expect(overlay()).toBeNull()
  })

  it('comes back when the drag returns', () => {
    showOverlay()
    drag('dragEnter', A_FILE)
    drag('dragLeave', A_FILE, null)
    drag('dragOver', A_FILE)
    expect(overlay()).not.toBeNull()
  })

  it('goes away when the mouse moves freely again, after a drag whose end the page never heard of', () => {
    showOverlay()
    drag('dragEnter', A_FILE)
    fireEvent.pointerMove(document.body)
    expect(overlay()).toBeNull()
  })
})

describe('dragged text and links', () => {
  it.each([
    ['text', SOME_TEXT],
    ['a link', A_LINK],
  ])('show nothing and are not held back: %s', (_what, dragged) => {
    const { onFilesDropped } = showOverlay()
    const steps = [
      drag('dragEnter', dragged),
      drag('dragOver', dragged),
      drag('drop', dragged),
    ]

    expect(overlay()).toBeNull()
    expect(steps.map((step) => step.defaultPrevented)).toEqual([false, false, false])
    expect(onFilesDropped).not.toHaveBeenCalled()
  })

  it('are not held back by a drag without any description either', () => {
    showOverlay()
    const event = createEvent.dragOver(document.body)
    fireEvent(document.body, event)
    expect(overlay()).toBeNull()
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('dropping files', () => {
  it('adds the file as a song, says that files were dropped, and takes the overlay away', async () => {
    const { onFilesDropped } = showOverlay()
    drag('dragEnter', A_FILE)
    dropFiles(songFile('Moonlight.mid'))

    expect(overlay()).toBeNull()
    expect(onFilesDropped).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(titles()).toEqual(['Moonlight']))
  })

  it('never lets the browser open the dropped file in place of the app', () => {
    showOverlay()
    const notASong = dropFiles(fakeFile('holiday.jpg', new Uint8Array(12)))
    const aSong = dropFiles(songFile('Moonlight.mid'))
    const nothing = dropFiles()
    expect([notASong, aSong, nothing].map((drop) => drop.defaultPrevented)).toEqual([
      true,
      true,
      true,
    ])
  })

  it('adds several files dropped together', async () => {
    const { onFilesDropped } = showOverlay()
    dropFiles(songFile('One.mid'), songFile('Two.mid'))

    expect(onFilesDropped).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(titles().sort()).toEqual(['One', 'Two']))
  })

  it('says nothing when the drop held no file after all', () => {
    const { onFilesDropped } = showOverlay()
    drag('dragEnter', A_FILE)
    dropFiles()
    expect(onFilesDropped).not.toHaveBeenCalled()
    expect(overlay()).toBeNull()
  })

  it('tells the app each time, with the function the app gave it last', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<DropOverlay onFilesDropped={first} />)
    rerender(<DropOverlay onFilesDropped={second} />)
    dropFiles(songFile('One.mid'))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(titles()).toEqual(['One']))
  })
})

describe('when the overlay is taken off the page', () => {
  it('stops listening: files dragged over the page are the browser\'s business again', () => {
    const { unmount, onFilesDropped } = showOverlay()
    unmount()

    const over = drag('dragOver', A_FILE)
    const dropped = dropFiles(songFile('Moonlight.mid'))
    expect(over.defaultPrevented).toBe(false)
    expect(dropped.defaultPrevented).toBe(false)
    expect(onFilesDropped).not.toHaveBeenCalled()
  })

  it('listens once, the way React draws the app in development', async () => {
    const onFilesDropped = vi.fn()
    render(
      <StrictMode>
        <DropOverlay onFilesDropped={onFilesDropped} />
      </StrictMode>,
    )
    await act(async () => {
      dropFiles(songFile('Moonlight.mid'))
    })

    expect(onFilesDropped).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(titles()).toEqual(['Moonlight']))
  })
})
