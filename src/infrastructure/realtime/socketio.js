const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { createAdapter } = require("@socket.io/redis-adapter");
const logger = require("../../config/logger");
const { getRedisClient } = require("../../config/redis");
const User = require("../../models/User");

let io = null;
const focusEventDedup = new Map();
const FOCUS_EVENT_TYPES = new Set(["tab_hidden", "window_blur", "fullscreen_exit", "focus_restored"]);

function setupSocketIO(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  // Attach Redis adapter for horizontal scaling across multi-node instances if Redis is connected
  try {
    const pubClient = getRedisClient();
    if (pubClient && pubClient.status === "ready") {
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      logger.info("⚡ Socket.IO configured with Redis Streams cluster adapter");
    }
  } catch (err) {
    logger.debug({ err: err.message }, "Socket.IO using in-memory pubsub adapter");
  }

  // Socket Authentication Middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(" ")[1];
    if (!token) {
      return next(new Error("Authentication token required for real-time messaging"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "development_secret_key_12345678");
      const user = await User.findById(decoded.id).select("-password -resumeText").lean();
      if (!user) {
        return next(new Error("User account not found"));
      }
      socket.user = user;
      next();
    } catch (err) {
      return next(new Error("Invalid authentication token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = String(socket.user._id);
    logger.info({ userId, socketId: socket.id }, "Real-time client connected via WebSocket");

    // Join personal user room for private notifications
    socket.join(`user:${userId}`);

    // Join application room for live chat
    socket.on("join_conversation", (applicationId) => {
      socket.join(`app:${applicationId}`);
      logger.debug({ userId, applicationId }, "Joined conversation room");
    });

    socket.on("leave_conversation", (applicationId) => {
      socket.leave(`app:${applicationId}`);
      logger.debug({ userId, applicationId }, "Left conversation room");
    });

    // Real-time typing indicators
    socket.on("typing_start", ({ applicationId }) => {
      socket.to(`app:${applicationId}`).emit("user_typing", {
        applicationId,
        userId,
        name: socket.user.name,
      });
    });

    socket.on("typing_stop", ({ applicationId }) => {
      socket.to(`app:${applicationId}`).emit("user_stop_typing", {
        applicationId,
        userId,
      });
    });

    // ==========================================
    // Real-Time Technical Interview Room Handlers
    // ==========================================
    socket.on("join_interview", async ({ roomKey }) => {
      if (!roomKey) return;
      const roomChannel = `interview:${roomKey}`;
      try {
        const InterviewSession = require("../../models/InterviewSession");
        const session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers").lean();
        if (!session) return;
        const isCandidate = String(session.seeker) === userId;
        const isInterviewTeam = String(session.recruiter) === userId
          || (session.additionalInterviewers || []).some((interviewerId) => String(interviewerId) === userId);
        if (!isCandidate && !isInterviewTeam) {
          socket.emit("interview_join_error", { message: "You do not have access to this interview room." });
          return;
        }

        socket.join(roomChannel);
        if (isInterviewTeam) socket.join(`${roomChannel}:interviewers`);
      } catch (err) {
        logger.warn({ err: err.message, roomKey, userId }, "Unable to join technical interview room");
        socket.emit("interview_join_error", { message: "Unable to join this interview room." });
        return;
      }
      logger.info({ userId, roomKey }, "Joined real-time technical interview room");

      // Broadcast presence to room members
      socket.to(roomChannel).emit("participant_joined", {
        userId,
        name: socket.user.name,
        role: socket.user.role,
        joinedAt: new Date().toISOString(),
      });
    });

    // Browser focus is only a signal. It is visible to the interview team and
    // never treated as evidence of misconduct or an automated decision.
    socket.on("focus_attention_event", async ({ roomKey, type, occurredAt, clientEventId }) => {
      if (!roomKey || !FOCUS_EVENT_TYPES.has(type) || !clientEventId) return;
      const dedupKey = `${socket.user._id}:${clientEventId}`;
      if (focusEventDedup.has(dedupKey)) return;
      focusEventDedup.set(dedupKey, true);
      setTimeout(() => focusEventDedup.delete(dedupKey), 10 * 60 * 1000).unref?.();

      try {
        const InterviewSession = require("../../models/InterviewSession");
        const TimelineEvent = require("../../models/TimelineEvent");
        const session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers status actualStart").lean();
        if (!session || session.status !== "LIVE" || String(session.seeker) !== userId) return;

        const offsetMs = session.actualStart ? Math.max(0, Date.now() - new Date(session.actualStart).getTime()) : 0;
        await TimelineEvent.create({
          session: session._id,
          pipeline: "SYSTEM",
          eventType: `focus.${type}`,
          offsetMs,
          participant: socket.user._id,
          participantRole: "seeker",
          payload: { attention: { type, clientEventId, source: "browser" } },
        });
        io.to(`interview:${roomKey}:interviewers`).emit("focus_attention_received", {
          type,
          occurredAt: occurredAt || new Date().toISOString(),
          participantId: userId,
          offsetMs,
        });
      } catch (err) {
        logger.warn({ err: err.message, roomKey, userId }, "Unable to record browser focus event");
      }
    });

    // ==========================================
    // Real-Time Competition Room Handlers (Quiz / CP)
    // ==========================================
    socket.on("join_competition", async ({ roomKey }) => {
      if (!roomKey) return;
      const compChannel = `competition:${roomKey}`;
      try {
        const CompetitionRoom = require("../../models/CompetitionRoom");
        const room = await CompetitionRoom.findOne({ roomKey });
        if (!room) {
          socket.emit("competition_error", { message: "Competition room not found." });
          return;
        }

        // Add user as participant if not already there
        const exists = room.participants.some(p => String(p.user) === userId);
        if (!exists && String(room.host) !== userId) {
          room.participants.push({ user: socket.user._id, name: socket.user.name, score: 0 });
          await room.save();
        }

        socket.join(compChannel);
        logger.info({ userId, roomKey }, "Joined competition room");

        // Broadcast updated leaderboard
        io.to(compChannel).emit("competition_leaderboard", {
          participants: room.participants,
        });
      } catch (err) {
        logger.error({ err: err.message }, "Error joining competition");
      }
    });

    socket.on("start_competition", async ({ roomKey }) => {
      try {
        const CompetitionRoom = require("../../models/CompetitionRoom");
        const room = await CompetitionRoom.findOne({ roomKey });
        if (!room || String(room.host) !== userId) return;

        room.status = "LIVE";
        room.actualStart = new Date();
        await room.save();

        io.to(`competition:${roomKey}`).emit("competition_started", { actualStart: room.actualStart });
      } catch (err) {
        logger.error({ err: err.message }, "Error starting competition");
      }
    });

    socket.on("competition_submission", async ({ roomKey, problemIndex, answer }) => {
      try {
        const CompetitionRoom = require("../../models/CompetitionRoom");
        const room = await CompetitionRoom.findOne({ roomKey });
        if (!room || room.status !== "LIVE") return;

        const problem = room.problems[problemIndex];
        const participant = room.participants.find(p => String(p.user) === userId);
        if (!problem || !participant) return;

        let points = 0;
        if (room.type === "QUIZ") {
          if (answer === problem.correctAnswer) points = 10;
        } else if (room.type === "CP") {
          // Mock CP evaluation for now
          points = 100; 
        }

        if (points > 0) {
          participant.score += points;
          await room.save();
          io.to(`competition:${roomKey}`).emit("competition_leaderboard", {
            participants: room.participants,
          });
        }
      } catch (err) {
        logger.error({ err: err.message }, "Error processing submission");
      }
    });



    socket.on("leave_interview", ({ roomKey }) => {
      const roomChannel = `interview:${roomKey}`;
      socket.leave(roomChannel);
      socket.to(roomChannel).emit("participant_left", {
        userId,
        leftAt: new Date().toISOString(),
      });
      logger.info({ userId, roomKey }, "Left technical interview room");
    });

    // Ephemeral Live Code Cursor / Selection Presence
    socket.on("editor_cursor_move", ({ roomKey, cursor, file }) => {
      socket.to(`interview:${roomKey}`).emit("peer_cursor_update", {
        userId,
        name: socket.user.name,
        cursor, // { lineNumber, column }
        file,
      });
    });

    // Ephemeral Whiteboard Cursor Presence
    socket.on("whiteboard_cursor_move", ({ roomKey, point }) => {
      socket.to(`interview:${roomKey}`).emit("peer_whiteboard_cursor", {
        userId,
        name: socket.user.name,
        point, // { x, y }
      });
    });

    // Whiteboard Incremental Delta Synchronization
    socket.on("whiteboard_delta", ({ roomKey, delta, snapshotVersion }) => {
      socket.to(`interview:${roomKey}`).emit("whiteboard_delta_broadcast", {
        senderId: userId,
        delta,
        snapshotVersion,
      });
    });

    // Real-Time Live Transcript Broadcast
    socket.on("transcript_chunk", async ({ roomKey, text, isFinal, offsetMs }) => {
      socket.to(`interview:${roomKey}`).emit("live_transcript_received", {
        senderId: userId,
        speakerName: socket.user.name,
        role: socket.user.role,
        text,
        isFinal,
        offsetMs,
        timestamp: Date.now(),
      });

      // Persist final chunks into TimelineEvents
      if (isFinal && text) {
        try {
          const InterviewSession = require("../../models/InterviewSession");
          const session = await InterviewSession.findOne({ roomKey });
          if (session) {
            const transcriptionService = require("../../services/transcriptionService");
            await transcriptionService.recordTranscriptSegment({
              sessionId: session._id,
              participantId: userId,
              participantRole: socket.user.role || "seeker",
              text,
              isFinal: true,
              offsetMs,
            });
          }
        } catch (err) {
          logger.debug({ err: err.message }, "Error recording transcript chunk");
        }
      }
    });

    // Real-Time Interactive Terminal Streaming
    socket.on("terminal_input", ({ terminalId, data }) => {
      try {
        const terminalService = require("../terminal/terminalService");
        Promise.resolve(terminalService.writeToTerminal(terminalId, data)).catch((err) => {
          logger.debug({ err: err.message, terminalId }, "Terminal input error");
        });
      } catch (err) {
        logger.debug({ err: err.message, terminalId }, "Terminal input error");
      }
    });

    socket.on("terminal_resize", ({ terminalId, cols, rows }) => {
      try {
        const terminalService = require("../terminal/terminalService");
        Promise.resolve(terminalService.resizeTerminal(terminalId, cols, rows)).catch((err) => {
          logger.debug({ err: err.message, terminalId }, "Terminal resize error");
        });
      } catch (err) {
        logger.debug({ err: err.message, terminalId }, "Terminal resize error");
      }
    });

    // Real-Time Signal & Copilot Coordination
    socket.on("live_signal_extracted", ({ roomKey, signal }) => {
      if (!roomKey || !signal) return;
      socket.to(`interview:${roomKey}:interviewers`).emit("interview_signal_received", {
        senderId: userId,
        signal,
        receivedAt: new Date().toISOString(),
      });
    });

    socket.on("copilot_hint_request", async ({ roomKey, code, language, currentStage }) => {
      if (!roomKey) return;
      try {
        const InterviewSession = require("../../models/InterviewSession");
        const session = await InterviewSession.findOne({ roomKey }).populate("job").lean();
        if (session) {
          const interviewAssistant = require("../../modules/ai/interviewAssistant");
          const followUp = await interviewAssistant.generateFollowUp({
            session,
            activeCode: code || "",
            activeLanguage: language || "javascript",
            currentStage: currentStage || "CODING",
          });
          io.to(`interview:${roomKey}:interviewers`).emit("copilot_hint_received", {
            followUp,
            generatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        logger.debug({ err: err.message }, "Error generating copilot hint over socket");
      }
    });

    // ==========================================
    // Multiplayer Competition Hub Events
    // ==========================================
    socket.on("join_comp_lobby", ({ pin }) => {
      socket.join(`comp_lobby:${pin}`);
      socket.to(`comp_lobby:${pin}`).emit("player_joined", {
        userId,
        name: socket.user.name
      });
      logger.info({ userId, pin }, "Joined competition lobby");
    });

    socket.on("start_comp", ({ pin }) => {
      io.to(`comp_lobby:${pin}`).emit("comp_started", {
        startedAt: new Date().toISOString()
      });
    });

    socket.on("submit_comp_answer", ({ pin, questionIndex, isCorrect, scoreDelta }) => {
      // In a real prod environment we'd validate this against Redis or DB
      io.to(`comp_lobby:${pin}`).emit("comp_score_update", {
        userId,
        questionIndex,
        isCorrect,
        scoreDelta
      });
    });

    socket.on("submit_cp_testcase", ({ pin, testCasesPassed }) => {
      io.to(`comp_lobby:${pin}`).emit("cp_score_update", {
        userId,
        testCasesPassed
      });
    });

    socket.on("disconnect", () => {
      logger.info({ userId, socketId: socket.id }, "Client disconnected from WebSocket");
    });
  });

  return io;
}

function getSocketIO() {
  return io;
}

const getIO = getSocketIO;

function emitToUser(userId, event, payload) {
  if (io) {
    io.to(`user:${String(userId)}`).emit(event, payload);
  }
}

function emitToConversation(applicationId, event, payload) {
  if (io) {
    io.to(`app:${String(applicationId)}`).emit(event, payload);
  }
}

module.exports = {
  setupSocketIO,
  getSocketIO,
  getIO,
  emitToUser,
  emitToConversation,
};
