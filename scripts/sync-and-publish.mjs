#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_DIR = path.resolve(process.cwd());
const ENV_PATH = path.join(REPO_DIR, ".env.local");
const EVENT_LOG_DATA_PATH = path.join(REPO_DIR, "automation-events.json");
const EVENT_LOG_PAGE_PATH = path.join(REPO_DIR, "event-log.html");
const EVENT_LOG_LIMIT = 75;
const REQUIRED_ENV = ["GITHUB_PAT", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];

const SITE_FILES = [
  "index.html",
  "cases.html",
  "sunny-cases.html",
  "documents.html",
  "orders.html",
  "settings.html",
  "event-log.html",
  "automation-events.json",
];

const TRACKED_FILES = [
  ...SITE_FILES,
  "package.json",
  "package-lock.json",
  ".gitignore",
  "scripts/update-case-data.mjs",
  "scripts/update-case-data-playwright.mjs",
  "scripts/sync-and-publish.mjs",
  ".github/workflows/case-refresh.yml",
  "docs/india-runner-setup.md",
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
  return text.replace(/AUTHORIZATION: basic [A-Za-z0-9+/=]+/g, "AUTHORIZATION: basic [redacted]");
}

function safeArgs(args) {
  return args.map((arg) => redact(arg));
}

function run(command, args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  if (options.capture) {
    const result = spawnSync(command, args, {
      cwd: REPO_DIR,
      encoding: options.encoding ?? "utf8",
      env,
      maxBuffer: 50 * 1024 * 1024,
    });
    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    if (options.print) {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }
    if (result.error) {
      const error = new Error(`${command} ${safeArgs(args).join(" ")} failed: ${result.error.message}`);
      error.capturedOutput = `${stdout}\n${stderr}`.trim();
      throw error;
    }
    if (result.status !== 0) {
      const error = new Error(`${command} ${safeArgs(args).join(" ")} exited with status ${result.status}`);
      error.capturedOutput = `${stdout}\n${stderr}`.trim();
      throw error;
    }
    return `${stdout}\n${stderr}`.trim();
  }

  try {
    return execFileSync(command, args, {
      cwd: REPO_DIR,
      stdio: "inherit",
      encoding: options.encoding ?? "utf8",
      maxBuffer: 50 * 1024 * 1024,
      env,
    });
  } catch (error) {
    const wrapped = new Error(`${command} ${safeArgs(args).join(" ")} failed with exit status ${error.status ?? "unknown"}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function requireEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value, maxLength = 900) {
  const text = String(value || "").replace(/\s+\n/g, "\n").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatRunTimestamp(date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

function formatEventTimestamp(isoTimestamp) {
  if (!isoTimestamp) return "-";
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "-";
  return formatRunTimestamp(date);
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "-";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function readEventLogDocument() {
  if (!fs.existsSync(EVENT_LOG_DATA_PATH)) {
    return { version: 1, updatedAt: "", events: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(EVENT_LOG_DATA_PATH, "utf8"));
  if (Array.isArray(parsed)) {
    return { version: 1, updatedAt: "", events: parsed };
  }
  return {
    version: Number(parsed.version) || 1,
    updatedAt: parsed.updatedAt || "",
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

function sortEvents(events) {
  return events
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = new Date(a.completedAt || a.startedAt || 0).getTime();
      const bTime = new Date(b.completedAt || b.startedAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, EVENT_LOG_LIMIT);
}

function writeEventLog(events, updatedAt = new Date().toISOString()) {
  const sortedEvents = sortEvents(events);
  const document = {
    version: 1,
    updatedAt,
    events: sortedEvents,
  };
  fs.writeFileSync(EVENT_LOG_DATA_PATH, `${JSON.stringify(document, null, 2)}\n`);
  fs.writeFileSync(EVENT_LOG_PAGE_PATH, buildEventLogPage(sortedEvents, updatedAt));
}

function appendEvent(event) {
  const document = readEventLogDocument();
  writeEventLog([event, ...document.events]);
}

function statusLabel(status) {
  if (status === "success") return "Success";
  if (status === "warning") return "Warning";
  return "Error";
}

function statusClass(status) {
  if (status === "success") return "success";
  if (status === "warning") return "warning";
  return "error";
}

function countStatus(events, status) {
  return events.filter((event) => event.status === status).length;
}

function buildEventRows(events) {
  if (events.length === 0) {
    return `        <div class="empty">No automation events have been recorded yet.</div>`;
  }

  return events
    .map((event) => {
      const cssStatus = statusClass(event.status);
      const sourceParts = [event.source, event.trigger, event.runner].filter(Boolean);
      const counts = [];
      if (Number.isFinite(event.refreshedCases)) counts.push(`${event.refreshedCases} refreshed`);
      if (Number.isFinite(event.preservedCases)) counts.push(`${event.preservedCases} preserved`);
      const runLink = event.runUrl
        ? `<a class="button-link" href="${escapeHtml(event.runUrl)}" target="_blank" rel="noreferrer">Workflow</a>`
        : "";
      const verifiedLink = event.verifiedUrl
        ? `<a class="button-link secondary" href="${escapeHtml(event.verifiedUrl)}" target="_blank" rel="noreferrer">Live Site</a>`
        : "";
      const details = [event.summary, event.error ? `Error: ${event.error}` : "", counts.join(" - ")]
        .filter(Boolean)
        .join("\n");

      return `        <article class="event-row ${cssStatus}">
          <div>
            <div class="status-badge ${cssStatus}">${escapeHtml(statusLabel(event.status))}</div>
            <h3>${escapeHtml(event.workflow || "Case tracker automation")}</h3>
            <p>${escapeHtml(details || "Automation run recorded.")}</p>
          </div>
          <div>
            <div class="label">Started</div>
            <div class="value">${escapeHtml(formatEventTimestamp(event.startedAt))}</div>
            <div class="muted">Duration: ${escapeHtml(formatDuration(event.startedAt, event.completedAt))}</div>
          </div>
          <div>
            <div class="label">Runner</div>
            <div class="value">${escapeHtml(sourceParts.join(" - ") || "Unknown")}</div>
            <div class="muted">${escapeHtml(event.runId ? `Run ${event.runId}` : event.commitBefore ? `Commit ${event.commitBefore.slice(0, 7)}` : "")}</div>
          </div>
          <div class="row-actions">${runLink}${verifiedLink}</div>
        </article>`;
    })
    .join("\n");
}

function buildEventLogPage(events, updatedAtIso) {
  const latestEvent = events[0] || null;
  const updatedLabel = formatEventTimestamp(updatedAtIso);
  const latestLabel = latestEvent ? statusLabel(latestEvent.status) : "None";
  const latestTime = latestEvent ? formatEventTimestamp(latestEvent.completedAt || latestEvent.startedAt) : "-";
  const successCount = countStatus(events, "success");
  const errorCount = events.filter((event) => event.status !== "success").length;
  const source = latestEvent?.source || "-";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Automation Event Log</title>
    <style>
      :root { --bg: #eef4fb; --ink: #1f2b3d; --muted: #63748d; --navy: #172d4d; --border: rgba(105, 131, 173, 0.2); --surface: #fff; --shadow: 0 18px 46px rgba(29, 53, 87, 0.12); --good: #337b45; --bad: #a9473f; --warn: #9b6a12; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "SF Pro Display", "Segoe UI", system-ui, sans-serif; color: var(--ink); background: linear-gradient(120deg, rgba(255,255,255,0.72), rgba(216,226,241,0.6) 38%, rgba(248,246,236,0.72)), linear-gradient(180deg, #f8fbff 0%, #dfe8f3 58%, #f4f0e6 100%); }
      body::before { content: ""; position: fixed; inset: 0; background: linear-gradient(105deg, rgba(47,79,128,0.1), transparent 26%, rgba(217,165,58,0.09) 58%, transparent 76%), repeating-linear-gradient(118deg, rgba(255,255,255,0.2) 0 1px, transparent 1px 34px); pointer-events: none; z-index: -1; }
      .top-banner { background: linear-gradient(112deg, #101b2e 0%, #18365b 47%, #3d5868 100%); box-shadow: 0 16px 34px rgba(13,25,43,0.24), inset 0 -1px 0 rgba(255,255,255,0.12); color: white; min-height: 52px; padding: 8px clamp(16px, 4vw, 32px); }
      .top-banner-inner, main { max-width: 1440px; margin: 0 auto; }
      .top-banner-inner { align-items: center; display: flex; gap: 16px; justify-content: space-between; min-height: 36px; }
      .banner-title { align-items: center; display: flex; gap: 12px; }
      .home-title-link, .back-link { color: inherit; text-decoration: none; }
      h1 { font-size: clamp(1.05rem, 2vw, 1.28rem); line-height: 1.15; margin: 0; }
      h2 { font-size: clamp(1.9rem, 3vw, 2.7rem); margin: 8px 0 0; }
      h3 { font-size: 1rem; line-height: 1.35; margin: 10px 0 0; }
      p { color: var(--muted); line-height: 1.55; margin: 8px 0 0; white-space: pre-line; }
      .top-banner-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end; }
      .back-link { font-size: 0.9rem; font-weight: 800; }
      .last-updated-chip { align-items: center; background: rgba(255,255,255,0.11); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; color: rgba(255,255,255,0.94); display: inline-flex; font-size: 0.82rem; font-weight: 850; min-height: 34px; padding: 7px 12px; white-space: nowrap; }
      .menu-button, .menu-close { align-items: center; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; color: white; cursor: pointer; display: inline-flex; height: 38px; justify-content: center; padding: 0; width: 38px; }
      .menu-lines { display: grid; gap: 4px; width: 18px; }
      .menu-lines span { background: currentColor; border-radius: 999px; display: block; height: 2px; }
      .menu-backdrop { background: rgba(13,25,43,0.42); inset: 0; position: fixed; z-index: 30; }
      .site-menu { background: linear-gradient(150deg, rgba(255,255,255,0.98), rgba(229,237,249,0.98)); border-right: 1px solid rgba(89,123,171,0.24); box-shadow: 24px 0 60px rgba(15,31,53,0.2); color: var(--ink); display: flex; flex-direction: column; height: 100vh; left: 0; max-width: min(360px, calc(100vw - 36px)); padding: 18px; position: fixed; top: 0; transform: translateX(-110%); transition: transform 180ms ease; width: 340px; z-index: 40; }
      .site-menu.open { transform: translateX(0); }
      .menu-backdrop[hidden], .site-menu[hidden] { display: none; }
      .site-menu-head { align-items: center; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; padding-bottom: 16px; }
      .site-menu-title { font-size: 1rem; font-weight: 850; }
      .site-menu-subtitle { color: var(--muted); font-size: 0.82rem; font-weight: 700; margin-top: 4px; }
      .menu-close { background: #eef4ff; border-color: var(--border); color: var(--navy); }
      .menu-links { display: grid; gap: 8px; padding-top: 18px; }
      .menu-link, .logout-button { align-items: center; border: 1px solid transparent; border-radius: 14px; color: var(--ink); display: flex; font-size: 0.96rem; font-weight: 800; gap: 12px; min-height: 46px; padding: 12px 14px; text-decoration: none; }
      .menu-link:hover, .menu-link.active { background: #eef4ff; border-color: var(--border); color: #315fae; }
      .menu-footer { border-top: 1px solid var(--border); margin-top: auto; padding-top: 14px; }
      .logout-button { background: #fff4f2; border-color: rgba(216,108,99,0.22); color: #a9473f; cursor: pointer; width: 100%; }
      main { padding: 22px clamp(20px, 4vw, 40px) 64px; }
      .page-head, .stat-card, .event-row { background: linear-gradient(145deg, rgba(255,255,255,0.96), rgba(230,237,248,0.88)), linear-gradient(90deg, rgba(113,185,223,0.08), rgba(217,165,58,0.08)); border: 1px solid rgba(89,123,171,0.26); box-shadow: 0 18px 42px rgba(29,53,87,0.12), inset 0 1px 0 rgba(255,255,255,0.8); }
      .page-head { border-radius: 24px; padding: 24px; }
      .label { color: var(--muted); font-size: 0.78rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
      .stats-grid { display: grid; gap: 14px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 18px; }
      .stat-card { border-radius: 18px; min-height: 116px; padding: 18px; }
      .stat-value { font-size: clamp(1.45rem, 2.5vw, 2rem); font-weight: 900; line-height: 1.1; margin-top: 8px; overflow-wrap: anywhere; }
      .stat-note, .muted { color: var(--muted); font-size: 0.9rem; margin-top: 6px; }
      .event-list { display: grid; gap: 14px; margin-top: 20px; }
      .event-row { border-radius: 18px; display: grid; gap: 16px; grid-template-columns: minmax(240px, 1.3fr) minmax(170px, 0.75fr) minmax(210px, 0.95fr) minmax(130px, 0.5fr); padding: 16px; }
      .event-row.error { border-color: rgba(169,71,63,0.3); }
      .event-row.warning { border-color: rgba(155,106,18,0.32); }
      .status-badge { border-radius: 999px; display: inline-flex; font-size: 0.78rem; font-weight: 900; padding: 6px 10px; text-transform: uppercase; }
      .status-badge.success { background: #eef9f1; color: var(--good); }
      .status-badge.error { background: #fff4f2; color: var(--bad); }
      .status-badge.warning { background: #fff8e6; color: var(--warn); }
      .value { font-weight: 800; line-height: 1.4; overflow-wrap: anywhere; }
      .row-actions { align-content: start; display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start; }
      .button-link { background: #eef4ff; border-radius: 999px; color: #3b67b9; display: inline-flex; font-weight: 850; justify-content: center; padding: 10px 14px; text-decoration: none; }
      .button-link.secondary { background: #eef9f1; color: var(--good); }
      .empty { background: white; border: 1px dashed #bed0ea; border-radius: 18px; color: var(--muted); font-weight: 800; padding: 24px; text-align: center; }
      .magnetic-item { --mag-x: 0px; --mag-y: 0px; --tilt-x: 0deg; --tilt-y: 0deg; --lift: 0px; position: relative; transform: translate3d(var(--mag-x), calc(var(--mag-y) + var(--lift)), 0) rotateX(var(--tilt-x)) rotateY(var(--tilt-y)); transform-style: preserve-3d; transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background 180ms ease; will-change: transform; }
      .magnetic-item::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(125deg, rgba(255,255,255,0.55), transparent 34%, rgba(104,178,224,0.14) 54%, transparent 76%); opacity: 0; pointer-events: none; transition: opacity 180ms ease; }
      .magnetic-item:hover, .magnetic-item.is-magnetic { --lift: -3px; border-color: rgba(82,148,211,0.58); box-shadow: 0 24px 48px rgba(25,47,79,0.18), 0 0 0 1px rgba(121,207,255,0.16), inset 0 1px 0 rgba(255,255,255,0.9); }
      .magnetic-item:hover::after, .magnetic-item.is-magnetic::after { opacity: 1; }
      @media (prefers-reduced-motion: reduce), (pointer: coarse) { .magnetic-item { transform: none; transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease; } }
      @media (max-width: 980px) { .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .event-row { grid-template-columns: 1fr; } }
      @media (max-width: 620px) { .top-banner-inner { align-items: flex-start; flex-direction: column; } .top-banner-actions { align-items: flex-start; justify-content: flex-start; width: 100%; } .stats-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header class="top-banner">
      <div class="top-banner-inner">
        <div class="banner-title">
          <button class="menu-button" type="button" aria-label="Open navigation menu" aria-controls="siteMenu" aria-expanded="false" data-menu-toggle>
            <span class="menu-lines" aria-hidden="true"><span></span><span></span><span></span></span>
          </button>
          <a class="home-title-link" href="index.html" aria-label="Go to dashboard home">
            <h1>Bagga Case Tracker Dashboard</h1>
          </a>
        </div>
        <div class="top-banner-actions">
          <div class="last-updated-chip" data-last-updated>Last updated: ${escapeHtml(updatedLabel)}</div>
          <a class="back-link" href="index.html">Back to Dashboard</a>
        </div>
      </div>
    </header>
    <div class="menu-backdrop" data-menu-close hidden></div>
    <nav class="site-menu" id="siteMenu" aria-label="Site navigation" aria-hidden="true" hidden>
      <div class="site-menu-head">
        <div>
          <div class="site-menu-title">Bagga Case Tracker</div>
          <div class="site-menu-subtitle">Dashboard navigation</div>
        </div>
        <button class="menu-close" type="button" aria-label="Close navigation menu" data-menu-close><span aria-hidden="true">X</span></button>
      </div>
      <div class="menu-links">
        <a class="menu-link" href="cases.html">Cases</a>
        <a class="menu-link" href="sunny-cases.html">Sunny Cases</a>
        <a class="menu-link" href="orders.html">Orders</a>
        <a class="menu-link" href="documents.html">Documents</a>
        <a class="menu-link active" href="event-log.html">Event Log</a>
        <a class="menu-link" href="settings.html">Settings</a>
      </div>
      <div class="menu-footer">
        <button class="logout-button" type="button" data-logout>Logout</button>
      </div>
    </nav>
    <main>
      <section class="page-head">
        <div class="label">Automation</div>
        <h2>Event Log</h2>
        <p>Recorded outcomes from the case tracker refresh job, including successful runs and errors that prevented completion.</p>
      </section>
      <section class="stats-grid" aria-label="Automation summary">
        <article class="stat-card">
          <div class="label">Latest Run</div>
          <div class="stat-value">${escapeHtml(latestLabel)}</div>
          <div class="stat-note">${escapeHtml(latestTime)}</div>
        </article>
        <article class="stat-card">
          <div class="label">Successful</div>
          <div class="stat-value">${successCount}</div>
          <div class="stat-note">Recorded refreshes</div>
        </article>
        <article class="stat-card">
          <div class="label">Errors</div>
          <div class="stat-value">${errorCount}</div>
          <div class="stat-note">Runs needing attention</div>
        </article>
        <article class="stat-card">
          <div class="label">Last Source</div>
          <div class="stat-value">${escapeHtml(source)}</div>
          <div class="stat-note">${events.length} total event${events.length === 1 ? "" : "s"}</div>
        </article>
      </section>
      <section class="event-list">
${buildEventRows(events)}
      </section>
    </main>
    <script>
      const siteLastUpdatedAt = "${escapeHtml(updatedAtIso)}";
      const menu = document.getElementById("siteMenu");
      const menuBackdrop = document.querySelector(".menu-backdrop");
      const menuToggle = document.querySelector("[data-menu-toggle]");
      const menuCloseButtons = Array.from(document.querySelectorAll("[data-menu-close]"));
      const logoutButtons = Array.from(document.querySelectorAll("[data-logout]"));

      function setMenuOpen(isOpen) {
        if (!menu || !menuBackdrop || !menuToggle) return;
        if (!isOpen && menu.hidden) return;
        menu.hidden = false;
        menuBackdrop.hidden = false;
        requestAnimationFrame(() => {
          menu.classList.toggle("open", isOpen);
          menuToggle.setAttribute("aria-expanded", String(isOpen));
          menu.setAttribute("aria-hidden", String(!isOpen));
        });
        if (!isOpen) {
          window.setTimeout(() => {
            menu.hidden = true;
            menuBackdrop.hidden = true;
          }, 180);
        }
      }

      menuToggle?.addEventListener("click", () => setMenuOpen(true));
      menuCloseButtons.forEach((button) => button.addEventListener("click", () => setMenuOpen(false)));
      logoutButtons.forEach((button) => {
        button.addEventListener("click", () => {
          localStorage.removeItem("baggaCaseTrackerSession");
          window.location.href = "index.html";
        });
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setMenuOpen(false);
      });

      const magneticSelector = ".page-head, .stat-card, .event-row, .menu-button, .menu-close, .menu-link, .logout-button, .button-link, .last-updated-chip";
      const magneticItems = new WeakSet();
      const reduceMagneticMotion = window.matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)").matches;

      function initMagneticUi(root = document) {
        root.querySelectorAll(magneticSelector).forEach((element) => {
          element.classList.add("magnetic-item");
          if (reduceMagneticMotion || magneticItems.has(element)) return;
          magneticItems.add(element);
          element.addEventListener("pointermove", (event) => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
            const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
            const isCompact = element.matches(".menu-button, .menu-close, .menu-link, .logout-button, .button-link, .last-updated-chip");
            const move = isCompact ? 4 : 7;
            const tilt = isCompact ? 1.2 : 2.6;
            element.classList.add("is-magnetic");
            element.style.setProperty("--mag-x", \`\${(x * move).toFixed(2)}px\`);
            element.style.setProperty("--mag-y", \`\${(y * move).toFixed(2)}px\`);
            element.style.setProperty("--tilt-x", \`\${(-y * tilt).toFixed(2)}deg\`);
            element.style.setProperty("--tilt-y", \`\${(x * tilt).toFixed(2)}deg\`);
          });
          element.addEventListener("pointerleave", () => {
            element.classList.remove("is-magnetic");
            element.style.setProperty("--mag-x", "0px");
            element.style.setProperty("--mag-y", "0px");
            element.style.setProperty("--tilt-x", "0deg");
            element.style.setProperty("--tilt-y", "0deg");
          });
        });
      }

      initMagneticUi();
    </script>
  </body>
</html>
`;
}

function currentCommit() {
  try {
    return run("git", ["rev-parse", "HEAD"], { capture: true }).trim();
  } catch {
    return "";
  }
}

function currentBranch() {
  try {
    return run("git", ["branch", "--show-current"], { capture: true }).trim();
  } catch {
    return process.env.GITHUB_REF_NAME || "";
  }
}

function buildRunUrl() {
  if (!process.env.GITHUB_RUN_ID || !process.env.GITHUB_SERVER_URL || !process.env.GITHUB_REPOSITORY) {
    return "";
  }
  return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
}

function buildBaseEvent(startedAt) {
  const runId = process.env.GITHUB_RUN_ID || "";
  return {
    id: `${process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local"}-${runId || process.pid}-${startedAt.toISOString()}`,
    status: "running",
    startedAt: startedAt.toISOString(),
    trigger: process.env.GITHUB_EVENT_NAME || "manual",
    source: process.env.GITHUB_ACTIONS === "true" ? "GitHub Actions" : "Local machine",
    workflow: process.env.GITHUB_WORKFLOW || "Bagga Case Tracker Refresh",
    runId,
    runUrl: buildRunUrl(),
    runner: process.env.RUNNER_NAME || os.hostname(),
    runnerOs: process.env.RUNNER_OS || os.platform(),
    branch: process.env.GITHUB_REF_NAME || currentBranch(),
    commitBefore: currentCommit(),
  };
}

function parseRefreshSummary(output) {
  const match = output.match(/Refreshed\s+(\d+)\s+live case\(s\),\s+preserved\s+(\d+)\s+existing case\(s\),\s+and updated tracker timestamps\./);
  if (!match) {
    return {
      summary: "Case tracker refresh completed.",
    };
  }
  const refreshedCases = Number(match[1]);
  const preservedCases = Number(match[2]);
  return {
    refreshedCases,
    preservedCases,
    summary: `Refreshed ${refreshedCases} live case(s), preserved ${preservedCases} existing case(s), and updated tracker timestamps.`,
  };
}

function formatError(error) {
  const pieces = [error?.message, error?.capturedOutput].filter(Boolean).join("\n");
  return truncate(redact(pieces || String(error || "Unknown automation error")));
}

function stageFiles(files) {
  const existingFiles = files.filter((file) => fs.existsSync(path.join(REPO_DIR, file)));
  run("git", ["add", ...existingFiles], { capture: false });
}

function hasStagedChanges() {
  try {
    run("git", ["diff", "--cached", "--quiet"], { capture: true });
    return false;
  } catch {
    return true;
  }
}

function createDeployArtifact() {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "baggacase-site-"));
  for (const fileName of SITE_FILES) {
    const source = path.join(REPO_DIR, fileName);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(artifactDir, fileName));
  }
  return artifactDir;
}

