import { Phase } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { replyText, replyTextWithChoices } from "../../services/line.js";
import { clearFlow, saveSession, type SessionState } from "../../services/session.js";
import { parseDeadline } from "./new.js";

// Thai button label → Project field
const FIELD_MAP: Record<string, { field: string; label: string }> = {
  "ชื่อ": { field: "name", label: "ชื่อโครงงาน" },
  "ปัญหา": { field: "problem", label: "ปัญหา" },
  "กลุ่มเป้าหมาย": { field: "targetUser", label: "กลุ่มเป้าหมาย" },
  "Solution": { field: "solution", label: "Solution" },
  "Tech stack": { field: "techStack", label: "Tech stack" },
  "การแข่งขัน": { field: "competitionTarget", label: "การแข่งขัน" },
  "Deadline": { field: "submissionDeadline", label: "Deadline" },
  "Phase": { field: "phase", label: "Phase" },
};

export const EDIT_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(FIELD_MAP).map((f) => [f.field, f.label])
);

const PHASES = Object.values(Phase) as string[];

/** Apply a single field update to the active project. */
export async function applyProjectUpdate(
  projectId: string,
  field: string,
  rawValue: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  let value: string | Date | null = rawValue.trim();

  if (field === "phase") {
    const phase = rawValue.trim().toUpperCase();
    if (!PHASES.includes(phase)) {
      return { ok: false, error: `Phase ต้องเป็น: ${PHASES.join(" / ")}` };
    }
    value = phase;
  } else if (field === "submissionDeadline") {
    if (rawValue.trim() === "ลบออก") {
      value = null;
    } else {
      const parsed = parseDeadline(rawValue);
      if (!parsed) return { ok: false, error: "อ่านวันที่ไม่ออก ลองรูปแบบ 2026-06-30 หรือ 30/06/2026" };
      value = parsed;
    }
  } else if (field === "competitionTarget" && rawValue.trim() === "ลบออก") {
    value = null;
  } else if (!Object.keys(EDIT_FIELD_LABELS).includes(field)) {
    return { ok: false, error: "ไม่รู้จัก field นี้" };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { [field]: value },
  });
  return { ok: true };
}

/** /edit — start the field-picker wizard. */
export async function handleEdit(
  replyToken: string,
  userId: string,
  state: SessionState
): Promise<void> {
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

  state.state = "editing_project";
  state.editStep = "field";
  await saveSession(userId, state);

  await replyTextWithChoices(
    replyToken,
    `อยากแก้ส่วนไหนของ "${project.name}"? เลือกจากปุ่มได้เลย`,
    Object.keys(FIELD_MAP)
  );
}

/** Handle input while the /edit wizard is active. */
export async function handleEditInput(
  replyToken: string,
  userId: string,
  state: SessionState,
  text: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { activeProject: true },
  });
  const project = user?.activeProject;
  if (!project) {
    clearFlow(state);
    await saveSession(userId, state);
    await replyText(replyToken, "ไม่มีโครงงานที่เลือกอยู่แล้ว — เริ่มใหม่ด้วย /switch หรือ /new");
    return;
  }

  // Step 1: pick the field
  if (state.editStep === "field") {
    const choice = FIELD_MAP[text.trim()];
    if (!choice) {
      await replyTextWithChoices(replyToken, "เลือกจากปุ่มด้านล่างนะ", Object.keys(FIELD_MAP));
      return;
    }
    state.editField = choice.field;
    state.editStep = "value";
    await saveSession(userId, state);

    const current = (project as Record<string, unknown>)[choice.field];
    const currentText =
      current instanceof Date
        ? current.toISOString().slice(0, 10)
        : current
          ? String(current)
          : "(ยังไม่ได้ตั้ง)";

    if (choice.field === "phase") {
      await replyTextWithChoices(replyToken, `Phase ปัจจุบัน: ${currentText}\nเลือก phase ใหม่:`, PHASES);
    } else if (choice.field === "competitionTarget") {
      await replyTextWithChoices(
        replyToken,
        `ค่าปัจจุบัน: ${currentText}\nเลือกหรือพิมพ์ชื่อการแข่งขันใหม่:`,
        ["NSC", "depa", "TICTA", "ลบออก"]
      );
    } else if (choice.field === "submissionDeadline") {
      await replyTextWithChoices(
        replyToken,
        `ค่าปัจจุบัน: ${currentText}\nพิมพ์วันที่ใหม่ (เช่น 2026-06-30 หรือ 30/06/2026):`,
        ["ลบออก"]
      );
    } else {
      await replyText(replyToken, `${choice.label}ปัจจุบัน:\n${currentText}\n\nพิมพ์ค่าใหม่มาได้เลย:`);
    }
    return;
  }

  // Step 2: new value
  const field = state.editField!;
  const result = await applyProjectUpdate(project.id, field, text);
  if (!result.ok) {
    await replyText(replyToken, `${result.error} — ลองใหม่อีกครั้ง`);
    return; // stay on this step
  }

  clearFlow(state);
  await saveSession(userId, state);
  await replyTextWithChoices(
    replyToken,
    `✅ อัพเดท${EDIT_FIELD_LABELS[field] ?? field}เรียบร้อย\nข้อมูลโครงงานเปลี่ยนแล้ว — วิเคราะห์ใหม่เลยไหม?`,
    ["/analyze", "ไว้ทีหลัง"]
  );
}
