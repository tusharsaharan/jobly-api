/**
 * Deterministic, curated, interview-grade quiz bank.
 *
 * Guarantees the quiz is NEVER generic/random, even with no Gemini key.
 * Each question is precise, topic-specific, and includes a real explanation
 * naming the correct answer and why each distractor is a misconception.
 *
 * Keyed by canonical TOPIC_TAXONOMY name. `generateFocusQuiz` falls back here
 * when Gemini is unavailable/fails, and matches by exact topic or alias.
 */

const QUIZ_BANK = {
  "Arrays": [
    { q: "Which statement about array indexing is true?", options: ["Arrays support O(1) random access by index", "Arrays always allow O(1) insert anywhere", "Arrays store heterogeneous types by design", "Array size can change without copying"], correctAnswer: 0, explanation: "Arrays are contiguous memory, so element at index i is base + i*size → O(1). Insertion in the middle is O(n) (shift), type is fixed, and resizing requires a copy to larger memory.", difficulty: "Easy" },
    { q: "A sliding-window optimization is valid when:", options: ["the window is monotonic and aggregates via prefix sums/two pointers", "the array is always sorted", "you must keep every element's index", "the array has negative numbers only"], correctAnswer: 0, explanation: "Two-pointer/sliding window moves left/right once each for O(n) when the condition is monotonic. It does not require a sorted array.", difficulty: "Medium" },
    { q: "Why is inserting at the front of an array O(n)?", options: ["All existing elements shift right by one", "It needs a hash lookup", "It requires garbage collection", "It only touches the first slot"], correctAnswer: 0, explanation: "Contiguous storage means every element after index 0 must be moved to make room, O(n) shifts.", difficulty: "Easy" },
    { q: "For the Two Sum problem, the hash-map approach is:", options: ["O(n) time, O(n) space", "O(n^2) time, O(1) space", "O(n log n) time, O(1) space", "O(1) time, O(n) space"], correctAnswer: 0, explanation: "Storing each value→index lets you check the complement in O(1); one pass over n elements → O(n) time using O(n) space.", difficulty: "Medium" },
    { q: "What makes a prefix-sum array useful?", options: ["Range-sum queries become O(1)", "It sorts the array", "It deduplicates elements", "It finds the median in O(1)"], correctAnswer: 0, explanation: "prefix[i] = sum of [0..i), so sum(l..r) = prefix[r+1]-prefix[l] in O(1), at the cost of O(n) preprocessing.", difficulty: "Medium" },
  ],
  "Dynamic Programming": [
    { q: "DP is applicable when a problem has:", options: ["optimal substructure and overlapping subproblems", "only a greedy choice", "an unsorted input requirement", "exactly two variables"], correctAnswer: 0, explanation: "Overlapping subproblems allow memoization/tabulation reuse; optimal substructure means the global optimum is built from optimal subproblem solutions.", difficulty: "Easy" },
    { q: "Memoization is:", options: ["top-down caching of recursion results", "bottom-up iterative table-filling", "reducing time via sorting", "a space-optimization trick only"], correctAnswer: 0, explanation: "Memoization (top-down) stores results of recursive calls; tabulation (bottom-up) fills a table iteratively. Both avoid recomputation.", difficulty: "Medium" },
    { q: "0/1 Knapsack has complexity:", options: ["O(nW) time, O(W) space (space-optimized)", "O(n log n) time", "O(W^2) time", "O(1) time"], correctAnswer: 0, explanation: "Each item × capacity state; with a 1D rolling array, O(nW) time and O(W) space.", difficulty: "Medium" },
    { q: "Longest Common Subsequence (LCS) recurrence is:", options: ["dp[i][j] = dp[i-1][j-1]+1 if X[i]==Y[j] else max(dp[i-1][j], dp[i][j-1])", "dp[i] = dp[i-1] + dp[i-2]", "always O(n) greedy", "quicksort partitioning"], correctAnswer: 0, explanation: "Matching chars extend LCS from diagonal; otherwise take the better of skipping one char from either string.", difficulty: "Hard" },
    { q: "Which technique converts an O(n^2) DP to O(n) space?", options: ["Rolling array (keep only last row/state)", "Merge sort", "Binary search", "Hash map always"], correctAnswer: 0, explanation: "When a DP state only depends on the previous row/index, keep two one-row buffers; rolling arrays drop space to O(n).", difficulty: "Medium" },
  ],
  "Trees": [
    { q: "Pre-order traversal order is:", options: ["root → left → right", "left → root → right", "right → root → left", "left → right → root"], correctAnswer: 0, explanation: "Pre-order = visit node, then left subtree, then right subtree (NLR).", difficulty: "Easy" },
    { q: "In a Binary Search Tree, inorder traversal yields:", options: ["nodes in sorted ascending order", "nodes in descending order", "a random permutation", "level order"], correctAnswer: 0, explanation: "By BST property (left < node < right), LNR traversal visits keys in ascending order.", difficulty: "Easy" },
    { q: "Height of a balanced BST with n nodes is:", options: ["O(log n)", "O(n)", "O(1)", "O(n log n)"], correctAnswer: 0, explanation: "Each level roughly halves remaining nodes, giving height ~log2(n).", difficulty: "Medium" },
    { q: "AVL tree rebalances using:", options: ["rotations after insertion/deletion when balance factor ±2", "hash reindexing", "random shuffling", "array sorting"], correctAnswer: 0, explanation: "AVL maintains |height(left)-height(right)| ≤ 1 via single/double rotations after updates.", difficulty: "Hard" },
    { q: "Lowest Common Ancestor (LCA) in a binary tree is found by:", options: ["a single DFS returning the first node where both targets are found in different subtrees", "sorting all nodes", "a linear array scan only", "counting leaves"], correctAnswer: 0, explanation: "Recursively search; the node where left and right both return non-null (or equals a target) is the LCA.", difficulty: "Hard" },
  ],
  "Graphs": [
    { q: "BFS uses which data structure?", options: ["queue", "stack", "priority queue only", "linked list"], correctAnswer: 0, explanation: "FIFO queue explores level by level, giving shortest path in unweighted graphs.", difficulty: "Easy" },
    { q: "Dijkstra's algorithm:", options: ["finds shortest paths with non-negative weights", "handles negative cycles", "is used only for unweighted graphs", "requires adjacency matrix"], correctAnswer: 0, explanation: "Dijkstra greedily relaxes edges; negative edges break its invariant, hence it's restricted to non-negative weights.", difficulty: "Medium" },
    { q: "Topological sort is possible only when:", options: ["the graph is a DAG (no cycles)", "the graph is undirected", "all nodes have degree 0", "the graph is weighted"], correctAnswer: 0, explanation: "A linear ordering of vertices exists iff there are no directed cycles (DAG).", difficulty: "Medium" },
    { q: "Union-Find (Disjoint Set Union) with path compression + union by rank:", options: ["~O(α(n)) amortized per operation", "O(n) per operation", "O(n^2) amortized", "O(1) worst case guaranteed"], correctAnswer: 0, explanation: "Both optimizations yield near-constant inverse-Ackermann α(n) amortized time.", difficulty: "Hard" },
    { q: "BFS shortest path works because:", options: ["it visits nodes in non-decreasing distance on unweighted edges", "it always picks min heap", "it relaxes negative edges", "it sorts edges"], correctAnswer: 0, explanation: "FIFO order guarantees nodes are discovered in order of distance, so first visit = shortest in unweighted graphs.", difficulty: "Medium" },
  ],
  "OS": [
    { q: "A deadlock requires which four conditions?", options: ["mutual exclusion, hold-and-wait, no preemption, circular wait", "mutex, spinlock, semaphore, monitor", "CPU, memory, disk, network", "read, write, execute, delete"], correctAnswer: 0, explanation: "Coffman's four conditions must all hold for deadlock; break any one to prevent it.", difficulty: "Medium" },
    { q: "Virtual memory is implemented via:", options: ["paging and page tables with TLB translation", "only physical RAM", "cache coherence only", "file descriptors"], correctAnswer: 0, explanation: "Page tables map virtual→physical pages; TLB caches translations; page faults load/map pages.", difficulty: "Easy" },
    { q: "Thrashing occurs when:", options: ["the system spends more time paging than executing", "CPU usage is 100%", "cache misses are zero", "threads complete immediately"], correctAnswer: 0, explanation: "When working set exceeds RAM, constant page faults dominate, collapsing throughput — mitigated by increasing memory or reducing multiprogramming.", difficulty: "Hard" },
    { q: "A semaphore differs from a mutex because:", options: ["a semaphore can allow >1 concurrent threads (counting)", "a semaphore is only for processes", "a mutex allows owner to be anyone", "they are identical"], correctAnswer: 0, explanation: "Binary semaphore ≈ mutex, but counting semaphores admit N permits; mutex has strict ownership semantics.", difficulty: "Medium" },
    { q: "Context switch includes:", options: ["saving/restoring registers, PC, SP and switching address space", "only changing the CPU clock", "swapping disk sectors", "clearing the TLB is forbidden"], correctAnswer: 0, explanation: "The kernel saves CPU state and swaps memory context (CR3/page table) — an expensive operation.", difficulty: "Easy" },
  ],
  "DBMS": [
    { q: "ACID stands for:", options: ["Atomicity, Consistency, Isolation, Durability", "Access, Control, Index, Data", "Add, Commit, Insert, Delete", "Aggregate, Cache, Index, Denormalize"], correctAnswer: 0, explanation: "ACID guarantees transaction reliability: all-or-nothing, valid state, concurrent isolation, survived commits.", difficulty: "Easy" },
    { q: "A B+ tree index enables:", options: ["O(log n) point and range lookups with sequential leaf links", "O(n) full scan always", "O(1) insert always", "hash-only access"], correctAnswer: 0, explanation: "B+ trees keep keys sorted in internal nodes and link leaves for fast range scans with logarithmic height.", difficulty: "Medium" },
    { q: "Third Normal Form (3NF) requires:", options: ["no transitive dependency of non-key attributes on the key", "no primary key", "only one table", "all columns nullable"], correctAnswer: 0, explanation: "After 1NF/2NF, 3NF removes transitive dependencies (non-key → non-key).", difficulty: "Medium" },
    { q: "A transaction with isolation level SERIALIZABLE:", options: ["prevents phantom reads and acts as if executed serially", "allows dirty reads", "always uses no locks", "is the default in all DBs"], correctAnswer: 0, explanation: "Strictest level blocks anomalies including phantoms via range locking, at the cost of concurrency.", difficulty: "Hard" },
    { q: "An index slows down which operation?", options: ["write-heavy INSERT/UPDATE/DELETE (must maintain index)", "SELECT point lookups", "range scans", "count of rows"], correctAnswer: 0, explanation: "Every write must update the index structure, so indexes trade write throughput for read speed.", difficulty: "Medium" },
  ],
  "Computer Networks": [
    { q: "OSI model has how many layers?", options: ["7", "5", "4", "8"], correctAnswer: 0, explanation: "Physical, Data Link, Network, Transport, Session, Presentation, Application = 7 layers.", difficulty: "Easy" },
    { q: "TCP's 3-way handshake is:", options: ["SYN → SYN-ACK → ACK", "GET → POST → PUT", "HELLO → OK → DONE", "SYN → FIN → ACK"], correctAnswer: 0, explanation: "Client SYN, server SYN-ACK, client ACK establishes a reliable connection.", difficulty: "Easy" },
    { q: "DNS primarily resolves:", options: ["domain names to IP addresses", "IP to MAC addresses", "ports to hosts", "URLs to cookies"], correctAnswer: 0, explanation: "DNS maps human-readable domains to routable IPs; ARP maps IP to MAC.", difficulty: "Easy" },
    { q: "HTTP/2 improved HTTP/1.1 by:", options: ["multiplexing many streams over one TCP connection", "removing TLS", "disabling cookies", "using only UDP"], correctAnswer: 0, explanation: "Binary framing + HPACK + multiplexing solve application-layer head-of-line blocking.", difficulty: "Medium" },
    { q: "TCP vs UDP difference:", options: ["TCP reliable+connection-oriented; UDP best-effort+connectionless", "UDP guarantees order", "TCP has no handshake", "they are identical"], correctAnswer: 0, explanation: "TCP guarantees delivery/order via handshake+ACKs+retransmit; UDP is lightweight with no guarantees.", difficulty: "Easy" },
  ],
  "OOPs": [
    { q: "Encapsulation means:", options: ["bundling data + methods and hiding internal state", "inheriting all classes", "creating many objects", "removing all methods"], correctAnswer: 0, explanation: "Encapsulation hides implementation behind a public interface, protecting state.", difficulty: "Easy" },
    { q: "Polymorphism allows:", options: ["same interface with different implementations (overriding/overloading)", "only one class per program", "no inheritance", "multiple constructors forbidden"], correctAnswer: 0, explanation: "Runtime (overriding) and compile-time (overloading) polymorphism let one name behave differently.", difficulty: "Medium" },
    { q: "SOLID's 'O' stands for:", options: ["Open/Closed — open for extension, closed for modification", "Object", "Override", "Overload"], correctAnswer: 0, explanation: "Open/Closed principle: extend behavior via inheritance/composition without modifying existing tested code.", difficulty: "Easy" },
    { q: "With Liskov Substitution Principle, subclasses must:", options: ["be replaceable for their base type without breaking behavior", "always be abstract", "never override methods", "avoid inheritance"], correctAnswer: 0, explanation: "LSP: a subtype must honor the base contract so users of the base can use the subtype transparently.", difficulty: "Hard" },
    { q: "Abstract class vs interface:", options: ["abstract class can hold state/partial impl; interface is a pure contract", "interface can hold state", "they are the same", "abstract class cannot have constructors"], correctAnswer: 0, explanation: "Interfaces declare capabilities; abstract classes provide shared partial implementation and fields.", difficulty: "Medium" },
  ],
  "Load Balancing": [
    { q: "Least Connections algorithm routes to:", options: ["the server with fewest active connections", "a random server", "the server with most CPU", "round-robin always"], correctAnswer: 0, explanation: "Least Connections adapts to variable request durations and persistent connections.", difficulty: "Medium" },
    { q: "Consistent hashing minimizes:", options: ["key remapping when nodes are added/removed", "CPU cache misses", "packet loss", "DNS latency"], correctAnswer: 0, explanation: "Mapping keys and nodes to a ring means only K/N keys move on node change, avoiding full cache invalidation.", difficulty: "Hard" },
    { q: "L4 vs L7 load balancing:", options: ["L4 = transport (IP/port); L7 = application (HTTP paths/headers)", "L4 = HTTP only", "L7 = no TLS termination", "they cannot coexist"], correctAnswer: 0, explanation: "L4 routes by TCP/UDP tuples; L7 inspects HTTP, can route by path/host and terminate TLS.", difficulty: "Medium" },
    { q: "Round Robin is problematic when:", options: ["server capacities or request durations differ", "there is one server", "requests are identical", "no DNS exists"], correctAnswer: 0, explanation: "RR assumes uniform capacity; heterogeneous servers cause imbalance (use weighted variants).", difficulty: "Easy" },
    { q: "A health check at the LB:", options: ["removes unhealthy instances from rotation", "increases latency", "disables TLS", "adds a cache layer"], correctAnswer: 0, explanation: "Active/passive health checks mark failed backends down so traffic avoids them.", difficulty: "Easy" },
  ],
  "Caching": [
    { q: "Cache-Aside (Lazy Loading) pattern:", options: ["app reads cache; on miss, loads DB then writes cache", "app writes cache before DB", "DB writes cache directly", "no cache used"], correctAnswer: 0, explanation: "Cache-aside: check cache, on miss fetch DB and populate cache; app controls both.", difficulty: "Medium" },
    { q: "Cache stampede happens when:", options: ["many requests hit cache simultaneously on an expired hot key", "cache is empty intentionally", "TTL is infinite", "no DB exists"], correctAnswer: 0, explanation: "Concurrent misses on a hot key flood the DB; mitigate with locking, jittered TTL, or early refresh.", difficulty: "Hard" },
    { q: "LRU == ", options: ["evict least-recently-used", "large random unit", "least recently uploaded", "long running utility"], correctAnswer: 0, explanation: "LRU evicts the item not accessed for the longest time, approximating future usage.", difficulty: "Easy" },
    { q: "Write-through vs write-back:", options: ["write-through = write cache+DB together; write-back = cache only, flush later", "write-through never touches DB", "write-back writes DB first", "they are the same"], correctAnswer: 0, explanation: "Write-through ensures consistency at write cost; write-back is faster but risks loss on cache failure.", difficulty: "Medium" },
    { q: "Time-to-live (TTL) solves:", options: ["serving stale data indefinitely", "hot-key elimination", "cache capacity growth", "network jitter"], correctAnswer: 0, explanation: "TTL expires entries so cached data stays reasonably fresh.", difficulty: "Easy" },
  ],
  "System Design Case Studies": [
    { q: "Designing a URL shortener, the key algorithm is:", options: ["Base62 encode a unique ID + range pre-allocation", "MD5 of URL always", "binary search on URLs", "BFS over links"], correctAnswer: 0, explanation: "Base62 over auto-increment/range IDs yields short codes; hash/DB dedupe optional.", difficulty: "Medium" },
    { q: "Fan-out on write (push) is preferred when:", options: ["followers are few and active", "celebrity has millions of followers", "network is down", "no ranking needed"], correctAnswer: 0, explanation: "Push is fine for modest fan-out; celebrities use fan-out-on-read (pull) to avoid write amplification.", difficulty: "Hard" },
    { q: "Capacity estimation: 1M DAU × 100 requests = ", options: ["100M req/day, ~1157 req/sec avg", "100 requests total", "1 req/sec", "1B req/sec"], correctAnswer: 0, explanation: "1M×100=100M/day; 100M/(86400s)≈1157 rps average (peak higher).", difficulty: "Medium" },
    { q: "Choosing NoSQL over SQL: ", options: ["flexible schema + horizontal sharding for unstructured data", "strict joins required", "small single-node read-heavy only", "always better than SQL"], correctAnswer: 0, explanation: "NoSQL favors schema flexibility and scale-out; SQL favors ACID + joins.", difficulty: "Medium" },
    { q: "Why use a message queue in design?", options: ["decouple producers/consumers + smooth load spikes", "it replaces a database", "it removes latency completely", "it only stores logs"], correctAnswer: 0, explanation: "Queues buffer work asynchronously (Kafka/RabbitMQ) to decouple services and absorb bursts.", difficulty: "Medium" },
  ],
};

const ALIAS_KEY = new Map(Object.keys(QUIZ_BANK).map((k) => [k.toLowerCase(), k]));

function getQuizForTopic(topic, { difficulty = "Medium", count = 5 } = {}) {
  const key = ALIAS_KEY.get(String(topic || "").toLowerCase());
  if (!key) return null;
  const pool = QUIZ_BANK[key];
  if (!pool || pool.length === 0) return null;
  const result = pool.slice(0, Math.max(1, Math.min(count, pool.length)));
  // If difficulty given (not Mixed), prioritize that difficulty when possible, else any.
  if (difficulty && difficulty !== "Mixed") {
    const match = pool.filter((q) => q.difficulty === difficulty);
    const rest = pool.filter((q) => q.difficulty !== difficulty);
    const ordered = [...match, ...rest];
    return ordered.slice(0, Math.max(1, Math.min(count, ordered.length)));
  }
  return result;
}

function getAvailableTopics() {
  return Object.keys(QUIZ_BANK);
}

module.exports = {
  QUIZ_BANK,
  getQuizForTopic,
  getAvailableTopics,
};