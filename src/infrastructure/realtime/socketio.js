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
// Plan Phase 6: rate limiting & debouncing for signal emissions
const signalRateMap = new Map(); // socketId -> { count, windowStart }
const copilotDebounceMap = new Map(); // userId:roomKey -> timeout handle
const copilotRateMap = new Map(); // userId -> { count, windowStart }
const SIGNAL_RATE_LIMIT = 10; // max 10 signals per second
const SIGNAL_WINDOW_MS = 1000;
const COPILOT_RATE_LIMIT = 5; // max 5 copilot requests per minute
const COPILOT_WINDOW_MS = 60 * 1000;
const COPILOT_DEBOUNCE_MS = 800;
// B12: per-session signal limit — generous enough for a long, chatty demo
// interview (a too-low cap silently starves the interviewer's signals panel).
const sessionSignalMap = new Map(); // sessionKey (roomKey or sessionId) -> count
const SESSION_SIGNAL_LIMIT = 300;

function isSignalRateLimited(socketId) {
 const now = Date.now();
 const entry = signalRateMap.get(socketId);
 if (!entry || now - entry.windowStart > SIGNAL_WINDOW_MS) {
 signalRateMap.set(socketId, { count: 1, windowStart: now });
 return false;
 }
 if (entry.count >= SIGNAL_RATE_LIMIT) return true;
 entry.count += 1;
 return false;
}

function isSessionSignalRateLimited(sessionKey) {
 if (!sessionKey) return false;
 const key = String(sessionKey);
 const count = sessionSignalMap.get(key) || 0;
 if (count >= SESSION_SIGNAL_LIMIT) return true;
 sessionSignalMap.set(key, count + 1);
 return false;
}
function isCopilotRateLimited(userId) {
 const now = Date.now();
 const entry = copilotRateMap.get(userId);
 if (!entry || now - entry.windowStart > COPILOT_WINDOW_MS) {
 copilotRateMap.set(userId, { count: 1, windowStart: now });
 return false;
 }
 if (entry.count >= COPILOT_RATE_LIMIT) return true;
 entry.count += 1;
 return false;
}

// Strip answer material from a quiz question before broadcasting to players.
// The host already knows the answers; players must not see them pre-reveal.
function sanitizeQuizQuestion(q) {
 if (!q || typeof q!== "object") return q;
 const { correctAnswer, explanation,...rest } = q;
 return rest;
}

