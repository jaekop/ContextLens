import 'dotenv/config';
import { VisionService } from './vision.service.js';

const mode = (process.env.VISION_MODE ?? 'mock') as 'mock' | 'gemini';
const intervalMs = Number(process.env.VISION_INTERVAL_MS ?? 3000);
const service = new VisionService({
  mode,
  intervalMs,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-1.5-flash',
  captureTimeoutMs: 5000
});

service.on('snapshot', (snap) => {
  console.log('snapshot', snap);
});

async function run() {
  await service.start();
  setTimeout(async () => {
    await service.stop();
    process.exit(0);
  }, 20000);
}

run().catch((error) => {
  console.error('Vision test failed', error);
  process.exit(1);
});
