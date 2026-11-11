import type { Midi, NoteEvent, NoteListener, NoteSource } from './types'

export const DEFAULT_VELOCITY = 0.8

export interface NoteOnOptions {
  /** 0..1, defaults to DEFAULT_VELOCITY. */
  velocity?: number
  /** Milliseconds on the `performance.now()` clock; defaults to now. */
  time?: number
}

/**
 * The single place every note passes through.
 *
 * Inputs (computer keyboard, mouse, later a real instrument) call
 * `noteOn` / `noteOff`; consumers (sound, on-screen piano, later the
 * practice and scoring engines) `subscribe`.
 *
 * The bus tracks which sources are holding each note:
 * - `on` is emitted every time a source starts holding a note it was not
 *   already holding (so pressing the same note from a second source
 *   re-triggers it).
 * - `off` is emitted only when the last source lets go.
 * - Duplicate `noteOn` and stray `noteOff` calls are ignored.
 * - Events reach every listener in the order they happened, even when a
 *   listener calls the bus while it is being told about an event: the new
 *   event waits in a queue until the current one has reached everyone.
 */
export class NoteBus {
  private readonly holders = new Map<Midi, Set<NoteSource>>()
  private readonly listeners = new Set<NoteListener>()
  private snapshot: ReadonlySet<Midi> = new Set<Midi>()
  private readonly pending: NoteEvent[] = []
  private delivering = false

  noteOn(midi: Midi, source: NoteSource, options: NoteOnOptions = {}): void {
    let sources = this.holders.get(midi)
    if (sources?.has(source)) return
    if (!sources) {
      sources = new Set<NoteSource>()
      this.holders.set(midi, sources)
      this.refreshSnapshot()
    }
    sources.add(source)
    const velocity = clamp01(options.velocity ?? DEFAULT_VELOCITY)
    this.emit({ type: 'on', midi, velocity, source, time: options.time ?? now() })
  }

  noteOff(midi: Midi, source: NoteSource, time?: number): void {
    const sources = this.holders.get(midi)
    if (!sources || !sources.delete(source)) return
    if (sources.size > 0) return
    this.holders.delete(midi)
    this.refreshSnapshot()
    this.emit({ type: 'off', midi, source, time: time ?? now() })
  }

  /** Releases every note held by `source`, or by every source when omitted. */
  allOff(source?: NoteSource): void {
    for (const [midi, sources] of [...this.holders]) {
      for (const held of source === undefined ? [...sources] : [source]) {
        this.noteOff(midi, held)
      }
    }
  }

  isActive(midi: Midi): boolean {
    return this.holders.has(midi)
  }

  /**
   * Notes currently held by at least one source. The returned set is never
   * mutated: a new set is created whenever the held notes change, so it can
   * be used as a `useSyncExternalStore` snapshot.
   */
  getActiveNotes(): ReadonlySet<Midi> {
    return this.snapshot
  }

  /** Returns a function that removes the listener. */
  subscribe(listener: NoteListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private refreshSnapshot(): void {
    this.snapshot = new Set(this.holders.keys())
  }

  private emit(event: NoteEvent): void {
    this.pending.push(event)
    // Already inside a delivery (a listener called the bus): the loop below picks this event up.
    if (this.delivering) return
    this.delivering = true
    try {
      for (let next = this.pending.shift(); next !== undefined; next = this.pending.shift()) {
        this.deliver(next)
      }
    } finally {
      this.delivering = false
    }
  }

  private deliver(event: NoteEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        // One broken consumer must not leave the others with a stuck note.
        console.error('[NoteBus] listener failed', error)
      }
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VELOCITY
  return Math.min(1, Math.max(0, value))
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
