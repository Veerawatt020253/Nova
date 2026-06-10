import type { Milestone, Project } from "@prisma/client";
import { generate } from "./llm.js";
import { searchSerper, type SerperResult } from "./search/serper.js";
import { searchSemantic } from "./search/semantic.js";
import { searchGithub } from "./search/github.js";
import { buildAnalyzePrompt, type AnalysisResult } from "../prompts/analyze.js";

/**
 * Extract short English search keywords from the project so academic/code
 * search works well (those APIs perform poorly with long Thai sentences).
 */
async function extractKeywords(project: Project): Promise<string> {
  try {
    const text = await generate(
      `Extract 3-5 short English search keywords (space-separated, no punctuation, no explanations) that best describe this innovation project for searching similar products and papers.

Name: ${project.name}
Problem: ${project.problem}
Solution: ${project.solution}
Tech Stack: ${project.techStack}

Respond with ONLY the keywords on one line.`
    );
    const keywords = text.trim().split("\n")[0]?.trim();
    if (keywords) return keywords;
  } catch (err) {
    console.error("Keyword extraction failed, falling back to project name:", err);
  }
  return project.name;
}

async function searchCommercial(project: Project, keywords: string): Promise<SerperResult[]> {
  const queries = [
    `${project.problem} solution startup`,
    `${project.name} OR ${keywords} site:producthunt.com OR site:github.com`,
    `${project.problem} Thailand innovation`,
  ];
  const results = await Promise.all(queries.map((q) => searchSerper(q)));
  return results.flat();
}

/** Parse the LLM's JSON output (tolerates ```json fences and stray text). */
export function parseAnalysis(raw: string): AnalysisResult | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as AnalysisResult;
    if (!parsed.overview || !Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) {
      return null;
    }
    // Normalize so the flex builder never sees bad data
    parsed.dimensions = parsed.dimensions.map((d) => ({
      name: d.name ?? "",
      emoji: d.emoji ?? "📌",
      score: Math.max(0, Math.min(10, Math.round(Number(d.score) || 0))),
      comment: d.comment ?? "",
      points: Array.isArray(d.points) ? d.points.filter(Boolean) : [],
    }));
    parsed.redFlags = Array.isArray(parsed.redFlags) ? parsed.redFlags.filter(Boolean) : [];
    parsed.goodPoints = Array.isArray(parsed.goodPoints) ? parsed.goodPoints.filter(Boolean) : [];
    parsed.nextSteps = Array.isArray(parsed.nextSteps) ? parsed.nextSteps.filter(Boolean) : [];
    parsed.verdict = (["ผ่าน", "ผ่านแบบมีเงื่อนไข", "ไม่ผ่าน"] as const).includes(parsed.verdict)
      ? parsed.verdict
      : "ผ่านแบบมีเงื่อนไข";
    parsed.verdictReason = parsed.verdictReason ?? "";
    return parsed;
  } catch {
    return null;
  }
}

export interface AnalysisOutcome {
  result: AnalysisResult | null;
  raw: string;
}

export async function runAnalysis(
  project: Project,
  milestones: Milestone[] = []
): Promise<AnalysisOutcome> {
  const keywords = await extractKeywords(project);

  const [serperResults, scholarResults, githubResults] = await Promise.all([
    searchCommercial(project, keywords),
    searchSemantic(`${keywords} innovation`),
    searchGithub(`${keywords} in:readme,description`),
  ]);

  const prompt = buildAnalyzePrompt(project, milestones, serperResults, scholarResults, githubResults);
  const raw = await generate(prompt);
  return { result: parseAnalysis(raw), raw };
}
