import type { PianoRange } from '../../core/layout'
import { keyRectOf } from '../../core/pianoGeometry'
import type { Midi, SparksLevel } from '../../core/types'
import type { PlayableNote } from '../../songs/song'

/**
 * The simulation behind the sky: the bars that rise from the keys, the notes
 * of a song that fall onto them, the glow where a sounding note meets the
 * line, and the sparks. No canvas, no clock and no randomness of its own:
 * what a function does depends only on what it is given, so all of it is
 * tested without a browser.
 *
 * The functions that move things change the lists they are given, in place.
 * They run sixty times a second, and making new lists and objects on every
 * frame would keep the browser busy cleaning up after them.
 *
 * Distances are CSS pixels. Heights are measured upward from the bottom edge
 * of the sky, which is the line where the light meets the piano.
 */

// ---------------------------------------------------------------------------
// Time and speed
// ---------------------------------------------------------------------------

/** The longest step one frame may take. Without it everything would jump after the tab was in the background. */
export const MAX_FRAME_MS = 50

/** How many seconds of music fit in the height of the sky. */
export const SKY_SECONDS = 3

/** Keeps the light lively in a very low sky (pixels per second). */
const MIN_SPEED = 120

/** The time one frame may move things by, in seconds, from the milliseconds since the previous frame. */
export function frameSeconds(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0
  return Math.min(elapsedMs, MAX_FRAME_MS) / 1000
}

/**
 * How fast light travels through the sky, in pixels per second: rising bars
 * climb at this speed, and one second of a song is this tall.
 */
export function skySpeed(skyHeight: number): number {
  return Math.max(MIN_SPEED, skyHeight / SKY_SECONDS)
}

// ---------------------------------------------------------------------------
// The shape of a bar
// ---------------------------------------------------------------------------

/** Even the quickest tap and the shortest note leave a bar this tall, so every note is seen. */
export const MIN_BAR_HEIGHT = 6

/** A bar is narrower than its key by this share of the key's width, within these limits. */
const BAR_GAP_SHARE = 0.16
const MIN_BAR_GAP = 2
const MAX_BAR_GAP = 6

const MAX_CORNER_RADIUS = 6
const CORNER_RADIUS_SHARE = 0.3

/** The width of the bar above a key that is `keyWidth` wide: a little narrower, so neighbours do not merge. */
export function barWidth(keyWidth: number): number {
  const gap = Math.min(MAX_BAR_GAP, Math.max(MIN_BAR_GAP, keyWidth * BAR_GAP_SHARE))
  return Math.max(1, keyWidth - gap)
}

/** The left edge of that bar: it is centred on its key. */
export function barLeft(keyLeft: number, keyWidth: number): number {
  return keyLeft + (keyWidth - barWidth(keyWidth)) / 2
}

/** How round the corners of a bar are. Never more than the bar can hold. */
export function barRadius(width: number, height: number): number {
  return Math.max(0, Math.min(MAX_CORNER_RADIUS, width * CORNER_RADIUS_SHARE, height / 2))
}

// ---------------------------------------------------------------------------
// Rising bars (free play)
// ---------------------------------------------------------------------------

export interface RisingBar {
  midi: Midi
  /** A black-key note: narrower, and drawn a little darker. */
  black: boolean
  /** Left edge and width of the key, 0..1 of the sky's width. */
  left: number
  width: number
  /** How far the lower end has risen above the line. Stays 0 while the note is held. */
  bottom: number
  height: number
  /** True while the note is held: the bar stands on the line and is still growing. */
  held: boolean
}

/** A stuck or flooding input can never make the list longer than this: the oldest bars go first. */
export const MAX_BARS = 200

/** The share of the sky, counted from its top, over which bars fade away. */
const FADE_FRACTION = 0.22

