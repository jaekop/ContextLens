import mongoose from 'mongoose';
import { config } from '../config.js';
import { SessionModel } from './models.js';

let connected = false;

export async function connectMongo() {
  if (connected) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  connected = true;
  console.log('MongoDB connected');
}

export async function saveSessionRecord(record: {
  sessionId: string;
  userId?: string;
  language?: string;
  saveMode: string;
  transcript: unknown[];
  overlays: unknown[];
  debrief: unknown;
  createdAt: Date;
}) {
  if (!connected) {
    throw new Error('Mongo not connected');
  }
  return SessionModel.create(record);
}

export function isMongoReady() {
  return connected;
}
