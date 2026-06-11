import type { Milestone, Project } from "@prisma/client";
import { prisma } from "../../db/client.js";
import {
  pushFlex,
  pushText,
  replyFlex,
  replyText,
  showTyping,
  stripMarkdown,
} from "../../services/line.js";
import { extractJson, generate } from "../../services/llm.js";
import { extractKeywords } from "../../services/analyzer.js";
import { searchSemantic } from "../../services/search/semantic.js";
import {
  buildRichReplyFlex,
  buildScoreReportFlex,
  flattenRichReply,
  type RichReply,
  type RichReplySection,
  type ScoreReport,
} from "../../services/flex.js";
import {
  buildCanvasPrompt,
  buildCompetePrompt,
  buildPredictPrompt,
  buildRoadmapPrompt,
  buildStartupPrompt,
  buildTeamPrompt,
  buildValidatePrompt,
  type PredictResult,
  type StartupResult,
  type ValidationResult,
} from "../../prompts/features.js";

type ProjectFull = Project & { milestones: Milestone[] };

const NO_PROJECT =
  "ยังไม่มีโครงงานที่เลือกอยู่ — /new สร้างเอง, /discover ให้พี่ช่วยคิดไอเดีย หรือ /switch เลือกโครงงานเดิมนะ";

async function getActiveProject(userId: string): Promise<ProjectFull | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      activeProject: { include: { milestones: { orderBy: { createdAt: "asc" } } } },
    },
  });
  return user?.activeProject ?? null;
}

const clampPct = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const clean = (s: unknown) => stripMarkdown(String(s ?? ""));
const cleanList = (a: unknown) =>
  Array.isArray(a) ? a.filter(Boolean).map((s) => stripMarkdown(String(s))) : [];

// ---------------------------------------------------------------------------
// /validate — Problem Validation (Feature 2)
// Searches academic papers first, so it runs deferred like /analyze.
// ---------------------------------------------------------------------------

export async function handleValidate(replyToken: string, userId: string): Promise<void> {
  const project = await getActiveProject(userId);
  if (!project) return replyText(replyToken, NO_PROJECT);

  await replyText(replyToken, "🔬 กำลังตรวจสอบว่าปัญหานี้มีอยู่จริงไหม... รอสักครู่นะ");

  void (async () => {
    try {
      showTyping(userId, 60);
      const keywords = await extractKeywords(project);
      const papers = await searchSemantic(`${keywords} problem`);
      const raw = await generate(buildValidatePrompt(project, papers), undefined, { json: true });
      const v = extractJson<ValidationResult>(raw);

      if (!v?.scores) {
        await pushText(userId, stripMarkdown(raw));
        return;
      }

      const sections: RichReplySection[] = [
        { heading: "📏 ขนาดของปัญหา", text: clean(v.problemSize) },
        { heading: "👥 ผู้ได้รับผลกระทบ", text: clean(v.affected) },
        { heading: "⏱ ความเร่งด่วน", text: clean(v.urgency) },
        { heading: "📚 งานวิจัยที่เกี่ยวข้อง", bullets: cleanList(v.research) },
        { heading: "🌍 SDGs ที่เกี่ยวข้อง", bullets: cleanList(v.sdgs) },
        { heading: "💡 คำแนะนำ", bullets: cleanList(v.advice), numbered: true },
      ];

      const report: ScoreReport = {
        kicker: "Problem Validation — ปัญหานี้มีจริงไหม?",
        title: project.name,
        emoji: "🔬",
        scores: [
          { label: "Impact Score", pct: clampPct(v.scores.impact) },
          { label: "Innovation Score", pct: clampPct(v.scores.innovation) },
          { label: "Feasibility Score", pct: clampPct(v.scores.feasibility) },
          { label: "Startup Score", pct: clampPct(v.scores.startup) },
        ],
        sections,
        footer: clean(v.summary),
      };

      await pushFlex(userId, `ผล Validate: ${project.name}`, buildScoreReportFlex(report));
    } catch (err) {
      console.error("/validate failed:", err);
      await pushText(userId, "❌ ตรวจสอบไม่สำเร็จ ลองใหม่ด้วย /validate นะ").catch(() => {});
    }
  })();
}

// ---------------------------------------------------------------------------
// /startup — Startup Potential Analyzer (Feature 3)
// ---------------------------------------------------------------------------

