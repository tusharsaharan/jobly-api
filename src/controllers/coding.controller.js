const logger = require("../config/logger");
const InterviewSession = require("../models/InterviewSession");
const TimelineEvent = require("../models/TimelineEvent");
const { getOrCreateRoomDoc, persistRoomDocNow } = require("../infrastructure/realtime/yjsCoordinator");

/**
 * Verify caller is an authorized participant of the session
 */
async function authorizeParticipant(sessionIdOrRoomKey, user) {
  const session = await InterviewSession.findOne({
    $or: [{ _id: sessionIdOrRoomKey.match(/^[0-9a-fA-F]{24}$/) ? sessionIdOrRoomKey : null }, { roomKey: sessionIdOrRoomKey }],
  }).populate("seeker recruiter additionalInterviewers");

  if (!session) {
    const error = new Error("Interview session not found");
    error.status = 404;
    throw error;
  }

  const uid = String(user._id || user.id);
  const isSeeker = String(session.seeker?._id || session.seeker) === uid;
  const isRecruiter = String(session.recruiter?._id || session.recruiter) === uid;
  const isAdditional = (session.additionalInterviewers || []).some(
    (id) => String(id?._id || id) === uid
  );

  if (!isSeeker && !isRecruiter && !isAdditional) {
    const error = new Error("Access denied. You are not a registered participant.");
    error.status = 403;
    throw error;
  }

  return session;
}

/**
 * Helper to compute session offset in milliseconds
 */
function getSessionOffsetMs(session) {
  return session.actualStart ? Math.max(0, Date.now() - new Date(session.actualStart).getTime()) : 0;
}

/**
 * POST /api/coding/:sessionId/files
 * Create a new file in the collaborative Yjs workspace
 */
exports.createFile = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { name, path: filePath, language, initialContent = "" } = req.body;

    if (!name || !filePath) {
      return res.status(400).json({ msg: "File name and path are required." });
    }

    const session = await authorizeParticipant(sessionId, req.user);
    const entry = await getOrCreateRoomDoc(session.roomKey);
    const { doc } = entry;
    const filesystem = doc.getMap("filesystem");

    // Standardize path representation
    const cleanPath = filePath.startsWith("/") ? filePath : `/${filePath}`;

    if (filesystem.has(cleanPath)) {
      return res.status(409).json({ msg: "File or directory already exists at this path." });
    }

    // Mutate CRDT structure inside a single transaction
    doc.transact(() => {
      filesystem.set(cleanPath, {
        type: "file",
        name,
        path: cleanPath,
        language: language || "python",
        createdAt: Date.now(),
      });

      const ytext = doc.getText(cleanPath);
      ytext.delete(0, ytext.length);
      if (initialContent) {
        ytext.insert(0, initialContent);
      }
    });

    // Record timeline event
    await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "file.created",
      offsetMs: getSessionOffsetMs(session),
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: { file: cleanPath, language: language || "python" },
    });

    await persistRoomDocNow(session.roomKey, doc, "yjsState");

    return res.status(201).json({
      msg: "File created successfully",
      file: { path: cleanPath, name, language: language || "python" },
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error creating collaborative file");
    return res.status(err.status || 500).json({ msg: err.message || "Failed creating file" });
  }
};

/**
 * DELETE /api/coding/:sessionId/files
 * Remove a file from the collaborative workspace
 */
exports.deleteFile = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { path: filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ msg: "File path is required." });
    }

    const session = await authorizeParticipant(sessionId, req.user);
    const entry = await getOrCreateRoomDoc(session.roomKey);
    const { doc } = entry;
    const filesystem = doc.getMap("filesystem");
    const cleanPath = filePath.startsWith("/") ? filePath : `/${filePath}`;

    if (!filesystem.has(cleanPath)) {
      return res.status(404).json({ msg: "File not found at specified path." });
    }

    doc.transact(() => {
      filesystem.delete(cleanPath);
      const ytext = doc.getText(cleanPath);
      ytext.delete(0, ytext.length);
    });

    await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "file.deleted",
      offsetMs: getSessionOffsetMs(session),
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: { path: cleanPath },
    });

    await persistRoomDocNow(session.roomKey, doc, "yjsState");

    return res.json({ msg: "File deleted successfully", path: cleanPath });
  } catch (err) {
    logger.error({ err: err.message }, "Error deleting collaborative file");
    return res.status(err.status || 500).json({ msg: err.message || "Failed deleting file" });
  }
};

