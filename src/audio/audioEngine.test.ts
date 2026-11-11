import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VELOCITY } from '../core/noteBus'
import {
  DEFAULT_SAMPLE_BASE_URL,
  RELEASE_SECONDS,
  createAudioEngine,
  volumeToDb,
} from './audioEngine'
import type { AudioEngine, AudioEngineOptions, AudioStatus } from './audioEngine'

/**
 * A stand-in for Tone.js. Node has no Web Audio, and what matters here is not
 * the sound itself but which notes the engine starts and stops, on which
 * instrument, and when. Only what the engine uses exists: anything else it
 * tried to reach would fail the test.
 */
const fake = vi.hoisted(() => {
  interface SynthOptions {
    voice: unknown
    maxPolyphony: number
    volume: number
    options: {
      oscillator: { type: string; partials: number[] }
      envelope: { attack: number; decay: number; sustain: number; release: number }
    }
  }

  interface SamplerOptions {
    urls: Record<string, string>
    baseUrl: string
    volume: number
    onload(): void
    onerror(error: Error): void
  }

  class FakeContext {
    state = 'suspended'
    lookAhead = 0.1
    currentTime = 12.5
    resume = vi.fn(async () => {
      this.state = 'running'
    })

    immediate(): number {
      return this.currentTime
    }
  }

  class FakeNode {
    /** How often it was disposed: more than once would be a mistake. */
    disposals = 0
    readonly outputs: FakeNode[] = []

    constructor() {
      world.nodes.push(this)
    }

    get disposed(): boolean {
      return this.disposals > 0
    }

    connect(node: FakeNode): this {
      this.outputs.push(node)
      return this
    }

    fan(...nodes: FakeNode[]): this {
      this.outputs.push(...nodes)
      return this
    }

    toDestination(): this {
      this.outputs.push(speakers)
      return this
    }

    dispose(): this {
      this.disposals += 1
      return this
    }
  }

  class FakeSpeakers extends FakeNode {}

  class FakeParam {
    value: number

    constructor(value: number) {
      this.value = value
    }

    rampTo(value: number): this {
      this.value = value
      return this
    }
  }

  class FakeGain extends FakeNode {
    readonly gain: FakeParam

    constructor(gain = 1) {
      super()
      this.gain = new FakeParam(gain)
    }
  }

  class FakeCompressor extends FakeNode {}
  class FakeReverb extends FakeNode {}
  class FakeVoice {}

  class FakeInstrument extends FakeNode {
    readonly attacks: Array<{ note: string; time: number; velocity: number }> = []
    protected label = 'instrument'

    triggerAttack(note: string, time: number, velocity: number): this {
      if (world.notesFail) throw new Error('the instrument failed')
      world.played.push(`${this.label} on ${note}`)
      this.attacks.push({ note, time, velocity })
      return this
    }

    triggerRelease(note: string): this {
      if (world.notesFail) throw new Error('the instrument failed')
      world.played.push(`${this.label} off ${note}`)
      return this
    }
  }

  class FakePolySynth extends FakeInstrument {
    protected override label = 'synth'
    readonly options: SynthOptions
    /** The last release time it was told to use after it was created. */
    release: number | undefined

    constructor(options: SynthOptions) {
      super()
      this.options = options
    }

    set(change: { envelope: { release: number } }): this {
      this.release = change.envelope.release
      return this
    }
  }

  class FakeSampler extends FakeInstrument {
    protected override label = 'piano'
    readonly options: SamplerOptions
    release: number | undefined

    constructor(options: SamplerOptions) {
      super()
      this.options = options
      if (world.samplerCannotBeBuilt) throw new Error('the sampler could not be built')
    }

    /** Every file has arrived. */
    finishLoading(): void {
      this.options.onload()
    }

    /** One file could not be fetched. Tone reports each such file, and then never finishes loading. */
    failLoading(): void {
      this.options.onerror(new Error('offline'))
    }
  }

  const world = {
    context: new FakeContext(),
    /** Every node the engine created, in order. */
    nodes: [] as FakeNode[],
    /** Notes in the order the instruments were told about them, e.g. 'synth on C4'. */
    played: [] as string[],
    /** Makes every instrument throw, as a broken audio system would. */
    notesFail: false,
    samplerCannotBeBuilt: false,
  }

  /** Tone prints a banner in the console when it is loaded, unless a flag is already set by then. */
  const banner = { silencedBeforeLoad: false }

  /** Where sound leaves the graph. It is the browser's, not something the engine creates. */
  const speakers = new FakeSpeakers()

  function reset(): void {
    world.context = new FakeContext()
    world.nodes = []
    world.played = []
    world.notesFail = false
    world.samplerCannotBeBuilt = false
  }

  const module = {
    getContext: () => world.context,
    Gain: FakeGain,
    Compressor: FakeCompressor,
    Reverb: FakeReverb,
    PolySynth: FakePolySynth,
    Synth: FakeVoice,
    Sampler: FakeSampler,
  }

  return {
    world,
    banner,
    speakers,
    reset,
    module,
    FakeGain,
    FakeCompressor,
    FakeReverb,
    FakePolySynth,
    FakeSampler,
  }
})