export async function handleStartup(replyToken: string, userId: string): Promise<void> {
  const project = await getActiveProject(userId);
  if (!project) return replyText(replyToken, NO_PROJECT);

  showTyping(userId, 60);
  try {
    const raw = await generate(buildStartupPrompt(project, project.milestones), undefined, {
      json: true,
    });
    const v = extractJson<StartupResult>(raw);
    if (!v || v.score === undefined) return await replyText(replyToken, stripMarkdown(raw));

    const report: ScoreReport = {
      kicker: "Startup Potential Analyzer",
      title: project.name,
      emoji: "🚀",
      overall: { label: "Startup Potential", pct: clampPct(v.score) },
      scores: [],
      sections: [
        { heading: "🧑‍🤝‍🧑 ลูกค้าคือใคร", text: clean(v.customer) },
        { heading: "💸 ใครจ่ายเงิน", text: clean(v.payer) },
        { heading: "💰 รูปแบบรายได้", text: clean(v.revenueModel) },
        { heading: "📊 ขนาดตลาด", text: clean(v.marketSize) },
        { heading: "⚔️ คู่แข่ง", bullets: cleanList(v.competitors) },
        { heading: "✨ จุดแตกต่าง", text: clean(v.differentiator) },
      ],
    };

    await replyFlex(
      replyToken,
      `Startup Potential: ${clampPct(v.score)}/100 — ${project.name}`,
      buildScoreReportFlex(report)
    );
    const advice = cleanList(v.advice);
    if (advice.length > 0) {
      await pushText(
        userId,
        `💡 เพิ่มโอกาสทางธุรกิจยังไงดี:\n${advice.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
      );
    }
  } catch (err) {
    console.error("/startup failed:", err);
    await replyText(replyToken, "❌ วิเคราะห์ไม่สำเร็จ ลองใหม่ด้วย /startup นะ").catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// /predict — Project Success Predictor (Feature 10)
// ---------------------------------------------------------------------------

export async function handlePredict(replyToken: string, userId: string): Promise<void> {
  const project = await getActiveProject(userId);
  if (!project) return replyText(replyToken, NO_PROJECT);

  showTyping(userId, 60);
  try {
    const raw = await generate(buildPredictPrompt(project, project.milestones), undefined, {
      json: true,
    });
    const v = extractJson<PredictResult>(raw);
    if (!v || v.overall === undefined) return await replyText(replyToken, stripMarkdown(raw));

    const report: ScoreReport = {
      kicker: "Project Success Predictor",
      title: project.name,
      emoji: "🔮",
      overall: { label: "Overall Success Probability", pct: clampPct(v.overall) },
      scores: [
        { label: "Impact", pct: clampPct(v.impact) },
        { label: "Innovation", pct: clampPct(v.innovation) },
        { label: "Feasibility", pct: clampPct(v.feasibility) },
        { label: "Market Potential", pct: clampPct(v.market) },
      ],
      sections: [
        { heading: "📋 สรุปจากกรรมการ", text: clean(v.summary) },
        { heading: "📈 ปรับตรงไหนคะแนนขึ้น", bullets: cleanList(v.improvements), numbered: true },
      ],
      footer: project.lastAnalyzedAt
        ? undefined
        : "ยังไม่เคย /analyze เลย — วิเคราะห์ก่อนจะทำนายได้แม่นขึ้นนะ",
    };

    await replyFlex(
      replyToken,
      `โอกาสสำเร็จ ${clampPct(v.overall)}% — ${project.name}`,
      buildScoreReportFlex(report)
    );
  } catch (err) {
    console.error("/predict failed:", err);
    await replyText(replyToken, "❌ ทำนายไม่สำเร็จ ลองใหม่ด้วย /predict นะ").catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// /canvas — Project Canvas Generator (Feature 6)
// Plain text on purpose: users copy it straight into Word/Docs.
// ---------------------------------------------------------------------------

export async function handleCanvas(replyToken: string, userId: string): Promise<void> {
  const project = await getActiveProject(userId);
  if (!project) return replyText(replyToken, NO_PROJECT);

  showTyping(userId, 60);
  try {
    const raw = await generate(buildCanvasPrompt(project, project.milestones));
    await replyText(
      replyToken,
      `${stripMarkdown(raw)}\n\n💾 ก็อปไปวางใน Word/Google Docs แล้ว export เป็น PDF ได้เลยนะ`
    );
  } catch (err) {
    console.error("/canvas failed:", err);
    await replyText(replyToken, "❌ สร้างเอกสารไม่สำเร็จ ลองใหม่ด้วย /canvas นะ").catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// /compete, /team, /roadmap — RichReply-based advisors (Features 7-9)
// ---------------------------------------------------------------------------

async function runRichReplyCommand(
  replyToken: string,
  userId: string,
  buildPrompt: (p: Project, m: Milestone[]) => string,
  altPrefix: string,
  command: string
): Promise<void> {
  const project = await getActiveProject(userId);
  if (!project) return replyText(replyToken, NO_PROJECT);

  showTyping(userId, 60);
  try {
    const raw = await generate(buildPrompt(project, project.milestones), undefined, { json: true });
    const parsed = extractJson<RichReply>(raw);

    if (!parsed?.title || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      return await replyText(replyToken, stripMarkdown(raw));
    }

    const rich: RichReply = {
      title: stripMarkdown(parsed.title),
      emoji: parsed.emoji,
      sections: parsed.sections.map((s) => ({
        heading: s.heading ? stripMarkdown(s.heading) : undefined,
        text: s.text ? stripMarkdown(s.text) : undefined,
        bullets: cleanList(s.bullets),
        numbered: s.numbered,
      })),
      footer: parsed.footer ? stripMarkdown(parsed.footer) : undefined,
    };

    try {
      await replyFlex(
        replyToken,
        `${altPrefix}: ${project.name}`.slice(0, 200),
        buildRichReplyFlex(rich)
      );
    } catch (err) {
      console.error(`${command} flex failed, falling back to text:`, err);
      await replyText(replyToken, flattenRichReply(rich)).catch(() => {});
    }
  } catch (err) {
    console.error(`${command} failed:`, err);
    await replyText(replyToken, `❌ ทำไม่สำเร็จ ลองใหม่ด้วย ${command} นะ`).catch(() => {});
  }
}

/** /compete — Competition Matching (Feature 7). */
export const handleCompete = (replyToken: string, userId: string) =>
  runRichReplyCommand(replyToken, userId, buildCompetePrompt, "เวทีที่เหมาะ", "/compete");

/** /team — Team Builder (Feature 8). */
export const handleTeam = (replyToken: string, userId: string) =>
  runRichReplyCommand(replyToken, userId, buildTeamPrompt, "โครงสร้างทีม", "/team");

/** /roadmap — Roadmap Generator (Feature 9). */
export const handleRoadmap = (replyToken: string, userId: string) =>
  runRichReplyCommand(replyToken, userId, buildRoadmapPrompt, "แผนดำเนินงาน", "/roadmap");
