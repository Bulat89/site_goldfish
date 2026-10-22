/** A person who signed in with Yandex ID. */
export interface UserRecord {
  id: string;
  yandexId: string;
  login: string | null;
  email: string | null;
  name: string | null;
  /** Yandex avatar id; null when the user has none. */
  avatarId: string | null;
  createdAt: string;
  lastLoginAt: string;
  /** Goldfish device token issued through the site: only its id, the token is shown once. */
  tokenId: string | null;
  tokenIssuedAt: string | null;
  lastDownloadAt: string | null;
  /**
   * When the owner launched the agents (the last of the first steps in the cabinet) and they
   * began to study: until then the cabinet shows the whole list of first steps, with the CRM.
   */
  onboardedAt: string | null;
}

export interface YandexProfileInput {
  yandexId: string;
  login: string | null;
  email: string | null;
  name: string | null;
  avatarId: string | null;
}

export interface Store {
  /** Creates the user on first sign-in, refreshes the profile and last login otherwise. */
  upsertYandexUser(profile: YandexProfileInput): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  setToken(userId: string, tokenId: string): Promise<UserRecord>;
  markDownload(userId: string): Promise<void>;
  markOnboarded(userId: string): Promise<UserRecord>;

  /** Sessions are stored by the hash of the cookie value. */
  createSession(idHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** The session's user, or null when the session is unknown or expired. */
  sessionUser(idHash: string): Promise<UserRecord | null>;
  deleteSession(idHash: string): Promise<void>;
  deleteExpiredSessions(): Promise<number>;

  ping(): Promise<void>;
  close(): Promise<void>;
}
