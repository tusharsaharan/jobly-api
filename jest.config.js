module.exports = {
  testEnvironment: 'node',
  setupFiles: ["<rootDir>/tests/setup-env.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  moduleNameMapper: {
    "^sanitize-html$": "<rootDir>/tests/__mocks__/sanitize-html.js"
  },
  collectCoverage: true,
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/**/*.test.js",
    "!src/**/node_modules/**"
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  testTimeout: 30000
};
