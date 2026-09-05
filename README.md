<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
<div align="center">

[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

</div>

<!-- PROJECT BANNER & LOGO -->
<div align="center">
  <br />
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0e1411,50:183a32,100:2a9d7b&height=220&section=header&text=Jobly%20%E2%80%A2%20API%20Platform&fontSize=50&fontColor=7ee0c5&fontAlignY=35&animation=twinkling&desc=Distributed%20Interview%20Orchestrator%20%7C%20CRDT%20Engine%20%7C%20RAG%20Tutor%20%7C%20Deterministic%20ATS&descSize=14&descAlignY=55&descAlign=50" width="100%" alt="Jobly API Platform Banner" />

  <h1 align="center">Jobly API Platform</h1>

  <p align="center">
    High-throughput distributed backend powering live collaborative coding, WebRTC signaling, vector RAG search, sandboxed execution, and deterministic ATS evaluation.
    <br />
    <a href="https://github.com/tusharsaharan/jobly-api"><strong>Explore the documentation »</strong></a>
    <br />
    <br />
    <a href="https://github.com/tusharsaharan/jobly-api">View Demo</a>
    &middot;
    <a href="https://github.com/tusharsaharan/jobly-api/issues">Report Bug</a>
    &middot;
    <a href="https://github.com/tusharsaharan/jobly-api/issues">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary><strong>Table of Contents</strong></summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#microservices-and-real-time-pipeline">Microservices and Real-Time Pipeline</a></li>
        <li><a href="#vector-rag-and-study-engine">Vector RAG and Study Engine</a></li>
        <li><a href="#sandboxed-execution-engine">Sandboxed Execution Engine</a></li>
        <li><a href="#deterministic-ats-evaluation">Deterministic ATS Evaluation</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#environment-variables">Environment Variables</a></li>
      </ul>
    </li>
    <li><a href="#api-reference">API Reference</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

---

## About The Project

**Jobly API Platform** is the high-performance distributed backend engine powering the Jobly ecosystem. Built on **Node.js 20+**, **Express**, **MongoDB 7.0**, and **Redis 7.2**, it coordinates real-time collaborative coding sessions, WebSockets upgrades, containerized code sandboxes, and vector RAG retrieval.

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

### Microservices and Real-Time Pipeline

* **Yjs WebSocket Coordinator**: Sub-millisecond synchronization for multi-file Monaco document trees using conflict-free replicated data types.
* **Socket.IO Cluster**: Broadcasts presence, live typing indicators, and message events across distributed clients with Redis Pub/Sub backplane.
* **LiveKit SFU Signaling**: Authenticates and issues JWT room tokens for WebRTC peer connections.

### Vector RAG and Study Engine

* **Hybrid Search Engine**: Combines pgvector semantic dense retrieval with BM25 sparse keyword indexing via Reciprocal Rank Fusion (RRF).
* **AI Tutor Query Router**: Routes complex engineering questions through Google Gemini Flash models with grounded context.

### Sandboxed Execution Engine

* **Multi-Language Isolated Runner**: Executes Python, JavaScript, TypeScript, C++, Java, Go, Rust, and Ruby with strict memory and CPU quotas.
* **PTY Terminal Streaming**: Bidirectional pseudo-terminal streaming over WebSockets.

### Deterministic ATS Evaluation

* **Schema Validation**: Evaluates resumes against role criteria with granular scoring across 7 categories.
* **Evidence Generator**: Identifies missing competencies and produces actionable resume recommendations.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

### Built With

* [![Node.js][Nodejs-badge]][Nodejs-url]
* [![Express.js][Express-badge]][Express-url]
* [![MongoDB][MongoDB-badge]][MongoDB-url]
* [![Redis][Redis-badge]][Redis-url]
* [![Google Gemini][Gemini-badge]][Gemini-url]
* [![Yjs CRDT][Yjs-badge]][Yjs-url]
* [![Socket.IO][SocketIO-badge]][SocketIO-url]
* [![LiveKit][LiveKit-badge]][LiveKit-url]
* [![Docker][Docker-badge]][Docker-url]
* [![Jest][Jest-badge]][Jest-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Getting Started

### Prerequisites

* Node.js `>= 20.0.0`
* MongoDB `>= 7.0`
* Redis `>= 7.0`
* Docker (optional, for sandboxed PTY runner)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/tusharsaharan/jobly-api.git
   cd jobly-api
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Seed interview problems and initial datasets:
   ```bash
   node src/scripts/seedStudyResources.js
   ```
4. Start development server:
   ```bash
   npm run dev
   ```

### Environment Variables

Create a `.env` file in the root folder:

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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## API Reference

### Authentication & Users
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Register candidate or recruiter account |
| `POST` | `/api/auth/login` | Authenticate and receive JWT token |
| `GET` | `/api/auth/me` | Fetch authenticated user profile |

### Technical Interview Studio
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/interviews/schedule` | Schedule technical interview session |
| `GET` | `/api/interviews/room/:roomKey` | Retrieve session room details and tokens |
| `GET` | `/api/coding/:sessionId/checkpoints` | Fetch chronological code checkpoints |
| `POST` | `/api/coding/:sessionId/checkpoints` | Save manual or execution checkpoint |
| `GET` | `/api/replay/:sessionId/manifest` | Fetch replay timeline manifest |

### Applications & ATS Engine
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/applications/apply` | Submit job application with parsed resume |
| `GET` | `/api/applications/me` | List candidate applications |
| `GET` | `/api/applications/recruiter` | List recruiter applicants |
| `POST` | `/api/ats/analyze` | Run deterministic ATS score evaluation |

### Real-Time Messaging
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/messages/conversations` | Fetch conversation summaries |
| `GET` | `/api/messages/application/:appId` | Retrieve message history |
| `POST` | `/api/messages/application/:appId` | Send message and broadcast via Socket.IO |
| `PATCH` | `/api/messages/application/:appId/read` | Mark messages as read |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Roadmap

- [x] High-performance Express API Gateway with JWT & RBAC
- [x] Yjs CRDT real-time document synchronization
- [x] Multi-language execution sandbox & PTY runner
- [x] Google Gemini AI resume extraction and interview copilot
- [x] Hybrid Vector RAG study lab (Embeddings + BM25 RRF)
- [x] Real-time LinkedIn-grade Smart Reply messaging
- [x] 36 comprehensive unit, integration, and chaos test suites
- [ ] Distributed Redis cluster scaling across multi-region nodes
- [ ] Automated video transcode worker with WebM/MP4 packaging

See the [open issues](https://github.com/tusharsaharan/jobly-api/issues) for a full list of proposed features.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Contact

Tushar Saharan - [@tusharsaharan](https://github.com/tusharsaharan)

Project Link: [https://github.com/tusharsaharan/jobly-api](https://github.com/tusharsaharan/jobly-api)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Acknowledgments

* [Yjs Real-Time CRDT Framework](https://yjs.dev/)
* [LiveKit WebRTC](https://livekit.io/)
* [Google Gemini AI](https://ai.google.dev/)
* [Socket.IO](https://socket.io/)
* [MongoDB](https://www.mongodb.com/)
* [Redis](https://redis.io/)
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[forks-shield]: https://img.shields.io/github/forks/tusharsaharan/jobly-api.svg?style=for-the-badge&color=2A9D7B&labelColor=183A32
[forks-url]: https://github.com/tusharsaharan/jobly-api/network/members
[stars-shield]: https://img.shields.io/github/stars/tusharsaharan/jobly-api.svg?style=for-the-badge&color=2A9D7B&labelColor=183A32
[stars-url]: https://github.com/tusharsaharan/jobly-api/stargazers
[issues-shield]: https://img.shields.io/github/issues/tusharsaharan/jobly-api.svg?style=for-the-badge&color=2A9D7B&labelColor=183A32
[issues-url]: https://github.com/tusharsaharan/jobly-api/issues
[license-shield]: https://img.shields.io/badge/License-MIT-2A9D7B.svg?style=for-the-badge&labelColor=183A32
[license-url]: https://github.com/tusharsaharan/jobly-api/blob/main/LICENSE
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-2A9D7B.svg?style=for-the-badge&logo=linkedin&labelColor=183A32
[linkedin-url]: https://linkedin.com/in/tushar-saharan

[Nodejs-badge]: https://img.shields.io/badge/Node.js_20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[Nodejs-url]: https://nodejs.org/
[Express-badge]: https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white
[Express-url]: https://expressjs.com/
[MongoDB-badge]: https://img.shields.io/badge/MongoDB_7.0-47A248?style=for-the-badge&logo=mongodb&logoColor=white
[MongoDB-url]: https://www.mongodb.com/
[Redis-badge]: https://img.shields.io/badge/Redis_7.2-DC382D?style=for-the-badge&logo=redis&logoColor=white
[Redis-url]: https://redis.io/
[Gemini-badge]: https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white
[Gemini-url]: https://ai.google.dev/
[Yjs-badge]: https://img.shields.io/badge/Yjs_CRDT-5A2475?style=for-the-badge&logo=yjs&logoColor=white
[Yjs-url]: https://yjs.dev/
[SocketIO-badge]: https://img.shields.io/badge/Socket.IO-010101?style=for-the-badge&logo=socketdotio&logoColor=white
[SocketIO-url]: https://socket.io/
[LiveKit-badge]: https://img.shields.io/badge/LiveKit_WebRTC-002B36?style=for-the-badge&logo=webrtc&logoColor=white
[LiveKit-url]: https://livekit.io/
[Docker-badge]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[Docker-url]: https://www.docker.com/
[Jest-badge]: https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white
[Jest-url]: https://jestjs.io/