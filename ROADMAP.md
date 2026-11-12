# Piano app roadmap

A browser piano played with the computer keyboard. How it is built: `docs/ARCHITECTURE.md` (notes, keys, settings, sound), `docs/INTERFACE.md` (the screen) and `docs/SONGS.md` (songs).

## Design decisions

- Runs in the browser (Chrome, Edge or Firefox), no install. Could be packaged as a desktop app later.
- **One key = one note.** No Shift, no key combinations, nothing that must be held down (sustain is an on/off toggle).
- Default layout: home row (`A S D F G H J K L ; '`) = white keys from middle C, row above (`W E T Y U O P`) = black keys. Two more ready-made layouts (Two octaves, White keys only) can be chosen in Settings.
- Every key is customizable (click a note, press the key you want), saved automatically, with a reset.
- **Simple first, advanced on demand.** The app works with no setup. Everything an experienced player may want to tune (touch strength, transpose, C D E or Do Ré Mi, room echo, note fade-out, piano size, colours and light) is in one Settings panel, grouped in tabs. Later phases put their options there too.
- Easy to navigate (one screen, mode tabs at the top, every control labelled in plain words) and elegant, with a piano that reacts to the player (lit keys, bars of light, sparks).
- The app name is a placeholder ("PianoApp", in `src/app/appInfo.ts`); the real name will be chosen later.
- Three modes: Free Play, Practice (the song waits for you), Real-time (the song keeps its tempo and you are scored).
- Real instruments **without MIDI** (many older keyboards) must be supported: their audio output can be plugged into the PC's mic/line input. The future "real piano" feature therefore listens to audio first (line-in, with a microphone as a fallback); MIDI input can be added for instruments that have it.
- **Desktop only**: the app is for a PC with a keyboard and a mouse. No phone or tablet support.
- The interface is an immersive full-window stage (see `docs/INTERFACE.md`): the piano across the bottom, light bars and sparks above it, falling notes when a song plays, a top menu bar that hides when the mouse is still, and one Settings panel that holds every option.
- The project is meant to be a **public repository**: no personal information, local paths, credentials or private notes in any committed file.
- **As little browser-specific code as possible**: the less, the better. New code uses standard web features that work the same in every current browser. Something that only some browsers have is used only when nothing standard does the job; it is then kept small, in one place, and the app still works without it.

## Phases

- Phase 1. **Playable piano (Free Play)** (done): on-screen piano, computer keys play notes, sampled piano sound, volume, sustain toggle, lower/higher, customizable keys.
- Phase 1b. **The immersive interface and songs** (done): the full-window stage, the Settings panel (sound, keys with layout presets, piano size and key style, look with themes, colour, glow and backgrounds), MIDI import, six built-in starter songs, and listening to a song with falling notes (optionally showing the computer key to press on each note).
- Phase 2. **Practice mode** (next): the song waits for the right key, hints, slow down, loop a section. It builds on the songs, falling notes and starter songs of phase 1b.
- Phase 3. **Real-time mode**: timing judgement (Perfect / Good / Miss), accuracy, streak, stars, tempo slider 50–100%, saved best scores.
- Phase 4. **Free Play extras**: record and replay, metronome.

## Getting songs into the app

In order of priority:

1. **Import a MIDI file** (done in Phase 1b). A MIDI file already contains the exact notes and timing, so the song is right the moment it is imported. Each song can then be simplified: melody only (one note at a time), fit the notes to the piano on screen, choose which parts play, slow it down. Imported songs stay in the player's browser; nothing is uploaded.
2. **Make your own** (later; the design will be discussed first). Record yourself in Free Play and save the recording as a song, and a simple note editor to fix a song or write one by hand.
3. **Audio "detector"** (later; the design will be discussed first; shares its technology with Future update A). Turns a recording of a solo piano into notes. It makes mistakes, so its result is a draft to correct in the editor, and it does not work well on full songs with singing or drums.

Only public-domain songs are bundled with the app. Players import their own files for anything else.

## Future updates

- **A. Real instrument input**: detect notes from audio (the instrument's audio output plugged into the PC input, or a microphone). It must cope with melodies and with chords played with both hands. In Practice and Real-time modes the app knows which notes the song expects, so it only has to check that those notes are in the sound, which is far easier than guessing blind and works for chords. Hearing freely played chords with no song to compare against is the hard part and comes last, with a heavier detector. Feeds the same note events as the computer keyboard, so every mode works with it. It starts with a short **calibration**: the app asks the player to play a few keys it names, then measures how loud the instrument comes in, the background noise, its tuning, and the delay between a key press and the app hearing it. It then tells the player how reliably it can hear single notes and notes played together with this set-up, and saves the result for that instrument.
- **B. Sheet music**: generate sheet music from a song, with a tracker (a cursor that follows the song as it plays and marks right and wrong notes). The sheet can open in its own separate window, so it can sit beside the piano or on a second screen instead of taking space on the stage. Import of MusicXML files.
- Optional: installable app (PWA or desktop wrapper), progress statistics.

## Ideas kept for later

- **More piano customization**: piano height (short, normal, tall keys), a marker on middle C or on every C, a custom key range (pick the lowest and highest note) and 76-key and 25-key presets.
- **More instrument sounds**: electric piano, music box, organ, generated by the app with no extra downloads.
- **Profiles**: save a whole setup (keys, size, colours, sound) under a name, switch between profiles, export and import them as files. To be added once the list of settings has settled.
- **Light**: different colours for the left and right hand of a song.