/** Reduced motion: the still glow above a held key is this share of the sky's height, within these limits. */
const STILL_GLOW_FRACTION = 0.18
const MIN_STILL_GLOW = 24
const MAX_STILL_GLOW = 120

/**
 * A note started: a new bar is born on its key. A bar that the same note was
 * still holding (the note was struck again) is let go first. Returns false,
 * and changes nothing, for a note that is not on the piano.
 */
export function startBar(bars: RisingBar[], midi: Midi, range: PianoRange): boolean {
  const key = keyRectOf(midi, range)
  if (!key) return false
  releaseBar(bars, midi)
  if (bars.length >= MAX_BARS) dropOldestBar(bars)
  bars.push({
    midi,
    black: key.black,
    left: key.left,
    width: key.width,
    bottom: 0,
    height: 0,
    held: true,
  })
  return true
}

/** A note ended: its bar leaves the line and will now rise as a whole. Returns false when the note had no held bar. */
export function releaseBar(bars: RisingBar[], midi: Midi): boolean {
  let released = false
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    if (!bar || !bar.held || bar.midi !== midi) continue
    bar.held = false
    bar.height = Math.max(bar.height, MIN_BAR_HEIGHT)
    released = true
  }
  return released
}

/** Removes the bars that were let go: all that is left is what reduced motion shows. */
export function keepHeldBars(bars: RisingBar[]): void {
  let kept = 0
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    if (bar?.held) bars[kept++] = bar
  }
  bars.length = kept
}

/**
 * Moves time forward: held bars grow, released bars rise, and bars that are
 * entirely above the top of the sky are removed.
 */
export function advanceBars(bars: RisingBar[], seconds: number, skyHeight: number): void {
  const distance = skySpeed(skyHeight) * seconds
  let kept = 0
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    if (!bar) continue
    // Whatever is above the top is never seen, so a note held for minutes does not grow without limit.
    if (bar.held) bar.height = Math.min(bar.height + distance, skyHeight)
    else bar.bottom += distance
    if (bar.bottom < skyHeight) bars[kept++] = bar
  }
  bars.length = kept
}

/** True while a frame would change the picture: a bar is rising, or a held one has not reached the top yet. */
export function barsAreMoving(bars: readonly RisingBar[], skyHeight: number): boolean {
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    if (bar && (!bar.held || bar.height < skyHeight)) return true
  }
  return false
}

/** Height of the zone at the top of the sky where bars fade out. */
export function fadeHeight(skyHeight: number): number {
  return skyHeight * FADE_FRACTION
}

/** Reduced motion: the height of the still glow that stands in for a bar. */
export function stillGlowHeight(skyHeight: number): number {
  const wanted = Math.min(MAX_STILL_GLOW, Math.max(MIN_STILL_GLOW, skyHeight * STILL_GLOW_FRACTION))
  return Math.min(skyHeight, wanted)
}

/** Makes room for a new bar. A bar that is still held is the last to go: it is the one being looked at. */
function dropOldestBar(bars: RisingBar[]): void {
  let index = 0
  for (let i = 0; i < bars.length; i++) {
    if (bars[i]?.held === false) {
      index = i
      break
    }
  }
  bars.splice(index, 1)
}

// ---------------------------------------------------------------------------
// Falling notes (a song is loaded)
// ---------------------------------------------------------------------------

/**
 * The notes of a song, prepared once so that each frame finds the few that
 * are on screen without looking at the whole song.
 */
export interface FallingIndex {
  /** Sorted by start time. */
  readonly notes: readonly PlayableNote[]
  /**
   * For each note, when the last of the notes up to and including it ends.
   * It never goes down, so it can be searched like a sorted list.
   */
  readonly latestEnd: Float64Array
}

export function indexFallingNotes(notes: readonly PlayableNote[]): FallingIndex {
  const latestEnd = new Float64Array(notes.length)
  let latest = Number.NEGATIVE_INFINITY
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    if (note) latest = Math.max(latest, note.time + note.duration)
    latestEnd[i] = latest
  }
  return { notes, latestEnd }
}