/**
 * PUT /api/coding/:sessionId/files/rename
 * Rename or move an existing file in the workspace
 */
exports.renameFile = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { oldPath, newPath, newName } = req.body;

    if (!oldPath || !newPath) {
      return res.status(400).json({ msg: "Both oldPath and newPath are required." });
    }

    const session = await authorizeParticipant(sessionId, req.user);
    const entry = await getOrCreateRoomDoc(session.roomKey);
    const { doc } = entry;
    const filesystem = doc.getMap("filesystem");

    const cleanOld = oldPath.startsWith("/") ? oldPath : `/${oldPath}`;
    const cleanNew = newPath.startsWith("/") ? newPath : `/${newPath}`;

    const existing = filesystem.get(cleanOld);
    if (!existing) {
      return res.status(404).json({ msg: "Source file not found." });
    }

    doc.transact(() => {
      const oldText = doc.getText(cleanOld).toString();
      filesystem.delete(cleanOld);
      doc.getText(cleanOld).delete(0, doc.getText(cleanOld).length);

      filesystem.set(cleanNew, {
        ...existing,
        name: newName || cleanNew.split("/").pop(),
        path: cleanNew,
      });

      const newText = doc.getText(cleanNew);
      newText.delete(0, newText.length);
      newText.insert(0, oldText);
    });

    await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "file.renamed",
      offsetMs: getSessionOffsetMs(session),
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: { oldPath: cleanOld, newPath: cleanNew },
    });

    await persistRoomDocNow(session.roomKey, doc, "yjsState");

    return res.json({ msg: "File renamed successfully", oldPath: cleanOld, newPath: cleanNew });
  } catch (err) {
    logger.error({ err: err.message }, "Error renaming collaborative file");
    return res.status(err.status || 500).json({ msg: err.message || "Failed renaming file" });
  }
};

/**
 * POST /api/coding/:sessionId/directories
 * Create a new virtual folder in workspace
 */
exports.createDirectory = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { path: dirPath } = req.body;

    if (!dirPath) {
      return res.status(400).json({ msg: "Directory path is required." });
    }

    const session = await authorizeParticipant(sessionId, req.user);
    const entry = await getOrCreateRoomDoc(session.roomKey);
    const { doc } = entry;
    const filesystem = doc.getMap("filesystem");
    const cleanPath = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;

    doc.transact(() => {
      filesystem.set(cleanPath, {
        type: "directory",
        name: cleanPath.split("/").filter(Boolean).pop() || cleanPath,
        path: cleanPath,
        createdAt: Date.now(),
      });
    });

    await persistRoomDocNow(session.roomKey, doc, "yjsState");

    return res.status(201).json({ msg: "Directory created", path: cleanPath });
  } catch (err) {
    logger.error({ err: err.message }, "Error creating directory");
    return res.status(err.status || 500).json({ msg: err.message || "Failed creating directory" });
  }
};

/**
 * GET /api/coding/:sessionId/workspace
 * Reconstruct complete workspace hierarchy and current file contents
 */
exports.getWorkspace = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await authorizeParticipant(sessionId, req.user);
    const entry = await getOrCreateRoomDoc(session.roomKey);
    const { doc } = entry;
    const filesystem = doc.getMap("filesystem");

    const files = [];
    filesystem.forEach((item, pathKey) => {
      const content = item.type === "file" ? doc.getText(pathKey).toString() : null;
      files.push({
        ...item,
        content,
      });
    });

    return res.json({
      sessionId: session._id,
      roomKey: session.roomKey,
      workspace: files,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error retrieving workspace");
    return res.status(err.status || 500).json({ msg: err.message || "Failed retrieving workspace" });
  }
};

