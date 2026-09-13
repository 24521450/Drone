import { describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./config";

describe("frontend runtime configuration", () => {
  it("keeps local development defaults available", () => {
    expect(validateRuntimeConfig({ PROD: false })).toMatchObject({
      apiUrl: "http://localhost:4000/api/v1",
      socketUrl: "http://localhost:4000",
      error: "",
    });
  });

  it("blocks a production build with missing public endpoints", () => {
    expect(validateRuntimeConfig({ PROD: true }).error).toContain(
      "VITE_API_URL and VITE_SOCKET_URL",
    );
  });

  it("rejects a production API URL without the versioned API base path", () => {
    expect(
      validateRuntimeConfig({
        PROD: true,
        VITE_API_URL: "https://api.example.com",
        VITE_SOCKET_URL: "https://api.example.com",
      }).error,
    ).toContain("must end with /api/v1");
  });

  it("accepts configured production endpoints", () => {
    expect(
      validateRuntimeConfig({
        PROD: true,
        VITE_API_URL: "https://api.example.com/api/v1",
        VITE_SOCKET_URL: "https://api.example.com",
      }).error,
    ).toBe("");
  });
});
