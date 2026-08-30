import { getDatabase } from './database.js'

interface ExpansionResult {
  original: string
  candidates: string[]
}

export function expandSynonyms(input: string): ExpansionResult {
  const db = getDatabase()
  const rows = db.prepare('SELECT word, synonym FROM synonyms').all() as { word: string; synonym: string }[]

  const synonymMap: Record<string, string[]> = {}
  for (const row of rows) {
    if (!synonymMap[row.word]) {
      synonymMap[row.word] = [row.word]
    }
    if (!synonymMap[row.word].includes(row.synonym)) {
      synonymMap[row.word].push(row.synonym)
    }
    if (!synonymMap[row.synonym]) {
      synonymMap[row.synonym] = [row.synonym]
    }
    if (!synonymMap[row.synonym].includes(row.word)) {
      synonymMap[row.synonym].push(row.word)
    }
  }

  const candidates = generateCandidates(input, synonymMap)

  return {
    original: input,
    candidates,
  }
}

function generateCandidates(input: string, synonymMap: Record<string, string[]>): string[] {
  const results: string[] = [input]

  for (const [word, synonyms] of Object.entries(synonymMap)) {
    if (input.includes(word)) {
      const newResults: string[] = []
      for (const result of results) {
        if (result.includes(word)) {
          for (const syn of synonyms) {
            if (result !== result.replace(word, syn)) {
              newResults.push(result.replace(word, syn))
            }
          }
        }
      }
      results.push(...newResults)
    }
  }

  return [...new Set(results)]
}

export function getSynonyms(word: string): string[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT synonym FROM synonyms WHERE word = ?').all(word) as { synonym: string }[]
  return rows.map(r => r.synonym)
}
