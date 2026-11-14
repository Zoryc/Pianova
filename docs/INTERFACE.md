# The immersive interface (version 2 of the screen)

This document replaces the screen described in `docs/ARCHITECTURE.md` sections 5.6, 5.7, 5.8 and 6. Everything else in that document still holds: the product rules (section 1), the note bus (section 3), and the contracts of the keyboard input, the sound engine, the key bindings, the key labels and the settings store (sections 5.1 to 5.5), except where this document says it changes them. `docs/SONGS.md` describes the song modules; its section 5 (the screen) is replaced by section 9 here.

## 1. What it should feel like

A dark stage with a real-looking piano across the whole width of the window, and light above it. When the player presses a key, the key lights up, a glowing bar of light rises from it and sparks fly where the bar meets the keys. When a song plays, bars of light fall from the top and land on the keys exactly when each note sounds. Nothing else is on screen unless the player asks for it: a thin bar at the top, with only what is needed while playing, appears when the mouse moves and hides again when it stops. Everything that is used now and then is in one small menu, the start box, which is also how the app says hello: it is open when the app opens, and one click beside it takes it away.

The two words that decide every choice here are **elegant** and **fun**. Elegant: dark, calm, one colour of light, nothing on screen that is not needed. Fun: the piano answers every touch at once and generously (the key dips and lights, light rises, sparks fly, a chord makes the whole line glow brighter), so that simply pressing keys is a pleasure even before playing a song.

Rules:

- **The stage fills the window.** No page scrolling, ever. Black background (`--stage-bg`), no panels around the piano.
- **One colour of light** at a time (bars, sparks, lit keys, the line above the keys). The player chooses it; the default is red. The one exception is the Rainbow choice, where each note has its own colour.
- **Calm chrome.** The menu bar and panels are dark, translucent and quiet; they never compete with the light.
- **Simple first, advanced on demand** still holds: everything works with no setup, and every option lives in one Settings panel, organized in tabs.
- **Desktop only.** The app is for a PC with a keyboard and a mouse. There is no phone or tablet support: no small-screen layouts, no touch-specific behaviour, nothing designed or tested for touch. (Windows narrower than about 800 px only need to stay usable, not pretty.)
- All product rules of `docs/ARCHITECTURE.md` section 1 still hold (one key = one note, plain words, nothing to hold down, easy to navigate).

## 2. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ top bar: Menu, the player line, Volume, Sustain (auto-hides)  │
│ (the player line has a row of its own in a narrower window)   │
│                                                               │
│                       the sky (canvas)                        │
│              rising bars / falling notes / sparks             │
│                                                               │
│━━━━━━━━━━━━━━━━━━━━━━━━ light line ━━━━━━━━━━━━━━━━━━━━━━━━━━│
│ ▌▌ ▌▌▌ ▌▌ ▌▌▌ ▌▌ ▌▌▌ ▌▌ ▌▌▌   the piano (full width)          │
└──────────────────────────────────────────────────────────────┘
```

- The app root is exactly the viewport (`100dvh`), `overflow: hidden`. **Every pixel of the window is the stage**: the sky runs from the very top edge to the piano and from the left edge to the right edge, with no margins, so the notes use the whole screen. "Full screen" (in the start box) goes one step further and hides the browser itself.
- The **piano** is pinned to the bottom, full width, with a small margin under it (about 2% of the height, min 8 px). Its height follows its key width (white keys about 5.5 times as long as they are wide), clamped between 110 px and 34% of the viewport height.
- The **sky** is everything between the top of the window and the top of the piano. One `<canvas>` fills it. The top bar, the start box and the panels float over it.
- The **light line**: a 2 px line of the accent colour with a soft glow, exactly on the top edge of the piano.

## 3. The piano's range (changes to `src/core`)

The piano on screen is no longer the 37 bindable slots. Two things are now separate:

- **The keyboard zone**: the 37 slots the computer keys can be bound to, starting at the C of `baseOctave` (unchanged: `SLOT_COUNT`, `slotToMidi`, `midiToSlot`, bindings).
- **The piano on screen**: a range of notes chosen by the **piano size** setting. The keyboard zone always lies inside it. The default size is **Auto**: the largest piano whose keys are still comfortably wide in the current window, so the piano is never tiny in a small window and is a full 88-key piano in a large one.

```ts
// src/core/layout.ts (additions)
export type PianoSize = 88 | 61 | 49 | 37
export const PIANO_SIZES: readonly PianoSize[]   // largest first
/** What the setting holds: a fixed size, or 'auto'. */
export type PianoSizeSetting = PianoSize | 'auto'
/** Narrowest white key, in CSS pixels, that Auto accepts. */
export const MIN_AUTO_KEY_WIDTH = 26

/** The size Auto picks for a piano `widthPx` wide: the largest size whose white keys are at least MIN_AUTO_KEY_WIDTH wide, or 37 when none is. A fixed setting is returned as it is. */
export function resolvePianoSize(setting: PianoSizeSetting, widthPx: number): PianoSize

export interface PianoRange {
  /** Lowest and highest note shown, both included. */
  first: Midi
  last: Midi
}

/**
 * The notes the on-screen piano shows.
 * - 88: always A0..C8 (21..108).
 * - 61 and 49: C to C; the standard range (C2..C7, C2..C6) moved by whole octaves, as little
 *   as possible, so that the keyboard zone of `baseOctave` lies inside it and it stays on the piano.
 * - 37: exactly the keyboard zone.
 */
export function pianoRange(size: PianoSize, baseOctave: number): PianoRange
export function isInRange(midi: Midi, range: PianoRange): boolean
export function isPianoSizeSetting(value: unknown): value is PianoSizeSetting
```

`src/core/layout.ts` has the piano sizes and ranges above, and `src/core/pianoGeometry.ts` has the key positions below. The old slot-based `src/core/keyGeometry.ts` has been deleted.

```ts
// src/core/pianoGeometry.ts
export interface KeyRect {
  midi: Midi
  black: boolean
  /** Left edge and width as fractions (0..1) of the piano's width. */
  left: number
  width: number
}
export const BLACK_KEY_WIDTH_RATIO = 0.62

/** One entry per note of the range, lowest first. Same array for the same range (cached). */
export function keyRects(range: PianoRange): readonly KeyRect[]
/** Null when the note is outside the range. */
export function keyRectOf(midi: Midi, range: PianoRange): KeyRect | null
export function whiteKeyCount(range: PianoRange): number
```

A range may start on any white key (A0 for the full piano), not only on a C. White keys are laid edge to edge; a black key is centred on the line between its neighbours.

## 4. Settings (additions to `src/state/settings.ts`)

```ts
pianoSize: PianoSizeSetting     // default 'auto'
keyStyle: KeyStyle              // default 'classic'
keyEffect: KeyEffect            // what a key does when it is played; default 'glow'
keyboardType: KeyboardType      // default 'auto'

accent: AccentChoice            // default 'red'
customColour: string            // '#rrggbb', the colour used when accent is 'custom'; default '#ff2a2a'
glow: number                    // 0..1, how strong the glow is; default 0.6
background: BackgroundName      // default 'black'
barStyle: BarStyle              // default 'solid'
sparks: SparksLevel             // default 'some'
showKeyHints: boolean           // "Key letters on falling notes", default true
showNoteNames: boolean          // "Show the notes being played", default true
autoHideMenu: boolean           // default true
```

`showTrails` stays and now means "light bars" (rising bars and falling notes). `ADVANCED_KEYS` is removed; "Reset all settings" in the About tab uses `settingsStore.reset()`.

```ts
// src/core/types.ts
export type AccentName = 'red' | 'amber' | 'blue' | 'green' | 'purple' | 'white'
/** A named colour, a colour of the player's own, or a different colour for every note. */
export type AccentChoice = AccentName | 'custom' | 'rainbow'
export type BackgroundName = 'black' | 'night' | 'stars' | 'aurora'
export type BarStyle = 'solid' | 'neon'
export type SparksLevel = 'off' | 'some' | 'lots'
/** Which letters are printed on the player's keyboard ('auto' = ask the browser). */
export type KeyboardType = 'auto' | 'qwerty' | 'azerty' | 'qwertz'
/** How the piano keys are drawn. */
export type KeyStyle = 'classic' | 'midnight' | 'glass'
/** What a piano key does when it is played. */
export type KeyEffect = 'glow' | 'press' | 'edge' | 'pop'
```

Saved settings from before this change load fine: missing fields take their defaults. `customColour` is sanitized with `isHexColour` (anything else falls back to the default).

### 4.1 Colour (`src/core/colour.ts`, pure, unit-tested)

All light on screen comes from one base colour, from which a small palette is derived, so that a colour chosen by the player works as well as the built-in ones.

```ts
export interface LightPalette {
  /** The colour itself: bars, lit keys. '#rrggbb'. */
  light: string
  /** Near-white tint of it: hot centres, sparks, the light line. */
  bright: string
  /** Dark, saturated shade of it: the far end of a bar, shadows. */
  deep: string
}

