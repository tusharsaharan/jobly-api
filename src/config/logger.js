const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : isTest ? "silent" : "debug"),
  transport: !isProduction && !isTest
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  base: isProduction
    ? {
        service: "jobly-api",
        env: process.env.NODE_ENV,
      }
    : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
