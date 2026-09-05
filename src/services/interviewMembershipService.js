const InterviewSession = require("../models/InterviewSession");

/**
 * Authoritative membership service for interview sessions
 * Resolves session by ObjectId or roomKey and computes member capabilities
 */
async function getMembership({ sessionOrRoomKey, userId, requiredCapability = null }) {
  if (!sessionOrRoomKey) {
    const error = new Error("Session identifier or roomKey required");
    error.status = 400;
    throw error;
  }

  const isObjectId = typeof sessionOrRoomKey === "string" && /^[0-9a-fA-F]{24}$/.test(sessionOrRoomKey);
  const query = isObjectId ? { _id: sessionOrRoomKey } : { roomKey: sessionOrRoomKey };

  const session = await InterviewSession.findOne(query)
    .populate("seeker recruiter additionalInterviewers job application")
    .lean();

  if (!session) {
    const error = new Error("Interview session not found");
    error.status = 404;
    throw error;
  }

  const uid = String(userId?._id || userId?.id || userId);
  const isSeeker = String(session.seeker?._id || session.seeker) === uid;
  const isRecruiter = String(session.recruiter?._id || session.recruiter) === uid;
  const isAdditional = (session.additionalInterviewers || []).some(
    (id) => String(id?._id || id) === uid
  );

  if (!isSeeker && !isRecruiter && !isAdditional) {
    const error = new Error("Access denied. You are not an authorized participant in this session.");
    error.status = 403;
    throw error;
  }

  const role = isSeeker ? "seeker" : isRecruiter ? "recruiter" : "additional_interviewer";
  const isTeam = isRecruiter || isAdditional;

  const capabilities = {
    canViewSession: true,
    canJoinRoom: ["SCHEDULED", "WAITING_ROOM", "LIVE"].includes(session.status),
    canEditCode: true,
    canEditWhiteboard: true,
    canRunCode: true,
    canControlStage: isRecruiter,
    canViewPrivateNotes: isTeam,
    canViewReview: isTeam && session.status === "COMPLETED",
    canViewScorecard: isTeam,
    canViewCandidateFeedback: isSeeker && session.status === "COMPLETED",
    canReplay: session.status === "COMPLETED",
    canInvite: isRecruiter,
  };

  if (requiredCapability && !capabilities[requiredCapability]) {
    const error = new Error(`Access denied. Missing required capability: ${requiredCapability}`);
    error.status = 403;
    throw error;
  }

  return {
    session,
    user: userId,
    role,
    isSeeker,
    isRecruiter,
    isAdditional,
    isTeam,
    capabilities,
  };
}

module.exports = {
  getMembership,
};
