const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const EmbeddingChunk = require("../models/EmbeddingChunk");
const SystemDesignArticle = require("../models/SystemDesignArticle");
const hldData = require("../data/hld_problems.json");
const lldData = require("../data/lld_problems.json");
const baseResources = require("../data/study_resources.json");
const ragService = require("../services/rag.service");

// Generate rich, exhaustive knowledge chunks for system design
function buildComprehensiveKnowledgeBase() {
  const chunks = [];

  // 1. Ingest all curated base encyclopedic resources
  baseResources.forEach((res) => {
    chunks.push({
      content: `${res.title} — Topic: ${res.topic}.\n${res.description}`,
      namespace: "study_resource",
      scopeId: null,
      sourceType: res.sourceType || "curated_encyclopedia",
      sourceUrl: res.url,
      sourceTitle: res.title,
      topic: res.topic,
    });
  });

  // 2. Ingest all 45 HLD problems with deep architectural blueprints
  if (hldData && hldData.problems) {
    hldData.problems.forEach((p) => {
      let deepArchitecture = "";

      if (p.slug.includes("spotify") || p.title.toLowerCase().includes("spotify")) {
        deepArchitecture = `
Key Functional Requirements:
1. High-fidelity audio playback & low-latency streaming (< 200ms time-to-first-byte).
2. Song catalog browsing, search by artist/album/track, and personalized playlist curation.
3. User subscription models (Free ad-supported vs Premium 320kbps lossless streaming).
4. Offline download playback with DRM authorization tokens.

Scale & Capacity Estimation:
- 500M Monthly Active Users (MAU), 100M Daily Active Users (DAU).
- Audio library of 100M songs with average size of 5MB per track = ~500TB storage.
- Peak streaming bandwidth: 100M concurrent streams * 160 kbps avg bitrate = ~16 Tbps outbound throughput.

Core High-Level Architecture:
- Client (Mobile/Desktop/Web): Manages local audio ring buffer, audio playback state, and local chunk cache (LRU).
- CDN & Edge Network (Cloudflare/CloudFront/Fastly): Caches encrypted audio chunks (e.g. 5-10 second segment chunks encoded in Ogg Vorbis / AAC) at edge PoPs closest to users.
- API Gateway & Reverse Proxy (Envoy/Kong): Terminates TLS, verifies JWT access tokens, performs rate limiting, and routes API requests.
- Audio Ingestion & Transcoding Pipeline: Asynchronous queue (Kafka + Celery workers) that takes master WAV/FLAC audio files from record labels, normalizes volume (ReplayGain), transcodes into multi-bitrate streams (96kbps, 160kbps, 320kbps), splits into chunked byte ranges, and stores raw objects in Amazon S3 / Google Cloud Storage.
- Metadata & Catalog Service: High-throughput microservice backed by PostgreSQL / Amazon Aurora (for relational artist-album-track hierarchy) with a Redis distributed caching tier for top tracks and artist profiles.
- Search Service: Powered by Elasticsearch / OpenSearch cluster with inverted index on song titles, artists, and lyrics with n-gram fuzzy matching and auto-complete.
- Recommendation & Playlist Engine: Graph DB (Neo4j) / Vector DB (Pinecone/Milvus) with collaborative filtering and real-time Kafka event streams feeding Apache Flink / Spark for Discover Weekly and personalized radio.
- User Library & Playlist Storage: Distributed NoSQL database (Apache Cassandra / ScyllaDB) partitioned by user_id for fast read/write of custom playlists.

Reliability, Caching & Resilience:
- Tiered Caching: Edge CDN caching for popular 20% tracks (Pareto 80/20 rule), Regional Origin Shielding, and Redis in-memory cache for user sessions and playlists.
- Stream Optimization: Range header HTTP requests (Range: bytes=0-1048576) allowing clients to fetch the first 1MB instantly to start playback while streaming the remainder in the background.`;
      } else if (p.slug.includes("youtube") || p.slug.includes("video")) {
        deepArchitecture = `
Key Architecture & Components:
- Video Chunking & Transcoding: Ingestion workers slice uploaded video into 4-second MPEG-DASH / HLS chunks across multiple resolutions (1080p, 720p, 480p, 360p, AV1/H.264/VP9 codecs).
- Storage: Blob storage (Google Cloud Storage / AWS S3) for video chunks; Cassandra / Bigtable for video metadata, comments, and view counts.
- Delivery: Global CDN with Anycast DNS routing and adaptive bitrate streaming (ABR) adjusting resolution dynamically based on client bandwidth.
- Search & Recommendations: Elasticsearch for metadata indexing; Deep neural network embeddings for recommendation rankers.`;
      } else if (p.slug.includes("netflix")) {
        deepArchitecture = `
Key Architecture & Components:
- Open Connect Appliance (OCA): Custom CDN caching hardware deployed directly inside ISP networks worldwide, serving 95%+ of video traffic locally.
- Microservices Backend: AWS cloud infrastructure hosting 1000+ microservices communicating via gRPC/REST, orchestrated with Zuul API gateway and Eureka service discovery.
- Persistence: Cassandra multi-region clusters for bookmark positions and user viewing history; MySQL/Aurora for billing.
- Resilience: Chaos Engineering (Chaos Monkey), Hystrix/Resilience4j circuit breakers, and proactive multi-region active-active failover.`;
      } else if (p.slug.includes("uber") || p.slug.includes("ride")) {
        deepArchitecture = `
Key Architecture & Components:
- Geospatial Indexing: Hexagonal hierarchical spatial index (Uber H3 / Google S2) partitioning the globe into discrete spatial cells.
- Real-Time Location Tracking: Drivers emit GPS coordinates every 4 seconds over persistent WebSockets/gRPC streams to Location Ingestion Service.
- In-Memory Geospatial Store: Redis GEO / Ringpop in-memory cluster holding live driver positions per H3 cell for O(1) radius proximity queries.
- Matching Engine (DISCO): Optimizes bipartite graph matching between riders and drivers minimizing pickup ETA.`;
      } else if (p.slug.includes("twitter") || p.slug.includes("x-timeline") || p.slug.includes("news-feed")) {
        deepArchitecture = `
Key Architecture & Components:
- Fan-out on Write (Push Model): When a normal user tweets, their tweet ID is injected into the in-memory Redis timeline list of all their followers.
- Fan-out on Read (Pull Model): For celebrity users with millions of followers (e.g. Elon Musk), tweets are merged dynamically at query time to prevent write amplification.
- Hybrid Timeline Service: Blends push and pull feeds with machine learning ranking models for algorithmic feeds.`;
      } else if (p.slug.includes("whatsapp") || p.slug.includes("chat") || p.slug.includes("messenger")) {
        deepArchitecture = `
Key Architecture & Components:
- Connection Management: Millions of concurrent lightweight TCP / WebSocket / Erlang/Elixir BEAM actor processes maintaining persistent bidirectional sockets.
- End-to-End Encryption: Signal Protocol with Double Ratchet Algorithm and pre-shared cryptographic identity keys.
- Offline Message Queue: Distributed queue (RabbitMQ / Kafka) storing transient undelivered messages; deleted immediately from server once delivery acknowledgment (double blue tick) is received.`;
      } else if (p.slug.includes("url-shortener") || p.slug.includes("tinyurl")) {
        deepArchitecture = `
Key Architecture & Components:
- Key Generation: Base62 encoding ([a-zA-Z0-9]) on 64-bit integer IDs yielding 62^7 = 3.5 Trillion unique 7-character URLs.
- Token Range Pre-allocation: Range-based token servers (ZooKeeper / Redis) distributing blocks of 1,000,000 unique integers to web servers to avoid single-point bottleneck.
- Database & Caching: NoSQL Key-Value store (DynamoDB / Cassandra) with Redis Cache-Aside for top 20% hot URLs returning HTTP 301/302 redirects.`;
      } else {
        deepArchitecture = `
System Design Blueprint:
- Scalability & Load Balancing: L7 Reverse Proxy (Nginx/Envoy) with Consistent Hashing and Round Robin routing.
- Caching Strategy: Distributed Redis / Memcached cluster with Cache-Aside pattern and TTL eviction to reduce database read load.
- Database Architecture: Master-Replica relational DB (PostgreSQL) or Sharded NoSQL (Cassandra/MongoDB) partitioned by primary entity key.
- Asynchronous Processing: Message broker (Apache Kafka / RabbitMQ) decoupling read API from heavy background compute jobs.`;
      }

      const fullContent = `# High-Level Design: ${p.title}
Category: ${p.category} | Difficulty: ${p.difficulty}
Core Architectural Patterns: ${(p.patterns || []).join(", ")}

${p.summary}

${deepArchitecture}

Curated Learning Source: ${p.referenceUrl || p.githubUrl}`;

      chunks.push({
        content: fullContent,
        namespace: "study_resource",
        scopeId: null,
        sourceType: "hld_curriculum",
        sourceUrl: p.referenceUrl || p.githubUrl || "https://github.com/ashishps1/awesome-system-design-resources",
        sourceTitle: `HLD: ${p.title}`,
        topic: p.category || "System Design",
      });
    });
  }

  // 3. Ingest all 33 LLD problems
  if (lldData && Array.isArray(lldData)) {
    lldData.forEach((p) => {
      const fullContent = `# Low-Level Design (LLD): ${p.title}
Category: ${p.category} | Difficulty: ${p.difficulty}
Design Patterns Applied: ${(p.patterns || []).join(", ")}

Problem Overview:
${p.summary}

Key Object-Oriented Requirements:
${(p.requirements || []).map((r, i) => `${i + 1}. ${r}`).join("\n")}

Object-Oriented Design Blueprint:
- Core Entities & Classes: Models domain actors, state encapsulation, interfaces, and separation of concerns.
- Design Patterns: Implements ${(p.patterns || []).join(", ")} to ensure Open-Closed Principle (OCP) and Single Responsibility Principle (SRP).
- Concurrency & Thread-Safety: Employs Mutex / synchronized blocks, Atomic references, and Reader-Writer locks for state consistency.
- Multi-Language Code References: Available in Java, C++, Python, and TypeScript.

Curated Problem Source: ${p.solutionsUrl || p.githubUrl}`;

      chunks.push({
        content: fullContent,
        namespace: "study_resource",
        scopeId: null,
        sourceType: "lld_curriculum",
        sourceUrl: p.solutionsUrl || p.githubUrl || "https://github.com/ashishps1/awesome-low-level-design",
        sourceTitle: `LLD: ${p.title}`,
        topic: p.category || "Low-Level Design",
      });
    });
  }

  // 4. Ingest Landmark Papers & Engineering Blogs
  if (hldData && hldData.papers) {
    hldData.papers.forEach((paper) => {
      chunks.push({
        content: `# Landmark System Design Paper: ${paper.title} (${paper.year}) — ${paper.author}
Category: Distributed Systems Research
Summary: ${paper.summary}
Key Takeaways: Groundbreaking distributed architecture principles including consensus, fault tolerance, replication, and distributed transactions.
Source URL: ${paper.url}`,
        namespace: "study_resource",
        scopeId: null,
        sourceType: "research_paper",
        sourceUrl: paper.url,
        sourceTitle: `Landmark Paper: ${paper.title}`,
        topic: "Distributed Systems Research",
      });
    });
  }

  if (hldData && hldData.articles) {
    hldData.articles.forEach((art) => {
      chunks.push({
        content: `# Engineering Deep Dive: ${art.title} — ${art.company}
Category: Production Engineering
Summary: ${art.summary}
Key Takeaways: Real-world production engineering case study detailing architectural migrations, performance optimizations, and infrastructure scaling.
Source URL: ${art.url}`,
        namespace: "study_resource",
        scopeId: null,
        sourceType: "engineering_blog",
        sourceUrl: art.url,
        sourceTitle: `Engineering Blog: ${art.title}`,
        topic: "Production Engineering",
      });
    });
  }

  return chunks;
}

