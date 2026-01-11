export type VisionSnapshot = {
  ts_ms: number;
  env_label: string;
  env_confidence: number;
  objects?: string[];
  notes?: string[];
  frame_id?: string;
};

export type VisionMode = 'mock' | 'gemini';

export type VisionServiceConfig = {
  mode: VisionMode;
  intervalMs: number;
  geminiApiKey?: string;
  geminiModel?: string;
  captureTimeoutMs?: number;
};
