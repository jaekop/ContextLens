import 'dotenv/config';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { config } from './config.js';
import { SessionStore } from './sessions/store.js';
import { GeminiAdapter } from './adapters/gemini.js';
import { DeepgramAdapter } from './adapters/deepgram.js';
import { SessionProcessor } from './pipeline/processor.js';
import { createWsHub } from './ws/hub.js';
import { MongoStore } from './db/mongo.js';
import { SnowflakeAdapter } from './analytics/snowflake.js';

async function boot() {
  const fastify = Fastify({ logger: true });

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Context Lens Backend',
        version: '0.1.0'
      }
    }
  });
  await fastify.register(swaggerUI, { routePrefix: '/docs' });

  const mongo = await MongoStore.connect(config.mongoUri).catch((error) => {
    fastify.log.warn({ error }, 'Mongo connection failed');
    return null;
  });

  const store = new SessionStore();
  const gemini = new GeminiAdapter({
    apiKey: config.geminiApiKey,
    model: config.geminiModel
  });
  const deepgram = new DeepgramAdapter(config.deepgramApiKey);
  const snowflake = new SnowflakeAdapter({
    account: config.snowflake.account,
    user: config.snowflake.user,
    password: config.snowflake.password,
    database: config.snowflake.database,
    schema: config.snowflake.schema,
    warehouse: config.snowflake.warehouse,
    mockOutputPath: config.analyticsPath,
    mode: config.analyticsDefault
  });

  fastify.get('/health', {
    schema: {
      description: 'Basic health check',
      response: {
        200: {
          type: 'object',
          properties: { ok: { type: 'boolean' } }
        }
      }
    }
  }, async () => ({ ok: true }));

  fastify.get('/status', {
    schema: {
      description: 'Current session count',
      response: {
        200: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, sessions: { type: 'number' } }
        }
      }
    }
  }, async () => ({ ok: true, sessions: store.list().length }));

  fastify.get('/display.json', {
    schema: {
      description: 'Latest display state for dashboard',
      querystring: {
        type: 'object',
        properties: { sessionId: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            updatedAt: { type: 'number' },
            topic_line: { type: 'string' },
            intent_tags: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' },
            cards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  body: { type: 'string' }
                }
              }
            },
            uncertainty_notes: { type: 'array', items: { type: 'string' } },
            transcript_tail: { type: 'array', items: { type: 'string' } },
            env: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                confidence: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, async (request) => {
    const sessionId = (request.query as { sessionId?: string })?.sessionId;
    const display = store.getDisplay(sessionId);
    if (display) {
      return display;
    }
    return {
      sessionId: 'none',
      updatedAt: Date.now(),
      topic_line: 'No active session',
      intent_tags: ['smalltalk'],
      confidence: 0,
      cards: [
        { title: 'What is happening', body: 'Waiting for a session.' },
        { title: 'Try next', body: 'Start a session to see updates.' }
      ],
      uncertainty_notes: ['No live session.'],
      transcript_tail: []
    };
  });

  fastify.get('/', {
    schema: {
      description: 'Dashboard view',
      response: {
        200: { type: 'string' }
      }
    }
  }, async (_, reply) => {
    reply.type('text/html').send(buildDashboardPage());
  });

  fastify.get('/integrations/test', {
    schema: {
      description: 'Test external integrations (keys or live calls)',
      querystring: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['keys', 'live'] }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            mode: { type: 'string' },
            results: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  error: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request) => {
    const mode = (request.query as { mode?: string })?.mode === 'live' ? 'live' : 'keys';
    const results: Record<string, { ok: boolean; error?: string }> = {};

    if (mode === 'keys') {
      results.gemini = gemini.isReady() ? { ok: true } : { ok: false, error: 'missing_api_key' };
      results.deepgram = deepgram.isReady() ? { ok: true } : { ok: false, error: 'missing_api_key' };
      results.mongo = mongo ? { ok: true } : { ok: false, error: 'not_connected' };
      results.snowflake = config.analyticsDefault === 'snowflake'
        ? { ok: true }
        : { ok: false, error: 'analytics_default=mock' };
    } else {
      results.gemini = await gemini.testConnection();
      results.deepgram = await deepgram.testConnection();
      results.mongo = mongo
        ? await mongo.ping().then(() => ({ ok: true })).catch((error: Error) => ({
          ok: false,
          error: error.message
        }))
        : { ok: false, error: 'not_connected' };
      results.snowflake = await snowflake.testConnection();
    }

    return { ok: true, mode, results };
  });

  fastify.get('/ws-test', {
    schema: {
      description: 'WebSocket testing page',
      response: {
        200: { type: 'string' }
      }
    }
  }, async (_, reply) => {
    reply.type('text/html').send(buildWsTestPage(config.wsPath));
  });

  const processor = new SessionProcessor({
    store,
    gemini,
    mongo,
    snowflake,
    emitters: {
      overlay: () => {},
      debrief: () => {},
      error: (message) => fastify.log.warn({ message }, 'processor error'),
      tool: () => {},
      vision: () => {}
    }
  });

  const hub = createWsHub({
    server: fastify.server,
    path: config.wsPath,
    store,
    processor,
    deepgram
  });

  processor.setEmitters({
    overlay: hub.emitOverlay,
    debrief: hub.emitDebrief,
    error: hub.emitError,
    tool: hub.emitTool,
    vision: hub.emitVision
  });

  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`Server listening on :${config.port}`);
}

