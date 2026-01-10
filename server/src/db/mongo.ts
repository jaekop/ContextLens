import { MongoClient, Db, Collection } from 'mongodb';

export type UserPrefs = {
  userId: string;
  language?: string;
  saveMode?: 'none' | 'mongo';
  updatedAt: Date;
};

export type SessionRecord = {
  sessionId: string;
  userId?: string;
  language?: string;
  saveMode: 'none' | 'mongo';
  transcript: unknown[];
  overlays: unknown[];
  vision?: unknown[];
  debrief: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export class MongoStore {
  private readonly client: MongoClient;
  private readonly db: Db;
  readonly users: Collection<UserPrefs>;
  readonly sessions: Collection<SessionRecord>;

  private constructor(client: MongoClient, db: Db) {
    this.client = client;
    this.db = db;
    this.users = db.collection<UserPrefs>('users');
    this.sessions = db.collection<SessionRecord>('sessions');
  }

  static async connect(uri: string): Promise<MongoStore | null> {
    if (!uri) return null;
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    const store = new MongoStore(client, db);
    await store.ensureIndexes();
    return store;
  }

  async ensureIndexes() {
    await this.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });
    await this.sessions.createIndex({ sessionId: 1 });
    await this.users.createIndex({ userId: 1 }, { unique: true });
  }

  async upsertUserPrefs(prefs: UserPrefs) {
    await this.users.updateOne(
      { userId: prefs.userId },
      { $set: { ...prefs, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async saveSession(record: SessionRecord) {
    await this.sessions.insertOne(record);
  }

  async ping(): Promise<{ ok: boolean }> {
    await this.db.command({ ping: 1 });
    return { ok: true };
  }

  async close() {
    await this.client.close();
  }
}
