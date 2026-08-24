const mongoose = require("mongoose");
const config = require("./config/env");
const InterviewSession = require("./models/InterviewSession");
const CodeCheckpoint = require("./models/CodeCheckpoint");
const TimelineEvent = require("./models/TimelineEvent");

async function check() {
  await mongoose.connect(config.mongoUri);
  const session = await InterviewSession.findOne({ roomKey: "room-demo-evaluated-session" });
  console.log("Session found:", session?._id, session?.title);
  const checkpoints = await CodeCheckpoint.find({ session: session._id }).lean();
  console.log("Checkpoints count:", checkpoints.length, JSON.stringify(checkpoints, null, 2));
  const events = await TimelineEvent.find({ session: session._id }).lean();
  console.log("Timeline events count:", events.length);
  process.exit(0);
}

check().catch(console.error);
