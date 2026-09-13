import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    // flow.test.ts owns a shared MongoMemoryServer and Mongoose connection.
    // Serial files prevent independent suites from mutating that database.
    fileParallelism: false,
  },
});
