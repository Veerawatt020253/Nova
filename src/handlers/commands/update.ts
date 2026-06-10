import { prisma } from "../../db/client.js";
import { replyText, replyTextWithChoices, showTyping, stripMarkdown } from "../../services/line.js";
import { generate } from "../../services/llm.js";

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export function formatThaiDateTime(date: Date): string {
  const d = date.getDate();
  const m = THAI_MONTHS[date.getMonth()];
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${d} ${m} ${y}, ${hh}:${mm}`;
}

/** /update [text] — log a milestone on the active project. */
export async function handleUpdate(
  replyToken: string,
  userId: string,
  text: string
): Promise<void> {
  if (!text) {
    await replyText(replyToken, "พิมพ์ /update ตามด้วยสิ่งที่ทำเสร็จ เช่น:\n/update ทำ prototype เสร็จแล้ว");
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { activeProject: true },
  });
  const project = user?.activeProject;

  if (!project) {
    await replyText(
      replyToken,
      "ยังไม่มีโครงงานที่เลือกอยู่ — พิมพ์ /new เพื่อสร้าง หรือ /switch เพื่อเลือกโครงงาน"
    );
    return;
  }

  showTyping(userId, 10);

  const milestone = await prisma.milestone.create({
    data: { projectId: project.id, description: text },
  });

  // One-line tip from the LLM based on the milestone content (non-fatal if it fails)
  let tip = "";
  try {
    const tipText = await generate(
      `โครงงาน: ${project.name} (${project.problem})
ผู้ใช้เพิ่ง log milestone นี้: "${text}"

เขียนคำแนะนำสั้นๆ 1 บรรทัด (ภาษาไทย) ว่า milestone นี้มีประโยชน์อย่างไรต่อการพัฒนาโครงงานหรือการแข่งขัน เช่น เป็น evidence ด้าน validation ตอบเพียงประโยคเดียว ไม่ต้องมีคำนำ`
    );
    tip = stripMarkdown(tipText).split("\n")[0] ?? "";
  } catch (err) {
    console.error("Milestone tip generation failed:", err);
  }

  const lines = [
    "✅ บันทึก milestone แล้ว",
    `📌 "${text}"`,
    `🕐 ${formatThaiDateTime(milestone.createdAt)}`,
  ];
  if (tip) lines.push(`💡 ${tip}`);

  await replyTextWithChoices(replyToken, lines.join("\n"), ["/status", "/analyze"]);
}
