import type { Milestone, Project } from "@prisma/client";
import type { AnalysisResult } from "../prompts/analyze.js";
import type { ProjectIdea } from "../prompts/features.js";

// LINE Flex requires hex colors
const C = {
  text: "#222222",
  sub: "#8C8C8C",
  faint: "#AAAAAA",
  line: "#EEEEEE",
  green: "#06C755",
  amber: "#F5A623",
  red: "#E53935",
  blue: "#3B82F6",
  barBg: "#F0F0F0",
};

function scoreColor(score: number): string {
  return score >= 8 ? C.green : score >= 5 ? C.amber : C.red;
}

function verdictColor(verdict: string): string {
  if (verdict === "ผ่าน") return C.green;
  if (verdict === "ไม่ผ่าน") return C.red;
  return C.amber;
}

function text(t: string, opts: Record<string, unknown> = {}) {
  return { type: "text", text: t || " ", wrap: true, ...opts };
}

function separator(margin = "lg") {
  return { type: "separator", margin, color: C.line };
}

/** Horizontal score bar: filled portion colored by score. */
function scoreBar(score: number) {
  const pct = Math.max(2, Math.min(100, score * 10));
  return {
    type: "box",
    layout: "vertical",
    height: "6px",
    backgroundColor: C.barBg,
    cornerRadius: "3px",
    margin: "md",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: `${pct}%`,
        height: "6px",
        backgroundColor: scoreColor(score),
        cornerRadius: "3px",
        contents: [{ type: "filler" }],
      },
    ],
  };
}

function bulletRow(t: string, bullet = "•", bulletColor = C.faint) {
  return {
    type: "box",
    layout: "horizontal",
    margin: "sm",
    spacing: "sm",
    contents: [
      text(bullet, { size: "sm", color: bulletColor, flex: 0 }),
      text(t, { size: "sm", color: C.text, flex: 1 }),
    ],
  };
}

/** Bubble 1 — overview: total score + verdict badge. */
function overviewBubble(projectName: string, a: AnalysisResult) {
  const total = a.dimensions.reduce((s, d) => s + d.score, 0);
  const max = a.dimensions.length * 10;
  const vColor = verdictColor(a.verdict);

  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        text("ผลการประเมินโครงงาน", { size: "xs", color: C.sub }),
        text(projectName, { size: "xl", weight: "bold", color: C.text, margin: "sm" }),
        {
          type: "box",
          layout: "horizontal",
          margin: "xl",
          alignItems: "flex-end",
          contents: [
            text(`${total}`, {
              size: "4xl",
              weight: "bold",
              color: scoreColor(total / a.dimensions.length),
              flex: 0,
            }),
            text(`/ ${max}`, { size: "md", color: C.sub, flex: 0, margin: "sm", gravity: "bottom" }),
            {
              type: "box",
              layout: "vertical",
              flex: 1,
              alignItems: "flex-end",
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  backgroundColor: vColor,
                  cornerRadius: "14px",
                  paddingTop: "6px",
                  paddingBottom: "6px",
                  paddingStart: "14px",
                  paddingEnd: "14px",
                  contents: [
                    text(a.verdict, { size: "sm", weight: "bold", color: "#FFFFFF", align: "center", wrap: false }),
                  ],
                },
              ],
            },
          ],
        },
        separator("xl"),
        text(a.overview, { size: "sm", color: C.text, margin: "lg" }),
        text(a.verdictReason, { size: "xs", color: C.sub, margin: "md" }),
        separator("lg"),
        ...a.dimensions.map((d) => ({
          type: "box",
          layout: "horizontal",
          margin: "md",
          contents: [
            text(`${d.emoji} ${d.name}`, { size: "sm", color: C.text, flex: 5, wrap: false }),
            text(`${d.score}/10`, {
              size: "sm",
              weight: "bold",
              color: scoreColor(d.score),
              align: "end",
              flex: 2,
            }),
          ],
        })),
        text("เลื่อนดูรายมิติ →", { size: "xs", color: C.faint, margin: "xl", align: "end" }),
      ],
    },
  };
}

/** One bubble per dimension. */
function dimensionBubble(d: AnalysisResult["dimensions"][number], index: number, totalDims: number) {
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        text(`มิติที่ ${index + 1}/${totalDims}`, { size: "xs", color: C.faint }),
        {
          type: "box",
          layout: "horizontal",
          margin: "sm",
          contents: [
            text(`${d.emoji} ${d.name}`, { size: "lg", weight: "bold", color: C.text, flex: 1 }),
            text(`${d.score}/10`, {
              size: "lg",
              weight: "bold",
              color: scoreColor(d.score),
              align: "end",
              flex: 0,
            }),
          ],
        },
        scoreBar(d.score),
        text(d.comment, { size: "sm", color: C.text, margin: "lg" }),
        ...(d.points.length > 0 ? [separator("lg")] : []),
        ...d.points.filter(Boolean).map((p) => bulletRow(p)),
      ],
    },
  };
}

