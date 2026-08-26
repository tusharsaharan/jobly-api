const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const {
  getBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  recordUsage
} = require("../controllers/block.controller");

router.get("/", auth, role("recruiter"), getBlocks);
router.post("/", auth, role("recruiter"), createBlock);
router.put("/:id", auth, role("recruiter"), updateBlock);
router.delete("/:id", auth, role("recruiter"), deleteBlock);
router.post("/:id/use", auth, role("recruiter"), recordUsage);

module.exports = router;