// Runs when the engine first loads Tone, as Tone's own start-up code would.
vi.mock('tone', () => {
  const flags = globalThis as { TONE_SILENCE_LOGGING?: boolean }
  fake.banner.silencedBeforeLoad = flags.TONE_SILENCE_LOGGING === true
  return fake.module
})

type FakeNode = (typeof fake.world.nodes)[number]

const engines: AudioEngine[] = []

function newEngine(options?: AudioEngineOptions): AudioEngine {
  const engine = createAudioEngine(options)
  engines.push(engine)
  return engine
}

/** Audio is running and the piano samples are still on their way: the basic sound plays. */
async function startedEngine(options?: AudioEngineOptions): Promise<AudioEngine> {
  const engine = newEngine(options)
  await engine.start()
  return engine
}

/** Audio is running and the sampled piano has loaded. */
async function readyEngine(): Promise<AudioEngine> {
  const engine = await startedEngine()
  piano().finishLoading()
  return engine
}

function last<T>(items: readonly T[]): T {
  const item = items.at(-1)
  if (item === undefined) throw new Error('nothing was created')
  return item
}

function nodesOf<T>(kind: new (...args: never[]) => T): T[] {
  return fake.world.nodes.filter((node): node is typeof node & T => node instanceof kind)
}

const synth = () => last(nodesOf(fake.FakePolySynth))
/** Every sampler the engine has asked for, oldest first: one per attempt at loading the piano. */
const pianos = () => nodesOf(fake.FakeSampler)
const piano = () => last(pianos())
const reverb = () => last(nodesOf(fake.FakeReverb))
const compressor = () => last(nodesOf(fake.FakeCompressor))

/** The engine's gain nodes are told apart by what they are wired into. */
function gainInto(node: FakeNode) {
  return last(nodesOf(fake.FakeGain).filter((gain) => gain.outputs.includes(node)))
}
const master = () => gainInto(fake.speakers)
const echoSend = () => gainInto(reverb())
const bus = () => gainInto(echoSend())

function silenceConsoleErrors() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

beforeEach(() => {
  fake.reset()
})

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('volumeToDb', () => {
  it('is silent at 0 and leaves the sound unchanged at 1', () => {
    expect(volumeToDb(0)).toBe(-Infinity)
    expect(volumeToDb(1)).toBe(0)
  })

  it('follows a perceptual curve in between', () => {
    expect(volumeToDb(0.5)).toBeCloseTo(-12.04, 2)
    expect(volumeToDb(0.1)).toBeCloseTo(-40, 5)
  })

  it('gets louder all the way up the slider', () => {
    const steps = [0, 0.01, 0.1, 0.25, 0.5, 0.75, 0.99, 1].map(volumeToDb)
    expect([...steps].sort((a, b) => a - b)).toEqual(steps)
    expect(new Set(steps).size).toBe(steps.length)
  })

  it('clamps out-of-range and non-finite input', () => {
    expect(volumeToDb(-0.5)).toBe(-Infinity)
    expect(volumeToDb(-Infinity)).toBe(-Infinity)
    expect(volumeToDb(Number.NaN)).toBe(-Infinity)
    expect(volumeToDb(1.5)).toBe(0)
    expect(volumeToDb(Infinity)).toBe(0)
  })
})

describe('constants', () => {
  it('gives the seconds for each note fade-out length', () => {
    expect(RELEASE_SECONDS).toEqual({ short: 0.25, normal: 1, long: 2.5 })
  })

  it('loads the Salamander piano by default', () => {
    expect(DEFAULT_SAMPLE_BASE_URL).toBe('https://tonejs.github.io/audio/salamander/')
  })
})

describe('before start()', () => {
  it("is 'idle'", () => {
    expect(newEngine().getStatus()).toBe('idle')
  })

  it('accepts every call without touching audio', () => {
    const engine = newEngine()
    expect(() => {
      engine.noteOn(60)
      engine.noteOn(60, 0.3)
      engine.noteOff(60)
      engine.noteOff(61)
      engine.setSustain(true)
      engine.setSustain(false)
      engine.setVolume(0.4)
      engine.setTranspose(-3)
      engine.setReverb(0.6)
      engine.setRelease(RELEASE_SECONDS.long)
      engine.allNotesOff()
    }).not.toThrow()
    expect(engine.getStatus()).toBe('idle')
    expect(fake.world.context.resume).not.toHaveBeenCalled()
    expect(fake.world.nodes).toEqual([])
  })

  it('accepts nonsense values', () => {
    const engine = newEngine()
    expect(() => {
      engine.noteOn(Number.NaN, Number.NaN)
      engine.noteOff(-1)
      engine.setVolume(Number.NaN)
      engine.setTranspose(Infinity)
      engine.setReverb(-Infinity)
      engine.setRelease(Number.NaN)
    }).not.toThrow()
  })

  it('does not play a note that was pressed before audio started', async () => {
    const engine = newEngine()
    engine.noteOn(60)
    await engine.start()
    engine.noteOff(60)
    expect(fake.world.played).toEqual([])
  })
})

