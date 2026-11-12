# PianoApp

> "PianoApp" is a placeholder name until the real one is chosen.

A piano you play with your computer keyboard, in the browser. One key plays one note: no Shift, no key combinations, nothing to hold down.

It is made for a desktop or laptop computer with a keyboard and a mouse. Phones and tablets are not supported.

## What it does today

- **A piano that fills the window.** The piano lies across the bottom of a dark stage with a sampled grand piano sound. Every note you play lights its key and sends a bar of light up the screen, with sparks where it leaves the key. The menu at the top hides when the mouse is still, and there is a full-screen button.
- **Play with the computer keyboard.** The home row (`A S D F G H J K L ; '`) plays the white keys from middle C and the row above (`W E T Y U O P`) plays the black keys. Each piano key shows the computer key that plays it. The mouse plays the keys too.
- **Your own keys.** In Settings, pick a ready-made layout (Home row, Two octaves, White keys only) or click a piano key and press the computer key you want for it. Saved automatically, with a reset. The key labels follow QWERTY, AZERTY and QWERTZ keyboards.
- **Songs.** Six well-known starter tunes are built in, and you can import your own MIDI files (button or drag and drop). A song plays on the piano while its notes fall toward the keys, with the computer key to press written on the notes your keys can play. You can pause, jump around, slow it down or speed it up, choose which parts play, keep only the melody, and fit the notes to the piano on screen. While a song is loaded, your keys move to where they can play the most of it; they go back when you close it.
- **One Settings panel** with five tabs:
  - *Sound*: volume, sustain (also the Space bar), touch strength, room echo, how long notes ring, transpose.
  - *Keys*: the layouts and your own keys, moving the playable keys lower or higher, the keyboard type.
  - *Piano*: 88, 61, 49 or 37 keys (or automatic, to suit the window), three key styles, what is printed on the keys, note names as C D E or Do Ré Mi.
  - *Look*: six themes, the colour of the light (including your own colour and a rainbow), glow, backgrounds, bar styles, sparks, and what is shown on screen (the bars of light, the key letters on falling notes, the names of the notes you play).
  - *About*: credits, and a button that puts every setting back to how it was at the start.

Planned next: Practice mode (the song waits for you), then Real-time mode with scoring. See [ROADMAP.md](ROADMAP.md).

## Run it

You need [Node.js](https://nodejs.org) 22 (22.22.2 or newer), 24 (24.15 or newer) or 26 and later, and Chrome or Edge on a computer.

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5173>.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the unit tests |
| `npm run typecheck` | Checks the TypeScript types |
| `npm run build` | Builds the app into `dist/` |

## Privacy

Everything stays in your browser. Settings, custom keys and imported songs are saved in the browser's local storage; a song you import is read on your computer and never uploaded. The app makes no network requests other than downloading the piano recordings listed under Credits. Clearing the browser's site data removes your settings and imported songs.

## How it is built

TypeScript, React and Vite, with [Tone.js](https://tonejs.github.io) for sound. Every input (computer keyboard, mouse, a song being played, and later a real instrument) sends the same "note on / note off" events through one bus, and everything else (sound, the on-screen piano, the light, later the practice modes) listens to that bus.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the note bus, the keys, the settings and the sound engine.
- [docs/INTERFACE.md](docs/INTERFACE.md): the screen.
- [docs/SONGS.md](docs/SONGS.md): MIDI import, the song library and the player.

## Credits

- **Piano sound**: Salamander Grand Piano (a Yamaha C5) by Alexander Holm, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The MP3 copies are hosted by the [Tone.js project](https://github.com/Tonejs/audio) and are downloaded when the app starts; every third note is downloaded and the notes in between are re-pitched. The recordings are not part of this repository.
- **Starter songs**: traditional and classical melodies in the public domain, written out by hand for this app.
- **Libraries**: React, Tone.js, midi-file and the other dependencies listed in `package.json`, each under its own licence. A production build writes their licence texts to `dist/third-party-licenses.md`.

## Licence

The code is released under the [MIT licence](LICENSE). The piano recordings are not part of this repository and keep their own licence (see Credits).
