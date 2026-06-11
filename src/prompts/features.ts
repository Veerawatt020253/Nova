import type { Milestone, Project } from "@prisma/client";
import type { ScholarPaper } from "../services/search/semantic.js";
import { ADVISOR_TONE, PLAIN_TEXT_RULES } from "./system.js";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const JSON_RULES = `กฎของค่า string ทุกตัวใน JSON:
- plain text เท่านั้น — ห้าม markdown (**, ##, backtick) และห้าม HTML tag (<b>, <br> ฯลฯ) เพราะ LINE แสดงผลไม่ได้
- ห้ามใช้เครื่องหมาย " ภายในข้อความ (จะทำให้ JSON พัง) — ถ้าต้องการเน้นคำ ใช้ 'คำ' แทน
- ห้ามมีข้อความอื่นนอก JSON`;

function projectBlock(project: Project, milestones: Milestone[] = []): string {
  const milestoneBlock =
    milestones.length > 0
      ? milestones
          .map((m) => `- ${m.createdAt.toISOString().slice(0, 10)}: ${m.description}`)
          .join("\n")
      : "(ยังไม่มี milestone)";

  return `PROJECT:
Name: ${project.name}
Problem: ${project.problem}
Target User: ${project.targetUser}
Solution: ${project.solution}
Tech Stack: ${project.techStack}
Competition Target: ${project.competitionTarget ?? "-"}
Submission Deadline: ${project.submissionDeadline?.toISOString().slice(0, 10) ?? "-"}
Phase: ${project.phase}

MILESTONES (ความคืบหน้าจริงที่ log ไว้):
${milestoneBlock}
${
  project.documentContext
    ? `
PROJECT DOCUMENT (สรุปจากไฟล์ "${project.documentName}"):
${project.documentContext.slice(0, 2000)}
`
    : ""
}`;
}

// ---------------------------------------------------------------------------
// Feature 1 + 4: Project Discovery Engine / Innovation Generator
// ---------------------------------------------------------------------------

export interface ProjectIdea {
  name: string;
  pitch: string;
  problem: string;
  targetUser: string;
  solution: string;
  techStack: string;
  difficulty: string; // ง่าย / ปานกลาง / ยาก
  feasibility: number; // 0-100
  startupScore: number; // 0-100
}

export type DiscoverStep = "interest" | "skills" | "budget" | "duration" | "targetGroup";

export interface DiscoverAnswers {
  interest: string;
  skills: string;
  budget: string;
  duration: string;
  targetGroup: string;
}

const IDEA_JSON_SHAPE = `ตอบเป็น JSON เท่านั้น:
{
  "ideas": [
    {
      "name": "ชื่อโครงงาน (ภาษาไทย กระชับ จำง่าย)",
      "pitch": "ขายไอเดียใน 1 ประโยค",
      "problem": "ปัญหาที่กำลังแก้ 1-2 ประโยค (ปัญหาต้องมีอยู่จริง)",
      "targetUser": "กลุ่มผู้ใช้งาน",
      "solution": "solution ทำงานอย่างไรโดยย่อ",
      "techStack": "เทคโนโลยีที่ใช้",
      "difficulty": "ง่าย|ปานกลาง|ยาก",
      "feasibility": 75,
      "startupScore": 60
    }
  ]
}
(feasibility และ startupScore เป็นตัวเลข 0-100 ให้คะแนนแบบตรงไปตรงมา อย่าอวย — 50 = พอไหว, 70 = ดี, 85+ = โดดเด่นจริง)`;

