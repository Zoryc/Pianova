/**
 * The sound of the piano.
 *
 *   basic sound ───┐
 *                  ├─▶ bus ─┬────────────────────────▶ compressor ─▶ master volume ─▶ speakers
 *   sampled piano ─┘        └─▶ echo send ─▶ reverb ─┘
 *
 * Tone.js is loaded inside start(), never at the top of this file: loading it
 * creates the browser's AudioContext, which browsers refuse (with a console
 * warning) until the user has clicked or pressed a key. It also keeps this
 * module importable where there is no audio at all (the tests run in Node).
 */
import type { Gain, PolySynth, Sampler } from 'tone'
import { DEFAULT_VELOCITY } from '../core/noteBus'
import { MIDI_MAX, MIDI_MIN, isValidMidi, toneName } from '../core/notes'
import type { Midi, ReleaseLength } from '../core/types'

type Tone = typeof import('tone')
type ToneContext = ReturnType<Tone['getContext']>

export type AudioStatus =
  | 'idle' // start() not called yet
  | 'loading' // audio is running, piano samples still loading: the basic sound plays meanwhile
  | 'ready' // sampled piano loaded
  | 'fallback' // samples could not be loaded (offline): basic sound only
  | 'error' // audio could not start at all

export interface AudioEngine {
  /**
   * Call from a user gesture (click / key press). Safe to call many times
   * (concurrent calls share one attempt, and a call that finds an earlier one
   * still waiting for the browser asks the browser again). Resolves once
   * sound can play (the basic sound counts). Never rejects: failures set
   * status 'error', and calling start() again after an error retries.
   */
  start(): Promise<void>
  getStatus(): AudioStatus
  /** `listener` is called whenever the status changes. Returns a function that removes it. */
  subscribe(listener: () => void): () => void
  /** No-op before start(). */
  noteOn(midi: Midi, velocity?: number): void
  noteOff(midi: Midi): void
  setSustain(on: boolean): void
  /** 0..1, may be called before start(). */
  setVolume(volume: number): void
  /**
   * Whole semitones (clamped to ±12). The sound is `midi + semitones`;
   * `midi` itself (the key) is unchanged.
   */
  setTranspose(semitones: number): void
  /** "Room echo": 0 = none … 1 = a lot. */
  setReverb(amount: number): void
  /** How long a note takes to fade after it is released, in seconds (clamped to 0.05..5). */
  setRelease(seconds: number): void
  /** Silences everything, including sustained notes. */
  allNotesOff(): void
  /**
   * Releases everything and goes back to 'idle'. Every method stays safe to
   * call afterwards, and start() starts afresh.
   */
  dispose(): void
}

/** Seconds for each ReleaseLength. */
export const RELEASE_SECONDS: Readonly<Record<ReleaseLength, number>> = {
  short: 0.25,
  normal: 1,
  long: 2.5,
}

export interface AudioEngineOptions {
  /** Where the piano samples are loaded from. */
  sampleBaseUrl?: string
}

/**
 * The piano recordings are the Salamander Grand Piano (a Yamaha C5) by
 * Alexander Holm, licensed CC BY 3.0
 * (https://creativecommons.org/licenses/by/3.0/). These MP3 copies are hosted
 * by the Tone.js project (https://github.com/Tonejs/audio). They are
 * downloaded when the app starts and are not part of this repository.
 */
export const DEFAULT_SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'

/**
 * Slider position (0..1) to decibels: 0 is silent (-Infinity), 1 is 0 dB, and
 * in between follows 40·log10, which the ear hears as an even change.
 * Out-of-range input is clamped; NaN counts as silent.
 */
export function volumeToDb(volume: number): number {
  if (Number.isNaN(volume) || volume <= 0) return -Infinity
  if (volume >= 1) return 0
  return 40 * Math.log10(volume)
}

const MAX_TRANSPOSE = 12
const MIN_RELEASE_SECONDS = 0.05
const MAX_RELEASE_SECONDS = 5

