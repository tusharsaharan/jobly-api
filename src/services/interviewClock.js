/**
 * Centralized interview clock helper for deterministic session offset calculations
 */
function sessionOffsetMs(session, now = Date.now()) {
  if (!session) return 0;
  const startTime = session.actualStart ? new Date(session.actualStart).getTime() : (session.createdAt ? new Date(session.createdAt).getTime() : now);
  return Math.max(0, now - startTime);
}

module.exports = {
  sessionOffsetMs,
};
