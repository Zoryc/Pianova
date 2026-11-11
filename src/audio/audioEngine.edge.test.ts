/**
 * Edge cases of the sound engine: the unhappy paths, the races and the long
 * sessions that the main test file does not walk through.
 *
 * Tone.js is replaced by a stand-in, as in audioEngine.test.ts, but this one
 * keeps a little more of Tone's real behaviour (read from
 * node_modules/tone/build/esm), because that is where a call that type-checks
 * can still do the wrong thing:
 *
 * - PolySynth has a fixed number of voices (`maxPolyphony`). A voice stays
 *   busy until its oscillator stops: `release` seconds after triggerRelease,
 *   or attack + decay seconds after the attack when the envelope's sustain is
 *   0. With every voice busy the note is dropped (Tone prints "Max polyphony
 *   exceeded. Note dropped.").
 * - triggerRelease on a PolySynth releases one voice of that note; on a
 *   Sampler it stops every source of that note.
 * - A Sampler cannot play before its samples have loaded (it throws).
 * - An instrument that was disposed throws when it is used.
 * - `time` arguments are absolute seconds on the context's clock. A call
 *   without one is carried out at Tone's "now": the clock plus the look-ahead.
 *
 * The stand-in also keeps a list of every call an instrument could not have
 * carried out (`misuses`), so the tests do not depend on what the engine
 * prints when such a call fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toneName } from '../core/notes'
import { RELEASE_SECONDS, createAudioEngine, volumeToDb } from './audioEngine'
import type { AudioEngine, AudioEngineOptions, AudioStatus } from './audioEngine'

const fake = vi.hoisted(() => {
  interface Envelope {
    attack: number
    decay: number
    sustain: number
    release: number
  }

  interface SynthOptions {
    voice: unknown
    maxPolyphony?: number
    volume?: number
    options: { oscillator: unknown; envelope: Envelope }
  }

  interface SamplerOptions {
    urls: Record<string, string>
    baseUrl: string
    volume?: number
    onload(): void
    onerror(error: Error): void
  }

  /** One call into an instrument, with the clock at that moment. */
  interface Trigger {
    what: string
    /** When the instrument carries the call out: the `time` the engine passed, or Tone's "now" when it passed none. */
    time: number
    /** The context's clock when the call was made. */
    clock: number
    velocity?: number
  }

  class FakeContext {
    state = 'suspended'
    lookAhead = 0.1
    currentTime = 100
    resume = vi.fn(async () => {
      this.state = 'running'
    })

    immediate(): number {
      return this.currentTime
    }

    now(): number {
      return this.currentTime + this.lookAhead
    }
  }

  class FakeNode {
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
    /** Every glide asked for: the target and how long it takes. */
    readonly ramps: Array<{ value: number; seconds: number }> = []

    constructor(value: number) {
      this.value = value
    }

    rampTo(value: number, seconds: number): this {
      this.ramps.push({ value, seconds })
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
    protected label = 'instrument'

    /** Notes the call down and returns when it is carried out. */
    protected record(action: 'on' | 'off', note: string, time: number | undefined, velocity?: number): number {
      const what = `${this.label} ${action} ${note}`
      if (this.disposed) throw this.misuse(`${what}, after the instrument was disposed`)
      if (world.notesFail) throw new Error('the instrument failed')
      const when = time ?? world.context.now()
      world.played.push(what)
      world.triggers.push({ what, time: when, clock: world.context.currentTime, velocity })
      return when
    }

    protected misuse(what: string): Error {
      world.misuses.push(what)
      return new Error(what)
    }
  }

  class FakePolySynth extends FakeInstrument {
    protected override label = 'synth'
    readonly maxPolyphony: number
    readonly envelope: Envelope
    /** Notes that found no free voice, in the order they were asked for. */
    readonly dropped: string[] = []
    /** Notes started and not yet released, whether or not they have died away by themselves. */
    readonly unreleased: string[] = []
    private busy: Array<{ note: string; released: boolean; freeAt: number }> = []

    constructor(options: SynthOptions) {
      super()
      this.maxPolyphony = options.maxPolyphony ?? 32
      this.envelope = { ...options.options.envelope }
    }

    private busyAt(time: number): Array<{ note: string; released: boolean; freeAt: number }> {
      this.busy = this.busy.filter((voice) => voice.freeAt > time)
      return this.busy
    }

    /** How many voices are in use at the context's current time. */
    voicesInUse(): number {
      return this.busyAt(world.context.currentTime).length
    }

    triggerAttack(note: string, time: number | undefined, velocity: number): this {
      const when = this.record('on', note, time, velocity)
      const busy = this.busyAt(when)
      if (busy.length >= this.maxPolyphony) {
        this.dropped.push(note)
        return this
      }
      const { attack, decay, sustain } = this.envelope
      busy.push({ note, released: false, freeAt: sustain === 0 ? when + attack + decay : Infinity })
      this.unreleased.push(note)
      return this
    }

    triggerRelease(note: string, time?: number): this {
      const when = this.record('off', note, time)
      const voice = this.busyAt(when).find((candidate) => candidate.note === note && !candidate.released)
      if (voice) {
        voice.released = true
        voice.freeAt = Math.min(voice.freeAt, when + this.envelope.release)
      }
      const index = this.unreleased.indexOf(note)
      if (index !== -1) this.unreleased.splice(index, 1)
      return this
    }

    set(change: { envelope?: Partial<Envelope> }): this {
      Object.assign(this.envelope, change.envelope)
      return this
    }
  }

  class FakeSampler extends FakeInstrument {
    protected override label = 'piano'
    readonly options: SamplerOptions
    /** Tone's own default until the engine sets it. */
    release = 0.1
    loaded = false
    /** Notes started and not yet released. */
    unreleased: string[] = []

    constructor(options: SamplerOptions) {
      super()
      this.options = options
      if (world.samplerCannotBeBuilt) throw new Error('the sampler could not be built')
    }

    triggerAttack(note: string, time: number | undefined, velocity: number): this {
      if (!this.loaded) throw this.misuse(`piano on ${note}, before its samples had loaded`)
      this.record('on', note, time, velocity)
      this.unreleased.push(note)
      return this
    }

    triggerRelease(note: string, time?: number): this {
      this.record('off', note, time)
      this.unreleased = this.unreleased.filter((sounding) => sounding !== note)
      return this
    }

    finishLoading(): void {
      this.loaded = true
      this.options.onload()
    }

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
    triggers: [] as Trigger[],
    /** Calls no instrument could have carried out: a disposed one, or a sampler without its samples. */
    misuses: [] as string[],
    /** Makes every instrument throw, as a broken audio system would. */
    notesFail: false,
    samplerCannotBeBuilt: false,
  }

  /** Where sound leaves the graph. It is the browser's, not something the engine creates. */
  const speakers = new FakeSpeakers()

  function reset(): void {
    world.context = new FakeContext()
    world.nodes = []
    world.played = []
    world.triggers = []
    world.misuses = []
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

vi.mock('tone', () => fake.module)

type FakeNode = (typeof fake.world.nodes)[number]

const engines: AudioEngine[] = []

function newEngine(options?: AudioEngineOptions): AudioEngine {
  const engine = createAudioEngine(options)
  engines.push(engine)
  return engine
}

/** Audio is running and the piano samples are still on their way: the basic sound plays. */
async function startedEngine(): Promise<AudioEngine> {
  const engine = newEngine()
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

const synths = () => nodesOf(fake.FakePolySynth)
const pianos = () => nodesOf(fake.FakeSampler)
const synth = () => last(synths())
const piano = () => last(pianos())
const reverb = () => last(nodesOf(fake.FakeReverb))
const compressor = () => last(nodesOf(fake.FakeCompressor))

function gainInto(node: FakeNode) {
  return last(nodesOf(fake.FakeGain).filter((gain) => gain.outputs.includes(node)))
}
const master = () => gainInto(fake.speakers)
const echoSend = () => gainInto(reverb())
const bus = () => gainInto(echoSend())

/** Every note that was started and not yet stopped, on either instrument, lowest first. */
function ringing(): string[] {
  const notes = [...synths(), ...pianos()].flatMap((instrument) => instrument.unreleased)
  return notes.sort()
}

function names(...midis: number[]): string[] {
  return midis.map(toneName).sort()
}

function passSeconds(seconds: number): void {
  fake.world.context.currentTime += seconds
}

function silenceConsoleErrors() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

/** Lets every pending promise callback run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

/**
 * How long the engine waits for something, and how often it tries again, is
 * its own business. A test that only needs "until the engine has stopped
 * waiting" puts the engine on a clock it controls (`vi.useFakeTimers()`
 * before start()) and lets that clock run on to whatever the engine is
 * waiting for next, instead of naming a number of seconds.
 */
async function runToNextWait(): Promise<void> {
  if (vi.getTimerCount() === 0) throw new Error('the engine is not waiting for anything')
  await vi.advanceTimersToNextTimerAsync()
}

/** The samples are neither refused nor delivered: time goes by until the engine stops waiting for them. */
async function waitWhileLoading(engine: AudioEngine): Promise<void> {
  while (engine.getStatus() === 'loading') await runToNextWait()
}

/**
 * The samples cannot be had: every attempt the engine makes at loading them
 * fails (`failedFiles` files each time), until it gives up on them.
 */
async function failSamplesForGood(engine: AudioEngine, failedFiles = 1): Promise<void> {
  while (engine.getStatus() === 'loading') {
    const attempt = piano()
    for (let file = 0; file < failedFiles; file += 1) attempt.failLoading()
    if (engine.getStatus() === 'loading') await runToNextWait()
  }
}

/** A small repeatable random number generator (mulberry32). */
function randomSource(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

beforeEach(() => {
  fake.reset()
})

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sustain bookkeeping', () => {
  it('keeps a note that was held when sustain was switched on, until sustain goes off', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    engine.setSustain(true)
    engine.noteOff(60)
    expect(ringing()).toEqual(names(60))

    engine.setSustain(false)
    expect(ringing()).toEqual([])
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4'])
  })

  it('never lets one key ring twice, however often it is pressed again while ringing', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    for (let press = 0; press < 25; press += 1) {
      engine.noteOn(60)
      expect(ringing()).toEqual(names(60))
      engine.noteOff(60)
      expect(ringing()).toEqual(names(60))
    }
    expect(fake.world.played.filter((entry) => entry === 'piano on C4')).toHaveLength(25)
    expect(fake.world.played.filter((entry) => entry === 'piano off C4')).toHaveLength(24)

    engine.setSustain(false)
    expect(ringing()).toEqual([])
  })

  it('when switched off with keys still down, stops only the keys that were let go', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    for (const key of [60, 62, 64, 65, 67]) engine.noteOn(key)
    engine.noteOff(62)
    engine.noteOff(65)

    engine.setSustain(false)
    expect(ringing()).toEqual(names(60, 64, 67))

    // The keys still down now stop the moment they are released.
    engine.noteOff(60)
    expect(ringing()).toEqual(names(64, 67))
    engine.noteOff(64)
    engine.noteOff(67)
    expect(ringing()).toEqual([])
  })

  it('does not stop a key that was let go and pressed again before sustain went off', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.noteOn(60)
    engine.setSustain(false)
    expect(ringing()).toEqual(names(60))
    engine.noteOff(60)
    expect(ringing()).toEqual([])
  })

  it('switching sustain off twice, or off when it was never on, stops nothing that is held', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    engine.setSustain(false)
    engine.setSustain(false)
    expect(ringing()).toEqual(names(60))
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it('allNotesOff with sustain on silences held and ringing notes, and nothing is stopped twice later', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.noteOn(64)
    engine.noteOn(67)
    engine.allNotesOff()
    expect(ringing()).toEqual([])
    const stops = fake.world.played.filter((entry) => entry.includes(' off ')).length
    expect(stops).toBe(3)

    // The fingers come up afterwards, then sustain goes off: nothing is left to stop.
    engine.noteOff(64)
    engine.noteOff(67)
    engine.setSustain(false)
    engine.allNotesOff()
    expect(fake.world.played.filter((entry) => entry.includes(' off ')).length).toBe(stops)
  })

  it('still sustains the next notes after allNotesOff', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.allNotesOff()
    engine.noteOn(60)
    engine.noteOff(60)
    expect(ringing()).toEqual(names(60))
  })

  it('a key that was down during allNotesOff plays normally the next time', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    engine.allNotesOff()
    engine.noteOff(60)
    engine.noteOn(60)
    expect(ringing()).toEqual(names(60))
    engine.noteOff(60)
    expect(ringing()).toEqual([])
  })
})

