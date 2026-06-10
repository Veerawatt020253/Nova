import { extractJson } from "../src/services/llm.js";

// The user's exact truncated output (cut mid-sentence, no closing brace)
const truncated = `{"format":"question","text":"หลังจากที่เรามีแนวทางสำหรับ PoC แล้ว สิ่งสำคัญต่อไปคือการวางแผนว่าไนซ์จะทำ`;
const parsed = extractJson<{ format: string; text: string }>(truncated);
if (parsed?.format === "question" && parsed.text.length > 10) {
  console.log("✅ truncated payload now recovers → format:", parsed.format);
  console.log("   text:", parsed.text.slice(0, 70) + "...");
} else {
  console.error("❌ still broken:", parsed); process.exit(1);
}

// Also: well-formed JSON still works
const ok = extractJson<{ format: string }>(`{"format":"text","text":"สวัสดี"}`);
console.log(ok?.format === "text" ? "✅ normal JSON still parses" : "❌ regression");
