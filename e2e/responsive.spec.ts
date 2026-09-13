import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("mobile command center opens navigation without horizontal overflow", async ({ page }) => {
  await page.goto("/overview");
  const loginHeading = page.getByRole("heading", { name: "Welcome back" });
  if (await loginHeading.count()) await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: "Operational overview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("complementary").getByRole("button", { name: "Close navigation" })).toBeVisible();
  await page.getByRole("link", { name: "Telemetry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Telemetry", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  for (const [linkName, headingName] of [
    ["Flight Schedule", "Flight schedule"],
    ["Audit Log", "Administrative audit log"],
  ] as const) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("complementary").getByRole("link", { name: linkName, exact: true }).click();
    await expect(page.getByRole("heading", { name: headingName, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }
});