describe('transpose bookkeeping', () => {
  it('releases every note of a chord at the pitch it started on while the transpose keeps changing', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    engine.setTranspose(3)
    engine.noteOn(64)
    engine.setTranspose(-5)
    engine.noteOn(67)
    expect(fake.world.played).toEqual(['piano on C4', 'piano on G4', 'piano on D4'])

    engine.setTranspose(12)
    engine.noteOff(64)
    engine.noteOff(60)
    engine.noteOff(67)
    expect(fake.world.played.slice(3)).toEqual(['piano off G4', 'piano off C4', 'piano off D4'])
    expect(ringing()).toEqual([])
  })

  it('does not touch sounding notes when the transpose changes', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    engine.noteOn(64)
    const before = [...fake.world.played]
    for (const semitones of [1, -1, 12, -12, 0]) engine.setTranspose(semitones)
    expect(fake.world.played).toEqual(before)
  })

  /*
   * Changing the transpose while notes ring can bring two keys to the same
   * pitch. Which of them the pitch then belongs to is the engine's own choice
   * (its own test file describes it). What must hold either way: only that
   * pitch is ever started or stopped, and nothing is left ringing in the end.
   */
  it('leaves nothing ringing after three keys reached the same pitch one after the other', async () => {
    const engine = await readyEngine()
    engine.noteOn(64)
    engine.setTranspose(2)
    engine.noteOn(62)
    engine.setTranspose(4)
    engine.noteOn(60)
    expect(new Set(ringing())).toEqual(new Set(names(64)))

    engine.noteOff(64)
    engine.noteOff(62)
    engine.noteOff(60)
    expect(ringing()).toEqual([])
    expect(new Set(fake.world.played)).toEqual(new Set(['piano on E4', 'piano off E4']))
  })

  it('leaves nothing ringing on either instrument after the piano took up a pitch still ringing on the basic sound', async () => {
    const engine = await startedEngine()
    engine.setSustain(true)
    engine.noteOn(62)
    engine.noteOff(62)
    piano().finishLoading()
    engine.setTranspose(2)
    engine.noteOn(60)
    expect(fake.world.played).toContain('piano on D4')
    expect(new Set(ringing())).toEqual(new Set(names(62)))

    engine.noteOff(60)
    engine.setSustain(false)
    expect(ringing()).toEqual([])
    expect(new Set(fake.world.played)).toEqual(
      new Set(['synth on D4', 'synth off D4', 'piano on D4', 'piano off D4']),
    )
  })

  it('plays nothing when a ringing key is pressed again after its pitch fell off the piano, and still stops its old note', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(100)
    engine.noteOff(100)
    engine.setTranspose(12)
    engine.noteOn(100)
    expect(fake.world.played.filter((entry) => entry.includes(' on '))).toEqual(['piano on E7'])

    engine.noteOff(100)
    engine.setSustain(false)
    expect(ringing()).toEqual([])
    engine.allNotesOff()
    expect(fake.world.played).toEqual(['piano on E7', 'piano off E7'])
  })

  it('plays the very top and bottom notes of a piano, and nothing one step beyond', async () => {
    const engine = await readyEngine()
    engine.setTranspose(12)
    engine.noteOn(96)
    engine.noteOn(97)
    engine.setTranspose(-12)
    engine.noteOn(33)
    engine.noteOn(32)
    expect(fake.world.played).toEqual(['piano on C8', 'piano on A0'])
  })

  it('remembers a key held on a pitch off the piano, without a sound when it is released', async () => {
    const engine = await readyEngine()
    engine.setTranspose(12)
    engine.noteOn(108)
    engine.setTranspose(0)
    engine.noteOff(108)
    engine.noteOn(108)
    expect(fake.world.played).toEqual(['piano on C8'])
  })
})

