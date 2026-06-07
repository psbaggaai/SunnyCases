#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_DIR = path.resolve(process.cwd());
const ENV_PATH = path.join(REPO_DIR, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: REPO_DIR,
    stdio: options.capture === false ? "inherit" : "pipe",
    encoding: options.encoding ?? "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });
}

loadEnvFile(ENV_PATH);

const requiredEnv = ["GITHUB_PAT", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

run("node", ["scripts/update-case-data-playwright.mjs"], { capture: false });

run(
    "git",
    [
      "add",
      "index.html",
      "documents.html",
      "orders.html",
      "settings.html",
      "package.json",
      "package-lock.json",
      ".gitignore",
      "scripts/update-case-data.mjs",
      "scripts/update-case-data-playwright.mjs",
      "scripts/sync-and-publish.mjs",
      ".github/workflows/case-refresh.yml",
    "docs/india-runner-setup.md",
  ],
  { capture: false }
);

let hasChanges = true;
try {
  run("git", ["diff", "--cached", "--quiet"]);
  hasChanges = false;
} catch {
  hasChanges = true;
}

if (!hasChanges) {
  console.log("No tracked data changes were detected. Skipping commit, push, and deploy.");
  process.exit(0);
}

run("git", ["commit", "-m", "Automated case tracker refresh"], { capture: false });

const auth = Buffer.from(`x-access-token:${process.env.GITHUB_PAT}`).toString("base64");
run(
  "git",
  ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, "push", "origin", "main"],
  { capture: false }
);

run(
  "npx",
  ["--yes", "wrangler", "pages", "deploy", ".", "--project-name=baggacasetracker", "--branch=main"],
  {
    capture: false,
    env: {
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    },
  }
);

const verify = run("curl", ["-I", "--max-time", "20", "-sS", "https://baggacasetracker.pages.dev"]);
if (!/200/.test(verify)) {
  throw new Error("Live Cloudflare site did not return HTTP 200 after deployment.");
}

console.log("Automation sync, push, deploy, and verification completed.");
