const mongoose = require("mongoose");
const Application = require("../models/Application");
const Message = require("../models/Message");
const logger = require("../config/logger");
const sanitizeHtml = require("sanitize-html");
const { getIO } = require("../infrastructure/realtime/socketio");
const { publishDomainEvent } = require("../infrastructure/events/domainEvents");
const { defaultRRFEngine } = require("../modules/search/rrfEngine");
const { generateLinkedInSmartReplies } = require("../modules/messages/smartReplyEngine");
const aiService = require("../modules/ai/aiService");

/**
 * Get all conversations for the logged-in user with latest message, unread count & interview link
 */
exports.getUserConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all applications where user is either candidate (seeker) or recruiter
    const applications = await Application.find({
      $or: [{ seeker: userId }, { recruiter: userId }],
    })
      .populate("seeker", "name email role skills experience college")
      .populate("recruiter", "name email role")
      .populate("job", "title company location type atsRequirements")
      .sort({ updatedAt: -1 })
      .lean();

    if (!applications.length) {
      return res.json([]);
    }

    const applicationIds = applications.map((a) => a._id);

    // Aggregate latest message per application thread
    const latestMessages = await Message.aggregate([
      { $match: { application: { $in: applicationIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$application",
          messageId: { $first: "$_id" },
          text: { $first: "$text" },
          createdAt: { $first: "$createdAt" },
          sender: { $first: "$sender" },
          recipient: { $first: "$recipient" },
          readAt: { $first: "$readAt" },
        },
      },
    ]);

    const latestMap = new Map(latestMessages.map((m) => [String(m._id), m]));

    // Aggregate unread counts for the current user
    const unreadCounts = await Message.aggregate([
      {
        $match: {
          application: { $in: applicationIds },
          recipient: new mongoose.Types.ObjectId(userId),
          readAt: null,
        },
      },
      { $group: { _id: "$application", count: { $sum: 1 } } },
    ]);

    const unreadMap = new Map(unreadCounts.map((u) => [String(u._id), u.count]));

    // Find associated active/scheduled interview sessions
    let sessionMap = new Map();
    try {
      const InterviewSession = require("../models/InterviewSession");
      const sessions = await InterviewSession.find({
        application: { $in: applicationIds },
      })
        .select("application roomKey status scheduledStart activeStage")
        .lean();
      sessionMap = new Map(sessions.map((s) => [String(s.application), s]));
    } catch (err) {
      logger.debug({ err: err.message }, "InterviewSession query skipped");
    }

    const conversations = applications.map((app) => {
      const isRecruiter = String(app.recruiter?._id || app.recruiter) === String(userId);
      const counterpart = isRecruiter ? app.seeker : app.recruiter;
      const lastMsg = latestMap.get(String(app._id)) || null;
      const unreadCount = unreadMap.get(String(app._id)) || 0;
      const interviewSession = sessionMap.get(String(app._id)) || null;

      return {
        applicationId: app._id,
        status: app.status,
        atsScore: app.atsScore,
        createdAt: app.createdAt,
        updatedAt: lastMsg ? lastMsg.createdAt : app.updatedAt,
        job: app.job,
        counterpart: {
          _id: counterpart?._id,
          name: counterpart?.name || (isRecruiter ? "Candidate" : "Recruiter"),
          email: counterpart?.email,
          role: counterpart?.role || (isRecruiter ? "seeker" : "recruiter"),
        },
        lastMessage: lastMsg,
        unreadCount,
        interviewSession,
      };
    });

    // Sort conversations chronologically by latest activity
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    const queryTerm = String(req.query.q || req.query.search || "").trim();
    if (queryTerm) {
      const convTextExtractor = (c) =>
        `${c.counterpart?.name || ""} ${c.counterpart?.email || ""} ${c.job?.title || ""} ${c.job?.company || ""} ${c.lastMessage?.text || ""}`;

      const rrfResults = await defaultRRFEngine.search(conversations, convTextExtractor, queryTerm, {
        wBM25: 1.0,
        wDense: 1.0,
        k: 60,
      });

      const ranked = rrfResults.map((r) => ({
        ...r.item,
        searchMetadata: {
          rrfScore: r.rrfScore,
          bm25Score: r.bm25Score,
          vectorScore: r.vectorScore,
          bm25Rank: r.bm25Rank,
          vectorRank: r.vectorRank,
          matchedTokens: r.matchedTokens,
        },
      }));

      return res.json(ranked);
    }

    res.json(conversations);
  } catch (error) {
    logger.error({ err: error.message }, "Failed to get user conversations");
    res.status(500).json({ msg: "Failed to load conversations." });
  }
};

