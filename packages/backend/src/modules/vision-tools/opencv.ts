export interface OpenCvPreprocessInput {
  imageBase64: string
  mimeType?: string
  packageName?: string
  elementName?: string
}

export interface OpenCvPreprocessResult {
  imageBase64: string
  mimeType: string
  operations: Array<{
    name: string
    applied: boolean
    reason?: string
  }>
}

export async function preprocessScreenshotWithOpenCV(
  input: OpenCvPreprocessInput,
): Promise<OpenCvPreprocessResult> {
  return {
    imageBase64: input.imageBase64,
    mimeType: input.mimeType ?? 'image/png',
    operations: [
      {
        name: 'opencv.preprocess',
        applied: false,
        reason: 'OpenCV adapter is not configured yet.',
      },
    ],
  }
}

export interface OpenCvTemplateMatch {
  templatePath: string
  bounds: { x: number; y: number; width: number; height: number }
  confidence: number
}

export async function matchTemplatesWithOpenCV(): Promise<OpenCvTemplateMatch[]> {
  return []
}
