const OllamaProvider = require("../../src/modules/ai/providers/ollama.provider");
const providerFactory = require("../../src/modules/ai/providers/provider.factory");

describe("Ollama Local LLM Provider Unit Tests", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should initialize with default host and qwen2.5:3b model", () => {
    const provider = new OllamaProvider();
    expect(provider.name).toBe("Local Ollama");
    expect(provider.host).toBe(process.env.OLLAMA_HOST || "http://localhost:11434");
    expect(provider.modelName).toBe(process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct");
  });

  it("should report available when Ollama endpoint responds 200 OK", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "qwen2.5:3b-instruct" }] }),
    });

    const provider = new OllamaProvider();
    const available = await provider.isAvailable();
    expect(available).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.any(Object));
  });

  it("should report unavailable when Ollama endpoint fails or is offline", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:11434"));

    const provider = new OllamaProvider();
    const available = await provider.isAvailable();
    expect(available).toBe(false);
  });

  it("should call /api/generate with format: json and return generated text", async () => {
    const mockJsonResponse = JSON.stringify({
      skills: ["Python", "Docker"],
      experience: [],
      education: { degree: "B.Tech", college: "IIT Delhi", cgpa: 9.0, tier: "tier1" },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: mockJsonResponse }),
    });

    const provider = new OllamaProvider();
    const result = await provider.generateJSON("Extract skills from resume", {
      model: "qwen2.5:3b-instruct",
      temperature: 0.1,
    });

    expect(result).toBe(mockJsonResponse);
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:11434/api/generate", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"format":"json"'),
    }));
  });

  it("should place Ollama first when preferredProvider is 'ollama'", async () => {
    providerFactory.ollama.isAvailable = jest.fn().mockResolvedValue(true);
    providerFactory.gemini.isAvailable = jest.fn().mockResolvedValue(true);

    const cascade = await providerFactory.getProvidersCascade("ollama");
    expect(cascade[0].name).toBe("Local Ollama");
    expect(cascade.some((p) => p.name === "Google Gemini")).toBe(true);
  });
});
