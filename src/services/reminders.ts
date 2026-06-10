import { prisma } from "../db/client.js";
import { generate } from "./llm.js";
import { pushTextWithChoices, stripMarkdown } from "./line.js";
import { profileBlock } from "./profile.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_AT_DAYS = [7, 3, 1, 0];

/** Bangkok local hour (server may run in any timezone). */
function bangkokHour(): number {
  return (new Date().getUTCHours() + 7) % 24;
}

async function buildReminderMessage(
  projectName: string,
  daysLeft: number,
  competition: string | null,
  recentMilestones: string[],
  userProfile: string
): Promise<string> {
  const fallback =
    daysLeft === 0
      ? `⏰ วันนี้ deadline ของ "${projectName}" แล้วนะ! เช็คความพร้อมรอบสุดท้ายแล้วส่งให้ทัน สู้ๆ 💪`
      : `⏰ เหลืออีก ${daysLeft} วันก่อน deadline ของ "${projectName}" นะ — เช็คความคืบหน้าหน่อยไหม`;
  try {
    const raw = await generate(
      `คุณคือ "พี่โนวา" mentor โครงงานที่กำลังทักไปเตือน deadline น้องเองก่อน (proactive)

โครงงาน: ${projectName}${competition ? ` (แข่ง ${competition})` : ""}
เหลือเวลา: ${daysLeft === 0 ? "วันนี้วันสุดท้าย!" : `อีก ${daysLeft} วัน`}
ความคืบหน้าล่าสุดที่เขา log ไว้: ${recentMilestones.length > 0 ? recentMilestones.join(" / ") : "(ไม่มีเลย)"}
สิ่งที่รู้เกี่ยวกับน้องคนนี้: ${userProfile}

เขียนข้อความทักเตือนแบบพี่ที่เป็นห่วงจริงๆ 2-4 ประโยค ภาษาพูดธรรมชาติ มีพลังแต่ไม่กดดันเกิน
อิงความคืบหน้าจริงของเขา (ถ้ายังไม่ log อะไรเลยให้ชวนเช็คสถานะ) ตอบเป็น plain text เท่านั้น ห้าม markdown`
    );
    const msg = stripMarkdown(raw).trim();
    return msg || fallback;
  } catch {
    return fallback;
  }
}

async function checkOnce(): Promise<void> {
  // Only ping humans at humane hours (08:00–21:00 Bangkok)
  const hour = bangkokHour();
  if (hour < 8 || hour >= 21) return;

  const now = Date.now();
  const projects = await prisma.project.findMany({
    where: {
      submissionDeadline: { gte: new Date(now - DAY_MS) },
      phase: { not: "COMPLETED" },
    },
    include: {
      milestones: { orderBy: { createdAt: "desc" }, take: 3 },
      user: true,
    },
  });

  for (const p of projects) {
    const daysLeft = Math.ceil((p.submissionDeadline!.getTime() - now) / DAY_MS);
    if (daysLeft < 0 || !REMIND_AT_DAYS.includes(daysLeft)) continue;
    // Don't remind the same project more than once per ~day
    if (p.lastReminderAt && now - p.lastReminderAt.getTime() < 20 * 60 * 60 * 1000) continue;

    try {
      const msg = await buildReminderMessage(
        p.name,
        daysLeft,
        p.competitionTarget,
        p.milestones.map((m) => m.description),
        profileBlock(p.user.displayName, p.user.profile)
      );
      await pushTextWithChoices(p.userId, msg, ["/status", "/analyze"]);
      await prisma.project.update({
        where: { id: p.id },
        data: { lastReminderAt: new Date() },
      });
      console.log(`Reminder sent: "${p.name}" (${daysLeft} days left) → ${p.userId}`);
    } catch (err) {
      console.error(`Reminder failed for project ${p.id}:`, err);
    }
  }
}

/** Start the hourly deadline-reminder loop. */
export function startReminderScheduler(): void {
  setTimeout(() => void checkOnce(), 30 * 1000); // first check shortly after boot
  setInterval(() => void checkOnce(), 60 * 60 * 1000);
  console.log("Deadline reminder scheduler started (hourly check, 08-21 Asia/Bangkok)");
}
