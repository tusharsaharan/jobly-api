module.exports = function sanitizeHtml(input, options) {
  if (typeof input !== "string") return "";
  // Strip all HTML tags like sanitize-html with allowedTags: []
  return input.replace(/<[^>]*>/g, "");
};
module.exports.defaults = {};
