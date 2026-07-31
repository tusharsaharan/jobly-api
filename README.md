<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1f6feb&height=220&section=header&text=JobMatch%20API&fontSize=65&fontColor=58a6ff&fontAlignY=35&animation=twinkling&desc=AI-Powered%20Recruitment%20Backend%20%7C%20Google%20Gemini&descSize=16&descAlignY=55&descAlign=50" width="100%" alt="JobMatch API Header" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&size=22&pause=1000&color=58A6FF&center=true&vCenter=true&multiline=true&repeat=true&width=700&height=100&lines=%F0%9F%94%8D+AI+Resume+Parsing+%E2%80%A2+ATS+Match+Scoring;%F0%9F%A4%96+Powered+by+Google+Gemini+Flash+Lite;%F0%9F%9B%A1%EF%B8%8F+Role-Based+Auth+%E2%80%A2+44+Tests+Passing" alt="Typing SVG" />
</p>

<p align="center">
  <a href="https://github.com/tusharsaharan/job-recommender-api/stargazers"><img src="https://img.shields.io/github/stars/tusharsaharan/job-recommender-api?style=for-the-badge&logo=github&color=f4dbd6&logoColor=D9E0EE&labelColor=302D41" alt="Stars" /></a>
  <a href="https://github.com/tusharsaharan/job-recommender-api/network/members"><img src="https://img.shields.io/github/forks/tusharsaharan/job-recommender-api?style=for-the-badge&logo=git&color=a6da95&logoColor=D9E0EE&labelColor=302D41" alt="Forks" /></a>
  <a href="https://github.com/tusharsaharan/job-recommender-api/issues"><img src="https://img.shields.io/github/issues/tusharsaharan/job-recommender-api?style=for-the-badge&logo=gitbook&color=eed49f&logoColor=D9E0EE&labelColor=302D41" alt="Issues" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Tests-44%20Passed-a6da95?style=for-the-badge&logo=jest&logoColor=D9E0EE&labelColor=302D41" alt="Tests" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Coverage-70%25-eed49f?style=for-the-badge&logo=codecov&logoColor=D9E0EE&labelColor=302D41" alt="Coverage" /></a>
</p>

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 🧬 About

<img align="right" src="https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcHg4amFtN3ltcjQxaXJ6YTE4dXJ1Y3E3dW80MHV4aGRzenh4eXE4biZlcD12MV9naWZzX3NlYXJjaCZjdD1n/qgQUggAC3Pfv687qPC/giphy.gif" width="280" alt="API Animation" />

```javascript
const JobMatchAPI = {
    name: "JobMatch API",
    type: "AI-Powered Recruitment Backend",
    engine: "Google Gemini Flash Lite",
    stack: {
        runtime: "Node.js",
        framework: "Express.js",
        database: "MongoDB + Mongoose",
        auth: "JWT + Bcrypt",
        ai: "@google/genai"
    },
    features: [
        "AI Resume Parsing (PDF → Structured Data)",
        "AI Job Description Generation",
        "Real-time ATS Match Scoring",
        "Role-Based Access Control",
        "LLM Output Sanitization"
    ],
    tests: { passed: 44, suites: 5 }
};
```

<br clear="right" />

> **JobMatch API** replaces traditional keyword matching with **Google Gemini LLM intelligence**. It parses PDF resumes into structured data, auto-generates ATS-optimized job postings from plain English, and computes real-time compatibility scores with actionable feedback — all behind a hardened, role-based Express.js API.

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## ⚡ Tech Stack

<p align="center">
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=nodejs,express,mongodb,jest&theme=dark&perline=8" alt="Tech Stack" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Google%20Gemini-8E75B2?style=flat-square&logo=googlegemini&logoColor=white" alt="Google Gemini" />
  <img src="https://img.shields.io/badge/JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white" alt="JWT" />
  <img src="https://img.shields.io/badge/Multer-FF6600?style=flat-square&logo=files&logoColor=white" alt="Multer" />
  <img src="https://img.shields.io/badge/pdf--parse-E34F26?style=flat-square&logo=adobeacrobatreader&logoColor=white" alt="pdf-parse" />
  <img src="https://img.shields.io/badge/Bcrypt-003A70?style=flat-square&logo=letsencrypt&logoColor=white" alt="Bcrypt" />
  <img src="https://img.shields.io/badge/Mongoose-880000?style=flat-square&logo=mongoose&logoColor=white" alt="Mongoose" />