/** The Salamander piano is recorded every minor third (3 semitones), from A0 to C8. */
const SAMPLE_STEP = 3
/**
 * One file that fails to arrive (a network hiccup, a busy server) leaves the
 * whole piano unusable, so the samples are asked for again, this many more
 * times, before the basic sound is kept for good.
 */
const SAMPLE_LOAD_RETRIES = 2
/** The pause before asking again: long enough for a hiccup to pass. */
const SAMPLE_RETRY_DELAY_MS = 3_000
/** Past this wait the status says 'fallback'. The samples are still used if they arrive later. */
const SAMPLE_LOAD_TIMEOUT_MS = 30_000
/**
 * A browser that will not start audio can leave the request pending forever.
 * Giving up turns it into an error the user can retry.
 */
const RESUME_TIMEOUT_MS = 5_000
/** Volume and echo glide to a new value over this long: a sudden jump is heard as a click. */
const SMOOTHING_SECONDS = 0.03

/**
 * Headroom for chords. The compressor's make-up gain (about +4.5 dB) brings
 * single notes back to their recorded level.
 */
const SAMPLER_VOLUME_DB = -4
/**
 * An oscillator is at full scale where a piano recording is not: this keeps
 * the basic sound about as loud as the piano that replaces it.
 */
const SYNTH_VOLUME_DB = -18
/**
 * Strength of each harmonic of the basic sound. A strong fundamental with
 * quickly weaker overtones is mellow: closer to a string than a bare beep.
 */
const SYNTH_PARTIALS: readonly number[] = [1, 0.55, 0.3, 0.16, 0.08, 0.04, 0.02]
const SYNTH_ATTACK_SECONDS = 0.004
/**
 * Tone turns an envelope's decay into an exponential fade whose time constant
 * is ln(decay + 1) / ln(200). 30 gives about 0.65 s: a note that is clearly
 * heard for 3 to 4 seconds and keeps dying away while its key is held, like
 * a string. It is also when Tone frees the voice of a note that is never
 * released (one left ringing on sustain).
 */
const SYNTH_DECAY_SECONDS = 30
/**
 * A note keeps its voice until it has died away: for the whole decay when it
 * rings on sustain, and for the fade-out after its key is released. A quick
 * sweep over the keys with sustain on, or with the long fade-out, needs close
 * to a hundred voices at once, far more than Tone's default of 32. This is
 * also about as many as a computer can play together: every sounding voice
 * costs processing time, and well beyond this the sound starts to crackle.
 */
const SYNTH_MAX_VOICES = 128

/**
 * Keeps big chords from clipping: the output stays under -2 dBFS for input up
 * to +12 dBFS, and anything below the threshold is left alone. (Tone.Limiter
 * would not do: it keeps the browser's 30 dB soft knee, which lets peaks far
 * above full scale through.)
 */
const MASTER_COMPRESSOR = { threshold: -12, knee: 10, ratio: 12, attack: 0.003, release: 0.25 }
/**
 * `wet: 1` because the reverb sits on a side path: the direct sound never
 * goes through it, so it is never delayed.
 */
const ROOM = { decay: 1.8, preDelay: 0.01, wet: 1 }
/** How much of the sound is sent to the reverb when "Room echo" is at its maximum. */
const MAX_ECHO_SEND = 0.8

/** Either instrument: both start and stop notes by name. */
type Instrument = PolySynth | Sampler

/** A note that was started, and where: it is stopped on the same instrument at the same pitch. */
interface Voice {
  instrument: Instrument
  /** The pitch that is sounding: the key plus the transpose at the time it was pressed. */
  pitch: Midi
}

/** What the setters control. Remembered here so it can be set before audio exists. */
interface SoundSettings {
  volume: number
  reverb: number
  release: number
  transpose: number
  sustain: boolean
}