function buildWsTestPage(wsPath: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Context Lens WS Tester</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; }
    input, textarea, button { font-size: 14px; }
    textarea { width: 100%; height: 160px; }
    pre { background: #f6f6f6; padding: 12px; height: 260px; overflow: auto; }
    .row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .row > * { flex: 1; min-width: 180px; }
  </style>
</head>
<body>
  <h1>Context Lens WS Tester</h1>
  <div class="row">
    <input id="wsUrl" placeholder="ws://localhost:8080/ws" />
    <input id="sessionId" placeholder="sessionId (optional)" />
    <button id="connect">Connect</button>
    <button id="disconnect">Disconnect</button>
  </div>
  <textarea id="payload">{\"type\":\"start_session\",\"saveMode\":\"none\",\"sttMode\":\"mock\",\"language\":\"en\"}</textarea>
  <div class="row">
    <button id="send">Send JSON</button>
    <button id="sampleChunk">Send transcript_chunk</button>
    <button id="sendVision">Send vision_frame</button>
    <button id="endSession">Send end_session</button>
  </div>
  <div class="row">
    <input id="visionFile" type="file" accept="image/png,image/jpeg" />
  </div>
  <pre id="log"></pre>
  <script>
    const log = (line) => {
      const el = document.getElementById('log');
      el.textContent += line + '\\n';
      el.scrollTop = el.scrollHeight;
    };
    const wsInput = document.getElementById('wsUrl');
    const sessionInput = document.getElementById('sessionId');
    wsInput.value = wsInput.value || \`ws://\${location.host}${wsPath}\`;
    let ws;
    document.getElementById('connect').onclick = () => {
      if (ws && ws.readyState === 1) return;
      ws = new WebSocket(wsInput.value);
      ws.onopen = () => log('connected');
      ws.onclose = () => log('closed');
      ws.onerror = (e) => log('error: ' + e);
      ws.onmessage = (evt) => log('<< ' + evt.data);
    };
    document.getElementById('disconnect').onclick = () => {
      if (ws) ws.close();
    };
    document.getElementById('send').onclick = () => {
      if (!ws || ws.readyState !== 1) return log('not connected');
      ws.send(document.getElementById('payload').value);
    };
    document.getElementById('sampleChunk').onclick = () => {
      if (!ws || ws.readyState !== 1) return log('not connected');
      const sessionId = sessionInput.value || 'demo-session';
      const message = {
        type: 'transcript_chunk',
        sessionId,
        text: 'Quick test chunk for summaries.',
        t0_ms: 0,
        t1_ms: 1200,
        speaker: 'user'
      };
      ws.send(JSON.stringify(message));
    };
    document.getElementById('sendVision').onclick = async () => {
      if (!ws || ws.readyState !== 1) return log('not connected');
      const fileInput = document.getElementById('visionFile');
      const file = fileInput.files && fileInput.files[0];
      if (!file) return log('select an image first');
      const sessionId = sessionInput.value || 'demo-session';
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const image_base64 = btoa(binary);
      const mime = file.type || 'image/jpeg';
      ws.send(JSON.stringify({
        type: 'vision_frame',
        sessionId,
        image_base64,
        mime,
        t_ms: Date.now()
      }));
    };
    document.getElementById('endSession').onclick = () => {
      if (!ws || ws.readyState !== 1) return log('not connected');
      const sessionId = sessionInput.value || 'demo-session';
      ws.send(JSON.stringify({ type: 'end_session', sessionId }));
    };
  </script>
</body>
</html>`;
}

function buildDashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Context Lens Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 28px; background: #f6f8fb; color: #111; }
    .container { max-width: 980px; margin: 0 auto; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .topic { font-size: 34px; font-weight: 700; margin: 12px 0; }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip { background: #111; color: #fff; padding: 6px 10px; border-radius: 999px; font-size: 12px; }
    .bar { height: 10px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
    .bar > div { height: 100%; background: #10b981; width: 0%; transition: width 0.4s ease; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 16px; }
    .card { background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08); }
    .card h3 { margin: 0 0 8px; font-size: 16px; }
    .meta { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .panel { background: #fff; padding: 14px; border-radius: 12px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08); }
    .transcript { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; white-space: pre-line; }
    .env { font-size: 13px; }
    .muted { color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Context Lens</h1>
      <div class="muted" id="updated">--</div>
    </div>
    <div class="topic" id="topic">Waiting for session...</div>
    <div class="chips" id="chips"></div>
    <div class="bar"><div id="confidence"></div></div>
    <div class="cards" id="cards"></div>
    <div class="meta">
      <div class="panel">
        <div class="muted">Transcript tail</div>
        <div class="transcript" id="transcript"></div>
      </div>
      <div class="panel">
        <div class="muted">Environment snapshot</div>
        <div class="env" id="env">No vision data.</div>
      </div>
    </div>
    <div class="panel" style="margin-top: 16px;">
      <div class="muted">Uncertainty notes</div>
      <div id="uncertainty"></div>
    </div>
  </div>
  <script>
    const render = (data) => {
      document.getElementById('topic').textContent = data.topic_line || '—';
      document.getElementById('updated').textContent = 'Updated ' + new Date(data.updatedAt || Date.now()).toLocaleTimeString();
      const chips = document.getElementById('chips');
      chips.innerHTML = '';
      (data.intent_tags || []).forEach(tag => {
        const el = document.createElement('span');
        el.className = 'chip';
        el.textContent = tag;
        chips.appendChild(el);
      });
      const bar = document.getElementById('confidence');
      bar.style.width = Math.round((data.confidence || 0) * 100) + '%';
      const cards = document.getElementById('cards');
      cards.innerHTML = '';
      (data.cards || []).slice(0,2).forEach(card => {
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = '<h3>' + card.title + '</h3><div>' + card.body + '</div>';
        cards.appendChild(el);
      });
      document.getElementById('transcript').textContent = (data.transcript_tail || []).join('\\n');
      const env = document.getElementById('env');
      if (data.env && data.env.label) {
        env.textContent = data.env.label + ' (' + Math.round((data.env.confidence || 0) * 100) + '%)';
      } else {
        env.textContent = 'No vision data.';
      }
      document.getElementById('uncertainty').textContent = (data.uncertainty_notes || []).join(' • ') || '—';
    };
    const poll = async () => {
      try {
        const res = await fetch('/display.json');
        const data = await res.json();
        render(data);
      } catch (err) {}
    };
    poll();
    setInterval(poll, 800);
  </script>
</body>
</html>`;
}

boot().catch((error) => {
  console.error('Fatal boot error', error);
  process.exit(1);
});
