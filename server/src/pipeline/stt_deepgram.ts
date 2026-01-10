import { createClient, DeepgramClient } from '@deepgram/sdk';

type TranscriptCallback = (chunk: {
  text: string;
  t0_ms: number;
  t1_ms: number;
  speaker?: string;
}) => void;

export class DeepgramTranscriber {
  private readonly client?: DeepgramClient;

  constructor(apiKey: string) {
    if (apiKey) {
      this.client = createClient(apiKey);
    }
  }

  isReady(): boolean {
    return Boolean(this.client);
  }

  async transcribeAudioStream(_stream: NodeJS.ReadableStream, _onChunk: TranscriptCallback) {
    if (!this.client) {
      throw new Error('Deepgram client not configured');
    }
    throw new Error('Streaming STT not implemented in MVP');
  }
}
