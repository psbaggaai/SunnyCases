#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_DIR, ".env.local");
const REQUIRED_ENV = ["GITHUB_PAT", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
const PROJECT_NAME = "sunnycasetracker";
const LIVE_URL = "https://sunnycasetracker.pages.dev";
const PUSH_REMOTE = process.env.GIT_PUSH_REMOTE || "origin";
const PUSH_BRANCH = process.env.GIT_PUSH_BRANCH || process.env.GITHUB_REF_NAME || "main";
const SITE_FILES = [
  "index.html",
  "cases.html",
  "sunny-cases.html",
  "ai-insights.html",
  "documents.html",
  "orders.html",
  "event-log.html",
  "automation-events.json",
];
const TRACKED_FILES = [
  ...SITE_FILES,
  "package.json",
  "package-lock.json",
  ".gitignore",
  "scripts/build-sunny-site.mjs",
  "scripts/deploy-sunny-site.mjs",
  "scripts/update-sunny-case-data.mjs",
  "scripts/sync-and-publish.mjs",
  ".github/workflows/case-refresh.yml",
  "docs/sunny-runner-setup.md",
];

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

function redact(value) {
  let text = String(value || "");
  for (const key of REQUIRED_ENV) {
    const secret = process.env[key];
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_DIR,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 50 * 1024 * 1024,
    stdio: options.capture === false ? "inherit" : "pipe",
  });
  if (result.error) throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const output = redact(`${result.stdout || ""}\n${result.stderr || ""}`.trim());
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}${output ? `\n${output}` : ""}`);
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim();
}

function requireEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function createDeployArtifact() {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "sunnycase-site-"));
  for (const fileName of SITE_FILES) {
    const source = path.join(REPO_DIR, fileName);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(artifactDir, fileName));
  }
  return artifactDir;
}

function verifyLiveSite() {
  const headers = run("curl", ["-I", "--max-time", "30", "-sS", LIVE_URL]);
  if (!/^HTTP\/[0-9.]+\s+200/m.test(headers)) {
    throw new Error(`${LIVE_URL} did not return HTTP 200 after deployment.`);
  }
}

loadEnvFile(ENV_PATH);
requireEnv();

run("node", ["scripts/update-sunny-case-data.mjs"], { capture: false });
run("node", ["scripts/build-sunny-site.mjs"], { capture: false });
run("git", ["add", ...TRACKED_FILES.filter((fileName) => fs.existsSync(path.join(REPO_DIR, fileName)))], { capture: false });

let hasChanges = true;
try {
  run("git", ["diff", "--cached", "--quiet"]);
  hasChanges = false;
} catch {
  hasChanges = true;
}

if (hasChanges) {
  run("git", ["commit", "-m", "Automated Sunny case tracker refresh"], { capture: false });
  const auth = Buffer.from(`x-access-token:${process.env.GITHUB_PAT}`).toString("base64");
  run("git", ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, "push", PUSH_REMOTE, `HEAD:${PUSH_BRANCH}`], {
    capture: false,
  });
} else {
  console.log("No Sunny tracker changes were detected; deploying current artifact anyway.");
}

const artifactDir = createDeployArtifact();
try {
  run("npx", ["--yes", "wrangler", "pages", "deploy", artifactDir, `--project-name=${PROJECT_NAME}`, "--branch=main"], {
    capture: false,
    env: {
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    },
  });
} finally {
  fs.rmSync(artifactDir, { recursive: true, force: true });
}

verifyLiveSite();
console.log(`Sunny automation sync, push, deploy, and verification completed at ${LIVE_URL}`);
