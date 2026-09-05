const mongoose = require("mongoose");

const requirementBlockSchema = new mongoose.Schema({
  recruiter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  category: {
    type: String,
    enum: ["benefits", "requirements", "responsibilities", "qualifications", "culture"],
    default: "requirements",
    index: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000,
  },
  skills: [{
    type: String,
    trim: true,
    maxlength: 80,
  }],
  usageCount: {
    type: Number,
    default: 0,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

requirementBlockSchema.index({ recruiter: 1, category: 1 });

module.exports = mongoose.model("RequirementBlock", requirementBlockSchema);