/** Base colour of each named accent. red '#ff2a2a', amber '#ffb020', blue '#2f8bff', green '#2bd96b', purple '#a45cff', white '#e8ecff'. */
export const ACCENT_COLOURS: Readonly<Record<AccentName, string>>

export function isHexColour(value: unknown): value is string   // exactly '#' + 6 hex digits
export function paletteFrom(base: string): LightPalette
/** The palette for the chrome and for anything that is not tied to one note. For 'rainbow' this is a calm violet. */
export function paletteFor(accent: AccentChoice, customColour: string): LightPalette
/** The palette for one note. Same as paletteFor, except for 'rainbow': each of the 12 pitch classes has its own hue, evenly spread around the colour wheel starting with red on C. Cached: same object for the same inputs. */
export function paletteForNote(midi: Midi, accent: AccentChoice, customColour: string): LightPalette
/** The text colour that reads best on `colour`: black on a light colour, white on a dark one. */
export function inkOn(colour: string): '#000000' | '#ffffff'
```

The app root carries the chrome palette as CSS variables set from TypeScript (`--light`, `--light-bright`, `--light-deep`, and `--light-ink` for text written on the light) and the glow strength as `--glow` (0..1). CSS uses only those variables; the canvas uses the palettes directly. A lit piano key gets its own `--key-light`, `--key-light-bright` and `--key-light-ink` inline, from `paletteForNote`, so rainbow works on the keys too.

### 4.2 Themes (`src/state/themes.ts`)

A theme is a named set of look settings applied with one click. Simple first: the player picks a theme; everything a theme sets can still be fine-tuned afterwards.

```ts
export type ThemeId = 'ember' | 'midnight' | 'aurora' | 'gold' | 'mono' | 'prism'

export interface LookTheme {
  id: ThemeId
  name: string
  description: string
  values: Pick<Settings, 'accent' | 'customColour' | 'glow' | 'background' | 'barStyle' | 'sparks' | 'keyStyle'>
}

export const LOOK_THEMES: readonly LookTheme[]
/** The theme whose values all match the current settings, or null ("Custom"). */
export function matchingTheme(settings: Settings): ThemeId | null
```

Applying a theme saves every value of the theme except `customColour`: "Your colour" is the player's own, and no theme changes it. A click on the card that is already marked therefore changes nothing. `customColour` stays in `values` so that a theme is a complete look for its preview picture (it is the colour of the theme's own light); `matchingTheme` ignores it unless the theme's accent is `'custom'`, which is the case for none of the six.

| Theme | Description | accent | background | bars | sparks | keys | glow |
|---|---|---|---|---|---|---|---|
| **Ember** (default) | "Red light on black." | red | black | solid | some | classic | 0.6 |
| **Midnight** | "Blue light under the stars." | blue | stars | solid | some | midnight | 0.7 |
| **Aurora** | "Soft purple haze and glass keys." | purple | aurora | neon | some | glass | 0.8 |
| **Gold** | "Warm gold and plenty of sparks." | amber | night | solid | lots | classic | 0.6 |
| **Mono** | "White lines, nothing else." | white | black | neon | off | midnight | 0.4 |
| **Prism** | "Every note has its own colour." | rainbow | black | solid | some | classic | 0.6 |

The defaults of the settings are the Ember theme.

### 4.3 Key presets and keyboard types (additions to `src/input`)

```ts
// src/input/keymap.ts
export type KeyPresetId = 'home-row' | 'two-octaves' | 'white-keys'

export interface KeyPreset {
  id: KeyPresetId
  /** "Home row", "Two octaves", "White keys only" */
  name: string
  description: string
  bindings: Bindings
}

/** In the order shown to the player. `DEFAULT_BINDINGS` is the 'home-row' preset's bindings. */
export const KEY_PRESETS: readonly KeyPreset[]

/** The preset whose keys are exactly these, or null ("Custom"). */
export function matchingPreset(bindings: Bindings): KeyPresetId | null
```

Every preset obeys the one-key-one-note rule and uses only bindable codes and valid slots (unit-tested).

```ts
// src/input/keyLabels.ts: keyLabel gains a fourth parameter
export function keyLabel(
  code: string,
  layoutMap: LayoutMap | null,
  customLabels?: Readonly<Record<string, string>>,
  keyboardType?: KeyboardType,   // default 'auto'
): string

/** The letter printed on a physical key for a given keyboard type ('qwerty' is `defaultKeyLabel`). */
export function typedKeyLabel(code: string, type: Exclude<KeyboardType, 'auto'>): string
```

Priority: an explicit keyboard type (not 'auto') wins over everything for the keys it knows; otherwise the browser's layout map, then the label captured when the key was bound, then the QWERTY label. AZERTY is the French layout (A and Q swapped, Z and W swapped, M on the key right of L, and its own punctuation and digit-row characters); QWERTZ is the German one (Y and Z swapped, Ö Ä Ü ß on their keys). Number-pad keys are the same on all of them.

## 5. Components

| File | What it is |
|---|---|
| `src/ui/Stage.tsx` + `stage.css` | The sky canvas wrapper + the piano + the light line. Owns their shared geometry. |
| `src/ui/sky/` | The canvas renderer: `Sky.tsx` (the component), `skyRunner.ts` (listens to the notes and runs the frame loop), `skyModel.ts` (pure: bars, falling notes, sparks), `skyDraw.ts` (drawing), `skySprites.ts` and `skyBackdrop.ts` (the ready-made pictures: glows, sparks, the background), `skyColour.ts`, `sky.css`. Replaces `NoteTrails*`. |
| `src/ui/Piano.tsx` + `piano.css`, `src/ui/pianoHitTest.ts` | The piano, restyled, drawing a `PianoRange`; which key lies under the mouse (pure). |
| `src/ui/TopBar.tsx` | The auto-hiding bar: the Menu button, the player line, volume and sustain (5.3). |
| `src/ui/StartBox.tsx` + `startBox.css`, `src/ui/FullscreenButton.tsx` | The start box, the small menu the app opens with (5.3a), and its full-screen line. |
| `src/ui/useAutoHide.ts` | The hide-when-the-mouse-is-still logic (pure core + hook). |
| `src/ui/SettingsPanel.tsx` + `src/ui/settings/*.tsx` + `settings.css` | The Settings panel and its five tabs (`SoundTab`, `KeysTab`, `PianoTab`, `LookTab`, `AboutTab`), with the pieces only they use (theme and layout cards, colour swatches, the tab strip…). |
| `src/ui/useKeyEditor.ts`, `src/ui/keyEditorModel.ts` | Choosing the computer keys: the hook the app shell holds, and its rules (pure). |
| `src/ui/FloatingPanel.tsx` | The panel that floats over the sky, used by Settings and Songs. |
| `src/ui/SongsPanel.tsx`, `src/ui/PlayerLine.tsx`, `src/ui/useSongs.ts`, `src/ui/DropOverlay.tsx` + `songs.css` | The Songs panel, the player line and their glue (section 9). |
| `src/ui/controls.tsx`, `src/ui/format.ts` | Shared small controls (kept, restyled); numbers written as the text shown on screen. |
| `src/ui/hooks.ts` | The hooks that connect the app shell to the note bus, the sound engine and the settings. |
| `src/styles/theme.css`, `src/styles/app.css`, `src/ui/chrome.css` | Tokens; how the menu, the panels and the stage share the window; the look of the menu, the panels and the shared controls. |

Removed: `Toolbar.tsx`, `AdvancedPanel.tsx`, `KeyEditor.tsx`, `NoteTrails.tsx`, `noteTrailsModel.ts`, `noteTrails.css`, `NowPlaying.tsx` (its content moves into the stage), and the page footer. Removed since: `ModeTabs.tsx` and `StartOverlay.tsx` (the ways to play and the start are in the start box).

### 5.0 Contracts between the components

These are built by different people at the same time, so the seams are fixed here.

```ts
// src/ui/FloatingPanel.tsx
export interface FloatingPanelProps {
  /** The element id, for aria-controls on the button that opens the panel. */
  id: string
  title: string
  onClose(): void
  /** Shown in the heading row after the title (the Settings tabs go here). */
  headerExtra?: ReactNode
  children: ReactNode
}
/**
 * Mounted while open, unmounted when closed (the parent decides). On mount, when a control outside
 * the panel has the focus (it was opened with the keyboard), focus moves to the panel's first
 * control, and on unmount back to that control. When nothing has the focus (it was opened with a
 * click, after which buttons let go of the focus), the panel itself takes it: Tab carries on
 * inside it and no control shows a focus ring. It draws the heading, the close button (which
 * calls onClose) and a scrolling body. It does not listen for Escape and does not watch clicks
 * outside itself: the app shell does both.
 */
