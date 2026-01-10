import fs from 'fs/promises';
import path from 'path';

type MetricsEntry = {
  sessionId: string;
  duration: number;
  intent_counts: Record<string, number>;
  avg_confidence: number;
  language: string;
};

export async function writeMetrics(entry: MetricsEntry, outputPath: string) {
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  const line = JSON.stringify({ ...entry, recorded_at: new Date().toISOString() });
  await fs.appendFile(resolvedPath, `${line}\n`, 'utf8');
}