describe('the switch from the basic sound to the sampled piano', () => {
  it('neither cuts nor repeats a held chord when the samples arrive', async () => {
    const engine = await startedEngine()
    for (const key of [60, 64, 67]) engine.noteOn(key)
    const before = [...fake.world.played]
    piano().finishLoading()
    expect(fake.world.played).toEqual(before)
    expect(ringing()).toEqual(names(60, 64, 67))

    for (const key of [60, 64, 67]) engine.noteOff(key)
    expect(fake.world.played.slice(3)).toEqual(['synth off C4', 'synth off E4', 'synth off G4'])
    expect(ringing()).toEqual([])
  })

  it('moves a key to the piano the next time it is struck, stopping its old basic sound once', async () => {
    const engine = await startedEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    piano().finishLoading()
    engine.noteOn(60)
    engine.noteOff(60)
    engine.setSustain(false)
    expect(fake.world.played).toEqual(['synth on C4', 'synth off C4', 'piano on C4', 'piano off C4'])
  })

  it('never asks a sampler for a note before its samples are in, through every failed attempt at loading them', async () => {
    vi.useFakeTimers()
    const engine = await startedEngine()
    let key = 60
    const tapped: string[] = []
    const tapNextKey = (): void => {
      engine.noteOn(key)
      engine.noteOff(key)
      tapped.push(`synth on ${toneName(key)}`, `synth off ${toneName(key)}`)
      key += 1
    }

    tapNextKey()
    while (engine.getStatus() === 'loading') {
      piano().failLoading()
      // Right after a failure, and again once the engine has done what it does about it.
      tapNextKey()
      if (engine.getStatus() === 'loading') await runToNextWait()
      tapNextKey()
    }
    expect(engine.getStatus()).toBe('fallback')
    expect(fake.world.misuses).toEqual([])
    expect(fake.world.played).toEqual(tapped)
  })

  it('uses samples that arrive after the engine stopped waiting for them, while older notes finish on the basic sound', async () => {
    vi.useFakeTimers()
    const engine = await startedEngine()
    await waitWhileLoading(engine)
    expect(engine.getStatus()).toBe('fallback')
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)

    piano().finishLoading()
    expect(engine.getStatus()).toBe('ready')
    engine.noteOn(64)
    engine.noteOff(64)
    engine.setSustain(false)
    expect(fake.world.played).toEqual(['synth on C4', 'piano on E4', 'synth off C4', 'piano off E4'])
  })
})

