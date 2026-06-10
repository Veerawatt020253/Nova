export interface GithubRepo {
  name: string;
  description: string | null;
  stars: number;
  url: string;
}

export async function searchGithub(query: string): Promise<GithubRepo[]> {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
      query
    )}&sort=stars&per_page=5`;
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      console.error(`GitHub search failed (${res.status}): ${await res.text()}`);
      return [];
    }
    const data = (await res.json()) as {
      items?: Array<{
        full_name: string;
        description: string | null;
        stargazers_count: number;
        html_url: string;
      }>;
    };
    return (
      data.items?.map((r) => ({
        name: r.full_name,
        description: r.description,
        stars: r.stargazers_count,
        url: r.html_url,
      })) ?? []
    );
  } catch (err) {
    console.error("GitHub search error:", err);
    return [];
  }
}
