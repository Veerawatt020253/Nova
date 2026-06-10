import { prisma } from "../db/client.js";
import type { ChatMessage } from "./llm.js";

export interface ProjectDraft {
  name: string;
  problem: string;
  targetUser: string;
  solution: string;
  techStack: string;
  competitionTarget: string | null;
  submissionDeadline: string | null; // ISO date string
}

export type WizardStep =
  | "name"
  | "problem"
  | "targetUser"
  | "solution"
  | "techStack"
  | "competition"
  | "deadline";

export interface SessionState {
  state: "idle" | "creating_project" | "editing_project" | "confirming_update" | "awaiting_milestone";
  step?: WizardStep;
  draft?: Partial<ProjectDraft>;
  // /edit wizard
  editStep?: "field" | "value";
  editField?: string;
  // pending project update suggested from chat (awaiting confirmation)
  pendingField?: string;
  pendingValue?: string;
  history: ChatMessage[];
}

const EMPTY_STATE: SessionState = { state: "idle", history: [] };
const MAX_HISTORY = 10;

/**
 * Ensure the User row exists, then load (or create) their session state.
 */
export async function loadSession(userId: string): Promise<SessionState> {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });

  const session = await prisma.session.findFirst({ where: { userId } });
  if (!session) return { ...EMPTY_STATE, history: [] };

  const parsed = session.history as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const s = parsed as SessionState;
    return {
      state: s.state ?? "idle",
      step: s.step,
      draft: s.draft,
      editStep: s.editStep,
      editField: s.editField,
      pendingField: s.pendingField,
      pendingValue: s.pendingValue,
      history: Array.isArray(s.history) ? s.history : [],
    };
  }
  return { ...EMPTY_STATE, history: [] };
}

export async function saveSession(userId: string, state: SessionState): Promise<void> {
  // Trim conversation history to the last N messages
  state.history = state.history.slice(-MAX_HISTORY);

  const existing = await prisma.session.findFirst({ where: { userId } });
  const data = state as unknown as object;
  if (existing) {
    await prisma.session.update({
      where: { id: existing.id },
      data: { history: data },
    });
  } else {
    await prisma.session.create({
      data: { userId, history: data },
    });
  }
}

/**
 * Reset conversation history (used when switching projects).
 */
export async function resetHistory(userId: string): Promise<void> {
  const state = await loadSession(userId);
  state.history = [];
  clearFlow(state);
  await saveSession(userId, state);
}

/** Clear any in-progress multi-turn flow (wizard / edit / pending update). */
export function clearFlow(state: SessionState): void {
  state.state = "idle";
  delete state.step;
  delete state.draft;
  delete state.editStep;
  delete state.editField;
  delete state.pendingField;
  delete state.pendingValue;
}

export function appendHistory(state: SessionState, role: "user" | "assistant", content: string) {
  state.history.push({ role, content });
  state.history = state.history.slice(-MAX_HISTORY);
}
