const fs = require("fs");
const path = require("path");

async function buildHldDataset() {
 console.log("Fetching awesome-system-design-resources README...");
 const rawReadme = await fetch(
 "https://raw.githubusercontent.com/ashishps1/awesome-system-design-resources/main/README.md"
 );
 const text = await rawReadme.text();
 console.log("Fetched README length:", text.length);

 const problems = [];

 const easyMatch = text.match(/###\s+Easy([\s\S]*?)(?=###\s+Medium|$)/i);
 const medMatch = text.match(/###\s+Medium([\s\S]*?)(?=###\s+Hard|$)/i);
 const hardMatch = text.match(/###\s+Hard([\s\S]*?)(?=##\s+|$)/i);

 function parseList(block, difficulty) {
 if (!block) return;
 const lines = block.split("\n");
 for (const line of lines) {
 const m = line.match(/^-\s+\[(.*?)\]\((.*?)\)/);
 if (m) {
 let title = m[1].replace(/^Design\s+an?\s+/i, "Design ").trim();
 const url = m[2].trim();
 const slug = title
 .toLowerCase()
 .replace(/[^a-z0-9]+/g, "-")
 .replace(/^-|-$/g, "");

 let category = "General Architecture";
 if (
 title.includes("WhatsApp") ||
 title.includes("Discord") ||
 title.includes("Chat") ||
 title.includes("Slack") ||
 title.includes("Zoom")
 ) {
 category = "Real-Time & Messaging";
 } else if (
 title.includes("Twitter") ||
 title.includes("Facebook") ||
 title.includes("Instagram") ||
 title.includes("Reddit") ||
 title.includes("TikTok") ||
 title.includes("Tinder")
 ) {
 category = "Social & Feed Systems";
 } else if (
 title.includes("YouTube") ||
 title.includes("Netflix") ||
 title.includes("Spotify") ||
 title.includes("Video") ||
 title.includes("Music")
 ) {
 category = "Media & Streaming";
 } else if (
 title.includes("Uber") ||
 title.includes("Yelp") ||
 title.includes("Maps") ||
 title.includes("Food") ||
 title.includes("Doordash")
 ) {
 category = "Geospatial & On-Demand";
 } else if (
 title.includes("Amazon") ||
 title.includes("Shopify") ||
 title.includes("Payments") ||
 title.includes("UPI") ||
 title.includes("Booking") ||
 title.includes("Airbnb") ||
 title.includes("Ticket")
 ) {
 category = "E-Commerce & FinTech";
 } else if (
 title.includes("S3") ||
 title.includes("Dropbox") ||
 title.includes("Storage") ||
 title.includes("File")
 ) {
 category = "Storage & Blob Systems";
 } else if (
 title.includes("Crawler") ||
 title.includes("Search") ||
 title.includes("Analytics") ||
 title.includes("Autocomplete")
 ) {
 category = "Search & Big Data";
 } else if (
 title.includes("Kafka") ||
 title.includes("Queue") ||
 title.includes("Scheduler") ||
 title.includes("Lock") ||
 title.includes("Key-Value") ||
 title.includes("Cache") ||
 title.includes("Rate") ||
 title.includes("Load Balancer")
 ) {
 category = "Core Distributed Infra";
 }

 const patterns = [];
 if (category === "Real-Time & Messaging") {
 patterns.push("WebSockets", "Pub/Sub", "Actor Model");
 } else if (category === "Social & Feed Systems") {
 patterns.push("Fan-out-on-Write", "Fan-out-on-Read", "Redis Cache");
 } else if (category === "Media & Streaming") {
 patterns.push("Adaptive Bitrate (HLS/DASH)", "CDN Edge", "Transcoding Pipeline");
 } else if (category === "Geospatial & On-Demand") {
 patterns.push("Geohash / Uber H3", "Kafka Streaming", "Spatial Index");
 } else if (category === "E-Commerce & FinTech") {
 patterns.push("Idempotency", "Saga Pattern", "Distributed Locking");
 } else if (category === "Storage & Blob Systems") {
 patterns.push("Chunking", "Consistent Hashing", "S3 Multipart");
 } else if (category === "Search & Big Data") {
 patterns.push("Inverted Index / Trie", "MapReduce / Spark", "Top-K");
 } else {
 patterns.push("Consistent Hashing", "Leader Election", "LSM-Tree");
 }

 problems.push({
 id: slug,
 slug,
 title,
 difficulty,
 category,
 patterns,
 referenceUrl: url,
 githubUrl:
 "https://github.com/ashishps1/awesome-system-design-resources",
 summary: `Scalability blueprints, database partitioning, caching topology, and API contracts for ${title}.`
 });
 }
 }
 }

 parseList(easyMatch? easyMatch[1]: "", "Easy");
 parseList(medMatch? medMatch[1]: "", "Medium");
 parseList(hardMatch? hardMatch[1]: "", "Hard");

 // Extract Must-Read Distributed Systems Papers
 const papersMatch = text.match(/##\s+\s+Must-Read Distributed Systems Papers([\s\S]*?)(?=##|$)/i);
 const papers = [];
 if (papersMatch) {
 const pLines = papersMatch[1].split("\n");
 for (const l of pLines) {
 const m = l.match(/^-\s+\[(.*?)\]\((.*?)\)/);
 if (m) {
 papers.push({ title: m[1].trim(), url: m[2].trim() });
 }
 }
 }

 // Extract Engineering Articles
 const articlesMatch = text.match(/##\s+\s+Must-Read Engineering Articles([\s\S]*?)(?=##|$)/i);
 const articles = [];
 if (articlesMatch) {
 const aLines = articlesMatch[1].split("\n");
 for (const l of aLines) {
 const m = l.match(/^-\s+\[(.*?)\]\((.*?)\)/);
 if (m) {
 articles.push({ title: m[1].trim(), url: m[2].trim() });
 }
 }
 }

 // Extract Core Concepts
 const conceptsMatch = text.match(/##\s+\s+Core Concepts([\s\S]*?)(?=##|$)/i);
 const concepts = [];
 if (conceptsMatch) {
 const cLines = conceptsMatch[1].split("\n");
 for (const l of cLines) {
 const m = l.match(/^-\s+\[(.*?)\]\((.*?)\)/);
 if (m) {
 concepts.push({ title: m[1].trim(), url: m[2].trim() });
 }
 }
 }

 const outPath = path.join(__dirname, "../data/hld_problems.json");
 fs.writeFileSync(
 outPath,
 JSON.stringify(
 {
 problems,
 papers,
 articles,
 concepts,
 total: problems.length
 },
 null,
 2
 )
 );

 console.log(`Successfully generated ${problems.length} HLD problems, ${papers.length} landmark papers, and ${articles.length} engineering articles at ${outPath}`);
}

buildHldDataset().catch(console.error);
