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
    this.browser = await chromium.launch({ headless: false });
    const context = await this.browser.newContext({ permissions: ['camera'] });
    this.page = await context.newPage();
    await this.page.goto(`${baseUrl}/capture.html`, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(500);
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
    await this.page.evaluate(() => (window as any).captureAndSend());
    const frame = await this.server.waitForFrame(this.timeoutMs);
    return Buffer.from(frame.image_base64, 'base64');
  }
}
