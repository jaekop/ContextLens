import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  WS_PATH: z.string().default('/ws'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),
  DEEPGRAM_API_KEY: z.string().optional().default(''),
  MONGO_URI: z.string().optional().default(''),
  SNOWFLAKE_ACCOUNT: z.string().optional().default(''),
  SNOWFLAKE_USER: z.string().optional().default(''),
  SNOWFLAKE_PASSWORD: z.string().optional().default(''),
  SNOWFLAKE_DATABASE: z.string().optional().default(''),
  SNOWFLAKE_SCHEMA: z.string().optional().default(''),
  SNOWFLAKE_WAREHOUSE: z.string().optional().default(''),
  STT_DEFAULT: z.enum(['mock', 'deepgram']).default('mock'),
  ANALYTICS_DEFAULT: z.enum(['mock', 'snowflake']).default('mock'),
  SUMMARY_INTERVAL_MS: z.coerce.number().default(1500),
  SUMMARY_CHARS: z.coerce.number().default(500),
  VISION_INTERVAL_MS: z.coerce.number().default(2000),
  MAX_ROLLING_CHARS: z.coerce.number().default(2000),
  MAX_DEBRIEF_CHARS: z.coerce.number().default(8000),
  ANALYTICS_PATH: z.string().default('./analytics/out.jsonl')
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
  geminiApiKey: env.GEMINI_API_KEY,
  geminiModel: env.GEMINI_MODEL,
  deepgramApiKey: env.DEEPGRAM_API_KEY,
  mongoUri: env.MONGO_URI,
  snowflake: {
    account: env.SNOWFLAKE_ACCOUNT,
    user: env.SNOWFLAKE_USER,
    password: env.SNOWFLAKE_PASSWORD,
    database: env.SNOWFLAKE_DATABASE,
    schema: env.SNOWFLAKE_SCHEMA,
    warehouse: env.SNOWFLAKE_WAREHOUSE
  },
  sttDefault: env.STT_DEFAULT,
  analyticsDefault: env.ANALYTICS_DEFAULT,
  summaryIntervalMs: env.SUMMARY_INTERVAL_MS,
  summaryChars: env.SUMMARY_CHARS,
  visionIntervalMs: env.VISION_INTERVAL_MS,
  maxRollingChars: env.MAX_ROLLING_CHARS,
  maxDebriefChars: env.MAX_DEBRIEF_CHARS,
  analyticsPath: env.ANALYTICS_PATH
};
