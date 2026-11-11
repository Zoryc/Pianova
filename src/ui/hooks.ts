/**
 * The hooks that connect the screen to the app's shared objects (the note
 * bus, the sound engine and the settings).
 */
import { useEffect, useEffectEvent, useSyncExternalStore } from 'react'
import { bus, engine } from '../app/pianoApp'
import { RELEASE_SECONDS } from '../audio/audioEngine'
import type { AudioStatus } from '../audio/audioEngine'
import { slotToMidi } from '../core/layout'
import type { Midi } from '../core/types'
import { attachKeyboardInput } from '../input/keyboardInput'
import { settingsStore } from '../state/settings'
import type { Settings } from '../state/settings'

function subscribeToNotes(onChange: () => void): () => void {
  return bus.subscribe(onChange)
}

function heldNotes(): ReadonlySet<Midi> {
  return bus.getActiveNotes()
}

/** The notes held right now, whatever is holding them. A new set whenever they change. */
export function useActiveNotes(): ReadonlySet<Midi> {
  return useSyncExternalStore(subscribeToNotes, heldNotes, heldNotes)
}

/** Where the sound stands: not started, loading the piano, ready… */
export function useAudioStatus(): AudioStatus {
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus)
}

/** Makes the sound follow the settings: on the first render, then whenever one of them changes. */
export function useSoundSettings(settings: Settings): void {
  const { volume, sustain, transpose, reverb, release } = settings
  useEffect(() => engine.setVolume(volume), [volume])
  useEffect(() => engine.setSustain(sustain), [sustain])
  useEffect(() => engine.setTranspose(transpose), [transpose])
  useEffect(() => engine.setReverb(reverb), [reverb])
  useEffect(() => engine.setRelease(RELEASE_SECONDS[release]), [release])
}

/**
 * Lets go of every held note at the moments one could otherwise get stuck:
 * when the piano moves lower or higher, and when the page is hidden or closed.
 */
export function useNoStuckNotes(baseOctave: number): void {
  // The clean-up runs each time `baseOctave` changes, and when the app goes away.
  useEffect(() => () => bus.allOff(), [baseOctave])

  useEffect(() => {
    const releaseAll = (): void => bus.allOff()
    const releaseIfHidden = (): void => {
      if (document.visibilityState === 'hidden') bus.allOff()
    }
    window.addEventListener('pagehide', releaseAll)
    document.addEventListener('visibilitychange', releaseIfHidden)
    return () => {
      window.removeEventListener('pagehide', releaseAll)
      document.removeEventListener('visibilitychange', releaseIfHidden)
    }
  }, [])
}

/**
 * Connects the computer keyboard to the piano for as long as the app is on
 * screen. The listeners are attached once. They never hold on to old values:
 * notes, velocity and sustain are read from the settings store at the moment
 * a key is pressed, and `intercept` always runs the latest function passed in.
 *
 * `intercept` sees every key press first; when it returns true the press is
 * used up (no note, no sustain change).
 */
export function useKeyboardPiano(intercept: (event: KeyboardEvent) => boolean): void {
  const latestIntercept = useEffectEvent(intercept)

  useEffect(
    () =>
      attachKeyboardInput({
        bus,
        resolveNote: noteForKey,
        intercept: (event) => latestIntercept(event),
        onToggleSustain: toggleSustain,
        getVelocity: currentVelocity,
      }),
    [],
  )
}

/** The note a physical key plays with the current keys and piano position, or null. */
function noteForKey(code: string): Midi | null {
  const { bindings, baseOctave } = settingsStore.get()
  // Own properties only: a key code is never looked up on the object's prototype.
  const slot = Object.hasOwn(bindings, code) ? bindings[code] : undefined
  return slot === undefined ? null : slotToMidi(slot, baseOctave)
}

function toggleSustain(): void {
  settingsStore.set({ sustain: !settingsStore.get().sustain })
}

function currentVelocity(): number {
  return settingsStore.get().velocity
}
