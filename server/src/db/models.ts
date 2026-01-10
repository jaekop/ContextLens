import mongoose, { Schema } from 'mongoose';

const TranscriptChunkSchema = new Schema(
  {
    text: { type: String, required: true },
    t0_ms: { type: Number, required: true },
    t1_ms: { type: Number, required: true },
    speaker: { type: String },
    receivedAt: { type: Date }
  },
  { _id: false }
);

const OverlaySchema = new Schema(
  {
    topic_line: { type: String, required: true },
    intent_tags: { type: [String], required: true },
    confidence: { type: Number, required: true },
    uncertainty_notes: { type: [String], default: [] },
    last_updated_ms: { type: Number, required: true }
  },
  { _id: false }
);

const DebriefSchema = new Schema(
  {
    bullets: { type: [String], default: [] },
    suggestions: { type: [String], default: [] },
    uncertainty_notes: { type: [String], default: [] }
  },
  { _id: false }
);

const SessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    userId: { type: String },
    language: { type: String },
    saveMode: { type: String, required: true },
    transcript: { type: [TranscriptChunkSchema], default: [] },
    overlays: { type: [OverlaySchema], default: [] },
    debrief: { type: DebriefSchema }
  },
  { timestamps: true }
);

SessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const SessionModel =
  mongoose.models.Session ?? mongoose.model('Session', SessionSchema);
