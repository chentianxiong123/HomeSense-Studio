export interface RerankDocument {
  id: string
  text: string
  base_score?: number
  metadata?: Record<string, unknown>
}

export interface RankedDocument extends RerankDocument {
  score: number
  lexical_score: number
}

class RerankService {
  async rankDocuments(params: {
    query: string
    documents: RerankDocument[]
  }): Promise<RankedDocument[]> {
    const query = this.normalize(params.query)
    const queryTokens = this.tokens(query)

    const ranked = params.documents.map((document) => {
      const text = this.normalize(document.text)
      const textTokens = this.tokens(text)
      const baseScore = Number(document.base_score ?? 0)

      const exactBoost = text.includes(query) && query.length > 0 ? 0.35 : 0
      const overlap = queryTokens.length > 0
        ? queryTokens.filter((token) => textTokens.includes(token)).length / queryTokens.length
        : 0
      const prefixBoost = queryTokens.some((token) => text.startsWith(token)) ? 0.08 : 0
      const metadataBoost = this.scoreMetadata(query, document.metadata)
      const lexicalScore = exactBoost + overlap + prefixBoost + metadataBoost
      const score = (baseScore * 0.4) + (lexicalScore * 0.6)

      return {
        ...document,
        score,
        lexical_score: lexicalScore,
      }
    })

    return ranked.sort((left, right) => right.score - left.score)
  }

  private scoreMetadata(query: string, metadata?: Record<string, unknown>): number {
    if (!metadata) return 0
    const values = Object.values(metadata)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => this.normalize(value))
    if (values.some((value) => value === query)) return 0.2
    if (values.some((value) => value.includes(query) || query.includes(value))) return 0.12
    return 0
  }

  private tokens(value: string): string[] {
    return value
      .split(/[\s,./|:_-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ')
  }
}

export const rerankService = new RerankService()

