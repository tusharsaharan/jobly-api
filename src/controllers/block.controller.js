const RequirementBlock = require("../models/RequirementBlock");
const logger = require("../config/logger");

const DEFAULT_BLOCKS = [
  {
    _id: "default-benefits-standard",
    name: "Standard Tech Benefits & Perks",
    category: "benefits",
    content: "• Comprehensive health, dental, and vision insurance with 100% premium coverage\n• 401(k) retirement match up to 5%\n• Flexible paid time off (PTO) and parental leave\n• Annual learning and development stipend ($2,500/year)\n• Home office setup allowance for remote team members",
    skills: [],
    isDefault: true,
    usageCount: 42,
  },
  {
    _id: "default-eeo-statement",
    name: "Equal Opportunity & DEI Statement",
    category: "culture",
    content: "We are an equal opportunity employer committed to building a diverse and inclusive team. We do not discriminate on the basis of race, religion, color, national origin, gender, sexual orientation, age, marital status, veteran status, or disability status.",
    skills: [],
    isDefault: true,
    usageCount: 68,
  },
  {
    _id: "default-frontend-core",
    name: "Senior Frontend Engineering Standards",
    category: "responsibilities",
    content: "• Architect, develop, and maintain high-performance web applications using React, TypeScript, and modern state management\n• Collaborate closely with product managers and designers to translate user workflows into intuitive interfaces\n• Write clean, well-tested, and maintainable code with unit and integration coverage\n• Conduct thorough code reviews and mentor junior engineering team members",
    skills: ["React", "TypeScript", "HTML5", "CSS3", "State Management", "Jest"],
    isDefault: true,
    usageCount: 31,
  },
  {
    _id: "default-backend-core",
    name: "Backend Distributed Systems Qualifications",
    category: "qualifications",
    content: "• 4+ years of professional backend software engineering experience building scalable microservices\n• Strong proficiency in Node.js, Go, or Python with deep knowledge of asynchronous programming\n• Hands-on experience with relational (PostgreSQL) and NoSQL (MongoDB, Redis) databases\n• Practical experience designing RESTful and GraphQL APIs with robust authentication and rate limiting",
    skills: ["Node.js", "PostgreSQL", "MongoDB", "Redis", "REST APIs", "Docker"],
    isDefault: true,
    usageCount: 29,
  }
];

/**
 * Get all requirement blocks (Default + Custom for recruiter)
 */
exports.getBlocks = async (req, res) => {
  try {
    const customBlocks = await RequirementBlock.find({ recruiter: req.user._id })
      .sort({ usageCount: -1, createdAt: -1 })
      .lean();

    res.json({
      blocks: [...DEFAULT_BLOCKS, ...customBlocks]
    });
  } catch (err) {
    logger.error({ err: err.message }, "Failed to get requirement blocks");
    res.status(500).json({ msg: "Failed to retrieve requirement blocks" });
  }
};

/**
 * Create a new custom requirement block
 */
exports.createBlock = async (req, res) => {
  try {
    const { name, category, content, skills = [] } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ msg: "Block name must be at least 2 characters." });
    }
    if (!content || content.trim().length < 10) {
      return res.status(400).json({ msg: "Block content must be at least 10 characters." });
    }

    const block = await RequirementBlock.create({
      recruiter: req.user._id,
      name: name.trim(),
      category: ["benefits", "requirements", "responsibilities", "qualifications", "culture"].includes(category)
        ? category
        : "requirements",
      content: content.trim(),
      skills: Array.isArray(skills) ? skills.map(s => String(s).trim()).filter(Boolean) : [],
    });

    res.status(201).json(block);
  } catch (err) {
    logger.error({ err: err.message }, "Failed to create requirement block");
    res.status(500).json({ msg: "Failed to save requirement block" });
  }
};

/**
 * Update an existing custom block
 */
exports.updateBlock = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, content, skills } = req.body;

    const block = await RequirementBlock.findOne({ _id: id, recruiter: req.user._id });
    if (!block) {
      return res.status(404).json({ msg: "Requirement block not found or unauthorized." });
    }

    if (name) block.name = name.trim();
    if (category) block.category = category;
    if (content) block.content = content.trim();
    if (Array.isArray(skills)) block.skills = skills.map(s => String(s).trim()).filter(Boolean);

    await block.save();
    res.json(block);
  } catch (err) {
    logger.error({ err: err.message }, "Failed to update requirement block");
    res.status(500).json({ msg: "Failed to update requirement block" });
  }
};

/**
 * Delete a custom block
 */
exports.deleteBlock = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await RequirementBlock.deleteOne({ _id: id, recruiter: req.user._id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ msg: "Requirement block not found or unauthorized." });
    }

    res.json({ msg: "Requirement block deleted successfully." });
  } catch (err) {
    logger.error({ err: err.message }, "Failed to delete requirement block");
    res.status(500).json({ msg: "Failed to delete requirement block" });
  }
};

/**
 * Increment usage count when a block is inserted (tracking metric)
 */
exports.recordUsage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id.startsWith("default-")) {
      await RequirementBlock.updateOne(
        { _id: id, recruiter: req.user._id },
        { $inc: { usageCount: 1 } }
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ msg: "Failed to record block usage" });
  }
};
