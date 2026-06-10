import { prisma } from "../db/client.js";
import { generate } from "./llm.js";
import { lineClient } from "./line.js";

export interface UserProfile {
  nickname?: string;
  mood?: string; // current emotional state / worries (updatable, removable)
  facts?: string[]; // durable facts: role, team, skills, personal things they shared
  preferences?: string[]; // how they like to be talked to
}

/** Fetch the LINE display name once and cache it on the User row. */
export function ensureDisplayName(userId: string, current: string | null | undefined): void {
  if (current) return;
  void (async () => {
    try {
      const p = await lineClient.getProfile(userId);
      if (p.displayName) {
        await prisma.user.update({
          where: { id: userId },
          data: { displayName: p.displayName },
        });
      }
    } catch (err) {
      console.error("LINE getProfile failed:", err);
    }
  })();
}

/**
 * Learn about the user from the latest exchange (runs in the background after
 * every Q&A turn — never blocks or breaks the reply).
 */
export function updateUserProfile(userId: string, userMsg: string, botReply: string): void {
  void (async () => {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const current = user?.profile ?? "{}";

      const raw = await generate(
        `คุณคือระบบความจำระยะยาวของ AI mentor ชื่อ "พี่โนวา" ที่คุยกับนักเรียน/นักศึกษาเรื่องโครงงานนวัตกรรม

PROFILE ปัจจุบันของผู้ใช้คนนี้ (JSON):
${current}

บทสนทนาล่าสุด:
ผู้ใช้: ${userMsg.slice(0, 800)}
พี่โนวา: ${botReply.slice(0, 600)}

อัพเดท profile โดยเก็บเฉพาะสิ่งที่ช่วยให้เข้าใจผู้ใช้คนนี้มากขึ้นในระยะยาว:
- nickname: ชื่อเล่นหรือชื่อที่เขาอยากให้เรียก (ถ้าเคยบอก)
- mood: สภาพจิตใจ/ความกังวลช่วงนี้ เช่น "เครียดใกล้ deadline", "กำลังไฟแรง" (อัพเดทตามล่าสุด ลบเมื่อหมดประเด็น)
- facts: ข้อเท็จจริงถาวร เช่น ระดับชั้น, ทีมกี่คน, ถนัด/ไม่ถนัดอะไร, เรื่องส่วนตัวที่เล่า (สอบ, งานพิเศษ, สิ่งที่ชอบ)
- preferences: สไตล์การคุยที่เขาชอบ เช่น "ชอบคำตอบสั้นๆ", "อยากให้อธิบายศัพท์เทคนิค"

กฎ: ตอบเป็น JSON เท่านั้น {"nickname":"...","mood":"...","facts":["..."],"preferences":["..."]}
- facts ไม่เกิน 10 ข้อ ข้อละสั้นๆ — ถ้าเกินให้ตัดข้อที่สำคัญน้อยสุด
- อย่าเก็บเนื้อหาโครงงาน (มีที่เก็บอยู่แล้ว) เก็บเฉพาะเรื่องของ "ตัวผู้ใช้"
- ถ้าไม่มีอะไรใหม่ ตอบ JSON เดิม`
      );

      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start === -1 || end <= start) return;
      const parsed = JSON.parse(raw.slice(start, end + 1)) as UserProfile;

      // sanitize
      const clean: UserProfile = {
        nickname: typeof parsed.nickname === "string" ? parsed.nickname.slice(0, 50) : undefined,
        mood: typeof parsed.mood === "string" ? parsed.mood.slice(0, 120) : undefined,
        facts: Array.isArray(parsed.facts)
          ? parsed.facts.filter((f) => typeof f === "string").slice(0, 10)
          : [],
        preferences: Array.isArray(parsed.preferences)
          ? parsed.preferences.filter((p) => typeof p === "string").slice(0, 5)
          : [],
      };

      await prisma.user.update({
        where: { id: userId },
        data: { profile: JSON.stringify(clean) },
      });
    } catch (err) {
      console.error("Profile update failed:", err);
    }
  })();
}

/** Render the profile block for the Q&A system prompt. */
export function profileBlock(displayName: string | null | undefined, profileJson: string | null | undefined): string {
  let parsed: UserProfile = {};
  try {
    parsed = profileJson ? (JSON.parse(profileJson) as UserProfile) : {};
  } catch {
    /* ignore */
  }

  const lines: string[] = [];
  const callName = parsed.nickname || displayName;
  if (callName) lines.push(`ชื่อที่ใช้เรียก: ${callName}`);
  if (parsed.mood) lines.push(`สภาพจิตใจช่วงนี้: ${parsed.mood}`);
  if (parsed.facts && parsed.facts.length > 0) lines.push(`สิ่งที่รู้เกี่ยวกับเขา: ${parsed.facts.join(" / ")}`);
  if (parsed.preferences && parsed.preferences.length > 0)
    lines.push(`สไตล์ที่เขาชอบ: ${parsed.preferences.join(" / ")}`);

  if (lines.length === 0) return "(ยังไม่รู้จักผู้ใช้คนนี้มากนัก — สังเกตและเรียนรู้จากบทสนทนา)";
  return lines.join("\n");
}
