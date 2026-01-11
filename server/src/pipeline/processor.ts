import crypto from 'crypto';
import { config } from '../config.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { SessionStore, SessionState } from '../sessions/store.js';
import type {
  TranscriptChunk,
  OverlayUpdate,
  Debrief,
  ToolEvent,
  VisionFrame,
  VisionUpdate
} from '../ws/schemas.js';
import type { MongoStore } from '../db/mongo.js';
import { SnowflakeAdapter, MetricsEvent } from '../analytics/snowflake.js';

export type ProcessorEmitters = {
  overlay: (message: OverlayUpdate) => void;
  debrief: (message: Debrief) => void;
  error: (message: { type: 'error'; sessionId?: string; code: string; message: string }) => void;
  tool: (message: ToolEvent) => void;
  vision: (message: VisionUpdate) => void;
};

export class SessionProcessor {
  private readonly store: SessionStore;
  private readonly gemini: GeminiAdapter;
  private readonly mongo: MongoStore | null;
  private readonly snowflake: SnowflakeAdapter;
  private emitters: ProcessorEmitters;

  constructor(params: {
    store: SessionStore;
    gemini: GeminiAdapter;
    mongo: MongoStore | null;
    snowflake: SnowflakeAdapter;
    emitters: ProcessorEmitters;
  }) {
    this.store = params.store;
    this.gemini = params.gemini;
    this.mongo = params.mongo;
    this.snowflake = params.snowflake;
    this.emitters = params.emitters;
  }

  setEmitters(emitters: ProcessorEmitters) {
    this.emitters = emitters;
  }

  async onStart(session: SessionState) {
    if (session.saveMode === 'mongo' && session.userId && this.mongo) {
      try {
        await this.mongo.upsertUserPrefs({
          userId: session.userId,
          language: session.language,
          saveMode: session.saveMode,
          updatedAt: new Date()
        });
      } catch (error) {
        console.warn('Failed to upsert user prefs', error);
      }
    }
  }

  async handleTranscript(sessionId: string, chunk: TranscriptChunk) {
    const session = this.store.get(sessionId);
    if (!session) {
      this.emitters.error({
        type: 'error',
        sessionId,
        code: 'session_not_found',
        message: 'Session not found. Send start_session first.'
      });
      return;
    }

    chunk.receivedAt = Date.now();
    session.chunks.push(chunk);
    const line = `${chunk.speaker ? `[${chunk.speaker}] ` : ''}${chunk.text}`;
    session.buffer += `${line}\n`;
    session.display.transcript_tail = pushTail(session.display.transcript_tail, line);
    session.display.updatedAt = Date.now();

    const now = Date.now();
    const charDelta = session.buffer.length - session.lastSummaryChars;
    const timeDelta = now - session.lastSummaryAt;

    if (timeDelta < config.summaryIntervalMs && charDelta < config.summaryChars) {
      return;
    }

    const recentTranscript = session.buffer.slice(-config.maxRollingChars);
    const summary = await this.gemini.rollingSummary(recentTranscript, session.language);

    const overlay: OverlayUpdate = {
      type: 'overlay_update',
      sessionId,
      topic_line: summary.topic_line,
      intent_tags: summary.intent_tags,
      confidence: clamp(summary.confidence, 0, 1),
      cards: summary.cards,
      uncertainty_notes: summary.uncertainty_notes,
      last_updated_ms: now
    };

    session.overlays.push(overlay);
    session.lastSummaryAt = now;
    session.lastSummaryChars = session.buffer.length;
    session.display.topic_line = overlay.topic_line;
    session.display.intent_tags = overlay.intent_tags;
    session.display.confidence = overlay.confidence;
    session.display.cards = summary.cards;
    session.display.uncertainty_notes = overlay.uncertainty_notes;
    session.display.updatedAt = now;

    if (chunk.receivedAt) {
      session.overlayLatenciesMs.push(now - chunk.receivedAt);
    }

    this.emitters.overlay(overlay);

    if (summary.intent_tags.includes('instruction')) {
      const suggestion = buildPracticePrompt();
      this.emitters.tool({
        type: 'tool_event',
        sessionId,
        tool: 'practice_prompt',
        suggestion,
        last_updated_ms: now
      });
    }
  }

