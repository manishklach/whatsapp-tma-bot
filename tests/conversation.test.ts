import { describe, expect, it } from "vitest";
import { ConversationService } from "../src/conversation.js";
import { LocalPdfProvider } from "../src/pdf.js";
import { MemorySessionStore } from "../src/store.js";
import type { MediaAnswer, MessagingClient } from "../src/types.js";

class FakeMessaging implements MessagingClient {
  texts: string[] = [];
  pdfs: Buffer[] = [];
  async sendText(_to: string, body: string) { this.texts.push(body); }
  async sendPdf(_to: string, pdf: Buffer) { this.pdfs.push(pdf); }
  async downloadMedia(mediaId: string): Promise<MediaAnswer> { return { mediaId, mimeType: "application/pdf", data: Buffer.from("file") }; }
}

describe("ConversationService", () => {
  it("preserves uploaded bytes while storing a session", async () => {
    const store = new MemorySessionStore();
    await store.set({ phone: "p", cursor: 1, status: "collecting", answers: { upload: { mediaId: "id", mimeType: "application/pdf", data: Buffer.from("hello") } }, updatedAt: new Date().toISOString() });
    const restored = (await store.get("p"))?.answers.upload as MediaAnswer;
    expect(Buffer.isBuffer(restored.data)).toBe(true);
    expect(restored.data.toString()).toBe("hello");
  });

  it("generates a readable PDF document", async () => {
    const pdf = await new LocalPdfProvider().generate({
      applicationFiledAs: "Small Enterprise",
      applicantName: "Example Applicant",
      tradeMark: "EXAMPLE",
      classNumber: "35",
      goodsServices: "Retail and online retail services relating to electronic accessories.",
      hasAgent: false,
      verificationDate: "30-08-2026"
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("starts a session and deduplicates messages", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    const message = { id: "m1", from: "15551234567", type: "text" as const, text: "hello" };
    await service.handle(message); await service.handle(message);
    expect(messaging.texts).toHaveLength(1);
    expect(messaging.texts[0]).toContain("Reply START");
  });

  it("accepts START as the first message and asks the first data question", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    await service.handle({ id: "m1", from: "15551234567", type: "text", text: "START" });
    expect(messaging.texts.at(-1)).toContain("How is the application being filed?");
    expect((await store.get("15551234567"))?.answers.consent).toBe("START");
  });

  it("validates choice input", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    await service.handle({ id: "m1", from: "p", type: "text", text: "START" });
    await service.handle({ id: "m2", from: "p", type: "text", text: "99" });
    expect(messaging.texts.at(-1)).toContain("listed numbers");
  });
});
