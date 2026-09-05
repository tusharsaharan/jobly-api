const mongoose = require("mongoose");
const path = require("path");
const { parse } = require("csv-parse/sync");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const Problem = require("../models/Problem");

const COMPANIES = [
  "Amazon", "Google", "Microsoft", "Meta", "Apple", "Uber",
  "Netflix", "Adobe", "Goldman Sachs", "Bloomberg", "Salesforce"
];

const TIME_WINDOWS = [
  { file: "1. Thirty Days.csv", code: "30d" },
  { file: "2. Three Months.csv", code: "90d" },
  { file: "3. Six Months.csv", code: "180d" },
  { file: "4. More Than Six Months.csv", code: "180d+" },
  { file: "5. All.csv", code: "all" }
];

async function ingestDSA() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobmatch";
  console.log("Connecting to MongoDB for DSA Ingestion...");
  await mongoose.connect(mongoUri);

  console.log("Connected to MongoDB. Downloading and aggregating company CSVs in memory...");

  // Key: Link URL -> Problem doc
  const problemMap = new Map();
  let totalRows = 0;

  for (const company of COMPANIES) {
    process.stdout.write(`Processing ${company}... `);
    for (const tw of TIME_WINDOWS) {
      const url = `https://raw.githubusercontent.com/liquidslr/leetcode-company-wise-problems/main/${encodeURIComponent(company)}/${encodeURIComponent(tw.file)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;

        const text = await res.text();
        if (!text || text.trim().length === 0) continue;

        let records = [];
        try {
          records = parse(text, {
            columns: true,
            skip_empty_lines: true,
            trim: true
          });
        } catch {
          const lines = text.split("\n").slice(1);
          for (const line of lines) {
            const parts = line.split(",");
            if (parts.length >= 5) {
              records.push({
                Difficulty: parts[0]?.trim(),
                Title: parts[1]?.trim(),
                Frequency: parts[2]?.trim(),
                "Acceptance Rate": parts[3]?.trim(),
                Link: parts[4]?.trim(),
                Topics: parts.slice(5).join(",").trim()
              });
            }
          }
        }

        for (const row of records) {
          const title = row.Title || row.title;
          const link = row.Link || row.link || row.URL || row.url;
          const difficultyRaw = (row.Difficulty || row.difficulty || "MEDIUM").toUpperCase();
          const frequency = parseFloat(row.Frequency || row.frequency || "0") || 0;
          const acceptanceRate = parseFloat(row["Acceptance Rate"] || row.acceptanceRate || "0") || 0;
          const topicsRaw = row.Topics || row.topics || "";

          if (!title || !link || !link.startsWith("http")) continue;
          totalRows++;

          const difficulty = ["EASY", "MEDIUM", "HARD"].includes(difficultyRaw) ? difficultyRaw : "MEDIUM";
          const topics = topicsRaw.split(",").map(t => t.trim()).filter(Boolean);

          if (!problemMap.has(link)) {
            problemMap.set(link, {
              title,
              link,
              difficulty,
              topics,
              source: "dsa",
              companyFrequencies: []
            });
          }

          const existing = problemMap.get(link);
          existing.companyFrequencies.push({
            company,
            timeWindow: tw.code,
            frequency,
            acceptanceRate
          });
        }
      } catch (err) {
        // Continue silently on missing optional file
      }
    }
    console.log("Done.");
  }

  console.log(`\nAggregated ${problemMap.size} unique problems from ${totalRows} total rows.`);
  console.log("Writing to MongoDB via bulkWrite...");

  const operations = [];
  for (const prob of problemMap.values()) {
    operations.push({
      updateOne: {
        filter: { link: prob.link },
        update: {
          $set: {
            title: prob.title,
            difficulty: prob.difficulty,
            topics: prob.topics,
            source: "dsa",
            companyFrequencies: prob.companyFrequencies
          }
        },
        upsert: true
      }
    });
  }

  // Chunk bulkWrite operations into batches of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = operations.slice(i, i + BATCH_SIZE);
    await Problem.bulkWrite(batch);
    console.log(`Wrote batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(operations.length / BATCH_SIZE)}`);
  }

  const finalCount = await Problem.countDocuments({ source: "dsa" });
  console.log(`\nDSA Ingestion successfully complete! Total DSA problems in DB: ${finalCount}`);

  await mongoose.disconnect();
}

ingestDSA().catch(err => {
  console.error("DSA ingestion failed:", err);
  process.exit(1);
});
