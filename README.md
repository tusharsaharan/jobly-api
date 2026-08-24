<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0e1411,50:183a32,100:2a9d7b&height=220&section=header&text=Jobly%20%E2%80%A2%20API%20Platform&fontSize=50&fontColor=7ee0c5&fontAlignY=35&animation=twinkling&desc=Distributed%20Interview%20Orchestrator%20%7C%20CRDT%20Engine%20%7C%20RAG%20Tutor%20%7C%20Deterministic%20ATS&descSize=14&descAlignY=55&descAlign=50" width="100%" alt="Jobly API Platform Header" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&size=18&pause=1000&color=2A9D7B&center=true&vCenter=true&multiline=true&repeat=true&width=800&height=100&lines=Google+Gemini+%2B+pgvector+RAG+Embeddings;Real-Time+Yjs+CRDT+%2B+Socket.IO+Cluster;Multi-Language+Sandboxed+Execution+Engine;Deterministic+ATS+Scoring+%2B+Bar+Raiser+Evaluation" alt="Typing Showcase" />
</p>

<p align="center">
  <a href="https://github.com/tusharsaharan/jobly-api"><img src="https://img.shields.io/badge/Runtime-Node.js%2020%2B-2A9D7B?style=for-the-badge&logo=nodedotjs&logoColor=white&labelColor=183A32" alt="Node Runtime" /></a>
  <a href="https://github.com/tusharsaharan/jobly-api"><img src="https://img.shields.io/badge/Datastore-MongoDB%207%20%2B%20Redis%207-1E7058?style=for-the-badge&logo=mongodb&logoColor=white&labelColor=183A32" alt="Datastores" /></a>
  <a href="https://github.com/tusharsaharan/jobly-api"><img src="https://img.shields.io/badge/Realtime-Yjs%20CRDT%20%2B%20WebSockets-2A9D7B?style=for-the-badge&logo=socketdotio&logoColor=white&labelColor=183A32" alt="Realtime" /></a>
  <a href="https://github.com/tusharsaharan/jobly-api"><img src="https://img.shields.io/badge/Tests-36%20Suites%20Passing-183A32?style=for-the-badge&logo=jest&logoColor=white&labelColor=0F2E22" alt="Jest Tests" /></a>
</p>

---

## Technical Overview

**Jobly API** is the core distributed backend service powering the Jobly platform. It coordinates multi-party collaborative coding sessions, real-time audio/video WebRTC token routing, isolated code sandboxing, vector RAG query processing, and deterministic ATS evaluation.

```
+-------------------------------------------------------------------------------+
|                              JOBLY API GATEWAY                                |
+-------------------------------------------------------------------------------+
|  [REST Endpoints]            [WebSocket Upgrades]     [Real-Time Socket.IO]   |
|  - JWT Auth & RBAC Guard    - /collab/:room (Yjs)    - /messages stream      |
|  - ATS & Application Engine  - /whiteboard/:id        - Live Signaling HUD    |
+-------------------------------------------------------------------------------+
|  [Execution Sandbox]        [AI Inference Hub]       [Storage & Queues]      |
|  - Isolated PTY Runners     - Google Gemini / LLMs   - MongoDB Datastore     |
|  - Multi-Lang Toolchains    - Vector Embeddings + RAG - Redis Pub/Sub Cache   |
+-------------------------------------------------------------------------------+
```

---

## System Architecture

```
                               +------------------------+
                               |   Incoming HTTP / WS   |
                               +-----------+------------+
                                           |
                        +------------------+------------------+
                        |                                     |
                        v                                     v
             [Standard HTTP Request]                [HTTP Upgrade Request]
                        |                                     |
                        v                                     +---> /collab/:room    ---> Yjs Document Sync
             [Express Security Stack]                         +---> /whiteboard/:id  ---> Excalidraw CRDT
             (Helmet, CORS, RateLimiter)                      +---> /socket.io/      ---> Socket.IO Cluster
                        |
             [JWT Auth & RBAC Guard]
                        |
        +---------------+----------------+----------------+
        |               |                |                |
        v               v                v                v
 [Auth & Users]   [Job Pipeline]   [Resume & ATS]   [Interview Studio]
        |               |                |                |
        v               v                v                v
 [Bcrypt / JWT]   [Search Index]   [RRF Matcher]    [Sandbox Runner]
        |               |                |                |
        +---------------+--------+-------+----------------+
                                 |
                                 v
                    [MongoDB + Redis Datastores]
```

