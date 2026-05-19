interface EmbedCall {
  slot?: string
  input: string | string[]
}

interface ChatCall {
  slot?: string
  messages: Array<{ role: string; content: string }>
}

export class FakeLlmService {
  readonly embedCalls: EmbedCall[] = []
  readonly chatCalls: ChatCall[] = []

  private embedDimensions = 8
  private chatResponse: string = 'fake response'

  setEmbedDimensions(dim: number): void {
    this.embedDimensions = dim
  }

  setChatResponse(content: string): void {
    this.chatResponse = content
  }

  getModelSlot(slot: string) {
    return {
      provider_type: 'openai',
      api_base: 'http://fake',
      model_name: `fake-${slot}`,
      dimensions: this.embedDimensions,
      enabled: true,
    }
  }

  async embed(opts: { slot?: string; input: string | string[] }) {
    this.embedCalls.push(opts)
    const inputs = Array.isArray(opts.input) ? opts.input : [opts.input]
    return {
      data: inputs.map((text, index) => ({
        index,
        embedding: this.deterministicEmbedding(text),
      })),
    }
  }

  async chat(opts: { messages: Array<{ role: string; content: string }>; temperature?: number; slot?: string }) {
    this.chatCalls.push({ slot: opts.slot, messages: opts.messages })
    return { content: this.chatResponse }
  }

  async rerank(opts: { query: string; documents: string[] }) {
    return {
      results: opts.documents.map((_, index) => ({ index, relevance_score: 1 - index * 0.1 })),
    }
  }

  reset(): void {
    this.embedCalls.length = 0
    this.chatCalls.length = 0
    this.embedDimensions = 8
    this.chatResponse = 'fake response'
  }

  private deterministicEmbedding(text: string): number[] {
    const vector = new Array(this.embedDimensions).fill(0)
    let seed = 0
    for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0
    for (let i = 0; i < this.embedDimensions; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0
      vector[i] = ((seed % 1000) / 1000) * 2 - 1
    }
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1
    return vector.map((v) => v / magnitude)
  }
}
