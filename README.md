# PianoApp

> "PianoApp" is a placeholder name until the real one is chosen.

A piano you play with your computer keyboard, in the browser. One key plays one note: no Shift, no key combinations, nothing to hold down.

## What it does today

- **Free Play**: an on-screen piano of 37 keys with a sampled grand piano sound. The home row (`A S D F G H J K L ; '`) plays the white keys from middle C and the row above (`W E T Y U O P`) plays the black keys. Each piano key shows the computer key that plays it.
- **Your own keys**: click "Customize keys", click a piano key, then press the key you want for it. Saved automatically, with a reset.
- **Everyday controls**: volume, sustain on/off (Space), move the piano lower or higher, choose what is printed on the keys.
- **Advanced settings** for experienced players, closed by default: touch strength, transpose, note names as C D E or Do Ré Mi, room echo, how long notes ring, light trails.
- **Mouse and touch** also play the on-screen keys, and keys light up with trails rising from them as you play.

Planned next: importing MIDI files and listening to them on the piano, then Practice and Real-time modes. See [ROADMAP.md](ROADMAP.md).

## Run it

You need [Node.js](https://nodejs.org) 22.22 or newer (24 or 26 recommended) and Chrome or Edge.

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

Everything stays in your browser. Settings and custom keys are saved in the browser's local storage. The app makes no network requests other than downloading the piano recordings listed under Credits.

## How it is built

TypeScript, React and Vite, with [Tone.js](https://tonejs.github.io) for sound. Every input (computer keyboard, mouse, and later a real instrument) sends the same "note on / note off" events through one bus, and everything else (sound, the on-screen piano, later the practice modes) listens to that bus. The details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Credits

- **Piano sound**: Salamander Grand Piano (a Yamaha C5) by Alexander Holm, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The MP3 copies are hosted by the [Tone.js project](https://github.com/Tonejs/audio) and are downloaded when the app starts; every third note is downloaded and the notes in between are re-pitched. The recordings are not part of this repository.
- **Libraries**: React, Tone.js and the other dependencies listed in `package.json`, each under its own licence. A production build writes their licence texts to `dist/third-party-licenses.md`.

## Licence

The code is released under the [MIT licence](LICENSE). The piano recordings are not part of this repository and keep their own licence (see Credits).
