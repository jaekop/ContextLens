import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { VISION_PROMPT } from './vision.prompt.js';
import type { VisionSnapshot } from './vision.types.js';

const enumValues = {
  lightingLevels: ['low', 'normal', 'bright'] as const,
  lightingSources: ['natural', 'indoor', 'mixed'] as const,
  noiseLevels: ['quiet', 'moderate', 'busy'] as const,
  proximity: ['close', 'medium', 'far'] as const,
  orientation: ['facing_camera', 'side_profile', 'back_turned', 'mixed'] as const,
  facial: ['neutral', 'positive', 'negative', 'confused', 'engaged', 'unknown'] as const,
  posture: ['open', 'closed', 'leaning_in', 'leaning_away', 'restless', 'unknown'] as const,
  gaze: ['toward_camera', 'away_from_camera', 'downward', 'mixed', 'unknown'] as const,
  interaction: ['conversation', 'presentation', 'studying', 'waiting', 'unknown'] as const
};

const toNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const toString = (value: unknown) => (typeof value === 'string' ? value.trim() || undefined : undefined);

const normalizeEnumValue = (value: string) =>
  value.trim().toLowerCase().replace(/[\s-]+/g, '_');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toEnum = <T extends string>(allowed: readonly T[]) => (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeEnumValue(value);
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : undefined;
};

const toStringArray = (max: number) => (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
  return cleaned.length ? cleaned : undefined;
};

const LightingSchema = z.object({
  level: z.preprocess(toEnum(enumValues.lightingLevels), z.enum(enumValues.lightingLevels)).optional(),
  source: z.preprocess(toEnum(enumValues.lightingSources), z.enum(enumValues.lightingSources)).optional(),
  confidence: z.preprocess(toNumber, z.number().min(0).max(1)).optional()
});

const NoiseSchema = z.object({
  level: z.preprocess(toEnum(enumValues.noiseLevels), z.enum(enumValues.noiseLevels)).optional(),
  confidence: z.preprocess(toNumber, z.number().min(0).max(1)).optional()
});

const EnvironmentSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { label: value };
  }
  if (!isRecord(value)) return undefined;
  const label = value.label ?? value.description ?? value.type ?? value.env_label;
  const objects = value.objects ?? value.object_list ?? value.items;
  const noise = value.noise_or_busyness ?? value.noise ?? value.busyness;
  return {
    ...value,
    ...(label ? { label } : {}),
    ...(objects ? { objects } : {}),
    ...(noise ? { noise_or_busyness: noise } : {})
  };
}, z.object({
  label: z.preprocess(toString, z.string()).optional(),
  confidence: z.preprocess(toNumber, z.number().min(0).max(1)).optional(),
  objects: z.preprocess(toStringArray(8), z.array(z.string()).max(8)).optional(),
  lighting: LightingSchema.optional(),
  noise_or_busyness: NoiseSchema.optional()
})).optional();

const PeopleSchema = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { count_estimate: value };
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return { count_estimate: parsed };
    }
  }
  if (!isRecord(value)) return undefined;
  const count = value.count_estimate ?? value.count ?? value.people_count ?? value.num;
  const orientation = value.orientation_summary ?? value.orientation;
  return {
    ...value,
    ...(count !== undefined ? { count_estimate: count } : {}),
    ...(orientation ? { orientation_summary: orientation } : {})
  };
}, z.object({
  count_estimate: z.preprocess(toNumber, z.number().min(0)).optional(),
  count_confidence: z.preprocess(toNumber, z.number().min(0).max(1)).optional(),
  proximity: z.preprocess(toEnum(enumValues.proximity), z.enum(enumValues.proximity)).optional(),
  orientation_summary: z
    .preprocess(toEnum(enumValues.orientation), z.enum(enumValues.orientation))
    .optional(),
  confidence: z.preprocess(toNumber, z.number().min(0).max(1)).optional()
})).optional();

const CueNotes = z.preprocess(toStringArray(2), z.array(z.string()).max(2)).optional();

