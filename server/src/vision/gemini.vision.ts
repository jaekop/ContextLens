import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { VISION_PROMPT } from './vision.prompt.js';
import type { VisionSnapshot } from './vision.types.js';

const LightingSchema = z.object({
  level: z.enum(['low', 'normal', 'bright']),
  source: z.enum(['natural', 'indoor', 'mixed']).optional(),
  confidence: z.number().min(0).max(1).optional()
});

const EnvironmentSchema = z.object({
  label: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  objects: z.array(z.string().min(1)).max(8).optional(),
  lighting: LightingSchema,
  noise_or_busyness: z
    .object({
      level: z.enum(['quiet', 'moderate', 'busy']),
      confidence: z.number().min(0).max(1).optional()
    })
    .optional()
});

const PeopleSchema = z.object({
  count_estimate: z.number().int().min(0),
  count_confidence: z.number().min(0).max(1).optional(),
  proximity: z.enum(['close', 'medium', 'far']),
  orientation_summary: z.enum(['facing_camera', 'side_profile', 'back_turned', 'mixed']).optional(),
  confidence: z.number().min(0).max(1).optional()
});

const CueNotes = z.array(z.string().min(1)).max(2).optional();

const SocialCuesSchema = z.object({
  facial_expression_summary: z
    .object({
      label: z.enum(['neutral', 'positive', 'negative', 'confused', 'engaged', 'unknown']),
      confidence: z.number().min(0).max(1).optional(),
      notes: CueNotes
    })
    .optional(),
  body_posture_summary: z
    .object({
      label: z.enum(['open', 'closed', 'leaning_in', 'leaning_away', 'restless', 'unknown']),
      confidence: z.number().min(0).max(1).optional(),
      notes: CueNotes
    })
    .optional(),
  gaze_summary: z
    .object({
      label: z.enum(['toward_camera', 'away_from_camera', 'downward', 'mixed', 'unknown']),
      confidence: z.number().min(0).max(1).optional(),
      notes: CueNotes
    })
    .optional(),
  interaction_context: z
    .object({
      label: z.enum(['conversation', 'presentation', 'studying', 'waiting', 'unknown']),
      confidence: z.number().min(0).max(1).optional()
    })
    .optional()
});

const ReliabilitySchema = z.object({
  overall_confidence: z.number().min(0).max(1).optional(),
  limitations: z.array(z.string().min(1)).max(3).optional()
});

const VisionSchema = z.object({
  environment: EnvironmentSchema,
  people: PeopleSchema,
  social_cues: SocialCuesSchema,
  reliability: ReliabilitySchema,
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
  return VisionSchema.parse(parsed);
}

function toSnapshot(parsed: z.infer<typeof VisionSchema>): VisionSnapshot {
  return {
    ts_ms: Date.now(),
    environment: {
      label: parsed.environment.label,
      confidence: parsed.environment.confidence ?? 0.6,
      objects: parsed.environment.objects?.slice(0, 8),
      lighting: {
        level: parsed.environment.lighting.level,
        source: parsed.environment.lighting.source,
        confidence: parsed.environment.lighting.confidence ?? 0.6
      },
      noise_or_busyness: parsed.environment.noise_or_busyness
        ? {
            level: parsed.environment.noise_or_busyness.level,
            confidence: parsed.environment.noise_or_busyness.confidence ?? 0.5
          }
        : undefined
    },
    people: {
      count_estimate: parsed.people.count_estimate,
      count_confidence: parsed.people.count_confidence ?? 0.5,
      proximity: parsed.people.proximity,
      orientation_summary: parsed.people.orientation_summary,
      confidence: parsed.people.confidence ?? 0.5
    },
    social_cues: normalizeSocialCues(parsed.social_cues),
    reliability: {
      overall_confidence: parsed.reliability.overall_confidence ?? 0.6,
      limitations: parsed.reliability.limitations?.slice(0, 3)
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
          label: cues.facial_expression_summary.label,
          confidence: cues.facial_expression_summary.confidence ?? 0.3,
          notes: cues.facial_expression_summary.notes?.slice(0, 2)
        }
      : undefined,
    body_posture_summary: cues.body_posture_summary
      ? {
          label: cues.body_posture_summary.label,
          confidence: cues.body_posture_summary.confidence ?? 0.3,
          notes: cues.body_posture_summary.notes?.slice(0, 2)
        }
      : undefined,
    gaze_summary: cues.gaze_summary
      ? {
          label: cues.gaze_summary.label,
          confidence: cues.gaze_summary.confidence ?? 0.3,
          notes: cues.gaze_summary.notes?.slice(0, 2)
        }
      : undefined,
    interaction_context: cues.interaction_context
      ? {
          label: cues.interaction_context.label,
          confidence: cues.interaction_context.confidence ?? 0.3
        }
      : undefined
  };
}
