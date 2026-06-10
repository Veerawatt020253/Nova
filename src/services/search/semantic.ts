export interface ScholarPaper {
  title: string;
  abstract: string | null;
  year: number | null;
  authors: Array<{ name: string }>;
}

export async function searchSemantic(query: string): Promise<ScholarPaper[]> {
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
      query
    )}&fields=title,abstract,year,authors&limit=3`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Semantic Scholar search failed (${res.status}): ${await res.text()}`);
      return [];
    }
    const data = (await res.json()) as { data?: ScholarPaper[] };
    return data.data ?? [];
  } catch (err) {
    console.error("Semantic Scholar search error:", err);
    return [];
  }
}
