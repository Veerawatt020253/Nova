import { prisma } from "../../db/client.js";
import {
  pushFlex,
  pushText,
  pushTextWithChoices,
  replyText,
  replyTextWithChoices,
  showTyping,
  stripMarkdown,
} from "../../services/line.js";
import { extractJson, generate } from "../../services/llm.js";
import { clearFlow, saveSession, type SessionState } from "../../services/session.js";
import {
  buildDiscoverPrompt,
  buildRandomPrompt,
  randomCombo,
  type DiscoverAnswers,
  type DiscoverStep,
  type ProjectIdea,
} from "../../prompts/features.js";
import { buildIdeasFlex } from "../../services/flex.js";

const STEP_ORDER: DiscoverStep[] = ["interest", "skills", "budget", "duration", "targetGroup"];

const QUESTIONS: Record<DiscoverStep, { q: string; choices: string[] }> = {
  interest: {
    q: "1/5 — สนใจด้านไหนเป็นพิเศษ? (พิมพ์เองได้เลยถ้าไม่อยู่ในตัวเลือก)",
    choices: ["สุขภาพ", "การเกษตร", "สิ่งแวดล้อม", "การศึกษา", "AI/เทคโนโลยี"],
  },
  skills: {
    q: "2/5 — มีทักษะอะไรบ้าง? (เช่น เขียนโปรแกรมภาษาอะไร ออกแบบ ทำวงจร)",
    choices: ["เขียนโปรแกรม", "ออกแบบ/กราฟิก", "ฮาร์ดแวร์/IoT", "ยังไม่มี เพิ่งเริ่ม"],
  },
  budget: {
    q: "3/5 — งบประมาณประมาณเท่าไหร่?",
    choices: ["ไม่เกิน 1,000 บาท", "1,000-5,000 บาท", "5,000-20,000 บาท", "ยังไม่แน่ใจ"],
  },
  duration: {
    q: "4/5 — มีเวลาทำนานแค่ไหน?",
    choices: ["1 เดือน", "3 เดือน", "6 เดือน", "1 ปี"],
  },
  targetGroup: {
    q: "5/5 — อยากทำเพื่อใคร? (กลุ่มเป้าหมาย)",
    choices: ["นักเรียน/นักศึกษา", "ผู้สูงอายุ", "เกษตรกร", "คนทั่วไป"],
  },
};

const clampPct = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function normalizeIdea(i: ProjectIdea): ProjectIdea {
  return {
    name: stripMarkdown(String(i.name ?? "")),
    pitch: stripMarkdown(String(i.pitch ?? "")),
    problem: stripMarkdown(String(i.problem ?? "")),
    targetUser: stripMarkdown(String(i.targetUser ?? "-")),
    solution: stripMarkdown(String(i.solution ?? "-")),
    techStack: stripMarkdown(String(i.techStack ?? "-")),
    difficulty: stripMarkdown(String(i.difficulty ?? "ปานกลาง")),
    feasibility: clampPct(i.feasibility),
    startupScore: clampPct(i.startupScore),
  };
}

/**
 * Generate ideas in the background and push them as a carousel + selection
 * quick replies. Leaves the session in "choosing_idea" with the ideas stored.
 */
async function generateAndPushIdeas(
  userId: string,
  state: SessionState,
  prompt: string
): Promise<void> {
  try {
    showTyping(userId, 60);
    const raw = await generate(prompt, undefined, { json: true });
    const parsed = extractJson<{ ideas?: ProjectIdea[] }>(raw);
    const ideas = (parsed?.ideas ?? [])
      .filter((i) => i && i.name && i.problem)
      .slice(0, 3)
      .map(normalizeIdea);

    if (ideas.length === 0) {
      await pushText(
        userId,
        stripMarkdown(raw) || "รอบนี้คิดไม่ออกจริงๆ 😅 ลองใหม่ด้วย /discover หรือ /random นะ"
      );
      return;
    }

    state.state = "choosing_idea";
    state.ideas = ideas;
    await saveSession(userId, state);

    await pushFlex(userId, `💡 ได้ ${ideas.length} ไอเดียมาให้เลือก!`, buildIdeasFlex(ideas));
    await pushTextWithChoices(
      userId,
      "ถูกใจไอเดียไหน เลือกได้เลย เดี๋ยวพี่สร้างเป็นโครงงานให้ ✨ (สงสัยอะไรพิมพ์ถามก่อนก็ได้)",
      [...ideas.map((_, i) => `เลือกไอเดีย ${i + 1}`), "สุ่มชุดใหม่ 🎲"]
    );
  } catch (err) {
    console.error("Idea generation failed:", err);
    await pushText(userId, "❌ คิดไอเดียไม่สำเร็จ ลองใหม่ด้วย /discover หรือ /random นะ").catch(
      () => {}
    );
  }
}

