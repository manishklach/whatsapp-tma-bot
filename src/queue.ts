import crypto from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { ConversationService } from "./conversation.js";
import type { IncomingMessage } from "./types.js";

const QUEUE_NAME = "whatsapp-incoming-messages";

export interface MessageQueue {
  enqueue(message: IncomingMessage): Promise<void>;
  close(): Promise<void>;
}

export class BullMessageQueue implements MessageQueue {
  private readonly connection: Redis;
  private readonly queue: Queue<IncomingMessage>;

  constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    this.connection.on("error", (error) => console.error("Queue Redis error", error));
    this.queue = new Queue<IncomingMessage>(QUEUE_NAME, { connection: this.connection });
  }

  async enqueue(message: IncomingMessage): Promise<void> {
    const jobId = crypto.createHash("sha256").update(message.id).digest("hex");
    await this.queue.add("process-message", message, {
      jobId,
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 86400, count: 10000 },
      removeOnFail: { age: 2592000, count: 10000 }
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}

export function createMessageWorker(redisUrl: string, conversation: ConversationService) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", (error) => console.error("Worker Redis error", error));
  const worker = new Worker<IncomingMessage>(QUEUE_NAME, (job) => conversation.handle(job.data), { connection, concurrency: 10 });
  worker.on("failed", (job, error) => console.error("Message job failed", { jobId: job?.id, messageId: job?.data.id, error }));
  worker.on("error", (error) => console.error("Message worker error", error));
  return {
    async close() {
      await worker.close();
      await connection.quit();
    }
  };
}
