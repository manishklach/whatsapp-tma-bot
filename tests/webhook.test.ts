import crypto from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

const queue = { enqueue: vi.fn(async () => {}) };
const app = createApp({ verifyToken: "verify-secret", appSecret: "app-secret", queue });

describe("WhatsApp webhook", () => {
  beforeEach(() => queue.enqueue.mockClear());

  it("verifies a subscription", async () => {
    const response = await request(app).get("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=1234");
    expect(response.status).toBe(200); expect(response.text).toBe("1234");
  });

  it("rejects an invalid signature", async () => {
    const response = await request(app).post("/webhooks/whatsapp").set("content-type", "application/json").set("x-hub-signature-256", "sha256=bad").send({ entry: [] });
    expect(response.status).toBe(401);
  });

  it("accepts a signed message", async () => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "m1", from: "1", type: "text", text: { body: "Hi" } }] } }] }] });
    const signature = `sha256=${crypto.createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    const response = await request(app).post("/webhooks/whatsapp").set("content-type", "application/json").set("x-hub-signature-256", signature).send(body);
    expect(response.status).toBe(200);
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", from: "1", text: "Hi" }));
  });

  it("returns 503 when durable enqueue fails so Meta can retry", async () => {
    const failingQueue = { enqueue: vi.fn(async () => { throw new Error("Redis unavailable"); }) };
    const failingApp = createApp({ verifyToken: "verify-secret", appSecret: "app-secret", queue: failingQueue });
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "m2", from: "1", type: "text", text: { body: "Hi" } }] } }] }] });
    const signature = `sha256=${crypto.createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await request(failingApp).post("/webhooks/whatsapp").set("content-type", "application/json").set("x-hub-signature-256", signature).send(body);
    expect(response.status).toBe(503);
    expect(failingQueue.enqueue).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });
});