describe('subscribe()', () => {
  it('tells listeners about every status change', async () => {
    const engine = newEngine()
    const seen: AudioStatus[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    await engine.start()
    piano().finishLoading()
    engine.dispose()
    expect(seen).toEqual(['loading', 'ready', 'idle'])
  })

  it('stops telling a listener that unsubscribed', async () => {
    const engine = newEngine()
    const listener = vi.fn()
    const unsubscribe = engine.subscribe(listener)
    unsubscribe()
    unsubscribe()
    await engine.start()
    expect(listener).not.toHaveBeenCalled()
  })

  it('still tells the others when one listener throws', async () => {
    const errors = silenceConsoleErrors()
    const engine = newEngine()
    const listener = vi.fn()
    engine.subscribe(() => {
      throw new Error('broken listener')
    })
    engine.subscribe(listener)
    await engine.start()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(engine.getStatus()).toBe('loading')
    expect(errors).toHaveBeenCalledTimes(1)
  })
})

describe('start()', () => {
  it("starts audio and is 'loading' while the piano samples are fetched", async () => {
    const engine = newEngine()
    await expect(engine.start()).resolves.toBeUndefined()
    expect(engine.getStatus()).toBe('loading')
    expect(fake.world.context.resume).toHaveBeenCalledTimes(1)
  })

  it('removes the delay Tone adds to every note by default', async () => {
    await startedEngine()
    expect(fake.world.context.lookAhead).toBe(0)
  })

  it('shares one attempt between calls made at the same time', async () => {
    const engine = newEngine()
    const first = engine.start()
    const second = engine.start()
    expect(second).toBe(first)
    await Promise.all([first, second])
    expect(fake.world.context.resume).toHaveBeenCalledTimes(1)
    expect(nodesOf(fake.FakePolySynth)).toHaveLength(1)
  })

  it('does nothing more once audio is running', async () => {
    const engine = await startedEngine()
    await engine.start()
    expect(fake.world.context.resume).toHaveBeenCalledTimes(1)
    expect(nodesOf(fake.FakePolySynth)).toHaveLength(1)
    expect(nodesOf(fake.FakeSampler)).toHaveLength(1)
  })

  it('loads Tone.js with its console banner switched off', async () => {
    await startedEngine()
    expect(fake.banner.silencedBeforeLoad).toBe(true)
  })

  it("reports 'error' without rejecting when audio cannot start, then retries", async () => {
    const errors = silenceConsoleErrors()
    fake.world.context.resume.mockRejectedValueOnce(new Error('blocked by the browser'))
    const engine = newEngine()
    await expect(engine.start()).resolves.toBeUndefined()
    expect(engine.getStatus()).toBe('error')
    expect(fake.world.nodes).toEqual([])
    expect(() => engine.noteOn(60)).not.toThrow()
    expect(errors).toHaveBeenCalledTimes(1)

    await engine.start()
    expect(engine.getStatus()).toBe('loading')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])
  })

  it("reports 'error' when the audio context stays paused", async () => {
    silenceConsoleErrors()
    fake.world.context.resume.mockResolvedValueOnce(undefined)
    const engine = newEngine()
    await engine.start()
    expect(engine.getStatus()).toBe('error')
  })

  it("gives up with 'error' when the browser never answers", async () => {
    silenceConsoleErrors()
    vi.useFakeTimers()
    const { resume } = fake.world.context
    resume.mockReturnValueOnce(new Promise<void>(() => {}))
    const engine = newEngine()
    const started = engine.start()
    await vi.waitFor(() => expect(resume).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(60_000)
    await started
    expect(engine.getStatus()).toBe('error')
  })

  it('retries at once, and only once, for a listener that calls start() when it hears of the error', async () => {
    silenceConsoleErrors()
    const { context } = fake.world
    let allow = (): void => {}
    context.resume.mockRejectedValueOnce(new Error('blocked by the browser'))
    context.resume.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        allow = () => {
          context.state = 'running'
          resolve()
        }
      }),
    )
    const engine = newEngine()
    let retry: Promise<void> | undefined
    engine.subscribe(() => {
      if (engine.getStatus() === 'error') retry = engine.start()
    })

    await engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(2))
    expect(engine.getStatus()).toBe('error')

    // The retry is still waiting for the browser: a call made now joins it
    // instead of starting a second sound next to it.
    const joined = engine.start()
    expect(joined).toBe(retry)
    allow()
    await joined
    expect(engine.getStatus()).toBe('loading')
    expect(nodesOf(fake.FakePolySynth)).toHaveLength(1)
    expect(pianos()).toHaveLength(1)
  })
})

/**
 * Browsers allow sound only after a click or a key press, and do not count
 * every key: after Escape or Shift the request to start is simply left
 * unanswered, until the browser is asked again from a click or key it accepts.
 */
