const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "file"; file: { filename: string; file_data: string } };

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

async function callOpenRouter(messages: OpenRouterMessage[]): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!}`,
      "Content-Type": "application/json",
      // Optional attribution headers (shown on openrouter.ai rankings)
      "X-Title": "innovation-bot",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Single-shot generation with an optional system prompt.
 */
export async function generate(prompt: string, systemPrompt?: string): Promise<string> {
  const messages: OpenRouterMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  return callOpenRouter(messages);
}

/**
 * Generation with a PDF attached — the model reads the document natively
 * (Gemini handles Thai text and scanned PDFs via OCR).
 */
export async function generateWithPdf(
  prompt: string,
  pdfBuffer: Buffer,
  filename: string
): Promise<string> {
  const messages: OpenRouterMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "file",
          file: {
            filename,
            file_data: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
          },
        },
        { type: "text", text: prompt },
      ],
    },
  ];
  return callOpenRouter(messages);
}

/**
 * Multi-turn chat: conversation history + new user message.
 */
export async function chat(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];
  return callOpenRouter(messages);
}