</p>

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT REQUEST                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  CORS    │→ │ Body Parser  │→ │  JWT Auth Middleware       │  │
│  │  Guard   │  │ (10kb limit) │  │  + Role-Based Access      │  │
│  └──────────┘  └──────────────┘  └───────────────────────────┘  │
│                      EXPRESS MIDDLEWARE PIPELINE                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
   ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
   │ Auth Routes │ │ Job Routes  │ │ Resume Routes│
   │  /api/auth  │ │  /api/jobs  │ │ /api/resume  │
   └──────┬──────┘ └──────┬──────┘ └──────┬───────┘
          │                │                │
          ▼                ▼                ▼
   ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
   │   Auth      │ │    Job      │ │   Resume     │
   │ Controller  │ │ Controller  │ │  Controller  │
   └──────┬──────┘ └──────┬──────┘ └──────┬───────┘
          │                │                │
          │         ┌──────┴──────┐         │
          │         │             │         │
          │         ▼             │         ▼
          │  ┌─────────────┐     │  ┌──────────────┐
          │  │ AI Service  │     │  │  Multer +    │
          │  │ (Gemini     │     │  │  PDF Parse   │
          │  │  Flash Lite)│     │  │  Pipeline    │
          │  └──────┬──────┘     │  └──────┬───────┘
          │         │             │         │
          ▼         ▼             ▼         ▼
   ┌──────────────────────────────────────────────┐
   │              MongoDB + Mongoose               │
   │    Users │ Jobs │ Applications │ Messages     │
   └──────────────────────────────────────────────┘
```

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## ✨ Key Features

<table>
  <tr>
    <td align="center" width="25%">
      <img src="https://img.icons8.com/fluency/48/artificial-intelligence.png" width="36" alt="AI" /><br />
      <b>AI Resume Parsing</b><br />
      <sub>Upload PDF → structured skills, education & achievements via Gemini Flash Lite</sub>
    </td>
    <td align="center" width="25%">
      <img src="https://img.icons8.com/fluency/48/briefcase.png" width="36" alt="Jobs" /><br />
      <b>AI Job Generation</b><br />
      <sub>Describe a role in plain English → AI auto-fills ATS-optimized requirements</sub>
    </td>
    <td align="center" width="25%">
      <img src="https://img.icons8.com/fluency/48/match.png" width="36" alt="Match" /><br />
      <b>ATS Match Scoring</b><br />
      <sub>Real-time resume ↔ job compatibility scores with actionable improvement tips</sub>
    </td>
    <td align="center" width="25%">
      <img src="https://img.icons8.com/fluency/48/lock-2.png" width="36" alt="Security" /><br />
      <b>Hardened Security</b><br />
      <sub>JWT RBAC, LLM output sanitization, rate-limit fallbacks, strict body limits</sub>
    </td>
  </tr>
</table>

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/tusharsaharan/job-recommender-api.git
cd job-recommender-api

# Install
npm install

# Configure (.env)
cp .env.example .env
# Edit .env with your MongoDB URI, JWT Secret, and Gemini API Key

# Run
npm run dev

# Test
npm test
```

