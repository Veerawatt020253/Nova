export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
}

export async function searchSerper(query: string): Promise<SerperResult[]> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5, gl: "th", hl: "th" }),
    });
    if (!res.ok) {
      console.error(`Serper search failed (${res.status}): ${await res.text()}`);
      return [];
    }
    const data = (await res.json()) as { organic?: SerperResult[] };
    return data.organic?.slice(0, 5) ?? [];
  } catch (err) {
    console.error("Serper search error:", err);
    return [];
  }
}
