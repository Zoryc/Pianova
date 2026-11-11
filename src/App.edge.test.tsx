// @vitest-environment jsdom
/**
 * The sound of the whole app: real key presses and clicks on one side, what
 * the instruments are asked to play on the other. Everything in between is
 * the real thing (keyboard input, note bus, settings store, the hook that
 * makes the engine follow the settings, the engine itself). Only Tone.js is a
 * stand-in that remembers which notes it was told to start and stop.
 *
 * Keys are sent by physical position: '[KeyA>]' holds the A key down,
 * '[/KeyA]' lets it go and '[KeyA]' taps it. With the default keys A is
 * middle C (C4), S is D4, D is E4.
 */
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  class FakeContext {
    state = 'suspended'
    lookAhead = 0.1
    currentTime = 5
    private readonly waiting: Array<() => void> = []
    /**
     * As in a browser: audio may start only once the page has had a real user
     * gesture. Before that resume() stays pending; it is granted, with every
     * resume() still pending, the next time it is called after a gesture.
     */
    resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          this.waiting.push(resolve)
          if (!world.pageActivated) return
          this.state = 'running'
          for (const granted of this.waiting.splice(0)) granted()
        }),
    )

    immediate(): number {
      return this.currentTime
    }
  }

  class FakeNode {
    disposed = false

    constructor() {
      world.nodes.push(this)
    }

    connect(): this {
      return this
    }

    fan(): this {
      return this
    }

    toDestination(): this {
      world.masters.push(this)
      return this
    }

    dispose(): this {
      this.disposed = true
      return this
    }
  }

  class FakeGain extends FakeNode {
    readonly gain: { value: number; rampTo(value: number): void }

    constructor(gain = 1) {
      super()
      const param = {
        value: gain,
        rampTo(value: number): void {
          param.value = value
        },
      }
      this.gain = param
    }
  }

  class FakeInstrument extends FakeNode {
    protected label = 'instrument'

    triggerAttack(note: string): this {
      if (this.disposed) throw new Error(`${this.label} was already disposed`)
      world.played.push(`${this.label} on ${note}`)
      return this
    }

    triggerRelease(note: string): this {
      if (this.disposed) throw new Error(`${this.label} was already disposed`)
      world.played.push(`${this.label} off ${note}`)
      return this
    }
  }

  class FakePolySynth extends FakeInstrument {
    protected override label = 'synth'

    set(): this {
      return this
    }
  }

  class FakeSampler extends FakeInstrument {
    protected override label = 'piano'
    release = 0.1
    private readonly onload: () => void

    constructor(options: { onload(): void }) {
      super()
      this.onload = options.onload
      world.samplers.push(this)
    }

    finishLoading(): void {
      this.onload()
    }
  }

  const world = {
    context: new FakeContext(),
    nodes: [] as FakeNode[],
    /** The gain nodes wired to the speakers: the master volume. */
    masters: [] as FakeNode[],
    samplers: [] as FakeSampler[],
    /** Notes in the order the instruments were told about them, e.g. 'piano on C4'. */
    played: [] as string[],
    /** Whether the browser has seen a real user gesture on the page yet. */
    pageActivated: true,
  }

  function reset(): void {
    world.context = new FakeContext()
    world.nodes = []
    world.masters = []
    world.samplers = []
    world.played = []
    world.pageActivated = true
  }

  const module = {
    getContext: () => world.context,
    Gain: FakeGain,
    Compressor: FakeNode,
    Reverb: FakeNode,
    PolySynth: FakePolySynth,
    Synth: class {},
    Sampler: FakeSampler,
  }

  return { world, reset, module, FakeGain }
})

vi.mock('tone', () => fake.module)

import { App } from './App'
import { bus, engine } from './app/pianoApp'
import { settingsStore } from './state/settings'

type User = ReturnType<typeof userEvent.setup>

const START_TEXT = 'Click or press any key to start'

beforeAll(() => {
  // jsdom has no canvas and no pointer capture.
  HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext']
  const element = Element.prototype as Partial<Element>
  element.setPointerCapture ??= () => {}
  element.releasePointerCapture ??= () => {}
  element.hasPointerCapture ??= () => false
})

