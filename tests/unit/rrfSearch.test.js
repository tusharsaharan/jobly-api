const { BM25Engine, tokenize } = require("../../src/modules/search/bm25");
const { EmbeddingEngine, cosineSimilarity } = require("../../src/modules/search/embeddings");
const { RRFSearchEngine } = require("../../src/modules/search/rrfEngine");

describe("Hybrid Search Engine (BM25 + Dense Embeddings + RRF)", () => {
  const sampleJobs = [
    {
      _id: "job-1",
      title: "Senior React Developer",
      company: "Tech Corp",
      description: "Building modern frontend web apps with React, TypeScript, Redux, and Tailwind CSS.",
      skills: ["React", "TypeScript", "Redux", "Tailwind CSS"],
    },
    {
      _id: "job-2",
      title: "Backend Node.js Architect",
      company: "CloudScale",
      description: "Designing microservices and distributed event-driven systems using Node.js, Express, MongoDB, and Redis.",
      skills: ["Node.js", "Express", "MongoDB", "Redis", "Kafka"],
    },
    {
      _id: "job-3",
      title: "Machine Learning & AI Engineer",
      company: "DataMinds",
      description: "Developing LLM applications, embeddings, PyTorch models, and Python microservices.",
      skills: ["Python", "PyTorch", "LLM", "Embeddings", "FastAPI"],
    },
    {
      _id: "job-4",
      title: "Full Stack Engineer (React & Node)",
      company: "StartupLab",
      description: "Full stack engineering across TypeScript, React UI, Node backend, and PostgreSQL database.",
      skills: ["React", "Node.js", "TypeScript", "PostgreSQL"],
    },
  ];

  const jobTextExtractor = (j) =>
    `${j.title} ${j.company} ${j.description} ${(j.skills || []).join(" ")}`;

  describe("BM25 Lexical Ranking", () => {
    const bm25 = new BM25Engine({ k1: 1.2, b: 0.75 });

    test("tokenizes and cleans query text correctly", () => {
      const tokens = tokenize("Looking for a Senior React.js & TypeScript Engineer!");
      expect(tokens).toContain("senior");
      expect(tokens).toContain("react");
      expect(tokens).toContain("typescript");
      expect(tokens).toContain("engineer");
      expect(tokens).not.toContain("for");
      expect(tokens).not.toContain("a");
    });

    test("ranks exact keyword match highest", () => {
      const ranked = bm25.rank(sampleJobs, jobTextExtractor, "React TypeScript");
      expect(ranked.length).toBe(4);
      expect(ranked[0].item.title).toMatch(/React/);
      expect(ranked[0].bm25Score).toBeGreaterThan(0);
      expect(ranked[0].matchedTokens.length).toBeGreaterThanOrEqual(1);
    });

    test("returns zero scores for queries with no matching terms", () => {
      const ranked = bm25.rank(sampleJobs, jobTextExtractor, "Astronaut Rocket");
      expect(ranked.every((r) => r.bm25Score === 0)).toBe(true);
    });
  });

  describe("Dense Embedding & Cosine Similarity Ranking", () => {
    const embedder = new EmbeddingEngine();

    test("computes valid cosine similarity between 0 and 1", async () => {
      const vecA = await embedder.embedQuery("React frontend developer");
      const vecB = await embedder.embedQuery("React UI engineer");
      const sim = cosineSimilarity(vecA, vecB);
      expect(sim).toBeGreaterThan(0.2);
      expect(sim).toBeLessThanOrEqual(1.0);
    });

    test("ranks semantically relevant documents near the top", async () => {
      const ranked = await embedder.rank(sampleJobs, jobTextExtractor, "Deep learning neural network models");
      expect(ranked.length).toBe(4);
      expect(ranked[0].item.title).toBe("Machine Learning & AI Engineer");
    });
  });

  describe("Reciprocal Rank Fusion (RRF)", () => {
    const rrf = new RRFSearchEngine({ k: 60, wBM25: 1.0, wDense: 1.0 });

    test("correctly fuses rankings and returns sorted scores with metadata", async () => {
      const results = await rrf.search(sampleJobs, jobTextExtractor, "Node backend microservices Redis");
      expect(results.length).toBe(4);
      expect(results[0].item.title).toBe("Backend Node.js Architect");
      expect(results[0].rrfScore).toBeGreaterThan(0);
      expect(results[0].bm25Rank).toBe(1);
      expect(results[0].vectorRank).toBe(1);
    });

    test("handles full stack search with hybrid precision", async () => {
      const results = await rrf.search(sampleJobs, jobTextExtractor, "full stack react node");
      expect(results[0].item.title).toBe("Full Stack Engineer (React & Node)");
      expect(results[0].matchedTokens).toContain("full");
      expect(results[0].matchedTokens).toContain("stack");
    });

    test("handles empty query gracefully", async () => {
      const results = await rrf.search(sampleJobs, jobTextExtractor, "");
      expect(results.length).toBe(4);
    });
  });
});