/**
 * Get all messages for a specific application thread
 */
exports.getApplicationMessages = async (req, res) => {
  try {
    const application = await findParticipantApplication(req.params.applicationId, req.user._id);
    if (!application) return res.status(403).json({ msg: "You do not have access to this conversation." });

    // Mark unread messages as read automatically
    const now = new Date();
    const updateResult = await Message.updateMany(
      { application: application._id, recipient: req.user._id, readAt: null },
      { $set: { readAt: now } }
    );

    if (updateResult.modifiedCount > 0) {
      try {
        const io = getIO();
        if (io) {
          io.to(`app:${application._id}`).emit("messages_read", {
            applicationId: application._id,
            readerId: req.user._id,
            readAt: now,
          });
        }
      } catch (socketErr) {
        logger.debug({ err: socketErr.message }, "Failed emitting messages_read");
      }
    }

    const messages = await Message.find({ application: application._id })
      .populate("sender", "name role")
      .sort({ createdAt: 1 })
      .lean();

    res.json(messages);
  } catch (error) {
    logger.error({ err: error.message }, "Failed to load messages");
    res.status(500).json({ msg: "Failed to load messages." });
  }
};

/**
 * Send a message in an application thread
 */
exports.sendApplicationMessage = async (req, res) => {
  try {
    const application = await findParticipantApplication(req.params.applicationId, req.user._id);
    if (!application) return res.status(403).json({ msg: "You do not have access to this conversation." });

    const text = cleanMessageText(req.body?.text);
    if (!text) return res.status(422).json({ msg: "Message cannot be empty." });
    if (text.length > 2000) return res.status(422).json({ msg: "Messages cannot exceed 2,000 characters." });

    const recipient = application.recruiter.toString() === req.user._id.toString()
      ? application.seeker
      : application.recruiter;

    const message = await Message.create({
      application: application._id,
      sender: req.user._id,
      recipient,
      text,
    });

    await message.populate("sender", "name role");

    // Real-time broadcast via Socket.IO
    try {
      const io = getIO();
      if (io) {
        io.to(`app:${application._id}`).emit("new_message", message);
        io.to(`user:${recipient}`).emit("message_notification", {
          applicationId: application._id,
          senderName: req.user.name,
          preview: text.slice(0, 80),
        });
      }
    } catch (socketErr) {
      logger.warn({ err: socketErr.message }, "Failed emitting message over Socket.IO");
    }

    // Publish domain event
    await publishDomainEvent("message.sent", {
      messageId: String(message._id),
      applicationId: String(application._id),
      senderId: String(req.user._id),
      recipientId: String(recipient),
    });

    res.status(201).json(message);
  } catch (error) {
    logger.error({ err: error.message }, "Failed to send message");
    res.status(500).json({ msg: "Failed to send message." });
  }
};

/**
 * Mark messages in application thread as read
 */
exports.markApplicationMessagesRead = async (req, res) => {
  try {
    const application = await findParticipantApplication(req.params.applicationId, req.user._id);
    if (!application) return res.status(403).json({ msg: "You do not have access to this conversation." });

    const now = new Date();
    const result = await Message.updateMany(
      { application: application._id, recipient: req.user._id, readAt: null },
      { $set: { readAt: now } }
    );

    if (result.modifiedCount > 0) {
      try {
        const io = getIO();
        if (io) {
          io.to(`app:${application._id}`).emit("messages_read", {
            applicationId: application._id,
            readerId: req.user._id,
            readAt: now,
          });
        }
      } catch (socketErr) {
        logger.debug({ err: socketErr.message }, "Failed emitting messages_read");
      }
    }

    res.json({ success: true, count: result.modifiedCount, readAt: now });
  } catch (error) {
    logger.error({ err: error.message }, "Failed to mark messages as read");
    res.status(500).json({ msg: "Failed to mark messages as read." });
  }
};