function deploySite() {
  const artifactDir = createDeployArtifact();
  try {
    return run(
      "npx",
      ["--yes", "wrangler", "pages", "deploy", artifactDir, "--project-name=baggacasetracker", "--branch=main"],
      {
        capture: true,
        print: true,
        env: {
          CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        },
      }
    );
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
}

function pushHeadToMain() {
  const auth = Buffer.from(`x-access-token:${process.env.GITHUB_PAT}`).toString("base64");
  run(
    "git",
    ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`, "push", "origin", "HEAD:main"],
    { capture: false }
  );
}

function verifyLiveSite() {
  const verify = run("curl", ["-I", "--max-time", "20", "-sS", "https://baggacasetracker.pages.dev"], { capture: true });
  if (!/200/.test(verify)) {
    throw new Error("Live Cloudflare site did not return HTTP 200 after deployment.");
  }
}

function commitIfNeeded(message) {
  if (!hasStagedChanges()) {
    return false;
  }
  run("git", ["commit", "-m", message], { capture: false });
  return true;
}

function publishFailureEventLog() {
  try {
    requireEnv();
    stageFiles(["automation-events.json", "event-log.html"]);
    if (!commitIfNeeded("Log failed case tracker refresh")) {
      return;
    }
    pushHeadToMain();
    deploySite();
    verifyLiveSite();
    console.log("Published failure event log.");
  } catch (publishError) {
    console.error("Unable to publish failure event log.");
    console.error(formatError(publishError));
  }
}

function renderEventLogOnly() {
  const document = readEventLogDocument();
  writeEventLog(document.events, document.updatedAt || new Date().toISOString());
  console.log(`Rendered ${path.basename(EVENT_LOG_PAGE_PATH)} from ${path.basename(EVENT_LOG_DATA_PATH)}.`);
}

function main() {
  loadEnvFile(ENV_PATH);

  if (process.argv.includes("--render-event-log")) {
    renderEventLogOnly();
    return;
  }

  const startedAt = new Date();
  const baseEvent = buildBaseEvent(startedAt);

  try {
    requireEnv();
    const updateOutput = run("node", ["scripts/update-case-data-playwright.mjs"], { capture: true, print: true });
    appendEvent({
      ...baseEvent,
      ...parseRefreshSummary(updateOutput),
      status: "success",
      completedAt: new Date().toISOString(),
      verifiedUrl: "https://baggacasetracker.pages.dev",
    });

    stageFiles(TRACKED_FILES);
    if (!commitIfNeeded("Automated case tracker refresh")) {
      console.log("No tracked data changes were detected. Skipping push and deploy.");
      return;
    }

    pushHeadToMain();
    deploySite();
    verifyLiveSite();
    console.log("Automation sync, push, deploy, and verification completed.");
  } catch (error) {
    appendEvent({
      ...baseEvent,
      status: "error",
      completedAt: new Date().toISOString(),
      summary: "Automation run failed before completion.",
      error: formatError(error),
    });
    publishFailureEventLog();
    console.error("Automation sync failed.");
    console.error(formatError(error));
    process.exit(1);
  }
}

main();
