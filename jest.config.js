export default {
  collectCoverageFrom: ["server/routes/auth.js"],
  coverageProvider: "v8",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.js"]
};
