import { messagingApi } from "@line/bot-sdk";

export const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
};

export const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken,
});

const MAX_TEXT_LENGTH = 5000; // LINE text message limit

function chunkText(text: string): string[] {
  if (text.length <= MAX_TEXT_LENGTH) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_TEXT_LENGTH) {
    chunks.push(text.slice(i, i + MAX_TEXT_LENGTH));
  }
  return chunks.slice(0, 5); // LINE allows max 5 messages per request
}

export async function replyText(replyToken: string, text: string): Promise<void> {
  await lineClient.replyMessage({
    replyToken,
    messages: chunkText(text).map((t) => ({ type: "text", text: t })),
  });
}

/**
 * Reply with text + quick-reply choice buttons (LINE's "ask the user" UI).
 * Tapping a button sends its text back as a normal user message.
 * LINE limits: 13 items, label ≤ 20 chars.
 */
export async function replyTextWithChoices(
  replyToken: string,
  text: string,
  options: string[]
): Promise<void> {
  const items = options
    .filter(Boolean)
    .slice(0, 13)
    .map((opt) => ({
      type: "action" as const,
      action: {
        type: "message" as const,
        label: opt.length > 20 ? opt.slice(0, 19) + "…" : opt,
        text: opt.slice(0, 300),
      },
    }));

  await lineClient.replyMessage({
    replyToken,
    messages: [
      {
        type: "text",
        text: text.slice(0, MAX_TEXT_LENGTH),
        quickReply: items.length > 0 ? { items } : undefined,
      },
    ],
  });
}

export async function pushText(userId: string, text: string): Promise<void> {
  await lineClient.pushMessage({
    to: userId,
    messages: chunkText(text).map((t) => ({ type: "text", text: t })),
  });
}

export async function replyFlex(
  replyToken: string,
  altText: string,
  contents: object
): Promise<void> {
  await lineClient.replyMessage({
    replyToken,
    messages: [
      {
        type: "flex",
        altText,
        contents: contents as messagingApi.FlexContainer,
      },
    ],
  });
}

export async function pushTextWithChoices(
  userId: string,
  text: string,
  options: string[]
): Promise<void> {
  const items = options
    .filter(Boolean)
    .slice(0, 13)
    .map((opt) => ({
      type: "action" as const,
      action: {
        type: "message" as const,
        label: opt.length > 20 ? opt.slice(0, 19) + "…" : opt,
        text: opt.slice(0, 300),
      },
    }));

  await lineClient.pushMessage({
    to: userId,
    messages: [
      {
        type: "text",
        text: text.slice(0, MAX_TEXT_LENGTH),
        quickReply: items.length > 0 ? { items } : undefined,
      },
    ],
  });
}

export async function pushFlex(
  userId: string,
  altText: string,
  contents: object
): Promise<void> {
  await lineClient.pushMessage({
    to: userId,
    messages: [
      {
        type: "flex",
        altText,
        contents: contents as messagingApi.FlexContainer,
      },
    ],
  });
}

/**
 * Download message content (e.g. an uploaded PDF) from the LINE data API.
 */
export async function downloadContent(messageId: string): Promise<Buffer> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${lineConfig.channelAccessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LINE content download failed (${res.status}): ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * LINE chat cannot render markdown — strip whatever formatting the LLM
 * sneaks in so text messages stay clean.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^```[^\n]*$/gm, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
