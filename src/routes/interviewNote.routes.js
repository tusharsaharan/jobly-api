const express = require("express");
const authMiddleware = require("../middleware/auth.middleware");
const controller = require("../controllers/interviewNote.controller");

const router = express.Router({ mergeParams: true });
router.use(authMiddleware);
router.get("/", controller.list);
router.post("/", controller.create);
router.patch("/:noteId", controller.update);
router.delete("/:noteId", controller.remove);

module.exports = router;
