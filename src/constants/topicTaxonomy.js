/**
 * Canonical Topic Taxonomy
 *
 * This fixed, finite list is the backbone of:
 *   - Personalized study recommendations (topic extraction from feedback)
 *   - Quiz topic selection
 *   - Resource retrieval / RAG scoping
 *   - System Design HLD/LLD track assignment
 *
 * Every topic has a canonical name (the key), a category, and a list of aliases
 * used for keyword-based fallback matching.
 */

const TOPIC_TAXONOMY = {
  // ── DSA subtopics ──────────────────────────────────────────────
  "Arrays":                   { category: "DSA", aliases: ["array", "arrays", "1d array", "2d array", "subarray", "sliding window"] },
  "Strings":                  { category: "DSA", aliases: ["string", "strings", "string manipulation", "palindrome", "anagram"] },
  "Linked Lists":             { category: "DSA", aliases: ["linked list", "linkedlist", "singly linked", "doubly linked", "circular linked"] },
  "Stacks & Queues":          { category: "DSA", aliases: ["stack", "queue", "stacks", "queues", "deque", "monotonic stack"] },
  "Trees":                    { category: "DSA", aliases: ["tree", "binary tree", "bst", "binary search tree", "avl", "n-ary tree", "tree traversal"] },
  "Graphs":                   { category: "DSA", aliases: ["graph", "graphs", "bfs", "dfs", "dijkstra", "topological sort", "bellman ford", "floyd warshall", "union find", "disjoint set"] },
  "Dynamic Programming":      { category: "DSA", aliases: ["dp", "dynamic programming", "memoization", "tabulation", "knapsack", "lis", "lcs"] },
  "Recursion & Backtracking": { category: "DSA", aliases: ["recursion", "backtracking", "backtrack", "n-queens", "sudoku solver"] },
  "Sorting & Searching":      { category: "DSA", aliases: ["sort", "sorting", "binary search", "merge sort", "quick sort", "counting sort", "radix sort"] },
  "Heaps & Priority Queues":  { category: "DSA", aliases: ["heap", "priority queue", "min heap", "max heap", "k-way merge"] },
  "Hashing":                  { category: "DSA", aliases: ["hash", "hashmap", "hash table", "hash set", "hash map", "two sum"] },
  "Greedy":                   { category: "DSA", aliases: ["greedy", "greedy algorithm", "interval scheduling", "activity selection"] },
  "Bit Manipulation":         { category: "DSA", aliases: ["bit", "bits", "bitwise", "xor", "bit manipulation", "bitmask"] },
  "Tries":                    { category: "DSA", aliases: ["trie", "prefix tree", "suffix tree"] },
  "Segment Trees & BIT":      { category: "DSA", aliases: ["segment tree", "fenwick tree", "binary indexed tree", "range query"] },

  // ── CS Fundamentals ────────────────────────────────────────────
  "OS":                       { category: "CS_FUNDAMENTALS", aliases: ["operating system", "operating systems", "process", "thread", "scheduling", "memory management", "deadlock", "thrashing", "paging", "virtual memory", "semaphore", "mutex"] },
  "DBMS":                     { category: "CS_FUNDAMENTALS", aliases: ["database", "dbms", "sql", "normalization", "indexing", "transactions", "acid", "joins", "relational", "b-tree", "query optimization"] },
  "Computer Networks":        { category: "CS_FUNDAMENTALS", aliases: ["networking", "network", "cn", "tcp", "udp", "http", "https", "dns", "osi model", "ip", "routing", "socket", "websocket", "tls", "ssl"] },
  "OOPs":                     { category: "CS_FUNDAMENTALS", aliases: ["oop", "oops", "object oriented", "encapsulation", "polymorphism", "inheritance", "abstraction"] },

  // ── System Design — HLD ────────────────────────────────────────
  "Load Balancing":           { category: "HLD", aliases: ["load balancer", "load balancing", "nginx", "round robin", "least connections", "ip hash"] },
  "Caching":                  { category: "HLD", aliases: ["cache", "caching", "redis", "memcached", "cdn", "cache invalidation", "write-through", "write-behind", "cache-aside"] },
  "Database Sharding":        { category: "HLD", aliases: ["sharding", "shard", "partitioning", "horizontal scaling", "shard key", "consistent hashing"] },
  "Message Queues":           { category: "HLD", aliases: ["message queue", "kafka", "rabbitmq", "pub sub", "event driven", "event sourcing", "cqrs"] },
  "CAP Theorem":              { category: "HLD", aliases: ["cap", "consistency", "availability", "partition tolerance", "pacelc", "eventual consistency"] },
  "Microservices":            { category: "HLD", aliases: ["microservice", "microservices", "service mesh", "api gateway", "service discovery", "circuit breaker"] },
  "Rate Limiting":            { category: "HLD", aliases: ["rate limit", "rate limiting", "throttling", "token bucket", "leaky bucket", "sliding window counter"] },
  "System Design Case Studies": { category: "HLD", aliases: ["design twitter", "design uber", "design youtube", "design whatsapp", "url shortener", "design instagram", "design netflix", "design tinder"] },

  // ── System Design — LLD ────────────────────────────────────────
  "Design Patterns":          { category: "LLD", aliases: ["singleton", "factory", "observer", "strategy", "decorator", "builder", "adapter", "facade", "proxy", "command", "iterator", "state", "template method"] },
  "SOLID Principles":         { category: "LLD", aliases: ["solid", "single responsibility", "open closed", "liskov", "interface segregation", "dependency inversion"] },
  "LLD Case Studies":         { category: "LLD", aliases: ["design parking lot", "design elevator", "design chess", "design library", "design atm", "design vending machine", "design snake and ladder", "design tic tac toe"] },
  "Class Design":             { category: "LLD", aliases: ["class diagram", "uml", "class design", "object modeling", "sequence diagram"] },
};

/**
 * Retrieve the list of all canonical topic names.
 */
function getTopicNames() {
  return Object.keys(TOPIC_TAXONOMY);
}

/**
 * Retrieve topics filtered by category.
 * @param {"DSA"|"CS_FUNDAMENTALS"|"HLD"|"LLD"} category
 */
function getTopicsByCategory(category) {
  return Object.entries(TOPIC_TAXONOMY)
    .filter(([, val]) => val.category === category)
    .map(([key]) => key);
}

/**
 * Given a freeform text string, return all matching canonical topics via alias keyword matching.
 * Used as the rule-based fallback when the LLM extraction fails.
 * @param {string} text
 * @returns {{ topic: string, confidence: number }[]}
 */
function matchTopicsFromText(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matches = [];

  for (const [topicName, { aliases }] of Object.entries(TOPIC_TAXONOMY)) {
    for (const alias of aliases) {
      if (lower.includes(alias)) {
        matches.push({ topic: topicName, confidence: 0.6 });
        break; // one match per topic is enough
      }
    }
  }

  return matches;
}

module.exports = {
  TOPIC_TAXONOMY,
  getTopicNames,
  getTopicsByCategory,
  matchTopicsFromText,
};
