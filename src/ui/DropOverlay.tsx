import { useEffect, useEffectEvent, useState } from 'react'
import type { JSX } from 'react'
import { importSongFiles } from './useSongs'
import './songs.css'

export interface DropOverlayProps {
  /**
   * Files were dropped on the page and are being added as songs: the moment
   * to open the Songs panel, whose message line shows how it went.
   */
  onFilesDropped(): void
}

/**
 * Lets the player drop MIDI files anywhere on the page. While files are being
 * dragged over the page it covers it with "Drop the MIDI file to add it";
 * otherwise it is nothing. Dragged text and links are left alone.
 */
export function DropOverlay({ onFilesDropped }: DropOverlayProps): JSX.Element | null {
  const [dragging, setDragging] = useState(false)
  const filesDropped = useEffectEvent(onFilesDropped)

  useEffect(() => {
    function allowDrop(event: DragEvent): void {
      if (!carriesFiles(event)) return
      // Without this the browser refuses the drop, and opens the file in place of the app.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }

    function hideWhenDragLeavesWindow(event: DragEvent): void {
      // An element when the drag only moved on across the page; nothing when it left the window.
      if (!event.relatedTarget) setDragging(false)
    }

    function addDroppedFiles(event: DragEvent): void {
      if (!carriesFiles(event)) return
      event.preventDefault()
      setDragging(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return
      filesDropped()
      void importSongFiles(files)
    }

    window.addEventListener('dragenter', allowDrop)
    window.addEventListener('dragover', allowDrop)
    window.addEventListener('dragleave', hideWhenDragLeavesWindow)
    window.addEventListener('drop', addDroppedFiles)
    return () => {
      window.removeEventListener('dragenter', allowDrop)
      window.removeEventListener('dragover', allowDrop)
      window.removeEventListener('dragleave', hideWhenDragLeavesWindow)
      window.removeEventListener('drop', addDroppedFiles)
    }
  }, [])

  // The page hears nothing from the mouse while something is dragged over it.
  // So when the mouse moves, a drag has ended that the page was never told
  // about, and the overlay must not stay up.
  useEffect(() => {
    if (!dragging) return
    const hide = (): void => setDragging(false)
    window.addEventListener('pointermove', hide)
    return () => window.removeEventListener('pointermove', hide)
  }, [dragging])

  if (!dragging) return null
  return (
    <div className="drop-overlay">
      <p className="drop-overlay__text">Drop the MIDI file to add it</p>
    </div>
  )
}

/** True for files dragged in from the computer; false for dragged text, links and the like. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}
