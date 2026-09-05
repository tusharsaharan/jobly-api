require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./src/models/User");
const Job = require("./src/models/Job");
const Application = require("./src/models/Application");
const InterviewSession = require("./src/models/InterviewSession");
const TimelineEvent = require("./src/models/TimelineEvent");
const CodeCheckpoint = require("./src/models/CodeCheckpoint");
const WhiteboardSnapshot = require("./src/models/WhiteboardSnapshot");
const Evaluation = require("./src/models/Evaluation");

async function seedFullInterviews() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobmatch";
  console.log("Connecting to MongoDB at:", mongoUri);
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const hashedPassword = await bcrypt.hash("password123", 10);

  // 1. Recruiters
  const recruiterSarah = await User.findOneAndUpdate(
    { email: "sarah@techcorp.com" },
    {
      name: "Sarah Chen (Senior Technical Recruiter)",
      email: "sarah@techcorp.com",
      password: hashedPassword,
      role: "recruiter",
      company: "TechCorp Systems",
    },
    { upsert: true, new: true }
  );

  const recruiterLegacy = await User.findOneAndUpdate(
    { email: "recruiter@techcorp.com" },
    {
      name: "Sarah Chen (Senior Technical Recruiter)",
      email: "recruiter@techcorp.com",
      password: hashedPassword,
      role: "recruiter",
      company: "TechCorp Systems",
    },
    { upsert: true, new: true }
  );

  // 2. Candidates / Seekers
  const seekerAlex = await User.findOneAndUpdate(
    { email: "alex@example.com" },
    {
      name: "Alex Rivera (Full Stack Engineer)",
      email: "alex@example.com",
      password: hashedPassword,
      role: "seeker",
      skills: ["javascript", "typescript", "react", "nodejs", "python", "docker", "system design", "mongodb"],
      cgpa: 8.9,
      college: "University of Technology",
      collegeTier: "tier1",
      degree: "B.S. Computer Science",
      resumeSummary: "Full stack software engineer with 4+ years of experience building high-throughput web applications, distributed systems, and real-time collaboration tools.",
      experience: [
        { title: "Senior Software Engineer", company: "CloudScale Inc.", duration: "2023 - Present" },
        { title: "Software Engineer", company: "DataFlow Labs", duration: "2021 - 2023" }
      ],
      achievements: [
        "Architected real-time sync service reducing latency by 45%",
        "Top 5% performer in algorithmic coding competitions"
      ]
    },
    { upsert: true, new: true }
  );

  const seekerCandidate = await User.findOneAndUpdate(
    { email: "candidate@example.com" },
    {
      name: "Alex Rivera (Full Stack Engineer)",
      email: "candidate@example.com",
      password: hashedPassword,
      role: "seeker",
      skills: ["javascript", "typescript", "react", "nodejs", "python", "docker", "system design", "mongodb"],
      cgpa: 8.9,
      college: "University of Technology",
      collegeTier: "tier1",
      degree: "B.S. Computer Science",
      resumeSummary: "Full stack software engineer with 4+ years of experience building high-throughput web applications, distributed systems, and real-time collaboration tools.",
      experience: [
        { title: "Senior Software Engineer", company: "CloudScale Inc.", duration: "2023 - Present" },
        { title: "Software Engineer", company: "DataFlow Labs", duration: "2021 - 2023" }
      ],
      achievements: [
        "Architected real-time sync service reducing latency by 45%",
        "Top 5% performer in algorithmic coding competitions"
      ]
    },
    { upsert: true, new: true }
  );

  const pairs = [
    { recruiter: recruiterSarah, seeker: seekerAlex, prefix: "sarah-alex" },
    { recruiter: recruiterLegacy, seeker: seekerCandidate, prefix: "legacy" }
  ];

  for (const pair of pairs) {
    const { recruiter, seeker, prefix } = pair;
    console.log(`\n--- Seeding pipeline for ${recruiter.email} & ${seeker.email} ---`);

    // Jobs
    const job1 = await Job.findOneAndUpdate(
      { title: "Senior Full Stack Distributed Systems Engineer", recruiter: recruiter._id },
      {
        recruiter: recruiter._id,
        title: "Senior Full Stack Distributed Systems Engineer",
        company: "TechCorp Systems",
        description: "We are seeking an experienced Full Stack & Distributed Systems engineer to architect our next-generation cloud infrastructure, real-time collaboration engines, and microservices.",
        skills: ["typescript", "react", "nodejs", "python", "mongodb", "docker", "redis"],
        location: "San Francisco, CA (Remote Hybrid)",
        type: "Full-time",
        salary: "$160,000 - $210,000",
        atsRequirements: {
          minCgpa: 7.5,
          targetCollegeTier: "tier1",
          minExperienceYears: 3,
          requiredDegree: "B.S. Computer Science"
        }
      },
      { upsert: true, new: true }
    );

    const job2 = await Job.findOneAndUpdate(
      { title: "Staff Frontend Architect (React & WebGL/WebRTC)", recruiter: recruiter._id },
      {
        recruiter: recruiter._id,
        title: "Staff Frontend Architect (React & WebGL/WebRTC)",
        company: "TechCorp Systems",
        description: "Lead our frontend engineering initiatives across real-time video conferencing, Monaco code collaboration, canvas whiteboards, and high-performance interactive interfaces.",
        skills: ["react", "typescript", "webrtc", "canvas", "yjs", "tailwind"],
        location: "Remote (Global)",
        type: "Full-time",
        salary: "$180,000 - $240,000",
        atsRequirements: {
          minCgpa: 7.0,
          targetCollegeTier: "tier2",
          minExperienceYears: 4
        }
      },
      { upsert: true, new: true }
    );

    // Applications
    const app1 = await Application.findOneAndUpdate(
      { job: job1._id, seeker: seeker._id },
      {
        job: job1._id,
        seeker: seeker._id,
        recruiter: recruiter._id,
        status: "shortlisted",
        atsScore: 94,
        atsBreakdown: {
          skillMatch: 95,
          experienceRelevance: 92,
          educationFit: 96,
          keywordOptimization: 94,
          projectsAndAchievements: 93,
          overallPresentation: 95
        },
        atsTips: [
          "Strong alignment on TypeScript, distributed systems, and real-time architectures.",
          "Candidate shortlisted directly for Live Technical System Design & Coding Interview."
        ]
      },
      { upsert: true, new: true }
    );

    const app2 = await Application.findOneAndUpdate(
      { job: job2._id, seeker: seeker._id },
      {
        job: job2._id,
        seeker: seeker._id,
        recruiter: recruiter._id,
        status: "shortlisted",
        atsScore: 88,
        atsBreakdown: {
          skillMatch: 90,
          experienceRelevance: 85,
          educationFit: 90,
          keywordOptimization: 88,
          projectsAndAchievements: 89,
          overallPresentation: 90
        },
        atsTips: [
          "Great background with WebRTC, React, and interactive state synchronization."
        ]
      },
      { upsert: true, new: true }
    );

    // 1. LIVE Session
    const roomKeyLive = prefix === "sarah-alex" ? "room-demo-techcorp-live" : "room-demo-techcorp-live-legacy";
    await InterviewSession.deleteOne({ roomKey: roomKeyLive });
    const liveSession = await InterviewSession.create({
      tenantId: "default",
      application: app1._id,
      job: job1._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      title: "Round 2: Full Stack & System Design Live Coding",
      roomKey: roomKeyLive,
      status: "LIVE",
      stage: "CODING",
      scheduledStart: new Date(Date.now() - 1000 * 60 * 20),
      actualStart: new Date(Date.now() - 1000 * 60 * 20),
      allowedLanguages: ["javascript", "typescript", "python", "cpp", "java"],
      codeWorkspace: {
        files: [
          {
            name: "solution.py",
            path: "/solution.py",
            content: `"""
TechCorp Technical Interview Challenge:
Implement a high-throughput Least Recently Used (LRU) Cache with O(1) get & put operations,
plus a rate limiter that tracks sliding window request timestamps.
"""

class Node:
    def __init__(self, key=0, val=0):
        self.key = key
        self.val = val
        self.prev = None
        self.next = None

class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.cache = {} # key -> node
        self.head = Node()
        self.tail = Node()
        self.head.next = self.tail
        self.tail.prev = self.head

    def _remove(self, node):
        prev_node = node.prev
        next_node = node.next
        prev_node.next = next_node
        next_node.prev = prev_node

    def _add(self, node):
        node.prev = self.head
        node.next = self.head.next
        self.head.next.prev = node
        self.head.next = node

    def get(self, key: int) -> int:
        if key in self.cache:
            node = self.cache[key]
            self._remove(node)
            self._add(node)
            return node.val
        return -1

    def put(self, key: int, value: int) -> None:
        if key in self.cache:
            self._remove(self.cache[key])
        node = Node(key, value)
        self.cache[key] = node
        self._add(node)
        if len(self.cache) > self.capacity:
            lru = self.tail.prev
            self._remove(lru)
            del self.cache[lru.key]

# Test driver
lru = LRUCache(2)
lru.put(1, 1)
lru.put(2, 2)
print("Get 1 (expected 1):", lru.get(1))
lru.put(3, 3) # evicts key 2
print("Get 2 (expected -1):", lru.get(2))
print("Get 3 (expected 3):", lru.get(3))
print("All assertions verified successfully!")
`,
            language: "python"
          },
          {
            name: "cache.ts",
            path: "/cache.ts",
            content: `export interface CacheItem<T> {
  key: string;
  value: T;
  expiresAt: number;
}

export class DistributedCache<T> {
  private store = new Map<string, CacheItem<T>>();

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { key, value, expiresAt: Date.now() + ttlMs });
  }

  get(key: string): T | null {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }
}
`,
            language: "typescript"
          }
        ]
      }
    });

    await TimelineEvent.deleteMany({ session: liveSession._id });
    await TimelineEvent.create([
      {
        session: liveSession._id,
        pipeline: "STAGE",
        eventType: "session.started",
        offsetMs: 0,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "WAITING_ROOM", status: "LIVE" }
      },
      {
        session: liveSession._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 60000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { fromStage: "WAITING_ROOM", toStage: "INTRODUCTION" }
      },
      {
        session: liveSession._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 300000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { fromStage: "INTRODUCTION", toStage: "CODING" }
      }
    ]);
    console.log("Created LIVE session:", liveSession.title, `(${roomKeyLive})`);

    // 2. SCHEDULED Sessions (Upcoming)
    const scheduledConfigs = [
      {
        title: "Round 1: Core Algorithms & Data Structures",
        job: job1,
        app: app1,
        daysAhead: 1,
        hours: 10,
        roomKey: `room-scheduled-round1-${prefix}`
      },
      {
        title: "Staff Frontend Architecture & WebRTC Deep Dive",
        job: job2,
        app: app2,
        daysAhead: 2,
        hours: 14,
        roomKey: `room-scheduled-webrtc-${prefix}`
      },
      {
        title: "System Design: Distributed Cache & Streaming Queue",
        job: job1,
        app: app1,
        daysAhead: 4,
        hours: 16,
        roomKey: `room-scheduled-sysdesign-${prefix}`
      },
      {
        title: "Executive Technical Leadership & Cultural Alignment",
        job: job2,
        app: app2,
        daysAhead: 6,
        hours: 11,
        roomKey: `room-scheduled-leadership-${prefix}`
      }
    ];

    for (const sc of scheduledConfigs) {
      await InterviewSession.deleteOne({ roomKey: sc.roomKey });
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + sc.daysAhead);
      startDate.setHours(sc.hours, 0, 0, 0);

      const schSession = await InterviewSession.create({
        tenantId: "default",
        application: sc.app._id,
        job: sc.job._id,
        seeker: seeker._id,
        recruiter: recruiter._id,
        title: sc.title,
        roomKey: sc.roomKey,
        status: "SCHEDULED",
        stage: "WAITING_ROOM",
        scheduledStart: startDate,
        allowedLanguages: ["javascript", "typescript", "python", "cpp", "java"]
      });
      console.log("Created SCHEDULED session:", schSession.title, `(${sc.roomKey})`);
    }

    // 3. COMPLETED Session (with Scorecard, Replay Timeline & Evaluation)
    const roomKeyCompleted = prefix === "sarah-alex" ? "room-demo-evaluated-session" : "room-demo-evaluated-session-legacy";
    const existingComp = await InterviewSession.findOne({ roomKey: roomKeyCompleted });
    if (existingComp) {
      await TimelineEvent.deleteMany({ session: existingComp._id });
      await CodeCheckpoint.deleteMany({ session: existingComp._id });
      await WhiteboardSnapshot.deleteMany({ session: existingComp._id });
      await Evaluation.deleteMany({ session: existingComp._id });
      await InterviewSession.deleteOne({ _id: existingComp._id });
    }

    const completedSession = await InterviewSession.create({
      tenantId: "default",
      application: app2._id,
      job: job2._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      title: "Round 1: Frontend Architecture & Real-Time Sync Interview",
      roomKey: roomKeyCompleted,
      status: "COMPLETED",
      stage: "COMPLETED",
      scheduledStart: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
      actualStart: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
      actualEnd: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 50),
      allowedLanguages: ["javascript", "typescript"],
      codeWorkspace: {
        files: [
          {
            name: "crdtSync.ts",
            path: "/crdtSync.ts",
            content: `// Candidate implementation of state vector exchange and binary sync
import * as Y from "yjs";

export function createCollaborativeDoc() {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  return { doc, text };
}

export function syncStateVectors(localDoc: Y.Doc, remoteVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(localDoc, remoteVector);
}
`,
            language: "typescript"
          }
        ]
      }
    });

    const timelineEvents = await TimelineEvent.create([
      {
        session: completedSession._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 0,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "INTRODUCTION" },
      },
      {
        session: completedSession._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 5000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { text: "Hi Alex! Welcome to the Staff Frontend Architect interview round." },
      },
      {
        session: completedSession._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 15000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "Hello Sarah! Glad to be here." },
      },
      {
        session: completedSession._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 180000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "Thanks Sarah! Excited to dive in. I'm ready to walk through state vectors and conflict-free data types." },
      },
      {
        session: completedSession._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 300000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "CODING" },
      },
      {
        session: completedSession._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 600000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "I'll start by implementing the collaborative document wrapper with Y.Doc and state vector exchange." },
      },
      {
        session: completedSession._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 900000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "We encode the document state update using Y.encodeStateAsUpdate and broadcast over WebSocket." },
      },
      {
        session: completedSession._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 1500000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "SYSTEM_DESIGN" },
      },
      {
        session: completedSession._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 1680000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { text: "That code looks solid. Let's switch to system design and map out the media gateway and signaling architecture." },
      },
      {
        session: completedSession._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 2700000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "FEEDBACK" },
      },
      {
        session: completedSession._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 2850000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { text: "Fantastic performance today Alex. Your grasp of distributed frontend state and low-latency WebRTC is top notch." },
      },
      {
        session: completedSession._id,
        pipeline: "STAGE",
        eventType: "session.completed",
        offsetMs: 3000000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "COMPLETED", status: "COMPLETED" },
      },
    ]);

    await CodeCheckpoint.create({
      session: completedSession._id,
      sequenceNumber: 1,
      triggerType: "MANUAL",
      triggerLabel: "Initial Starter Workspace",
      offsetMs: 0,
      filesSnapshot: [
        {
          name: "crdtSync.ts",
          path: "/crdtSync.ts",
          content: `// Candidate implementation of state vector exchange and binary sync
import * as Y from "yjs";

export function createCollaborativeDoc() {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  return { doc, text };
}
`,
          language: "typescript",
        },
      ],
    });

    await CodeCheckpoint.create({
      session: completedSession._id,
      sequenceNumber: 2,
      triggerType: "EXECUTION",
      triggerLabel: "CRDT State Sync & Vector Implementation",
      offsetMs: 1500000,
      filesSnapshot: [
        {
          name: "crdtSync.ts",
          path: "/crdtSync.ts",
          content: `// Candidate implementation of state vector exchange and binary sync
import * as Y from "yjs";

export function createCollaborativeDoc() {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  return { doc, text };
}

export function syncStateVectors(localDoc: Y.Doc, remoteVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(localDoc, remoteVector);
}
`,
          language: "typescript",
        },
      ],
    });

    await WhiteboardSnapshot.create({
      session: completedSession._id,
      sequenceNumber: 1,
      boardType: "EXCALIDRAW",
      offsetMs: 900000,
      canvasWidth: 1920,
      canvasHeight: 1080,
      objects: [
        { id: "1", type: "rectangle", x: 100, y: 100, width: 200, height: 100 },
        { id: "2", type: "rectangle", x: 400, y: 100, width: 200, height: 100 },
      ],
    });

    const evalTimelineEvent = timelineEvents[timelineEvents.length - 1];

    await Evaluation.create({
      session: completedSession._id,
      evaluator: recruiter._id,
      overallRating: 4.8,
      decision: "STRONG_HIRE",
      summary: "Alex demonstrated exceptional deep-dive knowledge of WebRTC peer connections, CRDT conflict resolution, and clean React architecture under pressure.",
      competencies: [
        {
          category: "Algorithms & Data Structures",
          score: 5,
          notes: "Rapidly deduced optimal O(1) double-linked list with hash table strategy without hints.",
          evidenceRefs: [
            {
              refType: "TIMELINE_EVENT",
              timelineEventId: evalTimelineEvent._id,
              notes: "Passed all test cases cleanly in initial run"
            }
          ]
        },
        {
          category: "System Design & Architecture",
          score: 5,
          notes: "Clearly mapped out signaling gateway, TURN/STUN relays, and resilient Yjs state snapshots.",
          evidenceRefs: [
            {
              refType: "TIMELINE_EVENT",
              timelineEventId: evalTimelineEvent._id,
              notes: "Well-structured whiteboard diagram with zero single points of failure."
            }
          ]
        },
        {
          category: "Communication & Clarity",
          score: 4,
          notes: "Communicated trade-offs proactively and explained edge case handling.",
          evidenceRefs: [
            {
              refType: "TIMELINE_EVENT",
              timelineEventId: evalTimelineEvent._id,
              notes: "Great cadence and collaborative problem-solving style."
            }
          ]
        }
      ],
      improvementFeedback: "To excel even further at Staff/Principal levels, look into zero-copy binary serialization over WebSockets (e.g. Protocol Buffers vs Cap'n Proto) for ultra-high-frequency telemetry channels."
    });
    console.log("Created COMPLETED evaluated session:", completedSession.title, `(${roomKeyCompleted})`);
  }

  console.log("\n=======================================================");
  console.log(" ALL INTERVIEWS DUMMY DATA SEEDED SUCCESSFULLY!");
  console.log("=======================================================\n");

  await mongoose.disconnect();
}

seedFullInterviews().catch(err => {
  console.error("Failed seeding interviews:", err);
  process.exit(1);
});
