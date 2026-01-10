import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { IntentTags, IntentTag } from '../ws/schemas.js';

type GeminiConfig = {
  apiKey: string;
  model: string;
};

export type RollingSummary = {
  topic_line: string;
  intent_tags: IntentTag[];
  confidence: number;
  uncertainty_notes: string[];
};

export type DebriefSummary = {
  bullets: string[];
  suggestions: string[];
  uncertainty_notes: string[];
};

const RollingSchema = z.object({
  topic_line: z.string().min(1),
  intent_tags: z.array(z.enum(IntentTags)).min(1).max(3),
  confidence: z.number().min(0).max(1),
  uncertainty_notes: z.array(z.string().min(1)).max(2)
});

const DebriefSchema = z.object({
  bullets: z.array(z.string().min(1)).min(3).max(5),
  suggestions: z.array(z.string().min(1)).min(1).max(2),
  uncertainty_notes: z.array(z.string().min(1)).min(1).max(2)
});

export class GeminiAdapter {
  private readonly client?: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(config: GeminiConfig) {
    this.modelName = config.model;
    if (config.apiKey) {
      this.client = new GoogleGenerativeAI(config.apiKey);
    }
  }

  isReady(): boolean {
    return Boolean(this.client);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) {
      return { ok: false, error: 'missing_api_key' };
    }
    try {
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent('Return JSON {"ok": true}.');
      const parsed = parseJson(result.response.text(), z.object({ ok: z.boolean() }));
      return parsed?.ok ? { ok: true } : { ok: false, error: 'invalid_response' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'unknown_error' };
    }
  }

  async rollingSummary(transcript: string, language?: string): Promise<RollingSummary> {
    if (!this.client) {
      return heuristicRolling(transcript);
    }

    const prompt = buildRollingPrompt(transcript, language);

    try {
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = parseJson(text, RollingSchema);
      return normalizeRolling(parsed ?? heuristicRolling(transcript));
    } catch (error) {
      console.warn('Gemini rolling summary failed', error);
      return heuristicRolling(transcript);
    }
  }

  async debrief(transcript: string, language?: string): Promise<DebriefSummary> {
    if (!this.client) {
      return heuristicDebrief(transcript);
    }

    const prompt = buildDebriefPrompt(transcript, language);

    try {
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = parseJson(text, DebriefSchema);
      return parsed ?? heuristicDebrief(transcript);
    } catch (error) {
      console.warn('Gemini debrief failed', error);
      return heuristicDebrief(transcript);
    }
  }
}

function buildRollingPrompt(transcript: string, language?: string): string {
  return [
    'You are Context Lens. Return STRICT JSON only. No markdown or code fences.',
    'Output schema:',
    '{"topic_line":"<= 12 words","intent_tags":["planning"],"confidence":0.0,"uncertainty_notes":["..."]}',
    'Rules:',
    '- intent_tags must be 1-3 tags from: ' + JSON.stringify(IntentTags),
    '- No diagnosis, no medical claims.',
    '- Do not assert emotions as facts; use tentative language if needed.',
    '- uncertainty_notes can be 0-2 short notes.',
    `Language hint: ${language ?? 'unknown'}.`,
    'Transcript (recent window):',
    transcript
  ].join('\n');
}

function buildDebriefPrompt(transcript: string, language?: string): string {
  return [
    'You are Context Lens. Return STRICT JSON only. No markdown or code fences.',
    'Output schema:',
    '{"bullets":["..."],"suggestions":["..."],"uncertainty_notes":["..."]}',
    'Rules:',
    '- bullets: 3-5 short bullets.',
    '- suggestions: 1-2 educational practice suggestions.',
    '- uncertainty_notes: 1-2 short notes.',
    '- No diagnosis, no medical claims.',
    '- Do not assert emotions as facts; use tentative language if needed.',
    `Language hint: ${language ?? 'unknown'}.`,
    'Transcript:',
    transcript
  ].join('\n');
}

function parseJson<T>(text: string, schema: z.ZodSchema<T>): T | null {
  const extracted = extractJson(text);
  if (!extracted) return null;
  try {
    return schema.parse(JSON.parse(extracted));
  } catch {
    return null;
  }
}

function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function normalizeRolling(summary: RollingSummary): RollingSummary {
  return {
    ...summary,
    topic_line: summary.topic_line.split(/\s+/).slice(0, 12).join(' '),
    intent_tags: summary.intent_tags.slice(0, 3)
  };
}

function heuristicRolling(transcript: string): RollingSummary {
  const lower = transcript.toLowerCase();
  const tags: IntentTag[] = [];
  if (/(plan|schedule|next step)/.test(lower)) tags.push('planning');
  if (/(feedback|review|opinion)/.test(lower)) tags.push('feedback');
  if (/(debate|disagree|argue)/.test(lower)) tags.push('debate');
  if (/(joke|lol|haha)/.test(lower)) tags.push('joking');
  if (/(vent|frustrated|upset)/.test(lower)) tags.push('venting');
  if (/(support|help|assist)/.test(lower)) tags.push('support');
  if (/(negotiate|deal|trade)/.test(lower)) tags.push('negotiation');
  if (/(how to|instruction|teach)/.test(lower)) tags.push('instruction');
  if (tags.length === 0) tags.push('smalltalk');

  const topic_line = buildTopicLine(transcript);
  const confidence = Math.min(1, 0.3 + transcript.length / 1200);
  const uncertainty_notes = transcript.length < 200 ? ['Limited context.'] : [];

  return {
    topic_line,
    intent_tags: tags.slice(0, 3),
    confidence: Number(confidence.toFixed(2)),
    uncertainty_notes
  };
}

function heuristicDebrief(transcript: string): DebriefSummary {
  const topic = buildTopicLine(transcript);
  return {
    bullets: [
      `Main topic: ${topic}`,
      'Several points were shared across the conversation.',
      'Intent signals appeared throughout the exchange.'
    ],
    suggestions: ['Consider confirming next steps and clarifying open questions.'],
    uncertainty_notes: ['Summary may be incomplete due to limited context.']
  };
}

function buildTopicLine(transcript: string): string {
  const line = transcript.split(/[.!?\n]/).find((item) => item.trim().length > 0);
  return (line ?? 'Conversation in progress').trim().split(/\s+/).slice(0, 12).join(' ');
}
