import crypto from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import type { Session, SessionStore } from "./types.js";

const LOCK_TTL_MS = 30000;
const LOCK_WAIT_MS = 30000;
const LOCK_RETRY_MS = 50;
const RELEASE_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const EXTEND_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const CLAIM_MESSAGE = "local value = redis.call('get', KEYS[1]); if not value then redis.call('set', KEYS[1], 'processing', 'EX', ARGV[1]); return 1 elseif value == 'processing' then redis.call('expire', KEYS[1], ARGV[1]); return 1 else return 0 end";

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
    return await this.client.eval(CLAIM_MESSAGE, { keys: [`message:${messageId}`], arguments: ["86400"] }) === 1;
  }

  async completeMessage(messageId: string): Promise<void> {
    await this.client.set(`message:${messageId}`, "done", { EX: 86400 });
  }

  async withPhoneLock<T>(phone: string, work: () => Promise<T>): Promise<T> {
    const key = `lock:${phone}`;
    const token = crypto.randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (await this.client.set(key, token, { PX: LOCK_TTL_MS, NX: true }) !== "OK") {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for phone lock: ${phone}`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS)));
    }
    const renewal = setInterval(() => {
      void this.client.eval(EXTEND_LOCK, { keys: [key], arguments: [token, String(LOCK_TTL_MS)] }).catch((error) => console.error("Phone lock renewal failed", { phone, error }));
    }, LOCK_TTL_MS / 3);
    renewal.unref();
    try {
      return await work();
    } finally {
      clearInterval(renewal);
      await this.client.eval(RELEASE_LOCK, { keys: [key], arguments: [token] });
    }
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
  private readonly messages = new Map<string, "processing" | "done">();
  private readonly locks = new Map<string, Promise<void>>();

  async get(phone: string): Promise<Session | null> { const session = this.sessions.get(phone); return session ? decodeSession(encodeSession(session)) : null; }
  async set(session: Session): Promise<void> { this.sessions.set(session.phone, decodeSession(encodeSession(session))); }
  async delete(phone: string): Promise<void> { this.sessions.delete(phone); }
  async claimMessage(id: string): Promise<boolean> {
    if (this.messages.get(id) === "done") return false;
    this.messages.set(id, "processing");
    return true;
  }
  async completeMessage(id: string): Promise<void> { this.messages.set(id, "done"); }
  async withPhoneLock<T>(phone: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(phone) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.locks.set(phone, tail);
    await previous;
    try { return await work(); }
    finally {
      release();
      if (this.locks.get(phone) === tail) this.locks.delete(phone);
    }
  }
  async close(): Promise<void> {}
}