/**
 * The first note that may still be sounding or still to come at `position`
 * (seconds into the song): every note before it has ended. Found by halving,
 * never by walking through the song.
 */
export function firstUnfinishedNote(index: FallingIndex, position: number): number {
  const { latestEnd } = index
  let low = 0
  let high = latestEnd.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((latestEnd[middle] ?? 0) > position) high = middle
    else low = middle + 1
  }
  return low
}

/** The first note that starts at `time` or later: the notes before it are the ones that have appeared by then. */
export function firstNoteFrom(index: FallingIndex, time: number): number {
  const { notes } = index
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((notes[middle]?.time ?? 0) >= time) high = middle
    else low = middle + 1
  }
  return low
}

/**
 * How far above the line the lower end of a falling note is. It reaches 0
 * exactly when the note sounds, and is negative while the note sinks into
 * the line.
 */
export function fallingBottom(note: PlayableNote, position: number, speed: number): number {
  return (note.time - position) * speed
}

/** How tall a falling note is: its length in time, at the speed of the sky. */
export function fallingHeight(note: PlayableNote, speed: number): number {
  return Math.max(MIN_BAR_HEIGHT, note.duration * speed)
}

// ---------------------------------------------------------------------------
// Where a sounding note meets the line
// ---------------------------------------------------------------------------

/** The glow at the foot of one note, from the moment it is struck until its light has faded. */
export interface Impact {
  midi: Midi
  /** Middle and width of the key, 0..1 of the sky's width. */
  centre: number
  width: number
  /** True while the note sounds. */
  sounding: boolean
  /** How bright the glow is, 0..1: full while the note sounds, fading once it stops. */
  level: number
  /** 1 at the moment the note is struck, 0 once the flash has settled. */
  flash: number
  /** Sparks owed to this note. Births are spread evenly over time, whatever the frame rate. */
  sparkDebt: number
}

/** The flash of a new note settles within this time. */
export const FLASH_SECONDS = 0.15

/** After a note stops, its glow takes this long to fade (the keys do the same). */
export const AFTERGLOW_SECONDS = 0.25

/**
 * A note was struck: its glow lights up with a flash. A note that is struck
 * again while its glow is still there flashes again. Returns the glow, or
 * null for a note that is not on the piano.
 */
export function strikeImpact(impacts: Impact[], midi: Midi, range: PianoRange): Impact | null {
  const key = keyRectOf(midi, range)
  if (!key) return null
  let impact = findImpact(impacts, midi)
  if (!impact) {
    impact = { midi, centre: 0, width: 0, sounding: true, level: 1, flash: 1, sparkDebt: 0 }
    impacts.push(impact)
  }
  impact.centre = key.left + key.width / 2
  impact.width = key.width
  impact.sounding = true
  impact.level = 1
  impact.flash = 1
  return impact
}

/** A note stopped: its glow starts to fade. */
export function releaseImpact(impacts: Impact[], midi: Midi): void {
  const impact = findImpact(impacts, midi)
  if (impact) impact.sounding = false
}

/** Moves time forward: flashes settle, the glow of notes that stopped fades, and faded ones are removed. */
export function advanceImpacts(impacts: Impact[], seconds: number): void {
  let kept = 0
  for (let i = 0; i < impacts.length; i++) {
    const impact = impacts[i]
    if (!impact) continue
    impact.flash = Math.max(0, impact.flash - seconds / FLASH_SECONDS)
    if (!impact.sounding) impact.level -= seconds / AFTERGLOW_SECONDS
    if (impact.sounding || impact.level > 0) impacts[kept++] = impact
  }
  impacts.length = kept
}

