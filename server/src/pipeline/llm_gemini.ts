import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { IntentTags, IntentTag } from '../ws/types.js';

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

export class GeminiClient {
  private readonly client?: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(config: GeminiConfig) {
    this.modelName = config.model;
    if (config.apiKey) {
      this.client = new GoogleGenerativeAI(config.apiKey);
    }
  }

  async generateRollingSummary(transcript: string, language?: string): Promise<RollingSummary> {
    if (!this.client) {
      return heuristicRollingSummary(transcript);
    }

    const prompt = buildRollingPrompt(transcript, language);
    try {
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = parseJsonFromText(text, RollingSchema);
      return normalizeRolling(parsed ?? heuristicRollingSummary(transcript));
    } catch (error) {
      console.warn('Gemini rolling summary failed, using heuristic', error);
      return heuristicRollingSummary(transcript);
    }
  }

  async generateDebrief(transcript: string, language?: string): Promise<DebriefSummary> {
    if (!this.client) {
      return heuristicDebriefSummary(transcript);
    }

    const prompt = buildDebriefPrompt(transcript, language);
    try {
      const model = this.client.getGenerativeModel({
        model: this.modelName,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = parseJsonFromText(text, DebriefSchema);
      return parsed ?? heuristicDebriefSummary(transcript);
    } catch (error) {
      console.warn('Gemini debrief failed, using heuristic', error);
      return heuristicDebriefSummary(transcript);
    }
  }
}

function buildRollingPrompt(transcript: string, language?: string): string {
  return [
    'You are Context Lens. Return STRICT JSON only. No markdown, no code fences.',
    'Follow this schema:',
    '{"topic_line":"<= 12 words","intent_tags":["planning"],"confidence":0.0,"uncertainty_notes":["..."]}',
    'Rules:',
    '- intent_tags must be 1-3 tags from: ' + JSON.stringify(IntentTags),
    '- Use possible/uncertain language, never state emotions as facts.',
    '- No medical claims, no diagnosis.',
    '- uncertainty_notes can be 0-2 short notes.',
    `Language hint: ${language ?? 'unknown'}.`,
    'Transcript (most recent window):',
    transcript
  ].join('\n');
}

function buildDebriefPrompt(transcript: string, language?: string): string {
  return [
    'You are Context Lens. Return STRICT JSON only. No markdown, no code fences.',
    'Follow this schema:',
    '{"bullets":["..."],"suggestions":["..."],"uncertainty_notes":["..."]}',
    'Rules:',
    '- bullets: 3-5 short items.',
    '- suggestions: 1-2 communication practice suggestions.',
    '- uncertainty_notes: 1-2 short notes.',
    '- Use possible/uncertain language, never state emotions as facts.',
    '- No medical claims, no diagnosis.',
    `Language hint: ${language ?? 'unknown'}.`,
    'Transcript:',
    transcript
  ].join('\n');
}

function parseJsonFromText<T>(text: string, schema: z.ZodSchema<T>): T | null {
  const extracted = extractJson(text);
  if (!extracted) {
    return null;
  }
  try {
    const parsed = JSON.parse(extracted);
    return schema.parse(parsed);
  } catch {
    return null;
  }
}

function extractJson(text: string): string | null {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }
  return text.slice(first, last + 1);
}

function normalizeRolling(summary: RollingSummary): RollingSummary {
  const words = summary.topic_line.split(/\s+/).slice(0, 12);
  return {
    ...summary,
    topic_line: words.join(' '),
    intent_tags: summary.intent_tags.slice(0, 3)
  };
}

function heuristicRollingSummary(transcript: string): RollingSummary {
  const lower = transcript.toLowerCase();
  const tags: IntentTag[] = [];

  if (/(plan|schedule|timeline|next step)/.test(lower)) tags.push('planning');
  if (/(feedback|review|thoughts|opinion)/.test(lower)) tags.push('feedback');
  if (/(argue|debate|disagree)/.test(lower)) tags.push('debate');
  if (/(joke|haha|lol)/.test(lower)) tags.push('joking');
  if (/(vent|frustrated|upset)/.test(lower)) tags.push('venting');
  if (/(support|help|assist)/.test(lower)) tags.push('support');
  if (/(negotiate|trade|deal)/.test(lower)) tags.push('negotiation');
  if (/(how to|instruction|teach)/.test(lower)) tags.push('instruction');

  if (tags.length === 0) tags.push('smalltalk');

  const topic_line = buildTopicLine(transcript);
  const confidence = Math.min(1, 0.3 + transcript.length / 1200);
  const uncertainty_notes = transcript.length < 200 ? ['Limited context available.'] : [];

  return {
    topic_line,
    intent_tags: tags.slice(0, 3),
    confidence: Number(confidence.toFixed(2)),
    uncertainty_notes
  };
}

function heuristicDebriefSummary(transcript: string): DebriefSummary {
  const topic_line = buildTopicLine(transcript);
  return {
    bullets: [
      `Main topic: ${topic_line}`,
      'Key points were shared across multiple turns.',
      'Intent signals appeared throughout the exchange.'
    ],
    suggestions: ['Confirm next steps and ask for clarifications.'],
    uncertainty_notes: ['Summary may miss details due to limited context.']
  };
}

function buildTopicLine(transcript: string): string {
  const sentence = transcript.split(/[.!?\n]/).find((line) => line.trim().length > 0);
  const words = (sentence ?? 'Conversation in progress').trim().split(/\s+/).slice(0, 12);
  return words.join(' ');
}
