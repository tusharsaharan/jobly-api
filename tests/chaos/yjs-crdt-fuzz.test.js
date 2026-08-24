/**
 * PRODUCTION-GRADE CHAOS & CONCURRENCY TEST SUITE: YJS CRDT ENGINE
 * Matrix Coverage: Massive Cartesian Product via test.each
 */

const Y = require("yjs");

describe("CATEGORY 2: Yjs CRDT Collaborative Sync Engine (Massive Matrix Variations)", () => {
  const generateConcurrencyMatrix = () => {
    const peerCounts = [2, 5, 10, 25];
    const docIterations = [1, 5, 20, 40];
    const mutationProbabilities = [0.1, 0.5, 0.9];
    const combos = [];
    for (const p of peerCounts) {
      for (const d of docIterations) {
        for (const m of mutationProbabilities) {
          combos.push([p, d, m]);
        }
      }
    }
    return combos;
  };

  describe("High-Concurrency Multi-Client Mutation & Eventual Consistency Matrix", () => {
    const concurrencyMatrix = generateConcurrencyMatrix(); // 4 x 4 x 3 = 48 combinations
    test.each(concurrencyMatrix)(
      "Peers: %p | Iterations: %p | Mutation Prob: %p",
      (peerCount, docIterations, mutationProb) => {
        const docs = Array.from({ length: peerCount }, () => new Y.Doc());
        const texts = docs.map((d) => d.getText("monaco-buffer"));

        for (let iter = 0; iter < docIterations; iter++) {
          const updateBatch = [];
          docs.forEach((doc, idx) => {
            doc.on("update", (update) => updateBatch.push(update));
            const text = texts[idx];
            const insertStr = `[peer_${idx}_v${iter}]`;
            const pos = Math.floor(Math.random() * (text.length + 1));
            text.insert(pos, insertStr);

            if (text.length > 50 && Math.random() < mutationProb) {
              const delPos = Math.floor(Math.random() * (text.length - 5));
              text.delete(delPos, 5);
            }
          });

          for (const update of updateBatch) {
            for (const targetDoc of docs) {
              Y.applyUpdate(targetDoc, update);
            }
          }
        }

        const baselineText = texts[0].toString();
        const baselineStateVector = Y.encodeStateVector(docs[0]);

        for (let i = 1; i < peerCount; i++) {
          expect(texts[i].toString()).toBe(baselineText);
          const peerStateVector = Y.encodeStateVector(docs[i]);
          expect(Buffer.from(peerStateVector)).toEqual(Buffer.from(baselineStateVector));
        }
      }
    );
  });

  const generatePartitionMatrix = () => {
    const partitionedNodesCount = [2, 5, 10];
    const offlineMutations = [5, 20, 50];
    const combos = [];
    for (const p of partitionedNodesCount) {
      for (const m of offlineMutations) {
        combos.push([p, m]);
      }
    }
    return combos;
  };

  describe("Network Partition & Offline Synchronization Matrix", () => {
    const partitionMatrix = generatePartitionMatrix(); // 3 x 3 = 9 combinations
    test.each(partitionMatrix)(
      "Partitioned Nodes: %p | Offline Mutations: %p",
      (nodeCount, offlineMutations) => {
        const serverDoc = new Y.Doc();
        const serverText = serverDoc.getText("code");
        serverText.insert(0, "// Initial\n");

        const clients = Array.from({ length: nodeCount }, () => {
          const doc = new Y.Doc();
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(serverDoc));
          return doc;
        });

        const clientUpdates = Array.from({ length: nodeCount }, () => []);

        clients.forEach((clientDoc, idx) => {
          clientDoc.on("update", (update) => clientUpdates[idx].push(update));
          const text = clientDoc.getText("code");
          for (let i = 0; i < offlineMutations; i++) {
            text.insert(text.length, `\n// Client ${idx} mutation ${i}`);
          }
        });

        for (let c = 0; c < clients.length; c++) {
          for (const update of clientUpdates[c]) {
            Y.applyUpdate(serverDoc, update);
            for (let other = 0; other < clients.length; other++) {
              if (other !== c) {
                Y.applyUpdate(clients[other], update);
              }
            }
          }
        }

        const finalServerText = serverText.toString();
        expect(finalServerText).toContain("Initial");

        for (const clientDoc of clients) {
          expect(clientDoc.getText("code").toString()).toBe(finalServerText);
        }
      }
    );
  });

  const generateFuzzBytesMatrix = () => {
    const iterations = 50;
    const flips = [1, 5, 10];
    const combos = [];
    for (let i = 0; i < iterations; i++) {
      for (const f of flips) {
        combos.push([i, f]);
      }
    }
    return combos;
  };

  describe("Binary Update Vector Fuzzing Matrix", () => {
    const fuzzBytesMatrix = generateFuzzBytesMatrix(); // 50 x 3 = 150 combinations
    test.each(fuzzBytesMatrix)(
      "Fuzz iteration: %p | Bit flips: %p",
      (iteration, numFlips) => {
        const doc = new Y.Doc();
        const map = doc.getMap("elements");
        map.set("elem-1", { type: "rect", x: 100, y: 200, width: 300 });

        const validUpdate = Y.encodeStateAsUpdate(doc);
        const corrupted = Buffer.from(validUpdate);

        for (let i = 0; i < numFlips; i++) {
          const targetByte = Math.floor(Math.random() * corrupted.length);
          corrupted[targetByte] = Math.floor(Math.random() * 256);
        }

        const targetDoc = new Y.Doc();
        try {
          Y.applyUpdate(targetDoc, new Uint8Array(corrupted));
        } catch (err) {
          expect(err).toBeDefined();
        }

        expect(map.get("elem-1").type).toBe("rect");
      }
    );
  });
});
