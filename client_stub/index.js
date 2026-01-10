#!/usr/bin/env node
const crypto = require('crypto');

const url = process.argv[2] || 'ws://localhost:8080/ws';
const sessionId = process.argv[3] || crypto.randomUUID();

const ws = new WebSocket(url);

ws.addEventListener('open', () => {
  ws.send(
    JSON.stringify({
      type: 'start_session',
      sessionId,
      userId: 'demo',
      language: 'en',
      saveMode: 'none'
    })
  );

  const chunks = [
    'Hey, can we align on the plan for next week?',
    'I think we should prioritize the onboarding flow and ask for feedback.',
    'Let us agree on milestones and who owns each task.'
  ];

  chunks.forEach((text, index) => {
    setTimeout(() => {
      const t0 = index * 1500;
      const t1 = t0 + 1200;
      ws.send(
        JSON.stringify({
          type: 'transcript_chunk',
          sessionId,
          text,
          t0_ms: t0,
          t1_ms: t1,
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
  }, 500 + chunks.length * 1200 + 1000);
});

ws.addEventListener('message', (event) => {
  try {
    const message = JSON.parse(event.data.toString());
    console.log('<<', message);
  } catch {
    console.log('<<', event.data.toString());
  }
});

ws.addEventListener('close', () => {
  console.log('WebSocket closed');
});

ws.addEventListener('error', (error) => {
  console.error('WebSocket error', error);
});
