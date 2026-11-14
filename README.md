# PianoApp

> "PianoApp" is a placeholder name until the real one is chosen.

A piano you play with your computer keyboard, in the browser. One key plays one note: no Shift, no key combinations, nothing to hold down.

It is made for a desktop or laptop computer with a keyboard and a mouse. Phones and tablets are not supported.

## What it does today

- **A piano that fills the window.** The piano lies across the bottom of a dark stage with a sampled grand piano sound. Every note you play lights its key and sends a bar of light up the screen, with sparks where it leaves the key. The app opens with a small menu in the middle of the stage: the ways to play, a few songs, Settings and full screen. One click and it is gone; the Menu button brings it back. The bar at the top keeps only what you need while playing, and hides when the mouse is still.
- **Play with the computer keyboard.** The home row (`A S D F G H J K L ; '`) plays the white keys from middle C and the row above (`W E T Y U O P`) plays the black keys. Each piano key shows the computer key that plays it. The mouse plays the keys too.
- **Your own keys.** In Settings, pick a ready-made layout (Home row, Two octaves, White keys only) or click a piano key and press the computer key you want for it. Saved automatically, with a reset. The key labels follow QWERTY, AZERTY and QWERTZ keyboards.
- **Songs.** Six well-known starter tunes are built in, and you can import your own MIDI files (button or drag and drop). A song plays on the piano while its notes fall toward the keys, with the computer key to press written on the notes your keys can play. You can pause, jump around, slow it down or speed it up, choose which parts play, keep only the melody, and fit the notes to the piano on screen. While a song is loaded, your keys move to where they can play the most of it; they go back when you close it.
- **One Settings panel** with five tabs:
  - *Sound*: volume, sustain (also the Space bar), touch strength, room echo, how long notes ring, transpose.
  - *Keys*: the layouts and your own keys, moving the playable keys lower or higher, the keyboard type.
  - *Piano*: 88, 61, 49 or 37 keys (or automatic, to suit the window), what is printed on the keys, note names as C D E or Do Ré Mi.
  - *Look*: six themes, the colour of the light (including your own colour and a rainbow), glow, backgrounds, bar styles, sparks, three key styles, four effects for what a key does when you play it, and what is shown on screen (the bars of light, the key letters on falling notes, the names of the notes you play).
  - *About*: credits, and a button that puts every setting back to how it was at the start.

Planned next: Practice mode (the song waits for you), then Real-time mode with scoring. See [ROADMAP.md](ROADMAP.md).

## Run it

You need [Node.js](https://nodejs.org) 22 (22.22.2 or newer), 24 (24.15 or newer) or 26 and later, and a current version of Chrome, Edge or Firefox on a computer. Firefox cannot tell the app which letters are printed on your keyboard: if the letters on the piano keys do not match yours, choose your keyboard type in Settings, on the Keys tab.

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5173>.

On Windows you can skip the commands and double-click a file instead:

| File | What it does |
|---|---|
| `start-dev.bat` | Starts the development version, the same as `npm run dev`. A change to the code shows at once. |
| `start-release.bat` | Starts the release version: the compiled app, which answers a key press faster. It compiles the app first if that was never done, and tells you when the code has changed since. |
| `compile.bat` | Compiles the app into the release version. Run it again after the code has changed. |

Each file downloads what the app needs the first time. The two start files open the app in your browser at the same address, so your settings and songs are the same in both, and only one of them runs at a time. Keep the window open while you play; close it to stop the app.

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
