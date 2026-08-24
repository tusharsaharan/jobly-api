<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1f6feb&height=220&section=header&text=Jobly%20API%20Platform&fontSize=60&fontColor=58a6ff&fontAlignY=35&animation=twinkling&desc=Distributed%20AI%20Recruitment%20%7C%20Live%20Interview%20Orchestrator%20%7C%20Deterministic%20ATS&descSize=15&descAlignY=55&descAlign=50" width="100%" alt="Jobly API Platform Header" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&size=20&pause=1000&color=58A6FF&center=true&vCenter=true&multiline=true&repeat=true&width=800&height=100&lines=%F0%9F%A4%96+Google+Gemini+LLM+Resume+Extraction;%F0%9F%8E%AF+Deterministic+ATS+Role-Fit+Scoring+(Schema+v1);%F0%9F%92%BB+Real-Time+Yjs+CRDT+%2B+Monaco+Sync+%2B+Multi-Language+Sandbox;%F0%9F%9B%A1%EF%B8%8F+Zero-Trust+Security+%E2%80%A2+Prometheus+Metrics+%E2%80%A2+36+Jest+Suites" alt="Typing SVG" />
</p>

<p align="center">
  <a href="https://github.com/tusharsaharan/job-recommender-api/stargazers"><img src="https://img.shields.io/github/stars/tusharsaharan/job-recommender-api?style=for-the-badge&logo=github&color=f4dbd6&logoColor=D9E0EE&labelColor=302D41" alt="Stars" /></a>
  <a href="https://github.com/tusharsaharan/job-recommender-api/network/members"><img src="https://img.shields.io/github/forks/tusharsaharan/job-recommender-api?style=for-the-badge&logo=git&color=a6da95&logoColor=D9E0EE&labelColor=302D41" alt="Forks" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Tests-36%20Suites%20Passing-a6da95?style=for-the-badge&logo=jest&logoColor=D9E0EE&labelColor=302D41" alt="Tests" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Coverage-Comprehensive-eed49f?style=for-the-badge&logo=codecov&logoColor=D9E0EE&labelColor=302D41" alt="Coverage" /></a>
</p>

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 🧬 Overview

```javascript
const JoblyAPI = {
    name: "Jobly API Platform",
    version: "2.0.0",
    engine: "Google Gemini Flash Lite + OpenAI Cascade",
    stack: {
        runtime: "Node.js 20+",
        framework: "Express.js",
        realtime: "Yjs CRDT + Socket.IO + WebSocket",
        media: "LiveKit WebRTC SFU",
        database: "MongoDB 7.0 + Redis 7.2",
        storage: "MinIO S3",
        queues: "BullMQ + Temporal Workflows",
        metrics: "Prometheus + OpenTelemetry"
    },
    features: [
        "AI Resume Ingestion & MinIO Storage Pipeline",
        "Deterministic ATS Role-Fit Scoring (Schema ats-analysis/2026-08-v1)",
        "Collaborative Live Interview IDE (Monaco + Yjs + LSP Gateway)",
        "Multi-Language Execution Sandbox (Python, JS, TS, C++, Java, Go, Ruby, Rust)",
        "Containerized PTY Terminal Streaming",
        "LiveKit WebRTC Video/Audio Conferencing",
        "AI Co-Interviewer Copilot & Bar Raiser Scorecard Generator",
        "Time-Travel Session Replay & High-Resolution Timeline Scrubber"
    ],
    testSuites: 36
};
```

---

## ⚡ Tech Stack & Protocols

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/MongoDB_7.0-47A248?style=flat-square&logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Redis_7.2-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/Google_Gemini-8E75B2?style=flat-square&logo=googlegemini&logoColor=white" alt="Google Gemini" />
  <img src="https://img.shields.io/badge/Yjs_CRDT-010101?style=flat-square&logo=yjs&logoColor=white" alt="Yjs" />
  <img src="https://img.shields.io/badge/Socket.IO-010101?style=flat-square&logo=socketdotio&logoColor=white" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/LiveKit_WebRTC-20C997?style=flat-square&logo=webrtc&logoColor=white" alt="LiveKit" />
  <img src="https://img.shields.io/badge/Prometheus-E6522C?style=flat-square&logo=prometheus&logoColor=white" alt="Prometheus" />
  <img src="https://img.shields.io/badge/MinIO_S3-C72C48?style=flat-square&logo=minio&logoColor=white" alt="MinIO" />
</p>

---

## 🏗️ Architecture & WebSocket Upgrade Pipeline

