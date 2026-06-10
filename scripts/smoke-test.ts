import { prisma } from "../src/db/client.js";
import { generate } from "../src/services/llm.js";
import { searchSerper } from "../src/services/search/serper.js";

async function main() {
  const users = await prisma.user.count();
  console.log(`✅ DB connected — users table exists (${users} rows)`);

  const llmReply = await generate("ตอบคำว่า 'ทดสอบสำเร็จ' คำเดียว");
  console.log(`✅ OpenRouter: ${llmReply.trim().slice(0, 50)}`);

  const results = await searchSerper("innovation Thailand");
  console.log(`✅ Serper: ได้ผลลัพธ์ ${results.length} รายการ`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ smoke test failed:", err);
  process.exit(1);
});
