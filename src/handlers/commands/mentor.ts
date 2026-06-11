import { prisma } from "../../db/client.js";
import { replyText, replyTextWithChoices, showTyping, stripMarkdown } from "../../services/line.js";
import { chat, extractJson } from "../../services/llm.js";
import {
  appendHistory,
  clearFlow,
  saveSession,
  type SessionState,
} from "../../services/session.js";
import { MENTOR_FIRST_MESSAGE, buildMentorSystemPrompt } from "../../prompts/features.js";

interface MentorEnvelope {
  done?: boolean;
  reply?: string;
  options?: string[];
  draft?: {
    name?: string;
    problem?: string;
    targetUser?: string;
    solution?: string;
    techStack?: string;
  };
}

/** /mentor — AI Mentor Mode: Socratic step-by-step until a complete project. */
export async function handleMentor(
  replyToken: string,
  userId: string,
  state: SessionState
): Promise<void> {
  clearFlow(state);
  state.state = "mentoring";
  state.history = [];
  appendHistory(state, "assistant", MENTOR_FIRST_MESSAGE);
  await saveSession(userId, state);

  await replyTextWithChoices(replyToken, MENTOR_FIRST_MESSAGE, [
    "มีปัญหาในใจแล้ว",
    "ยังไม่มีไอเดียเลย",
  ]);
}

/** Message received while Mentor Mode is active. */
export async function handleMentorInput(
  replyToken: string,
  userId: string,
  state: SessionState,
  text: string
): Promise<void> {
  showTyping(userId);

  let raw: string;
  try {
    raw = await chat(buildMentorSystemPrompt(), state.history, text, { json: true });
  } catch (err) {
    console.error("Mentor LLM call failed:", err);
    return replyText(replyToken, "❌ ตอบไม่ได้ตอนนี้ พิมพ์อีกครั้งนะ (หรือ /help เพื่อออกจากโหมด)");
  }

  const parsed = extractJson<MentorEnvelope>(raw);
  const reply = stripMarkdown(
    parsed?.reply ??
      (raw.trimStart().startsWith("{")
        ? "ขอโทษที ระบบสะดุดนิดหน่อย 😅 พิมพ์ซ้ำอีกครั้งได้เลย"
        : raw)
  );

  appendHistory(state, "user", text);
  appendHistory(state, "assistant", reply);

  // Mentor concluded with a complete project draft → create it for real
  if (parsed?.done && parsed.draft?.name && parsed.draft.problem) {
    const d = parsed.draft;
    const project = await prisma.project.create({
      data: {
        userId,
        name: stripMarkdown(d.name!),
        problem: stripMarkdown(d.problem!),
        targetUser: stripMarkdown(d.targetUser ?? "-"),
        solution: stripMarkdown(d.solution ?? "-"),
        techStack: stripMarkdown(d.techStack ?? "-"),
      },
    });
    await prisma.user.update({ where: { id: userId }, data: { activeProjectId: project.id } });

    clearFlow(state);
    state.history = []; // new active project → fresh conversation
    await saveSession(userId, state);

    return replyTextWithChoices(
      replyToken,
      `${reply}\n\n✅ พี่สร้างโครงงาน "${project.name}" ให้เรียบร้อย ไปต่อกันเลย!`,
      ["/analyze", "/validate", "/roadmap"]
    );
  }

  await saveSession(userId, state);

  const options = (parsed?.options ?? []).filter(Boolean).map((o) => stripMarkdown(o));
  if (options.length >= 2) {
    return replyTextWithChoices(replyToken, reply, options);
  }
  return replyText(replyToken, reply);
}