/** /discover — Project Discovery Engine: 5 quick questions → 3 tailored ideas. */
export async function handleDiscover(
  replyToken: string,
  userId: string,
  state: SessionState
): Promise<void> {
  clearFlow(state);
  state.state = "discovering";
  state.discoverStep = "interest";
  state.discoverAnswers = {};
  await saveSession(userId, state);

  const { q, choices } = QUESTIONS.interest;
  await replyTextWithChoices(
    replyToken,
    `มาหาไอเดียโครงงานกัน 💡 พี่ขอถาม 5 ข้อสั้นๆ แล้วจะคิดไอเดียที่เหมาะกับเราให้\n\n${q}`,
    choices
  );
}

/** Answer received while the /discover wizard is active. */
export async function handleDiscoverInput(
  replyToken: string,
  userId: string,
  state: SessionState,
  text: string
): Promise<void> {
  const step = state.discoverStep ?? "interest";
  const answers = state.discoverAnswers ?? {};
  answers[step] = text;
  state.discoverAnswers = answers;

  const next = STEP_ORDER[STEP_ORDER.indexOf(step) + 1];
  if (next) {
    state.discoverStep = next;
    await saveSession(userId, state);
    const { q, choices } = QUESTIONS[next];
    return replyTextWithChoices(replyToken, q, choices);
  }

  // All 5 answered — generate ideas in the background (keep answers for re-rolls)
  state.state = "idle";
  delete state.discoverStep;
  await saveSession(userId, state);
  await replyText(replyToken, "ครบแล้ว! 🧠 พี่ขอเวลาคิดไอเดียแป๊บนึง รอเลย...");
  void generateAndPushIdeas(userId, state, buildDiscoverPrompt(answers as DiscoverAnswers));
}

/** /random — Innovation Generator: random tech × domain combo → fresh ideas. */
export async function handleRandom(
  replyToken: string,
  userId: string,
  state: SessionState
): Promise<void> {
  clearFlow(state);
  await saveSession(userId, state);

  const combo = randomCombo();
  await replyText(
    replyToken,
    `🎲 สุ่มได้: ${combo}\nเดี๋ยวพี่ปั้นเป็นไอเดียโครงงานให้ รอแป๊บนะ...`
  );
  void generateAndPushIdeas(userId, state, buildRandomPrompt(combo));
}

const isComplete = (a: Partial<DiscoverAnswers> | undefined): a is DiscoverAnswers =>
  !!a && STEP_ORDER.every((s) => a[s]);

/**
 * Message received while ideas are awaiting selection. Returns true if the
 * message was consumed (selection / re-roll); false → let normal Q&A handle it
 * so the user can ask about the ideas before picking one.
 */
export async function handleIdeaChoice(
  replyToken: string,
  userId: string,
  state: SessionState,
  text: string
): Promise<boolean> {
  const ideas = state.ideas ?? [];

  const match = text.match(/เลือกไอเดีย\s*(\d)/) ?? text.trim().match(/^([1-5])$/);
  if (match && ideas.length > 0) {
    const idea = ideas[Number(match[1]) - 1];
    if (!idea) {
      await replyTextWithChoices(
        replyToken,
        `มีแค่ไอเดีย 1-${ideas.length} นะ ลองเลือกใหม่ 😄`,
        ideas.map((_, i) => `เลือกไอเดีย ${i + 1}`)
      );
      return true;
    }

    const project = await prisma.project.create({
      data: {
        userId,
        name: idea.name,
        problem: idea.problem,
        targetUser: idea.targetUser,
        solution: idea.solution,
        techStack: idea.techStack,
      },
    });
    await prisma.user.update({ where: { id: userId }, data: { activeProjectId: project.id } });

    clearFlow(state);
    state.history = []; // new active project → fresh conversation
    await saveSession(userId, state);

    await replyTextWithChoices(
      replyToken,
      `✅ สร้างโครงงาน "${project.name}" ให้แล้ว!\nเริ่มจากเช็คว่าปัญหามีจริงไหม (/validate) หรือวางแผนงานเลย (/roadmap) ดี?`,
      ["/validate", "/roadmap", "/analyze"]
    );
    return true;
  }

  if (/สุ่ม/.test(text)) {
    const answers = state.discoverAnswers;
    const prompt = isComplete(answers)
      ? buildDiscoverPrompt(answers)
      : buildRandomPrompt(randomCombo());
    await replyText(replyToken, "🎲 จัดให้ กำลังคิดชุดใหม่...");
    void generateAndPushIdeas(userId, state, prompt);
    return true;
  }

  return false;
}
