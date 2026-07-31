const Y = require("yjs");
const {
  getOrCreateRoomDoc,
  setFileContentInDoc,
  getFileContentFromDoc,
  cleanupRoomDoc,
  createSyncStep1,
} = require("../../src/infrastructure/realtime/yjsCoordinator");

describe("Phase 3: Realtime Infrastructure & Yjs CRDT Synchronization", () => {
  const testRoomKey = `test-room-crdt-${Date.now()}`;

  afterAll(() => {
    cleanupRoomDoc(testRoomKey);
  });

  describe("Yjs CRDT Document Lifecycle", () => {
    it("should initialize a singleton Y.Doc per room key", async () => {
      const room1 = await getOrCreateRoomDoc(testRoomKey);
      const room2 = await getOrCreateRoomDoc(testRoomKey);

      expect(room1).toBeDefined();
      expect(room1.doc).toBeInstanceOf(Y.Doc);
      expect(room1.doc).toBe(room2.doc); // Singleton reference
    });

    it("should support concurrent text edits on shared files with automatic convergence", async () => {
      const filename = "solution.py";
      await setFileContentInDoc(testRoomKey, filename, "def twoSum(nums, target):\n    return []\n");

      expect(await getFileContentFromDoc(testRoomKey, filename)).toContain("def twoSum");

      // Simulate Client A appending code
      const room = await getOrCreateRoomDoc(testRoomKey);
      const yText = room.doc.getText(filename);

      room.doc.transact(() => {
        yText.insert(yText.length, "# Client A added comment\n");
      });

      // Simulate Client B inserting a docstring
      room.doc.transact(() => {
        yText.insert(0, '"""Two Sum Problem Solution"""\n');
      });

      const finalContent = await getFileContentFromDoc(testRoomKey, filename);
      expect(finalContent).toContain('"""Two Sum Problem Solution"""');
      expect(finalContent).toContain("def twoSum");
      expect(finalContent).toContain("# Client A added comment");
    });

    it("should generate standard binary sync step 1 messages for connecting peers", async () => {
      const room = await getOrCreateRoomDoc(testRoomKey);
      const syncStep1 = createSyncStep1(room.doc);

      expect(syncStep1).toBeInstanceOf(Buffer);
      expect(syncStep1.length).toBeGreaterThan(0);
    });
  });
});
