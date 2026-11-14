# Songs: MIDI import and listening (Phase 1b)

Read `docs/ARCHITECTURE.md` first: its product rules (section 1) and the note bus (section 3) apply here. The screen, songs included, is described in `docs/INTERFACE.md`. This document adds the song feature on top of the finished Phase 1 app.

## 1. What the player gets

1. **Import a MIDI file** with a button or by dropping the file anywhere on the page.
2. **A list of imported songs**, saved in the browser. Rename and delete. Six starter songs are built in (section 4.6).
3. **Listening**: the app plays a song on the piano. Keys light up exactly as when the player plays, and the notes fall toward the keys as bars of light. Play, pause, stop, a progress bar that can be dragged, and a speed control. The player can play along on the keyboard at the same time.
4. **Song options**, closed by default ("simple first, advanced on demand"): which parts of the song to play, melody only, and fit to the piano.

Practice and Real-time modes (later phases) will use the same songs, the same arranging functions and the same player clock. Nothing here may assume that listening is the only use.

Rules specific to songs:

- **Nothing is uploaded.** Files are read in the browser and stored in the browser's own storage. No network request is ever made with song data.
- **No copyrighted music in the repository**: the only bundled songs are the public-domain starter tunes of section 4.6, written out as notes in the code, and tests build their own tiny MIDI files in code.
- Plain words in the UI: "song", "part" (not "track"), "speed" (not "tempo" or "BPM"), "MIDI file" is the only technical term allowed, because it is what the player has to look for.
- No keyboard shortcuts for the player: the keyboard is for notes and Space is sustain. Buttons only.

## 2. How it fits the architecture

```
MIDI file ──▶ parseMidiFile ──▶ Song ──▶ songLibrary (browser storage)
                                 │
              arrange(song, options, range) ──▶ Arrangement (playable notes)
                                 │
                            songPlayer ──▶ NoteBus (source 'playback') ──▶ sound, lit keys, sparks
```

The player is just another **input** on the note bus, with source `'playback'`. It never talks to the sound engine or the UI directly. Because of that, the piano lights up and sounds with no changes to the piano or the engine. The falling notes are the one thing drawn from the arrangement itself, not from the bus (`docs/INTERFACE.md` 5.2): they have to be seen before they sound.

## 3. File map

| File | What it is |
|---|---|
| `src/songs/song.ts` (+ test) | The song types (`SongNote`, `SongTrack`, `Song`, `SongSummary`, `ArrangeOptions`, `PlayableNote`, `Arrangement`, `SongPlayOptions`) and small helpers. `arrange.ts` and `songLibrary.ts` export again the ones that section 4 lists under them. |
| `src/songs/starterSongs.ts` (+ test) | The built-in public-domain tunes. |
| `src/songs/midiImport.ts` (+ test) | Bytes of a MIDI file → `Song`. |
| `src/songs/arrange.ts` (+ test) | `Song` + options → the notes to play. Pure. |
| `src/songs/songLibrary.ts` (+ test) | The saved songs and their options, over browser storage. |
| `src/songs/songPlayer.ts` (+ test) | Plays an arrangement onto the note bus. |
| `src/app/songsApp.ts` | The `player` and `songLibrary` singletons (the bus comes from `src/app/pianoApp.ts`). |
| `src/ui/SongsPanel.tsx` | Import button and the song list (see `docs/INTERFACE.md` section 9). |
| `src/ui/PlayerLine.tsx` | Play / pause / stop / progress / speed / song options, and the progress line along the top of the window. |
| `src/ui/useSongs.ts` | Hooks and the glue: importing files, loading a song into the player (with its lead-in), moving the computer keys to the song and back, re-arranging when options change, whether the song options are open. |
| `src/ui/DropOverlay.tsx` | "Drop the MIDI file to add it". |
| `src/ui/songs.css` | Styles for these components, using `theme.css` tokens only. |

Runtime dependency: **`midi-file`** (MIT, no dependencies of its own), used only for reading the bytes of the file into events. Everything musical (timing, notes, pedal, parts) is our own tested code.

## 4. Module contracts

Export exactly these names and signatures. Non-exported helpers are free.

### 4.1 `src/songs/song.ts`

