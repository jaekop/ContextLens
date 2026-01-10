import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

export type TranscriptCallback = (chunk: {
  text: string;
  t0_ms?: number;
  t1_ms?: number;
  speaker?: string;
}) => void;

export type SttStreamHandle = {
  sendAudio: (pcm16Base64: string, sampleRate: number) => void;
  stop: () => void;
};

export class DeepgramAdapter {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isReady(): boolean {
    return Boolean(this.apiKey);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'missing_api_key' };
    }
    try {
      const response = await fetch('https://api.deepgram.com/v1/projects', {
        headers: {
          Authorization: `Token ${this.apiKey}`
        }
      });
      if (!response.ok) {
        return { ok: false, error: `status_${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'unknown_error' };
    }
  }

  startStream(language: string | undefined, onTranscript: TranscriptCallback): SttStreamHandle {
    if (!this.apiKey) {
      throw new Error('Deepgram API key missing');
    }

    const client = createClient(this.apiKey);
    const connection = client.listen.live({
      model: 'nova-2',
      language: language ?? 'en-US',
      encoding: 'linear16',
      sample_rate: 16000,
      smart_format: true,
      interim_results: false,
      endpointing: 400
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const alt = data.channel?.alternatives?.[0];
      const text = alt?.transcript?.trim();
      if (!text) return;
      const start = data.start ?? 0;
      const duration = data.duration ?? 0;
      onTranscript({
        text,
        t0_ms: Math.max(0, Math.round(start * 1000)),
        t1_ms: Math.max(0, Math.round((start + duration) * 1000))
      });
    });

    connection.on(LiveTranscriptionEvents.Error, (error) => {
      console.warn('Deepgram error', error);
    });

    const sendAudio = (pcm16Base64: string) => {
      const buffer = Buffer.from(pcm16Base64, 'base64');
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
      connection.send(arrayBuffer);
    };

    const stop = () => {
      connection.finish();
    };

    return { sendAudio, stop };
  }
}
