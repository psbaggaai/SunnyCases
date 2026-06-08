#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_DIR, ".env.local");
const REQUIRED_ENV = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
const PROJECT_NAME = "sunnycasetracker";
const LIVE_URL = "https://sunnycasetracker.pages.dev";
const SITE_FILES = [
  "index.html",
  "cases.html",
  "sunny-cases.html",
  "documents.html",
  "orders.html",
  "event-log.html",
  "automation-events.json",
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
  const env = { ...process.env, ...(options.env || {}) };
  const result = spawnSync(command, args, {
    cwd: REPO_DIR,
    encoding: "utf8",
    env,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (options.print) {
    if (result.stdout) process.stdout.write(redact(result.stdout));
    if (result.stderr) process.stderr.write(redact(result.stderr));
  }
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
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(artifactDir, fileName));
  }
  return artifactDir;
}

function verifyLiveSite() {
  const headers = run("curl", ["-I", "--max-time", "30", "-sS", LIVE_URL]);
  if (!/^HTTP\/[0-9.]+\s+200/m.test(headers)) {
    throw new Error(`${LIVE_URL} did not return HTTP 200 after deployment.`);
  }
}

function main() {
  loadEnvFile(ENV_PATH);
  requireEnv();
  execFileSync("node", ["scripts/build-sunny-site.mjs"], { cwd: REPO_DIR, stdio: "inherit" });
  const artifactDir = createDeployArtifact();
  try {
    run("npx", ["--yes", "wrangler", "pages", "deploy", artifactDir, `--project-name=${PROJECT_NAME}`, "--branch=main"], {
      env: {
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
      },
      print: true,
    });
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
  verifyLiveSite();
  console.log(`Sunny Case Tracker deployed and verified at ${LIVE_URL}`);
}

main();
