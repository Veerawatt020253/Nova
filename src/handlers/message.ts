import type { FollowEvent, MessageEvent, PostbackEvent, TextEventMessage } from "@line/bot-sdk";
import { prisma } from "../db/client.js";
import { clearFlow, loadSession, saveSession } from "../services/session.js";
import { lineClient, replyTextWithChoices, replyText } from "../services/line.js";
import { handleNew, handleWizardInput } from "./commands/new.js";
import { handleSwitch, handleSwitchPostback } from "./commands/switch.js";
import { handleAnalyze } from "./commands/analyze.js";
import { handleUpdate } from "./commands/update.js";
import { handleStatus } from "./commands/status.js";
import { handleAsk } from "./commands/ask.js";
import { applyProjectUpdate, EDIT_FIELD_LABELS, handleEdit, handleEditInput } from "./commands/edit.js";

const HELP_TEXT = `คำสั่งที่ใช้ได้:
/new — สร้างโครงงานใหม่
/switch — สลับโครงงาน
/edit — แก้ไขข้อมูลโครงงาน
/analyze — วิเคราะห์นวัตกรรม
/update [ข้อความ] — บันทึก milestone
/status — ดูความคืบหน้า
หรือพิมพ์คำถามอะไรก็ได้เพื่อคุยกับ bot 💬
ส่งไฟล์ PDF (proposal/รายงาน) มาได้เลย เดี๋ยวอ่านให้ 📄`;

export async function handleTextMessage(event: MessageEvent): Promise<void> {
  const message = event.message as TextEventMessage;
  const text = message.text.trim();
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  if (!userId) return;

  const state = await loadSession(userId);
  const isCommand = text.startsWith("/");

  // ---- Multi-turn flows (commands always interrupt) ----
  if (state.state === "creating_project") {
    if (!isCommand) return handleWizardInput(replyToken, userId, state, text);
    clearFlow(state);
    await saveSession(userId, state);
  } else if (state.state === "editing_project") {
    if (!isCommand) return handleEditInput(replyToken, userId, state, text);
    clearFlow(state);
    await saveSession(userId, state);
  } else if (state.state === "awaiting_milestone") {
    clearFlow(state);
    await saveSession(userId, state);
    if (!isCommand) return handleUpdate(replyToken, userId, text);
    // command typed: fall through to routing below
  } else if (state.state === "confirming_update") {
    const pendingField = state.pendingField;
    const pendingValue = state.pendingValue;
    clearFlow(state);
    await saveSession(userId, state);

    if (!isCommand && text.startsWith("บันทึก") && pendingField && pendingValue) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user?.activeProjectId) {
        const result = await applyProjectUpdate(user.activeProjectId, pendingField, pendingValue);
        if (result.ok) {
          return replyTextWithChoices(
            replyToken,
            `✅ อัพเดท${EDIT_FIELD_LABELS[pendingField] ?? pendingField}เข้าโปรเจกต์แล้ว\nข้อมูลเปลี่ยน — วิเคราะห์ใหม่เลยไหม?`,
            ["/analyze", "ไว้ทีหลัง"]
          );
        }
        return replyText(replyToken, `❌ บันทึกไม่สำเร็จ: ${result.error}`);
      }
      return replyText(replyToken, "ไม่มีโครงงานที่เลือกอยู่แล้ว — /switch เพื่อเลือกก่อนนะ");
    }
    if (!isCommand && text.startsWith("ไม่ต้อง")) {
      return replyText(replyToken, "โอเค ไม่บันทึกนะ 👍 คุยต่อได้เลย");
    }
    // anything else: drop the pending update and handle normally below
  }

  // ---- Commands ----
  if (text.startsWith("/new")) return handleNew(event as any, userId, state);
  if (text.startsWith("/switch")) return handleSwitch(replyToken, userId);
  if (text.startsWith("/edit")) return handleEdit(replyToken, userId, state);
  if (text.startsWith("/analyze")) return handleAnalyze(replyToken, userId);
  if (text.startsWith("/update")) {
    const milestoneText = text.replace("/update", "").trim();
    if (!milestoneText) {
      // rich menu button: ask for the milestone, next message is the answer
      state.state = "awaiting_milestone";
      await saveSession(userId, state);
      return replyText(replyToken, "เล่ามาเลยว่าทำอะไรเสร็จ เดี๋ยวพี่บันทึกให้ ✍️");
    }
    return handleUpdate(replyToken, userId, milestoneText);
  }
  if (text.startsWith("/status")) return handleStatus(replyToken, userId);
  if (text.startsWith("/help") || text === "/") return replyText(replyToken, HELP_TEXT);
  if (text.startsWith("/ask"))
    return handleAsk(replyToken, userId, state, text.replace("/ask", "").trim());
  if (text.startsWith("/")) return replyText(replyToken, `ไม่รู้จักคำสั่งนี้ 🤔\n\n${HELP_TEXT}`);

  // ---- Default: Q&A ----
  return handleAsk(replyToken, userId, state, text);
}

/** New friend! Greet them like a person, not a manual. */
export async function handleFollow(event: FollowEvent): Promise<void> {
  const userId = event.source.userId;
  if (!userId) return;

  let name = "";
  try {
    const p = await lineClient.getProfile(userId);
    name = p.displayName ?? "";
    await prisma.user.upsert({
      where: { id: userId },
      update: { displayName: name || undefined },
      create: { id: userId, displayName: name || undefined },
    });
  } catch {
    await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId } });
  }

  await replyTextWithChoices(
    event.replyToken,
    `สวัสดี${name ? ` ${name}` : ""} พี่โนวาเอง 👋

พี่เป็น mentor โครงงานนวัตกรรม — ช่วยคิด วิเคราะห์จุดแข็งจุดอ่อนแบบกรรมการจริง (ไม่อวยนะ บอกก่อน 😄) เตือน deadline และอยู่เป็นเพื่อนคุยตลอดทางจนถึงวันส่ง

เริ่มจากเล่าโครงงานให้พี่ฟังหน่อย — กด /new ได้เลย หรือถ้ามีไฟล์ proposal อยู่แล้ว ส่ง PDF มาให้พี่อ่านก่อนก็ได้ 📄`,
    ["/new", "/help"]
  );
}

export async function handlePostback(event: PostbackEvent): Promise<void> {
  const userId = event.source.userId;
  if (!userId) return;

  const data = event.postback.data;
  if (data.startsWith("switch:")) {
    return handleSwitchPostback(event.replyToken, userId, data.slice("switch:".length));
  }
}
