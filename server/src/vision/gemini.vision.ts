import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { VISION_PROMPT } from './vision.prompt.js';
import type { VisionSnapshot } from './vision.types.js';

const LightingSchema = z.object({
  level: z.enum(['low', 'normal', 'bright']).optional(),
  source: z.enum(['natural', 'indoor', 'mixed']).optional(),
  confidence: z.number().min(0).max(1).optional()
});

const EnvironmentSchema = z.object({
  label: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  objects: z.array(z.string().min(1)).max(8).optional(),
  lighting: LightingSchema.optional(),
  noise_or_busyness: z
    .object({
      level: z.enum(['quiet', 'moderate', 'busy']).optional(),
      confidence: z.number().min(0).max(1).optional()
    })
    .optional()
});

const PeopleSchema = z.object({
  count_estimate: z.number().min(0).optional(),
  count_confidence: z.number().min(0).max(1).optional(),
  proximity: z.enum(['close', 'medium', 'far']).optional(),
  orientation_summary: z.enum(['facing_camera', 'side_profile', 'back_turned', 'mixed']).optional(),
  confidence: z.number().min(0).max(1).optional()
});

const CueNotes = z.array(z.string().min(1)).max(2).optional();

const SocialCuesSchema = z.object({
  facial_expression_summary: z
    .object({
      label: z.enum(['neutral', 'positive', 'negative', 'confused', 'engaged', 'unknown']).optional(),
      confidence: z.number().min(0).max(1).optional(),
      notes: CueNotes
    })
    .optional(),
  body_posture_summary: z
    .object({
      label: z.enum(['open', 'closed', 'leaning_in', 'leaning_away', 'restless', 'unknown']).optional(),
      confidence: z.number().min(0).max(1).optional(),
      notes: CueNotes
    })
    .optional(),
  gaze_summary: z
    .object({
      label: z.enum(['toward_camera', 'away_from_camera', 'downward', 'mixed', 'unknown']).optional(),
      confidence: z.number().min(0).max(1).optional(),
      notes: CueNotes
    })
    .optional(),
  interaction_context: z
    .object({
      label: z.enum(['conversation', 'presentation', 'studying', 'waiting', 'unknown']).optional(),
      confidence: z.number().min(0).max(1).optional()
    })
    .optional()
});

const ReliabilitySchema = z.object({
  overall_confidence: z.number().min(0).max(1).optional(),
  limitations: z.array(z.string().min(1)).max(3).optional()
});

const RawVisionSchema = z.object({
  environment: EnvironmentSchema.optional(),
  people: PeopleSchema.optional(),
  social_cues: SocialCuesSchema.optional(),
  reliability: ReliabilitySchema.optional(),
  notes: z.array(z.string().min(1)).max(3).optional()
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
  const result = RawVisionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error('Invalid JSON from Gemini');
  }
  return result.data;
}

function toSnapshot(parsed: z.infer<typeof RawVisionSchema>): VisionSnapshot {
  const environment = parsed.environment ?? {};
  const lighting = environment.lighting ?? {};
  const noise = environment.noise_or_busyness;
  const people = parsed.people ?? {};
  return {
    ts_ms: Date.now(),
    environment: {
      label: environment.label ?? 'unknown',
      confidence: environment.confidence ?? 0.6,
      objects: environment.objects?.slice(0, 8),
      lighting: {
        level: lighting.level ?? 'normal',
        source: lighting.source,
        confidence: lighting.confidence ?? 0.6
      },
      noise_or_busyness: noise?.level
        ? {
            level: noise.level,
            confidence: noise.confidence ?? 0.5
          }
        : undefined
    },
    people: {
      count_estimate: Math.max(0, Math.round(people.count_estimate ?? 0)),
      count_confidence: people.count_confidence ?? 0.5,
      proximity: people.proximity ?? 'medium',
      orientation_summary: people.orientation_summary,
      confidence: people.confidence ?? 0.5
    },
    social_cues: normalizeSocialCues(parsed.social_cues ?? {}),
    reliability: {
      overall_confidence: parsed.reliability?.overall_confidence ?? 0.6,
      limitations: parsed.reliability?.limitations?.slice(0, 3)
    },
    notes: parsed.notes?.slice(0, 3)
  };
}

function normalizeSocialCues(
  cues: z.infer<typeof SocialCuesSchema>
): VisionSnapshot['social_cues'] {
  return {
    facial_expression_summary: cues.facial_expression_summary
      ? {
          label: cues.facial_expression_summary.label ?? 'unknown',
          confidence: cues.facial_expression_summary.confidence ?? 0.3,
          notes: cues.facial_expression_summary.notes?.slice(0, 2)
        }
      : undefined,
    body_posture_summary: cues.body_posture_summary
      ? {
          label: cues.body_posture_summary.label ?? 'unknown',
          confidence: cues.body_posture_summary.confidence ?? 0.3,
          notes: cues.body_posture_summary.notes?.slice(0, 2)
        }
      : undefined,
    gaze_summary: cues.gaze_summary
      ? {
          label: cues.gaze_summary.label ?? 'unknown',
          confidence: cues.gaze_summary.confidence ?? 0.3,
          notes: cues.gaze_summary.notes?.slice(0, 2)
        }
      : undefined,
    interaction_context: cues.interaction_context
      ? {
          label: cues.interaction_context.label ?? 'unknown',
          confidence: cues.interaction_context.confidence ?? 0.3
        }
      : undefined
  };
}
