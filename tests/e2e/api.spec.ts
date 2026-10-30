import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3000";
test("the public library API responds without cached report data", async ({ request }) => {
  const response = await request.get("/api/reports?q=privaudit-integration-smoke-check");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const result = await response.json();
  expect(typeof result.configured).toBe("boolean");
  expect(Array.isArray(result.reports)).toBe(true);
});

test("unsafe policy inputs are rejected before any provider request", async ({ request }) => {
  for (const url of ["http://127.0.0.1/privacy", "http://169.254.169.254/latest/meta-data", "https://example.com/privacy?token=secret"]) {
    const response = await request.post("/api/analyses", { headers: { Origin: origin }, data: { urls: [url], processingConsent: true } });
    expect(response.status()).toBe(400);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test("analysis requires same-origin requests and processing consent", async ({ request }) => {
  const crossOrigin = await request.post("/api/analyses", { headers: { Origin: "https://other.example" }, data: { urls: ["https://example.com/privacy"], processingConsent: true } });
  expect(crossOrigin.status()).toBe(403);
  const noConsent = await request.post("/api/analyses", { headers: { Origin: origin }, data: { urls: ["https://example.com/privacy"], processingConsent: false } });
  expect(noConsent.status()).toBe(400);
  const tooMany = await request.post("/api/analyses", { headers: { Origin: origin }, data: { urls: Array(4).fill("https://example.com/privacy"), processingConsent: true } });
  expect(tooMany.status()).toBe(400);
});

test("analysis attempts are not capped by the old hourly or daily budgets", async ({ request }) => {
  for (let attempt = 0; attempt < 7; attempt++) {
    // The reserved .invalid domain fails before policy text can reach the provider.
    const response = await request.post("/api/analyses", {
      headers: { Origin: origin },
      data: { urls: ["https://privaudit-test.invalid/privacy"], processingConsent: true },
    });
    expect(response.status()).toBe(202);
    const { jobs } = await response.json();
    expect(jobs).toHaveLength(1);
    const path = `/api/analyses/${jobs[0].id}`;
    try {
      await expect.poll(async () => {
        const job = await request.get(path);
        expect(job.status()).toBe(200);
        return (await job.json()).status;
      }, { timeout: 10000 }).toBe("failed");
    } finally {
      const cancellation = await request.delete(path, { headers: { Origin: origin } });
      expect(cancellation.status()).toBe(200);
    }
  }
});

test("private job results require a session", async ({ request }) => {
  const response = await request.get("/api/analyses/not-a-real-private-job");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("private");
});

test("publication cannot bypass consent or session ownership", async ({ request }) => {
  const noConsent = await request.post("/api/analyses/not-a-real-private-job/publish", { headers: { Origin: origin }, data: { consent: false } });
  expect(noConsent.status()).toBe(400);
  const noSession = await request.post("/api/analyses/not-a-real-private-job/publish", { headers: { Origin: origin }, data: { consent: true } });
  expect(noSession.status()).toBe(401);
});