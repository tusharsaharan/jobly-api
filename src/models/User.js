const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["seeker", "recruiter"],
    default: "seeker",
  },
  skills: [{ type: String, trim: true }],
  resumeText: { type: String },
  resumeSummary: { type: String },
  degree: { type: String, trim: true },
  cgpa: { type: Number },
  college: { type: String, trim: true },
  collegeTier: { type: String, enum: ["tier1", "tier2", "tier3", "unknown"], default: "unknown" },
  achievements: [{ type: String }],
  experience: [{ title: String, company: String, duration: String }],
  resumeProfile: { type: Object, default: null },
  resumeHealth: { type: Object, default: null },
  themePreference: { type: String, enum: ["system", "light", "dark"], default: "system" },
  focusPoints: { type: Number, default: 0 },
  currentStreak: { type: Number, default: 0 },
  lastFocusDate: { type: Date, default: null },
  codeforcesHandle: { type: String, trim: true, default: null },
}, { timestamps: true });

userSchema.index({ role: 1 });

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
