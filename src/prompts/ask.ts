import type { Milestone, Project } from "@prisma/client";
import { ADVISOR_TONE } from "./system.js";

/** Summarize the cached analysis (JSON from the new pipeline, or legacy text). */
function summarizeAnalysis(lastAnalysis: string | null): string {
  if (!lastAnalysis) return "(not analyzed yet)";
  try {
    const a = JSON.parse(lastAnalysis) as {
      overview?: string;
      verdict?: string;
      dimensions?: Array<{ name: string; score: number }>;
      nextSteps?: string[];
    };
    const scores =
      a.dimensions?.map((d) => `${d.name}: ${d.score}/10`).join(", ") ?? "";
    const steps = a.nextSteps?.slice(0, 3).join(" / ") ?? "";
    return [
      a.overview ?? "",
      `คำตัดสิน: ${a.verdict ?? "-"}`,
      scores && `คะแนน: ${scores}`,
      steps && `สิ่งที่แนะนำให้ทำต่อ: ${steps}`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return lastAnalysis.slice(0, 500);
  }
}

export function buildAskSystemPrompt(
  project: Project | null,
  milestones: Milestone[],
  userProfileBlock?: string
): string {
  const projectBlock = project
    ? JSON.stringify(
        {
          name: project.name,
          problem: project.problem,
          targetUser: project.targetUser,
          solution: project.solution,
          techStack: project.techStack,
          competitionTarget: project.competitionTarget,
          submissionDeadline: project.submissionDeadline,
          phase: project.phase,
        },
        null,
        2
      )
    : "(no active project — suggest the user create one with /new)";

  const milestoneBlock =
    milestones.length > 0
      ? milestones
          .map((m) => `- ${m.createdAt.toISOString().slice(0, 10)}: ${m.description}`)
          .join("\n")
      : "(none)";

  return `${ADVISOR_TONE}

USER PROFILE (สิ่งที่พี่โนวาจำได้เกี่ยวกับผู้ใช้คนนี้จากการคุยกันก่อนหน้า):
${userProfileBlock ?? "(ยังไม่รู้จักผู้ใช้คนนี้มากนัก)"}

You know the user's current project in detail. Reference the project details when relevant.

OUTPUT FORMAT — ตอบเป็น JSON เท่านั้น ห้ามมีข้อความนอก JSON เลือก 1 ใน 3 แบบ:

แบบ A — คำตอบสั้น คุยทั่วไป ตอบประเด็นเดียวจบ (1-4 ประโยค):
{"format":"text","text":"คำตอบของคุณ"}

แบบ B — คำตอบมีโครงสร้าง (หลายประเด็น / ขั้นตอน / คำแนะนำหลายข้อ / เปรียบเทียบ / วางแผน):
{"format":"flex","title":"หัวข้อสั้นๆ","emoji":"🎯","sections":[{"heading":"หัวข้อย่อย (ไม่บังคับ)","text":"ย่อหน้าอธิบาย (ไม่บังคับ)","bullets":["ประเด็นสั้นๆ"],"numbered":false}],"footer":"ประโยคปิดท้ายสั้นๆ (ไม่บังคับ)"}

แบบ C — เมื่อคุณต้องการถามผู้ใช้กลับ และคำตอบที่เป็นไปได้มีตัวเลือกชัดเจน (ผู้ใช้จะเห็นเป็นปุ่มกดเลือกได้):
{"format":"question","text":"คำถามของคุณ (อธิบายสั้นๆ ว่าทำไมถึงถาม)","options":["ตัวเลือก 1","ตัวเลือก 2","ตัวเลือก 3"]}

แบบ D — เมื่อผู้ใช้เล่าการเปลี่ยนแปลงของโปรเจกต์ (เพิ่มฟีเจอร์ / เปลี่ยน tech / เปลี่ยนกลุ่มเป้าหมาย / เปลี่ยน solution ฯลฯ) ให้เสนอบันทึกเข้าข้อมูลโครงงาน (ผู้ใช้จะเห็นปุ่มยืนยัน):
{"format":"update","field":"name|problem|targetUser|solution|techStack","value":"เนื้อหาฟิลด์ฉบับใหม่ทั้งหมด (เอาของเดิมจาก ACTIVE PROJECT มารวมกับข้อมูลใหม่ เขียนให้กระชับ)","reply":"ตอบรับสั้นๆ + บอกว่าจะอัพเดทอะไรให้"}

กฎ:
- string ทุกตัวเป็น plain text ห้ามมี markdown (**, ##, backtick) เด็ดขาด
- ถ้าไม่แน่ใจให้ใช้แบบ A — ใช้แบบ B เฉพาะเมื่อโครงสร้างช่วยให้อ่านง่ายขึ้นจริงๆ
- แบบ B: sections 1-5 อัน, bullets ข้อละไม่เกิน ~90 ตัวอักษร, ใช้ "numbered":true เมื่อเป็นขั้นตอนตามลำดับ
- แบบ C: options 2-6 ข้อ ข้อละไม่เกิน 20 ตัวอักษร (จะถูกแสดงเป็นปุ่ม) — ใช้เมื่อข้อมูลที่ขาดมีผลต่อคำแนะนำจริงๆ เท่านั้น อย่าถามพร่ำเพรื่อ ผู้ใช้พิมพ์ตอบเองนอกตัวเลือกก็ได้
- แบบ D: ใช้เมื่อผู้ใช้บอกข้อมูลใหม่ที่ควรอยู่ในโปรเจกต์ถาวรเท่านั้น (ไม่ใช่แค่เล่าความคืบหน้า — ถ้าเป็นความคืบหน้า/งานที่ทำเสร็จ แนะนำให้ใช้ /update แทน) — "value" ต้องเป็นเนื้อหาเต็มของฟิลด์ ไม่ใช่แค่ส่วนที่เพิ่ม
- เนื้อหากระชับ อ่านใน LINE สบาย ไม่เครียด

ACTIVE PROJECT:
${projectBlock}

RECENT MILESTONES:
${milestoneBlock}
${
  project?.documentContext
    ? `
PROJECT DOCUMENT (จากไฟล์ "${project.documentName}"):
${project.documentContext}
`
    : ""
}
LAST ANALYSIS SUMMARY:
${summarizeAnalysis(project?.lastAnalysis ?? null)}`;
}