export function FloatingPanel(props: FloatingPanelProps): JSX.Element

// src/ui/SettingsPanel.tsx
export interface SettingsPanelProps {
  id: string
  settings: Settings
  /** What `useKeyEditor` returns; the Keys tab shows its state and calls its actions. */
  keyEditor: KeyEditor
  layoutMap: LayoutMap | null
  onClose(): void
}
/** Calls keyEditor.open() when the Keys tab becomes the active tab, and keyEditor.close() when it stops being active or the panel goes away. */
export function SettingsPanel(props: SettingsPanelProps): JSX.Element

// src/ui/SongsPanel.tsx
export interface SongsPanelProps {
  id: string
  onClose(): void
}
export function SongsPanel(props: SongsPanelProps): JSX.Element

// src/ui/PlayerLine.tsx: both render nothing when no song is loaded
export function PlayerLine(): JSX.Element | null
/** The 2 px progress line along the top edge of the window. The app shell mounts it outside the menu, so it stays when the menu hides. */
export function SongProgressLine(): JSX.Element | null

// src/ui/DropOverlay.tsx
export interface DropOverlayProps {
  /** Files were dropped on the page and are being added as songs: the moment to open the Songs panel. */
  onFilesDropped(): void
}
export function DropOverlay(props: DropOverlayProps): JSX.Element | null

// src/ui/StartBox.tsx
/** How many songs the box offers. All the others are behind "All songs…". */
export const START_BOX_SONGS = 3
export const START_SENTENCE = 'Click or press any key to start'
export const CLOSE_SENTENCE = 'Click outside or play a key to close'
export interface StartBoxProps {
  /** The element id, for aria-controls on the Menu button. */
  id: string
  /** Whether the box hangs in a layer of its own over the whole window (how the app opens) or is put among the panels. */
  overWindow: boolean
  /** True until the first click or key press: the whole window around the box then starts the app. */
  waitingToStart: boolean
  /** The Menu button: a press of the mouse on it is not a press outside the box. */
  opener: RefObject<HTMLElement | null>
  /** "Free Play", the window around the box at the start, a press of the mouse outside it later. */
  onClose(): void
  onPlaySong(songId: string): void
  onShowSongs(): void
  onShowSettings(): void
  onShowAbout(): void
}
/** Like the floating panel, it does not listen for Escape: the app shell does. It does close itself at a press of the mouse anywhere else. */
export function StartBox(props: StartBoxProps): JSX.Element

// src/ui/SettingsPanel.tsx: makes the panel open on `tab` the next time it is opened ("About", in the start box)
export function openSettingsOn(tab: SettingsTabId): void

// src/ui/useSongs.ts: whether the song options are open under the player line
export function useSongOptionsOpen(): boolean
/** Does nothing when no song is loaded. */
export function openSongOptions(): void
/** True when they were open and it closed them. */
export function closeSongOptions(): boolean

