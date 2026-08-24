const crypto = require("crypto");
const TimelineEvent = require("../../models/TimelineEvent");
const CodeCheckpoint = require("../../models/CodeCheckpoint");
const WhiteboardSnapshot = require("../../models/WhiteboardSnapshot");
const logger = require("../../config/logger");

/**
 * Computes a deterministic verification hash for an evidence locator
 */
function computeVerificationHash(type, offsetMs, locator, summary) {
  const content = JSON.stringify({ type, offsetMs, locator, summary });
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * 1. Create a structured, verified EvidenceReference
 */
function createEvidenceReference({
  type, // "TRANSCRIPT" | "CODE_CHECKPOINT" | "EXECUTION_RESULT" | "WHITEBOARD_SNAPSHOT" | "TIMELINE_EVENT"
  timelineEventId,
  offsetMs,
  locator = {},
  summary,
}) {
  if (!type || !timelineEventId || typeof offsetMs !== "number" || !summary) {
    throw new Error("createEvidenceReference requires type, timelineEventId, offsetMs, and summary");
  }

  const cleanLocator = {
    file: locator.file || undefined,
    startLine: locator.startLine ? Number(locator.startLine) : undefined,
    endLine: locator.endLine ? Number(locator.endLine) : undefined,
    quote: locator.quote ? String(locator.quote).slice(0, 500) : undefined,
    speaker: locator.speaker || undefined,
    snapshotVersion: typeof locator.snapshotVersion === "number" ? locator.snapshotVersion : undefined,
    testCaseIndex: typeof locator.testCaseIndex === "number" ? locator.testCaseIndex : undefined,
    eventType: locator.eventType || undefined,
  };

  const id = `ev-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const verificationHash = computeVerificationHash(type, offsetMs, cleanLocator, summary);

  return {
    id,
    type,
    timelineEventId: String(timelineEventId),
    offsetMs: Math.max(0, Math.floor(offsetMs)),
    locator: cleanLocator,
    summary: summary.slice(0, 300),
    verificationHash,
  };
}

/**
 * 2. Verify that an EvidenceReference corresponds to an existing timeline event
 */
async function verifyEvidenceReference(evidenceRef, sessionId = null) {
  if (!evidenceRef || !evidenceRef.timelineEventId) {
    return { valid: false, reason: "Missing timelineEventId in evidence reference" };
  }

  try {
    const query = { _id: evidenceRef.timelineEventId };
    if (sessionId) query.session = sessionId;

    const event = await TimelineEvent.findOne(query).lean();
    if (!event) {
      return { valid: false, reason: `Referenced timeline event ${evidenceRef.timelineEventId} not found in database` };
    }

    // Verify hash integrity
    const calculatedHash = computeVerificationHash(
      evidenceRef.type,
      evidenceRef.offsetMs,
      evidenceRef.locator,
      evidenceRef.summary
    );

    if (calculatedHash !== evidenceRef.verificationHash) {
      return { valid: false, reason: "Evidence verification hash mismatch (content may have mutated)" };
    }

    return { valid: true, event };
  } catch (err) {
    logger.warn({ err: err.message, evidenceId: evidenceRef.id }, "Evidence verification query error");
    return { valid: false, reason: err.message };
  }
}

/**
 * 3. Resolve the full artifact context for frontend display
 */
async function resolveEvidenceArtifact(evidenceRef, sessionId) {
  if (!evidenceRef) return null;

  try {
    switch (evidenceRef.type) {
      case "CODE_CHECKPOINT": {
        const query = { session: sessionId };
        if (evidenceRef.locator?.file) query["files.path"] = evidenceRef.locator.file;
        const checkpoint = await CodeCheckpoint.findOne(query)
          .sort({ offsetMs: 1 })
          .where("offsetMs")
          .lte(evidenceRef.offsetMs)
          .lean();

        const fileEntry = checkpoint?.files?.find((f) => f.path === evidenceRef.locator?.file) || checkpoint?.files?.[0];
        const lines = fileEntry?.content ? fileEntry.content.split("\n") : [];
        const start = (evidenceRef.locator?.startLine || 1) - 1;
        const end = evidenceRef.locator?.endLine || start + 5;
        const snippet = lines.slice(start, end).join("\n");

        return {
          ...evidenceRef,
          resolvedSnippet: snippet || fileEntry?.content || "",
          fileName: fileEntry?.path || "solution.py",
        };
      }

      case "TRANSCRIPT": {
        return {
          ...evidenceRef,
          quote: evidenceRef.locator?.quote || evidenceRef.summary,
          speaker: evidenceRef.locator?.speaker || "Candidate",
        };
      }

      case "WHITEBOARD_SNAPSHOT": {
        const snapshot = await WhiteboardSnapshot.findOne({ session: sessionId })
          .sort({ offsetMs: 1 })
          .where("offsetMs")
          .lte(evidenceRef.offsetMs)
          .lean();

        return {
          ...evidenceRef,
          elementsCount: snapshot?.elements?.length || 0,
          previewUrl: snapshot?.previewUrl || null,
        };
      }

      case "EXECUTION_RESULT":
      case "TIMELINE_EVENT":
      default: {
        const event = await TimelineEvent.findById(evidenceRef.timelineEventId).lean();
        return {
          ...evidenceRef,
          eventPayload: event?.payload || null,
          pipeline: event?.pipeline || "SYSTEM",
        };
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, evidenceId: evidenceRef.id }, "Error resolving evidence artifact");
    return evidenceRef;
  }
}

module.exports = {
  createEvidenceReference,
  verifyEvidenceReference,
  resolveEvidenceArtifact,
  computeVerificationHash,
};
