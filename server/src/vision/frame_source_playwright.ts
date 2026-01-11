import { chromium, Browser, Page } from 'playwright';
import { FrameCaptureServer } from '../server.js';
import type { FrameSource } from './frame_source.js';

export class PlaywrightFrameSource implements FrameSource {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private server: FrameCaptureServer;
  private timeoutMs: number;

  constructor(timeoutMs = 5000) {
    this.server = new FrameCaptureServer();
    this.timeoutMs = timeoutMs;
  }

  async start(): Promise<void> {
    await this.server.start(0);
    const baseUrl = this.server.getBaseUrl();
    this.browser = await chromium.launch({
      headless: false,
      args: ['--use-fake-ui-for-media-stream']
    });
    const context = await this.browser.newContext({ permissions: ['camera'] });
    this.page = await context.newPage();
    this.page.on('console', (msg) => {
      console.log('[capture]', msg.text());
    });
    await this.page.goto(`${baseUrl}/capture.html`, { waitUntil: 'domcontentloaded' });
    try {
      await this.page.waitForFunction(() => (window as any).__captureReady === true, {
        timeout: this.timeoutMs
      });
    } catch {
      console.warn('Camera not ready; check OS permissions for camera access.');
    }
  }

  async stop(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    await this.server.stop();
  }

  async captureJpegBuffer(): Promise<Buffer> {
    if (!this.page) {
      throw new Error('Playwright page not initialized');
    }
    const ok = await this.page.evaluate(() => (window as any).captureAndSend());
    if (!ok) {
      throw new Error('capture_not_ready');
    }
    const frame = await this.server.waitForFrame(this.timeoutMs);
    return Buffer.from(frame.image_base64, 'base64');
  }
}
