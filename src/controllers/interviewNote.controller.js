const InterviewSession = require("../models/InterviewSession");
const InterviewNote = require("../models/InterviewNote");
const logger = require("../config/logger");

async function authorizeInterviewTeam(sessionId, user) {
  const session = await InterviewSession.findById(sessionId).select("recruiter additionalInterviewers").lean();
  if (!session) {
    const error = new Error("Interview session not found");
    error.status = 404;
    throw error;
  }
  const userId = String(user._id || user.id);
  const isRecruiter = String(session.recruiter) === userId;
  const isAdditionalInterviewer = (session.additionalInterviewers || []).some((id) => String(id) === userId);
  if (!isRecruiter && !isAdditionalInterviewer) {
    const error = new Error("Private interviewer notes are only available to the interview team");
    error.status = 403;
    throw error;
  }
  return session;
}

function sanitizeNoteInput(input = {}) {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > 20000) {
    const error = new Error("A note must contain 1 to 20,000 characters");
    error.status = 400;
    throw error;
  }
  const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 10) : [];
  const sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs.slice(0, 20) : [];
  return { body, tags, sourceRefs, pinned: Boolean(input.pinned) };
}

exports.list = async (req, res) => {
  try {
    await authorizeInterviewTeam(req.params.sessionId, req.user);
    const notes = await InterviewNote.find({ session: req.params.sessionId }).sort({ pinned: -1, updatedAt: -1 }).populate("author", "name role").lean();
    return res.json({ notes });
  } catch (err) {
    logger.warn({ err: err.message, sessionId: req.params.sessionId }, "Unable to list private interview notes");
    return res.status(err.status || 500).json({ msg: err.message || "Unable to load private notes" });
  }
};

exports.create = async (req, res) => {
  try {
    const session = await authorizeInterviewTeam(req.params.sessionId, req.user);
    const note = await InterviewNote.create({ session: session._id, author: req.user._id, ...sanitizeNoteInput(req.body) });
    await note.populate("author", "name role");
    return res.status(201).json({ note });
  } catch (err) {
    logger.warn({ err: err.message, sessionId: req.params.sessionId }, "Unable to create private interview note");
    return res.status(err.status || 500).json({ msg: err.message || "Unable to save private note" });
  }
};

exports.update = async (req, res) => {
  try {
    await authorizeInterviewTeam(req.params.sessionId, req.user);
    const note = await InterviewNote.findOne({ _id: req.params.noteId, session: req.params.sessionId });
    if (!note) return res.status(404).json({ msg: "Private note not found" });
    const update = sanitizeNoteInput({ ...note.toObject(), ...req.body });
    Object.assign(note, update);
    await note.save();
    await note.populate("author", "name role");
    return res.json({ note });
  } catch (err) {
    logger.warn({ err: err.message, sessionId: req.params.sessionId }, "Unable to update private interview note");
    return res.status(err.status || 500).json({ msg: err.message || "Unable to update private note" });
  }
};

exports.remove = async (req, res) => {
  try {
    await authorizeInterviewTeam(req.params.sessionId, req.user);
    const note = await InterviewNote.findOneAndDelete({ _id: req.params.noteId, session: req.params.sessionId });
    if (!note) return res.status(404).json({ msg: "Private note not found" });
    return res.json({ deleted: true, noteId: req.params.noteId });
  } catch (err) {
    logger.warn({ err: err.message, sessionId: req.params.sessionId }, "Unable to delete private interview note");
    return res.status(err.status || 500).json({ msg: err.message || "Unable to delete private note" });
  }
};
