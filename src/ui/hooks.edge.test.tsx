// @vitest-environment jsdom
/**
 * The hooks that make the sound engine follow the settings and report its
 * status to the screen (src/ui/hooks.ts), with the app's real engine object.
 * Audio is never started here, so Tone.js is never loaded.
 */
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bus, engine } from '../app/pianoApp'
import { RELEASE_SECONDS } from '../audio/audioEngine'
import type { AudioStatus } from '../audio/audioEngine'
import { DEFAULT_SETTINGS, settingsStore, useSettings } from '../state/settings'
import type { Settings } from '../state/settings'
import { useAudioStatus, useSoundSettings } from './hooks'

function watchSetters() {
  return {
    setVolume: vi.spyOn(engine, 'setVolume'),
    setSustain: vi.spyOn(engine, 'setSustain'),
    setTranspose: vi.spyOn(engine, 'setTranspose'),
    setReverb: vi.spyOn(engine, 'setReverb'),
    setRelease: vi.spyOn(engine, 'setRelease'),
  }
}

type Setters = ReturnType<typeof watchSetters>

/** The engine was last told exactly what these settings say, for every one of the five sound settings. */
function expectEngineToFollow(setters: Setters, settings: Settings): void {
  expect(setters.setVolume).toHaveBeenLastCalledWith(settings.volume)
  expect(setters.setSustain).toHaveBeenLastCalledWith(settings.sustain)
  expect(setters.setTranspose).toHaveBeenLastCalledWith(settings.transpose)
  expect(setters.setReverb).toHaveBeenLastCalledWith(settings.reverb)
  expect(setters.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS[settings.release])
}

const SAVED: Settings = {
  ...DEFAULT_SETTINGS,
  volume: 0.35,
  sustain: true,
  transpose: -4,
  reverb: 0.6,
  release: 'long',
}

/** What the app does: read the settings, make the sound follow them. */
function SoundFollowsSettings(): JSX.Element {
  useSoundSettings(useSettings())
  return <p>piano</p>
}

beforeEach(() => {
  settingsStore.reset()
})

