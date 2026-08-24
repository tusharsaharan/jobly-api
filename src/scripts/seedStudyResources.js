const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const EmbeddingChunk = require("../models/EmbeddingChunk");
const SystemDesignArticle = require("../models/SystemDesignArticle");
const resources = require("../data/study_resources.json");
const ragService = require("../services/rag.service");

async function seed() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobmatch";
  console.log("Connecting to MongoDB for study resources seeding...");
  await mongoose.connect(mongoUri);
  console.log("Connected.");

  // Clear existing study_resource chunks
  await EmbeddingChunk.deleteMany({ namespace: "study_resource" });
  console.log("Cleared old study_resource embedding chunks.");

  console.log(`Ingesting ${resources.length} curated study resources...`);

  const chunksToIngest = resources.map(res => ({
    content: `${res.title} — Topic: ${res.topic}. ${res.description}`,
    namespace: "study_resource",
    scopeId: null,
    sourceType: res.sourceType || "curated_link",
    sourceUrl: res.url,
    sourceTitle: res.title,
    topic: res.topic,
  }));

  if (process.env.GEMINI_API_KEY) {
    try {
      const count = await ragService.ingestChunks(chunksToIngest);
      console.log(`Successfully embedded and stored ${count} chunks via Gemini.`);
    } catch (err) {
      console.warn("Embedding with Gemini encountered an issue, storing without vectors as fallback:", err.message);
      const fallbackDocs = chunksToIngest.map(c => ({
        ...c,
        embedding: new Array(3072).fill(0),
      }));
      await EmbeddingChunk.insertMany(fallbackDocs);
      console.log(`Stored ${fallbackDocs.length} chunks with fallback embeddings.`);
    }
  } else {
    console.warn("No GEMINI_API_KEY found, saving fallback docs.");
    const fallbackDocs = chunksToIngest.map(c => ({
      ...c,
      embedding: new Array(768).fill(0),
    }));
    await EmbeddingChunk.insertMany(fallbackDocs);
    console.log(`Stored ${fallbackDocs.length} chunks with fallback embeddings.`);
  }

  // Seed SystemDesignArticles for HLD and LLD
  await SystemDesignArticle.deleteMany({});
  const articles = [
    {
      title: "Load Balancing Architecture & Algorithms",
      slug: "load-balancing-architecture",
      track: "HLD",
      topic: "Load Balancing",
      summary: "Explore L4 vs L7 routing, health checks, consistent hashing, and failover strategies.",
      readTimeMinutes: 8,
      published: true,
      content: "# Load Balancing in Distributed Systems\n\nLoad balancing distributes network traffic across multiple servers...",
      externalLinks: [
        { title: "Nginx Load Balancing Guide", url: "https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/" },
        { title: "AWS ELB Deep Dive", url: "https://aws.amazon.com/elasticloadbalancing/" }
      ]
    },
    {
      title: "Distributed Caching & Invalidation Patterns",
      slug: "distributed-caching-patterns",
      track: "HLD",
      topic: "Caching",
      summary: "Understand Cache-Aside, Write-Through, Write-Behind, and eviction algorithms.",
      readTimeMinutes: 10,
      published: true,
      content: "# Distributed Caching Strategies\n\nCaching stores copies of frequently accessed data in high-speed RAM...",
      externalLinks: [
        { title: "Redis Architecture & Persistence", url: "https://redis.io/docs/management/persistence/" },
        { title: "Memcached vs Redis Comparison", url: "https://aws.amazon.com/elasticache/redis-vs-memcached/" }
      ]
    },
    {
      title: "Database Sharding & Consistent Hashing",
      slug: "database-sharding-guide",
      track: "HLD",
      topic: "Database Sharding",
      summary: "Scale relational and NoSQL databases horizontally with shard keys and consistent hashing rings.",
      readTimeMinutes: 12,
      published: true,
      content: "# Database Sharding Guide\n\nSharding is the horizontal partitioning of database tables...",
      externalLinks: [
        { title: "High Scalability - Database Sharding", url: "http://highscalability.com/blog/2014/1/7/an-unorthodox-approach-to-database-design-the-coming-of-the.html" }
      ]
    },
    {
      title: "SOLID Principles in Object-Oriented Design",
      slug: "solid-principles-guide",
      track: "LLD",
      topic: "SOLID Principles",
      summary: "Master Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion.",
      readTimeMinutes: 7,
      published: true,
      content: "# SOLID Principles\n\nSOLID is a mnemonic acronym for five design principles...",
      externalLinks: [
        { title: "Refactoring.Guru - SOLID", url: "https://refactoring.guru/design-patterns" }
      ]
    },
    {
      title: "Gang of Four (GoF) Design Patterns Catalog",
      slug: "gof-design-patterns",
      track: "LLD",
      topic: "Design Patterns",
      summary: "Complete breakdown of Creational, Structural, and Behavioral patterns.",
      readTimeMinutes: 15,
      published: true,
      content: "# Gang of Four Design Patterns\n\nDesign patterns provide proven solutions to recurring design problems...",
      externalLinks: [
        { title: "Refactoring.Guru - Pattern Catalog", url: "https://refactoring.guru/design-patterns/catalog" }
      ]
    },
    {
      title: "Low Level Design: Parking Lot System",
      slug: "lld-parking-lot",
      track: "LLD",
      topic: "LLD Case Studies",
      summary: "Class diagrams, entity relationships, pricing strategies, and concurrency control for a multi-floor parking lot.",
      readTimeMinutes: 14,
      published: true,
      content: "# Designing a Parking Lot System\n\nIn this LLD exercise, we design an object-oriented parking lot system...",
      externalLinks: [
        { title: "Grokking OOD - Parking Lot", url: "https://github.com/tssovi/grokking-the-object-oriented-design-interview" }
      ]
    }
  ];

  await SystemDesignArticle.insertMany(articles);
  console.log(`Seeded ${articles.length} SystemDesignArticle documents.`);

  await mongoose.disconnect();
  console.log("Seeding finished successfully.");
}

seed().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
