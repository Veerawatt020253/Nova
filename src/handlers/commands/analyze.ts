import { prisma } from "../../db/client.js";
import { pushFlex, pushText, replyText, showTyping, stripMarkdown } from "../../services/line.js";
import { runAnalysis } from "../../services/analyzer.js";
import { buildAnalysisFlex } from "../../services/flex.js";

/**
 * /analyze — reply immediately (LINE webhook must respond fast), then run the
 * search + LLM pipeline in the background and push the result.
 */
export async function handleAnalyze(replyToken: string, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      activeProject: {
        include: { milestones: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  const project = user?.activeProject;

  if (!project) {
    await replyText(
      replyToken,
      "ยังไม่มีโครงงานที่เลือกอยู่ — พิมพ์ /new เพื่อสร้าง หรือ /switch เพื่อเลือกโครงงาน"
    );
    return;
  }

  await replyText(replyToken, "🔍 กำลังค้นหานวัตกรรมที่มีอยู่แล้ว... รอสักครู่นะ (~1 นาที)");

  // Fire-and-forget: don't block the webhook response
  void (async () => {
    try {
      showTyping(userId, 60);
      const { result, raw } = await runAnalysis(project, project.milestones);

      await prisma.project.update({
        where: { id: project.id },
        data: {
          lastAnalysis: result ? JSON.stringify(result) : raw,
          lastAnalyzedAt: new Date(),
        },
      });

      if (result) {
        const total = result.dimensions.reduce((s, d) => s + d.score, 0);
        await pushFlex(
          userId,
          `ผลประเมิน ${project.name}: ${total}/${result.dimensions.length * 10} — ${result.verdict}`,
          buildAnalysisFlex(project.name, result)
        );
      } else {
        // LLM didn't return valid JSON — degrade to clean plain text
        await pushText(userId, stripMarkdown(raw));
      }
    } catch (err) {
      console.error("/analyze pipeline failed:", err);
      await pushText(userId, "❌ การวิเคราะห์ล้มเหลว ลองใหม่อีกครั้งด้วย /analyze นะ").catch(
        () => {}
      );
    }
  })();
}
