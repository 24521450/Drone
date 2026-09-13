#!/usr/bin/env node

const rawBase =
  process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "http://localhost:4000";
const baseUrl = rawBase.replace(/\/+$/, "").replace(/\/api\/v1$/, "");

async function readJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `${path} returned non-JSON content (HTTP ${response.status})`,
    );
  }
  if (!response.ok)
    throw new Error(
      `${path} returned HTTP ${response.status}: ${body?.error?.message ?? "request failed"}`,
    );
  return body;
}

try {
  const health = await readJson("/health");
  if (
    health?.data?.status !== "online" ||
    health?.data?.database !== "connected"
  )
    throw new Error("health check is not online with a connected database");

  const ready = await readJson("/ready");
  if (ready?.data?.status !== "ready")
    throw new Error("readiness check did not report ready");

  const docs = await readJson("/api-docs.json");
  const pathCount = Object.keys(docs?.paths ?? {}).length;
  if (!docs?.openapi || pathCount === 0)
    throw new Error("OpenAPI document is missing schema paths");
  if (!docs.paths["/health"] || !docs.paths["/ready"])
    throw new Error(
      "OpenAPI document is missing public health/readiness paths",
    );

  console.log(
    `Smoke check passed: ${baseUrl} (health online, database connected, ready, ${pathCount} documented paths)`,
  );
} catch (error) {
  console.error(
    `Smoke check failed for ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
