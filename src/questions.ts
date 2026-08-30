import type { Answer, IncomingMessage, Session } from "./types.js";

type QuestionKind = "text" | "email" | "phone" | "choice" | "date" | "boolean" | "image" | "document";

export type Question = {
  id: string;
  prompt: string;
  kind: QuestionKind;
  choices?: string[];
  optional?: boolean;
  when?: (answers: Record<string, Answer>) => boolean;
};

export const questions: Question[] = [
  { id: "consent", kind: "choice", choices: ["START"], prompt: "Reply START to consent and begin." },
  { id: "applicationFiledAs", kind: "choice", choices: ["Individual", "Startup", "Small Enterprise", "Other"], prompt: "How is the application being filed?\n1. Individual\n2. Startup\n3. Small Enterprise\n4. Other" },
  { id: "applicantName", kind: "text", prompt: "Applicant's full legal name?" },
  { id: "applicantAddress", kind: "text", prompt: "Applicant's complete address?" },
  { id: "country", kind: "text", prompt: "Applicant's country?" },
  { id: "jurisdiction", kind: "text", prompt: "Trademark Registry jurisdiction (for example, DELHI)?" },
  { id: "serviceAddress", kind: "text", prompt: "Address for service? Reply SAME to reuse the applicant address." },
  { id: "mobile", kind: "phone", prompt: "Applicant's mobile number, including country code?" },
  { id: "email", kind: "email", prompt: "Applicant's email address?" },
  { id: "applicantNature", kind: "choice", choices: ["Individual", "Single Firm", "Partnership", "LLP", "Company", "Trust/Society", "Other"], prompt: "Nature of applicant?\n1. Individual\n2. Single Firm\n3. Partnership\n4. LLP\n5. Company\n6. Trust/Society\n7. Other" },
  { id: "legalStatus", kind: "text", prompt: "Applicant's legal status (for example, Proprietor or Private Limited Company)?" },
  { id: "hasAgent", kind: "boolean", prompt: "Is an agent representing the applicant? Reply YES or NO." },
  { id: "agentName", kind: "text", prompt: "Agent's full name?", when: (a) => a.hasAgent === true },
  { id: "agentAddress", kind: "text", prompt: "Agent's complete address?", when: (a) => a.hasAgent === true },
  { id: "agentNature", kind: "choice", choices: ["Advocate", "Registered Trade Marks Agent", "Constituted Attorney", "Other"], prompt: "Nature of agent?\n1. Advocate\n2. Registered Trade Marks Agent\n3. Constituted Attorney\n4. Other", when: (a) => a.hasAgent === true },
  { id: "agentRegistrationNo", kind: "text", prompt: "Agent registration number? Reply SKIP if not applicable.", optional: true, when: (a) => a.hasAgent === true },
  { id: "markCategory", kind: "choice", choices: ["WORD", "DEVICE", "SHAPE OF GOODS", "SOUND", "OTHER"], prompt: "Category of mark?\n1. WORD\n2. DEVICE\n3. SHAPE OF GOODS\n4. SOUND\n5. OTHER" },
  { id: "tradeMark", kind: "text", prompt: "Trademark wording/name?" },
  { id: "markDescription", kind: "text", prompt: "Describe the mark, including stylization and device elements." },
  { id: "markImage", kind: "image", prompt: "Upload the trademark image as an image. Reply SKIP for a word mark.", optional: true },
  { id: "markLanguage", kind: "text", prompt: "Language of the mark? Reply English if it contains only English." },
  { id: "limitations", kind: "text", prompt: "Any conditions or limitations on use? Reply SKIP if none.", optional: true },
  { id: "classNumber", kind: "text", prompt: "Nice Classification class number (for example, 35)?" },
  { id: "goodsServices", kind: "text", prompt: "Full description of goods or services for this class?" },
  { id: "useStatement", kind: "choice", choices: ["Proposed to be used", "Used since"], prompt: "Statement as to use?\n1. Proposed to be used\n2. Used since" },
  { id: "useSinceDate", kind: "date", prompt: "Date of first use (DD-MM-YYYY)?", when: (a) => a.useStatement === "Used since" },
  { id: "otherStatement", kind: "text", prompt: "Any other important information or statement? Reply SKIP if none.", optional: true },
  { id: "verificationName", kind: "text", prompt: "Name of the person making the verification?" },
  { id: "verificationDate", kind: "date", prompt: "Verification date (DD-MM-YYYY)?" },
  { id: "enterpriseDocument", kind: "document", prompt: "Upload the Startup/Small Enterprise proof as a document. Reply SKIP if not applicable.", optional: true, when: (a) => a.applicationFiledAs === "Startup" || a.applicationFiledAs === "Small Enterprise" },
  { id: "poaDocument", kind: "document", prompt: "Upload the authorization document (POA). Reply SKIP if not applicable.", optional: true, when: (a) => a.hasAgent === true }
];

export function visibleQuestionIndexes(answers: Record<string, Answer>): number[] {
  return questions.flatMap((q, index) => (!q.when || q.when(answers) ? [index] : []));
}

export function nextVisibleIndex(current: number, answers: Record<string, Answer>): number | null {
  return visibleQuestionIndexes(answers).find((index) => index > current) ?? null;
}

export function previousVisibleIndex(current: number, answers: Record<string, Answer>): number | null {
  return visibleQuestionIndexes(answers).filter((index) => index < current).at(-1) ?? null;
}

export function normalizeAnswer(question: Question, message: IncomingMessage, media?: Answer): { value?: Answer; error?: string } {
  const raw = message.text?.trim();
  if (question.optional && raw?.toUpperCase() === "SKIP") return { value: "" };
  if (question.kind === "image" || question.kind === "document") {
    const expected = question.kind;
    if (message.type !== expected || !media) return { error: `Please upload a${expected === "image" ? "n image" : " document"}, or reply SKIP.` };
    return { value: media };
  }
  if (!raw) return { error: "Please send a text response." };
  if (question.id === "serviceAddress" && raw.toUpperCase() === "SAME") return { value: "__SAME__" };
  if (question.kind === "boolean") {
    if (/^(yes|y)$/i.test(raw)) return { value: true };
    if (/^(no|n)$/i.test(raw)) return { value: false };
    return { error: "Please reply YES or NO." };
  }
  if (question.kind === "choice") {
    const number = Number(raw);
    const selected = Number.isInteger(number) ? question.choices?.[number - 1] : question.choices?.find((choice) => choice.toLowerCase() === raw.toLowerCase());
    if (!selected) return { error: "Please reply with one of the listed numbers or option names." };
    return { value: selected };
  }
  if (question.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { error: "Please enter a valid email address." };
  if (question.kind === "phone" && !/^\+?[0-9][0-9\s-]{7,18}$/.test(raw)) return { error: "Please enter a valid phone number, preferably with country code." };
  if (question.kind === "date" && !/^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-\d{4}$/.test(raw)) return { error: "Please use DD-MM-YYYY." };
  if (raw.length > 4000) return { error: "That answer is too long (maximum 4,000 characters)." };
  return { value: raw };
}

export function promptFor(session: Session): string {
  const question = questions[session.cursor];
  if (!question) return "Reply CONFIRM to generate the PDF, EDIT to review answers, or CANCEL.";
  const visible = visibleQuestionIndexes(session.answers);
  const position = visible.indexOf(session.cursor) + 1;
  return `Question ${position}/${visible.length}\n${question.prompt}`;
}
