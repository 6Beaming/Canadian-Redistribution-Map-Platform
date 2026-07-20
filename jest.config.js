export default {
  collectCoverageFrom: ["server/routes/auth.js"],
  coverageProvider: "v8",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.js"]
};
