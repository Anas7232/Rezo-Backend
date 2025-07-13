export default {
  testEnvironment: "node",
  testMatch: ["**/test/**/*.test.js"],
  setupFilesAfterEnv: ["./src/test/setup.js"],
  testTimeout: 10000,
  verbose: true,
};