async function main() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobmatch";
  console.log("Connecting to MongoDB for complete RAG knowledge base seeding...");
  await mongoose.connect(mongoUri);
  console.log("Connected.");

  const allChunks = buildComprehensiveKnowledgeBase();
  console.log(`Generated ${allChunks.length} comprehensive technical study chunks.`);

  // Clear existing study_resource chunks
  await EmbeddingChunk.deleteMany({ namespace: "study_resource" });
  console.log("Cleared old study_resource embedding chunks.");

  if (process.env.GEMINI_API_KEY) {
    try {
      const count = await ragService.ingestChunks(allChunks);
      console.log(`Successfully embedded and ingested ${count} chunks via Gemini embeddings!`);
    } catch (err) {
      console.warn("Gemini batch embedding encountered rate limit, saving fallback docs:", err.message);
      const fallbackDocs = allChunks.map((c) => ({
        ...c,
        embedding: new Array(3072).fill(0),
      }));
      await EmbeddingChunk.insertMany(fallbackDocs);
      console.log(`Saved ${fallbackDocs.length} chunks with fallback embeddings.`);
    }
  } else {
    const fallbackDocs = allChunks.map((c) => ({
      ...c,
      embedding: new Array(768).fill(0),
    }));
    await EmbeddingChunk.insertMany(fallbackDocs);
    console.log(`Saved ${fallbackDocs.length} chunks with fallback embeddings.`);
  }

  // Also seed SystemDesignArticles
  await SystemDesignArticle.deleteMany({});
  const articlesToSeed = [
    {
      title: "Spotify System Design & Streaming Architecture",
      slug: "spotify-system-design",
      track: "HLD",
      topic: "Streaming & Realtime",
      summary: "Scalability blueprints, audio chunking, CDN caching, recommendation pipelines, and API contracts for Spotify.",
      readTimeMinutes: 14,
      published: true,
      content: "# Designing Spotify: Global Music Streaming Architecture\n\nSpotify serves over 500 million users worldwide streaming over 100 million tracks...",
      externalLinks: [
        { title: "Spotify Engineering Blog", url: "https://engineering.atspotify.com/" },
        { title: "System Design Spotify Blueprint", url: "https://algomaster.io/learn/system-design-interviews/design-spotify" }
      ]
    },
    {
      title: "Netflix Video Streaming & Open Connect CDN",
      slug: "netflix-streaming-architecture",
      track: "HLD",
      topic: "Streaming & Realtime",
      summary: "Explore adaptive bitrate video chunking, Open Connect CDN appliances, and microservice orchestration.",
      readTimeMinutes: 15,
      published: true,
      content: "# Designing Netflix: Global Video Delivery\n\nNetflix delivers billions of hours of streaming video every week...",
      externalLinks: [
        { title: "Netflix TechBlog", url: "https://netflixtechblog.com/" }
      ]
    },
    {
      title: "Uber Geospatial Dispatch & Real-Time Tracking",
      slug: "uber-geospatial-architecture",
      track: "HLD",
      topic: "Core Distributed Infra",
      summary: "Deep dive into H3 hexagonal spatial indexing, driver location streams, and bipartite matching algorithms.",
      readTimeMinutes: 12,
      published: true,
      content: "# Designing Uber: Real-Time Location & Dispatch\n\nUber matches millions of riders and drivers in real time...",
      externalLinks: [
        { title: "Uber Engineering H3", url: "https://www.uber.com/blog/h3/" }
      ]
    },
    {
      title: "Twitter / X Distributed Feed Architecture",
      slug: "twitter-timeline-architecture",
      track: "HLD",
      topic: "General Architecture",
      summary: "Fan-out on write vs fan-out on read, Redis timeline caching, and timeline ranking systems.",
      readTimeMinutes: 11,
      published: true,
      content: "# Designing Twitter Timeline\n\nScaling feed generation for 300M+ active users...",
      externalLinks: [
        { title: "Twitter Engineering", url: "https://blog.x.com/engineering" }
      ]
    }
  ];

  await SystemDesignArticle.insertMany(articlesToSeed);
  console.log(`Seeded ${articlesToSeed.length} flagship system design articles.`);

  await mongoose.disconnect();
  console.log("Seeding process completed successfully!");
}

main().catch((err) => {
  console.error("Seeding error:", err);
  process.exit(1);
});