/** Everything that exists only while audio is running. */
interface AudioGraph {
  context: ToneContext
  /** The basic sound: plays until the piano samples are in, and for good if they never come. */
  synth: PolySynth
  /** The sampled piano. Null until every sample has loaded. */
  piano: Sampler | null
  /** Where both instruments meet, before the echo and the master volume. */
  bus: Gain
  echoSend: Gain
  master: Gain
  /** Every node made for this graph, so that closing it releases them all. */
  nodes: Array<{ dispose(): unknown }>
}

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const sampleBaseUrl = withTrailingSlash(options.sampleBaseUrl ?? DEFAULT_SAMPLE_BASE_URL)
  const listeners = new Set<() => void>()
  const sound: SoundSettings = {
    volume: 1,
    reverb: 0,
    release: RELEASE_SECONDS.normal,
    transpose: 0,
    sustain: false,
  }
  /** Keys that are down right now. */
  const heldKeys = new Set<Midi>()
  /** The note each key started. A voice whose key is no longer held is ringing on sustain. */
  const voices = new Map<Midi, Voice>()

  let status: AudioStatus = 'idle'
  let graph: AudioGraph | null = null
  let starting: Promise<void> | null = null
  /** The audio context of a start that is still waiting for the browser to allow sound. */
  let waking: ToneContext | null = null
  let loadTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  /** Goes up on every dispose(), so that work begun before it can tell it is out of date. */
  let lifetime = 0

  function setStatus(next: AudioStatus): void {
    if (next === status) return
    status = next
    for (const listener of [...listeners]) safely(listener)
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function start(): Promise<void> {
    if (graph) return Promise.resolve()
    if (starting) {
      askBrowserAgain()
      return starting
    }
    const attempt: Promise<void> = openAudio(lifetime).finally(() => {
      if (starting === attempt) starting = null
    })
    starting = attempt
    return attempt
  }

  /**
   * Browsers allow sound only after a click or a key press, and they do not
   * count every key: a start made from Escape or Shift is left waiting. The
   * next click or key press calls start() again, and asking the browser once
   * more from there is what lets the waiting start through.
   */
  function askBrowserAgain(): void {
    const context = waking
    if (context) safely(() => void context.resume().catch(ignore))
  }

  async function openAudio(born: number): Promise<void> {
    try {
      const tone = await loadTone()
      const context = tone.getContext()
      // Tone's own context already asks the browser for its fastest ("interactive") output.
      // What would be heard as lag is Tone scheduling everything 0.1 s ahead by default.
      context.lookAhead = 0
      if (born === lifetime) waking = context
      try {
        await wake(context)
      } finally {
        if (born === lifetime) waking = null
      }
      if (born !== lifetime) return
      const built = buildGraph(tone, context, sound)
      graph = built
      loadPiano(tone, built)
      setStatus('loading')
    } catch (error) {
      if (born !== lifetime) return
      console.error('[AudioEngine] could not start', error)
      closeGraph()
      // This attempt is over before anyone hears about it: a listener that
      // answers the error by calling start() gets a new attempt, not this one.
      starting = null
      setStatus('error')
    }
  }

  /** Starts fetching the piano samples, and the wait after which the status stops saying 'loading'. */
  function loadPiano(tone: Tone, target: AudioGraph): void {
    requestSamples(tone, target, SAMPLE_LOAD_RETRIES)
    loadTimer = setTimeout(() => markSamplesMissing(target), SAMPLE_LOAD_TIMEOUT_MS)
  }

  /**
   * One attempt at loading the piano. Tone hands the sampler over only when
   * every file has arrived, so an attempt in which a file failed can never
   * finish: it is given up, and a new one is made a few seconds later (the
   * files that did arrive then come straight from the browser's cache). The
   * basic sound keeps playing all the while.
   */
  function requestSamples(tone: Tone, target: AudioGraph, retriesLeft: number): void {
    /** False once this attempt is over, either way: whatever it reports afterwards is ignored. */
    let underway = true
    const sampler = new tone.Sampler({
      urls: sampleUrls(),
      baseUrl: sampleBaseUrl,
      volume: SAMPLER_VOLUME_DB,
      onload: () => {
        if (!underway || graph !== target) return
        underway = false
        sampler.release = sound.release
        // Only notes pressed from now on use the piano: the ones already
        // sounding finish on the instrument that started them.
        target.piano = sampler
        setStatus('ready')
      },
      // Tone reports every file that fails: the first one ends the attempt.
      onerror: () => {
        if (!underway || graph !== target) return
        underway = false
        discardSampler(target, sampler)
        if (retriesLeft === 0) {
          markSamplesMissing(target)
          return
        }
        retryTimer = setTimeout(
          () => safely(() => requestSamples(tone, target, retriesLeft - 1)),
          SAMPLE_RETRY_DELAY_MS,
        )
      },
    }).connect(target.bus)
    target.nodes.push(sampler)
  }

  /** Releases a sampler that will never be played, with the files it did load. */
  function discardSampler(target: AudioGraph, sampler: Sampler): void {
    target.nodes = target.nodes.filter((node) => node !== sampler)
    safely(() => sampler.dispose())
  }

  function markSamplesMissing(target: AudioGraph): void {
    if (graph === target && status === 'loading') setStatus('fallback')
  }

  function closeGraph(): void {
    clearTimeout(loadTimer)
    clearTimeout(retryTimer)
    heldKeys.clear()
    voices.clear()
    const closing = graph
    graph = null
    closing?.nodes.forEach((node) => safely(() => node.dispose()))
  }

  function noteOn(midi: Midi, velocity: number = DEFAULT_VELOCITY): void {
    const target = graph
    if (!target || !isValidMidi(midi)) return
    heldKeys.add(midi)
    safely(() => {
      if (target.context.state !== 'running') {
        // The browser paused audio (device change, sleep…). Ask for it back, and
        // let this press stay silent: queued notes would all sound late, at once.
        void target.context.resume().catch(ignore)
        return
      }
      // A key that is struck again starts over instead of piling up on itself.
      stopVoice(target, midi)
      const pitch = midi + sound.transpose
      if (!isValidMidi(pitch)) return
      stopPitch(target, pitch)
      const instrument = target.piano ?? target.synth
      const strength = clamp(velocity, 0, 1, DEFAULT_VELOCITY)
      instrument.triggerAttack(toneName(pitch), target.context.immediate(), strength)
      voices.set(midi, { instrument, pitch })
    })
  }

  function noteOff(midi: Midi): void {
    if (!heldKeys.delete(midi) || sound.sustain) return
    const target = graph
    if (target) safely(() => stopVoice(target, midi))
  }

  function stopVoice(target: AudioGraph, key: Midi): void {
    const voice = voices.get(key)
    if (!voice) return
    voices.delete(key)
    voice.instrument.triggerRelease(toneName(voice.pitch), target.context.immediate())
  }

  /**
   * Two keys can reach the same pitch when the transpose changes while notes
   * ring. Tone's instruments stop notes by pitch, so two voices on one pitch
   * could not be stopped separately: the newer strike takes the pitch over.
   */
  function stopPitch(target: AudioGraph, pitch: Midi): void {
    for (const [key, voice] of voices) {
      if (voice.pitch === pitch) stopVoice(target, key)
    }
  }

  function stopVoices(shouldStop: (key: Midi) => boolean): void {
    const target = graph
    if (!target) return
    for (const key of [...voices.keys()]) {
      if (shouldStop(key)) safely(() => stopVoice(target, key))
    }
  }

  function setSustain(on: boolean): void {
    sound.sustain = on
    if (!on) stopVoices((key) => !heldKeys.has(key))
  }

  function allNotesOff(): void {
    heldKeys.clear()
    stopVoices(() => true)
  }

  function setVolume(volume: number): void {
    sound.volume = volume
    graph?.master.gain.rampTo(volumeToGain(volume), SMOOTHING_SECONDS)
  }

  function setTranspose(semitones: number): void {
    sound.transpose = clamp(Math.round(semitones), -MAX_TRANSPOSE, MAX_TRANSPOSE, 0)
  }

  function setReverb(amount: number): void {
    sound.reverb = clamp(amount, 0, 1, 0)
    graph?.echoSend.gain.rampTo(echoSendGain(sound.reverb), SMOOTHING_SECONDS)
  }

  function setRelease(seconds: number): void {
    sound.release = clamp(seconds, MIN_RELEASE_SECONDS, MAX_RELEASE_SECONDS, RELEASE_SECONDS.normal)
    if (!graph) return
    graph.synth.set({ envelope: { release: sound.release } })
    if (graph.piano) graph.piano.release = sound.release
  }

  function dispose(): void {
    lifetime += 1
    starting = null
    waking = null
    closeGraph()
    setStatus('idle')
  }

  return {
    start,
    getStatus: () => status,
    subscribe,
    noteOn,
    noteOff,
    setSustain,
    setVolume,
    setTranspose,
    setReverb,
    setRelease,
    allNotesOff,
    dispose,
  }
}

