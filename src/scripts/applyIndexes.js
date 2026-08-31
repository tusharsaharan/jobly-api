require("dotenv").config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require("../config/db");
const InterviewSession = require("../models/InterviewSession");
const TimelineEvent = require("../models/TimelineEvent");
const Job = require("../models/Job");
const User = require("../models/User");
const CodeCheckpoint = require("../models/CodeCheckpoint");
const WhiteboardSnapshot = require("../models/WhiteboardSnapshot");
const Application = require("../models/Application");
const mongoose = require("mongoose");

async function apply() {
  try {
    if (!process.env.MONGO_URI) {
      process.env.MONGO_URI = "mongodb://127.0.0.1:27017/jobmatch";
    }
    await connectDB();
    console.log("Syncing indexes for InterviewSession...");
    await InterviewSession.syncIndexes();
    console.log("Syncing indexes for TimelineEvent...");
    await TimelineEvent.syncIndexes();
    console.log("Syncing indexes for Job...");
    await Job.syncIndexes();
    console.log("Syncing indexes for User...");
    await User.syncIndexes();
    console.log("Syncing indexes for CodeCheckpoint...");
    await CodeCheckpoint.syncIndexes();
    console.log("Syncing indexes for WhiteboardSnapshot...");
    await WhiteboardSnapshot.syncIndexes();
    console.log("Syncing indexes for Application...");
    await Application.syncIndexes();
    
    console.log("All indexes synced successfully!");
    
    const sessionIndexes = await InterviewSession.collection.indexes();
    console.log("Current InterviewSession indexes:", sessionIndexes.map(idx => Object.keys(idx.key).join('_')));
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error("Failed to sync indexes:", err);
    process.exit(1);
  }
}

apply();
