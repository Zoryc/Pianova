/**
 * An audit of the repository as a whole, which is meant to be public:
 *
 * - nothing personal, no local path and no secret in any file;
 * - the documents agree with the code on where things are;
 * - the README names what the app has today, and neither it nor the roadmap
 *   still describes the screen of the version before;
 * - package.json lists the right dependencies and the licence;
 * - the built app (when `dist/` holds a build of the code as it is now)
 *   carries no debug hook, no test code and the licences of everything it
 *   bundles.
 *
 * Everything is read as text from the project folder. Nothing is changed. The
 * only things taken from the code itself are the app's name and the names of
 * the ready-made key layouts, so that these checks follow a renaming.
 */
import { describe, expect, it } from 'vitest'
import { APP_NAME } from './app/appInfo'
import { KEY_PRESETS } from './input/keymap'

interface FolderEntry {
  name: string
  isDirectory(): boolean
}

interface FileSystem {
  existsSync(path: URL): boolean
  readFileSync(path: URL, encoding: 'utf8'): string
  readdirSync(path: URL, options: { withFileTypes: true }): FolderEntry[]
  statSync(path: URL): { mtimeMs: number }
}

// Loaded this way because the project has no Node type definitions.
const fileSystemModule = 'node:fs'
const files = (await import(/* @vite-ignore */ fileSystemModule)) as FileSystem

/** The project folder: this file is in `src/`, one level below it. */
const ROOT = new URL('../', import.meta.url)
const THIS_FILE = 'src/repo.audit.test.ts'

/** Folders that are not part of the repository (see .gitignore), and git's own. */
const NOT_PUBLISHED = new Set(['node_modules', 'dist', '.git', '.claude', '.vite', 'coverage'])
/** Written by npm, not by hand: checked on its own. */
const LOCK_FILE = 'package-lock.json'

/** `path` is written from the project folder, with forward slashes. */
function read(path: string): string {
  return files.readFileSync(new URL(path, ROOT), 'utf8')
}

function exists(path: string): boolean {
  return path !== '' && files.existsSync(new URL(path, ROOT))
}

/** The names of the files in a folder (not of the folders in it). */
function filesIn(folder: string): string[] {
  return files
    .readdirSync(new URL(`${folder}/`, ROOT), { withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => `${folder}/${entry.name}`)
}

/** Every file of the repository, as paths from its root with forward slashes. */
function publishedFiles(folder = ''): string[] {
  const found: string[] = []
  for (const entry of files.readdirSync(new URL(folder, ROOT), { withFileTypes: true })) {
    if (NOT_PUBLISHED.has(entry.name)) continue
    const path = folder + entry.name
    if (entry.isDirectory()) found.push(...publishedFiles(`${path}/`))
    else if (path !== THIS_FILE) found.push(path)
  }
  return found
}

/** The lines of `text` that match `pattern`, as "file:line: text" (cut short). */
function linesMatching(file: string, text: string, pattern: RegExp): string[] {
  return text
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => pattern.test(line))
    .map(({ line, number }) => `${file}:${number}: ${line.trim().slice(0, 120)}`)
}

function everyLineMatching(pattern: RegExp): string[] {
  return publishedFiles()
    .filter((file) => file !== LOCK_FILE)
    .flatMap((file) => linesMatching(file, read(file), pattern))
}

/** A test, or a helper that only tests use. */
function isTestCode(file: string): boolean {
  return /\.test\.tsx?$|TestKit\.ts$|testSupport\.ts$/.test(file)
}

/** The TypeScript files the app itself is made of. */
function appCodeFiles(): string[] {
  return publishedFiles().filter((file) => /^src\/.*\.tsx?$/.test(file) && !isTestCode(file))
}

/** `text` as a pattern that finds exactly that text. */
function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The patterns that find nothing in `text`, as they are written. */
function notFoundIn(text: string, patterns: readonly RegExp[]): string[] {
  return patterns.filter((pattern) => !pattern.test(text)).map(String)
}

