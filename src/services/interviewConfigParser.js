/**
 * Interview OS Configuration Parser & Pretty-Printer
 * Parses YAML / JSON / Text DSL templates for structured technical interview definitions
 */

const DEFAULT_STAGES = [
  { name: "INTRODUCTION", durationMinutes: 5 },
  { name: "CODING", durationMinutes: 35 },
  { name: "SYSTEM_DESIGN", durationMinutes: 15 },
  { name: "WRAP_UP", durationMinutes: 5 },
];

/**
 * Parse an interview configuration string (YAML / JSON / Key-Value DSL)
 */
function parseInterviewConfig(rawContent) {
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("Configuration content must be a non-empty string");
  }

  const trimmed = rawContent.trim();

  // 1. JSON parsing
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeConfig(parsed);
    } catch (err) {
      throw new Error(`JSON parse error: ${err.message}`);
    }
  }

  // 2. Key-Value / YAML-like lines parsing
  const lines = trimmed.split("\n");
  const config = {
    title: "Technical Interview",
    allowedLanguages: ["javascript", "python"],
    stages: [],
    problems: [],
    scoringWeights: {},
  };

  let currentSection = null;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("title:")) {
      config.title = line.replace("title:", "").trim();
    } else if (line.startsWith("languages:")) {
      const langs = line.replace("languages:", "").trim().split(",");
      config.allowedLanguages = langs.map((l) => l.trim().toLowerCase()).filter(Boolean);
    } else if (line.startsWith("stages:")) {
      currentSection = "stages";
    } else if (line.startsWith("problems:")) {
      currentSection = "problems";
    } else if (line.startsWith("weights:")) {
      currentSection = "weights";
    } else if (line.startsWith("-") && currentSection === "stages") {
      const stageName = line.replace("-", "").trim();
      config.stages.push({ name: stageName, durationMinutes: 15 });
    } else if (line.startsWith("-") && currentSection === "problems") {
      const probTitle = line.replace("-", "").trim();
      config.problems.push({ title: probTitle, starterCode: "" });
    } else if (line.includes(":") && currentSection === "weights") {
      const [cat, weight] = line.split(":");
      config.scoringWeights[cat.trim()] = Number(weight.trim()) || 1;
    }
  }

  if (config.stages.length === 0) {
    config.stages = DEFAULT_STAGES;
  }

  return normalizeConfig(config);
}

/**
 * Normalize and validate configuration object
 */
function normalizeConfig(config) {
  const normalized = {
    title: config.title || "Technical Interview",
    allowedLanguages: Array.isArray(config.allowedLanguages) && config.allowedLanguages.length > 0
      ? config.allowedLanguages.map((l) => String(l).toLowerCase().trim())
      : ["javascript", "python", "typescript"],
    stages: Array.isArray(config.stages) && config.stages.length > 0
      ? config.stages.map((s) => (typeof s === "string" ? { name: s, durationMinutes: 15 } : s))
      : DEFAULT_STAGES,
    problems: Array.isArray(config.problems) ? config.problems : [],
    scoringWeights: config.scoringWeights || {
      problemSolving: 0.35,
      codeQuality: 0.25,
      systemDesign: 0.25,
      communication: 0.15,
    },
  };

  return normalized;
}

/**
 * Format and pretty-print a normalized configuration object into clean human-readable DSL
 */
function formatInterviewConfig(config) {
  const norm = normalizeConfig(config);

  const lines = [
    `# Jobly Interview OS Configuration`,
    `title: ${norm.title}`,
    `languages: ${norm.allowedLanguages.join(", ")}`,
    ``,
    `stages:`,
    ...norm.stages.map((s) => `  - ${s.name} (${s.durationMinutes || 15}m)`),
    ``,
    `weights:`,
    ...Object.entries(norm.scoringWeights).map(([k, v]) => `  ${k}: ${v}`),
  ];

  if (norm.problems.length > 0) {
    lines.push(``, `problems:`);
    norm.problems.forEach((p) => {
      lines.push(`  - ${p.title || p}`);
    });
  }

  return lines.join("\n");
}

module.exports = {
  parseInterviewConfig,
  formatInterviewConfig,
  normalizeConfig,
};