export function buildDiscoverPrompt(answers: DiscoverAnswers): string {
  return `คุณคือ AI Mentor ที่ช่วยนักเรียน/นักศึกษาค้นหาไอเดียโครงงานนวัตกรรม (สำหรับเวที NSC, YSC, Startup Thailand, Hackathon)

ข้อมูลผู้ใช้:
- สนใจด้าน: ${answers.interest}
- ทักษะที่มี: ${answers.skills}
- งบประมาณ: ${answers.budget}
- ระยะเวลาดำเนินงาน: ${answers.duration}
- กลุ่มเป้าหมาย: ${answers.targetGroup}

สร้างไอเดียโครงงาน 3 ไอเดียที่:
1. แก้ปัญหาที่มีอยู่จริงและกลุ่มเป้าหมายเจอบ่อย
2. ทำได้จริงด้วยทักษะ งบ และเวลาที่ผู้ใช้มี (สำคัญมาก — อย่าเสนอเกินตัว)
3. ไม่ซ้ำโครงงานยอดฮิตที่ใครๆ ก็ทำ (ถังขยะอัจฉริยะ, ระบบรดน้ำอัตโนมัติธรรมดา)
4. มีโอกาสต่อยอดเป็น Startup ได้

${IDEA_JSON_SHAPE}

${JSON_RULES}`;
}

const TECHS = [
  "AI",
  "Computer Vision",
  "IoT",
  "AR/VR",
  "Robotics",
  "Blockchain",
  "Drone",
  "Mobile App",
  "Chatbot/LLM",
  "Wearable Sensor",
  "Big Data",
];

const DOMAINS = [
  "Healthcare",
  "Agriculture",
  "Environment",
  "Education",
  "Elderly Care",
  "Tourism",
  "Logistics",
  "Food",
  "Energy",
  "Safety",
  "Sports",
  "Smart City",
  "Disability Support",
];

/** Random tech × domain combo, e.g. "AI + Healthcare". */
export function randomCombo(): string {
  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]!;
  return `${pick(TECHS)} + ${pick(DOMAINS)}`;
}

export function buildRandomPrompt(combo: string): string {
  return `คุณคือ Innovation Generator — สร้างไอเดียโครงงานนวัตกรรมใหม่ๆ สำหรับนักเรียน/นักศึกษา จากการผสมเทคโนโลยีกับโดเมน

โจทย์ที่สุ่มได้: ${combo}

สร้างไอเดียโครงงาน 3 ไอเดียจากการผสมนี้ โดยแต่ละไอเดียต้อง:
1. แก้ปัญหาที่มีอยู่จริงในโดเมนนั้น (ระบุปัญหาให้เฉพาะเจาะจง ไม่ใช่ปัญหากว้างๆ)
2. ใช้เทคโนโลยีที่กำหนดอย่างมีเหตุผล ไม่ใช่ยัดเทคโนโลยีเพื่อความเท่
3. นักศึกษาทำเป็น prototype ได้จริงใน 3-6 เดือน
4. แตกต่างกันทั้ง 3 ไอเดีย (คนละปัญหา คนละมุม)

${IDEA_JSON_SHAPE}

${JSON_RULES}`;
}

// ---------------------------------------------------------------------------
// Feature 5: AI Mentor Mode
// ---------------------------------------------------------------------------

export const MENTOR_FIRST_MESSAGE = `เข้าสู่ Mentor Mode แล้ว 🧑‍🏫 พี่จะพาคิดทีละขั้นเหมือนอาจารย์ที่ปรึกษา ถามทีละคำถามจนได้โครงงานที่ชัดเจน (อยากออกจากโหมดนี้เมื่อไหร่ พิมพ์คำสั่งอะไรก็ได้ เช่น /help)

เริ่มกันเลย — ปัญหาที่อยากแก้คืออะไร? เล่าแบบที่เห็นมากับตาได้เลย หรือถ้ายังไม่มีในใจ บอกพี่ว่าสนใจด้านไหนก็ได้`;

