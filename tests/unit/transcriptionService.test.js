const transcriptionService = require("../../src/services/transcriptionService");
const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const TimelineEvent = require("../../src/models/TimelineEvent");

describe("Feature 11: Real-Time Audio Transcription & Slicing", () => {
  let seekerUser;
  let recruiterUser;
  let sessionDoc;
  let roomKey;

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Seeker Dev",
      email: `seeker_trans_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_transcription",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_trans_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_transcription",
    });

    const jobDoc = await Job.create({
      title: "Audio ML Engineer",
      description: "Speech recognition specialist.",
      company: "SpeechAI",
      recruiter: recruiterUser._id,
      tenantId: "tenant_transcription",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_transcription",
    });

    roomKey = `room-trans-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_transcription",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey,
      scheduledStart: new Date(),
    });
  });

  test("Test 1: should record final transcript segment to timeline with accurate offsetMs", async () => {
    const event = await transcriptionService.recordTranscriptSegment({
      sessionId: sessionDoc._id,
      participantId: seekerUser._id,
      participantRole: "seeker",
      text: "I used a hash map to achieve O(1) average lookup time.",
      isFinal: true,
      offsetMs: 4500,
    });

    expect(event).not.toBeNull();
    expect(event.pipeline).toBe("COMMUNICATION");
    expect(event.eventType).toBe("transcript.final");
    expect(event.offsetMs).toBe(4500);
    expect(event.payload.text).toContain("hash map");
  });

  test("Test 2: should record interim transcript chunks with transcript.interim event type", async () => {
    const event = await transcriptionService.recordTranscriptSegment({
      sessionId: sessionDoc._id,
      participantId: recruiterUser._id,
      participantRole: "recruiter",
      text: "Can you explain...",
      isFinal: false,
      offsetMs: 2000,
    });

    expect(event).not.toBeNull();
    expect(event.eventType).toBe("transcript.interim");
    expect(event.payload.isFinal).toBe(false);
  });

  test("Test 3: should format dialogue history chronologically from timeline events", async () => {
    const ev1 = await TimelineEvent.create({
      session: sessionDoc._id,
      pipeline: "COMMUNICATION",
      eventType: "transcript.final",
      offsetMs: 1000,
      participant: recruiterUser._id,
      participantRole: "recruiter",
      payload: { text: "What is your approach?" },
    });

    const ev2 = await TimelineEvent.create({
      session: sessionDoc._id,
      pipeline: "COMMUNICATION",
      eventType: "transcript.final",
      offsetMs: 3000,
      participant: seekerUser._id,
      participantRole: "seeker",
      payload: { text: "I will use dynamic programming." },
    });

    const populated = await TimelineEvent.find({ session: sessionDoc._id })
      .populate("participant", "name role")
      .sort({ offsetMs: 1 });

    const dialogue = transcriptionService.formatDialogueHistory(populated);
    expect(dialogue.length).toBe(2);
    expect(dialogue[0].text).toBe("What is your approach?");
    expect(dialogue[1].text).toBe("I will use dynamic programming.");
  });
});