```ts
/** One note of a song. Times are in seconds from the start of the song, at the song's own speed. */
export interface SongNote {
  midi: Midi
  time: number
  duration: number
  /** 0..1 */
  velocity: number
}

/** One part of a song (a MIDI track, or one channel of a single-track file). */
export interface SongTrack {
  id: number
  /** Name from the file, or '' when it has none. */
  name: string
  /** Drums and other unpitched sounds: never played on the piano. */
  isPercussion: boolean
  /** General MIDI program number 0..127, or null when the file does not say. */
  program: number | null
  /** Sorted by time, then by midi. */
  notes: readonly SongNote[]
}

export interface Song {
  id: string
  title: string
  /** Seconds: when the last note ends. */
  duration: number
  tracks: readonly SongTrack[]
  /** Milliseconds since the epoch. */
  createdAt: number
}

/** What the song list shows, without the notes. */
export interface SongSummary {
  id: string
  title: string
  duration: number
  noteCount: number
  createdAt: number
}

export const MAX_TITLE_LENGTH = 80
export const UNTITLED = 'Untitled song'

/** Trims, collapses whitespace, removes control characters, cuts to MAX_TITLE_LENGTH; empty → UNTITLED. */
export function cleanTitle(raw: string): string

/** A file name without its folder and extension, cleaned: "C:\\music\\fur_elise.mid" → "fur_elise". */
export function titleFromFileName(fileName: string): string

export function summarize(song: Song): SongSummary

/** Plain name of the instrument family for a part: "Piano", "Guitar", "Strings", "Drums"…, "Instrument" when unknown. */
export function instrumentName(track: SongTrack): string

/** "3:07", "0:42", "1:02:15". Never negative, never NaN. */
export function formatDuration(seconds: number): string
```

### 4.2 `src/songs/midiImport.ts`

```ts
export type SongImportErrorCode = 'not-midi' | 'too-big' | 'no-notes' | 'unsupported' | 'damaged'

export class SongImportError extends Error {
  readonly code: SongImportErrorCode
  /** A plain sentence to show the player. */
  readonly userMessage: string
}

export const MAX_MIDI_BYTES = 5 * 1024 * 1024
export const MAX_SONG_NOTES = 50_000

export interface ParseOptions {
  /** Defaults to a random id. */
  id?: string
  /** Defaults to Date.now(). */
  now?: number
}

/** Throws SongImportError and nothing else, whatever the bytes are. Never hangs. */
export function parseMidiFile(bytes: Uint8Array, fileName: string, options?: ParseOptions): Song
```

User messages (exact):

| code | userMessage |
|---|---|
| `not-midi` | `That file is not a MIDI file. MIDI files usually end in .mid or .midi.` |
| `too-big` | `That file is too big. The limit is 5 MB.` |
| `no-notes` | `That MIDI file has no notes in it.` |
| `unsupported` | `That kind of MIDI file is not supported yet.` |
| `damaged` | `That MIDI file seems to be damaged and could not be read.` |

Something the browser cannot read at all (a folder, a file that was moved away) never reaches `parseMidiFile`. It gets a sentence of its own from the glue in `src/ui/useSongs.ts` (section 5.2).

Behaviour:

