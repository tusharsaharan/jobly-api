const {
  tokenizeSourceCode,
  computeRabinKarpHashes,
  winnow,
  generateCodeFingerprints,
  calculateJaccardSimilarity,
  detectPlagiarism,
} = require("../../src/modules/integrity/codeSimilarityEngine");

describe("Code Similarity & Plagiarism Engine Unit Tests", () => {
  describe("tokenizeSourceCode", () => {
    it("should normalize identifiers and literals while preserving control keywords", () => {
      const code = `
        function calculateTotal(items, discountRate) {
          let sum = 0;
          for (let i = 0; i < items.length; i++) {
            sum += items[i].price * (1 - discountRate);
          }
          return sum;
        }
      `;
      const tokens = tokenizeSourceCode(code);
      expect(tokens).toContain("KW_FUNCTION");
      expect(tokens).toContain("KW_LET");
      expect(tokens).toContain("KW_FOR");
      expect(tokens).toContain("KW_RETURN");
      expect(tokens).toContain("IDENT");
      expect(tokens).toContain("NUM");
      expect(tokens).not.toContain("calculateTotal");
      expect(tokens).not.toContain("discountRate");
    });

    it("should strip comments cleanly", () => {
      const code = `
        // Initial setup
        /* Multi-line
           block */
        let x = 10; # Python style
      `;
      const tokens = tokenizeSourceCode(code);
      expect(tokens).not.toContain("setup");
      expect(tokens).not.toContain("Multi-line");
      expect(tokens).toContain("KW_LET");
    });
  });

  describe("computeRabinKarpHashes & winnow", () => {
    it("should generate rolling hashes for token stream", () => {
      const tokens = ["KW_FOR", "IDENT", "OP_=", "NUM", "KW_TO", "NUM", "KW_DO", "IDENT"];
      const hashes = computeRabinKarpHashes(tokens, 4);
      expect(hashes.length).toBe(tokens.length - 4 + 1);
      expect(hashes[0].position).toBe(0);
      expect(typeof hashes[0].hash).toBe("number");
    });

    it("should select minimum hashes in sliding windows using winnowing", () => {
      const hashes = [
        { hash: 77, position: 0 },
        { hash: 74, position: 1 },
        { hash: 42, position: 2 },
        { hash: 17, position: 3 },
        { hash: 98, position: 4 },
        { hash: 50, position: 5 },
      ];
      const fingerprints = winnow(hashes, 4);
      expect(fingerprints.size).toBeGreaterThan(0);
      expect(fingerprints.has(17)).toBe(true);
    });
  });

  describe("calculateJaccardSimilarity", () => {
    it("should return 1.0 for identical fingerprint sets", () => {
      const fp = new Set([101, 202, 303, 404]);
      expect(calculateJaccardSimilarity(fp, fp)).toBe(1.0);
    });

    it("should return 0.0 for disjoint fingerprint sets", () => {
      const fp1 = new Set([1, 2, 3]);
      const fp2 = new Set([4, 5, 6]);
      expect(calculateJaccardSimilarity(fp1, fp2)).toBe(0.0);
    });
  });

  describe("detectPlagiarism (Variable Renaming & Structural Invariance)", () => {
    it("should detect high similarity despite variable renaming and whitespace alterations", () => {
      const originalCode = `
        function binarySearch(arr, target) {
          let low = 0;
          let high = arr.length - 1;
          while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (arr[mid] === target) {
              return mid;
            } else if (arr[mid] < target) {
              low = mid + 1;
            } else {
              high = mid - 1;
            }
          }
          return -1;
        }
      `;

      const obfuscatedCode = `
        function searchTarget(numsList, searchVal) {
          let startIdx = 0;
          let endIdx = numsList.length - 1;
          while (startIdx <= endIdx) {
            let middlePivot = Math.floor((startIdx + endIdx) / 2);
            if (numsList[middlePivot] === searchVal) {
              return middlePivot;
            } else if (numsList[middlePivot] < searchVal) {
              startIdx = middlePivot + 1;
            } else {
              endIdx = middlePivot - 1;
            }
          }
          return -1;
        }
      `;

      const result = detectPlagiarism({
        candidateCode: obfuscatedCode,
        referenceCorpus: [{ title: "Canonical Binary Search", code: originalCode }],
        threshold: 0.7,
      });

      expect(result.isFlagged).toBe(true);
      expect(result.maxSimilarity).toBeGreaterThanOrEqual(0.75);
      expect(result.matchedTitle).toBe("Canonical Binary Search");
    });

    it("should not flag distinct algorithmic approaches", () => {
      const codeA = `
        function twoSum(nums, target) {
          const map = new Map();
          for (let i = 0; i < nums.length; i++) {
            const comp = target - nums[i];
            if (map.has(comp)) return [map.get(comp), i];
            map.set(nums[i], i);
          }
          return [];
        }
      `;

      const codeB = `
        function invertBinaryTree(root) {
          if (!root) return null;
          const left = invertBinaryTree(root.left);
          const right = invertBinaryTree(root.right);
          root.left = right;
          root.right = left;
          return root;
        }
      `;

      const result = detectPlagiarism({
        candidateCode: codeB,
        referenceCorpus: [{ title: "Two Sum Hashmap", code: codeA }],
        threshold: 0.65,
      });

      expect(result.isFlagged).toBe(false);
      expect(result.maxSimilarity).toBeLessThan(0.3);
    });
  });
});
