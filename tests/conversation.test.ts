import { describe, expect, it, vi } from "vitest";
import { ConversationService } from "../src/conversation.js";
import { LocalPdfProvider } from "../src/pdf.js";
import { questions, visibleQuestionIndexes } from "../src/questions.js";
import { MemorySessionStore } from "../src/store.js";
import type { Answer, MediaAnswer, MessagingClient, PdfProvider, Session } from "../src/types.js";

class FakeMessaging implements MessagingClient {
  texts: string[] = [];
  pdfs: Buffer[] = [];
  async sendText(_to: string, body: string) { this.texts.push(body); }
  async sendPdf(_to: string, pdf: Buffer) { this.pdfs.push(pdf); }
  async downloadMedia(mediaId: string): Promise<MediaAnswer> { return { mediaId, mimeType: "application/pdf", data: Buffer.from("file") }; }
}

const questionIndex = (id: string) => questions.findIndex((question) => question.id === id);
const session = (phone: string, cursor: number, answers: Record<string, Answer> = {}, status: Session["status"] = "collecting"): Session => ({ phone, cursor, answers, status, updatedAt: new Date().toISOString() });

describe("ConversationService", () => {
  it("preserves uploaded bytes while storing a session", async () => {
    const store = new MemorySessionStore();
    await store.set({ phone: "p", cursor: 1, status: "collecting", answers: { upload: { mediaId: "id", mimeType: "application/pdf", data: Buffer.from("hello") } }, updatedAt: new Date().toISOString() });
    const restored = (await store.get("p"))?.answers.upload as MediaAnswer;
    expect(Buffer.isBuffer(restored.data)).toBe(true);
    expect(restored.data.toString()).toBe("hello");
  });

  it("allows a processing message to retry but deduplicates it after completion", async () => {
    const store = new MemorySessionStore();
    expect(await store.claimMessage("job")).toBe(true);
    expect(await store.claimMessage("job")).toBe(true);
    await store.completeMessage("job");
    expect(await store.claimMessage("job")).toBe(false);
  });

  it("releases a phone lock when the protected work throws", async () => {
    const store = new MemorySessionStore();
    await expect(store.withPhoneLock("p", async () => { throw new Error("failed work"); })).rejects.toThrow("failed work");
    await expect(store.withPhoneLock("p", async () => "reacquired")).resolves.toBe("reacquired");
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

  it("serializes concurrent messages for the same phone", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    await Promise.all([
      service.handle({ id: "m1", from: "race", type: "text", text: "START" }),
      service.handle({ id: "m2", from: "race", type: "text", text: "3" })
    ]);
    const saved = await store.get("race");
    expect(saved?.answers).toMatchObject({ consent: "START", applicationFiledAs: "Small Enterprise" });
    expect(saved?.cursor).toBe(questionIndex("applicantName"));
  });

  it("moves BACK to the previous visible question", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    await store.set(session("back", questionIndex("applicantName"), { consent: "START", applicationFiledAs: "Individual" }));
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    await service.handle({ id: "back-1", from: "back", type: "text", text: "BACK" });
    expect((await store.get("back"))?.cursor).toBe(questionIndex("applicationFiledAs"));
    expect(messaging.texts.at(-1)).toContain("How is the application being filed?");
  });

  it("EDIT replays only applicable questions while preserving answers", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    const answers = { consent: "START", applicationFiledAs: "Individual", applicantName: "Existing Name", hasAgent: false };
    await store.set(session("edit", questionIndex("verificationDate"), answers, "reviewing"));
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    await service.handle({ id: "edit-1", from: "edit", type: "text", text: "EDIT" });
    const saved = await store.get("edit");
    expect(saved?.status).toBe("collecting");
    expect(saved?.cursor).toBe(questionIndex("applicationFiledAs"));
    expect(saved?.answers.applicantName).toBe("Existing Name");
    const visible = visibleQuestionIndexes(saved!.answers);
    expect(visible).not.toContain(questionIndex("agentName"));
    expect(visible).not.toContain(questionIndex("poaDocument"));
  });

  it("walks the agent chain and prunes all agent answers when EDIT changes hasAgent to false", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    await store.set(session("agent", questionIndex("hasAgent"), { consent: "START", applicationFiledAs: "Individual" }));

    await service.handle({ id: "agent-1", from: "agent", type: "text", text: "YES" });
    expect(messaging.texts.at(-1)).toContain("Agent's full name?");
    await service.handle({ id: "agent-2", from: "agent", type: "text", text: "Agent Name" });
    expect(messaging.texts.at(-1)).toContain("Agent's complete address?");
    await service.handle({ id: "agent-3", from: "agent", type: "text", text: "Agent Address" });
    expect(messaging.texts.at(-1)).toContain("Nature of agent?");
    await service.handle({ id: "agent-4", from: "agent", type: "text", text: "1" });
    expect(messaging.texts.at(-1)).toContain("Agent registration number?");
    await service.handle({ id: "agent-5", from: "agent", type: "text", text: "REG-1" });

    const beforePoa = (await store.get("agent"))!;
    beforePoa.cursor = questionIndex("verificationDate");
    await store.set(beforePoa);
    await service.handle({ id: "agent-6", from: "agent", type: "text", text: "30-08-2026" });
    expect(messaging.texts.at(-1)).toContain("authorization document (POA)");
    await service.handle({ id: "agent-7", from: "agent", type: "document", mediaId: "poa" });
    expect((await store.get("agent"))?.answers.poaDocument).toBeTruthy();

    await service.handle({ id: "agent-8", from: "agent", type: "text", text: "EDIT" });
    const editing = (await store.get("agent"))!;
    editing.cursor = questionIndex("hasAgent");
    await store.set(editing);
    await service.handle({ id: "agent-9", from: "agent", type: "text", text: "NO" });
    const pruned = (await store.get("agent"))!.answers;
    expect(pruned.hasAgent).toBe(false);
    for (const key of ["agentName", "agentAddress", "agentNature", "agentRegistrationNo", "poaDocument"]) expect(pruned[key]).toBeUndefined();
  });

  it.each(["Startup", "Small Enterprise"])("asks for enterprise proof for %s applications", async (applicationFiledAs) => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    await store.set(session(`enterprise-${applicationFiledAs}`, questionIndex("verificationDate"), { consent: "START", applicationFiledAs, hasAgent: false }));
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    await service.handle({ id: `enterprise-${applicationFiledAs}`, from: `enterprise-${applicationFiledAs}`, type: "text", text: "30-08-2026" });
    expect((await store.get(`enterprise-${applicationFiledAs}`))?.cursor).toBe(questionIndex("enterpriseDocument"));
    expect(messaging.texts.at(-1)).toContain("Startup/Small Enterprise proof");
  });

  it("copies applicantAddress when serviceAddress is SAME", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    await store.set(session("same", questionIndex("serviceAddress"), { applicantAddress: "123 Applicant Street" }));
    const service = new ConversationService(store, messaging, new LocalPdfProvider());
    await service.handle({ id: "same-1", from: "same", type: "text", text: "SAME" });
    expect((await store.get("same"))?.answers.serviceAddress).toBe("123 Applicant Street");
  });

  it("returns to reviewing after PDF failure and allows CONFIRM to retry", async () => {
    const store = new MemorySessionStore(); const messaging = new FakeMessaging();
    const pdf: PdfProvider = { generate: vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(Buffer.from("%PDF-retry")) };
    await store.set(session("retry", questionIndex("verificationDate"), { consent: "START", tradeMark: "RETRY" }, "reviewing"));
    const service = new ConversationService(store, messaging, pdf);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await service.handle({ id: "retry-1", from: "retry", type: "text", text: "CONFIRM" });
    expect((await store.get("retry"))?.status).toBe("reviewing");
    expect(messaging.texts.at(-1)).toContain("reply CONFIRM to try again");
    await service.handle({ id: "retry-2", from: "retry", type: "text", text: "CONFIRM" });
    expect((await store.get("retry"))?.status).toBe("completed");
    expect(messaging.pdfs).toHaveLength(1);
    expect(pdf.generate).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
  });
});
