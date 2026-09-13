import { expect, test } from "@playwright/test";

test("an administrator can sign in and navigate core operational pages", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(
    page.getByRole("heading", { name: "Operational overview" }),
  ).toBeVisible();
  await expect(
    page.getByText("All systems operational", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Launch readiness", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("System health", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Operational insights", { exact: true }),
  ).toBeVisible();
  const insightsExport = page.getByRole("button", {
    name: "Export snapshot",
  });
  await expect(insightsExport).toBeEnabled({ timeout: 10_000 });
  const insightsExportResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/insights/export") &&
      response.request().method() === "GET",
  );
  await insightsExport.click();
  const insightsCsvResponse = await insightsExportResponse;
  expect(insightsCsvResponse.status()).toBe(200);
  expect(insightsCsvResponse.headers()["content-type"]).toMatch(/text\/csv/);
  await expect(
    page.getByText("Recent flight operations", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Environment snapshot", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Environment", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Environment conditions", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Current conditions", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo environment model", { exact: false })).toBeVisible();
  const environmentExport = page.getByRole("button", { name: "Export snapshot" });
  await expect(environmentExport).toBeEnabled({ timeout: 10_000 });
  const environmentExportResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/environment/export") &&
      response.request().method() === "GET",
  );
  await environmentExport.click();
  const environmentCsvResponse = await environmentExportResponse;
  expect(environmentCsvResponse.status()).toBe(200);
  expect(environmentCsvResponse.headers()["content-type"]).toMatch(/text\/csv/);

  await page.getByRole("link", { name: "System Status", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "System status", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Service registry", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo adapters are labeled", { exact: true })).toBeVisible();
  await expect(page.getByText("SIMULATED", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Field Intelligence", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Field intelligence", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Plot health", { exact: true })).toBeVisible();
  await expect(page.getByText("Field map overlay", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo field analysis", { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "Media", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Media library", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Media browser", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Media drone")).toBeVisible();
  await expect(page.getByLabel("Media type")).toBeVisible();
  await expect(page.getByLabel("Media sensor")).toBeVisible();
  const mediaExport = page.getByRole("button", { name: "Export all matching" });
  await expect(mediaExport).toBeEnabled({ timeout: 10_000 });
  const mediaExportResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/media/export") &&
      response.request().method() === "GET",
  );
  await mediaExport.click();
  const mediaCsvResponse = await mediaExportResponse;
  expect(mediaCsvResponse.status()).toBe(200);
  expect(mediaCsvResponse.headers()["content-type"]).toMatch(/text\/csv/);
  const mediaCard = page.getByRole("button", { name: /View details for media-/ }).first();
  await expect(mediaCard).toBeVisible();
  await mediaCard.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("MEDIA METADATA", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close media details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("link", { name: "Live Flight", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Live flight" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Fleet view/ }).click();
  const prepareDemo = page.getByRole("button", { name: "Prepare demo fleet" });
  const fleetState = page.getByText(
    /Fleet ready for launch|Fleet preparation required/,
    { exact: false },
  );
  await expect
    .poll(
      async () => {
        if (await prepareDemo.isVisible()) return "prepare";
        if (await fleetState.isVisible()) return "ready";
        return "loading";
      },
      { timeout: 10_000 },
    )
    .not.toBe("loading");
  if (await prepareDemo.isVisible()) await prepareDemo.click();
  await expect(fleetState).toBeVisible({ timeout: 10_000 });
  const routeLegend = page.getByLabel("Fleet route legend");
  await expect(routeLegend).toBeVisible();
  await expect(routeLegend.getByRole("button").first()).toBeVisible();
  await page.getByRole("button", { name: "Single flight" }).click();
  await expect(
    page.getByText("Preflight readiness", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Command Center", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Command center", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Command audit log", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Command date from")).toBeVisible();
  await expect(page.getByLabel("Command date to")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export all matching" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();

  await page.getByRole("link", { name: "Drones", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Drone management" }),
  ).toBeVisible();
  await expect(page.getByLabel("Search drones")).toBeVisible();
  await expect(page.getByLabel("Drone status")).toBeVisible();
  await expect(page.getByText(/\d+ drones/, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  const droneExport = page.getByRole("button", { name: "Export all matching" });
  await expect(droneExport).toBeEnabled({ timeout: 10_000 });
  const droneExportResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/drones/export") &&
      response.request().method() === "GET",
  );
  await droneExport.click();
  const droneCsvResponse = await droneExportResponse;
  expect(droneCsvResponse.status()).toBe(200);
  expect(droneCsvResponse.headers()["content-type"]).toMatch(/text\/csv/);
  await page.getByTitle("View").first().click();
  await expect(
    page.getByText("Preflight readiness", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Maintenance", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live telemetry", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Users and access", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Search users")).toBeVisible();
  await expect(page.getByLabel("User role")).toBeVisible();
  await expect(page.getByLabel("User status")).toBeVisible();
  await expect(page.getByText(/\d+ users/, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  const userExport = page.getByRole("button", { name: "Export all matching" });
  await expect(userExport).toBeEnabled({ timeout: 10_000 });
  const userExportResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/users/export") &&
      response.request().method() === "GET",
  );
  await userExport.click();
  const userCsvResponse = await userExportResponse;
  expect(userCsvResponse.status()).toBe(200);
  expect(userCsvResponse.headers()["content-type"]).toMatch(/text\/csv/);

  await page.getByRole("link", { name: "Geofences", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Geofences", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Search geofences")).toBeVisible();
  await expect(page.getByLabel("Geofence status")).toBeVisible();
  await expect(page.getByText(/\d+ zones/, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export all matching" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Analytics" }).click();
  await expect(
    page.getByRole("heading", { name: "Operational analytics" }),
  ).toBeVisible();
  await expect(
    page.getByText("Route utilization", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("AIRCRAFT")).toBeVisible();
  await expect(page.getByLabel("Analytics date from")).toBeVisible();
  await expect(page.getByLabel("Analytics date to")).toBeVisible();
  const analyticsExport = page.getByRole("button", {
    name: "Export analytics CSV",
  });
  await expect(analyticsExport).toBeEnabled({ timeout: 10_000 });
  const analyticsDownload = page.waitForEvent("download");
  await analyticsExport.click();
  const download = await analyticsDownload;
  expect(download.suggestedFilename()).toMatch(
    /^operations-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
  );

  await page.getByRole("link", { name: "Telemetry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Telemetry", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Telemetry date from")).toBeVisible();
  await expect(page.getByLabel("Telemetry date to")).toBeVisible();
  const telemetryExport = page.getByRole("button", {
    name: "Export all telemetry",
  });
  const telemetryEmpty = page.getByText("No telemetry yet", { exact: true });
  await expect
    .poll(
      async () => {
        if (await telemetryExport.isVisible()) return "export";
        if (await telemetryEmpty.isVisible()) return "empty";
        return "loading";
      },
      { timeout: 10_000 },
    )
    .not.toBe("loading");
  if ((await telemetryExport.isVisible()) && (await telemetryExport.isEnabled())) {
    const telemetryExportResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/telemetry/export") &&
        response.request().method() === "GET",
    );
    await telemetryExport.click();
    const csvResponse = await telemetryExportResponse;
    expect(csvResponse.status()).toBe(200);
    expect(csvResponse.headers()["content-type"]).toMatch(/text\/csv/);
  }

  await page.getByRole("link", { name: "Fleet Health" }).click();
  await expect(
    page.getByRole("heading", { name: "Fleet health & maintenance" }),
  ).toBeVisible();
  await expect(
    page.getByText("Aircraft health — last 30 days", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Maintenance status")).toBeVisible();
  await expect(page.getByLabel("Maintenance date from")).toBeVisible();
  await expect(page.getByLabel("Maintenance date to")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export all matching" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  const maintenanceExport = page.getByRole("button", {
    name: "Export all matching",
  });
  if (await maintenanceExport.isEnabled()) {
    const maintenanceExportResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/maintenance/export") &&
        response.request().method() === "GET",
    );
    await maintenanceExport.click();
    const csvResponse = await maintenanceExportResponse;
    expect(csvResponse.status()).toBe(200);
    expect(csvResponse.headers()["content-type"]).toMatch(/text\/csv/);
  }

  await page.getByRole("link", { name: "Missions" }).click();
  await expect(
    page.getByRole("heading", { name: "Mission planner" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Flight Schedule" }).click();
  await expect(
    page.getByRole("heading", { name: "Flight schedule" }),
  ).toBeVisible();
  await expect(
    page.getByText("Automatic mission queue", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Schedule date from")).toBeVisible();
  await expect(page.getByLabel("Schedule date to")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export schedule CSV" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Flight History" }).click();
  await expect(
    page.getByRole("heading", { name: "Flight history" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export all matching" }),
  ).toBeVisible();
  await expect(page.getByLabel("Flight date from")).toBeVisible();
  await expect(page.getByLabel("Flight date to")).toBeVisible();
  const flightExport = page.getByRole("button", {
    name: "Export all matching",
  });
  if (await flightExport.isEnabled()) {
    const flightExportResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/flights/export") &&
        response.request().method() === "GET",
    );
    await flightExport.click();
    const csvResponse = await flightExportResponse;
    expect(csvResponse.status()).toBe(200);
    expect(csvResponse.headers()["content-type"]).toMatch(/text\/csv/);
  }

  await page.getByRole("link", { name: "Safety Rules" }).click();
  await expect(
    page.getByRole("heading", { name: "Alert rules" }),
  ).toBeVisible();
  await expect(
    page.getByText("Automatic responses are issued once per flight", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Alert Center" }).click();
  await expect(
    page.getByRole("heading", { name: "Alert center" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Acknowledge selected/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Alert date from")).toBeVisible();
  await expect(page.getByLabel("Alert date to")).toBeVisible();
  const alertExport = page.getByRole("button", {
    name: "Export all matching",
  });
  await expect(alertExport).toBeVisible();
  if (await alertExport.isEnabled()) {
    const alertExportResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/alerts/export") &&
        response.request().method() === "GET",
    );
    await alertExport.click();
    const csvResponse = await alertExportResponse;
    expect(csvResponse.status()).toBe(200);
    expect(csvResponse.headers()["content-type"]).toMatch(/text\/csv/);
  }

  await page.getByRole("link", { name: "Audit Log" }).click();
  await expect(
    page.getByRole("heading", { name: "Administrative audit log" }),
  ).toBeVisible();
  await expect(page.getByLabel("Audit date from")).toBeVisible();
  await expect(page.getByLabel("Audit date to")).toBeVisible();
  const auditExport = page.getByRole("button", { name: "Export all matching" });
  await expect(auditExport).toBeVisible();
  if (await auditExport.isEnabled()) {
    const auditExportResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/audit-events/export") &&
        response.request().method() === "GET",
    );
    await auditExport.click();
    const csvResponse = await auditExportResponse;
    expect(csvResponse.status()).toBe(200);
    expect(csvResponse.headers()["content-type"]).toMatch(/text\/csv/);
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
