import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  WS_PATH: z.string().default('/ws'),
  MONGO_URI: z.string().default('mongodb://localhost:27017/contextlens'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-1.5-pro'),
  DEEPGRAM_API_KEY: z.string().optional().default(''),
  STT_MODE: z.enum(['mock', 'deepgram']).default('mock'),
  SAVE_DEFAULT: z.enum(['none', 'mongo']).default('none'),
  SUMMARY_INTERVAL_MS: z.coerce.number().default(5000),
  SUMMARY_CHARS: z.coerce.number().default(600),
  MAX_ROLLING_CHARS: z.coerce.number().default(2000),
  MAX_DEBRIEF_CHARS: z.coerce.number().default(6000),
  ANALYTICS_PATH: z.string().default('./analytics_out/metrics.jsonl')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.format());
  throw new Error('Invalid environment');
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  wsPath: env.WS_PATH,
  mongoUri: env.MONGO_URI,
  geminiApiKey: env.GEMINI_API_KEY,
  geminiModel: env.GEMINI_MODEL,
  deepgramApiKey: env.DEEPGRAM_API_KEY,
  sttMode: env.STT_MODE,
  saveDefault: env.SAVE_DEFAULT,
  summaryIntervalMs: env.SUMMARY_INTERVAL_MS,
  summaryChars: env.SUMMARY_CHARS,
  maxRollingChars: env.MAX_ROLLING_CHARS,
  maxDebriefChars: env.MAX_DEBRIEF_CHARS,
  analyticsPath: env.ANALYTICS_PATH
};