const SummarySchema = (allowed: readonly string[]) => z.preprocess((value) => {
  if (typeof value === 'string') {
    return { label: value };
  }
  if (typeof value === 'number') {
    return { confidence: value };
  }
  if (!isRecord(value)) return undefined;
  return value;
}, z.object({
  label: z.preprocess(toEnum(allowed), z.enum(allowed as [string, ...string[]])).optional(),
  confidence: z.preprocess(toNumber, z.number().min(0).max(1)).optional(),
  notes: CueNotes
})).optional();

const InteractionSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { label: value };
  }
  if (typeof value === 'number') {
    return { confidence: value };
  }
  if (!isRecord(value)) return undefined;
  return value;
}, z.object({
  label: z.preprocess(toEnum(enumValues.interaction), z.enum(enumValues.interaction)).optional(),
  confidence: z.preprocess(toNumber, z.number().min(0).max(1)).optional()
})).optional();

const SocialCuesSchema = z.object({
  facial_expression_summary: SummarySchema(enumValues.facial),
  body_posture_summary: SummarySchema(enumValues.posture),
  gaze_summary: SummarySchema(enumValues.gaze),
  interaction_context: InteractionSchema
});

const ReliabilitySchema = z.preprocess((value) => {
  if (typeof value === 'number') {
    return { overall_confidence: value };
  }
  if (!isRecord(value)) return undefined;
  const overall = value.overall_confidence ?? value.confidence;
  const limitations = value.limitations ?? value.notes;
  return {
    ...value,
    ...(overall !== undefined ? { overall_confidence: overall } : {}),
    ...(limitations ? { limitations } : {})
  };
}, z.object({
  overall_confidence: z.preprocess(toNumber, z.number().min(0).max(1)).optional(),
  limitations: z.preprocess(toStringArray(3), z.array(z.string()).max(3)).optional()
})).optional();

const RawVisionSchema = z.object({
  environment: EnvironmentSchema.optional(),
  people: PeopleSchema.optional(),
  social_cues: z.preprocess((value) => (isRecord(value) ? value : undefined), SocialCuesSchema).optional(),
  reliability: ReliabilitySchema.optional(),
  notes: z.preprocess(toStringArray(3), z.array(z.string()).max(3)).optional()
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
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    console.warn('Gemini JSON parse failed (truncated)', text.slice(0, 400));
    throw new Error('Invalid JSON from Gemini');
  }
  const result = RawVisionSchema.safeParse(parsed);
  if (!result.success) {
    console.warn('Gemini JSON schema mismatch', result.error.issues[0]?.message ?? '');
    console.warn('Gemini JSON (truncated)', text.slice(0, 400));
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
  type FacialLabel = NonNullable<VisionSnapshot['social_cues']['facial_expression_summary']>['label'];
  type PostureLabel = NonNullable<VisionSnapshot['social_cues']['body_posture_summary']>['label'];
  type GazeLabel = NonNullable<VisionSnapshot['social_cues']['gaze_summary']>['label'];
  type InteractionLabel = NonNullable<VisionSnapshot['social_cues']['interaction_context']>['label'];

  return {
    facial_expression_summary: cues.facial_expression_summary
      ? {
          label: (cues.facial_expression_summary.label ?? 'unknown') as FacialLabel,
          confidence: cues.facial_expression_summary.confidence ?? 0.3,
          notes: cues.facial_expression_summary.notes?.slice(0, 2)
        }
      : undefined,
    body_posture_summary: cues.body_posture_summary
      ? {
          label: (cues.body_posture_summary.label ?? 'unknown') as PostureLabel,
          confidence: cues.body_posture_summary.confidence ?? 0.3,
          notes: cues.body_posture_summary.notes?.slice(0, 2)
        }
      : undefined,
    gaze_summary: cues.gaze_summary
      ? {
          label: (cues.gaze_summary.label ?? 'unknown') as GazeLabel,
          confidence: cues.gaze_summary.confidence ?? 0.3,
          notes: cues.gaze_summary.notes?.slice(0, 2)
        }
      : undefined,
    interaction_context: cues.interaction_context
      ? {
          label: (cues.interaction_context.label ?? 'unknown') as InteractionLabel,
          confidence: cues.interaction_context.confidence ?? 0.3
        }
      : undefined
  };
}