/** Reduced motion: no flash and no fading. A sounding note has its glow, any other has none. */
export function settleImpacts(impacts: Impact[]): void {
  let kept = 0
  for (let i = 0; i < impacts.length; i++) {
    const impact = impacts[i]
    if (!impact?.sounding) continue
    impact.level = 1
    impact.flash = 0
    impacts[kept++] = impact
  }
  impacts.length = kept
}

/** True while a frame would change a glow: one is flashing or fading. */
export function impactsAreMoving(impacts: readonly Impact[]): boolean {
  for (let i = 0; i < impacts.length; i++) {
    const impact = impacts[i]
    if (impact && (!impact.sounding || impact.flash > 0)) return true
  }
  return false
}

/** How many notes are sounding right now. */
export function soundingCount(impacts: readonly Impact[]): number {
  let count = 0
  for (let i = 0; i < impacts.length; i++) {
    if (impacts[i]?.sounding) count++
  }
  return count
}

function findImpact(impacts: readonly Impact[], midi: Midi): Impact | null {
  for (let i = 0; i < impacts.length; i++) {
    const impact = impacts[i]
    if (impact && impact.midi === midi) return impact
  }
  return null
}

// ---------------------------------------------------------------------------
// How much is sounding: chords glow brighter than single notes
// ---------------------------------------------------------------------------

/** The line and the background follow the number of sounding notes quickly when it rises, slowly when it falls. */
const PRESENCE_RISE_SECONDS = 0.07
const PRESENCE_FALL_SECONDS = 0.35
/**
 * It never moves slower than this many notes a second, so that it arrives:
 * the sky can only go still once it has.
 */
const PRESENCE_SLOWEST = 1.5

/** The number of notes after which the line hardly gets brighter. */
const LINE_GLOW_NOTES = 3

/** The background is at most this much brighter, once this many notes sound. */
export const MAX_BACKGROUND_BOOST = 0.25
const FULL_BOOST_NOTES = 8

/**
 * "Presence" is the number of sounding notes with the jumps smoothed out.
 * This moves it toward the real count and returns the new value, which is
 * exactly `sounding` once it gets there.
 */
export function easePresence(presence: number, sounding: number, seconds: number): number {
  const distance = sounding - presence
  const pace = distance > 0 ? PRESENCE_RISE_SECONDS : PRESENCE_FALL_SECONDS
  const eased = Math.abs(distance) * (1 - Math.exp(-seconds / pace))
  const step = Math.max(eased, PRESENCE_SLOWEST * seconds)
  if (step >= Math.abs(distance)) return sounding
  return presence + Math.sign(distance) * step
}

/** How strongly the whole line glows, 0..1: more with every note, but gently, and never past 1. */
export function lineGlow(presence: number): number {
  return 1 - Math.exp(-Math.max(0, presence) / LINE_GLOW_NOTES)
}

/** How much brighter the background is drawn, 0..MAX_BACKGROUND_BOOST. */
export function backgroundBoost(presence: number): number {
  return MAX_BACKGROUND_BOOST * Math.min(1, Math.max(0, presence) / FULL_BOOST_NOTES)
}

// ---------------------------------------------------------------------------
// Sparks
// ---------------------------------------------------------------------------

/** Never more sparks than this, whatever is played. */
export const MAX_SPARKS = 600

/**
 * Sparks born per second for each sounding note, and at the moment a note is
 * struck. Ten notes held together at the highest level stay well inside
 * MAX_SPARKS: 10 notes x 42 a second x about a second of life, plus their
 * strikes, is under 550.
 */
const SPARKS_PER_SECOND: Readonly<Record<SparksLevel, number>> = { off: 0, some: 14, lots: 42 }
const SPARKS_PER_STRIKE: Readonly<Record<SparksLevel, number>> = { off: 0, some: 5, lots: 12 }

