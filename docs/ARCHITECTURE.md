# Piano app: architecture and Phase 1 spec

This is the source of truth for how the app is put together. `ROADMAP.md` (repo root) lists the phases.

> **The screen has been redesigned.** `docs/INTERFACE.md` replaces sections 5.6, 5.7, 5.8 and 6 of this document (the piano component, the app shell, the light trails and the visual direction) and adds to sections 5.1 to 5.3. `docs/SONGS.md` describes songs. Where they disagree with this document, they win.

## 1. Who it is for and what Phase 1 must do

The app is for casual players, not programmers, who play with a **computer keyboard** in a desktop browser (Chrome or Edge). The guiding goal: something simple that plays easily, with no Shift and no double key presses.

Hard rules that follow from that:

- **One key = one note.** No Shift, no Ctrl, no key combinations, anywhere in the app.
- **Nothing has to be held down to change how the piano behaves.** Sustain is an on/off toggle, not a held pedal.
- Wording in the UI is plain and short. No jargon ("MIDI", "binding", "slot", "octave shift") in user-facing text. Say "key", "note", "lower / higher".
- The piano must feel instant: a key press makes sound with no noticeable delay.
- **Easy to navigate.** One screen, no hidden menus: the modes are tabs at the top, every control is visible and labelled with a plain word, and the same things stay in the same place. A first-time user should understand the whole screen in a few seconds.
- **Elegant and interactive with the piano.** The piano is the centre of the screen and reacts to everything: keys light up and dip when played, glowing trails rise from the keys being played (section 5.8), hovering a key gives gentle feedback. Polished, restrained, never gaudy.

- **Simple first, advanced on demand.** Easy for a beginner, customizable for an experienced pianist. The main screen stays simple and works with zero configuration. Everything an experienced player may want to tune lives in an **Advanced** panel that is closed by default, where every option has a plain one-line explanation and a sensible default, and can be reset. Later phases follow the same rule (their fine-tuning options go in the same panel).
- The app's name is a **placeholder** (`APP_NAME` in `src/app/appInfo.ts`, currently "PianoApp"). Never hard-code the name anywhere else.

Phase 1 = **the playable piano (Free Play)**:

1. An on-screen piano of 37 keys (3 octaves + top C).
2. Computer keys play notes; each piano key shows the computer key that plays it.
3. Real piano sound (sampled grand piano), with a basic built-in sound as fallback while samples load or when offline.
4. Volume slider, sustain on/off, buttons to move the piano lower/higher, a choice of what labels to show on the keys.
5. **Customizable keys**: click a piano key, press the computer key you want for it. Saved automatically. Reset to default.
6. Mouse / touch on the on-screen keys also plays.
7. Everything the user changes is remembered next time (localStorage).
8. An **Advanced** panel (closed by default): touch strength, transpose, note names as C D E or Do Ré Mi, room echo, how long notes ring after release, light trails on/off.

Later phases (do not build now, but do not block them): record/replay and metronome, Practice mode (song waits for the right key), Real-time mode (timed, scored), real-instrument input from audio, sheet music mode.

## 2. Stack and commands

