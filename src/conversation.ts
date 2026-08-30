import { nextVisibleIndex, normalizeAnswer, previousVisibleIndex, promptFor, questions, visibleQuestionIndexes } from "./questions.js";
import type { Answer, IncomingMessage, MessagingClient, PdfProvider, Session, SessionStore } from "./types.js";

const INTRO = "Welcome to the TM-A intake assistant. I will collect the details shown in Form TM-A and generate a draft PDF. Your responses and uploads will be stored for up to 7 days. This is not legal advice.\n\nCommands at any time: BACK, SUMMARY, RESTART, CANCEL.";

const printable = (value: Answer): string => typeof value === "object" ? `[uploaded: ${value.filename || value.mimeType}]` : value === true ? "Yes" : value === false ? "No" : value || "Not provided";

function summary(session: Session): string {
  const lines = questions.filter((q) => q.id !== "consent" && (!q.when || q.when(session.answers)) && session.answers[q.id] !== undefined).map((q) => `${q.id}: ${printable(session.answers[q.id]!)}`);
  const text = `Your answers:\n${lines.join("\n")}`;
  return text.length > 3900 ? `${text.slice(0, 3850)}\n…(summary shortened)` : text;
}

function newSession(phone: string): Session {
  return { phone, cursor: 0, status: "collecting", answers: {}, updatedAt: new Date().toISOString() };
}

export class ConversationService {
  constructor(private readonly store: SessionStore, private readonly messaging: MessagingClient, private readonly pdf: PdfProvider) {}

  async handle(message: IncomingMessage): Promise<void> {
    if (!(await this.store.claimMessage(message.id))) return;
    const command = message.text?.trim().toUpperCase();
    let session = await this.store.get(message.from);

    if (command === "RESTART") {
      session = newSession(message.from);
      await this.store.set(session);
      await this.messaging.sendText(message.from, `${INTRO}\n\n${promptFor(session)}`);
      return;
    }
    if (!session) {
      session = newSession(message.from);
      if (command === "START") session.answers.consent = "START";
      if (command === "START") session.cursor = nextVisibleIndex(0, session.answers) ?? 0;
      await this.store.set(session);
      await this.messaging.sendText(message.from, `${INTRO}\n\n${promptFor(session)}`);
      return;
    }
    if (command === "CANCEL") {
      session.status = "cancelled";
      await this.store.set(session);
      await this.messaging.sendText(message.from, "This intake has been cancelled. Reply RESTART whenever you want to begin again.");
      return;
    }
    if (session.status === "cancelled" || session.status === "completed") {
      await this.messaging.sendText(message.from, "Reply RESTART to begin a new TM-A intake.");
      return;
    }
    if (command === "SUMMARY") {
      await this.messaging.sendText(message.from, `${summary(session)}\n\n${session.status === "reviewing" ? "Reply CONFIRM, EDIT, or CANCEL." : promptFor(session)}`);
      return;
    }
    if (session.status === "generating") {
      await this.messaging.sendText(message.from, "Your PDF is still being generated. I will send it here as soon as it is ready.");
      return;
    }
    if (session.status === "reviewing") {
      if (command === "EDIT") {
        session.status = "collecting";
        session.cursor = visibleQuestionIndexes(session.answers).find((i) => i > 0) ?? 1;
        await this.store.set(session);
        await this.messaging.sendText(message.from, `Let’s review each answer. Existing answers will be replaced.\n\n${promptFor(session)}`);
        return;
      }
      if (command === "CONFIRM") {
        session.status = "generating";
        await this.store.set(session);
        await this.messaging.sendText(message.from, "Thanks. Your PDF is being generated now.");
        try {
          const generated = await this.pdf.generate(session.answers);
          const safeMark = String(session.answers.tradeMark || "trademark").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40);
          await this.messaging.sendPdf(message.from, generated, `TM-A-${safeMark}.pdf`, "Your draft TM-A intake PDF. Please review it carefully before filing.");
          session.status = "completed";
          await this.store.set(session);
        } catch (error) {
          session.status = "reviewing";
          await this.store.set(session);
          console.error("PDF generation failed", error);
          await this.messaging.sendText(message.from, "I could not generate the PDF right now. Your answers are safe; reply CONFIRM to try again.");
        }
        return;
      }
      await this.messaging.sendText(message.from, "Please reply CONFIRM to generate the PDF, EDIT to review answers, or CANCEL.");
      return;
    }
    if (command === "BACK") {
      const previous = previousVisibleIndex(session.cursor, session.answers);
      if (previous === null) await this.messaging.sendText(message.from, `You are already at the first question.\n\n${promptFor(session)}`);
      else { session.cursor = previous; await this.store.set(session); await this.messaging.sendText(message.from, promptFor(session)); }
      return;
    }

    const question = questions[session.cursor];
    if (!question) return;
    let media: Answer | undefined;
    if ((question.kind === "image" || question.kind === "document") && message.mediaId) {
      try { media = await this.messaging.downloadMedia(message.mediaId, message.filename); }
      catch (error) { console.error("Media download failed", error); await this.messaging.sendText(message.from, "I could not download that file. Please try uploading it again (maximum 15 MB)."); return; }
    }
    const result = normalizeAnswer(question, message, media);
    if (result.error || result.value === undefined) {
      await this.messaging.sendText(message.from, `${result.error || "Invalid answer"}\n\n${promptFor(session)}`);
      return;
    }
    session.answers[question.id] = question.id === "serviceAddress" && result.value === "__SAME__" ? session.answers.applicantAddress! : result.value;
    for (const candidate of questions) {
      if (candidate.when && !candidate.when(session.answers)) delete session.answers[candidate.id];
    }
    const next = nextVisibleIndex(session.cursor, session.answers);
    if (next === null) {
      session.status = "reviewing";
      await this.store.set(session);
      await this.messaging.sendText(message.from, `${summary(session)}\n\nReply CONFIRM to generate the PDF, EDIT to review each answer, or CANCEL.`);
    } else {
      session.cursor = next;
      await this.store.set(session);
      await this.messaging.sendText(message.from, promptFor(session));
    }
  }
}