export function buildMentorSystemPrompt(): string {
  return `${ADVISOR_TONE}

ตอนนี้คุณอยู่ใน "Mentor Mode" — ทำหน้าที่เหมือนอาจารย์ที่ปรึกษา พาผู้ใช้คิดโครงงานตั้งแต่ศูนย์จนได้หัวข้อที่สมบูรณ์ ด้วยการถามกลับทีละขั้นตามลำดับ:
1. ปัญหาคืออะไร (ขุดให้เจอปัญหาจริงที่เฉพาะเจาะจง ไม่ใช่ solution)
2. ใครได้รับผลกระทบ เจอบ่อยแค่ไหน รุนแรงแค่ไหน
3. ปัจจุบันเขาแก้ปัญหานี้อย่างไร
4. จุดอ่อนของวิธีเดิมคืออะไร
5. เทคโนโลยี/วิธีการใดเหมาะสมที่จะแก้ (คำนึงถึงทักษะของผู้ใช้)
6. สรุปเป็นโครงงานที่สมบูรณ์

กติกา:
- ถามทีละ 1 คำถามเท่านั้น สั้น กระชับ พร้อม feedback สั้นๆ ต่อคำตอบก่อนหน้า
- ถ้าคำตอบกว้างเกินไป ช่วย narrow ลงด้วยคำถามเจาะหรือตัวอย่าง
- ถ้าผู้ใช้ตอบว่าไม่รู้/คิดไม่ออก เสนอตัวเลือกให้เลือก (ใส่ options)
- อย่าเพิ่งสรุปจบถ้ายังไม่ผ่านครบทุกขั้น แต่ก็อย่าลากยาวเกิน — ข้อมูลพอแล้วให้จบ

ตอบเป็น JSON เท่านั้น เลือก 1 ใน 2 แบบ:

ระหว่างทาง (ยังถามต่อ):
{"done":false,"reply":"feedback สั้นๆ + คำถามถัดไป","options":["ตัวเลือก (ถ้ามี 2-4 ข้อ ข้อละไม่เกิน 20 ตัวอักษร)"]}

จบ (ได้โครงงานครบแล้ว):
{"done":true,"reply":"สรุปสั้นๆ ว่าได้โครงงานอะไร เด่นตรงไหน","draft":{"name":"ชื่อโครงงาน","problem":"ปัญหาที่แก้","targetUser":"กลุ่มเป้าหมาย","solution":"วิธีแก้โดยย่อ","techStack":"เทคโนโลยีที่ใช้"}}

${JSON_RULES}`;
}

// ---------------------------------------------------------------------------
// Feature 2: Problem Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  problemSize: string;
  affected: string;
  urgency: string;
  research: string[];
  sdgs: string[];
  scores: { impact: number; innovation: number; feasibility: number; startup: number };
  summary: string;
  advice: string[];
}

function formatPapers(papers: ScholarPaper[]): string {
  if (papers.length === 0) return "(no papers found)";
  return papers
    .map((p, i) => {
      const abstract = p.abstract ? p.abstract.slice(0, 300) : "(no abstract)";
      return `${i + 1}. ${p.title} (${p.year ?? "n.d."})\n   ${abstract}`;
    })
    .join("\n");
}

