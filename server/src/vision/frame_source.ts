export interface FrameSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  captureJpegBuffer(): Promise<Buffer>;
}
