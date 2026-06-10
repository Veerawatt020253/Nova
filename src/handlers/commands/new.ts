import type { WebhookEvent } from "@line/bot-sdk";
import { prisma } from "../../db/client.js";
import { replyText, replyTextWithChoices } from "../../services/line.js";
import { saveSession, type SessionState, type WizardStep } from "../../services/session.js";

const QUESTIONS: Record<WizardStep, string> = {
  name: "ชื่อโครงงานคืออะไร?",
  problem: "ปัญหาที่โครงงานนี้แก้คืออะไร?",
  targetUser: "กลุ่มเป้าหมายคือใคร?",
  solution: "solution ทำงานอย่างไร? (อธิบายสั้นๆ)",
  techStack: "tech stack ที่ใช้คืออะไร?",
  competition: "กำลังเตรียมสำหรับการแข่งขันอะไร? (NSC / depa / TICTA / ข้ามได้)",
  deadline: "deadline submission คือวันที่เท่าไหร่? (เช่น 2026-06-30 หรือ 30/06/2026 / ข้ามได้)",
};

const STEP_ORDER: WizardStep[] = [
  "name",
  "problem",
  "targetUser",
  "solution",
  "techStack",
  "competition",
  "deadline",
];

// Steps where tappable quick-reply choices make sense
const STEP_CHOICES: Partial<Record<WizardStep, string[]>> = {
  competition: ["NSC", "depa", "TICTA", "ข้าม"],
  deadline: ["ข้าม"],
};

async function askStep(replyToken: string, step: WizardStep): Promise<void> {
  const choices = STEP_CHOICES[step];
  if (choices) {
    await replyTextWithChoices(replyToken, QUESTIONS[step], choices);
  } else {
    await replyText(replyToken, QUESTIONS[step]);
  }
}

function isSkip(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "ข้าม" || t === "skip" || t === "-";
}

export function parseDeadline(text: string): Date | null {
  const t = text.trim();
  // DD/MM/YYYY
  const thMatch = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (thMatch) {
    const [, d, m, y] = thMatch;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return isNaN(date.getTime()) ? null : date;
  }
  // ISO / anything Date can parse
  const date = new Date(t);
  return isNaN(date.getTime()) ? null : date;
}

/** Start the /new wizard. */
export async function handleNew(
  event: WebhookEvent & { type: "message" },
  userId: string,
  state: SessionState
): Promise<void> {
  state.state = "creating_project";
  state.step = "name";
  state.draft = {};
  await saveSession(userId, state);
  await askStep((event as any).replyToken, "name");
}

/** Handle an answer while the /new wizard is active. */
export async function handleWizardInput(
  replyToken: string,
  userId: string,
  state: SessionState,
  text: string
): Promise<void> {
  const step = state.step!;
  const draft = state.draft ?? {};

  switch (step) {
    case "name":
      draft.name = text;
      break;
    case "problem":
      draft.problem = text;
      break;
    case "targetUser":
      draft.targetUser = text;
      break;
    case "solution":
      draft.solution = text;
      break;
    case "techStack":
      draft.techStack = text;
      break;
    case "competition":
      draft.competitionTarget = isSkip(text) ? null : text;
      break;
    case "deadline": {
      if (isSkip(text)) {
        draft.submissionDeadline = null;
      } else {
        const parsed = parseDeadline(text);
        if (!parsed) {
          await replyTextWithChoices(
            replyToken,
            "อ่านวันที่ไม่ออก 😅 ลองพิมพ์รูปแบบ 2026-06-30 หรือ 30/06/2026 (หรือกดข้าม)",
            ["ข้าม"]
          );
          return; // stay on this step
        }
        draft.submissionDeadline = parsed.toISOString();
      }
      break;
    }
  }

  state.draft = draft;
  const nextIndex = STEP_ORDER.indexOf(step) + 1;

  if (nextIndex < STEP_ORDER.length) {
    state.step = STEP_ORDER[nextIndex];
    await saveSession(userId, state);
    await askStep(replyToken, state.step!);
    return;
  }

  // Wizard complete — create the project and set it active
  const project = await prisma.project.create({
    data: {
      userId,
      name: draft.name!,
      problem: draft.problem!,
      targetUser: draft.targetUser!,
      solution: draft.solution!,
      techStack: draft.techStack!,
      competitionTarget: draft.competitionTarget ?? null,
      submissionDeadline: draft.submissionDeadline ? new Date(draft.submissionDeadline) : null,
    },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { activeProjectId: project.id },
  });

  state.state = "idle";
  delete state.step;
  delete state.draft;
  state.history = []; // new active project → fresh conversation
  await saveSession(userId, state);

  await replyTextWithChoices(
    replyToken,
    `✅ สร้างโครงงาน "${project.name}" เรียบร้อย — เริ่มวิเคราะห์เลยไหม?`,
    ["/analyze", "/status"]
  );
}