describe('sample loading', () => {
  it("stays 'loading' when a file fails, and says 'fallback' once, only after giving up, however many files fail", async () => {
    vi.useFakeTimers()
    const engine = newEngine()
    const seen: AudioStatus[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    await engine.start()
    for (let file = 0; file < 30; file += 1) piano().failLoading()
    expect(seen).toEqual(['loading'])

    await failSamplesForGood(engine, 30)
    expect(seen).toEqual(['loading', 'fallback'])
    // And nothing more is said once everything the engine was waiting for has gone by.
    await vi.runAllTimersAsync()
    expect(seen).toEqual(['loading', 'fallback'])
  })

  it("says 'ready' once, however often loading reports that it is done", async () => {
    const engine = newEngine()
    const seen: AudioStatus[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    await engine.start()
    piano().finishLoading()
    piano().finishLoading()
    expect(seen).toEqual(['loading', 'ready'])
  })

  it("stays 'ready' when a failure is reported after the piano has loaded", async () => {
    const engine = await readyEngine()
    piano().failLoading()
    expect(engine.getStatus()).toBe('ready')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it('ignores samples of an earlier start() that arrive after a new one', async () => {
    const engine = await startedEngine()
    const first = piano()
    engine.dispose()
    await engine.start()
    const second = piano()
    expect(second).not.toBe(first)

    first.finishLoading()
    expect(engine.getStatus()).toBe('loading')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])

    second.finishLoading()
    expect(engine.getStatus()).toBe('ready')
  })

  it('does not let a failure of an earlier start() spoil the new one', async () => {
    const engine = await startedEngine()
    const first = piano()
    engine.dispose()
    await engine.start()
    const second = piano()
    first.failLoading()
    expect(engine.getStatus()).toBe('loading')

    // The new start's own samples are untouched by it: they are used when they arrive.
    expect(second.disposed).toBe(false)
    second.finishLoading()
    expect(engine.getStatus()).toBe('ready')
  })

  it('gives a new start its own full wait: what was left of the wait before it is dropped', async () => {
    vi.useFakeTimers()
    const engine = await startedEngine()
    const startedAt = Date.now()
    await waitWhileLoading(engine)
    expect(engine.getStatus()).toBe('fallback')
    // How long this engine waits for samples that neither arrive nor fail.
    const wait = Date.now() - startedAt
    const mostOfIt = Math.floor((wait * 2) / 3)
    expect(mostOfIt).toBeGreaterThan(0)

    engine.dispose()
    await engine.start()
    await vi.advanceTimersByTimeAsync(mostOfIt)
    engine.dispose()
    await engine.start()
    // A wait left over from the start before would run out during this.
    await vi.advanceTimersByTimeAsync(mostOfIt)
    expect(engine.getStatus()).toBe('loading')
    await vi.advanceTimersByTimeAsync(wait - mostOfIt)
    expect(engine.getStatus()).toBe('fallback')
  })

  it("reports 'error' and releases everything when the piano cannot even be set up", async () => {
    const errors = silenceConsoleErrors()
    fake.world.samplerCannotBeBuilt = true
    const engine = newEngine()
    await expect(engine.start()).resolves.toBeUndefined()
    expect(engine.getStatus()).toBe('error')
    // Whether the failure is also written to the console is up to the engine, but not over and over.
    expect(errors.mock.calls.length).toBeLessThanOrEqual(1)
    const built = fake.world.nodes.filter((node) => !(node instanceof fake.FakeSampler))
    expect(built.length).toBeGreaterThan(0)
    expect(built.every((node) => node.disposed)).toBe(true)
    expect(() => engine.noteOn(60)).not.toThrow()

    fake.world.samplerCannotBeBuilt = false
    await engine.start()
    expect(engine.getStatus()).toBe('loading')
  })
})

describe('start, dispose and start again', () => {
  it('ends with exactly one live sound when dispose and a new start come before the first has finished', async () => {
    const engine = newEngine()
    const first = engine.start()
    engine.dispose()
    const second = engine.start()
    const third = engine.start()
    expect(second).not.toBe(first)
    expect(third).toBe(second)
    await Promise.all([first, second, third])

    expect(engine.getStatus()).toBe('loading')
    expect(synths().filter((node) => !node.disposed)).toHaveLength(1)
    expect(pianos().filter((node) => !node.disposed)).toHaveLength(1)
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])
  })

  it('goes through idle only, with nothing built, when disposed before the first start has finished', async () => {
    const engine = newEngine()
    const seen: AudioStatus[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    const starting = engine.start()
    engine.dispose()
    await starting
    await settle()
    expect(seen).toEqual([])
    expect(engine.getStatus()).toBe('idle')
    expect(fake.world.nodes).toEqual([])
  })

  it('survives many rounds of start and dispose without leaving a node behind', async () => {
    const engine = newEngine()
    for (let round = 0; round < 20; round += 1) {
      await engine.start()
      engine.noteOn(60 + round)
      engine.dispose()
    }
    expect(fake.world.nodes.length).toBeGreaterThan(0)
    expect(fake.world.nodes.every((node) => node.disposals === 1)).toBe(true)
    expect(engine.getStatus()).toBe('idle')
  })

  it('never disposes a node twice, even when dispose() is called again and again', async () => {
    const engine = await readyEngine()
    engine.dispose()
    engine.dispose()
    engine.dispose()
    expect(fake.world.nodes.every((node) => node.disposals === 1)).toBe(true)
  })

  it('never uses an instrument after it was disposed', async () => {
    const engine = await readyEngine()
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.noteOn(64)
    engine.dispose()

    engine.noteOff(64)
    engine.setSustain(false)
    engine.allNotesOff()
    engine.noteOn(67)
    await engine.start()
    engine.setSustain(false)
    engine.allNotesOff()
    expect(fake.world.misuses).toEqual([])
  })

  it('lets a caller that joined a start in flight play as soon as its promise resolves', async () => {
    const engine = newEngine()
    void engine.start()
    await engine.start()
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])
  })

  it('shares a failing attempt between callers, reports it once at most, then retries', async () => {
    const errors = silenceConsoleErrors()
    const { resume } = fake.world.context
    resume.mockRejectedValueOnce(new Error('blocked by the browser'))
    const engine = newEngine()
    const seen: AudioStatus[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    await Promise.all([engine.start(), engine.start(), engine.start()])
    expect(seen).toEqual(['error'])
    expect(errors.mock.calls.length).toBeLessThanOrEqual(1)
    expect(resume).toHaveBeenCalledTimes(1)

    await engine.start()
    expect(seen).toEqual(['error', 'loading'])
    expect(resume).toHaveBeenCalledTimes(2)
  })

  it('retries when start() is called from the listener that has just been told about the error', async () => {
    silenceConsoleErrors()
    const { resume } = fake.world.context
    resume.mockRejectedValueOnce(new Error('blocked by the browser'))
    const engine = newEngine()
    let retry: Promise<void> | undefined
    engine.subscribe(() => {
      // The status says 'error': per the contract, calling start() again now retries.
      if (engine.getStatus() === 'error' && !retry) retry = engine.start()
    })

    await engine.start()
    await retry
    await settle()
    expect(resume).toHaveBeenCalledTimes(2)
    expect(engine.getStatus()).toBe('loading')
  })

  it('starts afresh when start() is called from the listener that has just been told about dispose', async () => {
    const engine = await startedEngine()
    let again: Promise<void> | undefined
    engine.subscribe(() => {
      if (engine.getStatus() === 'idle' && !again) again = engine.start()
    })
    engine.dispose()
    await again
    expect(engine.getStatus()).toBe('loading')
    expect(synths().filter((node) => !node.disposed)).toHaveLength(1)
  })

  it('can be disposed from the listener that hears it has started', async () => {
    const engine = newEngine()
    const seen: AudioStatus[] = []
    engine.subscribe(() => {
      seen.push(engine.getStatus())
      if (engine.getStatus() === 'loading') engine.dispose()
    })
    await engine.start()
    await settle()
    expect(engine.getStatus()).toBe('idle')
    expect(seen.at(-1)).toBe('idle')
    expect(fake.world.nodes.every((node) => node.disposals === 1)).toBe(true)

    // And it is not stuck: the next start works.
    seen.length = 0
    await engine.start()
    await settle()
    expect(engine.getStatus()).toBe('idle')
    expect(seen).toContain('loading')
  })

  it('ends with exactly one live sound when the browser grants a start only after the engine has stopped waiting for it', async () => {
    silenceConsoleErrors()
    vi.useFakeTimers()
    const { context } = fake.world
    let grant = (): void => {}
    context.resume.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        grant = () => {
          context.state = 'running'
          resolve()
        }
      }),
    )
    const engine = newEngine()
    void engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1))
    // However long the engine is prepared to wait for the browser, that time goes by.
    await vi.runAllTimersAsync()

    // Then the browser says yes after all. Whether the engine picks that up by
    // itself or leaves it to the next start() is its own choice.
    grant()
    await settle()
    await engine.start()

    expect(engine.getStatus()).toBe('loading')
    expect(synths().filter((node) => !node.disposed)).toHaveLength(1)
    expect(pianos().filter((node) => !node.disposed)).toHaveLength(1)
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])
  })

  it('is not spoiled by an earlier start that fails after a dispose and a new start', async () => {
    const errors = silenceConsoleErrors()
    const { context } = fake.world
    let refuse = (): void => {}
    context.resume.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        refuse = () => reject(new Error('blocked by the browser'))
      }),
    )
    const engine = newEngine()
    const seen: AudioStatus[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    const first = engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1))
    engine.dispose()
    await engine.start()
    expect(engine.getStatus()).toBe('loading')

    refuse()
    await first
    await settle()
    expect(seen).toEqual(['loading'])
    expect(errors).not.toHaveBeenCalled()
    expect(synths().filter((node) => !node.disposed)).toHaveLength(1)
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['synth on C4'])
  })

  it('is not spoiled by an earlier start that the browser never answered', async () => {
    silenceConsoleErrors()
    vi.useFakeTimers()
    const { context } = fake.world
    context.resume.mockReturnValueOnce(new Promise<void>(() => {}))
    const engine = newEngine()
    void engine.start()
    await vi.advanceTimersByTimeAsync(1_000)
    engine.dispose()
    await engine.start()
    piano().finishLoading()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.getStatus()).toBe('ready')
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it('ignores keys pressed while audio is still starting, and leaves nothing behind for them', async () => {
    const { context } = fake.world
    let letAudioStart = (): void => {}
    context.resume.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        letAudioStart = () => {
          context.state = 'running'
          resolve()
        }
      }),
    )
    const engine = newEngine()
    engine.setSustain(true)
    const starting = engine.start()
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalled())
    engine.noteOn(60)
    letAudioStart()
    await starting

    engine.noteOff(60)
    engine.setSustain(false)
    engine.allNotesOff()
    expect(fake.world.played).toEqual([])
  })
})

