function buildGoogleSearchUrl(topic, category) {
  const base = "https://www.google.com/search?q=";
  const sites = [
    "site:geeksforgeeks.org",
    "site:leetcode.com",
    "site:github.com/donnemartin/system-design-primer",
    "site:interviewing.io",
    "site:systemdesignprimer.com"
  ];
  const categoryQueries = {
    "DSA": "algorithm tutorial interview",
    "CS_FUNDAMENTALS": "concept explained tutorial",
    "HLD": "architecture pattern interview",
    "LLD": "design pattern interview",
  };
  const extra = categoryQueries[category] || "interview preparation";
  const query = encodeURIComponent(`${topic} ${extra} ${sites.join(" OR ")}`);
  return `${base}${query}`;
}

/**
 * Build a "Google-like" set of external search links for ANY query (even generic/off-topic).
 * The hero search should always surface actionable web resources — never a dead end.
 * @param {string} query
 * @returns {Array<{ label: string, url: string, type: string, description: string }>}
 */
function buildStudySearchLinks(query) {
  const q = encodeURIComponent(String(query || "").trim());
  if (!q) return [];
  return [
    {
      label: "Google",
      type: "google",
      url: `https://www.google.com/search?q=${q}`,
      description: "Search the open web (blogs, docs, forums, papers).",
    },
    {
      label: "GeeksforGeeks",
      type: "gfg",
      url: `https://www.geeksforgeeks.org/search/?q=${q}`,
      description: "Curated CS tutorials, DSA and interview guides.",
    },
    {
      label: "LeetCode",
      type: "leetcode",
      url: `https://leetcode.com/problemset/all/?search=${q}`,
      description: "Practice problems and company-tagged questions.",
    },
    {
      label: "YouTube",
      type: "youtube",
      url: `https://www.youtube.com/results?search_query=${q}+tutorial`,
      description: "Video walkthroughs and system-design lectures.",
    },
    {
      label: "GitHub",
      type: "github",
      url: `https://github.com/search?q=${q}&type=repositories`,
      description: "Open-source repos, notes and reference implementations.",
    },
    {
      label: "Interview Prep",
      type: "interview",
      url: buildGoogleSearchUrl(query, "CS_FUNDAMENTALS"),
      description: "Interview-focused results from GfG, LeetCode & system-design primer.",
    },
  ];
}

/**
 * Build precise, extensive, categorized study links for a canonical weakness topic.
 * Used by recommendation engine (cachedResources) to enrich cards beyond raw RAG hits.
 * @param {string} topic        Canonical taxonomy topic (e.g. "Dynamic Programming")
 * @param {string} category     "DSA" | "CS_FUNDAMENTALS" | "HLD" | "LLD"
 * @returns {Array<{ title, url, description, type, score, confidence, relevancePct }>}
 */
function buildTopicStudyLinks(topic, category = "CS_FUNDAMENTALS") {
  const t = String(topic || "").trim();
  if (!t) return [];
  const q = encodeURIComponent(t);
  const links = [
    {
      title: `${t} — curated tutorial`,
      url: `https://www.geeksforgeeks.org/search/?q=${q}`,
      description: "GeeksforGeeks deep-dives and interview-asked variations.",
      type: "article",
      score: 0.75,
      confidence: "medium",
    },
    {
      title: `Practice ${t} problems`,
      url: `https://leetcode.com/problemset/all/?search=${q}`,
      description: "LeetCode problems tagged with this topic.",
      type: "practice",
      score: 0.72,
      confidence: "medium",
    },
    {
      title: `${t} — video walkthrough`,
      url: `https://www.youtube.com/results?search_query=${q}+explained`,
      description: "Visual explanations and full lectures.",
      type: "video",
      score: 0.68,
      confidence: "medium",
    },
    {
      title: `${t} — web & docs`,
      url: `https://www.google.com/search?q=${q}`,
      description: "Google web search across official docs and blogs.",
      type: "search",
      score: 0.6,
      confidence: "low",
    },
  ];
  return links.map((l) => ({ ...l, relevancePct: Math.round(l.score * 100) }));
}

module.exports = {
  buildGoogleSearchUrl,
  buildStudySearchLinks,
  buildTopicStudyLinks,
};