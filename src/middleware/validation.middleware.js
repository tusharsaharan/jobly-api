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
  }),
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

const createEvaluationSchema = z.object({
  overallRating: z.number().min(1).max(5),
  decision: z.enum(["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE", "PENDING"]),
  competencies: z.array(
    z.object({
      category: z.string().min(1),
      score: z.number().min(1).max(5),
      notes: z.string().optional(),
      evidenceRefs: z.array(
        z.object({
          refType: z.enum([
            "TRANSCRIPT",
            "CODE_CHECKPOINT",
            "EXECUTION",
            "WHITEBOARD_SNAPSHOT",
            "TIMELINE_EVENT",
            "NOTE",
          ]),
          timelineEventId: z.string().nullable().optional(),
          checkpointId: z.string().nullable().optional(),
          snapshotId: z.string().nullable().optional(),
          quote: z.string().nullable().optional(),
          note: z.string().nullable().optional(),
        })
      ).min(1, "Each competency must have at least one verifiable evidence link"),
    })
  ).optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  privateNotes: z.string().optional(),
});

module.exports = {
  validateBody,
  scheduleInterviewSchema,
  updateStageSchema,
  executeCodeSchema,
  createEvaluationSchema,
};
