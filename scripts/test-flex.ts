// End-to-end test of the /analyze pipeline + Flex rendering:
// runs the real search + LLM, builds the Flex carousel, and validates it
// against LINE's message-validation endpoint (nothing is sent to any user).
import type { Project } from "@prisma/client";
import { runAnalysis } from "../src/services/analyzer.js";
import { buildAnalysisFlex, buildStatusFlex } from "../src/services/flex.js";

const fakeProject = {
  id: "test",
  userId: "test",
  name: "MediTrack",
  problem: "ผู้สูงอายุลืมกินยาตามเวลา ทำให้อาการป่วยเรื้อรังแย่ลง",
  targetUser: "ผู้สูงอายุที่มีโรคประจำตัวและลูกหลานที่ดูแล",
  solution: "กล่องยา IoT แจ้งเตือนผ่าน LINE และส่งสถานะให้ลูกหลานดูได้",
  techStack: "ESP32, LINE Messaging API, Node.js",
  competitionTarget: "NSC",
  submissionDeadline: new Date("2026-06-30"),
  lastAnalysis: null,
  lastAnalyzedAt: new Date(),
  phase: "PROTOTYPE",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Project;

async function validateWithLine(messages: object[]): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/validate/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    throw new Error(`LINE validation failed (${res.status}): ${await res.text()}`);
  }
}

async function main() {
  console.log("⏳ running full analysis pipeline (search + LLM)...");
  const { result, raw } = await runAnalysis(fakeProject);

  if (!result) {
    console.error("❌ LLM did not return parseable JSON. Raw output:");
    console.error(raw.slice(0, 1000));
    process.exit(1);
  }

  const total = result.dimensions.reduce((s, d) => s + d.score, 0);
  console.log(`✅ analysis parsed: ${total}/${result.dimensions.length * 10} — ${result.verdict}`);
  for (const d of result.dimensions) console.log(`   ${d.emoji} ${d.name}: ${d.score}/10`);
  console.log(`   🚩 ${result.redFlags.length} red flags, ✅ ${result.goodPoints.length} good points, 🎯 ${result.nextSteps.length} next steps`);

  const carousel = buildAnalysisFlex(fakeProject.name, result);
  await validateWithLine([{ type: "flex", altText: "test", contents: carousel }]);
  console.log("✅ analysis Flex carousel passed LINE validation");

  const statusBubble = buildStatusFlex({
    ...fakeProject,
    milestones: [
      { id: "m1", projectId: "test", description: "ทำ wireframe เสร็จ", createdAt: new Date("2026-05-15") },
      { id: "m2", projectId: "test", description: "prototype กล่องยาใช้งานได้", createdAt: new Date("2026-06-01") },
    ],
  });
  await validateWithLine([{ type: "flex", altText: "test", contents: statusBubble }]);
  console.log("✅ status Flex bubble passed LINE validation");
}

main().catch((err) => {
  console.error("❌ test failed:", err);
  process.exit(1);
});
