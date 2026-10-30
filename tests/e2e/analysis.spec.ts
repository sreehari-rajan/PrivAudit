import { test, expect } from "@playwright/test";
import { sampleReports } from "../../src/lib/sample";

test("sample assessment, exact excerpts, regional panels and comparison", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Privacy analysis", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /I agree to send.*Google Gemini/ })).toBeVisible();
  await expect(page.getByText("Google may use free-tier submissions", { exact: false })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Analyze policy", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Explore sample reports" }).click();
  await expect(page.getByRole("heading", { name: "Willow Notes" })).toBeVisible();
  await expect(page.getByText("Fictional policy and illustrative results.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /Sharing & advertising.*5\.0/ }).click();
  await expect(page.locator(".evidence blockquote")).toContainText("We do not sell your information");
  await page.getByRole("tab", { name: "CCPA/CPRA", exact: true }).click();
  await expect(page.locator("summary").filter({ hasText: "Global Privacy Control" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish report", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("assessment.png"), fullPage: true });
  await page.getByRole("button", { name: /^Compare/ }).click();
  await expect(page.getByRole("heading", { name: "Compare policies" })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Beacon Social");
  await expect(page.getByRole("table")).toContainText("Unknown");
  await page.screenshot({ path: testInfo.outputPath("comparison.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("processing errors are visible and do not produce a score", async ({ page }) => {
  await page.route("**/api/analyses", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Live analysis is not configured. Explore the fictional samples." }) }));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Privacy policy URL 1" }).fill("https://example.com/privacy");
  await page.getByRole("checkbox", { name: /I agree to send/ }).check();
  await page.getByRole("main").getByRole("button", { name: "Analyze policy", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Live analysis is not configured");
  await expect(page.locator(".score-ring")).toHaveCount(0);
});

test("private preview requires explicit publication consent and supports removal", async ({ page }) => {
  const report = { ...sampleReports()[0], sample: false, model: "mocked-provider" };
  let published = false;
  await page.route("**/api/analyses", (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ jobs: [{ id: "fixture-job", url: report.url }] }) }));
  await page.route("**/api/analyses/fixture-job", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "fixture-job", status: "complete", report }) }));
  await page.route("**/api/analyses/fixture-job/publish", async (route) => {
    expect(route.request().postDataJSON().consent).toBe(true);
    published = true;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: report.id, removalCredential: "a".repeat(64), expiresAt: report.expiresAt }) });
  });
  await page.route(`**/api/reports/${report.id}`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ removed: true }) }));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Privacy policy URL 1" }).fill(report.url);
  await page.getByRole("checkbox", { name: /I agree to send/ }).check();
  await page.getByRole("main").getByRole("button", { name: "Analyze policy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Willow Notes", exact: true })).toBeVisible();
  expect(published).toBe(false);
  await page.getByRole("button", { name: "Publish report", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Publish report", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Publish report", exact: true }).click();
  await expect(page.getByText("Report published", { exact: true })).toBeVisible();
  await expect(page.locator(".credential code")).toHaveText("a".repeat(64));
  await page.getByRole("button", { name: "Remove publication" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove report", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("removed from the library");
});

test("library search exposes only returned public reports", async ({ page }) => {
  const report = sampleReports()[0];
  await page.route("**/api/reports?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ reports: [report], configured: true }) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Public library", exact: true }).click();
  await page.getByRole("textbox", { name: "Search public reports" }).fill("Willow");
  await expect(page.getByRole("heading", { name: "Willow Notes" })).toBeVisible();
  await expect(page.locator(".library-row")).toHaveAttribute("href", `/reports/${report.id}`);
});