export function buildValidatePrompt(project: Project, papers: ScholarPaper[]): string {
  return `คุณคือนักวิเคราะห์ปัญหาเชิงนวัตกรรม หน้าที่คือตอบให้ชัดว่า "ปัญหานี้มีอยู่จริงหรือไม่" อย่างตรงไปตรงมา อิงหลักฐาน ไม่อวย

${projectBlock(project)}
ACADEMIC PAPERS FOUND (ใช้อ้างอิงหัวข้อ research — ถ้าไม่เกี่ยวให้บอกตรงๆ):
${formatPapers(papers)}

วิเคราะห์:
1. ขนาดของปัญหา — ใหญ่แค่ไหน เกิดที่ไหน บ่อยแค่ไหน
2. จำนวนผู้ได้รับผลกระทบ — ประมาณการให้เห็นภาพ
3. ความเร่งด่วน — ต้องแก้ตอนนี้ไหม หรือทนได้
4. งานวิจัย/หลักฐานที่เกี่ยวข้อง
5. SDGs ที่เกี่ยวข้อง

ให้คะแนน 0-100 แบบกรรมการจริง (50 = พอใช้, 70 = ดี, 85+ = โดดเด่น):
- impact: ปัญหาใหญ่และการแก้สร้างผลกระทบจริง
- innovation: แนวทางแก้มีความใหม่
- feasibility: ทำได้จริงด้วยทรัพยากรระดับนักศึกษา
- startup: ต่อยอดเป็นธุรกิจได้

ตอบเป็น JSON เท่านั้น:
{
  "problemSize": "ขนาดของปัญหา 1-2 ประโยค",
  "affected": "ใครได้รับผลกระทบ ประมาณเท่าไหร่",
  "urgency": "ความเร่งด่วน + เหตุผลสั้นๆ",
  "research": ["งานวิจัย/หลักฐานที่เกี่ยวข้อง (2-4 ข้อ ข้อละไม่เกิน 90 ตัวอักษร)"],
  "sdgs": ["เช่น SDG 3 สุขภาพและความเป็นอยู่ที่ดี (1-3 ข้อ)"],
  "scores": {"impact": 0, "innovation": 0, "feasibility": 0, "startup": 0},
  "summary": "สรุปตรงๆ 1-2 ประโยค: ปัญหามีจริงไหม ควรไปต่อ/ปรับ/เปลี่ยน",
  "advice": ["คำแนะนำที่ทำได้จริง (2-4 ข้อ)"]
}

${JSON_RULES}`;
}

// ---------------------------------------------------------------------------
// Feature 3: Startup Potential Analyzer
// ---------------------------------------------------------------------------

export interface StartupResult {
  customer: string;
  payer: string;
  revenueModel: string;
  marketSize: string;
  competitors: string[];
  differentiator: string;
  score: number; // 0-100
  advice: string[];
}

export function buildStartupPrompt(project: Project, milestones: Milestone[]): string {
  return `คุณคือนักลงทุน VC สาย early-stage ที่ประเมินศักยภาพ Startup อย่างตรงไปตรงมา ไม่อวย

${projectBlock(project, milestones)}
วิเคราะห์มุมธุรกิจ:
1. ลูกค้าคือใคร (อาจต่างจาก user)
2. ใครจะเป็นคนจ่ายเงิน และทำไมถึงยอมจ่าย
3. รูปแบบรายได้ที่เหมาะ (subscription / ขายขาด / B2B / B2G ฯลฯ)
4. ขนาดตลาด (ประเมินจากบริบทไทยเป็นหลัก)
5. คู่แข่งที่มีอยู่
6. จุดแตกต่างที่ป้องกันได้จริง

ให้ startup potential 0-100 แบบ VC จริง (นักศึกษาส่วนใหญ่ได้ 30-60, เกิน 80 ต้องเจ๋งจริง)

ตอบเป็น JSON เท่านั้น:
{
  "customer": "ลูกค้าคือใคร 1-2 ประโยค",
  "payer": "ใครจ่ายเงิน + เหตุผลที่ยอมจ่าย",
  "revenueModel": "รูปแบบรายได้ที่เหมาะที่สุด + เหตุผลสั้นๆ",
  "marketSize": "ขนาดตลาดโดยประมาณ ให้เห็นภาพ",
  "competitors": ["คู่แข่ง/ทางเลือกปัจจุบัน (2-4 ข้อ ข้อละไม่เกิน 90 ตัวอักษร)"],
  "differentiator": "จุดแตกต่างที่แท้จริง (ถ้าไม่มีให้บอกตรงๆ)",
  "score": 0,
  "advice": ["คำแนะนำเพิ่มโอกาสทางธุรกิจ เรียงตามความสำคัญ (3-4 ข้อ)"]
}

${JSON_RULES}`;
}

// ---------------------------------------------------------------------------
// Feature 10: Project Success Predictor
// ---------------------------------------------------------------------------

export interface PredictResult {
  impact: number;
  innovation: number;
  feasibility: number;
  market: number;
  overall: number;
  summary: string;
  improvements: string[];
}