- Vite 8, React 19, TypeScript 7 (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`: use `import type` for types), Tone.js 15, Vitest 5.
- Plain CSS files using the variables in `src/styles/theme.css`. No CSS framework, no UI library, no state library, no extra npm dependencies.
- `npm run dev` (port 5173, strict) · `npm run typecheck` · `npm test` · `npm run build`.
- Tests are Vitest (`src/**/*.test.{ts,tsx}`). The default environment is `node`; a test that needs a DOM opts in with `// @vitest-environment jsdom` on its first line and uses Testing Library (`jsdom`, `@testing-library/react` and `@testing-library/user-event` are dev dependencies). Pure logic still takes the DOM or `localStorage` as a parameter, so it can be tested with a fake.

## 3. The one idea everything hangs on

```
Inputs                         NoteBus                     Consumers
computer keyboard ─┐                                   ┌─▶ AudioEngine (sound)
mouse / touch ─────┼─▶ noteOn / noteOff (midi, source) ┼─▶ on-screen piano (lit keys)
real instrument ───┘        src/core/noteBus.ts        └─▶ practice / scoring (later)
(later)
```

Inputs never talk to the sound engine or the UI directly. They call the bus. Consumers subscribe to the bus. This is what lets later phases add a new input (audio from a real keyboard) or a new consumer (scoring) without touching the others.

**Slots.** The on-screen piano is a window of `SLOT_COUNT = 37` keys. Slot 0 is the C of `baseOctave` (default 3, so slots cover C3..C6 and middle C is slot 12). A key binding maps a physical computer key (`KeyboardEvent.code`) to a **slot**, not to an absolute note, so moving the piano lower/higher moves all bound keys with it.

**Physical keys.** Bindings use `KeyboardEvent.code` (physical position, e.g. `KeyA`, `Semicolon`), never `KeyboardEvent.key`, so the default layout sits on the same physical keys on any keyboard layout (QWERTY, AZERTY, Canadian French…). The *label* shown to the user is the character printed on their keyboard, resolved by `src/input/keyLabels.ts`.

## 4. File map

| File | What it is |
|---|---|
| `src/core/types.ts` | `Midi`, `NoteSource`, `NoteEvent`, `LabelMode` types. **Done, read-only.** |
| `src/core/notes.ts` | Note names, black/white, `toneName`. **Done, read-only.** |
| `src/core/layout.ts` | `SLOT_COUNT`, base-octave limits, `slotToMidi`, `midiToSlot`. **Done, read-only.** |
| `src/core/noteBus.ts` | `NoteBus` class. **Done, read-only.** |
| `src/core/keyGeometry.ts` | `KEY_RECTS` / `keyRect(slot)`: where each key sits across the piano (fractions of its width). The piano and the note trails both use it so they line up. **Done, read-only.** |
| `src/ui/NoteTrails.tsx`, `src/ui/noteTrails.css` | Canvas above the piano: glowing trails rise from the keys being played. |
| `src/styles/theme.css` | Design tokens (CSS variables) and base styles. **Done, read-only.** |
| `src/input/keymap.ts` (+ test) | Default bindings and pure functions to change them. |
| `src/input/keyLabels.ts` (+ test) | Physical key → the character printed on the user's keyboard. |
| `src/state/settings.ts` (+ test) | Persistent settings store + `useSettings` hook. |
| `src/audio/audioEngine.ts` (+ test for pure helpers) | Sound: sampled piano, fallback synth, sustain, volume. |
| `src/input/keyboardInput.ts` (+ test) | Computer keyboard → bus. |
| `src/ui/Piano.tsx`, `src/ui/piano.css` | The on-screen piano component (pointer input, lit keys, labels). |
| `src/app/pianoApp.ts` | Creates the singletons (bus, engine) and wires bus → engine. |
| `src/App.tsx`, `src/main.tsx`, `src/styles/app.css` | App shell and wiring. |
| `src/ui/Toolbar.tsx`, `src/ui/KeyEditor.tsx`, `src/ui/StartOverlay.tsx` | Controls, key customization panel, "click to start" overlay. |
| `src/ui/AdvancedPanel.tsx` | The Advanced settings panel (closed by default). |
| `src/app/appInfo.ts` | `APP_NAME`, the placeholder app name. **Done, read-only.** |

"Read-only" files: do not change them. If you believe one has a bug, say so in your report instead.

## 5. Module contracts

Export exactly these names with exactly these signatures. Extra **non-exported** helpers are fine; extra exports only when a test needs them.

### 5.1 `src/input/keymap.ts` (pure, no DOM, no React)

```ts
/** KeyboardEvent.code -> slot (0..SLOT_COUNT-1). */
export type Bindings = Readonly<Record<string, number>>

export const DEFAULT_BINDINGS: Bindings

/** True for keys the user may bind (see the allow-list below). */
export function isBindableCode(code: string): boolean

/** The key bound to `slot`, or null. */
export function codeForSlot(bindings: Bindings, slot: number): string | null

export interface AssignResult {
  bindings: Bindings
  /** A different key that used to play `slot` and now plays nothing (null if none). */
  replacedCode: string | null
  /** The slot `code` used to play, which now has no key (null if `code` was unbound or already on `slot`). */
  vacatedSlot: number | null
}

/** Makes `code` play `slot`. Throws RangeError if the code is not bindable or the slot is invalid. Never mutates its input. */
export function assignBinding(bindings: Bindings, code: string, slot: number): AssignResult

/** Removes whatever key is bound to `slot`. Returns the same object if nothing was bound. */
export function clearSlot(bindings: Bindings, slot: number): Bindings

/**
 * Cleans data read from storage. Returns null when `raw` is not a plain object
 * (caller then uses DEFAULT_BINDINGS). Otherwise keeps only entries with a
 * bindable code and a valid slot; if two codes point at the same slot, the
 * first one in iteration order wins. An empty object is valid (all keys cleared).
 */
export function sanitizeBindings(raw: unknown): Bindings | null
```

Invariant everywhere: **one key ↔ one note** (a code maps to at most one slot, and a slot has at most one code).

Default bindings (US-QWERTY positions shown; stored as codes). Home row = white keys, row above = black keys, starting at middle C:

| Note | C | C♯ | D | D♯ | E | F | F♯ | G | G♯ | A | A♯ | B | C | C♯ | D | D♯ | E | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Slot | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 |
| Key | A | W | S | E | D | F | T | G | Y | H | U | J | K | O | L | P | ; | ' |
| Code | KeyA | KeyW | KeyS | KeyE | KeyD | KeyF | KeyT | KeyG | KeyY | KeyH | KeyU | KeyJ | KeyK | KeyO | KeyL | KeyP | Semicolon | Quote |

Bindable codes (allow-list): `KeyA`…`KeyZ`, `Digit0`…`Digit9`, `Minus`, `Equal`, `BracketLeft`, `BracketRight`, `Backslash`, `Semicolon`, `Quote`, `Backquote`, `Comma`, `Period`, `Slash`, `IntlBackslash`, `IntlRo`, `IntlYen`, `Numpad0`…`Numpad9`, `NumpadDecimal`, `NumpadAdd`, `NumpadSubtract`, `NumpadMultiply`, `NumpadDivide`. Everything else (Space, Enter, Tab, Escape, Backspace, Delete, arrows, F-keys, modifiers, CapsLock, navigation keys…) is not bindable.

### 5.2 `src/input/keyLabels.ts`

```ts
export type LayoutMap = ReadonlyMap<string, string>

/** US-QWERTY label for a code: 'KeyA'→'A', 'Digit1'→'1', 'Semicolon'→';', 'Quote'→"'", 'Numpad1'→'Num 1', 'NumpadAdd'→'Num +'. Unknown codes return the code itself. */
export function defaultKeyLabel(code: string): string

/** Turns KeyboardEvent.key into a label: a single printable, non-space character → upper-cased (locale-independent); anything else ('Dead', 'Shift', 'Enter', '') → null. */
export function labelFromEventKey(key: string): string | null

/** Label to show for a physical key. Priority: layoutMap (current layout) → customLabels (captured when the user bound the key) → defaultKeyLabel. Letters are upper-cased. */
export function keyLabel(
  code: string,
  layoutMap: LayoutMap | null,
  customLabels?: Readonly<Record<string, string>>,
): string

/** navigator.keyboard.getLayoutMap() when the browser has it (Chrome/Edge); null otherwise or on failure. Never rejects. */
export function loadLayoutMap(): Promise<LayoutMap | null>

/** React hook: null until loaded (or forever when unsupported). */
export function useLayoutMap(): LayoutMap | null
```

`navigator.keyboard` is not in the TypeScript DOM lib; declare the minimal shape locally.

### 5.3 `src/state/settings.ts`

```ts
/** Defined in src/core/types.ts; re-exported here for convenience. */
export type { LabelMode, NoteNaming, ReleaseLength } from '../core/types'

export interface Settings {
  bindings: Bindings
  /** code -> label captured from KeyboardEvent.key when the user bound that key. */
  customLabels: Readonly<Record<string, string>>
  baseOctave: number      // MIN_BASE_OCTAVE..MAX_BASE_OCTAVE
  volume: number          // 0..1
  sustain: boolean
  labelMode: LabelMode

  // Advanced settings (the Advanced panel). Defaults suit a beginner.
  velocity: number        // "Touch": how hard notes are played, MIN_VELOCITY..1
  transpose: number       // whole semitones, -MAX_TRANSPOSE..MAX_TRANSPOSE
  noteNaming: NoteNaming  // 'letters' (C D E) or 'solfege' (Do Ré Mi)
  reverb: number          // "Room echo", 0..1
  release: ReleaseLength  // how long a note rings after its key is released
  showTrails: boolean     // light trails above the piano
}

export const MIN_VELOCITY = 0.1
export const MAX_TRANSPOSE = 12

/** The keys of Settings that the Advanced panel controls (used by "Reset advanced settings"). */
export const ADVANCED_KEYS: readonly (keyof Settings)[]   // velocity, transpose, noteNaming, reverb, release, showTrails

// DEFAULT_BINDINGS, {}, DEFAULT_BASE_OCTAVE, volume 0.8, sustain false, labelMode 'both',
// velocity 0.8, transpose 0, noteNaming 'letters', reverb 0.15, release 'normal', showTrails true
export const DEFAULT_SETTINGS: Settings
export const STORAGE_KEY = 'pianoapp.settings.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Turns anything (parsed JSON, garbage, null) into valid Settings; every invalid or missing field falls back to its default. */
export function sanitizeSettings(raw: unknown): Settings

export interface SettingsStore {
  /** Current settings. Same object reference until something changes. */
  get(): Settings
  /** Merges, sanitizes, saves, notifies. No notification (and no new object) when nothing actually changed. */
  set(patch: Partial<Settings>): void
  /** Back to DEFAULT_SETTINGS (saved and notified). */
  reset(): void
  /** Puts only the given keys back to their defaults (saved and notified). */
  resetKeys(keys: readonly (keyof Settings)[]): void
  subscribe(listener: () => void): () => void
}

/** `storage` null/undefined → in-memory only. Storage errors (private mode, quota, corrupt JSON) must never throw out of the store. */
export function createSettingsStore(storage?: StorageLike | null): SettingsStore

/** App-wide singleton backed by window.localStorage when available. Importing this module must not throw in Node. */
export const settingsStore: SettingsStore

/** React hook over `settingsStore` (useSyncExternalStore). */
export function useSettings(): Settings
```

`customLabels` sanitizing: keep only entries whose code is bindable and whose value is a string of 1–6 characters.

Number sanitizing: non-numbers and non-finite values fall back to the default; in-range rule is clamp (`volume`, `reverb` to 0..1; `velocity` to MIN_VELOCITY..1; `transpose` rounded to a whole number then clamped to ±MAX_TRANSPOSE; `baseOctave` via `clampBaseOctave`). Unknown enum strings fall back to the default. Unknown extra keys are dropped. Settings saved by an older version that lacks the newer fields simply get the defaults for them.

### 5.4 `src/audio/audioEngine.ts`

```ts
export type AudioStatus =
  | 'idle'      // start() not called yet
  | 'loading'   // audio is running, piano samples still loading: the basic sound plays meanwhile
  | 'ready'     // sampled piano loaded
  | 'fallback'  // samples could not be loaded (offline): basic sound only
  | 'error'     // audio could not start at all

export interface AudioEngine {
  /** Call from a user gesture (click / key press). Safe to call many times (concurrent calls share one attempt). Resolves once sound can play (the basic sound counts). Never rejects: failures set status 'error', and calling start() again after an error retries. */
  start(): Promise<void>
  getStatus(): AudioStatus
  subscribe(listener: () => void): () => void
  noteOn(midi: Midi, velocity?: number): void   // no-op before start()
  noteOff(midi: Midi): void
  setSustain(on: boolean): void
  setVolume(volume: number): void                // 0..1, may be called before start()
  /** Whole semitones (clamped to ±12). The sound is `midi + semitones`; `midi` itself (the key) is unchanged. */
  setTranspose(semitones: number): void
  /** "Room echo": 0 = none … 1 = a lot. */
  setReverb(amount: number): void
  /** How long a note takes to fade after it is released, in seconds (clamped to 0.05..5). */
  setRelease(seconds: number): void
  allNotesOff(): void                            // silences everything, including sustained notes
  dispose(): void
}

/** Seconds for each ReleaseLength: short 0.25, normal 1, long 2.5. */
export const RELEASE_SECONDS: Readonly<Record<ReleaseLength, number>>

export interface AudioEngineOptions {
  /** Where the piano samples are loaded from. */
  sampleBaseUrl?: string
}

export const DEFAULT_SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'

export function createAudioEngine(options?: AudioEngineOptions): AudioEngine

/** Pure helper (unit-tested): 0 → -Infinity (silent); 1 → 0 dB; in between a perceptual curve (e.g. 40·log10(v)). Clamps out-of-range and non-finite input. */
export function volumeToDb(volume: number): number
```

Requirements:

- **Low latency.** Tone's default 0.1 s look-ahead must not delay notes: use a context with `latencyHint: 'interactive'` and `lookAhead: 0` (or schedule with `immediate()`), and trigger notes without added delay.
- **Sampled piano**: `Tone.Sampler` with the Salamander set at `sampleBaseUrl` (files named `A0.mp3`, `C1.mp3`, `Ds1.mp3`, `Fs1.mp3`, `A1.mp3` … `C8.mp3`: every minor third; `Ds` = D♯, `Fs` = F♯). Use `toneName(midi)` for note names.
- **Fallback sound**: a simple polyphonic synth with a piano-like envelope (fast attack, long decay). Used while status is `loading` and when it is `fallback`. Switching to the sampler when it finishes loading must not cut or duplicate notes that are sounding.
- **Sustain** (engine-level): while sustain is on, `noteOff` does not stop the note (it rings out naturally). Turning sustain off releases every note that is no longer held. A note that is re-pressed while sustained re-triggers. The engine tracks which notes are held itself.
- **Volume**: master volume via `volumeToDb`; add a limiter or gentle compressor on the master so many simultaneous notes do not clip.
- **All setters may be called before `start()`** (the values are remembered and applied when audio starts) and at any time afterwards.
- **Transpose**: the engine plays `midi + transpose` but all its bookkeeping stays keyed by the original `midi`, and each sounding note remembers the pitch it was actually started at, so a note is always released at the pitch it was started with even if the transpose changed meanwhile. A transposed pitch outside the piano (21..108) is silently not played. Changing the transpose does not need to re-pitch notes that are already sounding.
- **Room echo**: a reverb send mixed with the dry signal by `amount`. The dry signal must never be delayed by it. If the reverb needs time to prepare (e.g. generating an impulse response), sound plays dry until it is ready. At amount 0 nothing audible is added.
- **Release**: applies to the fallback synth for notes released from then on, and to the sampled piano for notes struck from then on (Tone's sampler fixes a note's fade-out when the note starts).
- **Sample loading is retried**: when a sample file fails to load, the engine tries again (up to two more times, a few seconds apart, status stays `loading`) before settling on `fallback`.
- **A start that is waiting for the browser is nudged**: when `start()` is called again while an earlier attempt is still waiting for the browser to allow sound (the first key was one the browser does not count as a gesture, such as Escape or Shift), the engine asks the browser again instead of only waiting.
- **Autoplay policy**: do not create or resume an AudioContext before `start()` is called from a user gesture, and avoid the browser's "AudioContext was not allowed to start" console warning if feasible (e.g. load Tone with a dynamic `import('tone')` inside `start()`, or create the context lazily). If the context is later found suspended, `noteOn` should try to resume it.
- `noteOn`/`noteOff` must never throw (invalid midi, not started, disposed → ignore).
- Works under React StrictMode / hot reload: `dispose()` releases everything; calling methods after dispose is harmless.

### 5.5 `src/input/keyboardInput.ts`

```ts
export interface KeyEventTarget {
  addEventListener(type: string, listener: (event: never) => void, options?: unknown): void
  removeEventListener(type: string, listener: (event: never) => void, options?: unknown): void
}

export interface KeyboardInputOptions {
  bus: NoteBus
  /** Which note this physical key plays right now, or null if it plays nothing. Called on key down. */
  resolveNote(code: string): Midi | null
  /** Called first for every keydown, including auto-repeat. Return true to consume the event: no note, default prevented. */
  intercept?(event: KeyboardEvent): boolean
  /** Space was tapped (never called for auto-repeat). */
  onToggleSustain?(): void
  /** How hard new notes are played (0..1). Called on key down. Defaults to the bus default. */
  getVelocity?(): number
  /** Defaults to `window`. Also receives the `blur` listener. */
  target?: KeyEventTarget
}

/** Starts listening; returns a function that stops listening and releases any notes still held by the keyboard. */
export function attachKeyboardInput(options: KeyboardInputOptions): () => void

/** True when the event target is somewhere the user types text (text-like <input>, <textarea>, <select>, contenteditable). Range sliders, checkboxes and buttons are NOT text entry. Must work with plain objects in tests (duck-typed on tagName/type/isContentEditable). */
export function isTextEntryTarget(target: unknown): boolean
```

Behaviour:

- Sends notes to the bus with source `'keyboard'`, passing `event.timeStamp` as the time when it is a finite number.
- Key down: ignore auto-repeat (`event.repeat`) for playing (but still prevent default for a bound key). Ignore the event entirely when Ctrl, Alt or Meta is held (browser shortcuts keep working) or when `isTextEntryTarget(event.target)`. Shift is ignored: the key plays the same note with or without it.
- Remember which note each physical key started (`Map<code, midi>`), and on key up release **that** note, even if bindings or the base octave changed in between. A key that is already down does not start a second note.
- `preventDefault()` for bound keys and Space (stops page scrolling and Firefox quick-find on `'` and `/`). Unbound keys keep their default behaviour.
- Space (`code === 'Space'`) calls `onToggleSustain` once per tap, including when a button has focus, without also "clicking" that button (no double toggle, no accidental button press).
- Window `blur` (and `visibilitychange` to hidden when a document is available) releases every keyboard-held note, so notes never get stuck when the user alt-tabs.
- Releasing the Meta key (Command / Windows) releases every keyboard-held note: while it is down, some systems never deliver the key-up of other keys.
- The keyboard's own record of which key holds which note follows the bus: when a note is released by someone else (for example `bus.allOff()` when the piano moves), the keys that were holding it no longer count as holding it.

### 5.6 `src/ui/Piano.tsx` + `src/ui/piano.css`

```ts
export interface PianoProps {
  baseOctave: number
  /** Notes to draw as pressed. */
  activeNotes: ReadonlySet<Midi>
  labelMode: LabelMode
  /** How note names are written on the keys and in aria-labels (pass to `noteName` / `pitchName`). */
  noteNaming: NoteNaming
  /** slot -> label of the computer key that plays it. Missing = no key. */
  keyLabels: ReadonlyMap<number, string>
  /** Pointer pressed / released a key. Not called in edit mode. */
  onNoteDown(midi: Midi): void
  onNoteUp(midi: Midi): void
  /** Edit mode: clicking a key selects it instead of playing it. */
  editMode?: boolean
  selectedSlot?: number | null
  onSelectSlot?(slot: number): void
}

export function Piano(props: PianoProps): JSX.Element   // (React 19: return type React.JSX.Element)
```

- Draws `SLOT_COUNT` keys starting at `slotToMidi(0, baseOctave)`: 22 white keys in a row, 15 black keys on top in the right places. **Horizontal positions and widths come from `KEY_RECTS` in `src/core/keyGeometry.ts`** (as percentages of the piano's width), so the note trails line up with the keys exactly. The piano fills 100% of the width of its container and keeps realistic proportions through its height (`aspect-ratio`, with a sensible min and max height). It does not scroll horizontally and has no horizontal padding or border of its own that would shift keys relative to the container's edges: the parent decides the width.
- Interactive feel: keys dip slightly and light up when pressed (short, snappy transition on press, slightly softer on release), white keys get a soft glow at the bottom when lit, and hovering a key with the mouse gives a subtle highlight.
- Labels per `labelMode`: `'keys'` = computer-key label only, `'notes'` = note name only, `'both'`, `'none'`. The computer-key label is the prominent one (looks like a small keycap). Note names: on white keys show the full name on C keys (`C4` / `Do4`) and just the pitch name elsewhere; on black keys show the pitch name (`C♯` / `Do♯`) small. Solfège names are longer (`Sol♯`): size the text so they fit without overflowing the key. Keys with no bound key simply have no keycap.
- Pressed keys (in `activeNotes`) are clearly lit with the accent colours from the theme.
- Pointer input (mouse, touch, pen) with Pointer Events: press plays, release stops; dragging across keys with the button held plays each key passed over (glissando) and releases the previous one; multi-touch plays several keys; leaving the piano or `pointercancel` releases. A fast drag does not skip keys: every key on the straight line between two pointer positions is played, in order (coalesced pointer events are used when the browser has them). No stuck notes: every `onNoteDown` is eventually matched by an `onNoteUp`, including on unmount. No text selection or context menu while playing; `touch-action: none` on the keys.
- Edit mode: clicking selects (`onSelectSlot`), nothing plays, the selected key is highlighted with `--key-selected`, and keys show a pointer cursor.
- Accessibility: each key is focusable-free (do not put 37 tab stops in the page: the piano is one group with `role="group"` and an `aria-label`), but each key element has an `aria-label` such as "C4, key A" and `aria-pressed`. In edit mode keys are real buttons reachable by Tab.

### 5.8 `src/ui/NoteTrails.tsx` + `src/ui/noteTrails.css`

```ts
export interface NoteTrailsProps {
  bus: NoteBus
  baseOctave: number
}

export function NoteTrails(props: NoteTrailsProps): React.JSX.Element
```

A `<canvas>` that sits directly above the piano, exactly as wide as it, and makes playing feel alive:

- While a note is held, a glowing bar grows upward from the top edge of that key's position (x and width from `keyRect(midiToSlot(midi, baseOctave))`, black-key notes are narrower, as in the geometry). When the note is released the bar detaches and keeps rising at the same constant speed, fading out as it nears the top. Bars for white-key notes use `--accent`, black-key notes a slightly deeper tone (`--key-black-pressed` or similar); read colours from the CSS variables at runtime, do not hard-code them. Rounded ends, soft glow, a faint gradient: elegant, not neon.
- Subscribes to the bus itself (in an effect) rather than taking notes as props, so timing is frame-accurate and React does not re-render per frame. Notes outside the current window are ignored. When `baseOctave` changes, existing bars are cleared.
- Rendering: `requestAnimationFrame`, sized with `ResizeObserver` and `devicePixelRatio` for crisp drawing. **The loop must stop when there is nothing to draw** (no held notes and no bars left) and restart on the next note: an idle piano uses no CPU. Cleans up fully on unmount (works under StrictMode double-mount).
- `prefers-reduced-motion: reduce`: no rising animation; just show a short static glow above held keys.
- Purely decorative: `aria-hidden="true"`, `pointer-events: none`. Fills its container (the parent gives it its height, ~140–200 px); transparent background with a very faint baseline so the area does not look empty when idle.
- Keep the simulation logic (bars list, advance by dt, cull) in small pure functions so they can be unit-tested without a canvas (`src/ui/noteTrails.test.ts`).

### 5.7 App shell (`src/App.tsx`, `src/app/pianoApp.ts`, `src/ui/Toolbar.tsx`, `src/ui/KeyEditor.tsx`, `src/ui/StartOverlay.tsx`, `src/styles/app.css`, `src/main.tsx`)

`src/app/pianoApp.ts` creates the module-level singletons and the bus → engine wiring:

```ts
export const bus: NoteBus
export const engine: AudioEngine
// bus 'on' → engine.noteOn(midi, velocity); bus 'off' → engine.noteOff(midi)
// In dev (import.meta.env.DEV) also expose window.__piano = { bus, engine, settingsStore } for debugging.
```

Layout, top to bottom, centred, max width ~1280 px:

1. **Header / navigation**: the app name (`APP_NAME`, also set as `document.title`) on the left; the three modes as clear tabs: "Free Play" (active), "Practice" and "Real-time" (disabled for now, each with a small "Soon" badge and a tooltip "Coming in a later update"). This is the app's only navigation, so make it obvious: real tab semantics (`role="tablist"` / `role="tab"`, `aria-selected`, `aria-disabled`), large click targets, the active tab clearly marked.
2. **Toolbar** (one row that wraps), each control with a visible plain-word label: Volume slider (with a speaker icon and percentage) · Sustain on/off toggle (shows its state clearly; hint "Space") · piano position: "◀ Lower" / "Higher ▶" buttons with the current range between them (e.g. "C3 – C6"), disabled at the limits · Labels select ("Keys and notes", "Keys only", "Notes only", "No labels") · "Customize keys" button (visually distinct: it is the main action) · "Advanced" button at the far right (quieter style, `aria-expanded`) that opens and closes the Advanced panel.
   - **Advanced panel** (`AdvancedPanel`, closed by default, appears directly under the toolbar): heading "Advanced settings" and the sentence "Optional. The piano works well without changing any of these." Each option is a labelled control with a one-line plain explanation:
     - **Touch**: slider 10–100% (`velocity`). "How hard each note is played."
     - **Transpose**: − / + stepper showing the value ("0", "+2", "−3") (`transpose`, ±12). "Shifts every note up or down. 0 is normal."
     - **Note names**: two-option switch "C D E" / "Do Ré Mi" (`noteNaming`).
     - **Room echo**: slider 0–100% (`reverb`). "Adds the echo of a room. 0 is none."
     - **Note fade-out**: three-option switch Short / Normal / Long (`release`). "How long a note rings after you let go."
     - **Light trails**: on/off (`showTrails`). "Glowing trails above the keys."
     - "Reset advanced settings" (inline confirm, like the key reset) → `settingsStore.resetKeys(ADVANCED_KEYS)`. It does not touch the keys, volume or sustain.
   - When `transpose` is not 0, show a small badge next to the Now playing line ("Transposed +2") so the player knows why notes sound different.
3. **Now playing** line: names of the notes currently held (e.g. "C4  E4  G4", written per `noteNaming`), or a hint ("Press the keys shown on the piano, or click it") when nothing is held. Reserve its height so the piano does not jump.
4. **Stage**: one panel containing the `NoteTrails` canvas (about 160 px tall) directly on top of the `Piano`, both exactly the same width with no gap or horizontal offset between them, so trails rise straight out of the keys. The stage is the visual centre of the page. When `showTrails` is off the canvas is not rendered and the stage is just the piano.
5. **Footer hint**: one line: "Space turns sustain on and off." plus the sound status when it is not `ready`: `loading` → "Loading piano sound…", `fallback` → "Using basic sound (piano sound could not be loaded).", `error` → "Sound could not start. Click anywhere to try again." At the end of the footer, quietly, the credit the sample licence requires: "Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)", with the name linking to the licence.

**The piano never leaves the screen.** The light-trails area is the flexible part of the page: when a panel opens (Advanced, Customize keys, and later Songs and the player bar) or the window is short, the trails area gives up its height, down to nothing, before the page starts to scroll. On a 1366×768 laptop (a viewport of about 1366×633) the whole piano is visible with any one panel open. The Advanced panel is compact: its heading, sentence and reset button share one row, and its six options sit in one row on wide windows.

Behaviour:

- **Start overlay**: until audio has started, a full-screen overlay says "Click or press any key to start". Any click or key press calls `engine.start()` and removes the overlay. That first key press does not play a note and is not treated as anything else.
- Settings (`useSettings`) drive everything: `engine.setVolume` / `setSustain` / `setTranspose` / `setReverb` / `setRelease(RELEASE_SECONDS[release])` follow the settings (also on first load); the toolbar and the Advanced panel write to `settingsStore`.
- Keyboard: `attachKeyboardInput({ bus, resolveNote, intercept, onToggleSustain, getVelocity })` where `resolveNote(code)` and `getVelocity()` read the **current** settings (no stale closures: read from `settingsStore.get()`). Pointer notes use the same velocity.
- A `<select>` or text field that keeps keyboard focus would stop the keyboard from playing (see `isTextEntryTarget`): blur the Labels select as soon as its value changes and when its list is dismissed without a change (Escape, or choosing the option it already shows), and blur buttons after they are clicked, so the player can go straight back to playing.
- Changing the base octave or leaving the page releases held notes (`bus.allOff()`), so nothing gets stuck.
- Pointer notes go to the bus with source `'pointer'`.
- **Customize keys** (edit mode), a panel shown above the piano while active:
  - Instruction: "Click a piano key, then press the key you want to use for it."
  - Clicking a piano key selects it; the panel then says e.g. "Press a key for C4…" and shows "Esc = cancel · Backspace = remove this key".
  - The next key press (handled through `intercept`, so it never plays a note or toggles sustain): a bindable key → `assignBinding`, store the label from `labelFromEventKey(event.key)` in `customLabels`, deselect, and show a short result message, e.g. `"K" now plays C4.` plus, when relevant, ` "A" no longer plays a note.` (replaced key) or ` G4 has no key now.` (vacated note). Escape → deselect. Backspace/Delete → `clearSlot`, deselect, message "C4 has no key now." Anything else (Space, Enter, arrows, F-keys…) → message "That key can't be used. Try a letter, number or symbol key." and stay selected. Ctrl/Alt/Meta combos are not intercepted.
  - With no key selected, the keyboard plays normally so the user can try their layout.
  - While Customize keys is open the piano always shows the computer-key labels, whatever the Labels setting says (the saved setting is not changed).
  - The prompt and the hint are announced to screen readers (`aria-live="polite"`), and keyboard focus is never dropped on the floor: when a focused button disappears (the reset question, its answer, Done) focus moves to the sensible next control.
  - "Reset to default keys" asks for confirmation inline (button turns into "Really reset?" with Yes / No). Never use `window.confirm` / `alert`.
  - "Done" leaves edit mode. Escape with nothing selected also leaves it.
- Buttons must not keep keyboard focus in a way that breaks playing (see Space rule in 5.5).

## 6. Visual direction

Dark, calm, slightly warm, elegant; the piano is the hero and everything about it responds to the player. Use only the tokens in `theme.css`.

- Elegance comes from restraint: one accent colour, consistent spacing (multiples of 4 px), soft shadows, smooth 80–160 ms transitions on hover/press/toggle, nothing that blinks or bounces. Controls give immediate visual feedback (hover, pressed, on/off).
- Easy to scan: clear visual grouping (header · toolbar · stage · footer), labels in plain words, generous click targets (at least 36 px high).

- Panels: `--panel` with `--border`, radius `--radius`. Controls are compact pill-like buttons; the active/on state uses `--accent` with `--accent-ink` text.
- Piano: white keys `--key-white` with a soft bottom shade and rounded bottom corners; black keys `--key-black` with a subtle top highlight; pressed white `--key-white-pressed`, pressed black `--key-black-pressed`, with a tiny downward "press" movement. Keycap labels: small rounded rectangles (dark on white keys, light on black keys), monospace, bold.
- Generous spacing, nothing cramped, readable at 1366×768. No emojis as icons except the speaker in the volume control; no external images or fonts.

## 7. Quality bar

- `npm run typecheck`, `npm test` and `npm run build` pass with no errors.
- No console errors or warnings in the browser during normal use.
- No stuck notes, ever: every path that starts a note has a path that stops it (key up, blur, pointer cancel, unmount, edit-mode entry, octave change).
- Works when `localStorage` is unavailable or contains garbage.