describe('status listeners', () => {
  it('can play on the right instrument from inside the notification', async () => {
    const engine = newEngine()
    engine.subscribe(() => {
      const status = engine.getStatus()
      if (status === 'loading') engine.noteOn(60)
      if (status === 'ready') engine.noteOn(64)
    })
    await engine.start()
    piano().finishLoading()
    expect(fake.world.played).toEqual(['synth on C4', 'piano on E4'])
  })

  it('still tells the others when one listener removes itself, or another, while being told', async () => {
    const engine = newEngine()
    const told: string[] = []
    const removeFirst = engine.subscribe(() => {
      told.push('first')
      removeFirst()
    })
    const removeSecond = engine.subscribe(() => told.push('second'))
    engine.subscribe(() => {
      told.push('third')
      removeSecond()
    })
    await engine.start()
    expect(told).toEqual(['first', 'second', 'third'])

    told.length = 0
    piano().finishLoading()
    expect(told).toEqual(['third'])
  })

  it('tells a listener that was added twice, and stops once both of its removers have been called', async () => {
    const engine = newEngine()
    const listener = vi.fn()
    const removeFirst = engine.subscribe(listener)
    const removeSecond = engine.subscribe(listener)
    await engine.start()
    expect(listener).toHaveBeenCalled()

    removeFirst()
    removeSecond()
    listener.mockClear()
    piano().finishLoading()
    expect(listener).not.toHaveBeenCalled()
  })

  it('works when its methods are passed around without the engine object', async () => {
    const { start, getStatus, subscribe, noteOn, noteOff, dispose } = newEngine()
    const listener = vi.fn()
    subscribe(listener)
    await start()
    expect(getStatus()).toBe('loading')
    noteOn(60)
    noteOff(60)
    dispose()
    expect(getStatus()).toBe('idle')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(fake.world.played).toEqual(['synth on C4', 'synth off C4'])
  })
})

