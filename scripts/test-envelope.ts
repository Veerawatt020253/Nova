// Regression test: the exact unescaped-quote failure must now render as flex,
// plus a live JSON-mode call.
import { chat, extractJson } from "../src/services/llm.js";
import { buildAskSystemPrompt } from "../src/prompts/ask.js";

const broken = `{"format":"flex","title":"เริ่มต้นจาก PoC: พิสูจน์ใจความ","emoji":"🚀","sections":[{"heading":"แล้วจะเริ่ม PoC เรื่อง "กลไกการปรับเทียบพารามิเตอร์เชิงพฤติกรรม" ยังไงดี?","bullets":["1. กำหนดขอบเขตให้แคบที่สุด","2. เลือกพฤติกรรมหลักที่จะจำลอง"],"numbered":true}],"footer":"จบ 😊"}`;

async function main() {
  const fixed = extractJson<{ format: string; title: string; sections: unknown[] }>(broken);
  if (fixed?.format === "flex" && fixed.sections.length > 0) {
    console.log(`✅ regression: broken payload now parses → flex "${fixed.title}"`);
  } else {
    console.error("❌ regression: still unparseable"); process.exit(1);
  }

  const sys = buildAskSystemPrompt(null, []);
  const raw = await chat(sys, [], "แนะนำ 3 ขั้นตอนเตรียมตัว pitch โครงงานหน่อย", { json: true });
  const parsed = extractJson<{ format: string }>(raw);
  console.log(`✅ live JSON mode: format=${parsed?.format} (parsed OK)`);
}
main().catch((e) => { console.error("❌", e); process.exit(1); });