// src/app/songsApp.ts: the song singletons (the bus comes from src/app/pianoApp.ts)
export const player: SongPlayer
export { songLibrary } from '../songs/songLibrary'
```

- **Shared styles.** The small controls in `src/ui/controls.tsx` (`Field`, `PercentSlider`, `Switch`, `Segmented`, `Stepper`, `ConfirmButton`) keep their props and class names; their look, and the look of `.button`, `.button--primary`, `.button--quiet`, `.select`, `.keycap` and the floating panel, is defined once in `src/ui/chrome.css`. Panels and tabs use those components and classes and add only layout of their own in their own stylesheet. Nobody hard-codes a colour: tokens from `theme.css` only. Spacing in multiples of 4 px is a rule for the shared controls in `src/ui/chrome.css` only; a panel's own stylesheet (`settings.css`, `songs.css`) is not held to it.
- **`ConfirmButton`** (the button that asks "Really reset?" with Yes / No in its own place) ignores the second click of a double-click (a click whose `detail` is above 1) on its button and on both answers. The button and the answers take each other's place, so that click would land on whatever has just appeared: a double-click on the button only asks the question, and a double-click on an answer does not ask it again.
- **Escape** is handled in one place, the app shell's keyboard intercept. It takes back one thing at a time, the first of these that there is:
  1. the piano key that is waiting for a computer key is deselected;
  2. the open song options are closed;
  3. the open panel is closed, or else the open start box;
  4. when the keyboard focus is inside the menu, the focus is let go of, so that the menu can hide again;
  5. otherwise the key is left to the browser.

  A held Escape (auto-repeat) never does more than one of these: its repeats do nothing, and are used up for as long as something is left that a new press would take back. A text field handles its own Escape (for example cancelling a rename) and the app leaves it alone.
- **The song options** are open or closed in a small store in `src/ui/useSongs.ts`: `useSongOptionsOpen()`, `openSongOptions()` and `closeSongOptions(): boolean`, which returns true when it closed them (that is how the shell knows a press of Escape was used up). The player line reads and sets that store. The options close at their own button, at a press of the mouse outside the player line, when the keyboard focus moves to a control outside it, when a file is dropped on the page, at Escape, when another song is played and when the song is closed. If one of their controls has the keyboard focus when they close, the focus goes to the "Song options" button.
- **A click on the empty sky** closes an open panel; the stage reports it to the app shell.
- **Closing a panel** (Escape, its close button, a click on the empty sky, "Play" in Songs) goes through one function of the app shell. When a control inside the panel has the keyboard focus at that moment, the focus is first put on the Menu button, through which the panel was opened, however that was done. After a click with the mouse that button lets go of it again; a panel that holds the focus itself leaves it nowhere. The start box is closed by the same rule.
- **Edit mode** (selecting piano keys) is on exactly while the Settings panel is open on the Keys tab.

The stage, as built (`src/ui/Stage.tsx`):

```ts
export interface StageProps {
  /** The stage's own id, and what it is called: the way of playing that is on ("Free Play"). */
  id: string
  label: string
  bus: NoteBus
  settings: Settings
  /** slot -> label of the computer key that plays it (the keycaps on the piano). */
  keyLabels: ReadonlyMap<number, string>
  /** Note -> label, for the letters on falling notes. Empty when that setting is off. */
  hints: ReadonlyMap<Midi, string>
  falling: FallingSource | null
  audioStatus: AudioStatus
  /** Whether to say how to play, until the first note (off while the start box is open and in edit mode). */
  showHint: boolean
  editMode: boolean
  selectedSlot: number | null
  onSelectSlot(slot: number): void
  onNoteDown(midi: Midi): void
  onNoteUp(midi: Midi): void
  /** The piano on screen shows other notes than before (also called for the first piano). */
  onRangeChange(range: PianoRange): void
  onSkyClick(): void
}
```

- The stage follows the bus itself for the lit keys and the note names, so the app shell (the menu, the panels) is not drawn again for every note.
- The stage is a region (`role="region"`) named after the way of playing that is on. The ways to play are lines of the start box, not tabs, so the stage is no longer the page of a tab.
- **How the window is shared** (`src/styles/app.css`, `src/ui/stage.css`): the screen is a grid of three rows: the menu, what is left, the piano. The stage lies on all three (`subgrid`): the piano on the last row, the sky on the rows above it (both when the menu hides by itself, only the middle one when it is always shown). An open panel is on the middle row, so it is under the menu and can never cover the piano, with no measuring in code.

### 5.1 Piano

```ts
export interface PianoProps {
  range: PianoRange
  baseOctave: number
  activeNotes: ReadonlySet<Midi>
  labelMode: LabelMode
  noteNaming: NoteNaming
  /** slot -> label of the computer key that plays it. */
  keyLabels: ReadonlyMap<number, string>
  keyStyle: KeyStyle
  /** What a key does when it is played. */
  keyEffect: KeyEffect
  /** For the colour of lit keys (`paletteForNote`). */
  accent: AccentChoice
  customColour: string
  onNoteDown(midi: Midi): void
  onNoteUp(midi: Midi): void
  editMode?: boolean
  selectedSlot?: number | null
  onSelectSlot?(slot: number): void
}
```

Everything the piano of the first screen did stays (`docs/ARCHITECTURE.md` 5.6: pointer handling with capture, glissando without skipped keys, reference counting, no stuck notes, accessibility, forced-colours support). Changes:

- It draws `keyRects(range)`. Notes are identified by midi; the slot of a key is `midiToSlot(midi, baseOctave)` (null outside the keyboard zone).
- **Look**: like a real piano seen from above. White keys ivory with a very soft vertical gradient and a thin dark gap between them, slightly rounded bottom corners; black keys near-black with a faint highlight along the top and left edges, about 62% of the key length. A thin strip of dark red felt (2–3 px) is fine but optional. No panel, border or rounded box around the piano.
- **The light of the line on the keys**: the light line above the piano shines on the far end of the keys: a wash of the accent that lies over the keys and fades out down them (about a third of their length at most). It follows `--glow`, down to nothing at 0. Behind see-through keys (Glass) the same light carries on as a faint haze (`--piano-bed`, set by the key style).
- **Key styles** (the `keyStyle` setting, a `data-key-style` attribute on the piano; each style is a small block of CSS variables in `piano.css`, so the component has no per-style code):
  - *Classic*: the ivory and ebony described above.
  - *Midnight*: white keys are a very dark blue-grey with a faint lighter edge, black keys are pure black with a thin lighter outline, so the keyboard almost disappears until it is played; labels are light. Lit keys look the same as in Classic, which makes them stand out strongly.
  - *Glass*: keys are see-through: white keys are a faint light outline with a barely visible fill, black keys a slightly stronger fill; the stage shows through. Lit keys fill with the accent.
  Every style keeps the same geometry, the same label legibility (check contrast of keycaps and note names in each) and the same lit and selected states.
- **Lit keys** glow in the accent: a white key fills with a vertical gradient from `--light-bright` at the top to a lighter tint at the bottom and casts a soft glow upward; a black key takes `--light` with a bright top edge. A pressed key **tilts** like a real one: it turns a few degrees around its top edge (`transform-origin: top`, a little `perspective`), so its near end dips. It moves like a real key: pressed, it goes down quickly, about a sixth too far, and settles (about 100 ms); let go, it comes back up more softly, a tenth past its place, and settles (about 170 ms). Both are the timing curve of the `transform` transition, nothing more. A white key that is down also carries a soft dark line inside each long edge of its light, the shade of the neighbours it now lies lower than; the colour of its light is deepest in the body of the key and a little lighter where the names are written. When a key is released its light does not snap off: it **fades out** over about 250 ms (the afterglow). The glow of a lit key spills over its neighbours (a soft shadow in its own colour, scaled by `--glow`, drawn above the other keys), as in the reference picture. The labels on the key take their lit colours at once and go back to their own in one step, about 90 ms after the release (when the light is about half gone); a key that is struck again before that keeps them.
- **Key effects** (the `keyEffect` setting, a `data-key-effect` attribute on the piano; a prototype, for the owner to choose from). What is described above is the effect the piano starts with, **Glow**. Each of the three others is a block of rules in `piano.css` that changes the same two layers of a key (`::before` on its face, `::after` around or over it), so the component has no per-effect code, and every effect works with every key style and colour, on white and black keys, whatever plays the note:
  - *Press*: the key goes down nearly twice as far, in shade, with only a little light: a tint that gathers at its near end and a lit front edge. No glow.
  - *Edge*: only the outline of the key and a bright line at its far end light up, with a tight glow; the face of the key keeps its own colour.
  - *Pop*: a short bright flash and a small bounce, then about a third of the light of Glow for as long as the key is held.

  Press, Edge and Pop leave the face of the key its own colour or tint it a little, so the names on it keep the key's own ink (at its strongest) and the keycap is drawn solid, dark on a white key and ivory on a black one, to read on any tint. The rules of "A key press stays cheap" below hold for every effect: only `transform` and `opacity` change little by little, in transitions and in two small animations (`piano-pop`, `piano-flash`), and no effect adds a wide soft shadow. An animation runs only while its key is played; when the key is let go sooner, a transition carries on from where the animation had got to. With reduced motion nothing flashes or bounces: a key shows at once what it looks like while held. The effect rules are written with `:where()`, which keeps them as weak as the piano's own rules, so the selected key still wins over them.

  Two more effects were built and taken out again: light that pours down the key while it is held, and a wave of light that runs down it. Light that slides along a key was not wanted: a key lights as a whole. A setting saved with one of them goes back to Glow.
- **A key press stays cheap.** Firefox paints the whole piano again whenever anything on it changes, so two rules keep that painting rare and light. Measured on a screen that shows 144 pictures a second, with the full piano: without them a run of quick notes showed about 75 pictures a second, with them 144. First, only the tilt and the light of a key change little by little (`transform` and `opacity`, which a browser moves without painting again); colours change in one step. Second, every gradient that is drawn on all the keys says `in srgb`: a gradient with a `color-mix()` in it is otherwise blended in Oklab, which Firefox works out again, stop by stop, for every key each time it paints. Those gradients only fade one colour out or run between two nearly equal darks, so they look the same either way. `Piano.pointer.test.tsx` checks both rules.
- **Labels** scale with the key width (container query units). Keycaps are small rounded chips at the bottom of each key. With the full piano the keys are narrow (about 26 px at a 1366 px window), so: keycaps hold one character comfortably; note names are drawn on every white key only when keys are at least 30 px wide, otherwise only on the C keys; black keys show a keycap but no note name when narrow. Long labels ("Num 1") shrink and never overflow.
- **The keyboard zone** is marked discreetly so the player sees where the computer keys are on a large piano: a 2 px line in a dim tint of the accent along the bottom edge of the zone's keys, with a 1 px dark hairline above it, so that it also shows when the colour is pale and the keys are ivory (White on Classic). Only shown when the piano is larger than the zone.
- In edit mode only keys inside the keyboard zone can be selected; keys outside it are dimmed and inert.
- **No stuck notes from the mouse.** Notes held by the mouse are also let go when the window loses focus, when the page is hidden and when it is left (`pagehide`): a button released then never reaches the page.

### 5.2 The sky

```ts
export interface SkyProps {
  bus: NoteBus
  range: PianoRange
  /** Light bars on/off (the `showTrails` setting). */
  showBars: boolean
  barStyle: BarStyle
  sparks: SparksLevel
  /** 0..1 */
  glow: number
  background: BackgroundName
  accent: AccentChoice
  customColour: string
  /** While a song is loaded: where its falling notes come from. Null in free play. */
  falling: FallingSource | null
  /** Note -> label of the computer key that plays it, for the letters on falling bars. Empty when hints are off. */
  hints: ReadonlyMap<Midi, string>
}

