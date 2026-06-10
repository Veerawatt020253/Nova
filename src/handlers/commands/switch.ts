import { prisma } from "../../db/client.js";
import { replyFlex, replyText } from "../../services/line.js";
import { resetHistory } from "../../services/session.js";

/** /switch — show project list as Flex Message buttons. */
export async function handleSwitch(replyToken: string, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { projects: { orderBy: { updatedAt: "desc" } } },
  });

  const projects = user?.projects ?? [];
  if (projects.length === 0) {
    await replyText(replyToken, "ยังไม่มีโครงงาน — พิมพ์ /new เพื่อสร้างโครงงานแรก");
    return;
  }

  const buttons = projects.slice(0, 10).map((p) => ({
    type: "button",
    style: p.id === user?.activeProjectId ? "primary" : "secondary",
    height: "sm",
    action: {
      type: "postback",
      label:
        (p.id === user?.activeProjectId ? "✓ " : "") +
        (p.name.length > 18 ? p.name.slice(0, 17) + "…" : p.name),
      data: `switch:${p.id}`,
      displayText: `เลือกโครงงาน: ${p.name}`,
    },
  }));

  const bubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "เลือกโครงงาน", weight: "bold", size: "lg" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: buttons,
    },
  };

  await replyFlex(replyToken, "เลือกโครงงาน", bubble);
}

/** Postback handler for the switch buttons. */
export async function handleSwitchPostback(
  replyToken: string,
  userId: string,
  projectId: string
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) {
    await replyText(replyToken, "ไม่พบโครงงานนี้ — พิมพ์ /switch เพื่อดูรายการอีกครั้ง");
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { activeProjectId: project.id },
  });
  await resetHistory(userId); // fresh conversation context per project

  await replyText(replyToken, `✅ สลับไปโครงงาน "${project.name}" แล้ว`);
}
