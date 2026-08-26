import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Loads the nearest .env into process.env without overwriting anything already
 * set, so an explicit `FOO=bar node script` still wins.
 *
 * Four scripts had their own copy of this loop. They agreed today; the point of
 * one copy is that they cannot stop agreeing.
 *
 * It walks up from the calling file rather than guessing a fixed number of
 * levels, so a script can move between scripts/ and scripts/lib/ without this
 * silently finding nothing. Pass `import.meta.url`, a directory, or nothing at
 * all - Playwright loads its config as CommonJS, where import.meta is a syntax
 * error, so the no-argument form starts from the working directory.
 */
export function loadEnv(from = process.cwd()) {
  let dir = from.startsWith('file:') ? dirname(fileURLToPath(from)) : from

  for (;;) {
    const path = join(dir, '.env')
    let contents
    try {
      contents = readFileSync(path, 'utf8')
    } catch {
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
      continue
    }

    for (const line of contents.split('\n')) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
    }
    return path
  }
}

/** Reads a variable, or explains what is missing rather than failing later. */
export function required(name, hint = '') {
  const value = process.env[name]
  if (!value) {
    throw new Error(`set ${name} in .env or the environment${hint ? ` — ${hint}` : ''}`)
  }
  return value
}