describe('a start that is waiting for the browser', () => {
  /** The browser leaves the next request to start unanswered. Returns what makes it answer. */
  function leaveNextRequestWaiting(): () => void {
    const { context } = fake.world
    let allow = (): void => {}
    context.resume.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        allow = () => {
          context.state = 'running'
          resolve()
        }
      }),
    )
    return () => allow()
  }

  it('asks the browser again when start() is called again, which lets the first call through', async () => {
    const { context } = fake.world
    const allowFirstRequest = leaveNextRequestWaiting()
    // Asked again after a real click or key press, the browser grants every request.
    context.resume.mockImplementationOnce(async () => allowFirstRequest())
    const engine = newEngine()
    const first = engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1))
    expect(engine.getStatus()).toBe('idle')

    const second = engine.start()
    expect(second).toBe(first)
    expect(context.resume).toHaveBeenCalledTimes(2)
    await first
    expect(engine.getStatus()).toBe('loading')
    expect(nodesOf(fake.FakePolySynth)).toHaveLength(1)
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])
  })

  it('asks again on every further call until the browser answers', async () => {
    const { context } = fake.world
    const allow = leaveNextRequestWaiting()
    context.resume.mockImplementation(async () => {})
    const engine = newEngine()
    const first = engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1))
    for (let press = 0; press < 3; press += 1) void engine.start()
    expect(context.resume).toHaveBeenCalledTimes(4)
    expect(engine.getStatus()).toBe('idle')

    allow()
    await first
    expect(engine.getStatus()).toBe('loading')
  })

  it('is not disturbed when the browser refuses the second request as well', async () => {
    silenceConsoleErrors()
    vi.useFakeTimers()
    const { context } = fake.world
    context.resume.mockReturnValueOnce(new Promise<void>(() => {}))
    const engine = newEngine()
    const first = engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1))

    const refusal = Promise.reject(new Error('still not allowed'))
    // A refusal nobody handles would show up as an error in the browser console.
    const handled = vi.spyOn(refusal, 'catch')
    context.resume.mockReturnValueOnce(refusal)
    expect(() => void engine.start()).not.toThrow()
    expect(handled).toHaveBeenCalledTimes(1)
    expect(engine.getStatus()).toBe('idle')

    // The first request is still the one that decides: it gives up in its own time.
    await vi.advanceTimersByTimeAsync(60_000)
    await first
    expect(engine.getStatus()).toBe('error')
  })

  it('is forgotten by dispose(): the next start asks the browser itself, once', async () => {
    vi.useFakeTimers()
    const { context } = fake.world
    context.resume.mockReturnValueOnce(new Promise<void>(() => {}))
    const engine = newEngine()
    void engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1))

    engine.dispose()
    await Promise.all([engine.start(), engine.start()])
    expect(context.resume).toHaveBeenCalledTimes(2)
    expect(engine.getStatus()).toBe('loading')
  })

  it('is still asked for again after an earlier start, abandoned by dispose(), has given up', async () => {
    vi.useFakeTimers()
    const { context } = fake.world
    let refuseAbandoned = (): void => {}
    context.resume.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        refuseAbandoned = () => reject(new Error('blocked by the browser'))
      }),
    )
    const allow = leaveNextRequestWaiting()
    context.resume.mockImplementation(async () => {})
    const engine = newEngine()
    const abandoned = engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1))
    engine.dispose()
    const current = engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(2))

    refuseAbandoned()
    await abandoned
    void engine.start()
    expect(context.resume).toHaveBeenCalledTimes(3)

    allow()
    await current
    expect(engine.getStatus()).toBe('loading')
  })
})

describe('the signal path', () => {
  it('sends both instruments straight to the master, with the echo on a side path', async () => {
    await startedEngine()
    expect(synth().outputs).toEqual([bus()])
    expect(piano().outputs).toEqual([bus()])
    expect(bus().outputs).toEqual([compressor(), echoSend()])
    expect(echoSend().outputs).toEqual([reverb()])
    expect(reverb().outputs).toEqual([compressor()])
    expect(compressor().outputs).toEqual([master()])
    expect(master().outputs).toEqual([fake.speakers])
  })

  it('shapes the basic sound like a piano: instant attack, dying away while held', async () => {
    await startedEngine()
    const { envelope } = synth().options.options
    expect(envelope.attack).toBeLessThan(0.02)
    expect(envelope.decay).toBeGreaterThan(1)
    expect(envelope.sustain).toBe(0)
  })

  it('gives the basic sound enough voices for a quick sweep, and no more than a computer can play', async () => {
    await startedEngine()
    const { maxPolyphony } = synth().options
    // Sweeping the 37 keys up, down and up again within three seconds, with
    // the long fade-out, has 94 notes sounding at once. Much beyond 128
    // voices the browser can no longer keep up and everything crackles.
    expect(maxPolyphony).toBeGreaterThanOrEqual(94)
    expect(maxPolyphony).toBeLessThanOrEqual(128)
  })
})