afterEach(() => {
  cleanup()
  bus.allOff()
  engine.dispose()
  settingsStore.reset()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useSoundSettings', () => {
  it('gives the engine every saved sound setting on the first render, before audio has started', () => {
    const setters = watchSetters()
    renderHook(() => useSoundSettings(SAVED))
    expect(setters.setVolume).toHaveBeenLastCalledWith(0.35)
    expect(setters.setSustain).toHaveBeenLastCalledWith(true)
    expect(setters.setTranspose).toHaveBeenLastCalledWith(-4)
    expect(setters.setReverb).toHaveBeenLastCalledWith(0.6)
    expect(setters.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS.long)
    expect(engine.getStatus()).toBe('idle')
  })

  it('tells the engine about each setting that changes, and leaves the other four as they were', () => {
    const setters = watchSetters()
    const { rerender } = renderHook((settings: Settings) => useSoundSettings(settings), {
      initialProps: SAVED,
    })
    const changes: Partial<Settings>[] = [
      { volume: 0.9 },
      { sustain: false },
      { transpose: 7 },
      { reverb: 0 },
      { release: 'short' },
    ]

    let settings = SAVED
    for (const change of changes) {
      settings = { ...settings, ...change }
      rerender(settings)
      expectEngineToFollow(setters, settings)
    }
  })

  it('leaves the sound as it is when a setting that is not about sound changes', () => {
    const setters = watchSetters()
    const { rerender } = renderHook((settings: Settings) => useSoundSettings(settings), {
      initialProps: SAVED,
    })
    rerender({
      ...SAVED,
      baseOctave: 4,
      labelMode: 'none',
      velocity: 0.2,
      noteNaming: 'solfege',
      showTrails: false,
    })
    expectEngineToFollow(setters, SAVED)
  })

  it('turns each fade-out length into its seconds', () => {
    const setters = watchSetters()
    const { rerender } = renderHook((settings: Settings) => useSoundSettings(settings), {
      initialProps: { ...DEFAULT_SETTINGS, release: 'short' } as Settings,
    })
    expect(setters.setRelease).toHaveBeenLastCalledWith(0.25)
    rerender({ ...DEFAULT_SETTINGS, release: 'normal' })
    expect(setters.setRelease).toHaveBeenLastCalledWith(1)
    rerender({ ...DEFAULT_SETTINGS, release: 'long' })
    expect(setters.setRelease).toHaveBeenLastCalledWith(2.5)
  })

  it('ends up with the right values under StrictMode, which runs every effect twice', () => {
    const setters = watchSetters()
    renderHook(() => useSoundSettings(SAVED), { wrapper: StrictMode })
    expect(setters.setVolume).toHaveBeenLastCalledWith(0.35)
    expect(setters.setSustain).toHaveBeenLastCalledWith(true)
    expect(setters.setTranspose).toHaveBeenLastCalledWith(-4)
    expect(setters.setReverb).toHaveBeenLastCalledWith(0.6)
    expect(setters.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS.long)
  })

  it('follows the settings store: a change, a reset of some keys, a full reset', () => {
    const setters = watchSetters()
    render(<SoundFollowsSettings />)

    act(() => settingsStore.set({ volume: 0.2, sustain: true, transpose: 3, reverb: 1, release: 'short' }))
    expect(setters.setVolume).toHaveBeenLastCalledWith(0.2)
    expect(setters.setSustain).toHaveBeenLastCalledWith(true)
    expect(setters.setTranspose).toHaveBeenLastCalledWith(3)
    expect(setters.setReverb).toHaveBeenLastCalledWith(1)
    expect(setters.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS.short)

    // "Reset advanced settings" leaves the volume and sustain alone.
    act(() => settingsStore.resetKeys(['transpose', 'reverb', 'release']))
    expect(setters.setTranspose).toHaveBeenLastCalledWith(DEFAULT_SETTINGS.transpose)
    expect(setters.setReverb).toHaveBeenLastCalledWith(DEFAULT_SETTINGS.reverb)
    expect(setters.setRelease).toHaveBeenLastCalledWith(RELEASE_SECONDS[DEFAULT_SETTINGS.release])
    expect(setters.setVolume).toHaveBeenLastCalledWith(0.2)
    expect(setters.setSustain).toHaveBeenLastCalledWith(true)

    act(() => settingsStore.reset())
    expect(setters.setVolume).toHaveBeenLastCalledWith(DEFAULT_SETTINGS.volume)
    expect(setters.setSustain).toHaveBeenLastCalledWith(false)
  })

  it('passes on out-of-range values from the store only after the store has cleaned them', () => {
    const setters = watchSetters()
    render(<SoundFollowsSettings />)
    act(() => settingsStore.set({ volume: 7, reverb: -3, transpose: 40.6 }))
    expect(setters.setVolume).toHaveBeenLastCalledWith(1)
    expect(setters.setReverb).toHaveBeenLastCalledWith(0)
    expect(setters.setTranspose).toHaveBeenLastCalledWith(12)
  })

  /**
   * Space switches sustain from a plain window listener, outside React, and
   * in the browser no test helper hurries React along. The engine must hear
   * of the change all the same, without anything else happening on the page.
   * How soon is React's business: the engine copes with a key that is
   * released before it has heard (see 'stops a key released in the same
   * instant as sustain is switched off' in src/App.edge.test.tsx).
   */
  it('tells the engine about a sustain change made outside React, with React left to its own timing', async () => {
    const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const before = reactGlobals.IS_REACT_ACT_ENVIRONMENT
    const setters = watchSetters()
    render(<SoundFollowsSettings />)
    // From here on React schedules its work as it does in the browser.
    reactGlobals.IS_REACT_ACT_ENVIRONMENT = false
    try {
      settingsStore.set({ sustain: true })
      await vi.waitFor(() => expect(setters.setSustain).toHaveBeenLastCalledWith(true))

      settingsStore.set({ sustain: false })
      await vi.waitFor(() => expect(setters.setSustain).toHaveBeenLastCalledWith(false))
    } finally {
      reactGlobals.IS_REACT_ACT_ENVIRONMENT = before
    }
  })
})

describe('useAudioStatus', () => {
  it("is 'idle' until audio has been started", () => {
    const { result } = renderHook(() => useAudioStatus())
    expect(result.current).toBe('idle')
  })

  it('follows the engine through every status and stops listening on unmount', () => {
    let status: AudioStatus = 'idle'
    const listeners = new Set<() => void>()
    vi.spyOn(engine, 'getStatus').mockImplementation(() => status)
    vi.spyOn(engine, 'subscribe').mockImplementation((listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    })
    const change = (next: AudioStatus): void => {
      status = next
      for (const listener of [...listeners]) listener()
    }

    const { result, unmount } = renderHook(() => useAudioStatus())
    expect(result.current).toBe('idle')
    for (const next of ['loading', 'fallback', 'ready', 'error', 'idle'] as const) {
      act(() => change(next))
      expect(result.current).toBe(next)
    }

    unmount()
    expect(listeners.size).toBe(0)
  })
})

describe('the shared objects', () => {
  it('are reachable from the console while developing', () => {
    expect(window.__piano?.engine).toBe(engine)
    expect(window.__piano?.bus).toBe(bus)
    expect(window.__piano?.settingsStore).toBe(settingsStore)
  })
})
