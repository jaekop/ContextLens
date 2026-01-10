import 'dotenv/config';
import http from 'http';
import { config } from './config.js';
import { createWsHub } from './ws/hub.js';
import { GeminiClient } from './pipeline/llm_gemini.js';
import { SessionProcessor } from './pipeline/processor.js';
import { connectMongo } from './db/mongo.js';

async function boot() {
  try {
    await connectMongo();
  } catch (error) {
    console.warn('MongoDB connection failed; saveMode=mongo will be unavailable.', error);
  }

  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Context Lens server running');
  });

  const hub = createWsHub(server, config.wsPath);
  const gemini = new GeminiClient({
    apiKey: config.geminiApiKey,
    model: config.geminiModel
  });
  const processor = new SessionProcessor(gemini, {
    emitOverlay: hub.emitOverlay,
    emitDebrief: hub.emitDebrief,
    emitError: hub.emitError
  });
  hub.attachProcessor(processor);

  server.listen(config.port, () => {
    console.log(`HTTP server listening on :${config.port}`);
  });
}

boot().catch((error) => {
  console.error('Fatal boot error', error);
  process.exit(1);
});