describe('piano samples', () => {
  it('asks for the Salamander recordings, one every minor third from A0 to C8', async () => {
    await startedEngine()
    const { urls, baseUrl } = piano().options
    expect(baseUrl).toBe(DEFAULT_SAMPLE_BASE_URL)
    expect(Object.keys(urls)).toHaveLength(30)
    expect(urls).toMatchObject({
      A0: 'A0.mp3',
      C1: 'C1.mp3',
      'D#1': 'Ds1.mp3',
      'F#1': 'Fs1.mp3',
      A1: 'A1.mp3',
      C4: 'C4.mp3',
      C8: 'C8.mp3',
    })
  })

  it('loads them from the folder it is given', async () => {
    await startedEngine({ sampleBaseUrl: '/sounds/piano' })
    expect(piano().options.baseUrl).toBe('/sounds/piano/')
    await startedEngine({ sampleBaseUrl: 'https://example.test/piano/' })
    expect(piano().options.baseUrl).toBe('https://example.test/piano/')
  })

  it("becomes 'ready' and plays the sampled piano once they have loaded", async () => {
    const engine = await readyEngine()
    expect(engine.getStatus()).toBe('ready')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it("says 'fallback' when they take too long, and still uses them if they arrive", async () => {
    vi.useFakeTimers()
    const engine = await startedEngine()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(engine.getStatus()).toBe('loading')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.getStatus()).toBe('fallback')

    piano().finishLoading()
    expect(engine.getStatus()).toBe('ready')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it("stays 'ready' when the wait runs out after they have loaded", async () => {
    vi.useFakeTimers()
    const engine = await readyEngine()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.getStatus()).toBe('ready')
  })
})

/**
 * One file that fails leaves the whole piano unusable, so the engine asks for
 * the samples again: up to two more times, a few seconds apart.
 */
describe('piano samples that fail to load', () => {
  /** Comfortably longer than the pause between two attempts, and three of them fit in the 30 s wait. */
  const PAST_THE_PAUSE_MS = 8_000

  /** An engine on a clock the test controls, with the first attempt under way. */
  async function loadingEngine(): Promise<AudioEngine> {
    vi.useFakeTimers()
    return startedEngine()
  }

  /** The attempt under way fails, and the pause before the next one goes by. */
  async function failAndWait(): Promise<void> {
    piano().failLoading()
    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
  }

  it("are asked for again a few seconds later, and the status stays 'loading'", async () => {
    const engine = await loadingEngine()
    const first = piano()
    first.failLoading()
    expect(engine.getStatus()).toBe('loading')
    await vi.advanceTimersByTimeAsync(500)
    expect(pianos()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
    expect(pianos()).toHaveLength(2)
    expect(engine.getStatus()).toBe('loading')
    expect(piano().options.urls).toEqual(first.options.urls)
    expect(piano().options.baseUrl).toBe(first.options.baseUrl)
    expect(piano().outputs).toEqual([bus()])
  })

  it('play as the piano as soon as a later attempt succeeds', async () => {
    const engine = await loadingEngine()
    engine.setRelease(RELEASE_SECONDS.long)
    await failAndWait()
    await failAndWait()
    expect(pianos()).toHaveLength(3)

    piano().finishLoading()
    expect(engine.getStatus()).toBe('ready')
    expect(piano().release).toBe(RELEASE_SECONDS.long)
    engine.noteOn(60)
    expect(piano().attacks.map((attack) => attack.note)).toEqual(['C4'])
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it("settle on 'fallback' after the third failed attempt, and are not asked for a fourth time", async () => {
    const engine = newEngine()
    const seen: AudioStatus[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    vi.useFakeTimers()
    await engine.start()
    await failAndWait()
    await failAndWait()
    expect(seen).toEqual(['loading'])

    piano().failLoading()
    expect(seen).toEqual(['loading', 'fallback'])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(pianos()).toHaveLength(3)
    expect(seen).toEqual(['loading', 'fallback'])
    engine.noteOn(60)
    engine.noteOff(60)
    expect(fake.world.played).toEqual(['synth on C4', 'synth off C4'])
  })

  it('count as one failed attempt, however many of the files failed', async () => {
    const engine = await loadingEngine()
    const first = piano()
    for (let file = 0; file < 30; file += 1) first.failLoading()
    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
    expect(pianos()).toHaveLength(2)

    // A slow failure of the first attempt, reported once the second is under way.
    first.failLoading()
    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
    expect(pianos()).toHaveLength(2)
    expect(engine.getStatus()).toBe('loading')
  })

  it('leave the basic sound playing through every attempt', async () => {
    const engine = await loadingEngine()
    engine.noteOn(60)
    piano().failLoading()
    engine.noteOn(62)
    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
    engine.noteOn(64)
    engine.noteOff(60)
    await failAndWait()
    piano().failLoading()
    engine.noteOff(62)
    engine.noteOff(64)
    engine.noteOn(65)
    expect(fake.world.played).toEqual([
      'synth on C4',
      'synth on D4',
      'synth on E4',
      'synth off C4',
      'synth off D4',
      'synth off E4',
      'synth on F4',
    ])
    expect(synth().disposed).toBe(false)
  })

  it('release the sampler of each failed attempt, once', async () => {
    const engine = await loadingEngine()
    const first = piano()
    first.failLoading()
    expect(first.disposals).toBe(1)
    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
    const second = piano()
    second.failLoading()
    expect(second.disposals).toBe(1)
    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
    expect(piano().disposed).toBe(false)
    expect(fake.world.nodes.filter((node) => node.disposed)).toEqual([first, second])

    engine.dispose()
    expect(fake.world.nodes.every((node) => node.disposals === 1)).toBe(true)
  })

  it('ignore an attempt that was given up, even if it reports success after all', async () => {
    const engine = await loadingEngine()
    const first = piano()
    first.failLoading()
    first.finishLoading()
    expect(engine.getStatus()).toBe('loading')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])

    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
    first.finishLoading()
    expect(engine.getStatus()).toBe('loading')
    piano().finishLoading()
    expect(engine.getStatus()).toBe('ready')
    engine.noteOn(64)
    expect(first.attacks).toEqual([])
    expect(fake.world.played).toEqual(['synth on C4', 'piano on E4'])
  })

  it("say 'fallback' when the wait runs out during a later attempt, which is still used if it succeeds", async () => {
    const engine = await loadingEngine()
    await failAndWait()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.getStatus()).toBe('fallback')
    expect(pianos()).toHaveLength(2)

    piano().finishLoading()
    expect(engine.getStatus()).toBe('ready')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it('are not asked for again after dispose()', async () => {
    const engine = await loadingEngine()
    piano().failLoading()
    engine.dispose()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(120_000)
    expect(pianos()).toHaveLength(1)
    expect(engine.getStatus()).toBe('idle')
  })

  it('get three fresh attempts from a new start(), untouched by the attempts of the one before', async () => {
    const engine = await loadingEngine()
    await failAndWait()
    piano().failLoading()
    engine.dispose()
    await engine.start()
    expect(pianos()).toHaveLength(3)

    // The retry that was pending before the dispose never happens.
    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS)
    expect(pianos()).toHaveLength(3)

    await failAndWait()
    await failAndWait()
    expect(pianos()).toHaveLength(5)
    expect(engine.getStatus()).toBe('loading')
    piano().failLoading()
    expect(engine.getStatus()).toBe('fallback')
    expect(pianos().filter((sampler) => !sampler.disposed)).toEqual([])
  })

  it('keep the basic sound, without an uncaught error, if a new attempt cannot even be set up', async () => {
    const errors = silenceConsoleErrors()
    const engine = await loadingEngine()
    piano().failLoading()
    fake.world.samplerCannotBeBuilt = true
    await vi.advanceTimersByTimeAsync(60_000)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(engine.getStatus()).toBe('fallback')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])
  })
})

describe('notes', () => {
  it('start at once, on the basic sound while the piano loads', async () => {
    const engine = await startedEngine()
    engine.noteOn(60, 0.5)
    expect(synth().attacks).toEqual([
      { note: 'C4', time: fake.world.context.currentTime, velocity: 0.5 },
    ])
    expect(piano().attacks).toEqual([])
  })

  it('stop when their key is released', async () => {
    const engine = await startedEngine()
    engine.noteOn(61)
    engine.noteOff(61)
    expect(fake.world.played).toEqual(['synth on C#4', 'synth off C#4'])
  })

  it('use the usual strength when none is given, and keep it between 0 and 1', async () => {
    const engine = await startedEngine()
    engine.noteOn(60)
    engine.noteOn(62, 4)
    engine.noteOn(64, -1)
    engine.noteOn(65, Number.NaN)
    expect(synth().attacks.map((attack) => attack.velocity)).toEqual([
      DEFAULT_VELOCITY,
      1,
      0,
      DEFAULT_VELOCITY,
    ])
  })

  it('are ignored when they are not on a piano', async () => {
    const engine = await startedEngine()
    expect(() => {
      for (const midi of [20, 109, 60.5, Number.NaN, Infinity]) {
        engine.noteOn(midi)
        engine.noteOff(midi)
      }
    }).not.toThrow()
    expect(fake.world.played).toEqual([])
  })

  it('are not stopped twice, or without having been started', async () => {
    const engine = await startedEngine()
    engine.noteOff(60)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.noteOff(60)
    expect(fake.world.played).toEqual(['synth on C4', 'synth off C4'])
  })

  it('start over when a key is struck again before it was released', async () => {
    const engine = await startedEngine()
    engine.noteOn(60)
    engine.noteOn(60)
    engine.noteOff(60)
    expect(fake.world.played).toEqual([
      'synth on C4',
      'synth off C4',
      'synth on C4',
      'synth off C4',
    ])
  })

  it('finish on the instrument that started them when the piano takes over', async () => {
    const engine = await startedEngine()
    engine.noteOn(60)
    piano().finishLoading()
    expect(fake.world.played).toEqual(['synth on C4'])

    engine.noteOn(64)
    engine.noteOff(60)
    engine.noteOff(64)
    expect(fake.world.played).toEqual([
      'synth on C4',
      'piano on E4',
      'synth off C4',
      'piano off E4',
    ])
  })

  it('never throw, even when the instrument does', async () => {
    const errors = silenceConsoleErrors()
    const engine = await startedEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.noteOn(62)
    engine.noteOn(64)

    fake.world.notesFail = true
    expect(() => {
      engine.noteOn(65)
      engine.setSustain(false)
      engine.noteOff(62)
      engine.allNotesOff()
    }).not.toThrow()
    // One failure each: starting F4, then stopping C4 (ringing), D4 (released) and E4 (silenced).
    expect(errors).toHaveBeenCalledTimes(4)
  })
})

describe('sustain', () => {
  it('lets released notes ring on', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it('when turned off, stops the notes that are no longer held and keeps the others', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOn(64)
    engine.noteOff(60)
    engine.setSustain(false)
    expect(fake.world.played).toEqual(['piano on C4', 'piano on E4', 'piano off C4'])

    engine.noteOff(64)
    expect(fake.world.played.at(-1)).toBe('piano off E4')
  })

  it('strikes a ringing note again when its key is pressed again', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4', 'piano on C4'])

    engine.setSustain(false)
    expect(fake.world.played).toHaveLength(3)
    engine.noteOff(60)
    expect(fake.world.played.at(-1)).toBe('piano off C4')
  })

  it('can be turned on before start()', async () => {
    const engine = newEngine()
    engine.setSustain(true)
    await engine.start()
    engine.noteOn(60)
    engine.noteOff(60)
    expect(fake.world.played).toEqual(['synth on C4'])
  })

  it('stops ringing notes on the instrument that started them', async () => {
    const engine = await startedEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    piano().finishLoading()
    engine.noteOn(64)
    engine.noteOff(64)
    engine.setSustain(false)
    expect(fake.world.played).toEqual([
      'synth on C4',
      'piano on E4',
      'synth off C4',
      'piano off E4',
    ])
  })
})

describe('allNotesOff()', () => {
  it('silences held and ringing notes alike', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.noteOn(64)
    engine.allNotesOff()
    expect(fake.world.played).toEqual([
      'piano on C4',
      'piano on E4',
      'piano off C4',
      'piano off E4',
    ])

    engine.noteOff(64)
    engine.setSustain(false)
    engine.allNotesOff()
    expect(fake.world.played).toHaveLength(4)
  })
})