- Check the size first, then that the bytes start with `MThd` (also accept a RIFF/`RMID` wrapper by finding the embedded `MThd` chunk). Anything else is `not-midi`.
- Formats 0 and 1 are supported. Format 2 and SMPTE time division are `unsupported`. Whatever `midi-file` throws, or any result that does not have the expected shape, is `damaged`. One exception: a track that begins with a sequence-number event written without its number (bytes `00 FF 00 00`), which some programs write and `midi-file` refuses, is read. The importer turns that event into an empty text event on its own copy of the bytes before `midi-file` sees them; the bytes passed in are never changed. The same event further into a track is still `damaged`.
- **Files that were cut off** are read leniently, on purpose. `midi-file` reads what is there: when a file ends early at a place that falls between two events (a download that stopped, or a last track that states too long a length), the song is imported with the notes before the cut and is reported as added. A cut inside an event is `damaged`.
- **Timing**: ticks → seconds with the tempo map. Tempo changes may appear in any track and apply to all tracks (format 1). Default tempo is 120 BPM when the file sets none. Guard against a tempo of 0 and against absurd values.
- **Notes**: a note-on with velocity 0 is a note-off. A note-off with no matching note-on is ignored. A second note-on for a pitch that is already on (same track and channel) ends the first one there. A note-off written at the same tick as that second note-on, after it, belongs to the first note (some programs write a repeated note in this order): the second note sounds until its own note-off. Notes still on at the end of the track end at the track's end. Zero-length notes get a small minimum duration (0.03 s). Pitches outside 21..108 are dropped.
- **Sustain pedal** (controller 64, per channel): while the pedal is down, a note that is released keeps sounding until the pedal comes up or the same pitch is played again on that channel, whichever is first. This is applied to the note durations at import, so the song sounds as the performance intended without any pedal logic in the player.
- **Parts**: format 1 → one `SongTrack` per MIDI track that has notes (id = track index). Format 0, or a track that mixes several channels → one `SongTrack` per channel (ids stay unique). Channel 10 (index 9) is percussion. Track name from the track-name meta event; program from the first program change. Parts with no notes are dropped. No pitched notes at all → `no-notes`.
- More than `MAX_SONG_NOTES` notes in total → `unsupported`.
- **Title**: the name of the first track, when that track has no notes or is the only track of the file, and the name is not empty and not a generic placeholder; otherwise `titleFromFileName(fileName)`. (A first track that plays notes next to other tracks is a part of the song: its name, such as "Right hand" or "Flute", is not the song's.)
- The whole song is shifted so that its first note that is not percussion is at most 1 second after time 0 (long silent lead-ins are trimmed to 1 s; nothing is trimmed if that note is already within 1 s). Percussion notes from before the new start are left out. (When a song is played, the screen adds a lead-in of its own, so that the first note is seen falling: `docs/INTERFACE.md` section 9.)
- `duration` is the end of the last note. All notes sorted as the type says.

### 4.3 `src/songs/arrange.ts`

```ts
export interface ArrangeOptions {
  /** Ids of the parts to play, or 'auto' = every part that is not percussion. */
  trackIds: readonly number[] | 'auto'
  /** One note at a time: the highest one. */
  melodyOnly: boolean
  /** Move notes outside the visible piano by whole octaves so that they land on it. */
  fitToPiano: boolean
}

export const DEFAULT_ARRANGE_OPTIONS: ArrangeOptions   // 'auto', false, false

/** A note ready to be played. Same shape as SongNote. */
export type PlayableNote = SongNote

export interface Arrangement {
  /** Sorted by time, then midi. No two notes of the same pitch overlap. */
  notes: readonly PlayableNote[]
  /** Seconds: when the last note ends (0 when there are no notes). */
  duration: number
  /** How many notes are outside the visible piano (always 0 when fitToPiano is on). */
  offPianoCount: number
}

/** The parts `options` selects (percussion is never included, even when listed). */
export function selectedTracks(song: Song, options: ArrangeOptions): readonly SongTrack[]

/**
 * The base octave (MIN_BASE_OCTAVE..MAX_BASE_OCTAVE) at which the computer keys can play the most of these notes:
 * a note counts when its slot at that base octave is in `playableSlots` (the slots that have a key; when omitted,
 * every slot of the keyboard zone counts). Ties go to the octave nearest DEFAULT_BASE_OCTAVE, then the lower one.
 * DEFAULT_BASE_OCTAVE for no notes.
 */
export function bestBaseOctave(notes: readonly { midi: Midi }[], playableSlots?: ReadonlySet<number>): number

/** `range` is the piano on screen (see `PianoRange` in src/core/layout.ts). */
export function arrange(song: Song, options: ArrangeOptions, range: PianoRange): Arrangement
```

Steps of `arrange`, in order:

1. Merge the notes of the selected parts.
2. `melodyOnly`: notes that start within 30 ms of each other form a chord, of which only the highest is kept; then each kept note is cut short where the next kept note starts, so one note sounds at a time.
3. `fitToPiano`: a note outside `range.first .. range.last` is moved by whole octaves to the nearest position inside it.
4. Same-pitch clean-up (needed because the bus ignores a second press of a note that is already held by the same source): of several notes of one pitch starting within 1 ms keep the longest; a note still sounding when the same pitch starts again is cut to end at that start.
5. Drop notes shorter than 1 ms after cutting; sort; compute `duration` and `offPianoCount`.

`arrange` never mutates the song and is deterministic.

### 4.4 `src/songs/songLibrary.ts`

```ts
export interface SongPlayOptions extends ArrangeOptions {
  /** 0.5..1.5, where 1 is the song's own speed. */
  speed: number
}

export const DEFAULT_PLAY_OPTIONS: SongPlayOptions   // DEFAULT_ARRANGE_OPTIONS + speed 1
export const MIN_SPEED = 0.5
export const MAX_SPEED = 1.5

export type SongStorageErrorCode = 'full'

export class SongStorageError extends Error {
  readonly code: SongStorageErrorCode
  readonly userMessage: string   // "There is no room left to save songs. Delete a song and try again."
}

export interface SongLibrary {
  /** Newest first. Same array reference until something changes. */
  list(): readonly SongSummary[]
  /** The full song, or null when it does not exist or its stored data is unreadable. */
  get(id: string): Song | null
  /** The saved options for a song (defaults when none are saved or the song is unknown). */
  getOptions(id: string): SongPlayOptions
  /** Saves a song. Throws SongStorageError('full') when the browser refuses; the library is then unchanged. */
  add(song: Song): void
  rename(id: string, title: string): void
  remove(id: string): void
  setOptions(id: string, patch: Partial<SongPlayOptions>): void
  subscribe(listener: () => void): () => void
}

/** `storage` null/undefined → in memory only (songs last until the page is closed). */
export function createSongLibrary(storage?: StorageLike | null): SongLibrary

/** App-wide singleton over window.localStorage when available. Importing this module must not throw in Node. */
export const songLibrary: SongLibrary

export function useSongList(): readonly SongSummary[]
```

- Storage layout: one index entry `pianoapp.songs.v1` (the summaries and each song's options) and one entry per song `pianoapp.song.v1.<id>` holding the notes in a compact form (arrays of numbers, times in whole milliseconds, velocity 0..127) so that a long song is tens of kilobytes, not megabytes.
- Everything read from storage is treated as untrusted: wrong shapes, missing songs, extra keys, `__proto__`, NaN. A broken entry is skipped (and removed from the index); it never throws out of the library and never breaks the other songs.
- `add` writes the song first and the index second, and undoes the first write if the second fails, so the index never points at a missing song and no orphan entry is left behind.
- `rename` uses `cleanTitle`. `setOptions` sanitizes (speed clamped, unknown part ids kept as given: the arranger ignores ids that do not exist).
- Only `add` can throw. Other writes that fail keep the change in memory and carry on.
- Reuse `StorageLike` from `src/state/settings.ts`.

### 4.5 `src/songs/songPlayer.ts`

```ts
export type PlayerStatus = 'empty' | 'stopped' | 'playing' | 'paused'

export interface PlayerState {
  status: PlayerStatus
  songId: string | null
  title: string
  /** Seconds into the song (song time, not wall time). */
  position: number
  duration: number
  /** 0.5..1.5 */
  speed: number
}

export interface PlayerDeps {
  bus: NoteBus
  /** Milliseconds, monotonic. Defaults to performance.now. */
  now?(): number
  /** Default to the global timers. */
  setInterval?(handler: () => void, ms: number): unknown
  clearInterval?(handle: unknown): void
}

export interface SongPlayer {
  /**
   * Replaces what is loaded. Stops first, unless `keepPlace` is true: then position and playing/paused state
   * are kept (used when the options of the current song change). With `keepPlace` and the arrangement that is
   * already loaded (the same `notes` array, the same duration), only the id and the title are taken over: the
   * notes that are sounding are left alone (used when the current song is renamed).
   */
  load(song: { id: string; title: string }, arrangement: Arrangement, options?: { keepPlace?: boolean }): void
  /** Back to 'empty'. */
  unload(): void
  play(): void
  pause(): void
  /** Stops and goes back to the start. */
  stop(): void
  seek(seconds: number): void
  setSpeed(speed: number): void
  /** Same object until something changes. While playing, `position` in this snapshot is refreshed about 10 times a second. */
  getState(): PlayerState
  /** The exact position right now. */
  getPosition(): number
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createSongPlayer(deps: PlayerDeps): SongPlayer
```

Behaviour:

- Notes go to the bus with source `'playback'` and the note's own velocity.
- While playing, a timer ticks every 5 ms. Each tick advances the position by the real time elapsed × speed, then releases every note whose end has passed and starts every note whose start has passed, **releases before presses**, in time order.
- A long gap between ticks (more than 250 ms of real time, for example a throttled background tab or a debugger pause) advances the position by 250 ms only: the song waits rather than dumping a burst of notes.
- **No stuck notes**: `pause`, `stop`, `seek`, `load`, `unload`, `dispose` and reaching the end all release every note the player is holding (`bus.allOff('playback')` plus its own bookkeeping). The player must also cope with someone else calling `bus.allOff()` while it is playing (its later releases of those notes are simply ignored by the bus). The one exception is a `load` with `keepPlace` of the arrangement that is already loaded (the same `notes` array and the same duration): nothing about the music changes, so nothing is released and the song plays on.
- Reaching the end: status `'stopped'`, position 0.
- `seek` clamps to 0..duration. Notes already sounding at the new position are not restarted; playing continues with the next note that starts. Seeking while paused or stopped moves the position without playing.
- `play` when empty does nothing. `play` at the very end starts from 0.
- The timer exists only while the status is `'playing'`.
- `setSpeed` clamps to MIN_SPEED..MAX_SPEED and takes effect at once.
- Subscribers are told at once about status, song, speed and seek changes, and about position at most about 10 times a second.
- The page becoming hidden pauses the player (browsers slow timers in hidden tabs, which would make the song crawl), and so do leaving the page (`pagehide`) and the app being taken off the page: this is wired by the app (`useSongSession` in `src/ui/useSongs.ts`), not inside the player.
- The player is also paused when the computer keys start being chosen (the Keys tab of Settings opens, or a piano key is selected there): wired in `src/ui/useKeyEditor.ts`, not inside the player.

### 4.6 `src/songs/starterSongs.ts`

```ts
/** Built-in songs: old tunes in the public domain, written out here as notes. Their ids start with 'starter:'. */
export const STARTER_SONGS: readonly Song[]
export function isStarterSong(id: string): boolean

/** One built-in tune as it is written down: id, title, beatsPerMinute, tune. */
export interface StarterTune
/** The tunes of the table below. Exported for the unit test that checks the bars of every tune. */
export const STARTER_TUNES: readonly StarterTune[]

/**
 * Turns a tune written as text into a Song with one part.
 * `tune` is a list of tokens separated by spaces: "C4/1" is the note C4 for 1 beat,
 * "D#5/.25" a quarter of a beat, "R/.5" a rest of half a beat. "|" is ignored (bar lines, for reading).
 * Each note sounds for 90% of its length so that repeated notes are heard separately.
 * Throws on a token it cannot read (the tunes are checked by a unit test).
 */
export function tuneToSong(id: string, title: string, beatsPerMinute: number, tune: string): Song
```

Starter songs are not stored in the library; `songLibrary.getOptions` / `setOptions` accept their ids so that speed and options are remembered for them too. They cannot be renamed or deleted. All of them are playable with the default "Home row" keys at the default piano position (every note is between C4 and F5).

The tunes (exact notes; "|" marks bars):

| Title | BPM | Tune |
|---|---|---|
| Twinkle, Twinkle, Little Star | 100 | `C4/1 C4/1 G4/1 G4/1 | A4/1 A4/1 G4/2 | F4/1 F4/1 E4/1 E4/1 | D4/1 D4/1 C4/2 | G4/1 G4/1 F4/1 F4/1 | E4/1 E4/1 D4/2 | G4/1 G4/1 F4/1 F4/1 | E4/1 E4/1 D4/2 | C4/1 C4/1 G4/1 G4/1 | A4/1 A4/1 G4/2 | F4/1 F4/1 E4/1 E4/1 | D4/1 D4/1 C4/2` |
| Mary Had a Little Lamb | 110 | `E4/1 D4/1 C4/1 D4/1 | E4/1 E4/1 E4/2 | D4/1 D4/1 D4/2 | E4/1 G4/1 G4/2 | E4/1 D4/1 C4/1 D4/1 | E4/1 E4/1 E4/1 E4/1 | D4/1 D4/1 E4/1 D4/1 | C4/4` |
| Ode to Joy | 110 | `B4/1 B4/1 C5/1 D5/1 | D5/1 C5/1 B4/1 A4/1 | G4/1 G4/1 A4/1 B4/1 | B4/1.5 A4/.5 A4/2 | B4/1 B4/1 C5/1 D5/1 | D5/1 C5/1 B4/1 A4/1 | G4/1 G4/1 A4/1 B4/1 | A4/1.5 G4/.5 G4/2 | A4/1 A4/1 B4/1 G4/1 | A4/1 B4/.5 C5/.5 B4/1 G4/1 | A4/1 B4/.5 C5/.5 B4/1 A4/1 | G4/1 A4/1 D4/2 | B4/1 B4/1 C5/1 D5/1 | D5/1 C5/1 B4/1 A4/1 | G4/1 G4/1 A4/1 B4/1 | A4/1.5 G4/.5 G4/2` |
| Frère Jacques | 110 | `G4/1 A4/1 B4/1 G4/1 | G4/1 A4/1 B4/1 G4/1 | B4/1 C5/1 D5/2 | B4/1 C5/1 D5/2 | D5/.5 E5/.5 D5/.5 C5/.5 B4/1 G4/1 | D5/.5 E5/.5 D5/.5 C5/.5 B4/1 G4/1 | G4/1 D4/1 G4/2 | G4/1 D4/1 G4/2` |
| Jingle Bells | 120 | `E4/1 E4/1 E4/2 | E4/1 E4/1 E4/2 | E4/1 G4/1 C4/1.5 D4/.5 | E4/4 | F4/1 F4/1 F4/1.5 F4/.5 | F4/1 E4/1 E4/1 E4/.5 E4/.5 | E4/1 D4/1 D4/1 E4/1 | D4/2 G4/2 | E4/1 E4/1 E4/2 | E4/1 E4/1 E4/2 | E4/1 G4/1 C4/1.5 D4/.5 | E4/4 | F4/1 F4/1 F4/1.5 F4/.5 | F4/1 E4/1 E4/1 E4/.5 E4/.5 | G4/1 G4/1 F4/1 D4/1 | C4/4` |
| Für Elise (opening) | 66 | `E5/.25 D#5/.25 | E5/.25 D#5/.25 E5/.25 B4/.25 D5/.25 C5/.25 | A4/.5 R/.25 C4/.25 E4/.25 A4/.25 | B4/.5 R/.25 E4/.25 G#4/.25 B4/.25 | C5/.5 R/.25 E4/.25 E5/.25 D#5/.25 | E5/.25 D#5/.25 E5/.25 B4/.25 D5/.25 C5/.25 | A4/.5 R/.25 C4/.25 E4/.25 A4/.25 | B4/.5 R/.25 E4/.25 C5/.25 B4/.25 | A4/1` |

All six are traditional tunes or were written before 1860; all are in the public domain.

## 5. Screen

> Where these pieces sit on the screen is described in `docs/INTERFACE.md` section 9, which replaces the layout first planned here. This section is kept for its exact wording (messages, labels, rules), which still applies.

Follow section 1 of `docs/ARCHITECTURE.md` and the look of `docs/INTERFACE.md`. Exact wording below.

### 5.1 Where the songs are opened

The Songs panel is opened from the start box, with its line "All songs…" (`docs/INTERFACE.md` 5.3a); the first three songs can also be played straight from the box. There is no "Songs" button in the top bar any more. The panel floats over the sky as the Settings panel does (`docs/INTERFACE.md` 5.4). Only one of the two panels is open at a time: opening one closes the other.

### 5.2 Songs panel (`SongsPanel`)

- Heading "Songs".
- **"Import a MIDI file"** button (primary). Opens the file picker (`accept=".mid,.midi,audio/midi,audio/x-midi"`, several files allowed). Next to it: "or drop a MIDI file anywhere on this page".
- Two groups: "Your songs" (the player's own, newest first) and under it "Starter songs" (section 4.6), which have a "Play" button only. Each row of the player's own songs: the title, the length (`formatDuration`), a **"Play"** button, **"Rename"** and **"Delete"**.
  - Play: loads the song into the player, starts it, and closes the Songs panel so the piano is in view. A song whose saved notes cannot be read is not played: the panel stays, and the message line says `That song could not be read. Delete it and import the MIDI file again.`
  - Rename: the title becomes a text field in place, with "Save" and "Cancel". Enter saves, Escape cancels. (While the field has focus the keyboard types text and does not play notes: this is already how the app treats text fields.) Renaming the song that is playing does not interrupt it.
  - Delete: asks inline ("Delete?" with Yes / No), like the other confirmations in the app. Deleting the song that is loaded in the player closes it.
- Empty list (the "Your songs" group): "No songs of your own yet. Import a MIDI file to add one."
- A message line (role="status") for results: `"<title>" was added.` (for several files: `3 songs were added.`), or the `userMessage` of the error, prefixed with the file name when several files were imported at once.
  - Anything the browser cannot read at all (a folder, a file that was moved away) gets a sentence of its own, which is not one of the `SongImportError` messages: `That could not be read. If it is a folder, open it and drop the MIDI files that are in it.`
  - Files added while earlier files are still being read join the same report: the message line then says how every file of both lots went.
- Importing the same file twice simply adds it twice.

**Drop anywhere**: while a file is dragged over the page, a full-page overlay says "Drop the MIDI file to add it". Dropping imports it and opens the Songs panel to show the result. A file dropped on the page before the first click also takes the start box away, so that the Songs panel does not open behind it; the sound still starts at the next click or key press. Dragging things that are not files (text, links) shows nothing and is not blocked. The browser must never navigate away to the dropped file.

### 5.3 Player line (`PlayerLine`)

Shown in the top bar whenever a song is loaded (`docs/INTERFACE.md` section 9 says where in it):

- **Play / Pause** (one button whose label and icon change), **Restart** (takes the song back to its beginning, where it waits: Play starts it again from there. In the player this is `stop()`) and **Stop** (ends the song and takes it away: the song is unloaded and the line hides. It stands right after Restart, with the other buttons that act on the song; as "Close" at the far end of the line it was hard to find and hard to tell what it closed).
- The song title (cut with an ellipsis when long).
- The progress slider (`aria-label="Position in the song"`), with the elapsed and total time on either side (`formatDuration`). Dragging it seeks. The total is the length of what is played, lead-in included (`docs/INTERFACE.md` section 9).
- **Speed**: a slider from 50% to 150% in steps of 5, showing the value ("100%").
- **"Song options"** (quiet button, `aria-expanded`), the last control of the line.

Song options, shown under the line when open:

- **Parts**: one checkbox per non-percussion part, labelled with its name when it has one, then the instrument and the note count, e.g. "Right hand · Piano · 532 notes" or "Part 2 · Strings · 120 notes". At least one part stays checked (the last checked one cannot be unchecked). Shown only when the song has more than one such part.
- **Melody only** (switch): "Plays one note at a time: the highest one."
- **Fit to the piano** (switch): "Moves notes that are too low or too high onto the piano you see."
- When some notes are off the piano and Fit is off, a quiet line: "12 notes are too low or too high to show on the piano. They still play." (singular: "1 note is…").

Behaviour:

- Loading a song moves the computer keys (`settings.baseOctave`) to `bestBaseOctave` of the notes of its selected parts (with "Melody only" on: of the notes that will be played) and the slots that have a key, so the player can play along with most of the song. After that the player may move the keys as usual. Closing or deleting the song puts the keys back where the player had them, unless the player moved them meanwhile; so does leaving the page with the song loaded (`pagehide`). After "Reset all settings" they stay where the reset put them (`docs/INTERFACE.md` section 9).
- A song is played with a lead-in, so that its first note is seen falling before it sounds (`LEAD_IN_SECONDS`, 2 seconds: `docs/INTERFACE.md` section 9). The Songs list keeps showing the song's own length.
- The arrangement is recomputed (and the player reloaded with `keepPlace`) whenever the song's options or the piano on screen change. A change of speed alone keeps the arrangement.
- Options and speed are saved per song (`songLibrary.setOptions`) and restored the next time the song is loaded.
- The player pauses when the page is hidden or left (`pagehide`), and when the app is taken off the page. It is also paused when the computer keys start being chosen (section 4.5).
- Moving the computer keys or changing the piano on screen releases all notes on the bus (existing behaviour); the song simply carries on with its next notes.
- The names of the notes being played are hidden while a song is loaded (`docs/INTERFACE.md` 5.6).
- The player's own keyboard and mouse playing work as always while a song plays.

## 6. Quality bar

Everything in section 7 of `docs/ARCHITECTURE.md`, plus:

- `parseMidiFile` survives a fuzz test: thousands of random and mutated byte arrays; it only ever returns a valid `Song` or throws `SongImportError`, and always returns promptly.
- `arrange` invariants hold on random songs: sorted output, no same-pitch overlap, monophonic when `melodyOnly`, every note on the piano when `fitToPiano`, the input never mutated.
- The player, driven by a fake clock in tests: every press it sends is matched by a release, through any sequence of play / pause / seek / speed / load / unload / stop.
- The library never loses or corrupts the other songs when one entry is broken or storage is full.
