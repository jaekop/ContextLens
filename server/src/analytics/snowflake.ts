import fs from 'fs/promises';
import path from 'path';

export type MetricsEvent = {
  sessionId_hash: string;
  duration_s: number;
  language: string;
  avg_confidence: number;
  intent_counts: Record<string, number>;
  latency_ms_p50: number;
  user_feedback?: string;
};

export type SnowflakeConfig = {
  account: string;
  user: string;
  password: string;
  database: string;
  schema: string;
  warehouse: string;
  mockOutputPath: string;
  mode: 'mock' | 'snowflake';
};

export class SnowflakeAdapter {
  private readonly config: SnowflakeConfig;

  constructor(config: SnowflakeConfig) {
    this.config = config;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (this.config.mode === 'mock') {
      return { ok: true, error: 'mock_mode' };
    }
    const { account, user, password, database, schema, warehouse } = this.config;
    if (!account || !user || !password || !database || !schema || !warehouse) {
      return { ok: false, error: 'missing_config' };
    }
    try {
      const response = await fetch(`https://${account}.snowflakecomputing.com/api/v2/statements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
        },
        body: JSON.stringify({
          statement: 'select 1',
          database,
          schema,
          warehouse,
          timeout: 30
        })
      });
      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `status_${response.status}:${text}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'unknown_error' };
    }
  }

  async send(event: MetricsEvent) {
    if (this.config.mode === 'mock') {
      await writeJsonl(event, this.config.mockOutputPath);
      return;
    }

    const { account, user, password, database, schema, warehouse } = this.config;
    if (!account || !user || !password || !database || !schema || !warehouse) {
      throw new Error('Snowflake config missing for real mode');
    }

    const endpoint = `https://${account}.snowflakecomputing.com/api/v2/statements`;
    const payloadJson = JSON.stringify(event).replace(/'/g, "''");
    const statement = `insert into CONTEXT_LENS_METRICS (payload, created_at) select parse_json('${payloadJson}'), current_timestamp()`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
      },
      body: JSON.stringify({
        statement,
        database,
        schema,
        warehouse,
        timeout: 60
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Snowflake request failed: ${response.status} ${text}`);
    }
  }
}

async function writeJsonl(event: MetricsEvent, outputPath: string) {
  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.appendFile(resolved, `${JSON.stringify(event)}\n`, 'utf8');
}