describe('transpose', () => {
  it('shifts the sound of every key', async () => {
    const engine = await readyEngine()
    engine.setTranspose(2)
    engine.noteOn(60)
    engine.setTranspose(-3)
    engine.noteOn(72)
    expect(fake.world.played).toEqual(['piano on D4', 'piano on A4'])
  })

  it('can be set before start()', async () => {
    const engine = newEngine()
    engine.setTranspose(12)
    await engine.start()
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C5'])
  })

  it('stops a note at the pitch it started on, whatever the transpose is by then', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    engine.setTranspose(5)
    engine.noteOff(60)
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4'])
  })

  it('rounds to whole semitones and stays within an octave either way', async () => {
    const engine = await readyEngine()
    const soundOfMiddleC = (semitones: number) => {
      engine.setTranspose(semitones)
      engine.allNotesOff()
      engine.noteOn(60)
      return last(piano().attacks).note
    }
    expect(soundOfMiddleC(1.6)).toBe('D4')
    expect(soundOfMiddleC(40)).toBe('C5')
    expect(soundOfMiddleC(-40)).toBe('C3')
    expect(soundOfMiddleC(Number.NaN)).toBe('C4')
  })

  it('plays nothing for a pitch that falls off the piano', async () => {
    const engine = await readyEngine()
    engine.setTranspose(12)
    engine.noteOn(108)
    engine.noteOff(108)
    engine.setTranspose(-12)
    engine.noteOn(21)
    engine.noteOff(21)
    expect(fake.world.played).toEqual([])
  })

  it('stops the old sound of a key that is struck again after the transpose changed', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.setTranspose(2)
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4', 'piano on D4'])
  })

  it('gives a pitch to the newest key when two keys reach it', async () => {
    const engine = await readyEngine()
    engine.noteOn(62)
    engine.setTranspose(2)
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on D4', 'piano off D4', 'piano on D4'])

    engine.noteOff(62)
    expect(fake.world.played).toHaveLength(3)
    engine.noteOff(60)
    expect(fake.world.played.at(-1)).toBe('piano off D4')
  })
})