export function buildPredictPrompt(project: Project, milestones: Milestone[]): string {
  return `คุณคือกรรมการตัดสินโครงงานนวัตกรรมระดับประเทศ ทำนายโอกาสสำเร็จของโครงงานนี้แบบตรงไปตรงมา อิงข้อมูลจริง ไม่อวย

${projectBlock(project, milestones)}
${
  project.lastAnalysis
    ? `LAST ANALYSIS (ผลวิเคราะห์ล่าสุดของระบบ — ใช้ประกอบการทำนาย):
${project.lastAnalysis.slice(0, 1500)}
`
    : ""
}
ทำนายเป็นเปอร์เซ็นต์ 0-100 (เกณฑ์โหด: 50 = ครึ่งๆ, 70 = น่าจะรอด, 85+ = มั่นใจมาก):
- impact: โอกาสที่โครงงานสร้างผลกระทบจริงต่อกลุ่มเป้าหมาย
- innovation: ระดับความใหม่เทียบของที่มีอยู่
- feasibility: โอกาสทำเสร็จและใช้งานได้จริง (ดู milestones ประกอบ)
- market: ศักยภาพทางตลาด/ธุรกิจ
- overall: โอกาสสำเร็จโดยรวม (พิจารณาทุกมิติ + โอกาสได้รางวัล)

ตอบเป็น JSON เท่านั้น:
{
  "impact": 0,
  "innovation": 0,
  "feasibility": 0,
  "market": 0,
  "overall": 0,
  "summary": "สรุป 2-3 ประโยค: จุดที่ฉุดคะแนนที่สุดคืออะไร และโครงงานนี้อยู่ระดับไหน",
  "improvements": ["สิ่งที่ควรปรับเพื่อเพิ่มคะแนน เรียงตามผลลัพธ์ที่ได้ (3-5 ข้อ)"]
}

${JSON_RULES}`;
}

// ---------------------------------------------------------------------------
// Feature 6: Project Canvas Generator
// ---------------------------------------------------------------------------

export function buildCanvasPrompt(project: Project, milestones: Milestone[]): string {
  const today = new Date().toISOString().slice(0, 10);
  return `คุณคือผู้ช่วยเขียนเอกสารโครงงานนวัตกรรมสำหรับนักเรียน/นักศึกษา เขียนเป็นภาษาไทยทางการแบบเอกสารเสนอโครงงาน

${projectBlock(project, milestones)}
วันนี้คือ ${today}

เขียนเอกสารโครงงาน (Project Canvas) ให้ครบหัวข้อต่อไปนี้ตามลำดับ:

📌 ชื่อโครงงาน
📖 หลักการและเหตุผล (3-5 ประโยค อ้างอิงปัญหาจริง)
🎯 วัตถุประสงค์ (3-4 ข้อ ขึ้นต้นด้วย "เพื่อ")
📐 ขอบเขตของโครงงาน
🛠 วิธีดำเนินงาน (เป็นขั้นตอน)
🏆 ผลที่คาดว่าจะได้รับ (3-4 ข้อ)
📅 Timeline (รายสัปดาห์หรือรายเดือน ให้สอดคล้องกับ deadline ถ้ามี)

${PLAIN_TEXT_RULES}
- ใช้ emoji นำหัวข้อตามด้านบน
- เนื้อหาเป็นทางการพอที่จะก็อปไปใส่เอกสารจริงได้เลย`;
}

// ---------------------------------------------------------------------------
// Features 7-9: Competition Matching / Team Builder / Roadmap Generator
// (all reply as a RichReply JSON rendered with the existing flex builder)
// ---------------------------------------------------------------------------

const RICH_REPLY_SHAPE = `ตอบเป็น JSON เท่านั้น รูปแบบ:
{
  "title": "หัวข้อสั้นๆ",
  "emoji": "อีโมจิเดียว",
  "sections": [
    {"heading": "หัวข้อย่อย (ไม่บังคับ)", "text": "ย่อหน้าอธิบาย (ไม่บังคับ)", "bullets": ["ประเด็นสั้นๆ ไม่เกิน 90 ตัวอักษร"], "numbered": false}
  ],
  "footer": "ประโยคปิดท้ายสั้นๆ (ไม่บังคับ)"
}
(sections 2-5 อัน, bullets ไม่เกิน 8 ข้อต่อ section, ใช้ numbered:true เมื่อเป็นลำดับขั้น)`;