/** A spark lives between these two, in seconds. */
const SPARK_MIN_LIFE = 0.45
const SPARK_MAX_LIFE = 1.05
/** It leaves the line at between these speeds (pixels per second), drifting sideways by up to this much. */
const SPARK_MIN_RISE = 60
const SPARK_MAX_RISE = 180
const SPARK_MAX_DRIFT = 38
/** Sparks thrown by a strike leave faster than the steady ones. */
const STRIKE_SPEED_UP = 1.5
/** How quickly a spark loses its speed: after 1 / SPARK_DRAG seconds it has lost about two thirds of it. */
const SPARK_DRAG = 2.2
/** Radius of the bright centre, in pixels. */
const SPARK_MIN_RADIUS = 0.9
const SPARK_MAX_RADIUS = 2.3
/** Sparks are born across this share of the key's width, around its middle. */
const SPARK_SPREAD = 0.7

/**
 * Every live spark, as columns of numbers: spark `i` is `x[i]`, `y[i]` and so
 * on, for `i` below `count`. The columns are made once and reused for ever.
 */
export interface Sparks {
  count: number
  /** Pixels from the left edge of the sky. */
  readonly x: Float32Array
  /** Pixels above the line. */
  readonly y: Float32Array
  /** Pixels per second: to the right, and upward. */
  readonly vx: Float32Array
  readonly vy: Float32Array
  /** Seconds lived so far, and seconds it will live in all. */
  readonly age: Float32Array
  readonly life: Float32Array
  /** Radius of the bright centre when the spark is born. */
  readonly radius: Float32Array
  /** The note it came from, which gives it its colour. */
  readonly midi: Uint8Array
}

export function createSparks(): Sparks {
  return {
    count: 0,
    x: new Float32Array(MAX_SPARKS),
    y: new Float32Array(MAX_SPARKS),
    vx: new Float32Array(MAX_SPARKS),
    vy: new Float32Array(MAX_SPARKS),
    age: new Float32Array(MAX_SPARKS),
    life: new Float32Array(MAX_SPARKS),
    radius: new Float32Array(MAX_SPARKS),
    midi: new Uint8Array(MAX_SPARKS),
  }
}

/** The sparks that fly at the moment a note is struck. `random` gives numbers from 0 up to 1. */
export function strikeSparks(
  sparks: Sparks,
  impact: Impact,
  level: SparksLevel,
  skyWidth: number,
  random: () => number,
): void {
  for (let i = 0; i < SPARKS_PER_STRIKE[level]; i++) {
    addSpark(sparks, impact, skyWidth, STRIKE_SPEED_UP, random)
  }
}

/** The steady trickle of sparks from every note that is sounding, for `seconds` of time. */
export function emitSparks(
  sparks: Sparks,
  impacts: readonly Impact[],
  level: SparksLevel,
  seconds: number,
  skyWidth: number,
  random: () => number,
): void {
  const rate = SPARKS_PER_SECOND[level]
  if (rate === 0) return
  for (let i = 0; i < impacts.length; i++) {
    const impact = impacts[i]
    if (!impact?.sounding) continue
    impact.sparkDebt += rate * seconds
    while (impact.sparkDebt >= 1) {
      impact.sparkDebt -= 1
      addSpark(sparks, impact, skyWidth, 1, random)
    }
  }
}

/** Moves time forward: sparks fly on, slow down, and the ones whose time is up are removed. */
export function advanceSparks(sparks: Sparks, seconds: number): void {
  const { x, y, vx, vy, age, life } = sparks
  const slowing = Math.exp(-SPARK_DRAG * seconds)
  let i = 0
  while (i < sparks.count) {
    const lived = (age[i] ?? 0) + seconds
    if (lived >= (life[i] ?? 0)) {
      removeSpark(sparks, i)
      // The last spark now sits at `i`: it is looked at next.
      continue
    }
    age[i] = lived
    vx[i] = (vx[i] ?? 0) * slowing
    vy[i] = (vy[i] ?? 0) * slowing
    x[i] = (x[i] ?? 0) + (vx[i] ?? 0) * seconds
    y[i] = (y[i] ?? 0) + (vy[i] ?? 0) * seconds
    i++
  }
}

