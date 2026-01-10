import crypto from 'crypto';
import type { TranscriptChunk, OverlayUpdate, VisionUpdate } from '../ws/schemas.js';
import type { Debrief } from '../ws/schemas.js';
import type { SttStreamHandle } from '../adapters/deepgram.js';

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
}