function setupSocketIO(server) {
 const allowedOrigin = process.env.CLIENT_ORIGIN;
 io = new Server(server, {
 cors: {
 origin: allowedOrigin || "http://localhost:3000",
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
 logger.info(" Socket.IO configured with Redis Streams cluster adapter");
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
 const config = require("../../config/env");
 const secret = config.JWT_SECRET || process.env.JWT_SECRET;
 if (!secret) return next(new Error("Server misconfigured"));
 if (process.env.NODE_ENV!== "test" && secret.length < 32) return next(new Error("Server misconfigured"));
 const decoded = jwt.verify(token, secret);
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
 if (!isCandidate &&!isInterviewTeam) {
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
 if (!roomKey ||!FOCUS_EVENT_TYPES.has(type) ||!clientEventId) return;
 const dedupKey = `${socket.user._id}:${clientEventId}`;
 if (focusEventDedup.has(dedupKey)) return;
 focusEventDedup.set(dedupKey, true);
 setTimeout(() => focusEventDedup.delete(dedupKey), 10 * 60 * 1000).unref?.();

 try {
 const InterviewSession = require("../../models/InterviewSession");
 const TimelineEvent = require("../../models/TimelineEvent");
 const session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers status actualStart").lean();
 if (!session || session.status!== "LIVE" || String(session.seeker)!== userId) return;

 const offsetMs = session.actualStart? Math.max(0, Date.now() - new Date(session.actualStart).getTime()): 0;
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

 // Proctor event relay: ONLY seeker emits, forwarded to interview team (prevent recruiter impersonating candidate)
 socket.on("proctor_event", async ({ roomKey, eventType, timestamp }) => {
 if (!roomKey ||!eventType) return;
 let session = null;
 try {
 const InterviewSession = require("../../models/InterviewSession");
 session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers status actualStart").lean();
 if (!session) return;
 if (String(session.seeker)!== userId) return; // only candidate may emit proctor signals
 } catch {}
 const roomChannel = `interview:${roomKey}`;
 // Persist as timeline event for replay and audit
 try {
 const TimelineEvent = require("../../models/TimelineEvent");
 const offsetMs = session?.actualStart? Math.max(0, Date.now() - new Date(session.actualStart).getTime()): 0;
 // Only persist meaningful proctor events (not every fullscreen_enter)
 if (["fullscreen_exited", "tab_hidden", "window_blur", "fullscreen_entered"].includes(eventType)) {
 await TimelineEvent.create({
 session: session._id,
 pipeline: "INTEGRITY",
 eventType: `focus.${eventType}`,
 offsetMs,
 participant: socket.user._id,
 participantRole: "seeker",
 payload: { text: eventType === "fullscreen_exited"? "Candidate exited fullscreen": eventType === "tab_hidden"? "Candidate switched tabs": eventType === "window_blur"? "Candidate window lost focus": `Candidate ${eventType}`, isAnomalous: eventType!== "fullscreen_entered" },
 });
 }
 } catch (err) {
 logger.debug({ err: err.message }, "Failed to persist proctor timeline event");
 }
 // Emit only to interviewers sub-room (more targeted, avoids duplicate for interviewers in both rooms)
 io.to(`${roomChannel}:interviewers`).emit("proctor_event_received", {
 eventType,
 timestamp: timestamp || Date.now(),
 senderId: userId,
 });
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

 // Ephemeral Live Code Cursor / Selection Presence - verify participant
 socket.on("editor_cursor_move", async ({ roomKey, cursor, file }) => {
 if (!roomKey) return;
 try {
 const InterviewSession = require("../../models/InterviewSession");
 const session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers").lean();
 if (session) {
 const isParticipant = String(session.seeker) === userId || String(session.recruiter) === userId || (session.additionalInterviewers || []).some((id) => String(id) === userId);
 if (!isParticipant) return;
 }
 } catch { return; }
 socket.to(`interview:${roomKey}`).emit("peer_cursor_update", {
 userId,
 name: socket.user.name,
 cursor,
 file,
 });
 });

 // Ephemeral Whiteboard Cursor Presence - verify participant
 socket.on("whiteboard_cursor_move", async ({ roomKey, point }) => {
 if (!roomKey) return;
 try {
 const InterviewSession = require("../../models/InterviewSession");
 const session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers").lean();
 if (session) {
 const isParticipant = String(session.seeker) === userId || String(session.recruiter) === userId || (session.additionalInterviewers || []).some((id) => String(id) === userId);
 if (!isParticipant) return;
 }
 } catch { return; }
 socket.to(`interview:${roomKey}`).emit("peer_whiteboard_cursor", {
 userId,
 name: socket.user.name,
 point,
 });
 });

 // Whiteboard Incremental Delta Synchronization - verify participant
 socket.on("whiteboard_delta", async ({ roomKey, delta, snapshotVersion }) => {
 if (!roomKey) return;
 try {
 const InterviewSession = require("../../models/InterviewSession");
 const session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers").lean();
 if (!session) return;
 const isParticipant = String(session.seeker) === userId || String(session.recruiter) === userId || (session.additionalInterviewers || []).some((id) => String(id) === userId);
 if (!isParticipant) return;
 } catch { return; }
 socket.to(`interview:${roomKey}`).emit("whiteboard_delta_broadcast", {
 senderId: userId,
 delta,
 snapshotVersion,
 });
 });

 // Real-Time Live Transcript Broadcast - verify participant
 socket.on("transcript_chunk", async ({ roomKey, text, isFinal, offsetMs }) => {
 if (!roomKey) return;
 try {
 const InterviewSession = require("../../models/InterviewSession");
 const sessCheck = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers").lean();
 if (sessCheck) {
 const isPart = String(sessCheck.seeker) === userId || String(sessCheck.recruiter) === userId || (sessCheck.additionalInterviewers || []).some((id) => String(id) === userId);
 if (!isPart) return;
 }
 } catch { return; }
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

 // Real-Time Interactive Terminal Streaming — with participant verification
 socket.on("terminal_input", async ({ roomKey, terminalId, data }) => {
 try {
 if (!terminalId || typeof data!== "string" || data.length === 0) return;
 // Authorize against the terminal's OWN session (not a client-supplied
 // roomKey): a stale roomKey must never grant access to another
 // session's terminal. Fail closed when we cannot resolve ownership.
 const terminalService = require("../terminal/terminalService");
 const termEntry = terminalService.getTerminalSession(terminalId);
 const owningSessionId = termEntry?.sessionId;
 if (!owningSessionId) return; // unknown terminal -> fail closed

 try {
 const InterviewSession = require("../../models/InterviewSession");
 const s = await InterviewSession.findById(owningSessionId).select("seeker recruiter additionalInterviewers roomKey").lean();
 if (!s) return; // session gone -> fail closed
 const isParticipant = String(s.seeker) === userId || String(s.recruiter) === userId || (s.additionalInterviewers || []).some((id) => String(id) === userId);
 if (!isParticipant) return;

 const termRoomKey = s.roomKey || roomKey;
 if (termRoomKey) {
 socket.to(`interview:${termRoomKey}`).emit("terminal_input_received", { terminalId, data, senderId: socket.user?._id });
 }
 } catch { return; }

 Promise.resolve(terminalService.writeToTerminal(terminalId, data)).catch((err) => {
 logger.debug({ err: err.message, terminalId }, "Terminal input error");
 });
 } catch (err) {
 logger.debug({ err: err.message, terminalId }, "Terminal input error");
 }
 });

 socket.on("terminal_resize", async ({ terminalId, cols, rows }) => {
 try {
 // Participant check for resize too — any authenticated user could resize arbitrary terminal
 if (terminalId) {
 try {
 const terminalService = require("../terminal/terminalService");
 const sess = terminalService.getTerminalSession(terminalId);
 if (sess?.sessionId) {
 const InterviewSession = require("../../models/InterviewSession");
 const s = await InterviewSession.findById(sess.sessionId).select("seeker recruiter additionalInterviewers").lean();
 if (s) {
 const isParticipant = String(s.seeker) === userId || String(s.recruiter) === userId || (s.additionalInterviewers || []).some((id) => String(id) === userId);
 if (!isParticipant) return;
 }
 }
 } catch { return; }
 }
 // Clamp bounds 10-500 cols, 5-200 rows
 const c = Math.max(10, Math.min(500, Number(cols) || 80));
 const r = Math.max(5, Math.min(200, Number(rows) || 24));
 const terminalService = require("../terminal/terminalService");
 Promise.resolve(terminalService.resizeTerminal(terminalId, c, r)).catch((err) => {
 logger.debug({ err: err.message, terminalId }, "Terminal resize error");
 });
 } catch (err) {
 logger.debug({ err: err.message, terminalId }, "Terminal resize error");
 }
 });

 // Real-Time Signal & Copilot Coordination - verify participant + rate limiting & debouncing (Plan Phase 6)
 socket.on("live_signal_extracted", async ({ roomKey, signal }) => {
 if (!roomKey ||!signal) return;
 if (isSignalRateLimited(socket.id)) {
 logger.debug({ socketId: socket.id, userId }, "Signal rate limited");
 return;
 }
 // B12: per-session limit 100 signals/session
 const sessionKey = signal.sessionId || signal.session_id || roomKey;
 if (isSessionSignalRateLimited(sessionKey)) {
 logger.debug({ sessionKey, socketId: socket.id }, "Session signal rate limited 100/session");
 socket.emit("signal_rate_limited", { message: "Session signal limit 100 reached", sessionKey });
 return;
 }
 try {
 const InterviewSession = require("../../models/InterviewSession");
 const session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers").lean();
 if (!session) return;
 const isParticipant = String(session.seeker) === userId || String(session.recruiter) === userId || (session.additionalInterviewers || []).some((id) => String(id) === userId);
 if (!isParticipant) return;
 } catch { return; }
 const payload = {
 senderId: userId,
 signal,
 receivedAt: new Date().toISOString(),
 };
 // Emit both legacy and canonical plan event names
 socket.to(`interview:${roomKey}:interviewers`).emit("interview_signal_received", payload);
 socket.to(`interview:${roomKey}:interviewers`).emit("interview_signal_emitted", payload);
 if (signal.evidenceRef) {
 socket.to(`interview:${roomKey}:interviewers`).emit("evidence_created", {
 sessionId: signal.sessionId,
 evidenceRef: signal.evidenceRef,
 signalName: signal.name,
 roomKey,
 });
 }
 });

 socket.on("copilot_hint_request", async ({ roomKey, code, language, currentStage }) => {
 if (!roomKey) return;
 if (isCopilotRateLimited(userId)) {
 socket.emit("copilot_rate_limited", { message: "Copilot request rate limited. Try again shortly." });
 return;
 }
 const debounceKey = `${userId}:${roomKey}`;
 if (copilotDebounceMap.has(debounceKey)) {
 clearTimeout(copilotDebounceMap.get(debounceKey));
 }
 const timeout = setTimeout(async () => {
 copilotDebounceMap.delete(debounceKey);
 try {
 const InterviewSession = require("../../models/InterviewSession");
 const session = await InterviewSession.findOne({ roomKey }).select("seeker recruiter additionalInterviewers").populate("job").lean();
 if (!session) return;
 const isRecruiter = String(session.recruiter) === userId || (session.additionalInterviewers || []).some((id) => String(id) === userId);
 if (!isRecruiter) return;
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
 }, COPILOT_DEBOUNCE_MS);
 copilotDebounceMap.set(debounceKey, timeout);
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

 socket.on("start_comp", async ({ pin }) => {
 try {
 const CompetitionLobby = require("../../models/CompetitionLobby");
 const lobby = await CompetitionLobby.findOne({ pin });
 if (!lobby || String(lobby.hostId)!== userId) return;

 if (lobby.mode === "QUIZ" && lobby.quizData && lobby.quizData.length > 0) {
 lobby.status = "PLAYING";
 lobby.currentQuestionIndex = 0;
 lobby.questionStartTime = new Date();
 await lobby.save();

 // Broadcast first question with server timestamp for sync
 io.to(`comp_lobby:${pin}`).emit("comp_started", {
 startedAt: lobby.questionStartTime.toISOString(),
 questionIndex: 0,
 question: sanitizeQuizQuestion(lobby.quizData[0]),
 timeLimitSeconds: lobby.quizData[0].timeLimitSeconds || 20,
 });
 } else if (lobby.mode === "CP") {
 lobby.status = "PLAYING";
 await lobby.save();
 io.to(`comp_lobby:${pin}`).emit("comp_started", {
 startedAt: new Date().toISOString(),
 });
 }
 } catch (err) {
 logger.error({ err: err.message }, "Error starting competition");
 }
 });

 socket.on("submit_comp_answer", async ({ pin, questionIndex, answer }) => {
 try {
 const CompetitionLobby = require("../../models/CompetitionLobby");
 const lobby = await CompetitionLobby.findOne({ pin });
 if (!lobby || lobby.status!== "PLAYING" || lobby.mode!== "QUIZ") return;

 const question = lobby.quizData?.[questionIndex];
 if (!question) return;

 // Validate answer server-side
 const isCorrect = answer === question.correctAnswer;

 // Calculate score with speed multiplier
 const questionStartTime = lobby.questionStartTime? new Date(lobby.questionStartTime).getTime(): Date.now();
 const timeElapsed = (Date.now() - questionStartTime) / 1000;
 const timeLimit = question.timeLimitSeconds || 20;
 const timeLeft = Math.max(0, timeLimit - timeElapsed);

 let scoreDelta = 0;
 if (isCorrect) {
 // Base 100 points + speed bonus (up to 100 more based on time left)
 scoreDelta = Math.round(100 + (timeLeft / timeLimit) * 100);
 }

 // Update player score in lobby
 const player = lobby.players.find(p => String(p.userId) === String(userId));
 if (player) {
 player.score = (player.score || 0) + scoreDelta;
 player.lastAnswerTime = new Date();
 }

 await lobby.save();

 // Broadcast validated score update
 io.to(`comp_lobby:${pin}`).emit("comp_score_update", {
 userId,
 questionIndex,
 isCorrect,
 scoreDelta,
 correctAnswer: question.correctAnswer, // Send correct answer for reveal
 });
 } catch (err) {
 logger.error({ err: err.message }, "Error processing quiz answer");
 }
 });

 socket.on("next_question", async ({ pin }) => {
 try {
 const CompetitionLobby = require("../../models/CompetitionLobby");
 const lobby = await CompetitionLobby.findOne({ pin });
 if (!lobby || String(lobby.hostId)!== userId || lobby.mode!== "QUIZ") return;

 const nextIndex = lobby.currentQuestionIndex + 1;
 if (nextIndex >= (lobby.quizData?.length || 0)) {
 // Quiz complete
 lobby.status = "LEADERBOARD";
 lobby.currentQuestionIndex = nextIndex;
 await lobby.save();
 io.to(`comp_lobby:${pin}`).emit("quiz_complete", {
 finalScores: lobby.players.map(p => ({
 userId: p.userId,
 name: p.name,
 score: p.score || 0,
 })).sort((a, b) => b.score - a.score),
 });
 return;
 }

 lobby.currentQuestionIndex = nextIndex;
 lobby.questionStartTime = new Date();
 await lobby.save();

 const nextQuestion = lobby.quizData[nextIndex];
 io.to(`comp_lobby:${pin}`).emit("question_changed", {
 questionIndex: nextIndex,
 question: sanitizeQuizQuestion(nextQuestion),
 timeLimitSeconds: nextQuestion.timeLimitSeconds || 20,
 startedAt: lobby.questionStartTime.toISOString(),
 });
 } catch (err) {
 logger.error({ err: err.message }, "Error advancing question");
 }
 });

 socket.on("submit_cp_solution", async ({ pin, code, language }) => {
 try {
 const CompetitionLobby = require("../../models/CompetitionLobby");
 const { runTestCases } = require("../../infrastructure/sandbox/sandboxService");

 const lobby = await CompetitionLobby.findOne({ pin });
 if (!lobby || lobby.status!== "PLAYING" || lobby.mode!== "CP") return;

 const cpData = lobby.cpData;
 if (!cpData ||!cpData.testCases || cpData.testCases.length === 0) return;

 // Run test cases in sandbox
 const testResult = await runTestCases({
 language: language || "javascript",
 code,
 testCases: cpData.testCases,
 });

 const passedCount = testResult.passedCount;
 const totalCount = testResult.totalCount;

 // Calculate score: base points for each passed test + bonus for all passed
 let scoreDelta = passedCount * 20;
 if (passedCount === totalCount) scoreDelta += 100; // Perfect bonus

 // Update player score
 const player = lobby.players.find(p => String(p.userId) === String(userId));
 if (player) {
 player.score = (player.score || 0) + scoreDelta;
 player.testCasesPassed = Math.max(player.testCasesPassed || 0, passedCount);
 player.lastAnswerTime = new Date();
 }

 await lobby.save();

 // Broadcast results
 io.to(`comp_lobby:${pin}`).emit("cp_score_update", {
 userId,
 testCasesPassed: passedCount,
 totalTestCases: totalCount,
 scoreDelta,
 allPassed: passedCount === totalCount,
 testResults: testResult.results,
 });

 // Check if someone solved it completely
 if (passedCount === totalCount) {
 const winner = lobby.players.find(p => String(p.userId) === String(userId));
 if (winner) {
 lobby.status = "LEADERBOARD";
 await lobby.save();
 io.to(`comp_lobby:${pin}`).emit("cp_complete", {
 finalScores: lobby.players.map(p => ({
 userId: p.userId,
 name: p.name,
 score: p.score || 0,
 testCasesPassed: p.testCasesPassed || 0,
 })).sort((a, b) => b.score - a.score),
 winner: winner.name,
 });
 }
 }
 } catch (err) {
 logger.error({ err: err.message }, "Error processing CP solution");
 }
 });

 // Legacy handler - keep for backward compat but deprecate
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
