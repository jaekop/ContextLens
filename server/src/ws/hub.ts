import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import {
  ClientMessageSchema,
  ToolEvent,
  OverlayUpdate,
  Debrief,
  ErrorMessage,
  VisionUpdate
} from './schemas.js';
import { SessionStore } from '../sessions/store.js';
import { SessionProcessor } from '../pipeline/processor.js';
import { DeepgramAdapter } from '../adapters/deepgram.js';
import { config } from '../config.js';

export type WsHub = {
  emitOverlay: (message: OverlayUpdate) => void;
  emitDebrief: (message: Debrief) => void;
  emitError: (message: ErrorMessage) => void;
  emitTool: (message: ToolEvent) => void;
  emitVision: (message: VisionUpdate) => void;
};

export function createWsHub(params: {
  server: HttpServer;
  path: string;
  store: SessionStore;
  processor: SessionProcessor;
  deepgram: DeepgramAdapter;
}): WsHub {
  const wss = new WebSocketServer({ server: params.server, path: params.path });
  const sessionClients = new Map<string, Set<WebSocket>>();
  const clientSessions = new Map<WebSocket, Set<string>>();

  const send = (
    ws: WebSocket,
    message: OverlayUpdate | Debrief | ErrorMessage | ToolEvent | VisionUpdate
  ) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const sendToSession = (
    sessionId: string,
    message: OverlayUpdate | Debrief | ErrorMessage | ToolEvent | VisionUpdate
  ) => {
    const clients = sessionClients.get(sessionId);
    if (!clients) return;
    for (const ws of clients) {
      send(ws, message);
    }
  };

  const attachClient = (ws: WebSocket, sessionId: string) => {
    const sessions = clientSessions.get(ws) ?? new Set<string>();
    sessions.add(sessionId);
    clientSessions.set(ws, sessions);

    const clients = sessionClients.get(sessionId) ?? new Set<WebSocket>();
    clients.add(ws);
    sessionClients.set(sessionId, clients);
  };

  const detachClient = (ws: WebSocket) => {
    const sessions = clientSessions.get(ws);
    if (sessions) {
      for (const sessionId of sessions) {
        const clients = sessionClients.get(sessionId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) sessionClients.delete(sessionId);
        }
      }
    }
    clientSessions.delete(ws);
  };

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      let parsedMessage: unknown;
      try {
        parsedMessage = JSON.parse(data.toString());
      } catch {
        send(ws, { type: 'error', code: 'invalid_json', message: 'Invalid JSON.' });
        return;
      }

      const result = ClientMessageSchema.safeParse(parsedMessage);
      if (!result.success) {
        send(ws, { type: 'error', code: 'invalid_message', message: 'Message failed validation.' });
        return;
      }

      const message = result.data;

      switch (message.type) {
        case 'start_session': {
          const session = params.store.startSession({
            sessionId: message.sessionId,
            userId: message.userId,
            language: message.language,
            saveMode: message.saveMode ?? 'none',
            sttMode: message.sttMode ?? config.sttDefault
          });

          attachClient(ws, session.sessionId);
          await params.processor.onStart(session);
          if (!message.sessionId) {
            send(ws, {
              type: 'overlay_update',
              sessionId: session.sessionId,
              topic_line: 'Session started',
              intent_tags: ['planning'],
              confidence: 0.2,
              uncertainty_notes: ['Session created; awaiting transcript.'],
              last_updated_ms: Date.now()
            });
          }

          if (session.sttMode === 'deepgram') {
            if (!params.deepgram.isReady()) {
              send(ws, {
                type: 'error',
                sessionId: session.sessionId,
                code: 'deepgram_unavailable',
                message: 'Deepgram API key missing.'
              });
            } else if (!session.stream) {
              try {
                session.stream = params.deepgram.startStream(session.language, async (chunk) => {
                  await params.processor.handleTranscript(session.sessionId, {
                    type: 'transcript_chunk',
                    sessionId: session.sessionId,
                    text: chunk.text,
                    t0_ms: chunk.t0_ms,
                    t1_ms: chunk.t1_ms,
                    speaker: chunk.speaker
                  });
                });
              } catch (error) {
                send(ws, {
                  type: 'error',
                  sessionId: session.sessionId,
                  code: 'deepgram_start_failed',
                  message: 'Failed to start Deepgram stream.'
                });
                console.warn('Deepgram start failed', error);
              }
            }
          }
          break;
        }
        case 'audio_chunk': {
          const session = params.store.get(message.sessionId);
          if (!session) {
            send(ws, {
              type: 'error',
              sessionId: message.sessionId,
              code: 'session_not_found',
              message: 'Session not found.'
            });
            return;
          }
          if (session.sttMode !== 'deepgram') {
            send(ws, {
              type: 'error',
              sessionId: message.sessionId,
              code: 'stt_not_active',
              message: 'STT mode is not deepgram for this session.'
            });
            return;
          }
          if (!session.stream) {
            send(ws, {
              type: 'error',
              sessionId: message.sessionId,
              code: 'stt_stream_missing',
              message: 'Deepgram stream not initialized.'
            });
            return;
          }
          session.stream.sendAudio(message.pcm16_base64, message.sampleRate);
          break;
        }
        case 'transcript_chunk': {
          await params.processor.handleTranscript(message.sessionId, message);
          break;
        }
        case 'vision_frame': {
          await params.processor.handleVisionFrame(message.sessionId, message);
          break;
        }
        case 'end_session': {
          await params.processor.endSession(message.sessionId);
          break;
        }
        default: {
          send(ws, { type: 'error', code: 'unsupported_message', message: 'Unsupported type.' });
        }
      }
    });

    ws.on('close', () => {
      detachClient(ws);
    });
  });

  wss.on('listening', () => {
    console.log(`WebSocket server listening on ${params.path}`);
  });

  return {
    emitOverlay: (message) => sendToSession(message.sessionId, message),
    emitDebrief: (message) => sendToSession(message.sessionId, message),
    emitError: (message) => {
      if (message.sessionId) {
        sendToSession(message.sessionId, message);
      } else {
        for (const client of wss.clients) {
          send(client, message);
        }
      }
    },
    emitTool: (message) => sendToSession(message.sessionId, message),
    emitVision: (message) => sendToSession(message.sessionId, message)
  };
}