/** Red flags + good points bubble. */
function flagsBubble(a: AnalysisResult) {
  const contents: object[] = [];

  if (a.redFlags.length > 0) {
    contents.push(text("🚩 จุดที่ต้องแก้ (พูดตรงๆ)", { size: "md", weight: "bold", color: C.red }));
    contents.push(...a.redFlags.filter(Boolean).map((f) => bulletRow(f, "!", C.red)));
  }
  if (a.goodPoints.length > 0) {
    if (contents.length > 0) contents.push(separator("xl"));
    contents.push(
      text("✅ สิ่งที่ดีแล้ว (ของจริง ไม่อวย)", {
        size: "md",
        weight: "bold",
        color: C.green,
        margin: contents.length > 0 ? "xl" : "none",
      })
    );
    contents.push(...a.goodPoints.filter(Boolean).map((g) => bulletRow(g, "✓", C.green)));
  }

  if (contents.length === 0) return null;
  return {
    type: "bubble",
    size: "mega",
    body: { type: "box", layout: "vertical", paddingAll: "20px", contents },
  };
}

/** Next steps bubble. */
function nextStepsBubble(a: AnalysisResult) {
  if (a.nextSteps.length === 0) return null;
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        text("🎯 ทำอะไรต่อ (เรียงตามความสำคัญ)", { size: "md", weight: "bold", color: C.text }),
        ...a.nextSteps.filter(Boolean).map((s, i) => bulletRow(s, `${i + 1}.`, C.blue)),
        separator("xl"),
        text("สงสัยตรงไหน พิมพ์ถามต่อได้เลย 💬", { size: "xs", color: C.faint, margin: "lg", align: "center" }),
      ],
    },
  };
}

/** Full /analyze result → Flex carousel. */
export function buildAnalysisFlex(projectName: string, a: AnalysisResult): object {
  const bubbles: object[] = [
    overviewBubble(projectName, a),
    ...a.dimensions.map((d, i) => dimensionBubble(d, i, a.dimensions.length)),
  ];
  const flags = flagsBubble(a);
  if (flags) bubbles.push(flags);
  const steps = nextStepsBubble(a);
  if (steps) bubbles.push(steps);

  return { type: "carousel", contents: bubbles.slice(0, 12) };
}

// ---------- Rich Q&A replies ----------

export interface RichReplySection {
  heading?: string;
  text?: string;
  bullets?: string[];
  numbered?: boolean;
}

export interface RichReply {
  title: string;
  emoji?: string;
  sections: RichReplySection[];
  footer?: string;
}

/** Structured Q&A answer → single Flex bubble. */
export function buildRichReplyFlex(r: RichReply): object {
  const contents: object[] = [
    text(`${r.emoji ? r.emoji + " " : ""}${r.title}`, {
      size: "lg",
      weight: "bold",
      color: C.text,
    }),
  ];

  r.sections.slice(0, 6).forEach((s) => {
    contents.push(separator("lg"));
    if (s.heading) {
      contents.push(text(s.heading, { size: "sm", weight: "bold", color: C.blue, margin: "lg" }));
    }
    if (s.text) {
      contents.push(text(s.text, { size: "sm", color: C.text, margin: s.heading ? "sm" : "lg" }));
    }
    (s.bullets ?? [])
      .filter(Boolean)
      .slice(0, 8)
      .forEach((b, i) => {
        contents.push(
          s.numbered ? bulletRow(b, `${i + 1}.`, C.blue) : bulletRow(b)
        );
      });
  });

  if (r.footer) {
    contents.push(separator("xl"));
    contents.push(text(r.footer, { size: "xs", color: C.sub, margin: "lg" }));
  }

  return {
    type: "bubble",
    size: "mega",
    body: { type: "box", layout: "vertical", paddingAll: "20px", contents },
  };
}

/** Plain-text rendering of a rich reply (for conversation history). */
export function flattenRichReply(r: RichReply): string {
  const parts: string[] = [r.title];
  for (const s of r.sections) {
    if (s.heading) parts.push(s.heading);
    if (s.text) parts.push(s.text);
    (s.bullets ?? []).forEach((b, i) => parts.push(s.numbered ? `${i + 1}. ${b}` : `• ${b}`));
  }
  if (r.footer) parts.push(r.footer);
  return parts.join("\n");
}

// ---------- Score reports (/validate, /startup, /predict) ----------

function pctColor(pct: number): string {
  return pct >= 70 ? C.green : pct >= 40 ? C.amber : C.red;
}