describe('volume, room echo and note fade-out', () => {
  it('are remembered when set before start()', async () => {
    const engine = newEngine()
    engine.setVolume(0.5)
    engine.setReverb(0.5)
    engine.setRelease(RELEASE_SECONDS.long)
    await engine.start()
    expect(master().gain.value).toBeCloseTo(10 ** (volumeToDb(0.5) / 20), 10)
    expect(echoSend().gain.value).toBeGreaterThan(0)
    expect(synth().options.options.envelope.release).toBe(RELEASE_SECONDS.long)

    piano().finishLoading()
    expect(piano().release).toBe(RELEASE_SECONDS.long)
  })

  it('start at full volume, with no echo and a normal fade-out', async () => {
    await readyEngine()
    expect(master().gain.value).toBe(1)
    expect(echoSend().gain.value).toBe(0)
    expect(synth().options.options.envelope.release).toBe(RELEASE_SECONDS.normal)
    expect(piano().release).toBe(RELEASE_SECONDS.normal)
  })

  it('follow the volume slider, silent at 0', async () => {
    const engine = await startedEngine()
    engine.setVolume(0)
    expect(master().gain.value).toBe(0)
    engine.setVolume(0.5)
    expect(master().gain.value).toBeCloseTo(0.25, 10)
    engine.setVolume(3)
    expect(master().gain.value).toBe(1)
    engine.setVolume(Number.NaN)
    expect(master().gain.value).toBe(0)
  })

  it('add more echo as the amount goes up, and none at 0', async () => {
    const engine = await startedEngine()
    engine.setReverb(0.5)
    const half = echoSend().gain.value
    engine.setReverb(1)
    const full = echoSend().gain.value
    engine.setReverb(9)
    expect(echoSend().gain.value).toBe(full)
    expect(full).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(0)

    engine.setReverb(0)
    expect(echoSend().gain.value).toBe(0)
    engine.setReverb(Number.NaN)
    expect(echoSend().gain.value).toBe(0)
  })

  it('change the fade-out of both instruments, within 0.05 to 5 seconds', async () => {
    const engine = await readyEngine()
    const fadeOuts = (seconds: number) => {
      engine.setRelease(seconds)
      return [synth().release, piano().release]
    }
    expect(fadeOuts(RELEASE_SECONDS.short)).toEqual([0.25, 0.25])
    expect(fadeOuts(100)).toEqual([5, 5])
    expect(fadeOuts(0)).toEqual([0.05, 0.05])
    expect(fadeOuts(Number.NaN)).toEqual([1, 1])
  })

  it('give the piano the fade-out chosen while it was still loading', async () => {
    const engine = await startedEngine()
    engine.setRelease(RELEASE_SECONDS.short)
    expect(synth().release).toBe(RELEASE_SECONDS.short)
    piano().finishLoading()
    expect(piano().release).toBe(RELEASE_SECONDS.short)
  })
})

