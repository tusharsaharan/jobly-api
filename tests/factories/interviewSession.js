const InterviewSession = require("../../src/models/InterviewSession");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const CodeCheckpoint = require("../../src/models/CodeCheckpoint");
const WhiteboardSnapshot = require("../../src/models/WhiteboardSnapshot");
const TimelineEvent = require("../../src/models/TimelineEvent");
const { createTestRecruiter, createTestSeeker } = require("./users");

async function createTestSession(overrides = {}) {
  const recruiter = overrides.recruiter || (await createTestRecruiter());
  const seeker = overrides.seeker || (await createTestSeeker());

  const job =
    overrides.job ||
    (await Job.create({
      title: "Full Stack Engineer",
      company: "Acme Corp",
      recruiter: recruiter._id,
      description: "Build robust applications",
      requirements: ["JavaScript", "Python"],
      skillsRequired: ["javascript"],
    }));

  const application =
    overrides.application ||
    (await Application.create({
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      status: "shortlisted",
    }));

  const uniqueSuffix = Math.random().toString(36).substring(2, 8);
  const defaults = {
    tenantId: "default",
    application: application._id,
    job: job._id,
    seeker: seeker._id,
    recruiter: recruiter._id,
    title: "System Design & Algorithms",
    roomKey: `room-test-${uniqueSuffix}`,
    status: "LIVE",
    stage: "CODING",
    actualStart: new Date(Date.now() - 1000 * 60 * 30),
    scheduledStart: new Date(),
    codeWorkspace: {
      activeFile: "/solution.py",
      files: [
        {
          path: "/solution.py",
          name: "solution.py",
          language: "python",
          content: "def solve():\n    pass\n",
        },
      ],
    },
    allowedLanguages: ["python", "javascript"],
  };

  const session = await InterviewSession.create({ ...defaults, ...overrides });
  return { session, recruiter, seeker, job, application };
}

async function addCheckpointWithOffset(session, { offsetMs, sequenceNumber, files, triggerType = "MANUAL" }) {
  return await CodeCheckpoint.create({
    session: session._id,
    triggerType,
    triggerLabel: `Checkpoint at ${offsetMs}ms`,
    offsetMs,
    sequenceNumber,
    filesSnapshot: files || [
      {
        path: "/solution.py",
        name: "solution.py",
        language: "python",
        content: `# Code at offset ${offsetMs}\n`,
      },
    ],
  });
}

async function addSnapshotWithOffset(session, { offsetMs, sequenceNumber, objects = [] }) {
  return await WhiteboardSnapshot.create({
    session: session._id,
    boardType: "EXCALIDRAW",
    offsetMs,
    sequenceNumber,
    objects,
  });
}

module.exports = {
  createTestSession,
  addCheckpointWithOffset,
  addSnapshotWithOffset,
};