/** Horizontal percent bar (0-100). */
function percentBar(pct: number) {
  const width = Math.max(2, Math.min(100, pct));
  return {
    type: "box",
    layout: "vertical",
    height: "6px",
    backgroundColor: C.barBg,
    cornerRadius: "3px",
    margin: "sm",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: `${width}%`,
        height: "6px",
        backgroundColor: pctColor(pct),
        cornerRadius: "3px",
        contents: [{ type: "filler" }],
      },
    ],
  };
}

function percentRow(label: string, pct: number) {
  return {
    type: "box",
    layout: "vertical",
    margin: "lg",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          text(label, { size: "sm", color: C.text, flex: 1 }),
          text(`${pct}%`, { size: "sm", weight: "bold", color: pctColor(pct), align: "end", flex: 0 }),
        ],
      },
      percentBar(pct),
    ],
  };
}

export interface ScoreReport {
  kicker: string; // small label above the title, e.g. "Problem Validation"
  title: string;
  emoji?: string;
  /** Big headline number, e.g. Startup Potential 0-100. */
  overall?: { label: string; pct: number };
  scores: Array<{ label: string; pct: number }>;
  sections: RichReplySection[];
  footer?: string;
}

/** Score report → single Flex bubble (percent bars + detail sections). */
export function buildScoreReportFlex(r: ScoreReport): object {
  const contents: object[] = [
    text(r.kicker, { size: "xs", color: C.sub }),
    text(`${r.emoji ? r.emoji + " " : ""}${r.title}`, {
      size: "xl",
      weight: "bold",
      color: C.text,
      margin: "sm",
    }),
  ];

  if (r.overall) {
    contents.push({
      type: "box",
      layout: "horizontal",
      margin: "xl",
      alignItems: "flex-end",
      contents: [
        text(`${r.overall.pct}`, { size: "4xl", weight: "bold", color: pctColor(r.overall.pct), flex: 0 }),
        text("/ 100", { size: "md", color: C.sub, flex: 0, margin: "sm", gravity: "bottom" }),
        text(r.overall.label, { size: "sm", color: C.sub, flex: 1, align: "end", gravity: "bottom" }),
      ],
    });
  }

  if (r.scores.length > 0) {
    contents.push(separator("xl"));
    r.scores.forEach((s) => contents.push(percentRow(s.label, s.pct)));
  }

  r.sections
    .filter((s) => s.text || (s.bullets ?? []).length > 0)
    .slice(0, 6)
    .forEach((s) => {
      contents.push(separator("xl"));
      if (s.heading) {
        contents.push(text(s.heading, { size: "sm", weight: "bold", color: C.blue, margin: "lg" }));
      }
      if (s.text) {
        contents.push(text(s.text, { size: "sm", color: C.text, margin: s.heading ? "sm" : "lg" }));
      }
      (s.bullets ?? [])
        .filter(Boolean)
        .slice(0, 8)
        .forEach((b, i) => {
          contents.push(s.numbered ? bulletRow(b, `${i + 1}.`, C.blue) : bulletRow(b));
        });
    });

  if (r.footer) {
    contents.push(separator("xl"));
    contents.push(text(r.footer, { size: "sm", weight: "bold", color: C.text, margin: "lg" }));
  }

  return {
    type: "bubble",
    size: "mega",
    body: { type: "box", layout: "vertical", paddingAll: "20px", contents },
  };
}

// ---------- Project idea carousel (/discover, /random) ----------

function ideaField(emoji: string, label: string, value: string) {
  return [
    text(`${emoji} ${label}`, { size: "xs", color: C.sub, margin: "md" }),
    text(value, { size: "sm", color: C.text, margin: "xs" }),
  ];
}

function ideaBubble(idea: ProjectIdea, index: number) {
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        text(`ไอเดียที่ ${index + 1}`, { size: "xs", color: C.faint }),
        text(idea.name, { size: "lg", weight: "bold", color: C.text, margin: "sm" }),
        ...(idea.pitch ? [text(idea.pitch, { size: "sm", color: C.sub, margin: "sm" })] : []),
        separator("lg"),
        ...ideaField("🎯", "ปัญหาที่แก้", idea.problem),
        ...ideaField("👥", "กลุ่มผู้ใช้งาน", idea.targetUser),
        ...ideaField("🛠", "เทคโนโลยี", idea.techStack),
        ...ideaField("⚙️", "ความยาก", idea.difficulty),
        separator("lg"),
        percentRow("ความเป็นไปได้", idea.feasibility),
        percentRow("ศักยภาพ Startup", idea.startupScore),
        text(`ถูกใจ? กด "เลือกไอเดีย ${index + 1}" ด้านล่างเลย`, {
          size: "xs",
          color: C.faint,
          margin: "xl",
          align: "center",
        }),
      ],
    },
  };
}

