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
  saveMode: z.enum(['none', 'mongo']).default('none'),
  sttMode: z.enum(['mock', 'deepgram']).optional()
});

export const AudioChunkSchema = z.object({
  type: z.literal('audio_chunk'),
  sessionId: z.string().min(1),
  pcm16_base64: z.string().min(1),
  sampleRate: z.number().min(8000),
  t_ms: z.number().nonnegative()
});

export const TranscriptChunkSchema = z.object({
  type: z.literal('transcript_chunk'),
  sessionId: z.string().min(1),
  text: z.string().min(1),
  t0_ms: z.number().nonnegative().optional(),
  t1_ms: z.number().nonnegative().optional(),
  speaker: z.string().min(1).optional()
});

export const EndSessionSchema = z.object({
  type: z.literal('end_session'),
  sessionId: z.string().min(1)
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  StartSessionSchema,
  AudioChunkSchema,
  TranscriptChunkSchema,
  EndSessionSchema
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type TranscriptChunk = z.infer<typeof TranscriptChunkSchema> & { receivedAt?: number };

export const OverlayUpdateSchema = z.object({
  type: z.literal('overlay_update'),
  sessionId: z.string().min(1),
  topic_line: z.string().min(1),
  intent_tags: z.array(z.enum(IntentTags)).min(1).max(3),
  confidence: z.number().min(0).max(1),
  uncertainty_notes: z.array(z.string().min(1)).max(2),
  last_updated_ms: z.number().nonnegative()
});

export const DebriefSchema = z.object({
  type: z.literal('debrief'),
  sessionId: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(3).max(5),
  suggestions: z.array(z.string().min(1)).min(1).max(2),
  uncertainty_notes: z.array(z.string().min(1)).min(1).max(2)
});

export const ErrorSchema = z.object({
  type: z.literal('error'),
  sessionId: z.string().min(1).optional(),
  code: z.string().min(1),
  message: z.string().min(1)
});

export const ToolEventSchema = z.object({
  type: z.literal('tool_event'),
  sessionId: z.string().min(1),
  tool: z.literal('practice_prompt'),
  suggestion: z.string().min(1),
  last_updated_ms: z.number().nonnegative()
});

export type OverlayUpdate = z.infer<typeof OverlayUpdateSchema>;
export type Debrief = z.infer<typeof DebriefSchema>;
export type ErrorMessage = z.infer<typeof ErrorSchema>;
export type ToolEvent = z.infer<typeof ToolEventSchema>;

export type ServerMessage = OverlayUpdate | Debrief | ErrorMessage | ToolEvent;