beforeEach(() => {
  fake.reset()
  window.localStorage.clear()
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

function drawApp(): User {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  return userEvent.setup()
}

async function audioIs(status: string): Promise<void> {
  await vi.waitFor(() => expect(engine.getStatus()).toBe(status))
}

/** The app with the overlay gone and audio running on the basic sound (samples still loading). */
async function startApp(): Promise<User> {
  const user = drawApp()
  await user.click(screen.getByText(START_TEXT))
  await audioIs('loading')
  return user
}

/** The app with the sampled piano loaded. */
async function startAppWithPiano(): Promise<User> {
  const user = await startApp()
  act(() => fake.world.samplers.at(-1)?.finishLoading())
  await audioIs('ready')
  return user
}

/** What the footer says about the sound ('' while all is well). */
function soundStatusText(): string {
  return document.querySelector('.app-footer__status')?.textContent ?? ''
}

function masterGain(): number {
  const master = fake.world.masters.at(-1)
  if (!(master instanceof fake.FakeGain)) throw new Error('no master volume was built')
  return master.gain.value
}

describe('from the first key press to the first sound', () => {
  it('builds nothing and resumes nothing before the first click or key press', () => {
    drawApp()
    expect(engine.getStatus()).toBe('idle')
    expect(fake.world.context.resume).not.toHaveBeenCalled()
    expect(fake.world.nodes).toEqual([])
  })

  it('starts audio once on the first key, which stays silent, then plays the next keys', async () => {
    const user = drawApp()
    await user.keyboard('[KeyA]')
    await audioIs('loading')
    expect(fake.world.played).toEqual([])

    await user.keyboard('[KeyA>]')
    expect(fake.world.played).toEqual(['synth on C4'])
    await user.keyboard('[/KeyA]')
    expect(fake.world.played).toEqual(['synth on C4', 'synth off C4'])
    expect(fake.world.context.resume).toHaveBeenCalledTimes(1)
  })

  it('starts audio once, however many keys are hit before it is up', async () => {
    drawApp()
    for (const code of ['KeyA', 'KeyS', 'KeyD', 'KeyF']) {
      fireEvent.keyDown(document.body, { code })
      fireEvent.keyUp(document.body, { code })
    }
    await audioIs('loading')
    expect(fake.world.context.resume).toHaveBeenCalledTimes(1)
    expect(fake.world.nodes.filter((node) => node instanceof fake.module.PolySynth)).toHaveLength(1)
    // Those early keys made no sound, and none of them is left hanging.
    expect(fake.world.played).toEqual([])
    expect(bus.getActiveNotes().size).toBe(0)
  })

  it('moves to the sampled piano when it has loaded, without touching a held note', async () => {
    const user = await startApp()
    await user.keyboard('[KeyA>]')
    act(() => fake.world.samplers.at(-1)?.finishLoading())
    await audioIs('ready')
    await user.keyboard('[KeyS>]')
    await user.keyboard('[/KeyA][/KeyS]')
    expect(fake.world.played).toEqual(['synth on C4', 'piano on D4', 'synth off C4', 'piano off D4'])
  })

  it('says what the sound is doing in the footer, and nothing once the piano is ready', async () => {
    await startApp()
    await vi.waitFor(() => expect(soundStatusText()).toBe('Loading piano sound…'))
    act(() => fake.world.samplers.at(-1)?.finishLoading())
    await vi.waitFor(() => expect(soundStatusText()).toBe(''))
  })

  it('tells the player when audio could not start, and the next key press tries again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fake.world.context.resume.mockRejectedValueOnce(new Error('blocked by the browser'))
    const user = drawApp()
    await user.keyboard('[KeyA]')
    await audioIs('error')
    await vi.waitFor(() =>
      expect(soundStatusText()).toBe('Sound could not start. Click anywhere to try again.'),
    )

    await user.keyboard('[KeyA]')
    await audioIs('loading')
    await user.keyboard('[KeyA>]')
    expect(fake.world.played).toEqual(['synth on C4'])
  })
})

/**
 * Browsers let a page start audio only after a "user activation". The HTML
 * standard says a keydown of the Esc key is not one, and Chrome also leaves
 * out Shift, CapsLock and the other modifier keys. Esc is what many people
 * press to get rid of something that covers the screen.
 */
describe('a first key press that the browser does not count as a user gesture', () => {
  it('still gets the piano playing with the keys pressed right after Escape', async () => {
    fake.world.pageActivated = false
    const user = drawApp()
    await user.keyboard('[Escape]')

    // Every key from here on is a real gesture for the browser.
    fake.world.pageActivated = true
    await user.keyboard('[KeyA]')
    await audioIs('loading')
    await user.keyboard('[KeyA>]')
    expect(fake.world.played.at(-1)).toBe('synth on C4')
  })

  /*
   * Chrome and Edge say whether a click or key press has counted yet
   * (navigator.userActivation; jsdom has none). Asking for sound before one
   * has gets a warning in the console, and an error message on the screen if
   * nothing else is pressed in the next seconds. So the app does not ask.
   */
  describe('in a browser that says whether a gesture has counted', () => {
    const activation = { hasBeenActive: false }

    beforeEach(() => {
      activation.hasBeenActive = false
      Object.defineProperty(navigator, 'userActivation', { configurable: true, value: activation })
    })

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'userActivation')
    })

    it('removes the overlay on Escape without asking for sound, and starts it at the first key that counts', async () => {
      fake.world.pageActivated = false
      const user = drawApp()
      await user.keyboard('[Escape]')
      expect(screen.queryByText(START_TEXT)).toBeNull()
      expect(fake.world.context.resume).not.toHaveBeenCalled()
      expect(engine.getStatus()).toBe('idle')

      activation.hasBeenActive = true
      fake.world.pageActivated = true
      await user.keyboard('[KeyA]')
      await audioIs('loading')
      expect(fake.world.context.resume).toHaveBeenCalledTimes(1)
      await user.keyboard('[KeyA>]')
      expect(fake.world.played).toEqual(['synth on C4'])
    })

    it('starts the sound with a click as well, once it counts', async () => {
      fake.world.pageActivated = false
      const user = drawApp()
      await user.keyboard('[ShiftLeft]')
      expect(fake.world.context.resume).not.toHaveBeenCalled()

      activation.hasBeenActive = true
      fake.world.pageActivated = true
      await user.click(screen.getByRole('button', { name: 'Advanced' }))
      await audioIs('loading')
      expect(fake.world.context.resume).toHaveBeenCalledTimes(1)
    })

    it('starts the sound on the first key press when that one counts', async () => {
      activation.hasBeenActive = true
      const user = drawApp()
      await user.keyboard('[KeyA]')
      await audioIs('loading')
      expect(fake.world.context.resume).toHaveBeenCalledTimes(1)
    })
  })
})

