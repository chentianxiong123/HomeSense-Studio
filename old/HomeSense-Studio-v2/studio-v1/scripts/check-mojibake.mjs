import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const TARGET_DIRS = [
  'packages/frontend/src',
  'packages/backend/src',
  'docs',
]

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.json',
  '.md',
  '.css',
  '.html',
])

const SUSPICIOUS_PATTERNS = [
  /\uFFFD/u,
  /鈥/u,
  /脳/u,
  /芦/u,
  /禄/u,
  /鉁/u,
  /馃/u,
  /鍙戠幇/u,
  /鏆傛/u,
  /鏈烘/u,
  /宸茬/u,
  /鐪嬬數瑙/u,
  /绫冲/u,
]

const offenders = []

for (const dir of TARGET_DIRS) {
  walk(path.join(ROOT, dir))
}

if (offenders.length > 0) {
  console.error('Suspicious encoding fragments found:')
  for (const offender of offenders) {
    console.error(`${offender.file}:${offender.line}: ${offender.text}`)
  }
  process.exitCode = 1
} else {
  console.log('No suspicious encoding fragments found.')
}

function walk(entry) {
  if (!fs.existsSync(entry)) return
  const stat = fs.statSync(entry)
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(entry)) {
      walk(path.join(entry, child))
    }
    return
  }

  if (!TEXT_EXTENSIONS.has(path.extname(entry))) return

  const content = fs.readFileSync(entry, 'utf8')
  const lines = content.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(line))) {
      offenders.push({
        file: path.relative(ROOT, entry),
        line: index + 1,
        text: line.trim(),
      })
    }
  })
}

