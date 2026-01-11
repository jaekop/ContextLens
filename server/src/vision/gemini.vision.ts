import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { VISION_PROMPT } from './vision.prompt.js';
import type { VisionSnapshot } from './vision.types.js';

const VisionSchema = z.object({
  env_label: z.string().min(1),
  env_confidence: z.number().min(0).max(1).optional(),
  objects: z.array(z.string().min(1)).max(5).optional(),
  notes: z.array(z.string().min(1)).max(2).optional()
});

export class GeminiVisionClient {
  private readonly client?: GoogleGenerativeAI;
  private readonly model: string;

  constructor(apiKey: string | undefined, model: string) {
    this.model = model;
    if (apiKey) {
      this.client = new GoogleGenerativeAI(apiKey);
    }
  }

  isReady(): boolean {
    return Boolean(this.client);
  }

  async sendImage(buffer: Buffer): Promise<VisionSnapshot> {
    if (!this.client) {
      throw new Error('Gemini API key missing');
    }

    const attempt = async (): Promise<VisionSnapshot> => {
      const model = this.client!.getGenerativeModel({
        model: this.model,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent([
        { text: VISION_PROMPT },
        { inlineData: { data: buffer.toString('base64'), mimeType: 'image/jpeg' } }
      ]);
      const text = result.response.text();
      const parsed = parseJson(text);
      return toSnapshot(parsed);
    };

    try {
      return await attempt();
    } catch {
      return await attempt();
    }
  }
}

function parseJson(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Invalid JSON from Gemini');
  }
  const parsed = JSON.parse(text.slice(start, end + 1));
  return VisionSchema.parse(parsed);
}

function toSnapshot(parsed: z.infer<typeof VisionSchema>): VisionSnapshot {
  return {
    ts_ms: Date.now(),
    env_label: parsed.env_label,
    env_confidence: parsed.env_confidence ?? 0.6,
    objects: parsed.objects?.slice(0, 5),
    notes: parsed.notes?.slice(0, 2)
  };
}
