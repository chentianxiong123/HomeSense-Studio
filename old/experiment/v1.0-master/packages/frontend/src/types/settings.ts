export interface LLMProvider {
  id: number
  name: string
  provider_type: 'openai' | 'deepseek' | 'ollama' | 'custom'
  api_base: string
  api_key: string
  model_name: string
  enabled: boolean
  is_default: boolean
}