/** How much of its life spark `i` has left, 1 (just born) to 0 (gone). It fades and shrinks with this. */
export function sparkStrength(sparks: Sparks, i: number): number {
  const life = sparks.life[i] ?? 0
  if (!(life > 0)) return 0
  return Math.max(0, 1 - (sparks.age[i] ?? 0) / life)
}

function addSpark(
  sparks: Sparks,
  impact: Impact,
  skyWidth: number,
  speedUp: number,
  random: () => number,
): void {
  if (sparks.count >= MAX_SPARKS) return
  const i = sparks.count++
  const spread = (random() - 0.5) * impact.width * SPARK_SPREAD
  sparks.x[i] = (impact.centre + spread) * skyWidth
  sparks.y[i] = 0
  sparks.vx[i] = (random() - 0.5) * 2 * SPARK_MAX_DRIFT
  sparks.vy[i] = between(SPARK_MIN_RISE, SPARK_MAX_RISE, random()) * speedUp
  sparks.age[i] = 0
  sparks.life[i] = between(SPARK_MIN_LIFE, SPARK_MAX_LIFE, random())
  sparks.radius[i] = between(SPARK_MIN_RADIUS, SPARK_MAX_RADIUS, random())
  sparks.midi[i] = impact.midi
}

/** Takes spark `i` out by moving the last one into its place: their order does not matter. */
function removeSpark(sparks: Sparks, i: number): void {
  const last = --sparks.count
  if (i === last) return
  sparks.x[i] = sparks.x[last] ?? 0
  sparks.y[i] = sparks.y[last] ?? 0
  sparks.vx[i] = sparks.vx[last] ?? 0
  sparks.vy[i] = sparks.vy[last] ?? 0
  sparks.age[i] = sparks.age[last] ?? 0
  sparks.life[i] = sparks.life[last] ?? 0
  sparks.radius[i] = sparks.radius[last] ?? 0
  sparks.midi[i] = sparks.midi[last] ?? 0
}

function between(low: number, high: number, share: number): number {
  return low + (high - low) * share
}

// ---------------------------------------------------------------------------
// Numbers that look random but are the same every time
// ---------------------------------------------------------------------------

/**
 * A generator of numbers from 0 up to 1 that always gives the same sequence
 * for the same seed (the "mulberry32" recipe). The stars use it so that they
 * do not move from one draw to the next, and the tests so that they can be
 * repeated.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

/** How many numbers describe one star: across, down, radius, brightness. */
export const STAR_FIELDS = 4

/** The higher this is, the more the stars crowd toward the top of the sky. 1 would spread them evenly. */
const STAR_CROWDING = 1.8
const STAR_MIN_RADIUS = 0.35
const STAR_MAX_RADIUS = 1.25
const STAR_MIN_BRIGHTNESS = 0.12
const STAR_MAX_BRIGHTNESS = 0.9

/**
 * `count` stars, STAR_FIELDS numbers each: how far across the sky and how
 * far down it (both 0..1), the radius in pixels, and the brightness (0..1).
 * More of them are near the top, and most are small and faint. The same
 * seed always gives the same stars.
 */
export function starField(count: number, seed: number): Float32Array {
  const random = seededRandom(seed)
  const stars = new Float32Array(Math.max(0, Math.floor(count)) * STAR_FIELDS)
  for (let at = 0; at < stars.length; at += STAR_FIELDS) {
    const size = random() ** 3
    stars[at] = random()
    stars[at + 1] = random() ** STAR_CROWDING
    stars[at + 2] = between(STAR_MIN_RADIUS, STAR_MAX_RADIUS, size)
    stars[at + 3] = between(STAR_MIN_BRIGHTNESS, STAR_MAX_BRIGHTNESS, (size + random()) / 2)
  }
  return stars
}