```
                               ┌────────────────────────┐
                               │   Incoming HTTP / WS   │
                               └───────────┬────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
             [Standard HTTP Request]                [HTTP Upgrade Request]
                        │                                     │
                        ▼                                     ├─► /collab/:room    ──► Yjs Document Coordinator
            [Express Security Stack]                          ├─► /whiteboard/:id  ──► Yjs Excalidraw Coordinator
             (Helmet, CORS, RateLimiter)                      ├─► /lsp/:room/:lang ──► LSP Gateway (Pyright, TS, Clangd)
                        │                                     └─► /socket.io/      ──► Socket.IO Redis Cluster
            [JWT Auth & RBAC Guard]
                        │
       ┌────────────────┼────────────────┬────────────────┐
       ▼                ▼                ▼                ▼
[Auth Controller] [Job Controller] [Resume Pipeline] [Interview Controller]
       │                │                │                │
       ▼                ▼                ▼                ▼
[Bcrypt/JWT]      [Gemini Gen]    [MinIO / BullMQ] [Sandbox / Terminal / AI Copilot]
       │                │                │                │
       └────────────────┴───────┬────────┴────────────────┘
                                ▼
                   [MongoDB + Redis Datastores]
```

---

## 📡 Complete REST API Reference

<table>
  <thead>
    <tr>
      <th>Method</th>
      <th>Endpoint</th>
      <th>Description</th>
      <th>Access</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>GET</code></td><td><code>/api/health</code></td><td>Cluster health check & service status</td><td>Public</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/metrics</code></td><td>Prometheus metrics scraper endpoint</td><td>Public</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/auth/register</code></td><td>Create candidate or recruiter account</td><td>Public</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/auth/login</code></td><td>Authenticate & issue signed JWT</td><td>Public</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/users/me</code></td><td>Fetch authenticated user profile</td><td>🔒 Any</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/resume/upload</code></td><td>Upload PDF resume to MinIO S3 & parse</td><td>🔒 Seeker</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/resume/me</code></td><td>Get latest structured resume profile</td><td>🔒 Seeker</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/jobs</code></td><td>Create job posting</td><td>🔒 Recruiter</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/jobs/ai-generate</code></td><td>Generate job criteria from natural language prompt</td><td>🔒 Recruiter</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/jobs</code></td><td>List jobs with search & filter parameters</td><td>🔒 Any</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/jobs/match</code></td><td>Get candidate personalized ATS-matched jobs</td><td>🔒 Seeker</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/applications/:jobId</code></td><td>Submit application with ATS match scoring</td><td>🔒 Seeker</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/applications/me</code></td><td>Retrieve seeker application list</td><td>🔒 Seeker</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/applications/recruiter</code></td><td>Retrieve recruiter candidate pipeline</td><td>🔒 Recruiter</td></tr>
    <tr><td><code>PATCH</code></td><td><code>/api/applications/:id/status</code></td><td>Update application stage (Shortlist/Reject/Offer)</td><td>🔒 Recruiter</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/messages/application/:id</code></td><td>Send message in application thread</td><td>🔒 Participant</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/messages/application/:id</code></td><td>Fetch message history</td><td>🔒 Participant</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/interviews/schedule</code></td><td>Schedule interview & allocate roomKey</td><td>🔒 Recruiter</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/interviews/:sessionId</code></td><td>Get interview room state & credentials</td><td>🔒 Participant</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/interviews/:sessionId/token</code></td><td>Mint LiveKit WebRTC access token</td><td>🔒 Participant</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/coding/execute</code></td><td>Execute code inside isolated sandbox (8 languages)</td><td>🔒 Participant</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/coding/test</code></td><td>Run automated unit test suite</td><td>🔒 Participant</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/coding/terminal</code></td><td>Spawn interactive containerized PTY terminal</td><td>🔒 Participant</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/timeline/event</code></td><td>Record timestamped session event</td><td>🔒 Participant</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/replay/:sessionId</code></td><td>Fetch chronological timeline playback stream</td><td>🔒 Recruiter</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/evaluations/generate</code></td><td>AI Bar Raiser scorecard generation</td><td>🔒 Recruiter</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/evaluations/:sessionId</code></td><td>Submit final evaluation scorecard & decision</td><td>🔒 Recruiter</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/ats/analyze</code></td><td>Deterministic ATS role-fit scoring computation</td><td>🔒 Any</td></tr>
  </tbody>
</table>

---

## 🧪 Testing Suite (36 Jest Suites)

```bash
# Run all unit, integration, and chaos test suites
npm test

# Run with coverage instrumentation
npm run test:coverage
```

### Test Suite Map
- `tests/unit/`: ATS scoring math, AI cascades, LSP gateway, LiveKit service, Checkpoint service, Membership RBAC, Sandboxes, Transcription, Yjs WebSocket & CRDT syncing.
- `tests/integration/`: Auth, Jobs, Applications, Messages, Coding, Evaluations, Invites, Replays, Timelines, Security Hardening.
- `tests/chaos/`: Yjs CRDT fuzzing, Redis multi-socket matrix, PTY sandbox escapes, ATS adversarial inputs, Workflow race condition guards.

---

## 🚀 Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

---

## 📜 License

Distributed under the **MIT License**. Built with ❤️ by **[Tushar Saharan](https://github.com/tusharsaharan)**.