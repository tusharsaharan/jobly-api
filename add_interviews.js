require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./src/models/User");
const Job = require("./src/models/Job");
const Application = require("./src/models/Application");
const InterviewSession = require("./src/models/InterviewSession");
const crypto = require("crypto");

async function addInterviews() {
  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/jobmatch";
  await mongoose.connect(mongoUri);
  console.log("Connected to DB");

  const seeker = await User.findOne({ email: "candidate@example.com" });
  const recruiter = await User.findOne({ email: "recruiter@techcorp.com" });

  if (!seeker || !recruiter) {
    console.error("Seeker or recruiter not found.");
    process.exit(1);
  }

  // Find an application for this seeker
  const application = await Application.findOne({ seeker: seeker._id });
  if (!application) {
    console.error("No application found for this seeker. Cannot create interview.");
    process.exit(1);
  }

  const job = await Job.findById(application.job);

  for (let i = 1; i <= 5; i++) {
    const roomKey = `room-demo-candidate-extra-${i}-${crypto.randomBytes(4).toString("hex")}`;
    const date = new Date();
    date.setDate(date.getDate() + i); // Schedule for future days

    await InterviewSession.create({
      application: application._id,
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      title: `Technical Interview Round ${i} - ${job.title}`,
      roomKey: roomKey,
      status: "SCHEDULED",
      stage: "WAITING_ROOM",
      scheduledStart: date,
    });
    console.log(`Created Interview ${i} for ${date.toDateString()} (Room Key: ${roomKey})`);
  }

  console.log("Done adding 5 interviews!");
  await mongoose.disconnect();
}

addInterviews().catch(err => {
  console.error(err);
  process.exit(1);
});
