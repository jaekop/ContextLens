import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { ClientMessageSchema, OverlayUpdateMessage, DebriefMessage, ErrorMessage } from './types.js';
import { SessionProcessor } from '../pipeline/processor.js';
import { config } from '../config.js';

export type WsHub = {
  attachProcessor: (processor: SessionProcessor) => void;
  emitOverlay: (message: OverlayUpdateMessage) => void;
  emitDebrief: (message: DebriefMessage) => void;
  emitError: (message: ErrorMessage) => void;
};

export function createWsHub(server: HttpServer, wsPath: string): WsHub {
  const wss = new WebSocketServer({ server, path: wsPath });
  let processor: SessionProcessor | null = null;

  const sessionClients = new Map<string, Set<WebSocket>>();
  const clientSessions = new Map<WebSocket, Set<string>>();

  const attachProcessor = (next: SessionProcessor) => {
    processor = next;
  };

  const emitOverlay = (message: OverlayUpdateMessage) => {
    sendToSession(message.sessionId, message);
  };

  const emitDebrief = (message: DebriefMessage) => {
    sendToSession(message.sessionId, message);
  };

  const emitError = (message: ErrorMessage) => {
    if (message.sessionId) {
      sendToSession(message.sessionId, message);
    } else {
      broadcast(message);
    }
  };

  const sendToSession = (sessionId: string, message: OverlayUpdateMessage | DebriefMessage | ErrorMessage) => {
    const clients = sessionClients.get(sessionId);
    if (!clients) return;
    for (const ws of clients) {
      send(ws, message);
    }
  };

  const broadcast = (message: OverlayUpdateMessage | DebriefMessage | ErrorMessage) => {
    for (const ws of wss.clients) {
      send(ws, message);
    }
  };

  const send = (ws: WebSocket, message: OverlayUpdateMessage | DebriefMessage | ErrorMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const addClientSession = (ws: WebSocket, sessionId: string) => {
    const sessions = clientSessions.get(ws) ?? new Set<string>();
    sessions.add(sessionId);
    clientSessions.set(ws, sessions);

    const clients = sessionClients.get(sessionId) ?? new Set<WebSocket>();
    clients.add(ws);
    sessionClients.set(sessionId, clients);
  };

  const removeClient = (ws: WebSocket) => {
    const sessions = clientSessions.get(ws);
    if (sessions) {
      for (const sessionId of sessions) {
        const clients = sessionClients.get(sessionId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            sessionClients.delete(sessionId);
          }
        }
      }
    }
    clientSessions.delete(ws);
  };

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      let payload: unknown;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        send(ws, {
          type: 'error',
          code: 'invalid_json',
          message: 'Invalid JSON payload.'
        });
        return;
      }

      const parsed = ClientMessageSchema.safeParse(payload);
      if (!parsed.success) {
        send(ws, {
          type: 'error',
          code: 'invalid_message',
          message: 'Message failed validation.'
        });
        return;
      }

      if (!processor) {
        send(ws, {
          type: 'error',
          code: 'processor_unavailable',
          message: 'Processor not initialized.'
        });
        return;
      }

      const message = parsed.data;

      switch (message.type) {
        case 'start_session': {
          const sessionId = processor.startSession({
            sessionId: message.sessionId,
            userId: message.userId,
            language: message.language,
            saveMode: message.saveMode
          });
          addClientSession(ws, sessionId);
          if (!message.sessionId) {
            emitOverlay({
              type: 'overlay_update',
              sessionId,
              topic_line: 'Session created',
              intent_tags: ['planning'],
              confidence: 0.2,
              last_updated_ms: Date.now()
            });
          }
          break;
        }
        case 'transcript_chunk': {
          await processor.handleChunk(message);
          break;
        }
        case 'end_session': {
          await processor.endSession(message.sessionId);
          break;
        }
        case 'pause_overlay': {
          processor.setPaused(message.sessionId, message.paused);
          break;
        }
        default: {
          send(ws, {
            type: 'error',
            code: 'unsupported_message',
            message: 'Unsupported message type.'
          });
        }
      }
    });

    ws.on('close', () => {
      removeClient(ws);
    });
  });

  wss.on('listening', () => {
    console.log(`WebSocket server listening on ${config.wsPath}`);
  });

  return { attachProcessor, emitOverlay, emitDebrief, emitError };
}