/**
 * Get LinkedIn-grade Smart Replies for a given application conversation
 */
exports.getApplicationSmartReplies = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const userId = req.user._id;

    const application = await Application.findById(applicationId)
      .populate("seeker", "name email role")
      .populate("recruiter", "name email role")
      .populate("job", "title company skills")
      .lean();

    if (!application) {
      return res.status(404).json({ msg: "Conversation not found." });
    }

    const isSeeker = String(application.seeker?._id || application.seeker) === String(userId);
    const isRecruiter = String(application.recruiter?._id || application.recruiter) === String(userId);

    if (!isSeeker && !isRecruiter) {
      return res.status(403).json({ msg: "Unauthorized access to conversation." });
    }

    const messages = await Message.find({ application: applicationId })
      .sort({ createdAt: 1 })
      .limit(30)
      .lean();

    const counterpart = isSeeker ? application.recruiter : application.seeker;
    const userRole = isSeeker ? "seeker" : "recruiter";

    const replies = generateLinkedInSmartReplies({
      messages,
      userRole,
      currentUserId: userId,
      counterpart,
      job: application.job,
      applicationStatus: application.status,
    });

    res.json({ replies });
  } catch (error) {
    logger.error({ err: error.message }, "Failed to generate smart replies");
    res.status(500).json({ msg: "Failed to generate smart replies." });
  }
};

/**
 * Generate an Instagram-style AI summary of an application conversation thread
 */
exports.summarizeApplicationConversation = async (req, res) => {
  try {
    const application = await Application.findById(req.params.applicationId)
      .select("recruiter seeker job status")
      .populate("seeker", "name role")
      .populate("recruiter", "name role")
      .populate("job", "title company")
      .lean();
    if (!application) {
      return res.status(404).json({ msg: "Conversation not found." });
    }

    const userId = String(req.user._id);
    const isParticipant =
      String(application.seeker?._id || application.seeker) === userId ||
      String(application.recruiter?._id || application.recruiter) === userId;
    if (!isParticipant) {
      return res.status(403).json({ msg: "You do not have access to this conversation." });
    }

    const messages = await Message.find({ application: application._id })
      .populate("sender", "name role")
      .sort({ createdAt: 1 })
      .lean();

    if (!messages.length) {
      return res.json({
        summary: "",
        highlights: [],
        messageCount: 0,
        generatedAt: new Date().toISOString(),
      });
    }

    const seekers = application.seeker?.name || "Candidate";
    const recruiter = application.recruiter?.name || "Recruiter";

    const result = await aiService.summarizeConversation({
      messages,
      participants: { seeker: seekers, recruiter },
      jobContext: {
        title: application.job?.title || "",
        company: application.job?.company || "",
      },
    });

    res.json({
      summary: result?.summary || "",
      highlights: Array.isArray(result?.highlights) ? result.highlights : [],
      messageCount: messages.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error.message }, "Failed to summarize conversation");
    res.status(500).json({ msg: "Failed to summarize conversation." });
  }
};

async function findParticipantApplication(applicationId, userId) {
  if (!mongoose.Types.ObjectId.isValid(applicationId)) return null;
  const application = await Application.findById(applicationId).select("recruiter seeker").lean();
  if (!application) return null;
  const user = userId.toString();
  return application.recruiter.toString() === user || application.seeker.toString() === user
    ? application
    : null;
}

function cleanMessageText(value) {
  if (typeof value !== "string") return "";
  const sanitized = sanitizeHtml(value, {
    allowedTags: [], // Strip all HTML tags
    allowedAttributes: {},
  });
  return sanitized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}