describe('settings before and after start', () => {
  it('applies what was set between a dispose and the next start', async () => {
    const engine = await startedEngine()
    engine.dispose()
    engine.setVolume(0.5)
    engine.setReverb(1)
    engine.setRelease(RELEASE_SECONDS.short)
    engine.setTranspose(-2)
    engine.setSustain(true)
    await engine.start()

    expect(master().gain.value).toBeCloseTo(10 ** (volumeToDb(0.5) / 20), 10)
    expect(echoSend().gain.value).toBeGreaterThan(0)
    expect(synth().envelope.release).toBe(RELEASE_SECONDS.short)
    piano().finishLoading()
    expect(piano().release).toBe(RELEASE_SECONDS.short)
    engine.noteOn(60)
    engine.noteOff(60)
    expect(fake.world.played).toEqual(['piano on A#3'])
  })

  it('follows the volume slider exactly, and never sets a gain that is negative, above 1 or not a number', async () => {
    const engine = await startedEngine()
    for (const value of [-1, 0, 0.001, 0.3, 0.5, 1, 7, Infinity, -Infinity, Number.NaN]) {
      engine.setVolume(value)
      engine.setReverb(value)
      expect(master().gain.value).toBeCloseTo(10 ** (volumeToDb(value) / 20), 10)
      for (const gain of [master().gain.value, echoSend().gain.value]) {
        expect(gain).toBeGreaterThanOrEqual(0)
        expect(gain).toBeLessThanOrEqual(1)
      }
    }
  })

  it('leaves the direct sound alone whatever the echo amount: only the side path changes', async () => {
    const engine = await startedEngine()
    expect(bus().outputs).toContain(compressor())
    for (const amount of [0, 0.15, 1, 0]) {
      engine.setReverb(amount)
      expect(bus().gain.value).toBe(1)
      expect(bus().gain.ramps).toEqual([])
    }
    expect(echoSend().gain.value).toBe(0)
  })

  it('changes the fade-out of the basic sound for notes that are already down', async () => {
    const engine = await startedEngine()
    engine.noteOn(60)
    engine.setRelease(RELEASE_SECONDS.long)
    expect(synth().envelope.release).toBe(RELEASE_SECONDS.long)
    expect(synths()).toHaveLength(1)
  })

  it('accepts every setter, with any value, in any state, without throwing', async () => {
    silenceConsoleErrors()
    const engine = newEngine()
    const anything = [0, 1, -1, 0.5, 12, -12, 1e9, -1e9, Infinity, -Infinity, Number.NaN]
    const useEverySetter = (): void => {
      for (const value of anything) {
        engine.setVolume(value)
        engine.setReverb(value)
        engine.setRelease(value)
        engine.setTranspose(value)
        engine.noteOn(value, value)
        engine.noteOff(value)
      }
      engine.setSustain(true)
      engine.setSustain(false)
      engine.allNotesOff()
    }
    expect(useEverySetter).not.toThrow()
    await engine.start()
    expect(useEverySetter).not.toThrow()
    piano().finishLoading()
    expect(useEverySetter).not.toThrow()
    engine.dispose()
    expect(useEverySetter).not.toThrow()
  })
})

