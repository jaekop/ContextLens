import { EventEmitter } from 'events';
import { GeminiVisionClient } from './gemini.vision.js';
import { PlaywrightFrameSource } from './frame_source_playwright.js';
import type { VisionSnapshot, VisionServiceConfig } from './vision.types.js';

export class VisionService extends EventEmitter {
  private config: VisionServiceConfig;
  private latest: VisionSnapshot | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private frameSource: PlaywrightFrameSource | null = null;
  private gemini: GeminiVisionClient | null = null;
  private mockIndex = 0;
  private backoffUntil = 0;

  constructor(config: VisionServiceConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const interval = Math.max(1000, this.config.intervalMs);
    if (interval !== this.config.intervalMs) {
      console.warn('VISION_INTERVAL_MS capped to 1000ms minimum');
    }

    if (this.config.mode === 'gemini' && this.config.geminiApiKey) {
      this.gemini = new GeminiVisionClient(this.config.geminiApiKey, this.config.geminiModel ?? 'gemini-1.5-flash');
      if (!this.gemini.isReady()) {
        console.warn('Gemini not ready, switching to mock mode');
        this.config.mode = 'mock';
      }
    } else {
      this.config.mode = 'mock';
    }

    if (this.config.mode === 'gemini') {
      this.frameSource = new PlaywrightFrameSource(this.config.captureTimeoutMs ?? 5000);
      try {
        await this.frameSource.start();
      } catch (error) {
        console.warn('Frame source failed to start, switching to mock', error);
        this.config.mode = 'mock';
      }
    }

    const loop = async () => {
      if (!this.running) return;
      if (Date.now() < this.backoffUntil) {
        this.timer = setTimeout(loop, interval);
        return;
      }
      try {
        const snapshot = this.config.mode === 'mock'
          ? this.mockSnapshot()
          : await this.captureSnapshot();
        if (snapshot) {
          this.latest = snapshot;
          this.updateFramePreview(snapshot);
          this.emit('snapshot', snapshot);
        }
      } catch (error) {
        console.warn('VisionService tick failed', error);
        const backoffMs = extractBackoffMs(error);
        if (backoffMs) {
          this.backoffUntil = Date.now() + backoffMs;
        }
        const degraded = this.latest ?? this.fallbackSnapshot();
        this.latest = {
          ...degraded,
          ts_ms: Date.now(),
          notes: dedupeNotes([...(degraded.notes ?? []), 'vision_degraded']),
          reliability: {
            ...degraded.reliability,
            limitations: dedupeNotes([...(degraded.reliability.limitations ?? []), 'capture_error'])
          }
        };
        this.updateFramePreview(this.latest);
        this.emit('snapshot', this.latest);
      }
      this.timer = setTimeout(loop, interval);
    };

    this.timer = setTimeout(loop, 0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.frameSource) {
      await this.frameSource.stop();
      this.frameSource = null;
    }
  }

  getLatest(): VisionSnapshot | null {
    return this.latest;
  }

  private async captureSnapshot(): Promise<VisionSnapshot | null> {
    if (!this.frameSource || !this.gemini) return null;
    const buffer = await this.frameSource.captureJpegBuffer();
    const snapshot = await this.gemini.sendImage(buffer);
    return { ...snapshot, frame_id: snapshot.frame_id ?? `frame-${Date.now()}` };
  }

  private mockSnapshot(): VisionSnapshot {
    const envs = ['study room', 'classroom', 'office'];
    const objects = ['laptop', 'desk', 'whiteboard'];
    const env_label = envs[this.mockIndex % envs.length];
    const object = objects[this.mockIndex % objects.length];
    const env_confidence = seededConfidence(this.mockIndex);
    this.mockIndex += 1;
    return {
      ts_ms: Date.now(),
      environment: {
        label: env_label,
        confidence: env_confidence,
        objects: [object],
        lighting: {
          level: 'normal',
          source: 'indoor',
          confidence: 0.6
        },
        noise_or_busyness: {
          level: 'moderate',
          confidence: 0.5
        }
      },
      people: {
        count_estimate: this.mockIndex % 2,
        count_confidence: 0.4,
        proximity: 'medium',
        orientation_summary: 'mixed',
        confidence: 0.4
      },
      social_cues: {
        facial_expression_summary: {
          label: 'unknown',
          confidence: 0.2,
          notes: ['mock_mode']
        },
        body_posture_summary: {
          label: 'unknown',
          confidence: 0.2
        },
        gaze_summary: {
          label: 'unknown',
          confidence: 0.2
        },
        interaction_context: {
          label: 'unknown',
          confidence: 0.2
        }
      },
      reliability: {
        overall_confidence: 0.4,
        limitations: ['mock_mode']
      },
      notes: ['mock_mode']
    };
  }

  private fallbackSnapshot(): VisionSnapshot {
    return {
      ts_ms: Date.now(),
      environment: {
        label: 'unknown',
        confidence: 0.2,
        objects: [],
        lighting: {
          level: 'normal',
          confidence: 0.4
        }
      },
      people: {
        count_estimate: 0,
        count_confidence: 0.2,
        proximity: 'medium',
        confidence: 0.2
      },
      social_cues: {
        facial_expression_summary: {
          label: 'unknown',
          confidence: 0.2
        },
        body_posture_summary: {
          label: 'unknown',
          confidence: 0.2
        },
        gaze_summary: {
          label: 'unknown',
          confidence: 0.2
        },
        interaction_context: {
          label: 'unknown',
          confidence: 0.2
        }
      },
      reliability: {
        overall_confidence: 0.2,
        limitations: ['no_snapshot']
      },
      notes: ['no_snapshot']
    };
  }

  private updateFramePreview(snapshot: VisionSnapshot) {
    const source = this.frameSource as { setLatestSnapshot?: (snap: VisionSnapshot) => void } | null;
    if (source?.setLatestSnapshot) {
      source.setLatestSnapshot(snapshot);
    }
  }
}

function seededConfidence(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  const value = x - Math.floor(x);
  return Number((0.5 + value * 0.4).toFixed(2));
}

function dedupeNotes(notes: string[]): string[] {
  const set = new Set(notes);
  return Array.from(set).slice(0, 3);
}

function extractBackoffMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!message) return null;
  const retryMatch = message.match(/retryDelay\":\"(\d+)s\"/);
  if (retryMatch) {
    return Number(retryMatch[1]) * 1000;
  }
  if (message.includes('429') || message.includes('Too Many Requests')) {
    return 15000;
  }
  return null;
}
