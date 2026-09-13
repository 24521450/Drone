import { expect, test } from "@playwright/test";

test("fleet emergency commands can target a selected subset", async ({
  page,
}) => {
  await page.goto("/live");
  const loginHeading = page.getByRole("heading", { name: "Welcome back" });
  if (await loginHeading.count()) {
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(
      page.getByRole("heading", { name: "Operational overview" }),
    ).toBeVisible();
  }

  // Seed and prepare the demo fleet through the authenticated API so this
  // command-focused test starts deterministically even with an empty database.
  // The navigation test still covers the visible setup flow.
  const token = await page.evaluate(() => localStorage.getItem("drone-token"));
  expect(token).toBeTruthy();
  for (const endpoint of ["/drones/seed-demo", "/drones/prepare-demo"]) {
    const response = await page.request.post(
      `http://127.0.0.1:4000/api/v1${endpoint}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
  }

  await page.getByRole("link", { name: "Live Flight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live flight" })).toBeVisible();
  await page.getByRole("button", { name: /Fleet view/ }).click();

  const start = page.getByRole("button", { name: "Start 10 drones" });
  await expect(start).toBeVisible({ timeout: 20_000 });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();

  await expect(
    page.getByRole("heading", { name: "Emergency command targets" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Telemetry coverage", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("10/10 selected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("0/10 selected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return selected home" }),
  ).toBeDisabled();

  const firstTarget = page
    .getByRole("checkbox", { name: /Select .* for fleet command/ })
    .first();
  await firstTarget.check();
  await expect(page.getByText("1/10 selected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return selected home" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Land selected" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Pause selected" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Resume selected" }),
  ).toBeDisabled();

  const pauseRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/v1/commands/fleet") &&
      request.method() === "POST",
  );
  await page.getByRole("button", { name: "Pause selected" }).click();
  const pauseDialog = page.getByRole("dialog");
  await expect(pauseDialog).toBeVisible();
  await pauseDialog.getByRole("button", { name: "Pause selected" }).click();
  const pauseBody = JSON.parse((await pauseRequest).postData() ?? "{}");
  expect(pauseBody.type).toBe("PAUSE");
  expect(pauseBody.flightIds).toHaveLength(1);
  await expect(
    page.getByText("1/1 pause commands completed", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: "Resume selected" }),
  ).toBeEnabled({ timeout: 10_000 });

  const resumeRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/v1/commands/fleet") &&
      request.method() === "POST",
  );
  await page.getByRole("button", { name: "Resume selected" }).click();
  const resumeDialog = page.getByRole("dialog");
  await expect(resumeDialog).toBeVisible();
  await resumeDialog.getByRole("button", { name: "Resume selected" }).click();
  const resumeBody = JSON.parse((await resumeRequest).postData() ?? "{}");
  expect(resumeBody.type).toBe("RESUME");
  expect(resumeBody.flightIds).toHaveLength(1);
  await expect(
    page.getByText("1/1 resume commands completed", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: "Return selected home" }),
  ).toBeEnabled({ timeout: 10_000 });

  const commandRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/v1/commands/fleet") &&
      request.method() === "POST",
  );
  await page.getByRole("button", { name: "Return selected home" }).click();
  const commandDialog = page.getByRole("dialog");
  await expect(commandDialog).toBeVisible();
  await commandDialog
    .getByRole("button", { name: "Return selected" })
    .click();
  const request = await commandRequest;
  const body = JSON.parse(request.postData() ?? "{}");
  expect(body.type).toBe("RETURN_HOME");
  expect(body.flightIds).toHaveLength(1);
  await expect(
    page.getByText("1/1 return-home commands completed", { exact: true }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Stop fleet" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stop fleet" }).click();
  await expect(page.getByRole("button", { name: "Start 10 drones" })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("link", { name: "Command Center", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Command center", exact: true }),
  ).toBeVisible();
  const exportButton = page.getByRole("button", {
    name: "Export all matching",
  });
  await expect(exportButton).toBeEnabled({ timeout: 10_000 });
  const exportResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/commands/export") &&
      response.request().method() === "GET",
  );
  await exportButton.click();
  const csvResponse = await exportResponse;
  expect(csvResponse.status()).toBe(200);
  expect(csvResponse.headers()["content-type"]).toMatch(/text\/csv/);
});