describe('the note path', () => {
  it('starts and stops every note at the current time of the audio clock, never later', async () => {
    const engine = await startedEngine()
    engine.setSustain(true)
    for (let step = 0; step < 40; step += 1) {
      const key = 48 + (step % 12)
      engine.noteOn(key, 0.7)
      passSeconds(0.013)
      engine.noteOff(key)
      passSeconds(0.2)
      if (step === 20) piano().finishLoading()
      if (step % 7 === 0) engine.setSustain(step % 2 === 0)
    }
    engine.setSustain(false)
    engine.allNotesOff()

    expect(fake.world.triggers.length).toBeGreaterThan(60)
    for (const trigger of fake.world.triggers) {
      expect(trigger.time).toBeLessThanOrEqual(trigger.clock)
    }
  })

  it('has told the instrument before noteOn returns', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4'])
    engine.noteOff(60)
    expect(fake.world.played).toEqual(['piano on C4', 'piano off C4'])
  })

  it('passes on how hard each note was played, on both instruments', async () => {
    const engine = await startedEngine()
    engine.noteOn(60, 0.1)
    piano().finishLoading()
    engine.noteOn(62, 1)
    expect(fake.world.triggers.map((trigger) => trigger.velocity)).toEqual([0.1, 1])
  })

  it('still plays without delay after a later start, even if something put the look-ahead back meanwhile', async () => {
    const engine = await startedEngine()
    engine.dispose()
    fake.world.context.lookAhead = 0.1
    await engine.start()
    engine.noteOn(60)
    engine.noteOff(60)
    expect(fake.world.triggers).toHaveLength(2)
    for (const trigger of fake.world.triggers) {
      expect(trigger.time).toBeLessThanOrEqual(trigger.clock)
    }
  })
})

describe('an audio context the browser has paused', () => {
  it('leaves nothing behind for a key pressed and released while it was paused', async () => {
    const engine = await readyEngine()
    const { context } = fake.world
    context.state = 'suspended'
    context.resume.mockImplementation(async () => {})
    engine.setSustain(true)
    engine.noteOn(60)
    engine.noteOff(60)
    engine.noteOn(62)

    context.state = 'running'
    engine.noteOff(62)
    engine.setSustain(false)
    engine.allNotesOff()
    expect(fake.world.played).toEqual([])
  })

  it('still lets go of a note that was sounding when the pause came', async () => {
    const engine = await readyEngine()
    engine.noteOn(60)
    fake.world.context.state = 'suspended'
    engine.noteOff(60)
    expect(ringing()).toEqual([])
  })

  it('asks for audio back on every press until it has it, without stacking up notes', async () => {
    const engine = await readyEngine()
    const { context } = fake.world
    context.state = 'suspended'
    context.resume.mockClear()
    context.resume.mockImplementation(async () => {})
    for (let press = 0; press < 5; press += 1) {
      engine.noteOn(60)
      engine.noteOff(60)
    }
    expect(context.resume).toHaveBeenCalledTimes(5)
    expect(fake.world.played).toEqual([])

    context.state = 'running'
    engine.noteOn(60)
    expect(fake.world.played).toEqual(['piano on C4'])
  })

  it('does not throw when asking for audio back fails outright', async () => {
    silenceConsoleErrors()
    const engine = await readyEngine()
    const { context } = fake.world
    context.state = 'closed'
    context.resume.mockImplementation(() => {
      throw new Error('the context is closed')
    })
    expect(() => {
      engine.noteOn(60)
      engine.noteOff(60)
    }).not.toThrow()
  })
})

