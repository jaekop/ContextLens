import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const url = process.argv[2] ?? 'ws://localhost:8080/ws';
const sessionId = process.argv[3] ?? crypto.randomUUID();
const imagePath = process.argv[4];

if (!imagePath) {
  console.error('Usage: node --loader tsx ../client_stub/vision_sender.ts <wsUrl> <sessionId?> <imagePath>');
  process.exit(1);
}

const ext = path.extname(imagePath).toLowerCase();
const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

const WebSocketCtor = (globalThis as any).WebSocket as { new (url: string): WebSocket } | undefined;
if (!WebSocketCtor) {
  console.error('WebSocket is not available. Use Node.js 20+ with global WebSocket.');
  process.exit(1);
}

const ws = new WebSocketCtor(url);

ws.addEventListener('open', async () => {
  ws.send(
    JSON.stringify({
      type: 'start_session',
      sessionId,
      saveMode: 'none',
      sttMode: 'mock',
      language: 'en'
    })
  );

  const data = await fs.readFile(imagePath);
  ws.send(
    JSON.stringify({
      type: 'vision_frame',
      sessionId,
      image_base64: data.toString('base64'),
      mime,
      t_ms: Date.now()
    })
  );

  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'end_session', sessionId }));
  }, 1500);
});

ws.addEventListener('message', (event) => {
  try {
    console.log('<<', JSON.parse(event.data.toString()));
  } catch {
    console.log('<<', event.data.toString());
  }
});

ws.addEventListener('close', () => {
  console.log('WebSocket closed');
  process.exit(0);
});

ws.addEventListener('error', (error) => {
  console.error('WebSocket error', error);
  process.exit(1);
});
