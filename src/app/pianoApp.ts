/**
 * The two objects the whole app shares, created once when this file is first
 * loaded: the bus every note passes through, and the sound engine.
 *
 * Inputs (keyboard, mouse) only ever talk to the bus. The one line that turns
 * bus events into sound is here.
 */
import { createAudioEngine } from '../audio/audioEngine'
import type { AudioEngine } from '../audio/audioEngine'
import { NoteBus } from '../core/noteBus'
import { settingsStore } from '../state/settings'
import type { SettingsStore } from '../state/settings'

// Development only. When this file, or one it imports, is edited, Vite loads a
// fresh copy of this file, which creates a new bus and engine. Vite keeps
// `hot.data` from one copy to the next, so each copy leaves its shut-down
// function there (at the end of this file) and the next copy calls it here,
// before creating its own pair: the old engine is never left running.
import.meta.hot?.data.shutDown?.()

export const bus: NoteBus = new NoteBus()
export const engine: AudioEngine = createAudioEngine()

const stopFeedingEngine = bus.subscribe((event) => {
  if (event.type === 'on') engine.noteOn(event.midi, event.velocity)
  else engine.noteOff(event.midi)
})

declare global {
  interface Window {
    /** Development only: the app's shared objects, to try things from the browser console. */
    __piano?: { bus: NoteBus; engine: AudioEngine; settingsStore: SettingsStore }
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__piano = { bus, engine, settingsStore }
}

if (import.meta.hot) {
  const shutDown = (): void => {
    bus.allOff()
    stopFeedingEngine()
    engine.dispose()
  }
  import.meta.hot.data.shutDown = shutDown
  // Vite calls this one itself, but only when no file imports this one any more.
  import.meta.hot.dispose(shutDown)
}
