import type { Milestone, Project } from "@prisma/client";
import type { SerperResult } from "../services/search/serper.js";
import type { ScholarPaper } from "../services/search/semantic.js";
import type { GithubRepo } from "../services/search/github.js";

export interface AnalysisDimension {
  name: string;
  emoji: string;
  score: number; // 0-10
  comment: string;
  points: string[];
}

export interface AnalysisResult {
  overview: string;
  verdict: "ผ่าน" | "ผ่านแบบมีเงื่อนไข" | "ไม่ผ่าน";
  verdictReason: string;
  dimensions: AnalysisDimension[];
  redFlags: string[];
  goodPoints: string[];
  nextSteps: string[];
}

function formatSerper(results: SerperResult[]): string {
  if (results.length === 0) return "(no results found)";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`)
    .join("\n");
}

function formatScholar(papers: ScholarPaper[]): string {
  if (papers.length === 0) return "(no results found)";
  return papers
    .map((p, i) => {
      const authors = p.authors?.map((a) => a.name).join(", ") ?? "";
      const abstract = p.abstract ? p.abstract.slice(0, 400) : "(no abstract)";
      return `${i + 1}. ${p.title} (${p.year ?? "n.d."}) — ${authors}\n   ${abstract}`;
    })
    .join("\n");
}

function formatGithub(repos: GithubRepo[]): string {
  if (repos.length === 0) return "(no results found)";
  return repos
    .map((r, i) => `${i + 1}. ${r.name} (⭐ ${r.stars})\n   ${r.url}\n   ${r.description ?? "(no description)"}`)
    .join("\n");
}

export function buildAnalyzePrompt(
  project: Project,
  milestones: Milestone[],
  serperResults: SerperResult[],
  scholarResults: ScholarPaper[],
  githubResults: GithubRepo[]
): string {
  const milestoneBlock =
    milestones.length > 0
      ? milestones
          .map((m) => `- ${m.createdAt.toISOString().slice(0, 10)}: ${m.description}`)
          .join("\n")
      : "(ยังไม่มี milestone)";

  return `คุณคือกรรมการตัดสินโครงงานนวัตกรรมและ Mentor สายเทคโนโลยี สำหรับโครงงานนักศึกษาและ Hackathon

บุคลิก: ตรงไปตรงมาแบบ tough love — เหมือนพี่ที่เก่งและอยากให้น้องผ่าน แต่ไม่ยอมบอกว่าดีถ้ามันไม่ดีจริง
- ชมเฉพาะสิ่งที่ดีจริง ไม่ชมแบบ courtesy ไม่อวย
- วิจารณ์ตรงๆ พร้อมเหตุผลว่าทำไม และต้องแก้อย่างไร
- ไม่ใช้คำพูด corporate หรือ generic
- ทุกความเห็นต้องอ้างอิงข้อมูลจริง (จากตัวโครงงานหรือผลค้นหา)

PROJECT:
Name: ${project.name}
Problem: ${project.problem}
Target User: ${project.targetUser}
Solution: ${project.solution}
Tech Stack: ${project.techStack}
Competition Target: ${project.competitionTarget ?? "-"}
Phase: ${project.phase}

MILESTONES (ความคืบหน้าที่ผู้ใช้ log ไว้ — ใช้เป็นหลักฐานจริงประกอบมิติ Feasibility และความน่าเชื่อถือของ evidence อย่าประเมินเหมือนยังไม่เริ่มทำถ้ามีของแล้ว):
${milestoneBlock}
${
  project.documentContext
    ? `
PROJECT DOCUMENT (สรุปจากไฟล์ "${project.documentName}" ที่ผู้ใช้ส่งมา — ใช้เป็นหลักฐานประกอบการประเมิน โดยเฉพาะมิติ Feasibility และตัวเลขที่อ้าง):
${project.documentContext}
`
    : ""
}
EXISTING SOLUTIONS FOUND (ใช้เทียบเรื่อง novelty — ถ้าเจอของซ้ำให้ชี้ชัดๆ):
[Commercial/Startup]:
${formatSerper(serperResults)}

[Academic Papers]:
${formatScholar(scholarResults)}

[Open Source]:
${formatGithub(githubResults)}

ประเมิน 5 มิติ ให้คะแนน 0-10 ต่อมิติ (เกณฑ์โหดแบบกรรมการจริง: 5 = พอใช้, 7 = ดี, 9+ = โดดเด่นจริงๆ อย่าใจดีเกิน):
1. 🎯 Problem Worth — ปัญหามีจริง มีคนเจอมากพอ และน่าลงทุนเวลาแก้ไหม? ถ้าปัญหาไม่น่าแก้ มิติอื่นช่วยไม่ได้
2. ✅ Solution Fit — วิธีแก้เหมาะกับ target user จริงไหม? ราคา/ความซับซ้อนสมเหตุสมผลไหม? มีทางเลือกที่ดีกว่าอยู่แล้วไหม?
3. ⚙️ Feasibility & Reasoning — ทำได้จริงด้วยทรัพยากรที่มีไหม? ทุก decision มีเหตุผล backing ไหม?
4. 💡 Innovation — มีอะไรใหม่จริงไหมเมื่อเทียบกับผลค้นหาข้างบน? ถ้ามีคนทำแล้ว วิธีการต่างอย่างมีนัยสำคัญไหม? วัดได้ไหม (ง่ายกว่า/ถูกกว่า/เร็วกว่า)?
5. 🚀 Scalability — ถ้าสำเร็จ ขยายได้แค่ไหน? impact วงกว้างไหม?

Red flags (หักคะแนนทันที): ไอเดียซ้ำ+วิธีเหมือนเดิม / อ้างว่าทำได้แต่ไม่มีเหตุผล / decision ไม่มี backing / ปัญหาไม่มีอยู่จริง

ตอบเป็น JSON เท่านั้น (ห้ามมีข้อความอื่นนอก JSON, ห้ามใช้ markdown ในค่า string ทุกตัว — ข้อความจะแสดงใน LINE ที่ render markdown ไม่ได้):
{
  "overview": "สรุปภาพรวมตรงๆ 2-3 ประโยค โครงงานนี้อยู่ระดับไหน",
  "verdict": "ผ่าน" | "ผ่านแบบมีเงื่อนไข" | "ไม่ผ่าน",
  "verdictReason": "เหตุผลคำตัดสิน 1-2 ประโยค",
  "dimensions": [
    { "name": "Problem Worth", "emoji": "🎯", "score": 0, "comment": "ความเห็นตรงๆ 1-2 ประโยค", "points": ["ประเด็นสั้นๆ ไม่เกิน 90 ตัวอักษร", "2-3 ประเด็นต่อมิติ"] },
    { "name": "Solution Fit", "emoji": "✅", ... },
    { "name": "Feasibility & Reasoning", "emoji": "⚙️", ... },
    { "name": "Innovation", "emoji": "💡", ... },
    { "name": "Scalability", "emoji": "🚀", ... }
  ],
  "redFlags": ["จุดที่ต้องแก้ด่วน พูดตรงๆ พร้อมเหตุผลสั้นๆ (0-4 ข้อ ถ้าไม่มีให้ [])"],
  "goodPoints": ["สิ่งที่ดีจริงๆ เท่านั้น (0-4 ข้อ)"],
  "nextSteps": ["action item ที่ทำได้จริง เรียงตามความสำคัญ (3-5 ข้อ)"]
}`;
}
