import Fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import type { VisionSnapshot } from './vision/vision.types.js';

const FrameSchema = z.object({
  image_base64: z.string().min(1),
  mime: z.enum(['image/jpeg', 'image/png'])
});

type FramePayload = z.infer<typeof FrameSchema> & { ts_ms: number; id: string };

export class FrameCaptureServer extends EventEmitter {
  private server: FastifyInstance | null = null;
  private lastFrame: FramePayload | null = null;
  private lastSnapshot: VisionSnapshot | null = null;
  private counter = 0;
  private listeningPort: number | null = null;

  async start(port = 0) {
    if (this.server) return;
    const app = Fastify({ bodyLimit: 5 * 1024 * 1024 });

    app.post('/frame', async (request, reply) => {
      const parsed = FrameSchema.safeParse(request.body);
      if (!parsed.success) {
        console.warn('frame payload invalid');
        reply.code(400).send({ error: 'invalid_payload' });
        return;
      }
      const payload: FramePayload = {
        ...parsed.data,
        ts_ms: Date.now(),
        id: `${Date.now()}-${this.counter++}`
      };
      this.lastFrame = payload;
      this.emit('frame', payload);
      console.log('frame received', payload.image_base64.length);
      reply.send({ ok: true });
    });

    app.get('/frame', async (_, reply) => {
      if (!this.lastFrame) {
        reply.code(404).send({ error: 'no_frame' });
        return;
      }
      reply.send(this.lastFrame);
    });

    app.get('/vision', async (_, reply) => {
      if (!this.lastSnapshot) {
        reply.send({ error: 'no_snapshot' });
        return;
      }
      reply.send(this.lastSnapshot);
    });

    app.get('/capture.html', async (_, reply) => {
      const filePath = path.join(process.cwd(), 'public', 'capture.html');
      const html = await fs.readFile(filePath, 'utf8');
      reply.type('text/html').send(html);
    });

    await app.listen({ port, host: '127.0.0.1' });
    this.server = app;
    const addr = app.server.address();
    if (addr && typeof addr === 'object') {
      this.listeningPort = addr.port;
    }
  }

  async stop() {
    if (!this.server) return;
    await this.server.close();
    this.server = null;
    this.listeningPort = null;
  }

  getBaseUrl(): string {
    if (!this.listeningPort) {
      throw new Error('Capture server not started');
    }
    return `http://127.0.0.1:${this.listeningPort}`;
  }

  setLatestSnapshot(snapshot: VisionSnapshot) {
    this.lastSnapshot = snapshot;
  }

  waitForFrame(timeoutMs: number): Promise<FramePayload> {
    if (!this.server) {
      return Promise.reject(new Error('Capture server not started'));
    }
    const startId = this.lastFrame?.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('capture_timeout'));
      }, timeoutMs);

      const onFrame = (payload: FramePayload) => {
        if (payload.id === startId) return;
        cleanup();
        resolve(payload);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off('frame', onFrame);
      };

      this.on('frame', onFrame);
    });
  }
}
