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
import { handleDiscover, handleDiscoverInput, handleIdeaChoice, handleRandom } from "./commands/discover.js";
import { handleMentor, handleMentorInput } from "./commands/mentor.js";
import {
  handleCanvas,
  handleCompete,
  handlePredict,
  handleRoadmap,
  handleStartup,
  handleTeam,
  handleValidate,
} from "./commands/insights.js";

const HELP_TEXT = `คำสั่งทั้งหมดของพี่โนวา 🤖

💡 หาไอเดีย
/discover — ตอบคำถาม 5 ข้อ ให้พี่คิดไอเดียโครงงานให้
/random — สุ่มผสมเทคโนโลยี ได้ไอเดียใหม่ไม่ซ้ำใคร
/mentor — โหมดพี่เลี้ยง ถามทีละขั้นจนได้หัวข้อโครงงาน

📁 จัดการโครงงาน
/new — สร้างโครงงานใหม่
/switch — สลับโครงงาน
/edit — แก้ไขข้อมูลโครงงาน
/update [ข้อความ] — บันทึก milestone
/status — ดูความคืบหน้า

🔍 วิเคราะห์
/analyze — วิเคราะห์นวัตกรรมเทียบของที่มีอยู่จริง
/validate — เช็คว่าปัญหามีอยู่จริงไหม + คะแนน 4 ด้าน
/startup — วิเคราะห์ศักยภาพ Startup (0-100)
/predict — ทำนายโอกาสสำเร็จของโครงงาน

🧭 วางแผน
/canvas — สร้างเอกสารโครงงาน (ก็อปไปใช้ต่อได้เลย)
/roadmap — สร้างแผนดำเนินงานรายสัปดาห์
/team — แนะนำโครงสร้างทีมที่เหมาะกับโครงงาน
/compete — จับคู่เวทีแข่งขัน + เคล็ดลับเพิ่มโอกาสชนะ

หรือพิมพ์คุยกับพี่ได้เลย 💬
ส่งไฟล์ PDF (proposal/รายงาน) มาได้ เดี๋ยวพี่อ่านให้ 📄`;

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
  } else if (state.state === "discovering") {
    if (!isCommand) return handleDiscoverInput(replyToken, userId, state, text);
    clearFlow(state);
    await saveSession(userId, state);
  } else if (state.state === "mentoring") {
    if (!isCommand) return handleMentorInput(replyToken, userId, state, text);
    clearFlow(state);
    await saveSession(userId, state);
  } else if (state.state === "choosing_idea") {
    if (!isCommand && (await handleIdeaChoice(replyToken, userId, state, text))) return;
    if (isCommand) {
      clearFlow(state);
      await saveSession(userId, state);
    }
    // not a selection and not a command: fall through to Q&A (ideas stay
    // selectable so the user can ask about them before picking one)
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
  if (text.startsWith("/discover")) return handleDiscover(replyToken, userId, state);
  if (text.startsWith("/random")) return handleRandom(replyToken, userId, state);
  if (text.startsWith("/mentor")) return handleMentor(replyToken, userId, state);
  if (text.startsWith("/validate")) return handleValidate(replyToken, userId);
  if (text.startsWith("/startup")) return handleStartup(replyToken, userId);
  if (text.startsWith("/predict")) return handlePredict(replyToken, userId);
  if (text.startsWith("/canvas")) return handleCanvas(replyToken, userId);
  if (text.startsWith("/compete")) return handleCompete(replyToken, userId);
  if (text.startsWith("/team")) return handleTeam(replyToken, userId);
  if (text.startsWith("/roadmap")) return handleRoadmap(replyToken, userId);
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

มีโครงงานแล้ว? กด /new เล่าให้พี่ฟัง (หรือส่งไฟล์ proposal เป็น PDF มาให้พี่อ่านก็ได้ 📄)
ยังไม่มีไอเดีย? กด /discover เดี๋ยวพี่ช่วยคิดให้เลย 💡`,
    ["/new", "/discover", "/help"]
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
