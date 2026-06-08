#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE_PATH = path.join(ROOT, "sunny-cases.html");
const EVENT_DATA_PATH = path.join(ROOT, "automation-events.json");
const MAX_BODY_BYTES = Number(process.env.SUNNY_SOURCE_MAX_BODY_BYTES || 5 * 1024 * 1024);
const REQUEST_TIMEOUT_MS = Number(process.env.SUNNY_SOURCE_TIMEOUT_MS || 45000);
const MAX_EVENTS = Number(process.env.SUNNY_MAX_AUTOMATION_EVENTS || 160);
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 SunnyCaseTracker/1.0";

const OFFICIAL_SOURCE_PROBES = [
  {
    label: "SCI case status by diary number",
    url: "https://www.sci.gov.in/case-status-diary-no/",
    kind: "official-sci-captcha-form",
  },
  {
    label: "SCI case status by case number",
    url: "https://www.sci.gov.in/case-status-case-no/",
    kind: "official-sci-captcha-form",
  },
  {
    label: "SCI case status by AOR code",
    url: "https://www.sci.gov.in/case-status-aor-code/",
    kind: "official-sci-captcha-form",
  },
  {
    label: "SCI daily orders by case number",
    url: "https://www.sci.gov.in/daily-order-case-no/",
    kind: "official-sci-captcha-form",
  },
  {
    label: "SCI judgments by case number",
    url: "https://www.sci.gov.in/judgements-case-no/",
    kind: "official-sci-captcha-form",
  },
  {
    label: "SCI office reports by case number",
    url: "https://www.sci.gov.in/office-report-case-no/",
    kind: "official-sci-captcha-form",
  },
  {
    label: "SCI cause list",
    url: "https://www.sci.gov.in/cause-list/",
    kind: "official-sci-public-page",
  },
  {
    label: "SCI e-SCR",
    url: "https://scr.sci.gov.in/",
    kind: "official-sci-public-page",
  },
  {
    label: "eCourts judgments portal",
    url: "https://judgments.ecourts.gov.in/",
    kind: "official-ecourts-public-page",
  },
];

const SIGNATURE_FIELDS = [
  "status",
  "finalUrl",
  "contentType",
  "lastModified",
  "etag",
  "sourceFingerprint",
  "title",
  "heading",
  "captchaDetected",
];

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function extractCases(source) {
  const match = source.match(/const cases = (\[[\s\S]*?\n\s*\]);\n\n\s*const (?:aiInsights|translations)/);
  if (!match) throw new Error("Unable to find Sunny case data in sunny-cases.html.");
  return Function(`return ${match[1]}`)();
}

function hashId(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function cleanText(value, maxLength = 500) {
  const text = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function stripHtml(value, maxLength = 900) {
  return cleanText(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
    maxLength
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ");
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(decodeHtmlEntities(stripHtml(match[1], 160)), 160) : "";
}

function extractHeading(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  return match ? cleanText(decodeHtmlEntities(stripHtml(match[1], 160)), 160) : "";
}

function extractDateHints(text) {
  const matches = new Set();
  const patterns = [
    /\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b/g,
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      matches.add(cleanText(match[0], 80));
      if (matches.size >= 8) return Array.from(matches);
    }
  }
  return Array.from(matches);
}

function stableFingerprint(value) {
  const stableText = cleanText(value, 12000)
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b/g, "<date>")
    .replace(
      /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi,
      "<date>"
    )
    .replace(
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
      "<date>"
    )
    .replace(/\bLast Updated:\s*<date>/gi, "Last Updated: <date>");
  return crypto.createHash("sha256").update(stableText).digest("hex");
}

function extractPdfLinks(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) {
    try {
      links.push(new URL(decodeHtmlEntities(match[1]), baseUrl).toString());
    } catch {
      continue;
    }
    if (links.length >= 12) break;
  }
  return Array.from(new Set(links));
}