/**
 * Loads Tone.js. Tone prints a banner in the console the first time it is
 * loaded, unless it finds this flag already set.
 */
function loadTone(): Promise<Tone> {
  const flags = globalThis as { TONE_SILENCE_LOGGING?: boolean }
  flags.TONE_SILENCE_LOGGING = true
  return import('tone')
}

/** Resolves once the context is really running; rejects if it will not start or takes too long. */
async function wake(context: ToneContext): Promise<void> {
  await withTimeout(context.resume(), RESUME_TIMEOUT_MS)
  if (context.state !== 'running') throw new Error('The audio context is not running')
}

function buildGraph(tone: Tone, context: ToneContext, sound: SoundSettings): AudioGraph {
  const master = new tone.Gain(volumeToGain(sound.volume)).toDestination()
  const compressor = new tone.Compressor(MASTER_COMPRESSOR).connect(master)
  // Until the reverb has worked out its echo (a moment after start) it is simply silent.
  const reverb = new tone.Reverb(ROOM).connect(compressor)
  const echoSend = new tone.Gain(echoSendGain(sound.reverb)).connect(reverb)
  const bus = new tone.Gain().fan(compressor, echoSend)
  const synth = createBasicSound(tone, sound.release).connect(bus)
  return {
    context,
    synth,
    piano: null,
    bus,
    echoSend,
    master,
    nodes: [master, compressor, reverb, echoSend, bus, synth],
  }
}

