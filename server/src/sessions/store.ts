import crypto from 'crypto';
import type { TranscriptChunk, OverlayUpdate, VisionUpdate, IntentTag } from '../ws/schemas.js';
import type { Debrief } from '../ws/schemas.js';
import type { SttStreamHandle } from '../adapters/deepgram.js';

export type DisplayCard = { title: string; body: string };
export type DisplayState = {
  sessionId: string;
  updatedAt: number;
  topic_line: string;
  intent_tags: IntentTag[];
  confidence: number;
  cards: DisplayCard[];
  uncertainty_notes: string[];
  transcript_tail: string[];
  env?: { label: string; confidence: number };
};

export type SessionState = {
  sessionId: string;
  userId?: string;
  language?: string;
  saveMode: 'none' | 'mongo';
  sttMode: 'mock' | 'deepgram';
  buffer: string;
  chunks: TranscriptChunk[];
  overlays: OverlayUpdate[];
  visionUpdates: VisionUpdate[];
  debrief?: Debrief;
  display: DisplayState;
  createdAt: number;
  lastSummaryAt: number;
  lastSummaryChars: number;
  lastVisionAt: number;
  stream?: SttStreamHandle;
  overlayLatenciesMs: number[];
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  startSession(params: {
    sessionId?: string;
    userId?: string;
    language?: string;
    saveMode: 'none' | 'mongo';
    sttMode: 'mock' | 'deepgram';
  }): SessionState {
    const sessionId = params.sessionId ?? crypto.randomUUID();
    const existing = this.sessions.get(sessionId);

    if (existing) {
      existing.userId = params.userId ?? existing.userId;
      existing.language = params.language ?? existing.language;
      existing.saveMode = params.saveMode ?? existing.saveMode;
      existing.sttMode = params.sttMode ?? existing.sttMode;
      return existing;
    }

    const session: SessionState = {
      sessionId,
      userId: params.userId,
      language: params.language,
      saveMode: params.saveMode,
      sttMode: params.sttMode,
      buffer: '',
      chunks: [],
      overlays: [],
      visionUpdates: [],
      display: {
        sessionId,
        updatedAt: Date.now(),
        topic_line: 'Listening...',
        intent_tags: ['smalltalk'],
        confidence: 0.1,
        cards: [
          { title: 'What is happening', body: 'Waiting for transcript.' },
          { title: 'Try next', body: 'Speak naturally to start the overlay.' }
        ],
        uncertainty_notes: ['No transcript yet.'],
        transcript_tail: []
      },
      createdAt: Date.now(),
      lastSummaryAt: 0,
      lastSummaryChars: 0,
      lastVisionAt: 0,
      overlayLatenciesMs: []
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  remove(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session?.stream) {
      session.stream.stop();
    }
    this.sessions.delete(sessionId);
  }

  list(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  getDisplay(sessionId?: string): DisplayState | null {
    if (sessionId) {
      return this.sessions.get(sessionId)?.display ?? null;
    }
    let latest: DisplayState | null = null;
    for (const session of this.sessions.values()) {
      if (!latest || session.display.updatedAt > latest.updatedAt) {
        latest = session.display;
      }
    }
    return latest;
  }
}
