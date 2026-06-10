import type { FileEventMessage, MessageEvent } from "@line/bot-sdk";
import { prisma } from "../../db/client.js";
import { downloadContent, pushText, replyText, stripMarkdown } from "../../services/line.js";
import { generateWithPdf } from "../../services/llm.js";
import { appendHistory, loadSession, saveSession } from "../../services/session.js";

const MAX_PDF_BYTES = 15 * 1024 * 1024; // keep base64 payload to the LLM sane

const EXTRACT_PROMPT = `อ่านเอกสารนี้อย่างละเอียด แล้วสรุปเป็นภาษาไทยตามโครงสร้างนี้ (ตอบเป็น plain text เท่านั้น ห้ามใช้ markdown):

1) เอกสารนี้คืออะไร (proposal / รายงาน / สไลด์ / อื่นๆ) เกี่ยวกับอะไร
2) สาระสำคัญ: ปัญหา, กลุ่มเป้าหมาย, solution, เทคโนโลยีที่ใช้ (ถ้ามีระบุ)
3) ตัวเลข/หลักฐาน/ผลทดสอบที่อ้างในเอกสาร (สำคัญมาก — เก็บให้ครบ)
4) จุดที่เอกสารยังอ่อนหรือข้อมูลที่ขาด

สรุปให้กระชับแต่เก็บข้อมูลสำคัญครบ ไม่เกิน 600 คำ`;

/** Handle an uploaded file message — currently supports PDF only. */
export async function handleFileMessage(event: MessageEvent): Promise<void> {
  const message = event.message as FileEventMessage;
  const userId = event.source.userId;
  if (!userId) return;

  const fileName = message.fileName ?? "document.pdf";

  if (!fileName.toLowerCase().endsWith(".pdf")) {
    await replyText(event.replyToken, "ตอนนี้อ่านได้เฉพาะไฟล์ PDF นะ 📄 ลองส่งเป็น PDF มาใหม่");
    return;
  }
  if (message.fileSize && Number(message.fileSize) > MAX_PDF_BYTES) {
    await replyText(event.replyToken, "ไฟล์ใหญ่เกิน 15MB อ่านไม่ไหว 😅 ลองลดขนาดหรือตัดเฉพาะส่วนสำคัญมา");
    return;
  }

  await replyText(event.replyToken, `📄 กำลังอ่าน "${fileName}" ... รอแป๊บนะ`);

  // Fire-and-forget: download + LLM read can take longer than the webhook window
  void (async () => {
    try {
      const pdf = await downloadContent(message.id);
      const summary = stripMarkdown(await generateWithPdf(EXTRACT_PROMPT, pdf, fileName));

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { activeProject: true },
      });
      const project = user?.activeProject;

      let footer: string;
      if (project) {
        await prisma.project.update({
          where: { id: project.id },
          data: { documentName: fileName, documentContext: summary },
        });
        footer = `\n\n📎 เก็บเนื้อหาไว้กับโครงงาน "${project.name}" แล้ว — /analyze รอบหน้าจะใช้ข้อมูลจากเอกสารนี้ด้วย ถามอะไรเกี่ยวกับเอกสารก็ได้เลย 💬`;
      } else {
        footer = "\n\n💡 ยังไม่มีโครงงานที่เลือกอยู่ — ถ้าสร้างด้วย /new แล้วส่งไฟล์มาใหม่ จะเก็บเนื้อหาไว้ใช้ตอน /analyze ให้ด้วย";
      }

      // Keep the doc in conversation context for follow-up questions
      const state = await loadSession(userId);
      appendHistory(state, "user", `[ส่งไฟล์ PDF: ${fileName}]`);
      appendHistory(state, "assistant", `สรุปเอกสาร:\n${summary.slice(0, 1500)}`);
      await saveSession(userId, state);

      await pushText(userId, `📄 อ่าน "${fileName}" จบแล้ว\n\n${summary}${footer}`);
    } catch (err) {
      console.error("PDF handling failed:", err);
      await pushText(userId, `❌ อ่าน "${fileName}" ไม่สำเร็จ ลองส่งใหม่อีกครั้งนะ`).catch(() => {});
    }
  })();
}