export interface FallingSource {
  /** Sorted by time. Same array until the arrangement changes. */
  getNotes(): readonly PlayableNote[]
  /** Seconds into the song, right now. */
  getPosition(): number
  /** True while the song is advancing. */
  isPlaying(): boolean
}
```

One canvas, `aria-hidden`, `pointer-events: none`, drawn with `requestAnimationFrame`. The loop runs only while there is something moving (bars, sparks, or a song playing) and stops otherwise. Sized with `ResizeObserver` and `devicePixelRatio` (capped at 2). The pure model is unit-tested without a canvas.

If the browser takes the canvas's drawing context away and gives it back (the `contextrestored` event, for example after a graphics driver restarts), the sky makes its ready-made pictures (glows, sparks, key letters, background) anew and paints once; it does not start animating for that.

**Free play (no song loaded): rising bars.** As the light trails of the first screen: while a note is held a bar grows upward from the light line at that key's position and width; on release it detaches and keeps rising, fading out near the top. A note already held when the sky appears gets a bar.

**A song is loaded: falling notes.** Every note of the arrangement within the next few seconds is a bar above the light line whose bottom edge is `(note.time − position) × speed` above the line and whose height is `note.duration × speed`. As the position advances, bars fall; a bar reaches the line exactly when its note sounds and sinks into the line while it sounds. `speed` (pixels per second of song time) is chosen so that about 3 seconds of music fit in the sky's height. While paused the bars stand still; when a paused or stopped song is moved (the position slider, Restart), the sky shows the new place in the next frame (section 7). While a song is loaded no rising bars are drawn (the player's own notes still light the keys and throw sparks). A very crowded song shows at most 400 bars at once, the ones that land first. Notes that have already ended do not count toward that limit, so the notes to come keep falling while one long note sounds.

**Key letters on falling notes** (`showKeyHints`): a falling bar whose note one of the computer keys can play (the note is in the keyboard zone and its slot has a key) carries that key's label, drawn inside the bar at its lower end (the end that lands first), in a colour that reads on the bar, sized to the bar's width. Inside a neon bar that is the bright tint. On a solid bar the letter keeps one colour all the way down, so it never changes while it falls: white on a bar of a dark colour (red, blue, purple), black on a bar of a light one (amber, green, white). A solid bar is a deep shade far from the line and nearly white on it, so no colour alone reads on all of it: a thin see-through edge in the opposite tone is drawn around the letter (dark around a white letter, pale around a black one), which shows only where the bar comes close to the colour of the letter. Bars for notes no key can play carry nothing. The sky gets the labels as a prop (`hints: ReadonlyMap<Midi, string>`, empty when the setting is off) and puts them on the canvas; a letter is shown only on bars that are at least 13 px wide and tall enough to hold it (13 px, so that the black keys of the full piano in a 1366 px window, whose bars are about 13.7 px wide, carry their letter too, at the smallest size of 8 px).

**No canvas text inside a frame.** The letters are not written on the sky's canvas. Each one is written once on small canvases of its own (the letter on one, its edge on another, so that the edge still shows a little through a letter that fades at the top of the sky), at most one letter per playable key, kept with the other ready-made pictures in `skySprites.ts`. A frame only copies them with `drawImage`, pixel for pixel, with the fade at the top of the sky (`globalAlpha`) applied as they are copied. The pictures are made when the letters, the size of the sky, the pixel ratio, the glow, the bar style or the colour change, and after a lost drawing context: before the next frame, not inside one. The rule, which a test in `Sky.test.tsx` holds: no `font` setter, `fillText`, `strokeText` or `measureText` on the sky's canvas, ever, and none on any canvas during a frame of a playing song.

The reason is what Firefox does with canvas text. Each of those four calls makes the browser bring the styles of the page up to date first. While a CSS transition is in flight (the progress line of a song keeps one in flight all the time, the afterglow of the keys about 40% of the time), that turns the frame into a full paint of the whole page on the main thread, piano included. Setting the font only once per frame is not enough: `strokeText` alone does the same. Measured in Firefox 149 on 2026-11-13 on the development server, with the profiler running: in 4 seconds of a light song, 577 such paints (one for every frame at 144 Hz) with the letters written in each frame, about 80 with the ready-made pictures; the page's main thread needed about 170 ms of processor time per second instead of about 390, and about 390 instead of about 670 in a very dense song (20 notes a second).

A stamped letter looks exactly like a written one. Firefox puts canvas text on whole pixels down the canvas (it rounds the line the text stands on, where the canvas is not turned), so a written letter falls in whole-pixel steps too; `drawHints` in `skyDraw.ts` picks the row for a picture by that same rule, and the picture is made with the letter on the same part of a pixel across the sky as its bar. Compared in Firefox before and after the change, the letters are the same pixel for pixel.

**Background** (`background`), drawn once to an off-screen canvas when the size, the background, the colour or the piano changes, then copied each frame (never recomputed per frame):
- *Black*: nothing.
- *Night*: a very dark gradient, near-black at the top to a deep blue-black at the bottom, plus a faint vignette (darker corners).
- *Stars*: Night, plus a few hundred tiny stars of varying brightness, denser toward the top, placed by a seeded generator so the pattern is the same on every draw.
- *Aurora*: Night, plus two or three very large, very soft glows in the chrome palette's `light` and `deep`, low in the sky, at low opacity.
The background reacts to the music, gently: while notes sound, it is drawn slightly brighter (up to about +25% at eight notes), easing back when they stop. An idle screen is perfectly still and uses no animation frames.

**Glow** (`glow`, 0..1): scales every glow in the sky (the blur around bars, the size and brightness of the impact bloom, the brightness of the light line) and, through the `--glow` CSS variable, the glow of lit keys. At 0 bars and keys are flat colour with no halo; at 1 the light is rich but text and keys stay readable.

**Bar style** (`barStyle`): *Solid* is the filled bar described below. *Neon* is the same shape drawn as a bright outline (about 2 px, `bright` colour, with glow) around a faint translucent fill of `light`.

**Colours**: each bar, spark and bloom uses `paletteForNote(midi, accent, customColour)`, so with Rainbow every note has its own colour; guides and the light line use the chrome palette.

**The look of a bar**: a rounded rectangle slightly narrower than its key, filled with a vertical gradient (`--light-bright` near the line to `--light` to `--light-deep` far from it) and a soft glow of the same colour around it. A bar is one even colour from edge to edge: nothing lighter is drawn down its middle (a line inside the bar is not wanted). Bars for black keys are narrower and a little darker, as the keys are. Use additive blending so overlapping light adds up, as in the reference.

**Sparks**: while a note is sounding (held in free play; landing in a song), small bright particles are born on the light line at that key, fly upward with a little sideways drift, swaying and twinkling as they go, slow down and fade within about a second. Soft, like embers, never fireworks. Hard budget: at most 600 live sparks and a birth rate per sounding note that keeps 10 simultaneous notes inside that budget. `sparks`: *Some* is the calm default, *Lots* is about three times the birth rate (same budget), *Off* is none. No sparks either when the system asks for reduced motion.

**The impact glow**: where a sounding note meets the line, a soft bright bloom (radial gradient) of about two key widths, with a thin bright streak across it that lies along the line. The more notes sound at once, the brighter the whole light line glows (gently, capped), so chords feel bigger than single notes. A new note gives its bloom a brief flash that settles within 150 ms: the feeling of striking something.

**Guides**: very faint vertical lines at each C (the octave boundaries) from the top of the sky to the line, as in the reference.

**Reduced motion**: no sparks, no rising animation in free play (a short still glow above held keys, as on the first screen); falling notes still move, because they are information, but without glow pulses.

**Performance**: 60 frames per second with 30 bars and 300 sparks on a laptop's integrated graphics. No per-frame allocation in the hot loops (reuse arrays and objects), gradients created once per resize or accent change, no `shadowBlur` on particles (pre-rendered glow sprite or plain small circles with additive blending), no canvas text inside a frame (see the key letters above).

### 5.3 Top bar

A bar across the top with only what is needed while playing. Behind it the stage is black as far down as its controls go and fades out under them (`--bar-fade`), so that it reads as part of the stage and no falling note shows through a word.

Left to right:

1. **"Menu"**: a button with an outline, so that it is not missed. It opens and closes the start box (5.3a), where everything else is. It has `aria-expanded`, and `aria-controls` while the box is open.
2. **The player line**, while a song is loaded (section 9).
3. (flexible space)
4. **Volume**: speaker icon and a short slider (about 110 px).
5. **Sustain**: a small on/off pill showing its state, with the hint "Space".

The app's name, the ways to play, Songs, Settings and full screen are not in the bar: they are in the start box.

The bar is a grid (`.top-bar`): Menu, room, volume and sustain in its first row (controls 36 px high with 8 px above and below, `min-height: var(--top-bar-height)`), and the player line in a second row, in the middle. In a window 1650 px wide or wider the player line stands in the first row instead, between Menu and the volume: one bar, not two. (Tab goes Menu, the player line, volume, sustain in both: the order of the one bar.) Below 900 px the volume slider is dropped (it is also in Settings).

**Auto-hide** (`useAutoHide`): the bar is shown when the mouse moves or a mouse button is pressed, and hidden 2.5 seconds after that. It stays shown while: the pointer is over it; keyboard focus is inside it; the start box or a panel (Settings or Songs) is open; the app waits to start; a song is loaded but not playing. Playing the piano with the computer keyboard does not show it. While it is hidden the mouse cursor is hidden too (`cursor: none` on the whole app: the class `cursor-hidden` on the app root) and comes back with it. It slides and fades (160 ms). The setting "Hide the menu automatically" (Look tab, default on) turns all of this off: the bar is then always shown and the sky starts below it. Hidden means `visibility: hidden` after the transition (not reachable by Tab); pressing Tab while it is hidden shows it and focuses its first control, the Menu button.

Whether the pointer is over the menu is read from everything the page hears from the mouse (over, move, press), not only from entering and leaving, because nothing says that the mouse has left when what was under it is taken off the page (the player line at "Close"). When the browser names the menu element itself as what the mouse is over, the page is asked what is at that place (`document.elementFromPoint`): Chrome names the menu in place of what was taken away, also where the menu no longer reaches. In the same way the keyboard focus is looked up again at every key press and mouse press, and when a panel closes (a focused control that is taken off the page sends no event). Escape, pressed while the focus is inside the menu and nothing else is open, lets go of the focus (5.0): the menu hides again 2.5 seconds later.

### 5.3a The start box

A small menu in the middle of the sky, a little under the top bar (`src/ui/StartBox.tsx`, `startBox.css`). It is open when the app opens, where it is also the welcome, and the Menu button opens it again. It holds what is used now and then, so that the bar keeps only what is needed while playing.

It is made of the same glass as the floating panel, up to 660 px wide (max 94% of the window), and never covers the piano: what does not fit scrolls inside it. It is a `role="dialog"` named "Menu". Top to bottom:

- **The head**: the app's name (`APP_NAME`, the page's `h1`) and "A piano you play with your computer keyboard." over a small picture of the stage: a piano with its black keys, the line of light and a few falling notes. The notes are at half strength, so that the only full light on screen is the stage's own. A window less than 860 px high leaves the picture out. One less than 760 px high also puts the sentence on the line of the name and makes the lines a little lower, so that the whole box is in view at 1366×633; opened with the Menu button there, the box has no head at all, since a loaded song leaves little room and that room is for the lists.
- **Play**: the ways to play. "Free Play" ("Play anything you like") is marked as the one that is on (`aria-pressed`). "Practice" ("The song waits for you") and "Real-time" ("Your timing is scored") cannot be chosen yet: greyed out, a "Soon" badge, the tooltip "Coming in a later update", not reached with Tab.
- **Songs**: the first three songs (`START_BOX_SONGS`): the player's own, newest first, then the starter songs, each with its length. A click plays one (its name for screen readers is "Play" and the title; its length is told after it). Then "All songs…", which opens the Songs panel.
- **The foot**: "Settings"; "Full screen" / "Leave full screen" (not there when the browser cannot do it); "About" (Settings on its About tab); and one sentence that says how to leave: "Click or press any key to start" while the app waits to start, "Click outside or play a key to close" afterwards.

**While the app waits to start** (until the first click or key press, which is what lets the browser play sound), the box hangs in a layer over the whole window, and the window around it is one unseen button named "Click or press any key to start". The screen behind it is not dimmed, and cannot be used (`inert`). What starts the app:

- a click anywhere around the box: the box goes away;
- a click on a line of the box: the app starts and does what the line says;
- a click on the box itself, between its lines: the app starts, and the box stays open;
- any key: the box goes away, and the key does nothing else (function keys are left to the browser). Tab is the exception: it does not start the app but moves through the lines of the box, and Enter on a line presses it, so that the box can be used with the keyboard alone. Shift alone starts nothing either: it goes down before Tab on the way back.

**After that**, opened with the Menu button, the box is one of the things the app puts between the menu and the piano (`.app__panels`), like a floating panel. (When a line that leaves the box open started the app, "Full screen", the box stays where it hangs, with the focus where it was, until it is closed.) Of the box and the two panels only one is open at a time: the Menu button closes an open panel, and a line that opens a panel closes the box. The box goes away at:

- "Free Play" (a loaded song stays loaded); a song (it plays; one that cannot be read opens the Songs panel, which says why); "All songs…", "Settings" and "About";
- the Menu button, and Escape (5.0);
- a press of the mouse anywhere outside the box and the Menu button, which still does what it would do (a click on the piano plays its note);
- a computer key that plays a note, which plays it: the keyboard is the piano's as soon as it is played. A key that was already down when the box was opened does not close it by repeating. Other keys (Tab, Enter, Space…) leave the box open.

"Full screen" leaves it open. The first-time hint in the sky (5.6) is not shown while the box is open. A held Enter does one thing. Its repeats press only what Enter went down on, never what the focus has moved to since (the first control of a panel that the press opened), and on the Menu button and on a line of the box they do nothing at all, or the box would open and close in turn.

**Focus**, as for the floating panel: opened with the keyboard (the Menu button still has the focus), the focus goes to the first line of the box and back to the Menu button when it closes; opened with the mouse, the box itself takes the focus, so that Tab carries on inside it. While the app waits to start it takes no focus. When the box closes while one of its lines has the focus, the focus is put on the Menu button (after a click with the mouse the button lets go of it again). While the app waits to start the Menu button cannot take it, since the screen cannot be used yet, and the focus is let go.

### 5.4 Settings panel

Opened from the start box ("Settings", or "About" for its About tab). **It floats over the sky and never covers the piano**: a panel centred horizontally, up to 760 px wide (max 94% of the window), from just under the top bar (and the player line, while a song is loaded) down to a gap above the light line: 44 px in a window at least 560 px high, so that the line of words above the piano (the note names, the sound status and the badges) stays readable under the panel, and 12 px in a lower window (the `padding-bottom` of `.app__panels` in `src/styles/app.css`). Dark translucent (`--panel-glass`) with a blur behind it, rounded corners, a soft shadow. Its content scrolls inside it when it does not fit. Only the body of the panel scrolls: the panel itself cuts off what sticks out (`overflow: clip`), so that the heading never moves out of view. Because the piano stays visible and usable under it, every change (colour, key style, piano size, labels) shows on the real piano at once, and the keys can be customized right there.

Heading "Settings" and a close button. It is not modal: the piano keeps playing from the computer keyboard while it is open (text fields excepted). Escape closes it, unless something comes before it in the Escape order of 5.0 (a piano key that is waiting for a computer key, or the open song options: then Escape only takes that back); so does a click on the empty sky. Focus moves into the panel when it opens (after a click with the mouse the panel itself holds it). When it closes while one of its controls has the focus, the focus goes to the Menu button, however the panel was opened; a panel that was only used with the mouse leaves the focus nowhere, so the keyboard is the piano's. The same floating panel component (`FloatingPanel`) is used for Songs; only one of the two is open at a time.

Tabs along the top of the panel (real tab semantics, arrow keys move between them): **Sound**, **Keys**, **Piano**, **Look**, **About**. The last tab used is remembered while the app is open.

**Sound**

| Option | Control | Explanation line |
|---|---|---|
| Volume | slider 0–100% | |
| Sustain | on/off | "Notes keep ringing after you let go. Space also turns it on and off." |
| — Advanced — | | |
| Touch | slider 10–100% | "How hard each note is played." |
| Room echo | slider 0–100% | "Adds the echo of a room. 0 is none." |
| Note fade-out | Short / Normal / Long | "How long a note rings after you let go." |
| Transpose | − / + stepper | "Shifts every note up or down. 0 is normal." |

**Keys** (see 5.5: this tab is where the computer keys are chosen)

**Piano** (the piano itself: its size and what is written on its keys)

| Option | Control | Explanation line |
|---|---|---|
| Piano size | Auto / 88 / 61 / 49 / 37 keys (segmented) | "How many keys the piano has. Auto picks the biggest piano that fits your window. 88 is a full piano." |
| Labels on the keys | Keys and notes / Keys only / Notes only / No labels (select) | |
| Note names | "C D E" / "Do Ré Mi" | "How notes are written on the piano." |

**Look** (the light, the keys and the screen)

| Option | Control | Explanation line |
|---|---|---|
| Theme | a row of six cards (Ember, Midnight, Aurora, Gold, Mono, Prism), each a tiny preview in its own colours with its name and description; the one that matches the current settings is marked, otherwise a quiet "Custom" label | "Pick a look. You can fine-tune it below." |
| — Fine-tune — | | |
| Colour | round swatches (radio group): Red, Amber, Blue, Green, Purple, White, **Rainbow** (a multicoloured swatch) and **Your colour** (opens the browser's colour picker, `<input type="color">`) | "Rainbow gives every note its own colour." |
| Glow | slider 0–100% | "How strongly the light glows." |
| Background | Black / Night / Stars / Aurora (segmented) | "What is behind the notes." |
| Light bars | on/off | "Bars of light for the notes you play and the falling notes of a song." |
| Bar style | Solid / Neon (segmented) | "Solid bars are filled with light. Neon bars are glowing outlines." |
| Sparks | Off / Some / Lots (segmented) | "Small sparks where the light meets the keys." |
| Key style | Classic / Midnight / Glass (segmented, each option with a tiny picture of three keys in that style) | "Classic is ivory and black. Midnight is dark keys that glow. Glass is see-through." |
| Key effect | Glow / Press / Edge / Pop (segmented) | "What a key does when you play it. Try each one on the piano below." |
| Key letters on falling notes | on/off | "Shows which computer key to press on each note of a song." |
| Show the notes being played | on/off | "Writes the names of the notes you play above the piano." |
| Hide the menu automatically | on/off | "The top bar hides when the mouse is still." |

**About**

- The app name and one sentence: "A piano you play with your computer keyboard."
- Credits: "Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)" with the licence name linking to https://creativecommons.org/licenses/by/3.0/ (opens in a new tab, `rel="noreferrer"`).
- "Everything stays in your browser. Nothing is uploaded."
- "Clearing the browser's data for this page removes your settings and songs." (a paragraph of its own).
- "Reset all settings" (inline confirm): `settingsStore.reset()`. Says: "Puts every setting and every key back to how it was at the start." After Yes, one line under that sentence says "Everything is back to how it was at the start." It is an element with `role="status"` that is always on the page and empty until then, so screen readers announce it. It stays until the About tab is left or the panel is closed. The songs are not touched by the reset: a loaded song stays loaded and goes on playing. Closing it later does not move the computer keys back to where they were before the reset (section 9).

### 5.5 The Keys tab: choosing the computer keys

Everything about the computer keys is in this one tab, top to bottom:

1. **Key layout** (presets). A row of cards, one per preset, each with its name, one line of description and a tiny picture of which rows of the keyboard it uses. The card that matches the current keys is marked as chosen; when the keys match no preset, a quiet "Custom" label shows instead. Clicking a card applies it at once (if the current keys are custom, i.e. match no preset, it asks first, inline: "Replace your own keys with this layout?" Yes / No).

   | Preset | Description | Keys → notes (as physical positions on a QWERTY keyboard) |
   |---|---|---|
   | **Home row** (default) | "The middle row plays the white keys, the row above plays the black keys." | the default keys (`DEFAULT_BINDINGS`): A W S E D F T G Y H U J K O L P ; ' → slots 12..29 |
   | **Two octaves** | "Two rows for a low octave, two rows for a high octave." | low: Z S X D C V G B H N J M → slots 0..11; high: Q 2 W 3 E R 5 T 6 Y 7 U → slots 12..23, then I 9 O 0 P [ = ] → slots 24, 25, 26, 27, 28, 29, 30, 31 |
   | **White keys only** | "Three rows, three octaves, no black keys. Good for simple tunes." | Z X C V B N M → white keys of the first octave; A S D F G H J → second octave (middle C on A, as in Home row); Q W E R T Y U → third octave; I → the top C |

   Presets are stored as key codes (physical positions), so each one sits on the same physical keys on every keyboard.

2. **Change one key**: "Click a piano key below, then press the key you want to use for it." While this tab is open the piano under the panel is in selection mode: a click selects a key instead of playing it, the piano always shows the keycaps, and keys outside the keyboard zone are dimmed and cannot be selected. When a key is selected the tab shows "Press a key for C4…" with the hint "Esc = cancel · Backspace = remove this key", then the result message. The result message is forgotten when the keys are moved lower or higher or the keyboard type is changed, because the note or the letter it names may no longer be right; a piano key that is waiting keeps waiting. With no key selected the computer keyboard plays normally, so the player can try the layout. Leaving the tab or closing the panel ends selection mode.

   Opening this tab, and selecting a piano key, pauses a song that is playing (wired in `src/ui/useKeyEditor.ts`). The song stays loaded, and Play carries on from the same place.

   The existing rules, messages, announcements and focus handling of the key editor (`keyEditorModel.ts`, `useKeyEditor.ts`; see `docs/ARCHITECTURE.md` 5.7) stay as they are, apart from the two points above and one more: the key editor no longer answers Escape when no piano key is selected (it used to close the editor). That Escape is the app shell's alone (5.0), and the Settings panel never closes itself because the editor stopped. Only where the rest is shown changes.

3. **Where your keys sit**: "◀ Lower" / "Higher ▶" with the range between them ("C3 – C6"). "Moves your computer keys to lower or higher notes."

4. **Keyboard type**: Auto / QWERTY / AZERTY / QWERTZ (segmented). "Which letters are printed on your keyboard. Auto works it out when the browser can." It only changes the letters drawn on the piano keys, never which physical key plays which note.

5. **"Reset to default keys"** (inline confirm): back to the Home row preset. The result line then says "The default keys are back."

### 5.6 Other pieces

- **The start**: there is no start overlay any more. Until the first click or key press the start box is open over the whole window (5.3a). A file dropped on the page before the first click also takes the start box away, so that the Songs panel does not open behind it; the sound still starts at the next click or key press.
- **The notes being played** (`showNoteNames`): the names of the held notes, small and quiet, centred just above the light line (inside the sky, drawn as HTML over the canvas, `role="status"` is NOT used: it changes too fast to be read out). At most 8 names, then "+3". Hidden while a song is loaded.
- **A first-time hint**: until the first note is played, the sky shows, centred and quiet: "Press the keys shown on the piano, or click it". It is not shown while the start box is open. It fades out at the first note and does not come back.
- **Sound status**: while the sound is `loading`, on `fallback` or in `error`, a small quiet line at the bottom-left of the sky (above the light line), with the same three messages as on the first screen: "Loading piano sound…", "Using basic sound (piano sound could not be loaded)." and "Sound could not start. Click anywhere to try again." `role="status"`.
- **Transposed badge**: next to the sound status line when transpose is not 0 ("Transposed +2").
- **Sustain badge**: a quiet badge "Sustain on" next to the Transposed badge while sustain is on, so that the player knows why notes ring on (Space switches sustain without showing the menu). It is not part of the `role="status"` element.
- **Words over the light**: the note names, the sound status and the badges stand where the light rises and lands. Every letter there has a dark edge around it (invisible against the dark sky), and the badges are smoked glass, so they stay readable when a bar of light passes behind them. The first-time hint steps aside while a panel is open, instead of showing through the panel. An open panel ends above this line of words in a window at least 560 px high (5.4).

## 6. Tokens (`src/styles/theme.css`)

Keep the existing tokens that are still used and add:

```
--stage-bg: #000;
--panel-glass: rgb(16 17 22 / 0.86);
--bar-fade: linear-gradient(to bottom, rgb(0 0 0 / 0.9) 60%, rgb(0 0 0 / 0));   /* black behind the controls of the menu, fading out under them */
--key-ivory, --key-ivory-shine, --key-ivory-shade, --key-ebony, --key-ebony-edge
--light, --light-bright, --light-deep, --light-ink     /* set on the app root from TypeScript (section 4.1); the values in the stylesheet are the Ember defaults */
--glow: 0.6;                                           /* set on the app root from TypeScript */
--top-bar-height: 52px;
```

The chrome's own accent (active tab, primary button, switches that are on, slider fill) follows `--light`, so the whole app takes the chosen colour. Text on an accent-coloured control must stay readable for every colour, including white and a custom one: black or white text is chosen from the colour's lightness (`inkOn` in `colour.ts`, exposed as the `--light-ink` variable).

## 7. Wiring changes

- `App.tsx` is: `TopBar` (with `PlayerLine` as its child, so that the two hide together), the start box (`StartBox`: over the whole window until the first click, among the panels afterwards), `Stage`, the Settings and Songs panels, `SongProgressLine` (outside the menu, so that it stays when the menu hides), and `DropOverlay`, whose `onFilesDropped` opens the Songs panel. No toolbar, no footer, no separate key-editor panel (it lives in the Keys tab).
- The page must never scroll: the "light-trails area shrinks" mechanism of the first screen is gone; it is no longer needed.
- `useNoStuckNotes` (`src/ui/hooks.ts`) also releases when the piano on screen changes (size setting, or Auto picking another size after the window is resized).
- The stage measures its own width (ResizeObserver) to resolve the Auto piano size; the resolved `PianoRange` is computed once in `Stage` and handed to both the piano and the sky, so they always agree. The stage reports it to the app shell (`onRangeChange`), which hands it to `useSongSession`, so that the loaded song is arranged for the piano on screen.
- `useSongSession` (`src/ui/useSongs.ts`) tells the shell what it needs to know about the song: its falling notes, whether one is loaded and whether it is playing. It also follows the place of a song that is not playing: when a paused or stopped song is moved (the position slider, Restart), the app shell is drawn again and the sky shows the new place in the next frame. While a song plays, the shell is not drawn again as it goes.
- The player pauses when the page is hidden or left (`pagehide`), and when the app is taken off the page (see `docs/SONGS.md` 4.5). It is also paused when the computer keys start being chosen (the Keys tab of Settings opens, or a piano key is selected there): wired in `src/ui/useKeyEditor.ts`, not inside the player.
- The click that starts the app asks for the sound once. A click or key press after that asks again only when the sound is not running (never started, or an attempt that failed).

## 8. Quality bar

Everything in `docs/ARCHITECTURE.md` section 7, plus:

- No scrollbars at any window size from 800×500 up.
- Readable and usable at 1366×633 with the full piano: every keycap legible.
- The loop is idle (no animation frames) when nothing moves.
- Works with the menu hidden: the player is never trapped (mouse movement and Tab both bring it back).

## 9. Songs on this screen

Replaces section 5 of `docs/SONGS.md`, whose exact wording (messages, labels, rules) still applies. The song modules are described in its section 4.

- **"All songs…" in the start box** opens the **Songs panel**; the first three songs can also be played straight from the box. It is the same `FloatingPanel` as Settings, floating over the sky; opening one closes the other. Content as in `docs/SONGS.md` 5.2: "Import a MIDI file" + "or drop a MIDI file anywhere on this page", the list (title, length, Play, Rename, Delete with inline confirm), the empty-list sentence, the message line. "Play" loads the song, starts it and closes the panel.
- **Drop anywhere**: the full-page overlay "Drop the MIDI file to add it", as specified there. A drop opens the Songs panel to show the result; a drop before the first click also takes the start box away (5.6).
- **The player line**, shown in the top bar whenever a song is loaded, hiding and showing with it (in a window 1650 px wide or wider in the bar's own row, between the Menu button and the volume, with no glass of its own, since the bar is dark behind it; in a narrower window as a strip of glass in a row of its own under them): Play / Pause · Restart (back to the beginning, where the song waits for Play) · the title · the progress slider with elapsed and total time · Speed (50–150%) · "Song options" · "Close". Song options open as a small panel under the line: Parts, Melody only, Fit to the piano, and the off-piano line, exactly as in `docs/SONGS.md` 5.3. In a window 960 px wide or wider the line is always one row: the title is as wide as its words, up to 320 px, and is the only thing that gets cut; narrower windows have two rows, with the position on the second. The song options end above the piano: they are at most `min(340px, 64dvh - var(--top-bar-height) - 66px)` high (40 px less under a two-row line, 50 px more where the line stands in the bar's own row) and scroll inside. When they open and close is in 5.0.
- While a song is loaded a 2 px progress line in the accent colour runs along the very top edge of the window, always visible, even when the menu is hidden (`SongProgressLine`).
- **Falling notes**: the stage's sky gets a `FallingSource` built from the player and the current arrangement.
- **Lead-in**: a song never starts on its first note. When the earliest note of the song that is not percussion comes sooner than 2 seconds (`LEAD_IN_SECONDS` in `src/ui/useSongs.ts`), every note handed to the player and to the sky is moved later by the same amount, so that this note comes at 2 s and is seen falling; the arrangement's duration grows by that amount. The amount is worked out from the whole song, not from the chosen parts, so the notes do not jump when parts are switched. The player itself is unchanged: positions run from 0 to the duration, and Restart and the end of the song go back to 0, the start of the lead-in. The player line therefore shows a length up to 2 seconds longer than the Songs list, which keeps the song's own length.
- **Starter songs**: the Songs panel lists the built-in starter songs (`docs/SONGS.md` 4.6) in their own group, "Starter songs", under the player's own songs ("Your songs"). They have a Play button but no Rename or Delete. With no imported songs the "Your songs" group shows the empty-list sentence: "No songs of your own yet. Import a MIDI file to add one."
- **Loading a song** moves the keyboard zone (`settings.baseOctave`) to where the player's computer keys can play the most notes of the song: `bestBaseOctave(notes, slotsWithAKey)` (see `docs/SONGS.md` 4.3). The notes that count are those of the chosen parts; with "Melody only" on, they are the ones that will be played (the top note of each chord). With the starter songs and the default keys that place is the default one (C3 – C6). `offPianoCount` and "Fit to the piano" are computed against the piano on screen (a `PianoRange`), not the keyboard zone.
- **Closing a song puts the keys back.** When the song is closed or deleted, the keyboard zone goes back to where the player had it before the song moved it, unless the player moved it while the song was loaded. When another song is played while the keys are still where the last song put them, "where the player had it" is still the place from before the first song. Leaving the page while a song is loaded (a reload, closing the tab: `pagehide`) puts the keys back by the same rule, because the next visit starts with no song; a page that the browser kept and shows again (`pageshow`) still has its song, and the keys go to that song again. "Reset all settings" makes the song forget the place from before it (`forgetKeysBeforeSong`): the keys then stay where the reset put them when the song is closed. All of this is in `src/ui/useSongs.ts`.
