import crypto from 'crypto';

type WebSocketLike = {
  send: (data: string) => void;
  addEventListener: (event: string, cb: (event: any) => void) => void;
  close: () => void;
};

const url = process.argv[2] ?? 'ws://localhost:8080/ws';
const sessionId = process.argv[3] ?? crypto.randomUUID();

const WebSocketCtor = (globalThis as any).WebSocket as { new (url: string): WebSocketLike } | undefined;
if (!WebSocketCtor) {
  console.error('WebSocket is not available. Use Node.js 20+ with global WebSocket.');
  process.exit(1);
}

const ws = new WebSocketCtor(url);

ws.addEventListener('open', () => {
  ws.send(
    JSON.stringify({
      type: 'start_session',
      sessionId,
      userId: 'demo-user',
      language: 'en',
      saveMode: 'none',
      sttMode: 'mock'
    })
  );

  const chunks = [
    'We should plan the next lesson outline and timeline.',
    'Can you give feedback on the assignment instructions?',
    'Let us agree on who leads the practice session.'
  ];

  chunks.forEach((text, index) => {
    setTimeout(() => {
      ws.send(
        JSON.stringify({
          type: 'transcript_chunk',
          sessionId,
          text,
          t0_ms: index * 1500,
          t1_ms: index * 1500 + 1200,
          speaker: 'user'
        })
      );
    }, 500 + index * 1200);
  });

  setTimeout(() => {
    ws.send(
      JSON.stringify({
        type: 'end_session',
        sessionId
      })
    );
  }, 500 + chunks.length * 1200 + 1200);
});

ws.addEventListener('message', (event: any) => {
  try {
    const parsed = JSON.parse(event.data?.toString() ?? '');
    console.log('<<', parsed);
  } catch {
    console.log('<<', event.data?.toString() ?? event);
  }
});

ws.addEventListener('close', () => {
  console.log('WebSocket closed');
});

ws.addEventListener('error', (event: any) => {
  console.error('WebSocket error', event);
});