describe('a long session', () => {
  it('keeps exact track of what is sounding through thousands of random moves', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      fake.reset()
      const random = randomSource(seed)
      const pick = (count: number): number => Math.floor(random() * count)
      const engine = await startedEngine()

      // What the spec says should be sounding: key -> the pitch it started.
      const expected = new Map<number, number>()
      const held = new Set<number>()
      let sustain = false
      let transpose = 0
      const letGo = (key: number): void => {
        expected.delete(key)
      }

      for (let move = 0; move < 3000; move += 1) {
        const key = 55 + pick(14)
        const choice = pick(100)
        if (move === 400) piano().finishLoading()
        if (choice < 45) {
          const pitch = key + transpose
          // Two keys on one pitch is a case of its own, with tests of its own
          // under 'transpose bookkeeping': this player leaves such a key alone.
          const soundsFromAnotherKey = [...expected].some(
            ([other, sounding]) => other !== key && sounding === pitch,
          )
          if (!soundsFromAnotherKey) {
            engine.noteOn(key, random())
            held.add(key)
            letGo(key)
            if (pitch >= 21 && pitch <= 108) expected.set(key, pitch)
          }
        } else if (choice < 85) {
          engine.noteOff(key)
          if (held.delete(key) && !sustain) letGo(key)
        } else if (choice < 91) {
          sustain = !sustain
          engine.setSustain(sustain)
          if (!sustain) for (const sounding of [...expected.keys()]) if (!held.has(sounding)) letGo(sounding)
        } else if (choice < 97) {
          transpose = pick(7) - 3
          engine.setTranspose(transpose)
        } else {
          engine.allNotesOff()
          held.clear()
          expected.clear()
        }
        // Slow enough that the basic sound never runs short of voices here.
        passSeconds(0.4)
        expect(ringing(), `seed ${seed}, move ${move}`).toEqual(names(...expected.values()))
      }

      for (const key of held) engine.noteOff(key)
      engine.setSustain(false)
      expect(ringing(), `seed ${seed}, at the end`).toEqual([])
      expect(synth().dropped).toEqual([])
      engine.dispose()
    }
  })

  it('has nothing left to stop after ten thousand notes were played and released', async () => {
    const engine = await readyEngine()
    for (let note = 0; note < 10_000; note += 1) {
      const key = 21 + (note % 88)
      engine.noteOn(key)
      if (note % 3 === 0) engine.setSustain(note % 2 === 0)
      engine.noteOff(key)
      passSeconds(0.05)
    }
    engine.setSustain(false)
    expect(ringing()).toEqual([])

    const before = fake.world.played.length
    engine.allNotesOff()
    engine.setSustain(true)
    engine.setSustain(false)
    expect(fake.world.played).toHaveLength(before)
  })

  it('keeps one sounding source per key when the same key is hammered a thousand times', async () => {
    const engine = await readyEngine()
    for (let strike = 0; strike < 1000; strike += 1) engine.noteOn(60)
    expect(ringing()).toEqual(names(60))
    engine.noteOff(60)
    expect(ringing()).toEqual([])
  })
})

/**
 * The stand-in counts voices the way Tone's PolySynth does (see the top of
 * this file). The two glissando tests below describe ordinary playing with
 * the mouse. With 64 voices the real Tone.js in Chrome dropped 31 of their
 * 111 and 10 of their 74 notes, each with a "Max polyphony exceeded. Note
 * dropped." console warning.
 *
 * These tests only count voices. They cannot see what too many voices cost:
 * a computer can only play so many at once before everything crackles. That
 * upper limit is checked in audioEngine.test.ts ('gives the basic sound
 * enough voices for a quick sweep, and no more than a computer can play').
 */
describe('voices of the basic sound (used while the piano loads, and for good when it cannot load)', () => {
  const KEYS = Array.from({ length: 37 }, (_, slot) => 48 + slot)
  /** About one second to sweep the whole on-screen piano. */
  const SECONDS_PER_KEY = 0.027

  /** The piano could not be loaded, however often the engine tried: only the basic sound is left. */
  async function basicSoundEngine(): Promise<AudioEngine> {
    vi.useFakeTimers()
    const engine = await startedEngine()
    await failSamplesForGood(engine)
    expect(engine.getStatus()).toBe('fallback')
    return engine
  }

  it('has a voice for every note of ordinary playing: ten notes a second for a minute', async () => {
    const engine = await basicSoundEngine()
    const random = randomSource(7)
    for (let note = 0; note < 600; note += 1) {
      const key = KEYS[Math.floor(random() * KEYS.length)] ?? 60
      engine.noteOn(key)
      passSeconds(0.08)
      engine.noteOff(key)
      passSeconds(0.02)
    }
    expect(synth().dropped).toEqual([])
  })

  it('frees the voice of a note that rings on sustain once it has died away', async () => {
    const engine = await basicSoundEngine()
    engine.setSustain(true)
    for (const key of KEYS) {
      engine.noteOn(key)
      engine.noteOff(key)
    }
    expect(synth().voicesInUse()).toBe(KEYS.length)
    passSeconds(60)
    expect(synth().voicesInUse()).toBe(0)
  })

  it('plays every key of a glissando up, down and up again with the long fade-out', async () => {
    const engine = await basicSoundEngine()
    engine.setRelease(RELEASE_SECONDS.long)
    const sweep = [...KEYS, ...KEYS.toReversed(), ...KEYS]
    let previous: number | null = null
    for (const key of sweep) {
      // The pointer leaves one key and enters the next.
      if (previous !== null) engine.noteOff(previous)
      engine.noteOn(key)
      previous = key
      passSeconds(SECONDS_PER_KEY)
    }
    if (previous !== null) engine.noteOff(previous)

    expect(synth().dropped).toEqual([])
  })

  it('plays every key of a sweep up and back down while sustain is on', async () => {
    const engine = await basicSoundEngine()
    engine.setSustain(true)
    for (const key of [...KEYS, ...KEYS.toReversed()]) {
      engine.noteOn(key)
      engine.noteOff(key)
      passSeconds(SECONDS_PER_KEY)
    }

    expect(synth().dropped).toEqual([])
  })
})
