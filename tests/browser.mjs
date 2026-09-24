import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";

// Own a fresh database and server. Never connect to an existing app instance.
const port = 3713;
const host = `http://127.0.0.1:${port}`;
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
});
const folder = mkdtempSync(join(tmpdir(), "tiny-notes-browser-"));
const env = {
  ...process.env,
  APP_URL: host,
  DATABASE_PATH: join(folder, "browser.sqlite"),
  STRIPE_SECRET_KEY: "",
  STRIPE_PRICE_ID: "",
  STRIPE_WEBHOOK_SECRET: "",
  NEXT_TELEMETRY_DISABLED: "1",
};
const migrated = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/migrate.ts"],
  { env, encoding: "utf8" },
);
if (migrated.status !== 0)
  throw new Error(
    migrated.stderr || migrated.error?.message || "Migration failed",
  );
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
server.stdout.on("data", (x) => {
  logs += x;
});
server.stderr.on("data", (x) => {
  logs += x;
});
let browser;
try {
  await expect
    .poll(
      async () => {
        if (server.exitCode !== null) throw new Error(logs);
        try {
          return (await fetch(host)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(host);
  await page.getByLabel("Email", { exact: true }).fill("alice@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a-long-test-password");
  await page.getByRole("button", { name: "Create my notebook" }).click();
  await expect(
    page.getByRole("heading", { name: "Small thoughts, kept." }),
  ).toBeVisible();
  for (const body of [
    "Read a chapter.",
    "Take a walk.",
    "Make something small.",
  ]) {
    await page.getByLabel("What’s on your mind?").fill(body);
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.locator(".notes")).toContainText(body);
  }
  await expect(page.getByRole("button", { name: "Save note" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Get Pro" })).toBeDisabled();
  const denied = await context.request.post(`${host}/api/notes`, {
    data: { body: "Bypass the UI limit" },
    headers: { Origin: host },
  });
  assert.equal(denied.status(), 409);
  assert.equal(
    (
      await context.request.post(`${host}/api/notes`, {
        data: { body: "Cross origin" },
        headers: { Origin: "https://other.example" },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await context.request.post(`${host}/api/notes`, {
        data: null,
        headers: { Origin: host },
      })
    ).status(),
    400,
  );
  await page
    .getByRole("button", { name: "Delete note 3", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep note", exact: true }).click();
  await expect(page.locator(".notes li")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Delete note 3", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.locator(".notes li")).toHaveCount(2);
  const narrow = { width: 390, height: 844 };
  await page.setViewportSize(narrow);
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
  );
  mkdirSync(".artifacts", { recursive: true });
  await page.screenshot({
    path: ".artifacts/notebook-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: ".artifacts/notebook-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Start your notebook" }),
  ).toBeVisible();
  assert.equal(
    (
      await context.request.post(`${host}/api/notes`, {
        data: { body: "Logged out" },
        headers: { Origin: host },
      })
    ).status(),
    401,
  );
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("alice@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a-long-test-password");
  await page.getByRole("button", { name: "Open my notebook" }).click();
  await expect(page.locator(".notes li")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".notes li")).toHaveCount(2);
  const other = await browser.newContext();
  assert.equal(
    (
      await other.request.post(`${host}/api/auth/signup`, {
        data: { email: "bob@example.com", password: "another-long-password" },
        headers: { Origin: host },
      })
    ).status(),
    200,
  );
  const otherPage = await other.newPage();
  await otherPage.goto(host);
  await expect(otherPage.locator(".notes li")).toHaveCount(0);
  await other.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser signup/login/logout, persistent sessions/notes, free quota, cross-origin rejection, invalid JSON, isolation, delete confirmation, mobile layout. No Stripe or model calls.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await stopped;
  }
  mkdirSync(".artifacts", { recursive: true });
  writeFileSync(".artifacts/browser-server.log", logs);
  rmSync(folder, { recursive: true, force: true });
}
