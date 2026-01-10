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
            results: { type: 'object' }
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
      tool: () => {}
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
    tool: hub.emitTool
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
    <button id="endSession">Send end_session</button>
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
    document.getElementById('endSession').onclick = () => {
      if (!ws || ws.readyState !== 1) return log('not connected');
      const sessionId = sessionInput.value || 'demo-session';
      ws.send(JSON.stringify({ type: 'end_session', sessionId }));
    };
  </script>
</body>
</html>`;
}

boot().catch((error) => {
  console.error('Fatal boot error', error);
  process.exit(1);
});
