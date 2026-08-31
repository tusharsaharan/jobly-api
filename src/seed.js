require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const Job = require("./models/Job");
const Application = require("./models/Application");
const InterviewSession = require("./models/InterviewSession");
const TimelineEvent = require("./models/TimelineEvent");
const CodeCheckpoint = require("./models/CodeCheckpoint");
const WhiteboardSnapshot = require("./models/WhiteboardSnapshot");
const Evaluation = require("./models/Evaluation");

async function seed() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobmatch";
  console.log("Connecting to MongoDB at:", mongoUri);
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const hashedPassword = await bcrypt.hash("password123", 10);

  // 1. Upsert Recruiters
  let recruiter = await User.findOne({ email: "recruiter@techcorp.com" });
  if (!recruiter) {
    recruiter = await User.create({
      name: "Sarah Chen (Senior Technical Recruiter)",
      email: "recruiter@techcorp.com",
      password: hashedPassword,
      role: "recruiter",
      company: "TechCorp Systems",
    });
    console.log("Created Recruiter:", recruiter.email);
  }

  let sarah = await User.findOne({ email: "sarah@techcorp.com" });
  if (!sarah) {
    sarah = await User.create({
      name: "Sarah Chen (Senior Technical Recruiter)",
      email: "sarah@techcorp.com",
      password: hashedPassword,
      role: "recruiter",
      company: "TechCorp Systems",
    });
    console.log("Created Recruiter:", sarah.email);
  }

  // 2. Upsert Candidate / Seeker
  let seeker = await User.findOne({ email: "candidate@example.com" });
  if (!seeker) {
    seeker = await User.create({
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
    });
    console.log("Created Seeker:", seeker.email);
  }

  let alex = await User.findOne({ email: "alex@example.com" });
  if (!alex) {
    alex = await User.create({
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
    });
    console.log("Created Seeker:", alex.email);
  }

  // 3. Upsert Jobs
  let job1 = await Job.findOne({ title: "Senior Full Stack Distributed Systems Engineer" });
  if (!job1) {
    job1 = await Job.create({
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
    });
    console.log("Created Job 1:", job1.title);
  }

  let job2 = await Job.findOne({ title: "Staff Frontend Architect (React & WebGL/WebRTC)" });
  if (!job2) {
    job2 = await Job.create({
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
    });
    console.log("Created Job 2:", job2.title);
  }

  // 4. Create Applications
  let app1 = await Application.findOne({ seeker: seeker._id, job: job1._id });
  if (!app1) {
    app1 = await Application.create({
      job: job1._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      status: "shortlisted",
      atsScore: 94,
      atsBreakdown: {
        skillMatch: 95,
        experienceRelevance: 92,
        educationFit: 96,
        keywordOptimization: 94
      },
      atsTips: [
        "Strong alignment on TypeScript, distributed systems, and real-time architectures.",
        "Candidate shortlisted directly for Live Technical System Design & Coding Interview."
      ]
    });
    console.log("Created Application 1 (Shortlisted)");
  }

  let app2 = await Application.findOne({ seeker: seeker._id, job: job2._id });
  if (!app2) {
    app2 = await Application.create({
      job: job2._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      status: "shortlisted",
      atsScore: 88,
      atsBreakdown: {
        skillMatch: 90,
        experienceRelevance: 85,
        educationFit: 90,
        keywordOptimization: 88
      },
      atsTips: [
        "Great background with WebRTC, React, and interactive state synchronization."
      ]
    });
    console.log("Created Application 2 (Shortlisted)");
  }

  // 5. Create Live / Scheduled Technical Interview Sessions
  const roomKey1 = "room-demo-techcorp-live";
  let session1 = await InterviewSession.findOne({ roomKey: roomKey1 });
  if (!session1) {
    session1 = await InterviewSession.create({
      tenantId: "default",
      application: app1._id,
      job: job1._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      title: "Round 2: Full Stack & System Design Interview (TechCorp Systems)",
      roomKey: roomKey1,
      status: "LIVE",
      stage: "CODING",
      scheduledStart: new Date(Date.now() - 1000 * 60 * 15), // Started 15 mins ago
      actualStart: new Date(Date.now() - 1000 * 60 * 15),
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

    // Seed timeline events
    await TimelineEvent.create([
      {
        session: session1._id,
        pipeline: "STAGE",
        eventType: "session.started",
        offsetMs: 0,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "WAITING_ROOM", status: "LIVE" }
      },
      {
        session: session1._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 60000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { fromStage: "WAITING_ROOM", toStage: "INTRODUCTION" }
      },
      {
        session: session1._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 300000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { fromStage: "INTRODUCTION", toStage: "CODING" }
      },
      {
        session: session1._id,
        pipeline: "CODING",
        eventType: "code.execution",
        offsetMs: 600000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { language: "python", status: "SUCCESS", stdout: "Get 1 (expected 1): 1\nGet 2 (expected -1): -1\nGet 3 (expected 3): 3\nAll assertions verified successfully!\n" }
      }
    ]);
    console.log("Created Live Interview Room 1:", roomKey1);
  }

  // 6. Create Completed Interview with Recruiter Evaluation & Feedback
  const roomKey2 = "room-demo-evaluated-session";
  let existingSession2 = await InterviewSession.findOne({ roomKey: roomKey2 });
  if (existingSession2) {
    await TimelineEvent.deleteMany({ session: existingSession2._id });
    await CodeCheckpoint.deleteMany({ session: existingSession2._id });
    await Evaluation.deleteMany({ session: existingSession2._id });
    await InterviewSession.deleteOne({ _id: existingSession2._id });
  }

  const session2 = await InterviewSession.create({
      tenantId: "default",
      application: app2._id,
      job: job2._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      title: "Round 1: Frontend Architecture & Real-Time Sync Interview",
      roomKey: roomKey2,
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
`,
            language: "typescript"
          }
        ]
      }
    });

    const timelineEvents = await TimelineEvent.create([
      {
        session: session2._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 0,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "INTRODUCTION" },
      },
      {
        session: session2._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 5000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { text: "Hi Alex! Welcome to the Staff Frontend Architect interview round." },
      },
      {
        session: session2._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 15000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "Hello Sarah! Glad to be here." },
      },
      {
        session: session2._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 180000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "Thanks Sarah! Excited to dive in. I'm ready to walk through state vectors and conflict-free data types." },
      },
      {
        session: session2._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 300000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "CODING" },
      },
      {
        session: session2._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 600000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "I'll start by implementing the collaborative document wrapper with Y.Doc and state vector exchange." },
      },
      {
        session: session2._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 900000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "We encode the document state update using Y.encodeStateAsUpdate and broadcast over WebSocket." },
      },
      {
        session: session2._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 1500000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "SYSTEM_DESIGN" },
      },
      {
        session: session2._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 1680000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { text: "That code looks solid. Let's switch to system design and map out the media gateway and signaling architecture." },
      },
      {
        session: session2._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 2100000,
        participant: seeker._id,
        participantRole: "seeker",
        payload: { text: "Clients establish peer connections to our LiveKit SFU cluster, while cursor awareness is multiplexed over Redis Pub/Sub." },
      },
      {
        session: session2._id,
        pipeline: "STAGE",
        eventType: "stage.transition",
        offsetMs: 2700000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "FEEDBACK" },
      },
      {
        session: session2._id,
        pipeline: "COMMUNICATION",
        eventType: "transcript.segment",
        offsetMs: 2850000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { text: "Fantastic performance today Alex. Your grasp of distributed frontend state and low-latency WebRTC is top notch." },
      },
      {
        session: session2._id,
        pipeline: "STAGE",
        eventType: "session.completed",
        offsetMs: 3000000,
        participant: recruiter._id,
        participantRole: "recruiter",
        payload: { stage: "COMPLETED", status: "COMPLETED" },
      },
    ]);

    await CodeCheckpoint.create({
      session: session2._id,
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
      session: session2._id,
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
      session: session2._id,
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

    // Create Candidate Feedback Scorecard from Recruiter
    await Evaluation.create({
      session: session2._id,
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
    console.log("Created Completed Interview with Feedback:", roomKey2);

  console.log("\n=======================================================");
  console.log(" SEEDING COMPLETE! You can log in with:");
  console.log("Candidate Login:  candidate@example.com / password123");
  console.log(" Recruiter Login:  recruiter@techcorp.com / password123");
  console.log("Live Demo Room:   http://localhost:3001/interview/room-demo-techcorp-live");
  console.log(" Replay Demo Room: http://localhost:3001/interview/room-demo-evaluated-session/replay");
  console.log("=======================================================\n");

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
