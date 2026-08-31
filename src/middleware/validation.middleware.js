const { z } = require("zod");

/**
 * Validate request body against a Zod schema
 */
const validateBody = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof z.ZodError || err.issues) {
      const issues = err.issues || err.errors || [];
      return res.status(400).json({
        msg: "Validation error",
        errors: issues.map((e) => ({
          field: (e.path || []).join("."),
          message: e.message,
        })),
      });
    }
    return res.status(400).json({ msg: "Malformed request body" });
  }
};

/**
 * Schemas for Interview Operations
 */
const scheduleInterviewSchema = z.object({
  applicationId: z.string().min(1, "Application ID is required"),
  scheduledStart: z.string().or(z.date()).refine((d) => !isNaN(new Date(d).getTime()), {
    message: "Invalid date format for scheduledStart",
  }).refine((d) => new Date(d).getTime() > Date.now() - 60 * 1000, { message: "scheduledStart must be in the future" }),
  title: z.string().min(2).max(120).optional(),
  templateId: z.string().optional(),
});

const updateStageSchema = z.object({
  stage: z.enum([
    "WAITING_ROOM",
    "INTRODUCTION",
    "CODING",
    "SYSTEM_DESIGN",
    "DEBUGGING",
    "DISCUSSION",
    "QUESTIONS",
    "FEEDBACK",
    "COMPLETED",
  ], {
    errorMap: () => ({ message: "Invalid interview stage" }),
  }),
});

const executeCodeSchema = z.object({
  language: z.enum(["javascript", "python", "typescript", "cpp", "go", "java", "ruby", "rust"], {
    errorMap: () => ({ message: "Unsupported programming language for execution" }),
  }),
  code: z.string().min(1, "Source code cannot be empty").max(100000, "Source code exceeds size limit (100KB)"),
  stdin: z.string().max(10000, "Stdin exceeds limit").optional(),
});

const runTestsSchema = z.object({
  language: z.enum(["javascript", "python", "typescript", "cpp", "go", "java", "ruby", "rust"], {
    errorMap: () => ({ message: "Unsupported programming language" }),
  }),
  code: z.string().min(1, "Source code cannot be empty").max(100000),
  testCases: z.array(z.object({
    input: z.string().max(10000),
    expectedOutput: z.string().max(10000),
    isHidden: z.boolean().optional(),
  })).min(1).max(50),
});

const createEvaluationSchema = z.object({
  overallRating: z.number().min(1).max(5).optional(),
  decision: z.enum(["STRONG_HIRE", "HIRE", "LEAN_HIRE", "LEAN_REJECT", "NO_HIRE", "STRONG_NO_HIRE", "REJECT", "PENDING"]).optional(),
  // Legacy competencies (category) or new 4-pillar contract (pillar)
  competencies: z.array(
    z.object({
      category: z.string().min(1).optional(),
      pillar: z.enum(["problem_solving", "coding_algorithms", "system_design", "communication"]).optional(),
      score: z.number().min(1).max(5),
      notes: z.string().optional(),
      rationale: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      label: z.string().optional(),
      rubricLevel: z.string().optional(),
      signalsObserved: z.array(z.string()).optional(),
      evidenceRefs: z.array(
        z.object({
          refType: z.enum([
            "TRANSCRIPT",
            "CODE_CHECKPOINT",
            "EXECUTION",
            "WHITEBOARD_SNAPSHOT",
            "TIMELINE_EVENT",
            "NOTE",
            "EXECUTION_RESULT",
          ]),
          type: z.string().optional(),
          timelineEventId: z.string().nullable().optional(),
          checkpointId: z.string().nullable().optional(),
          snapshotId: z.string().nullable().optional(),
          quote: z.string().nullable().optional(),
          note: z.string().nullable().optional(),
          summary: z.string().nullable().optional(),
          offsetMs: z.number().nullable().optional(),
          locator: z.any().optional(),
          verificationHash: z.string().optional(),
          id: z.string().optional(),
        })
      ).min(1, "Each competency must have at least one verifiable evidence link").optional(),
      evidenceReferences: z.array(z.any()).optional(),
    }).passthrough()
  ).optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  privateNotes: z.string().optional(),
  schemaVersion: z.string().optional(),
  engineVersion: z.string().optional(),
});

module.exports = {
  validateBody,
  scheduleInterviewSchema,
  updateStageSchema,
  executeCodeSchema,
  runTestsSchema,
  createEvaluationSchema,
};
