import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * Loads .env into process.env without overwriting anything already set, so an
 * explicit `FOO=bar node script` still wins.
 *
 * Four scripts had their own copy of this loop. They agreed today; the point of
 * one copy is that they cannot stop agreeing.
 */
export function loadEnv(importMetaUrl) {
  const root = fileURLToPath(new URL('..', importMetaUrl))
  const candidates = [join(root, '.env'), join(root, '..', '.env')]

  for (const path of candidates) {
    let contents
    try {
      contents = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const line of contents.split('\n')) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
    }
    return path
  }
  return null
}

/** Reads a variable, or explains what is missing rather than failing later. */
export function required(name, hint = '') {
  const value = process.env[name]
  if (!value) {
    throw new Error(`set ${name} in .env or the environment${hint ? ` — ${hint}` : ''}`)
  }
  return value
}