/** A soft, plucked tone: instant attack, then it dies away by itself even while its key is held. */
function createBasicSound(tone: Tone, release: number): PolySynth {
  return new tone.PolySynth({
    voice: tone.Synth,
    maxPolyphony: SYNTH_MAX_VOICES,
    volume: SYNTH_VOLUME_DB,
    options: {
      oscillator: { type: 'custom', partials: [...SYNTH_PARTIALS] },
      envelope: {
        attack: SYNTH_ATTACK_SECONDS,
        decay: SYNTH_DECAY_SECONDS,
        sustain: 0,
        release,
      },
    },
  })
}

/** Tone note name -> file name, e.g. { A0: 'A0.mp3', 'D#1': 'Ds1.mp3', … C8: 'C8.mp3' }. */
function sampleUrls(): Record<string, string> {
  const urls: Record<string, string> = {}
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi += SAMPLE_STEP) {
    const name = toneName(midi)
    urls[name] = `${name.replace('#', 's')}.mp3`
  }
  return urls
}

function withTrailingSlash(url: string): string {
  return url === '' || url.endsWith('/') ? url : `${url}/`
}

function volumeToGain(volume: number): number {
  return 10 ** (volumeToDb(volume) / 20)
}

function echoSendGain(amount: number): number {
  return amount * MAX_ECHO_SEND
}

/** Keeps `value` between `min` and `max`. NaN cannot be clamped, so it becomes `fallback`. */
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function withTimeout(work: Promise<void>, milliseconds: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), milliseconds)
    work.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/**
 * Runs `work` and reports a failure instead of passing it on: a note that
 * fails must never break the keyboard or the screen.
 */
function safely(work: () => void): void {
  try {
    work()
  } catch (error) {
    console.error('[AudioEngine]', error)
  }
}

function ignore(): void {}
