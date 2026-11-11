/**
 * The objects the song feature shares, created once when this file is first
 * loaded: the player, which plays a song onto the app's note bus, and the
 * library of saved songs.
 */
import { createSongPlayer } from '../songs/songPlayer'
import type { SongPlayer } from '../songs/songPlayer'
import { bus } from './pianoApp'

// Development only: see the same lines in pianoApp.ts. When this file, or one
// it imports, is edited, a fresh copy of it creates a new player. The copy
// before it is shut down first, so its song never plays on next to the new one.
import.meta.hot?.data.shutDown?.()

export const player: SongPlayer = createSongPlayer({ bus })

export { songLibrary } from '../songs/songLibrary'

if (import.meta.hot) {
  const shutDown = (): void => player.dispose()
  import.meta.hot.data.shutDown = shutDown
  import.meta.hot.dispose(shutDown)
}
