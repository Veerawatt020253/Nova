import { prisma } from "../../db/client.js";
import {
  replyFlex,
  replyText,
  replyTextWithChoices,
  showTyping,
  stripMarkdown,
} from "../../services/line.js";
import { chat, extractJson } from "../../services/llm.js";
import { buildAskSystemPrompt } from "../../prompts/ask.js";
import {
  buildRichReplyFlex,
  flattenRichReply,
  type RichReply,
} from "../../services/flex.js";
import { appendHistory, saveSession, type SessionState } from "../../services/session.js";
import { ensureDisplayName, profileBlock, updateUserProfile } from "../../services/profile.js";

const UPDATABLE_FIELDS = ["name", "problem", "targetUser", "solution", "techStack"];

type ParsedReply =
  | { kind: "text"; text: string }
  | { kind: "flex"; rich: RichReply }
  | { kind: "question"; text: string; options: string[] }
  | { kind: "update"; field: string; value: string; reply: string };

interface AskEnvelope {
  format?: string;
  text?: string;
  title?: string;
  emoji?: string;
  sections?: RichReply["sections"];
  footer?: string;
  options?: string[];
  field?: string;
  value?: string;
  reply?: string;
}

/** Parse the JSON envelope from the LLM; fall back to plain text. */
function parseReply(raw: string): ParsedReply {
  const parsed = extractJson<AskEnvelope>(raw);
  if (parsed) {
    if (parsed.format === "flex" && parsed.title && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
      return {
        kind: "flex",
        rich: {
          title: parsed.title,
          emoji: parsed.emoji,
          sections: parsed.sections,
          footer: parsed.footer,
        },
      };
    }
    if (
      parsed.format === "question" &&
      parsed.text &&
      Array.isArray(parsed.options) &&
      parsed.options.filter(Boolean).length >= 2
    ) {
      return { kind: "question", text: parsed.text, options: parsed.options.filter(Boolean) };
    }
    if (
      parsed.format === "update" &&
      parsed.field &&
      UPDATABLE_FIELDS.includes(parsed.field) &&
      parsed.value
    ) {
      return {
        kind: "update",
        field: parsed.field,
        value: parsed.value,
        reply: parsed.reply ?? "ขอบันทึกข้อมูลนี้เข้าโปรเจกต์นะ",
      };
    }
    if (parsed.format === "text" && parsed.text) {
      return { kind: "text", text: parsed.text };
    }
    // Valid JSON but unknown shape — salvage any readable text field
    const salvage = parsed.text || parsed.reply || parsed.title;
    if (salvage) return { kind: "text", text: salvage };
  }

  // Not JSON at all → treat as a plain-text answer. But never dump raw JSON
  // syntax at the user if parsing failed on a JSON-looking blob.
  if (raw.trimStart().startsWith("{")) {
    return {
      kind: "text",
      text: "ขอโทษทีนะ ระบบสะดุดนิดหน่อย 😅 ถามใหม่อีกครั้งได้เลย",
    };
  }
  return { kind: "text", text: stripMarkdown(raw) };
}

/** Free text / Q&A — answer with active-project context. */
export async function handleAsk(
  replyToken: string,
  userId: string,
  state: SessionState,
  text: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      activeProject: {
        include: { milestones: { orderBy: { createdAt: "desc" }, take: 5 } },
      },
    },
  });
  const project = user?.activeProject ?? null;
  const milestones = project?.milestones ?? [];

  // Personalization: cache LINE display name + inject learned profile
  ensureDisplayName(userId, user?.displayName);
  const systemPrompt = buildAskSystemPrompt(
    project,
    milestones,
    profileBlock(user?.displayName, user?.profile)
  );

  showTyping(userId);

  let reply: ParsedReply;
  try {
    reply = parseReply(await chat(systemPrompt, state.history, text, { json: true }));
  } catch (err) {
    console.error("Q&A LLM call failed:", err);
    await replyText(replyToken, "❌ ตอบไม่ได้ตอนนี้ ลองอีกครั้งนะ");
    return;
  }

  // History keeps a plain-text rendering either way, so follow-ups have context
  const historyText =
    reply.kind === "flex"
      ? flattenRichReply(reply.rich)
      : reply.kind === "question"
        ? `${reply.text}\n(ตัวเลือก: ${reply.options.join(" / ")})`
        : reply.kind === "update"
          ? `${reply.reply}\n(เสนออัพเดท ${reply.field} เป็น: ${reply.value})`
          : reply.text;
  appendHistory(state, "user", text);
  appendHistory(state, "assistant", historyText);

  // Learn about the user from this exchange (background, never blocks)
  updateUserProfile(userId, text, historyText);

  // Project-update suggestion needs a confirmation round-trip
  if (reply.kind === "update" && project) {
    state.state = "confirming_update";
    state.pendingField = reply.field;
    state.pendingValue = reply.value;
    await saveSession(userId, state);
    await replyTextWithChoices(
      replyToken,
      `${stripMarkdown(reply.reply)}\n\n📝 จะอัพเดทเป็น:\n"${reply.value}"`,
      ["บันทึกเลย ✅", "ไม่ต้องบันทึก"]
    );
    return;
  }

  await saveSession(userId, state);

  try {
    if (reply.kind === "flex") {
      await replyFlex(replyToken, reply.rich.title.slice(0, 200), buildRichReplyFlex(reply.rich));
    } else if (reply.kind === "question") {
      await replyTextWithChoices(replyToken, stripMarkdown(reply.text), reply.options);
    } else if (reply.kind === "update") {
      // No active project to update — just answer with the reply text
      await replyText(replyToken, stripMarkdown(reply.reply));
    } else {
      await replyText(replyToken, stripMarkdown(reply.text));
    }
  } catch (err) {
    // Malformed flex/quick-reply (bad LLM structure) — degrade to plain text
    console.error("Rich reply failed, falling back to text:", err);
    await replyText(replyToken, historyText).catch(() => {});
  }
}
