import { z } from 'zod';

export const IntentTags = [
  'planning',
  'feedback',
  'debate',
  'smalltalk',
  'joking',
  'venting',
  'support',
  'negotiation',
  'instruction'
] as const;

export type IntentTag = (typeof IntentTags)[number];

export const StartSessionSchema = z.object({
  type: z.literal('start_session'),
  sessionId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  saveMode: z.enum(['none', 'mongo']).optional()
});

export const TranscriptChunkSchema = z
  .object({
    type: z.literal('transcript_chunk'),
    sessionId: z.string().min(1),
    text: z.string().min(1),
    t0_ms: z.number().nonnegative(),
    t1_ms: z.number().nonnegative(),
    speaker: z.string().min(1).optional()
  })
  .refine((val) => val.t1_ms >= val.t0_ms, {
    message: 't1_ms must be >= t0_ms',
    path: ['t1_ms']
  });

export const EndSessionSchema = z.object({
  type: z.literal('end_session'),
  sessionId: z.string().min(1)
});

export const PauseOverlaySchema = z.object({
  type: z.literal('pause_overlay'),
  sessionId: z.string().min(1),
  paused: z.boolean()
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  StartSessionSchema,
  TranscriptChunkSchema,
  EndSessionSchema,
  PauseOverlaySchema
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type TranscriptChunk = z.infer<typeof TranscriptChunkSchema> & { receivedAt?: number };

export type OverlayUpdateMessage = {
  type: 'overlay_update';
  sessionId: string;
  topic_line: string;
  intent_tags: IntentTag[];
  confidence: number;
  last_updated_ms: number;
};

export type DebriefMessage = {
  type: 'debrief';
  sessionId: string;
  bullets: string[];
  suggestions: string[];
  uncertainty_notes: string[];
};

export type ErrorMessage = {
  type: 'error';
  sessionId?: string;
  code: string;
  message: string;
};

export type ServerMessage = OverlayUpdateMessage | DebriefMessage | ErrorMessage;
