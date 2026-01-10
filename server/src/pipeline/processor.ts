import crypto from 'crypto';
import { config } from '../config.js';
import { GeminiClient, RollingSummary, DebriefSummary } from './llm_gemini.js';
import type {
  DebriefMessage,
  ErrorMessage,
  OverlayUpdateMessage,
  TranscriptChunk,
  IntentTag
} from '../ws/types.js';
import { writeMetrics } from '../analytics/sink.js';
import { saveSessionRecord } from '../db/mongo.js';

export type SessionState = {
  sessionId: string;
  userId?: string;
  language?: string;
  saveMode: 'none' | 'mongo';
  buffer: string;
  chunks: TranscriptChunk[];
  overlays: Array<RollingSummary & { last_updated_ms: number }>;
  createdAt: number;
  lastSummaryAt: number;
  lastSummaryChars: number;
  paused: boolean;
};

type ProcessorEmitters = {
  emitOverlay: (message: OverlayUpdateMessage) => void;
  emitDebrief: (message: DebriefMessage) => void;
  emitError: (message: ErrorMessage) => void;
};

export class SessionProcessor {
  private readonly sessions = new Map<string, SessionState>();
  private readonly gemini: GeminiClient;
  private readonly emitters: ProcessorEmitters;

  constructor(gemini: GeminiClient, emitters: ProcessorEmitters) {
    this.gemini = gemini;
    this.emitters = emitters;
  }

  startSession(params: {
    sessionId?: string;
    userId?: string;
    language?: string;
    saveMode?: 'none' | 'mongo';
  }): string {
    const sessionId = params.sessionId ?? crypto.randomUUID();
    const existing = this.sessions.get(sessionId);

    if (existing) {
      existing.userId = params.userId ?? existing.userId;
      existing.language = params.language ?? existing.language;
      existing.saveMode = params.saveMode ?? existing.saveMode;
      return sessionId;
    }

    const saveMode = params.saveMode ?? config.saveDefault;

    this.sessions.set(sessionId, {
      sessionId,
      userId: params.userId,
      language: params.language,
      saveMode,
      buffer: '',
      chunks: [],
      overlays: [],
      createdAt: Date.now(),
      lastSummaryAt: 0,
      lastSummaryChars: 0,
      paused: false
    });

    return sessionId;
  }

  setPaused(sessionId: string, paused: boolean) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.paused = paused;
    }
  }

  async handleChunk(chunk: TranscriptChunk) {
    const session = this.sessions.get(chunk.sessionId);
    if (!session) {
      this.emitters.emitError({
        type: 'error',
        sessionId: chunk.sessionId,
        code: 'session_not_found',
        message: 'Session not found. Send start_session first.'
      });
      return;
    }

    chunk.receivedAt = Date.now();
    session.chunks.push(chunk);
    session.buffer += `${chunk.speaker ? `[${chunk.speaker}] ` : ''}${chunk.text}\n`;

    if (session.paused) {
      return;
    }

    const now = Date.now();
    const charDelta = session.buffer.length - session.lastSummaryChars;
    const timeDelta = now - session.lastSummaryAt;

    if (timeDelta < config.summaryIntervalMs && charDelta < config.summaryChars) {
      return;
    }

    const recentTranscript = session.buffer.slice(-config.maxRollingChars);
    const summary = await this.gemini.generateRollingSummary(recentTranscript, session.language);
    const confidence = clamp(summary.confidence, 0, 1);

    const overlay: OverlayUpdateMessage = {
      type: 'overlay_update',
      sessionId: session.sessionId,
      topic_line: summary.topic_line,
      intent_tags: summary.intent_tags,
      confidence,
      last_updated_ms: now
    };

    session.overlays.push({
      ...summary,
      confidence,
      last_updated_ms: now
    });

    this.emitters.emitOverlay(overlay);
    session.lastSummaryAt = now;
    session.lastSummaryChars = session.buffer.length;
  }

  async endSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.emitters.emitError({
        type: 'error',
        sessionId,
        code: 'session_not_found',
        message: 'Session not found.'
      });
      return;
    }

    const transcriptWindow = session.buffer.slice(-config.maxDebriefChars);
    const debrief = await this.gemini.generateDebrief(transcriptWindow, session.language);

    const debriefMessage: DebriefMessage = {
      type: 'debrief',
      sessionId: session.sessionId,
      bullets: debrief.bullets,
      suggestions: debrief.suggestions,
      uncertainty_notes: debrief.uncertainty_notes
    };

    this.emitters.emitDebrief(debriefMessage);

    await this.persistSession(session, debrief);
    await this.writeAnalytics(session);

    this.sessions.delete(sessionId);
  }

  private async persistSession(session: SessionState, debrief: DebriefSummary) {
    if (session.saveMode !== 'mongo') {
      return;
    }

    try {
      await saveSessionRecord({
        sessionId: session.sessionId,
        userId: session.userId,
        language: session.language,
        saveMode: session.saveMode,
        transcript: session.chunks,
        overlays: session.overlays,
        debrief,
        createdAt: new Date(session.createdAt)
      });
    } catch (error) {
      this.emitters.emitError({
        type: 'error',
        sessionId: session.sessionId,
        code: 'mongo_write_failed',
        message: 'Failed to persist session to MongoDB.'
      });
      console.warn('Mongo persistence failed', error);
    }
  }

  private async writeAnalytics(session: SessionState) {
    const intentCounts = countIntentTags(session.overlays.map((o) => o.intent_tags));
    const confidences = session.overlays.map((o) => o.confidence).filter((c) => c >= 0);
    const avgConfidence = confidences.length
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2))
      : 0;

    const duration = estimateDuration(session.chunks);

    await writeMetrics(
      {
        sessionId: session.sessionId,
        duration,
        intent_counts: intentCounts,
        avg_confidence: avgConfidence,
        language: session.language ?? 'unknown'
      },
      config.analyticsPath
    );
  }
}

function estimateDuration(chunks: TranscriptChunk[]): number {
  if (chunks.length === 0) return 0;
  const sorted = [...chunks].sort((a, b) => a.t0_ms - b.t0_ms);
  return Math.max(0, sorted[sorted.length - 1].t1_ms - sorted[0].t0_ms);
}

function countIntentTags(tags: IntentTag[][]) {
  const counts: Record<string, number> = {};
  for (const group of tags) {
    for (const tag of group) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
