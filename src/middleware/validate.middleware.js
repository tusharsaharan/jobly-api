const { z } = require("zod");

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errorMap = {};
      result.error.errors.forEach((err) => {
        const path = err.path.join(".");
        errorMap[path] = err.message;
      });
      return res.status(422).json({
        msg: result.error.errors[0]?.message || "Validation error",
        errors: errorMap,
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

module.exports = {
  validateBody,
};