describe('sustain, from the Space key to the instrument', () => {
  it('lets a released key ring on, and stops it when sustain goes off', async () => {
    const user = await startAppWithPiano()
    await user.keyboard('[Space]')
    await user.keyboard('[KeyA]')
    expect(fake.world.played).toEqual(['piano on C4'])

    await user.keyboard('[Space]')
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4'])
  })

  it('keeps a key that is still down sounding when sustain goes off, until it is released', async () => {
    const user = await startAppWithPiano()
    await user.keyboard('[Space]')
    await user.keyboard('[KeyA][KeyS>]')
    await user.keyboard('[Space]')
    expect(fake.world.played).toEqual(['piano on C4', 'piano on D4', 'piano off C4'])

    await user.keyboard('[/KeyS]')
    expect(fake.world.played.at(-1)).toBe('piano off D4')
  })

  it('stops a key released in the same instant as sustain is switched off', async () => {
    const user = await startAppWithPiano()
    await user.keyboard('[Space]')
    await user.keyboard('[KeyA>]')
    expect(fake.world.played).toEqual(['piano on C4'])

    // Two raw browser events back to back, with nothing in between: the key
    // can come up before React has told the engine that sustain went off.
    // Whichever of the two the engine hears first, the note must stop.
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
      )
      document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true }))
    })
    expect(settingsStore.get().sustain).toBe(false)
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4'])
  })

  it('strikes a ringing note again when its key is pressed again', async () => {
    const user = await startAppWithPiano()
    await user.keyboard('[Space]')
    await user.keyboard('[KeyA][KeyA>]')
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4', 'piano on C4'])
  })

  it('applies sustain that was saved as on, from the first note', async () => {
    settingsStore.set({ sustain: true })
    const user = await startAppWithPiano()
    await user.keyboard('[KeyA]')
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it('lets notes ring on when the piano moves higher, and stops them when sustain goes off', async () => {
    const user = await startAppWithPiano()
    await user.keyboard('[Space]')
    await user.keyboard('[KeyA>]')
    await user.click(screen.getByRole('button', { name: /Higher/ }))
    await user.keyboard('[/KeyA]')
    expect(fake.world.played).toEqual(['piano on C4'])

    // The same key now plays an octave higher; the old note is still ringing.
    await user.keyboard('[KeyA]')
    expect(fake.world.played).toEqual(['piano on C4', 'piano on C5'])

    await user.keyboard('[Space]')
    expect(fake.world.played.slice(2).sort()).toEqual(['piano off C4', 'piano off C5'])
  })
})

describe('the other sound settings', () => {
  it('plays transposed from the first note when a transpose was saved', async () => {
    settingsStore.set({ transpose: 2 })
    const user = await startAppWithPiano()
    await user.keyboard('[KeyA]')
    expect(fake.world.played).toEqual(['piano on D4', 'piano off D4'])
  })

  it('releases a held note at the pitch it started on when the transpose changes meanwhile', async () => {
    const user = await startAppWithPiano()
    await user.keyboard('[KeyA>]')
    act(() => settingsStore.set({ transpose: 5 }))
    await user.keyboard('[/KeyA]')
    await user.keyboard('[KeyA]')
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4', 'piano on F4', 'piano off F4'])
  })

  it('builds the master volume from the saved setting, and follows the slider afterwards', async () => {
    settingsStore.set({ volume: 0.5 })
    await startApp()
    expect(masterGain()).toBeCloseTo(0.25, 10)

    act(() => settingsStore.set({ volume: 0 }))
    expect(masterGain()).toBe(0)
    act(() => settingsStore.set({ volume: 1 }))
    expect(masterGain()).toBe(1)
  })

  it('plays as hard as the Touch setting says', async () => {
    const strengths: number[] = []
    const noteOn = vi.spyOn(engine, 'noteOn')
    const user = await startAppWithPiano()
    act(() => settingsStore.set({ velocity: 0.3 }))
    await user.keyboard('[KeyA]')
    act(() => settingsStore.set({ velocity: 1 }))
    await user.keyboard('[KeyA]')
    for (const [, velocity] of noteOn.mock.calls) strengths.push(velocity ?? Number.NaN)
    expect(strengths).toEqual([0.3, 1])
  })
})