describe('nothing private is in the repository', () => {
  it('no path into somebody’s own folders', () => {
    // A drive and a users folder, a home folder (the made-up "/home/me" of a test aside), or a profile folder.
    const localPath = /[A-Za-z]:[\\/]+Users[\\/]|\/(?:Users|home)\/(?!me\/)[\w.-]+\/|AppData[\\/]/
    expect(everyLineMatching(localPath)).toEqual([])
  })

  it('no e-mail address', () => {
    // Addresses at example.com and the like are made up on purpose and belong to nobody.
    const email = /[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net))[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
    expect(everyLineMatching(email)).toEqual([])
  })

  it('no key, password or token', () => {
    const secret =
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|(?:api[_-]?key|secret|passwd|password|access[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/i
    expect(everyLineMatching(secret)).toEqual([])
  })

  it('no settings file of somebody’s own machine or editor', () => {
    const own = publishedFiles().filter((file) =>
      /(^|\/)(\.env(\..*)?|.*\.local|.*\.log|\.DS_Store|Thumbs\.db)$/.test(file),
    )
    expect(own).toEqual([])
  })

  it('keeps the folders that must never be published out of git', () => {
    const ignored = read('.gitignore').split(/\r?\n/)
    for (const entry of ['node_modules', 'dist', '.env', '.env.*', '*.local', '.claude/', '*.log']) {
      expect(ignored).toContain(entry)
    }
  })

  it('the lock file points at the public npm registry only', () => {
    const lock = JSON.parse(read(LOCK_FILE)) as {
      packages: Record<string, { resolved?: string; link?: boolean }>
    }
    const elsewhere = Object.entries(lock.packages)
      .filter(([name]) => name !== '')
      .filter(([, entry]) => !entry.resolved?.startsWith('https://registry.npmjs.org/'))
      .map(([name]) => name)
    expect(elsewhere).toEqual([])
  })
})

describe('package.json', () => {
  const manifest = JSON.parse(read('package.json')) as {
    license?: string
    private?: boolean
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  it('has what the app needs to run as dependencies, and nothing else', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['midi-file', 'react', 'react-dom', 'tone'])
  })

  it('every dependency is really imported by the app, and none by a test only', () => {
    const appCode = appCodeFiles().map(read).join('\n')
    for (const name of Object.keys(manifest.dependencies)) {
      expect(appCode, name).toMatch(new RegExp(`from '${name}(/[^']*)?'|import\\('${name}'\\)`))
    }
    for (const name of Object.keys(manifest.devDependencies)) {
      expect(appCode, name).not.toMatch(new RegExp(`from '${name}(/[^']*)?'|import\\('${name}'\\)`))
    }
  })

  it('names the licence of the LICENSE file', () => {
    expect(manifest.license).toBe('MIT')
    expect(read('LICENSE')).toMatch(/^MIT License/)
  })

  it('agrees with the lock file, so that installing changes no file', () => {
    const lock = JSON.parse(read(LOCK_FILE)) as { packages: Record<string, Record<string, unknown>> }
    const root = lock.packages[''] ?? {}
    expect(root.dependencies).toEqual(manifest.dependencies)
    expect(root.devDependencies).toEqual(manifest.devDependencies)
    // npm copies the licence into the lock file; a lock file written before the
    // licence was added is rewritten by the next `npm install`.
    expect(root.license).toBe(manifest.license)
  })
})

describe('the documents and the code', () => {
  const DOCUMENTS = ['README.md', 'ROADMAP.md', 'docs/ARCHITECTURE.md', 'docs/INTERFACE.md', 'docs/SONGS.md']

  /** The source files named in the first cell of a table row: the "file map" tables. */
  function filesOfFileMaps(document: string): { line: number; path: string }[] {
    const named: { line: number; path: string }[] = []
    read(document)
      .split('\n')
      .forEach((text, index) => {
        const firstCell = /^\|([^|]*)\|/.exec(text)?.[1] ?? ''
        for (const match of firstCell.matchAll(/`(src\/[^`*]+)`/g)) {
          named.push({ line: index + 1, path: match[1] ?? '' })
        }
      })
    return named
  }

  it.each(DOCUMENTS)('%s: every file of its file maps exists', (document) => {
    const missing = filesOfFileMaps(document)
      .filter(({ path }) => !exists(path))
      .map(({ line, path }) => `${document}:${line}: ${path}`)
    expect(missing).toEqual([])
  })

  it('docs/SONGS.md sends the reader to the file that really holds the song player', () => {
    const home = filesIn('src/app').find((file) => /^export const player\b/m.test(read(file)))
    expect(home, 'the file of src/app that exports the song player').toBeDefined()

    // That file is in the file map of the document…
    const inTheFileMap = filesOfFileMaps('docs/SONGS.md').map(({ path }) => path)
    expect(inTheFileMap).toContain(home)
    // …and no row of a table gives the player's one copy another home.
    const otherHomes = read('docs/SONGS.md')
      .split('\n')
      .filter((row) => row.startsWith('|') && row.includes('`player`') && row.includes('singleton'))
      .filter((row) => !row.includes(`\`${home}\``))
    expect(otherHomes).toEqual([])
  })

  it('every document that is linked from another one exists', () => {
    const broken: string[] = []
    for (const document of DOCUMENTS) {
      const folder = document.includes('/') ? document.slice(0, document.lastIndexOf('/') + 1) : ''
      for (const match of read(document).matchAll(/\]\((?!https?:|#)([^)#]+)(#[^)]*)?\)/g)) {
        const target = match[1] ?? ''
        if (!exists(folder + target)) broken.push(`${document}: ${target}`)
      }
      for (const match of read(document).matchAll(/`((?:docs\/)?[A-Z]+\.md)`/g)) {
        const target = match[1] ?? ''
        if (!exists(target) && !exists(`docs/${target}`)) broken.push(`${document}: ${target}`)
      }
    }
    expect(broken).toEqual([])
  })

  // No document fixes the wording of the README, so these look for the things
  // it must name, each by a word or two, and leave the sentences to the writer.
  it('the README names what the app has today', () => {
    const readme = read('README.md')
    // The ready-made layouts, by the names the app shows them under.
    const layouts = KEY_PRESETS.map((layout) => layout.name)
    expect(layouts.filter((name) => !readme.includes(name))).toEqual([])
    // Songs from MIDI files, also by dropping them; falling notes; themes; the
    // Settings panel; the menu that hides.
    const features = [
      /\bsongs?\b/i,
      /\bMIDI\b/,
      /\bdrop/i,
      /\bfall/i,
      /\bthemes?\b/i,
      /\bSettings\b/,
      /\bhides?\b|\bhidden\b/i,
    ]
    expect(notFoundIn(readme, features)).toEqual([])
  })

  it('the README says the app is for a computer, in Chrome, Edge or Firefox, and not for phones or tablets', () => {
    const readme = read('README.md')
    expect(notFoundIn(readme, [/\b(desktop|laptop)\b/i, /\bChrome\b/, /\bEdge\b/, /\bFirefox\b/])).toEqual([])
    // One sentence names phones or tablets and says no to them.
    const sentences = readme.split(/(?<=[.!?])\s+/)
    const saysNo = sentences.filter(
      (sentence) => /\b(phones?|tablets?)\b/i.test(sentence) && /\b(not|no)\b/i.test(sentence),
    )
    expect(saysNo).not.toEqual([])
  })

  it('the README asks for the versions of Node.js that package.json asks for', () => {
    const { engines } = JSON.parse(read('package.json')) as { engines: { node: string } }
    const readme = read('README.md')
    // "^22.22.2 || ^24.15.0 || >=26": the oldest version that will do of each line of Node.js,
    // which the README names at least down to its second number (22.22, 24.15, 26).
    const oldestOfEachLine = engines.node
      .split('||')
      .map((range) => range.replace(/[^\d.]/g, '').split('.').slice(0, 2).join('.'))
    // As a number of its own: "24.15" is not found in "124.15" or in "24.150".
    const notSaid = oldestOfEachLine.filter(
      (version) => !new RegExp(`(?<![\\d.])${literally(version)}(?!\\d)`).test(readme),
    )
    expect(notSaid).toEqual([])
  })

  it('the app names no site that the README does not name', () => {
    const sitesIn = (text: string): string[] =>
      [...text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((match) => match[1] ?? '')
    const named = new Set(sitesIn(read('README.md')))
    // The name of a web standard, written in the icon of index.html: never asked for anything.
    named.add('www.w3.org')

    const shipped = publishedFiles().filter(
      (file) => file === 'index.html' || (file.startsWith('src/') && !isTestCode(file)),
    )
    const unknown = shipped.flatMap((file) =>
      sitesIn(read(file))
        .filter((site) => !named.has(site))
        .map((site) => `${file}: ${site}`),
    )
    expect(unknown).toEqual([])
  })

  it('the README keeps the credits and the licence', () => {
    // Who made the piano recordings and under which licence they may be used,
    // where the starter songs come from, the library that reads MIDI files, and
    // the licence of the code.
    const credits = [
      /Salamander Grand Piano/,
      /Alexander Holm/,
      /creativecommons\.org\/licenses\/by\/3\.0/,
      /public domain/,
      /midi-file/,
      /MIT licen[cs]e/,
    ]
    expect(notFoundIn(read('README.md'), credits)).toEqual([])
  })

  // The parts of the screen of the version before, which the app no longer has.
  it.each(['README.md', 'ROADMAP.md'])('%s no longer describes the old screen', (document) => {
    const oldScreen = /Advanced panel|light trails|Customize keys|toolbar/i
    expect(linesMatching(document, read(document), oldScreen)).toEqual([])
  })

  it('the app’s name is written in one place only', () => {
    // The name as a piece of text of its own: between quotes, or as all that an element says.
    const nameAsText = new RegExp(`['"\`>]${literally(APP_NAME)}['"\`<]`)
    const elsewhere = appCodeFiles()
      .filter((file) => file !== 'src/app/appInfo.ts')
      .flatMap((file) => linesMatching(file, read(file), nameAsText))
    expect(elsewhere).toEqual([])
    // The check looks for the right thing: it does find the name where it is written.
    expect(linesMatching('src/app/appInfo.ts', read('src/app/appInfo.ts'), nameAsText)).toHaveLength(1)
  })
})

/**
 * True when `dist/` holds a build of the code as it is now: it is there, and
 * nothing a build is made from was written after it. `dist/` is not part of
 * the repository, so an older build says nothing about this code. Run
 * `npm run build` and then the tests to have the build checked.
 */
function isBuiltFromThisCode(): boolean {
  if (!exists('dist/index.html')) return false
  const writtenAt = (path: string): number => files.statSync(new URL(path, ROOT)).mtimeMs
  try {
    const builtAt = writtenAt('dist/index.html')
    return publishedFiles()
      .filter((file) => !isTestCode(file) && !file.endsWith('.md'))
      .every((file) => writtenAt(file) <= builtAt)
  } catch {
    // A file went away while it was being looked at: the code is being changed right now.
    return false
  }
}

describe.skipIf(!isBuiltFromThisCode())('the built app (dist/), built from the code as it is now', () => {
  function builtFiles(): string[] {
    return filesIn('dist/assets')
  }

  function builtScripts(): string {
    return builtFiles()
      .filter((file) => file.endsWith('.js'))
      .map(read)
      .join('\n')
  }

  it('has no debug hook on the window', () => {
    // `stage__piano` is a class name; the hook was `window.__piano`.
    expect(builtScripts()).not.toMatch(/(?<![A-Za-z0-9_-])__piano\b/)
  })

  it('has no test code and no development-only code', () => {
    const scripts = builtScripts()
    for (const leftover of ['vitest', '@testing-library', 'skyTestKit', 'songsTestKit', 'testSupport', 'import.meta.hot', 'sourceMappingURL']) {
      expect(scripts, leftover).not.toContain(leftover)
    }
  })

  it('has no path of the computer it was built on', () => {
    for (const file of [...builtFiles(), 'dist/index.html']) {
      expect(read(file), file).not.toMatch(/[A-Za-z]:[\\/]+Users[\\/]|\/(?:Users|home)\/[\w.-]+\/|file:\/\//)
    }
  })

  it('comes with the licence of every library it bundles', () => {
    const licences = read('dist/third-party-licenses.md')
    const manifest = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    for (const name of Object.keys(manifest.dependencies)) {
      // A heading of its own for the library, however the build tool lays the rest of it out.
      expect(licences, name).toMatch(new RegExp(`^#+ ${literally(name)}(?![\\w-])`, 'm'))
    }
  })
})
