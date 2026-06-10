import { prisma } from "../../db/client.js";
import { replyFlex, replyText } from "../../services/line.js";
import { buildStatusFlex } from "../../services/flex.js";

/** /status — show active project progress as a Flex bubble. */
export async function handleStatus(replyToken: string, userId: string): Promise<void> {
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

  await replyFlex(replyToken, `สถานะ ${project.name}`, buildStatusFlex(project));
}
