/**
 * An audit of the repository as a whole, which is meant to be public:
 *
 * - nothing personal, no local path and no secret in any file;
 * - the documents agree with the code on where things are;
 * - the README and the roadmap say what the app does today;
 * - package.json lists the right dependencies and the licence;
 * - the built app (when `dist/` exists) carries no debug hook, no test code
 *   and the licences of everything it bundles.
 *
 * Everything is read as text from the project folder. Nothing is changed.
 */
import { describe, expect, it } from 'vitest'

interface FolderEntry {
  name: string
  isDirectory(): boolean
}

interface FileSystem {
  existsSync(path: URL): boolean
  readFileSync(path: URL, encoding: 'utf8'): string
  readdirSync(path: URL, options: { withFileTypes: true }): FolderEntry[]
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
    const appCode = publishedFiles()
      .filter((file) => /^src\/.*\.tsx?$/.test(file))
      .filter((file) => !/\.test\.tsx?$|TestKit\.ts$|testSupport\.ts$/.test(file))
      .map(read)
      .join('\n')
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

  it('docs/SONGS.md names the file that really holds the song player', () => {
    const row = read('docs/SONGS.md')
      .split('\n')
      .find((line) => line.startsWith('|') && line.includes('`player`') && line.includes('singleton'))
    const path = /`(src\/[^`]+)`/.exec(row ?? '')?.[1] ?? ''
    expect(exists(path), path).toBe(true)
    const exportsThePlayer = /export const player\b/.test(read(path))
    expect(exportsThePlayer, `${path} is named as the home of the player`).toBe(true)
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

  it('the README says what the app does today', () => {
    const readme = read('README.md')
    for (const said of [
      /Songs/,
      /MIDI/,
      /drag and drop/i,
      /themes/i,
      /Home row.*Two octaves.*White keys only/,
      /Settings/,
      /falls? toward the keys|fall toward the keys/i,
      /hides when the mouse is still/i,
    ]) {
      expect(readme).toMatch(said)
    }
  })

  it('the README says the app is for a desktop browser', () => {
    const readme = read('README.md')
    expect(readme).toMatch(/desktop or laptop computer/)
    expect(readme).toMatch(/Phones and tablets are not supported/)
    expect(readme).toMatch(/Chrome or Edge/)
  })

  it('the README keeps the credits and the licence', () => {
    const readme = read('README.md')
    expect(readme).toMatch(/Salamander Grand Piano/)
    expect(readme).toMatch(/Alexander Holm/)
    expect(readme).toMatch(/creativecommons\.org\/licenses\/by\/3\.0/)
    expect(readme).toMatch(/public domain/)
    expect(readme).toMatch(/midi-file/)
    expect(readme).toMatch(/MIT licen[cs]e/)
  })

  it('the README no longer describes the old screen', () => {
    expect(linesMatching('README.md', read('README.md'), /Advanced panel|light trails|Customize keys|toolbar/i)).toEqual([])
  })

  it('the roadmap shows the interface and the songs as done, and Practice mode as next', () => {
    const roadmap = read('ROADMAP.md')
    expect(roadmap).toMatch(/\*\*Playable piano \(Free Play\)\*\* \(done\)/)
    expect(roadmap).toMatch(/\*\*The immersive interface and songs\*\* \(done\)/)
    expect(roadmap).toMatch(/\*\*Practice mode\*\* \(next\)/)
    expect(roadmap).toMatch(/\*\*Import a MIDI file\*\* \(done/)
    expect(linesMatching('ROADMAP.md', roadmap, /Advanced panel|light trails/i)).toEqual([])
  })

  it('the app’s name is written in one place only', () => {
    const elsewhere = publishedFiles()
      .filter((file) => /^src\/.*\.tsx?$/.test(file))
      .filter((file) => !/\.test\.tsx?$|TestKit\.ts$|testSupport\.ts$/.test(file))
      .filter((file) => file !== 'src/app/appInfo.ts')
      .flatMap((file) => linesMatching(file, read(file), /['"`>]PianoApp['"`<]/))
    expect(elsewhere).toEqual([])
  })
})

describe.skipIf(!exists('dist/index.html'))('the built app (dist/)', () => {
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

  it('asks no other site for anything but the piano recordings', () => {
    const sites = new Set(
      [...builtScripts().matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)].map((match) => match[0]),
    )
    // Names of web standards and links shown as text are not requests.
    for (const known of [
      'http://www.w3.org',
      'https://react.dev',
      'https://github.com',
      'https://creativecommons.org',
      'https://tonejs.github.io',
    ]) {
      sites.delete(known)
    }
    expect([...sites]).toEqual([])
  })

  it('comes with the licence of every library it bundles', () => {
    const licences = read('dist/third-party-licenses.md')
    const manifest = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
    for (const name of Object.keys(manifest.dependencies)) {
      expect(licences, name).toMatch(new RegExp(`^## ${name} - \\d`, 'm'))
    }
  })
})