export function buildCompetePrompt(project: Project, milestones: Milestone[]): string {
  return `คุณคือผู้เชี่ยวชาญเวทีประกวดนวัตกรรมในไทย รู้จักทุกเวที: NSC, YSC, Startup Thailand League, Young Innovators Awards, depa, TICTA, Imagine Cup, Hackathon ต่างๆ

${projectBlock(project, milestones)}
วิเคราะห์ว่าโครงงานนี้เหมาะกับเวทีใดมากที่สุด:
- เลือกเวทีที่เหมาะ 2-3 เวที เรียงจากเหมาะที่สุด (section ละเวที, heading ใส่ชื่อเวที + ระดับความเหมาะ เช่น 🥇)
- แต่ละเวที: เหตุผลที่เหมาะ (text) + คำแนะนำเพิ่มโอกาสชนะเวทีนั้น (bullets)
- ถ้าผู้ใช้ระบุ Competition Target ไว้แล้ว ให้ประเมินเวทีนั้นด้วยว่าเหมาะจริงไหม

${RICH_REPLY_SHAPE}

${JSON_RULES}`;
}

export function buildTeamPrompt(project: Project, milestones: Milestone[]): string {
  return `คุณคือที่ปรึกษาการจัดทีมโครงงานนวัตกรรมสำหรับนักเรียน/นักศึกษา

${projectBlock(project, milestones)}
วิเคราะห์ว่าโครงงานนี้ควรมีทีมแบบไหน:
- ทีมควรมีกี่คน บทบาทอะไรบ้าง (เช่น Programmer, Designer, Researcher, Business Developer, Hardware Engineer)
- แต่ละบทบาท: รับผิดชอบอะไรในโครงงานนี้โดยเฉพาะ (อิงจาก tech stack และ solution จริง)
- ทักษะสำคัญที่สุดที่ขาดไม่ได้ และบทบาทไหนควบรวมกันได้ถ้าคนน้อย
- เคล็ดลับการหาสมาชิกและแบ่งงาน

${RICH_REPLY_SHAPE}

${JSON_RULES}`;
}

export function buildRoadmapPrompt(project: Project, milestones: Milestone[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const deadlineInfo = project.submissionDeadline
    ? `Deadline คือ ${project.submissionDeadline.toISOString().slice(0, 10)} (เหลือ ${Math.max(0, Math.ceil((project.submissionDeadline.getTime() - Date.now()) / 86400000))} วันจากวันนี้)`
    : "ไม่มี deadline ระบุ — วางแผน 6-8 สัปดาห์มาตรฐาน";

  return `คุณคือ Project Manager มืออาชีพ วางแผนดำเนินงานโครงงานนวัตกรรมให้นักเรียน/นักศึกษา

${projectBlock(project, milestones)}
วันนี้คือ ${today} — ${deadlineInfo}

สร้างแผนดำเนินงานรายสัปดาห์ (Roadmap) ที่:
- เริ่มจากสถานะปัจจุบันจริง (ดู Phase และ Milestones — งานที่ทำไปแล้วไม่ต้องวางซ้ำ)
- ระบุงานเป็นรูปธรรม วัดได้ ไม่ใช่ "พัฒนาระบบ" ลอยๆ
- จัดลำดับให้ส่วนเสี่ยงสุด/ยากสุดมาก่อน
- bullets ของแผนใช้รูปแบบ "Week 1: ..." และใส่ numbered:false
- มี section สรุปความเสี่ยงที่ต้องระวัง หรือเป้าหมายแต่ละช่วง

${RICH_REPLY_SHAPE}

${JSON_RULES}`;
}
