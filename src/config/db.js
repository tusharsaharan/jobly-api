const mongoose = require("mongoose");

const connectDB = async (retries = 10) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        family: 4,
        serverSelectionTimeoutMS: 10000,
      });
      console.log("MongoDB connected");
      return;
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt === retries) {
        process.exit(1);
      }
      // Exponential backoff: 2s, 4s, 6s... up to 10s
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 10000)));
    }
  }
};

module.exports = connectDB;