describe('an audio context the browser has paused', () => {
  it('is asked to resume on the next key press, which stays silent', async () => {
    const engine = await startedEngine()
    const { context } = fake.world
    context.state = 'suspended'
    context.resume.mockClear()

    engine.noteOn(60)
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(fake.world.played).toEqual([])

    engine.noteOff(60)
    engine.noteOn(62)
    expect(fake.world.played).toEqual(['synth on D4'])
  })

  it('does not break playing when it refuses to resume', async () => {
    const engine = await startedEngine()
    const { context } = fake.world
    context.state = 'suspended'
    const refusal = Promise.reject(new Error('still not allowed'))
    // A refusal nobody handles would show up as an error in the browser console.
    const handled = vi.spyOn(refusal, 'catch')
    context.resume.mockReturnValueOnce(refusal)

    expect(() => engine.noteOn(60)).not.toThrow()
    expect(handled).toHaveBeenCalledTimes(1)
    expect(engine.getStatus()).toBe('loading')
  })
})

describe('dispose()', () => {
  it('releases everything and goes back to idle', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    engine.dispose()
    expect(engine.getStatus()).toBe('idle')
    expect(fake.world.nodes.length).toBeGreaterThan(0)
    expect(fake.world.nodes.every((node) => node.disposed)).toBe(true)
  })

  it('leaves every method harmless', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    engine.dispose()
    fake.world.played.length = 0
    expect(() => {
      engine.noteOff(60)
      engine.noteOn(62)
      engine.noteOff(62)
      engine.setSustain(true)
      engine.setSustain(false)
      engine.setVolume(0.2)
      engine.setTranspose(4)
      engine.setReverb(0.9)
      engine.setRelease(2)
      engine.allNotesOff()
      engine.dispose()
    }).not.toThrow()
    expect(fake.world.played).toEqual([])
    expect(engine.getStatus()).toBe('idle')
  })

  it('while audio is still starting, leaves nothing behind', async () => {
    const { context } = fake.world
    let letAudioStart = (): void => {}
    context.resume.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        letAudioStart = resolve
      }),
    )
    const engine = newEngine()
    const started = engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalled())

    engine.dispose()
    context.state = 'running'
    letAudioStart()
    await started
    expect(engine.getStatus()).toBe('idle')
    expect(fake.world.nodes).toEqual([])
  })

  it('while the piano is loading, ignores the samples when they arrive', async () => {
    vi.useFakeTimers()
    const engine = await startedEngine()
    const loading = piano()
    engine.dispose()
    expect(loading.disposed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    loading.finishLoading()
    loading.failLoading()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.getStatus()).toBe('idle')
  })

  it('lets start() begin afresh, with the settings but none of the old notes', async () => {
    const engine = await readyEngine()
    engine.setTranspose(2)
    engine.noteOn(64)
    engine.dispose()
    fake.world.played.length = 0

    await engine.start()
    expect(engine.getStatus()).toBe('loading')
    expect(nodesOf(fake.FakePolySynth)).toHaveLength(2)
    engine.allNotesOff()
    expect(fake.world.played).toEqual([])

    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on D4'])
  })
})