---

## Core Backend Subsystems

### 1. Real-Time Collaborative CRDT Engine
* **Yjs WebSocket Coordinator**: Synchronizes multi-file Monaco document trees using conflict-free replicated data types.
* **Granular Checkpointing**: Automatically captures code execution states, manual snapshots, and stage milestones for replay.

### 2. Multi-Language Sandboxed Execution
* **Isolated Runtime**: Secure runner supporting Python, JavaScript, TypeScript, C++, Java, Go, Rust, and Ruby.
* **Process Telemetry**: Memory caps, CPU limits, and streaming stdout/stderr buffers.

### 3. Vector RAG Study & Learning Engine
* **Embeddings & Ingestion**: High-dimensional semantic embeddings for DSA problems, System Design architectures, and interview transcripts.
* **Reciprocal Rank Fusion (RRF)**: Blends vector similarity search with BM25 lexical keyword matching for high-precision retrieval.

### 4. Deterministic ATS Scoring Engine
* **Schema Validation**: Evaluates resumes against role criteria with granular scoring across 7 categories.
* **Role-Fit Evidence**: Generates breakdown metrics, skill gap detection, and actionable suggestions.

### 5. Encrypted Real-Time Messaging & Smart Reply
* **Socket.IO Real-Time Engine**: Presence detection, typing indicators, and message delivery.
* **Contextual Response Prediction**: Multi-turn semantic intent clustering for rapid recruiter-candidate communication.

---

## Complete API Surface

### Authentication & Profiles
* `POST /api/auth/register` - Register a new candidate or recruiter account
* `POST /api/auth/login` - Authenticate and issue JSON Web Tokens
* `GET /api/auth/me` - Retrieve authenticated user profile and permissions

### Technical Interview Studio & Replay
* `POST /api/interviews/schedule` - Schedule a new technical interview room
* `GET /api/interviews/room/:roomKey` - Fetch real-time room metadata and token
* `GET /api/coding/:sessionId/checkpoints` - Retrieve chronological workspace checkpoints
* `POST /api/coding/:sessionId/checkpoints` - Record an execution or manual checkpoint
* `GET /api/replay/:sessionId/manifest` - Fetch complete session playback manifest

### Applications & Jobs
* `GET /api/jobs` - List and search open engineering positions
* `POST /api/jobs` - Post a new job role with required skills
* `POST /api/applications/apply` - Submit a job application with parsed resume
* `GET /api/applications/me` - List applications for candidate
* `GET /api/applications/recruiter` - List applicants across posted roles

### Real-Time Messaging
* `GET /api/messages/conversations` - Fetch conversation list with unread counters
* `GET /api/messages/application/:appId` - Retrieve message history for an application
* `POST /api/messages/application/:appId` - Send a message and broadcast via Socket.IO
* `PATCH /api/messages/application/:appId/read` - Mark conversation messages as read

### Study Lab & RAG AI Tutor
* `POST /api/study/rag-query` - Query the vector RAG engine with interview questions
* `GET /api/study/lld-problems` - Retrieve Low-Level Design problem catalog
* `GET /api/study/hld-problems` - Retrieve High-Level Design architectures

---

## Installation & Setup

### Prerequisites
* Node.js `>= 20.0.0`
* MongoDB `>= 7.0`
* Redis `>= 7.0`

### Environment Configuration

Create a `.env` file in the root directory:

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/jobly
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secure-jwt-secret
GEMINI_API_KEY=your-google-gemini-api-key
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
```

### Running Locally

```bash
# Install dependencies
npm install

# Seed problem datasets and initial resources
node src/scripts/seedStudyResources.js

# Start API server
npm run dev

# Run automated Jest test suites
npm test
```

---

## Testing & Quality Assurance

The API platform includes comprehensive test suites across integration, unit, and chaos testing:

```bash
# Run all unit and integration test suites
npm test

# Run specific chaos / resilience tests
npx jest tests/chaos/workflow-race-conditions.test.js
```