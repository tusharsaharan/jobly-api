const express = require("express");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const { updateSkills } = require("../controllers/auth.controller");
const router = express.Router();

router.get("/me", auth, (req, res) => res.json(req.user));
router.patch("/skills", auth, updateSkills);

module.exports = router;
