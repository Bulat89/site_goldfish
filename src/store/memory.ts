import { newId } from '../util/crypto.js';
import type { Store, UserRecord, YandexProfileInput } from './types.js';

/** In-process store for development and tests: everything is lost on restart. */
export class MemoryStore implements Store {
  private readonly users = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, { userId: string; expiresAt: Date }>();

  async upsertYandexUser(p: YandexProfileInput): Promise<UserRecord> {
    const now = new Date().toISOString();
    const existing = [...this.users.values()].find((u) => u.yandexId === p.yandexId);
    const user: UserRecord = existing
      ? { ...existing, ...p, lastLoginAt: now }
      : {
          id: newId('usr'),
          ...p,
          createdAt: now,
          lastLoginAt: now,
          tokenId: null,
          tokenIssuedAt: null,
          lastDownloadAt: null,
          onboardedAt: null,
        };
    this.users.set(user.id, user);
    return { ...user };
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async setToken(userId: string, tokenId: string): Promise<UserRecord> {
    const user = this.users.get(userId);
    if (!user) throw new Error(`unknown user ${userId}`);
    const next = { ...user, tokenId, tokenIssuedAt: new Date().toISOString() };
    this.users.set(userId, next);
    return { ...next };
  }

  async markDownload(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) user.lastDownloadAt = new Date().toISOString();
  }

  async markOnboarded(userId: string): Promise<UserRecord> {
    const user = this.users.get(userId);
    if (!user) throw new Error(`unknown user ${userId}`);
    // The first launch counts: a later one does not move it.
    user.onboardedAt ??= new Date().toISOString();
    return { ...user };
  }

  async createSession(idHash: string, userId: string, expiresAt: Date): Promise<void> {
    this.sessions.set(idHash, { userId, expiresAt });
  }

  async sessionUser(idHash: string): Promise<UserRecord | null> {
    const s = this.sessions.get(idHash);
    if (!s || s.expiresAt.getTime() <= Date.now()) return null;
    return this.getUser(s.userId);
  }

  async deleteSession(idHash: string): Promise<void> {
    this.sessions.delete(idHash);
  }

  async deleteExpiredSessions(): Promise<number> {
    let n = 0;
    for (const [k, s] of this.sessions)
      if (s.expiresAt.getTime() <= Date.now()) {
        this.sessions.delete(k);
        n++;
      }
    return n;
  }

  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}