  async handleVisionFrame(sessionId: string, frame: VisionFrame) {
    const session = this.store.get(sessionId);
    if (!session) {
      this.emitters.error({
        type: 'error',
        sessionId,
        code: 'session_not_found',
        message: 'Session not found. Send start_session first.'
      });
      return;
    }

    const now = Date.now();
    if (now - session.lastVisionAt < config.visionIntervalMs) {
      return;
    }
    session.lastVisionAt = now;

    const summary = await this.gemini.visionSummary(frame.image_base64, frame.mime, session.language);
    const update: VisionUpdate = {
      type: 'vision_update',
      sessionId,
      scene_summary: summary.scene_summary,
      confidence: clamp(summary.confidence, 0, 1),
      uncertainty_notes: summary.uncertainty_notes,
      last_updated_ms: now
    };

    session.visionUpdates.push(update);
    session.display.env = { label: summary.scene_summary, confidence: update.confidence };
    session.display.updatedAt = now;
    this.emitters.vision(update);
  }

  async endSession(sessionId: string) {
    const session = this.store.get(sessionId);
    if (!session) {
      this.emitters.error({
        type: 'error',
        sessionId,
        code: 'session_not_found',
        message: 'Session not found.'
      });
      return;
    }

    const transcriptWindow = session.buffer.slice(-config.maxDebriefChars);
    const debriefSummary = await this.gemini.debrief(transcriptWindow, session.language);

    const debrief: Debrief = {
      type: 'debrief',
      sessionId,
      bullets: debriefSummary.bullets,
      suggestions: debriefSummary.suggestions,
      uncertainty_notes: debriefSummary.uncertainty_notes
    };

    session.debrief = debrief;
    this.emitters.debrief(debrief);

    await this.persistSession(session);
    await this.sendMetrics(session);

    this.store.remove(sessionId);
  }

  private async persistSession(session: SessionState) {
    if (session.saveMode !== 'mongo') return;
    if (!this.mongo) {
      this.emitters.error({
        type: 'error',
        sessionId: session.sessionId,
        code: 'mongo_unavailable',
        message: 'MongoDB not configured.'
      });
      return;
    }

    try {
      await this.mongo.saveSession({
        sessionId: session.sessionId,
        userId: session.userId,
        language: session.language,
        saveMode: session.saveMode,
        transcript: session.chunks,
        overlays: session.overlays,
        vision: session.visionUpdates,
        debrief: session.debrief ?? {},
        createdAt: new Date(session.createdAt),
        updatedAt: new Date()
      });
    } catch (error) {
      console.warn('Mongo save failed', error);
      this.emitters.error({
        type: 'error',
        sessionId: session.sessionId,
        code: 'mongo_write_failed',
        message: 'Failed to persist session.'
      });
    }
  }

  private async sendMetrics(session: SessionState) {
    const durations = estimateDuration(session);
    const avgConfidence = average(session.overlays.map((o) => o.confidence));
    const intentCounts = countIntentTags(session.overlays);
    const latencyP50 = percentile(session.overlayLatenciesMs, 50);

    const event: MetricsEvent = {
      sessionId_hash: hashSessionId(session.sessionId),
      duration_s: durations,
      language: session.language ?? 'unknown',
      avg_confidence: avgConfidence,
      intent_counts: intentCounts,
      latency_ms_p50: latencyP50
    };

    try {
      await this.snowflake.send(event);
    } catch (error) {
      console.warn('Metrics send failed', error);
      this.emitters.error({
        type: 'error',
        sessionId: session.sessionId,
        code: 'analytics_failed',
        message: 'Failed to send analytics.'
      });
    }
  }
}

function buildPracticePrompt(): string {
  return 'Try asking the learner to restate the concept in their own words.';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function estimateDuration(session: SessionState): number {
  if (session.chunks.length === 0) return 0;
  const withTimes = session.chunks
    .map((chunk) => ({
      t0: chunk.t0_ms ?? 0,
      t1: chunk.t1_ms ?? chunk.t0_ms ?? 0
    }))
    .sort((a, b) => a.t0 - b.t0);
  const start = withTimes[0]?.t0 ?? 0;
  const end = withTimes[withTimes.length - 1]?.t1 ?? start;
  if (end <= start) {
    return Math.max(0, Math.round((Date.now() - session.createdAt) / 1000));
  }
  return Math.max(0, Math.round((end - start) / 1000));
}

function countIntentTags(overlays: OverlayUpdate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const overlay of overlays) {
    for (const tag of overlay.intent_tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, val) => sum + val, 0);
  return Number((total / values.length).toFixed(2));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[index] ?? 0;
}

function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

function pushTail(tail: string[], line: string): string[] {
  const next = [...tail, line].filter((item) => item.trim().length > 0);
  return next.slice(-4);
}
