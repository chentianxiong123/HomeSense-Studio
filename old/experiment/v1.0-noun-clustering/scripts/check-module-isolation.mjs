#!/usr/bin/env node
// scripts/check-module-isolation.mjs
// Enforce: modules/X may not import from modules/Y (Y != X).
// Modules may import from `shared/` and `db/` only.
//
// Default mode is report-only (exit 0). Pass --strict to fail the build.
// Pass --by-source to group violations by importing module.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = 'packages/backend/src'
const MODULES = join(ROOT, 'modules')
const SHARED = join(ROOT, 'shared')
const DB = join(ROOT, 'db')

const args = new Set(process.argv.slice(2))
const STRICT = args.has('--strict')
const BY_SOURCE = args.has('--by-source')

const violations = []
const bySource = new Map()

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) yield p
  }
}

function moduleOf(file) {
  const rel = relative(MODULES, file).split(sep)
  return rel[0]
}

for (const file of walk(MODULES)) {
  const myMod = moduleOf(file)
  const re = /from\s+['"]([^'"]+)['"]/g
  const c = readFileSync(file, 'utf8')
  let m
  while ((m = re.exec(c))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    const dir = file.split(sep).slice(0, -1).join(sep)
    const target = join(dir, spec).replace(/\.js$/, '.ts')
    if (target.includes(`${sep}shared${sep}`)) continue
    if (target.includes(`${sep}db${sep}`)) continue
    if (!target.includes(`${MODULES}${sep}`)) continue
    const otherMod = moduleOf(target)
    if (otherMod && otherMod !== myMod) {
      const trel = relative('.', file)
      const v = { from: trel, to: spec, fromMod: myMod, toMod: otherMod }
      violations.push(v)
      if (!bySource.has(myMod)) bySource.set(myMod, [])
      bySource.get(myMod).push(v)
    }
  }
}

if (BY_SOURCE) {
  const ranked = [...bySource.entries()].map(([k, vs]) => [k, vs.length]).sort((a, b) => b[1] - a[1])
  console.log('== cross-module imports by source module ==')
  for (const [k, n] of ranked) console.log('  ' + k.padEnd(28) + ' ' + n + ' violations')
  console.log('')
}

if (violations.length === 0) {
  console.log('[isolation] OK: no cross-module imports')
  process.exit(0)
}

console.error(`[isolation] ${violations.length} cross-module import(s) found${STRICT ? ' (STRICT)' : ' (report-only, pass --strict to fail)'}`)
if (STRICT) {
  for (const v of violations) console.error(`  ${v.from}\n    -> ${v.to}  (${v.fromMod} -> ${v.toMod})`)
  process.exit(1)
}
