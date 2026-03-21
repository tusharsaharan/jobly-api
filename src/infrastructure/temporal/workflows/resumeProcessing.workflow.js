const { proxyActivities } = require("@temporalio/workflow");

const activities = proxyActivities({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumAttempts: 4,
    nonRetryableErrorTypes: ["ValidationError", "InvalidPdfError"],
  },
});

/**
 * Durable Temporal Workflow for End-to-End Resume Ingestion
 */
async function resumeProcessingWorkflow(jobData) {
  // Step 1: Text extraction activity
  const text = await activities.extractTextActivity(jobData);
  if (!text || text.trim().length < 30) {
    throw new Error("Could not extract readable text from PDF.");
  }

  // Step 2: AI parsing activity
  const parsed = await activities.aiParseActivity({
    userId: jobData.userId,
    text,
  });

  // Step 3: Persistence activity
  const { user, updateData } = await activities.persistProfileActivity({
    userId: jobData.userId,
    text,
    parsed,
  });

  // Step 4: Fan-out ATS recalibration across applications
  const candidateProfile = {
    skills: user.skills,
    college: user.college,
    collegeTier: user.collegeTier,
    cgpa: user.cgpa,
    achievements: user.achievements,
    experience: user.experience,
    degree: user.degree,
  };

  await activities.recalibrateAtsScoresActivity({
    userId: jobData.userId,
    resumeText: text,
    candidateProfile,
  });

  // Step 5: Final notification and domain event publish
  await activities.notifyCompletionActivity({
    userId: jobData.userId,
    updateData,
  });

  return { success: true, userId: jobData.userId };
}

module.exports = {
  resumeProcessingWorkflow,
};