/** Generated project ideas → Flex carousel. */
export function buildIdeasFlex(ideas: ProjectIdea[]): object {
  return { type: "carousel", contents: ideas.slice(0, 5).map((idea, i) => ideaBubble(idea, i)) };
}

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function thaiDate(d: Date): string {
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const PHASE_LABEL: Record<string, { label: string; color: string }> = {
  IDEATION: { label: "💡 IDEATION", color: C.blue },
  PROTOTYPE: { label: "🔨 PROTOTYPE", color: C.amber },
  VALIDATION: { label: "🧪 VALIDATION", color: "#9C27B0" },
  SUBMISSION: { label: "📨 SUBMISSION", color: "#FF7043" },
  COMPLETED: { label: "🏁 COMPLETED", color: C.green },
};

/** /status → single Flex bubble. */
export function buildStatusFlex(
  project: Project & { milestones: Milestone[] }
): object {
  const phase = PHASE_LABEL[project.phase] ?? { label: project.phase, color: C.sub };
  const contents: object[] = [
    text("สถานะโครงงาน", { size: "xs", color: C.sub }),
    {
      type: "box",
      layout: "horizontal",
      margin: "sm",
      contents: [
        text(project.name, { size: "xl", weight: "bold", color: C.text, flex: 1 }),
      ],
    },
    {
      type: "box",
      layout: "horizontal",
      margin: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          backgroundColor: phase.color,
          cornerRadius: "12px",
          paddingTop: "4px",
          paddingBottom: "4px",
          paddingStart: "12px",
          paddingEnd: "12px",
          flex: 0,
          contents: [text(phase.label, { size: "xs", weight: "bold", color: "#FFFFFF", wrap: false })],
        },
      ],
    },
    separator("xl"),
    text(`✅ Milestones (${project.milestones.length})`, {
      size: "sm",
      weight: "bold",
      color: C.text,
      margin: "lg",
    }),
  ];

  if (project.milestones.length === 0) {
    contents.push(text("ยังไม่มี — log ด้วย /update [ข้อความ]", { size: "sm", color: C.sub, margin: "sm" }));
  } else {
    for (const m of project.milestones.slice(-6)) {
      contents.push({
        type: "box",
        layout: "horizontal",
        margin: "sm",
        spacing: "md",
        contents: [
          text(`${m.createdAt.getDate()} ${THAI_MONTHS[m.createdAt.getMonth()]}`, {
            size: "xs",
            color: C.faint,
            flex: 2,
            wrap: false,
          }),
          text(m.description, { size: "sm", color: C.text, flex: 7 }),
        ],
      });
    }
  }

  if (project.submissionDeadline) {
    const daysLeft = Math.ceil(
      (project.submissionDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const urgency = daysLeft <= 7 ? C.red : daysLeft <= 21 ? C.amber : C.green;
    const remaining =
      daysLeft > 0 ? `อีก ${daysLeft} วัน` : daysLeft === 0 ? "วันนี้!" : "เลยกำหนดแล้ว";
    contents.push(separator("xl"));
    contents.push({
      type: "box",
      layout: "horizontal",
      margin: "lg",
      contents: [
        text(`⏰ Deadline: ${thaiDate(project.submissionDeadline)}`, { size: "sm", color: C.text, flex: 1 }),
        text(remaining, { size: "sm", weight: "bold", color: urgency, align: "end", flex: 0 }),
      ],
    });
  }

  contents.push(separator("lg"));
  contents.push(
    text(
      project.lastAnalyzedAt
        ? `🔍 วิเคราะห์ล่าสุด: ${thaiDate(project.lastAnalyzedAt)}`
        : "🔍 ยังไม่ได้วิเคราะห์ — พิมพ์ /analyze เพื่อเริ่ม",
      { size: "xs", color: C.sub, margin: "lg" }
    )
  );

  // Data changed since the last analysis? (10s tolerance because the analyze
  // write itself bumps updatedAt)
  if (project.lastAnalyzedAt) {
    const analyzedAt = project.lastAnalyzedAt.getTime();
    const dataChanged =
      project.updatedAt.getTime() - analyzedAt > 10_000 ||
      project.milestones.some((m) => m.createdAt.getTime() > analyzedAt);
    if (dataChanged) {
      contents.push(
        text("⚠️ ข้อมูลเปลี่ยนหลังวิเคราะห์ล่าสุด — /analyze อีกครั้งเพื่อผลที่ตรงปัจจุบัน", {
          size: "xs",
          color: C.amber,
          margin: "sm",
        })
      );
    }
  }

  return {
    type: "bubble",
    size: "mega",
    body: { type: "box", layout: "vertical", paddingAll: "20px", contents },
  };
}
