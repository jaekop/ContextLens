import 'dotenv/config';
import Fastify from 'fastify';
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

  const mongo = await MongoStore.connect(config.mongoUri).catch((error) => {
    fastify.log.warn({ error }, 'Mongo connection failed');
    return null;
  });

  const store = new SessionStore();

  fastify.get('/health', async () => ({ ok: true }));
  fastify.get('/status', async () => ({
    ok: true,
    sessions: store.list().length
  }));
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

boot().catch((error) => {
  console.error('Fatal boot error', error);
  process.exit(1);
});