function canRun(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canExtractPdfText = canRun("pdftotext", ["-v"]);

function extractPdfText(buffer) {
  if (!canExtractPdfText || buffer.length === 0) return { preview: "", fingerprint: "" };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sunny-pdf-"));
  const pdfPath = path.join(tmpDir, "source.pdf");
  try {
    fs.writeFileSync(pdfPath, buffer);
    const text = execFileSync("pdftotext", [pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const cleaned = cleanText(text, 900);
    return {
      preview: cleaned.slice(0, 420),
      fingerprint: crypto.createHash("sha256").update(cleaned.slice(0, 3000)).digest("hex"),
    };
  } catch {
    return { preview: "", fingerprint: "" };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function buildMonitorTargets(cases) {
  const targets = new Map();

  function addTarget(url, detail) {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    const current = targets.get(normalized) || {
      url: normalized,
      label: detail.label || normalized,
      kind: detail.kind || "case-source",
      cases: [],
    };
    current.kind = current.kind || detail.kind;
    if (detail.caseId && !current.cases.some((item) => item.id === detail.caseId)) {
      current.cases.push({
        id: detail.caseId,
        code: detail.caseCode,
        title: detail.caseTitle,
      });
    }
    targets.set(normalized, current);
  }

  for (const probe of OFFICIAL_SOURCE_PROBES) {
    addTarget(probe.url, { label: probe.label, kind: probe.kind });
  }

  for (const item of cases) {
    addTarget(item.sourceUrl, {
      label: `${item.code} source`,
      kind: "case-source",
      caseId: item.id,
      caseCode: item.code,
      caseTitle: item.title,
    });

    for (const [date, link] of item.ordersArchive || []) {
      addTarget(link, {
        label: `${item.code} order ${date}`,
        kind: "case-order-pdf",
        caseId: item.id,
        caseCode: item.code,
        caseTitle: item.title,
      });
    }
  }

  return Array.from(targets.values());
}

async function readLimitedBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return { buffer: Buffer.alloc(0), bytesRead: 0, truncated: false };

  const chunks = [];
  let bytesRead = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (bytesRead + chunk.length > MAX_BODY_BYTES) {
      const keep = Math.max(0, MAX_BODY_BYTES - bytesRead);
      if (keep > 0) chunks.push(chunk.subarray(0, keep));
      bytesRead += keep;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(chunk);
    bytesRead += chunk.length;
  }

  return { buffer: Buffer.concat(chunks), bytesRead, truncated };
}

async function fetchSource(target) {
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(target.url, {
      headers: {
        Accept: "text/html,application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const { buffer, bytesRead, truncated } = await readLimitedBody(response);
    const contentType = response.headers.get("content-type") || "";
    const textDecoder = new TextDecoder("utf-8", { fatal: false });
    const isPdf = /pdf/i.test(contentType) || /\.pdf(?:$|\?)/i.test(response.url) || /\.pdf(?:$|\?)/i.test(target.url);
    const isText = /^text\//i.test(contentType) || /json|xml|html|javascript/i.test(contentType);
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    let title = "";
    let heading = "";
    let textPreview = "";
    let pdfTextPreview = "";
    let pdfTextFingerprint = "";
    let sourceFingerprint = "";
    let dateHints = [];
    let discoveredPdfUrls = [];
    let captchaDetected = false;

    if (isPdf) {
      const pdfText = extractPdfText(buffer);
      pdfTextPreview = pdfText.preview;
      pdfTextFingerprint = pdfText.fingerprint;
      sourceFingerprint = pdfTextFingerprint || hash;
      dateHints = extractDateHints(pdfTextPreview);
    } else if (isText || buffer.length > 0) {
      const bodyText = textDecoder.decode(buffer);
      title = extractTitle(bodyText);
      heading = extractHeading(bodyText);
      const fullPlainText = stripHtml(bodyText, 6000);
      textPreview = cleanText(fullPlainText, 700);
      sourceFingerprint = stableFingerprint(fullPlainText);
      dateHints = extractDateHints(fullPlainText);
      discoveredPdfUrls = extractPdfLinks(bodyText, response.url);
      captchaDetected = /captcha|security code|answer to the given captcha/i.test(fullPlainText);
    }

    return {
      checkedAt: new Date().toISOString(),
      startedAt,
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType,
      contentLength: response.headers.get("content-length") || "",
      lastModified: response.headers.get("last-modified") || "",
      etag: response.headers.get("etag") || "",
      bytesRead,
      truncated,
      sha256: hash,
      title,
      heading,
      textPreview,
      pdfTextPreview,
      pdfTextFingerprint,
      sourceFingerprint,
      dateHints,
      discoveredPdfUrls,
      captchaDetected,
      captchaMode: captchaDetected ? "detect-only" : "",
    };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      startedAt,
      ok: false,
      status: "error",
      error: error?.name === "AbortError" ? `Timed out after ${REQUEST_TIMEOUT_MS}ms` : error?.message || String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function changedFields(previous, next) {
  if (!previous) return ["new"];
  const changed = [];
  for (const field of SIGNATURE_FIELDS) {
    const oldValue = JSON.stringify(previous[field] ?? "");
    const newValue = JSON.stringify(next[field] ?? "");
    if (oldValue !== newValue) changed.push(field);
  }
  return changed;
}

function eventForTarget(target, sourceId, previous, next, changes) {
  const caseLabel = target.cases?.[0]?.code ? `${target.cases[0].code}: ` : "";
  const urlHost = new URL(target.url).hostname.replace(/^www\./, "");
  if (!next.ok) {
    return {
      id: `${Date.now()}-${sourceId}-failed`,
      at: next.checkedAt,
      level: "warning",
      sourceId,
      caseId: target.cases?.[0]?.id || "",
      caseCode: target.cases?.[0]?.code || "",
      title: `${caseLabel}source check failed`,
      summary: `${target.label} on ${urlHost} could not be checked: ${next.error || `HTTP ${next.status}`}.`,
      url: target.url,
    };
  }
  if (!previous) {
    return {
      id: `${Date.now()}-${sourceId}-added`,
      at: next.checkedAt,
      level: next.captchaDetected ? "notice" : "info",
      sourceId,
      caseId: target.cases?.[0]?.id || "",
      caseCode: target.cases?.[0]?.code || "",
      title: `${caseLabel}source added to monitor`,
      summary: next.captchaDetected
        ? `${target.label} was checked on ${urlHost}; CAPTCHA was detected and recorded for manual official refresh.`
        : `${target.label} was checked on ${urlHost} and added to the automation baseline.`,
      url: target.url,
    };
  }
  if (changes.length > 0) {
    return {
      id: `${Date.now()}-${sourceId}-changed`,
      at: next.checkedAt,
      level: "change",
      sourceId,
      caseId: target.cases?.[0]?.id || "",
      caseCode: target.cases?.[0]?.code || "",
      title: `${caseLabel}source changed`,
      summary: `${target.label} changed on ${urlHost}. Changed fields: ${changes.slice(0, 6).join(", ")}.`,
      url: target.url,
    };
  }
  return null;
}

async function main() {
  const startedAt = new Date().toISOString();
  const cases = extractCases(readText(SOURCE_PATH));
  const previousData = readJson(EVENT_DATA_PATH, { version: 2, sources: {}, events: [] });
  const previousSources = previousData.sources || {};
  const targets = buildMonitorTargets(cases);
  const nextSources = {};
  const newEvents = [];
  let changedCount = 0;
  let failedCount = 0;
  let captchaCount = 0;

  for (const target of targets) {
    const sourceId = hashId(target.url);
    const previous = previousSources[sourceId]?.lastCheck || null;
    const result = await fetchSource(target);
    const changes = result.ok ? changedFields(previous, result) : [];
    if (result.ok && previous && changes.length > 0) changedCount += 1;
    if (!result.ok) failedCount += 1;
    if (result.captchaDetected) captchaCount += 1;
    const event = eventForTarget(target, sourceId, previous, result, changes);
    if (event) newEvents.push(event);
    nextSources[sourceId] = {
      id: sourceId,
      url: target.url,
      label: target.label,
      kind: target.kind,
      cases: target.cases || [],
      firstSeenAt: previousSources[sourceId]?.firstSeenAt || result.checkedAt,
      lastChangedAt: result.ok && (!previous || changes.length > 0) ? result.checkedAt : previousSources[sourceId]?.lastChangedAt || "",
      lastCheck: result,
    };
  }

  const completedAt = new Date().toISOString();
  const runStatus = failedCount > 0 ? "completed_with_warnings" : "completed";
  const eventData = {
    version: 2,
    updatedAt: completedAt,
    siteBuiltAt: previousData.siteBuiltAt || "",
    captchaPolicy: {
      mode: "detect-only",
      note:
        "The scheduled job detects CAPTCHA-gated official forms and records manual-refresh targets. It does not solve or bypass CAPTCHA challenges.",
    },
    lastRun: {
      startedAt,
      completedAt,
      status: runStatus,
      checkedSources: targets.length,
      changedSources: changedCount,
      failedSources: failedCount,
      captchaSources: captchaCount,
      caseCount: cases.length,
      officialProbeCount: OFFICIAL_SOURCE_PROBES.length,
      notes: [
        "Official SCI case-status, daily-order, judgment, and office-report forms are probed and marked when CAPTCHA is present.",
        "Direct public PDFs and known public source pages are fetched, fingerprinted, and lightly summarized for change detection.",
      ],
    },
    sources: nextSources,
    events: [...newEvents, ...(previousData.events || [])].slice(0, MAX_EVENTS),
  };

  writeJson(EVENT_DATA_PATH, eventData);
  console.log(
    `Sunny source check completed: ${targets.length} sources, ${changedCount} changed, ${failedCount} failed, ${captchaCount} CAPTCHA-gated.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