/**
 * POST /api/coding/:sessionId/terminal
 * Spawn a new interactive pseudo-terminal session for the interview room
 */
const terminalService = require("../infrastructure/terminal/terminalService");
const { getSocketIO } = require("../infrastructure/realtime/socketio");

exports.createTerminal = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { cols = 80, rows = 24 } = req.body;
    const session = await authorizeParticipant(sessionId, req.user);

    const io = getSocketIO();
    const existingTerminal = terminalService.getTerminalForSession(session._id.toString());
    const terminalId = existingTerminal
      ? existingTerminal.terminalId
      : await terminalService.createTerminalSession(
          session._id.toString(),
          cols,
          rows,
          (termId, data) => {
            if (io) {
              io.to(`interview:${session.roomKey}`).emit("terminal_output", {
                terminalId: termId,
                data,
              });
            }
          }
        );

    return res.status(201).json({
      msg: existingTerminal ? "Shared terminal session joined" : "Shared terminal session spawned",
      terminalId,
      shared: true,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error creating terminal");
    return res.status(err.status || 500).json({ msg: err.message || "Failed creating terminal" });
  }
};

/**
 * DELETE /api/coding/:sessionId/terminal/:terminalId
 * Terminate a pseudo-terminal session
 */
exports.closeTerminal = async (req, res) => {
  try {
    const { sessionId, terminalId } = req.params;
    await authorizeParticipant(sessionId, req.user);

    await terminalService.closeTerminalSession(terminalId);
    return res.json({ msg: "Terminal session closed", terminalId });
  } catch (err) {
    logger.error({ err: err.message }, "Error closing terminal");
    return res.status(err.status || 500).json({ msg: err.message || "Failed closing terminal" });
  }
};

/**
 * GET /api/coding/:sessionId/checkpoints
 * List all historical code snapshots for the session
 */
const CodeCheckpoint = require("../models/CodeCheckpoint");
const checkpointService = require("../services/checkpointService");

exports.listCheckpoints = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await authorizeParticipant(sessionId, req.user);

    const checkpoints = await CodeCheckpoint.find({ session: session._id })
      .sort({ sequenceNumber: -1 })
      .select("-yjsStateVector")
      .lean();

    return res.json({ checkpoints });
  } catch (err) {
    logger.error({ err: err.message }, "Error listing checkpoints");
    return res.status(err.status || 500).json({ msg: err.message || "Failed listing checkpoints" });
  }
};

/**
 * POST /api/coding/:sessionId/checkpoints
 * Create manual snapshot on demand
 */
exports.createManualCheckpoint = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { label } = req.body;
    const session = await authorizeParticipant(sessionId, req.user);

    const checkpoint = await checkpointService.createCheckpoint(
      session,
      "MANUAL",
      label || "Manual snapshot"
    );

    return res.status(201).json({ msg: "Checkpoint created", checkpoint });
  } catch (err) {
    logger.error({ err: err.message }, "Error creating manual checkpoint");
    return res.status(err.status || 500).json({ msg: err.message || "Failed creating checkpoint" });
  }
};

/**
 * POST /api/coding/:sessionId/checkpoints/:checkpointId/restore
 * Restore active collaborative workspace to historical snapshot
 */
exports.restoreCheckpointHandler = async (req, res) => {
  try {
    const { sessionId, checkpointId } = req.params;
    const session = await authorizeParticipant(sessionId, req.user);

    const checkpoint = await checkpointService.restoreCheckpoint(session, checkpointId);
    return res.json({ msg: "Workspace restored from checkpoint", checkpoint });
  } catch (err) {
    logger.error({ err: err.message }, "Error restoring checkpoint");
    return res.status(err.status || 500).json({ msg: err.message || "Failed restoring checkpoint" });
  }
};