<details>
<summary><b>📝 Environment Variables</b></summary>

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
GEMINI_API_KEY=your_google_gemini_api_key
```

</details>

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 📡 API Reference

<table>
  <thead>
    <tr>
      <th>Method</th>
      <th>Endpoint</th>
      <th>Description</th>
      <th>Auth</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>POST</code></td><td><code>/api/auth/register</code></td><td>Register new user (seeker / recruiter)</td><td>—</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/auth/login</code></td><td>Authenticate & receive JWT</td><td>—</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/users/me</code></td><td>Get current user profile</td><td>🔒</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/resume/upload</code></td><td>Upload PDF → AI-parsed resume</td><td>🔒 seeker</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/jobs</code></td><td>Create a new job posting</td><td>🔒 recruiter</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/jobs/ai-generate</code></td><td>AI-generate job from description</td><td>🔒 recruiter</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/jobs</code></td><td>List jobs (filtered by role)</td><td>🔒</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/jobs/match</code></td><td>ATS-scored job feed for seekers</td><td>🔒 seeker</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/applications/:jobId</code></td><td>Apply to a job (ATS gate)</td><td>🔒 seeker</td></tr>
    <tr><td><code>PATCH</code></td><td><code>/api/applications/:id/status</code></td><td>Shortlist / reject applicant</td><td>🔒 recruiter</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/applications/me</code></td><td>View seeker's applications</td><td>🔒 seeker</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/applications/recruiter</code></td><td>View recruiter's applicants</td><td>🔒 recruiter</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/messages/application/:id</code></td><td>Send message in application thread</td><td>🔒</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/messages/application/:id</code></td><td>Load message history</td><td>🔒</td></tr>
  </tbody>
</table>

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 🧪 Testing

```
Test Suites:  5 passed, 5 total
Tests:        44 passed, 44 total

 ✅ Auth API Integration       — 7 tests
 ✅ Job API Integration        — 5 tests
 ✅ Application API Integration — 6 tests
 ✅ Message API Integration    — 5 tests
 ✅ JobLogic Unit Tests        — 21 tests
```

```bash
npm test                # Run all tests
npm run test:coverage   # Run with coverage report
```

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 📂 Project Structure

```
job-recommender-api/
├── src/
│   ├── controllers/       # Route handlers (auth, job, resume, application, message)
│   ├── middleware/         # JWT auth, role guard, file upload (Multer)
│   ├── models/            # Mongoose schemas (User, Job, Application, Message)
│   ├── routes/            # Express route definitions
│   ├── services/          # AI service (Gemini client, lazy-loading, sanitization)
│   ├── utils/             # Job matching logic, skill normalization, ATS scoring
│   ├── config/            # Database connection
│   ├── app.js             # Express app configuration
│   └── server.js          # Entry point
├── tests/
│   ├── integration/       # API endpoint tests
│   ├── unit/              # Pure logic tests
│   └── setup.js           # MongoDB Memory Server bootstrap
├── .env.example
├── jest.config.js
└── package.json
```

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 🔗 Related Repositories

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/tusharsaharan/job-recommender-web">
        <img src="https://img.shields.io/badge/Frontend-Jobly_Web-58a6ff?style=for-the-badge&logo=react&logoColor=white" alt="Frontend" />
      </a>
      <br />
      <sub>TanStack Start + React 19 + TypeScript + React Three Fiber</sub>
    </td>
  </tr>
</table>

[![divider](https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png)](https://github.com/tusharsaharan/job-recommender-api)

## 🤝 Contributing

```bash
# 1. Fork it
# 2. Create your feature branch
git checkout -b feature/amazing-feature

# 3. Commit your changes
git commit -m 'feat: add amazing feature'

# 4. Push to the branch
git push origin feature/amazing-feature

# 5. Open a Pull Request
```

## 📜 License

Distributed under the **MIT License**.

---

<p align="center">
  <b>Built with ❤️ by <a href="https://github.com/tusharsaharan">Tushar Saharan</a></b>
</p>

<p align="center">
  <a href="https://github.com/tusharsaharan"><img src="https://img.shields.io/badge/GitHub-tusharsaharan-181717?style=for-the-badge&logo=github" alt="GitHub" /></a>
  <a href="https://linkedin.com/in/tusharsaharan"><img src="https://img.shields.io/badge/LinkedIn-tusharsaharan-0A66C2?style=for-the-badge&logo=linkedin" alt="LinkedIn" /></a>
</p>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1f6feb&height=120&section=footer" width="100%" alt="Footer" />
</p>