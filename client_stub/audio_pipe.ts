import crypto from 'crypto';

const url = process.argv[2] ?? 'ws://localhost:8080/ws';
const sessionId = process.argv[3] ?? crypto.randomUUID();
const sampleRate = Number(process.argv[4] ?? 16000);
const chunkMs = Number(process.argv[5] ?? 20);

const WebSocketCtor = (globalThis as any).WebSocket as { new (url: string): WebSocket } | undefined;
if (!WebSocketCtor) {
  console.error('WebSocket is not available. Use Node.js 20+ with global WebSocket.');
  process.exit(1);
}

const ws = new WebSocketCtor(url);

const bytesPerSample = 2;
const bytesPerMs = (sampleRate * bytesPerSample) / 1000;
const chunkBytes = Math.max(1, Math.floor(bytesPerMs * chunkMs));

let tMs = 0;
let buffer = Buffer.alloc(0);
let ready = false;
let ended = false;

ws.addEventListener('open', () => {
  ready = true;
  ws.send(
    JSON.stringify({
      type: 'start_session',
      sessionId,
      saveMode: 'none',
      sttMode: 'deepgram',
      language: 'en'
    })
  );
});

ws.addEventListener('message', (event) => {
  try {
    console.log('<<', JSON.parse(event.data.toString()));
  } catch {
    console.log('<<', event.data.toString());
  }
});

ws.addEventListener('close', () => {
  process.exit(0);
});

ws.addEventListener('error', (error) => {
  console.error('WebSocket error', error);
  process.exit(1);
});

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= chunkBytes && ready) {
    const slice = buffer.subarray(0, chunkBytes);
    buffer = buffer.subarray(chunkBytes);
    ws.send(
      JSON.stringify({
        type: 'audio_chunk',
        sessionId,
        pcm16_base64: slice.toString('base64'),
        sampleRate,
        t_ms: tMs
      })
    );
    tMs += chunkMs;
  }
});

process.stdin.on('end', () => {
  ended = true;
  if (ready) {
    ws.send(JSON.stringify({ type: 'end_session', sessionId }));
  }
});

process.stdin.on('error', (error) => {
  console.error('stdin error', error);
});

setInterval(() => {
  if (ready && ended && buffer.length === 0) {
    ws.close();
  }
}, 500);
