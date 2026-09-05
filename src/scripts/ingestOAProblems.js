const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const Problem = require("../models/Problem");

const OA_CURATED_LIST = [
  {
    title: "Optimal Utilization",
    link: "https://leetcode.com/problems/two-sum-less-than-k",
    difficulty: "MEDIUM",
    topics: ["Two Pointers", "Binary Search"],
    oaCompany: "Amazon",
    source: "oa"
  },
  {
    title: "Minimum Cost to Connect Sticks",
    link: "https://leetcode.com/problems/minimum-cost-to-connect-sticks",
    difficulty: "MEDIUM",
    topics: ["Heaps & Priority Queues", "Greedy"],
    oaCompany: "Amazon",
    source: "oa"
  },
  {
    title: "Critical Connections in a Network (Tarjan's Algorithm)",
    link: "https://leetcode.com/problems/critical-connections-in-a-network",
    difficulty: "HARD",
    topics: ["Graphs", "DFS"],
    oaCompany: "Amazon",
    source: "oa"
  },
  {
    title: "Meeting Rooms II / Interval Scheduling",
    link: "https://leetcode.com/problems/meeting-rooms-ii",
    difficulty: "MEDIUM",
    topics: ["Arrays", "Sorting & Searching", "Greedy"],
    oaCompany: "Google",
    source: "oa"
  },
  {
    title: "Sentence Screen Fitting",
    link: "https://leetcode.com/problems/sentence-screen-fitting",
    difficulty: "MEDIUM",
    topics: ["Dynamic Programming", "Strings"],
    oaCompany: "Google",
    source: "oa"
  },
  {
    title: "Sign of the Product of an Array",
    link: "https://leetcode.com/problems/sign-of-the-product-of-an-array",
    difficulty: "EASY",
    topics: ["Arrays", "Math"],
    oaCompany: "Microsoft",
    source: "oa"
  },
  {
    title: "Minimum Deletions to Make Character Frequencies Unique",
    link: "https://leetcode.com/problems/minimum-deletions-to-make-character-frequencies-unique",
    difficulty: "MEDIUM",
    topics: ["Hashing", "Greedy", "Strings"],
    oaCompany: "Microsoft",
    source: "oa"
  },
  {
    title: "Count Submatrices With All Ones",
    link: "https://leetcode.com/problems/count-submatrices-with-all-ones",
    difficulty: "MEDIUM",
    topics: ["Dynamic Programming", "Stacks & Queues"],
    oaCompany: "Uber",
    source: "oa"
  },
  {
    title: "Watering Plants II",
    link: "https://leetcode.com/problems/watering-plants-ii",
    difficulty: "MEDIUM",
    topics: ["Two Pointers", "Arrays"],
    oaCompany: "Trilogy",
    source: "oa"
  },
  {
    title: "Find All Good Strings (KMP + DP)",
    link: "https://leetcode.com/problems/find-all-good-strings",
    difficulty: "HARD",
    topics: ["Dynamic Programming", "Strings"],
    oaCompany: "JPMorgan",
    source: "oa"
  },
  {
    title: "Partition Array into Disjoint Intervals",
    link: "https://leetcode.com/problems/partition-array-into-disjoint-intervals",
    difficulty: "MEDIUM",
    topics: ["Arrays"],
    oaCompany: "BNY Mellon",
    source: "oa"
  },
  {
    title: "Maximum Number of Events That Can Be Attended",
    link: "https://leetcode.com/problems/maximum-number-of-events-that-can-be-attended",
    difficulty: "MEDIUM",
    topics: ["Heaps & Priority Queues", "Greedy"],
    oaCompany: "Accenture",
    source: "oa"
  }
];

async function ingestOA() {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobmatch";
  console.log("Connecting to MongoDB for OA Questions Ingestion...");
  await mongoose.connect(mongoUri);

  console.log(`Ingesting ${OA_CURATED_LIST.length} Online Assessment problem mappings...`);

  for (const prob of OA_CURATED_LIST) {
    await Problem.findOneAndUpdate(
      { link: prob.link },
      {
        $set: {
          title: prob.title,
          link: prob.link,
          difficulty: prob.difficulty,
          topics: prob.topics,
          oaCompany: prob.oaCompany,
          source: "oa"
        }
      },
      { upsert: true, new: true }
    );
  }

  const count = await Problem.countDocuments({ source: "oa" });
  console.log(`OA Ingestion finished. Total OA problems in DB: ${count}`);

  await mongoose.disconnect();
}

ingestOA().catch(err => {
  console.error("OA ingestion failed:", err);
  process.exit(1);
});
