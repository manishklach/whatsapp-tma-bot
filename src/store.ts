import { createClient, type RedisClientType } from "redis";
import type { Session, SessionStore } from "./types.js";

function encodeSession(session: Session): string {
  return JSON.stringify(session, function (this: Record<string, unknown>, key, value) {
    const original = key ? this[key] : value;
    return Buffer.isBuffer(original) ? { __type: "Buffer", base64: original.toString("base64") } : value;
  });
}

function decodeSession(raw: string): Session {
  return JSON.parse(raw, (_key, value) => value?.__type === "Buffer" ? Buffer.from(value.base64, "base64") : value) as Session;
}

export class RedisSessionStore implements SessionStore {
  constructor(private readonly client: RedisClientType, private readonly ttlSeconds: number) {}

  async get(phone: string): Promise<Session | null> {
    const raw = await this.client.get(`session:${phone}`);
    return raw ? decodeSession(raw) : null;
  }

  async set(session: Session): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await this.client.set(`session:${session.phone}`, encodeSession(session), { EX: this.ttlSeconds });
  }

  async delete(phone: string): Promise<void> {
    await this.client.del(`session:${phone}`);
  }

  async claimMessage(messageId: string): Promise<boolean> {
    const result = await this.client.set(`message:${messageId}`, "1", { EX: 86400, NX: true });
    return result === "OK";
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export async function connectRedisStore(url: string, ttlSeconds: number): Promise<RedisSessionStore> {
  const client = createClient({ url });
  client.on("error", (error) => console.error("Redis error", error));
  await client.connect();
  return new RedisSessionStore(client as RedisClientType, ttlSeconds);
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Set<string>();

  async get(phone: string): Promise<Session | null> { const session = this.sessions.get(phone); return session ? decodeSession(encodeSession(session)) : null; }
  async set(session: Session): Promise<void> { this.sessions.set(session.phone, decodeSession(encodeSession(session))); }
  async delete(phone: string): Promise<void> { this.sessions.delete(phone); }
  async claimMessage(id: string): Promise<boolean> {
    if (this.messages.has(id)) return false;
    this.messages.add(id);
    return true;
  }
  async close(): Promise<void> {}
}
