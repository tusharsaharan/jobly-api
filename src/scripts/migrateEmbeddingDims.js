/**
 * migrateEmbeddingDims.js — Normalise EmbeddingChunk vector dimensions to 3072
 *
 * History: early seeds used 768-dim (text-embedding-004) or mixed dims.
 * Current contract is 3072-dim (gemini-embedding-001). Atlas vector_index is 3072.
 * Hybrid RRF fallback does NOT use stored embeddings, so zero-vectors are safe offline.
 *
 * Behaviour:
 * - Count total, inspect embedding length distribution.
 * - If GEMINI_API_KEY is valid, re-embed mismatched docs via Gemini (batched, rate-limited).
 * - Otherwise, patch mismatched docs to 3072-zero vectors (enables Hybrid RRF immediately).
 * - Optionally wipe when --wipe flag is passed (then delegates to seedCompleteStudyRAG logic).
 *
 * Usage:
 * node src/scripts/migrateEmbeddingDims.js # safe patch to 3072 zeros
 * node src/scripts/migrateEmbeddingDims.js --reembed # force Gemini re-embed (needs key)
 * node src/scripts/migrateEmbeddingDims.js --wipe # wipe study_resource and re-seed clean
 *
 * Safe to run multiple times (idempotent).
 */
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const EmbeddingChunk = require("../models/EmbeddingChunk");
const ragService = require("../services/rag.service");

const TARGET_DIM = 3072; // must match rag.service.js EMBEDDING_DIM

function hasValidKey() {
 const k = process.env.GEMINI_API_KEY;
 return Boolean(k &&!String(k).includes("your_gemini_api_key") && String(k).trim().length > 10);
}

async function buildStats() {
 const all = await EmbeddingChunk.find({}).select("embedding namespace").lean();
 const dist = {};
 for (const d of all) {
 const len = Array.isArray(d.embedding)? d.embedding.length: -1;
 dist[len] = (dist[len] || 0) + 1;
 }
 return { total: all.length, dist };
}

async function patchToZeroVectors() {
 const mismatched = await EmbeddingChunk.find({
 $or: [
 { embedding: { $exists: false } },
 { $expr: { $ne: [{ $size: "$embedding" }, TARGET_DIM] } },
 ],
 }).select("_id embedding").lean();

 if (mismatched.length === 0) {
 console.log(` All ${TARGET_DIM}-dim — no patch needed.`);
 return 0;
 }

 console.log(`Found ${mismatched.length} docs with wrong dims — patching to ${TARGET_DIM} zero vectors...`);
 const zeroVec = new Array(TARGET_DIM).fill(0);
 // Bulk update in batches to avoid 16MB payload limits
 const BATCH = 500;
 let patched = 0;
 for (let i = 0; i < mismatched.length; i += BATCH) {
 const batchIds = mismatched.slice(i, i + BATCH).map((d) => d._id);
 const res = await EmbeddingChunk.updateMany(
 { _id: { $in: batchIds } },
 { $set: { embedding: zeroVec } }
 );
 patched += res.modifiedCount || batchIds.length;
 console.log(` patched ${Math.min(i + BATCH, mismatched.length)}/${mismatched.length}`);
 }
 console.log(` Patched ${patched} docs to ${TARGET_DIM}-dim zero vectors (Hybrid RRF active; Atlas will use zero-vectors until re-embedded).`);
 return patched;
}

async function reembedMismatched() {
 if (!hasValidKey()) {
 console.warn(" GEMINI_API_KEY not valid — cannot re-embed. Falling back to zero-vector patch.");
 return patchToZeroVectors();
 }
 const mismatched = await EmbeddingChunk.find({
 $or: [
 { embedding: { $exists: false } },
 { $expr: { $ne: [{ $size: "$embedding" }, TARGET_DIM] } },
 ],
 }).lean();

 if (mismatched.length === 0) {
 console.log(` All ${TARGET_DIM}-dim — no re-embed needed.`);
 return 0;
 }

 console.log(`Re-embedding ${mismatched.length} mismatched docs via Gemini (${TARGET_DIM}-dim)...`);
 const BATCH = 20;
 let reembedded = 0;
 for (let i = 0; i < mismatched.length; i += BATCH) {
 const batch = mismatched.slice(i, i + BATCH);
 try {
 const embeddings = await Promise.all(batch.map((d) => ragService.embed(d.content)));
 const ops = batch.map((d, j) => ({
 updateOne: { filter: { _id: d._id }, update: { $set: { embedding: embeddings[j] } } },
 }));
 await EmbeddingChunk.bulkWrite(ops, { ordered: false });
 reembedded += batch.length;
 console.log(` re-embedded ${Math.min(i + BATCH, mismatched.length)}/${mismatched.length}`);
 } catch (err) {
 console.warn(` batch ${i} failed: ${err.message} — zero-patching this batch`);
 const zeroVec = new Array(TARGET_DIM).fill(0);
 const ops = batch.map((d) => ({
 updateOne: { filter: { _id: d._id }, update: { $set: { embedding: zeroVec } } },
 }));
 await EmbeddingChunk.bulkWrite(ops, { ordered: false });
 reembedded += batch.length;
 }
 if (i + BATCH < mismatched.length) await new Promise((r) => setTimeout(r, 500));
 }
 console.log(` Re-embedded ${reembedded} docs.`);
 return reembedded;
}

async function main() {
 const args = process.argv.slice(2);
 const doWipe = args.includes("--wipe");
 const doReembed = args.includes("--reembed");

 const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobmatch";
 console.log(`Connecting to ${mongoUri}...`);
 await mongoose.connect(mongoUri);
 console.log("Connected.");

 if (doWipe) {
 console.log(" --wipe: delegating to seedCompleteStudyRAG full re-seed (drops study_resource)...");
 await mongoose.disconnect();
 // Reuse existing seeder which already clears + re-ingests everything
 require("./seedCompleteStudyRAG");
 return;
 }

 const before = await buildStats();
 console.log("Before — total:", before.total, "dist:", before.dist);

 if (doReembed) await reembedMismatched();
 else await patchToZeroVectors();

 const after = await buildStats();
 console.log("After — total:", after.total, "dist:", after.dist);

 const badAfter = Object.entries(after.dist).filter(([k]) => Number(k)!== TARGET_DIM);
 if (badAfter.length > 0) {
 console.warn(" Still have non-3072 dims after migration:", badAfter);
 process.exitCode = 1;
 } else {
 console.log(` Migration complete — all dims == ${TARGET_DIM}. Hybrid RRF + Atlas ready.`);
 }

 await mongoose.disconnect();
 console.log("Done.");
}

if (require.main === module) {
 main().catch((err) => {
 console.error("Migration failed:", err);
 process.exit(1);
 });
}

module.exports = { patchToZeroVectors, reembedMismatched, buildStats, TARGET_DIM };
