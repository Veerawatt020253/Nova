import Fastify from "fastify";
import { validateSignature, type WebhookEvent } from "@line/bot-sdk";
import { lineConfig } from "./services/line.js";
import { handlePostback, handleTextMessage } from "./handlers/message.js";
import { handleFileMessage } from "./handlers/commands/document.js";

const app = Fastify({ logger: true });

// Keep the raw body so we can verify the LINE signature
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (_req, body, done) => done(null, body)
);

app.get("/health", async () => ({ ok: true }));

app.post("/webhook", async (req, reply) => {
  const signature = req.headers["x-line-signature"] as string | undefined;
  const rawBody = req.body as Buffer;

  if (!signature || !validateSignature(rawBody, lineConfig.channelSecret, signature)) {
    return reply.status(401).send({ error: "invalid signature" });
  }

  const { events } = JSON.parse(rawBody.toString("utf-8")) as { events: WebhookEvent[] };

  // Acknowledge quickly; LINE retries the whole batch if we time out
  for (const event of events) {
    try {
      if (event.type === "message" && event.message.type === "text") {
        await handleTextMessage(event);
      } else if (event.type === "message" && event.message.type === "file") {
        await handleFileMessage(event);
      } else if (event.type === "postback") {
        await handlePostback(event);
      }
    } catch (err) {
      req.log.error({ err, eventType: event.type }, "event handler failed");
    }
  }

  return reply.send({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`innovation-bot listening on :${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
