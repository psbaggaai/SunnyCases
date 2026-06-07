#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_DIR = path.resolve(process.cwd());
const INDEX_PATH = path.join(REPO_DIR, "index.html");
const CASES_PATH = path.join(REPO_DIR, "cases.html");
const DOCUMENTS_PATH = path.join(REPO_DIR, "documents.html");
const ORDERS_PATH = path.join(REPO_DIR, "orders.html");
const SETTINGS_PATH = path.join(REPO_DIR, "settings.html");
const COURT_URL = "https://mphc.gov.in/case-status";

const CASE_CONFIGS = [
  {
    id: "wp-13441-2024",
    caseTypeName: "WP",
    caseNo: "13441",
    year: "2024",
    displayTitle: "Prabhjit Singh Bagga and others vs The State of Madhya Pradesh and others",
  },
  {
    id: "mcrc-3868-2025",
    caseTypeName: "MCRC",
    caseNo: "3868",
    year: "2025",
    displayTitle: "Prabhjit Singh Bagga vs Kartar Kaur Chhabra",
  },
];

function decodeHtml(value) {
  return value
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>|<\/p>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function matchText(html, pattern, fallback = "") {
  const match = html.match(pattern);
  return match ? stripTags(match[1]) : fallback;
}

function collectMatches(html, pattern) {
  return Array.from(html.matchAll(pattern)).map((m) => stripTags(m[1])).filter(Boolean);
}

function parseListItems(html) {
  return Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)).map((m) => stripTags(m[1])).filter(Boolean);
}

function parseTableRows(html) {
  return Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((row) =>
      Array.from(row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
        .map((cell) => stripTags(cell[1]))
        .filter(Boolean)
    )
    .filter((cells) => cells.length > 0);
}

function ensurePdftotext() {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canExtractPdf = ensurePdftotext();

function extractOrderSummary(pdfUrl, tmpDir) {
  if (!canExtractPdf || !pdfUrl) return "Order available for download.";
  const pdfPath = path.join(tmpDir, `order-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const pdfBuffer = execFileSync("curl", ["-sS", "-L", pdfUrl], { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
  fs.writeFileSync(pdfPath, pdfBuffer);
  try {
    const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    const cleaned = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^IN THE HIGH COURT/i.test(line))
      .filter((line) => !/^AT INDORE/i.test(line))
      .filter((line) => !/^Dated\s*:/i.test(line))
      .filter((line) => !/^Signature Not Verified/i.test(line))
      .filter((line) => !/^Signed by:/i.test(line))
      .filter((line) => !/^Signing time:/i.test(line))
      .filter((line) => !/^\(.*JUDGE.*\)$/i.test(line))
      .filter((line) => !/^(WP|MCRC)\s+No\./i.test(line))
      .filter((line) => !/^\d+$/.test(line));

    const joined = cleaned.join(" ");
    const sentences = joined
      .split(/(?<=[.])\s+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^Shri /i.test(line));

    return sentences.slice(0, 2).join(" ") || "Order available for download.";
  } catch {
    return "Order available for download.";
  } finally {
    fs.rmSync(pdfPath, { force: true });
  }
}

function parseModalPage(pageHtml) {
  const petitionersSection = pageHtml.match(/Petitioner\(s\)([\s\S]*?)card-footer/);
  const respondentsSection = pageHtml.match(/Respondent\(s\)([\s\S]*?)card-footer/);

  return {
    type: matchText(pageHtml, /<div class="fw-bold"[^>]*>\s*([\s\S]*?)<span class="fw-normal/),
    status: matchText(pageHtml, /bi-hourglass-split[^>]*><\/i>\s*([^<]+)</),
    cnr: matchText(pageHtml, /CNR:\s*([^<]+)/),
    bench: matchText(pageHtml, /bi-building[^>]*><\/i>\s*([^<]+)/),
    filedOn: matchText(pageHtml, /Filed On<\/div>\s*<div class="fw-bold mt-1">([\s\S]*?)<\/div>/),
    lastListedOn: matchText(pageHtml, /Last Listed On<\/div>\s*<div class="fw-bold mt-1 text-info">\s*([\s\S]*?)<\/div>/),
    lastOrderLabel: matchText(pageHtml, /Last Order<\/div>\s*<div class="fw-bold mt-1">([\s\S]*?)<\/div>/),
    stage: matchText(pageHtml, /Stage<\/div>\s*<div class="fw-bold text-success mt-1">([\s\S]*?)<\/div>/),
    stageDetail: matchText(pageHtml, /Stage<\/div>[\s\S]*?<div class="fw-bold mt-1 text-dark-emphasis small">([\s\S]*?)<\/div>/),
    before: matchText(pageHtml, /Before :<\/span>\s*<span class="fw-semibold text-success ms-1">([\s\S]*?)<\/span>/),
    da: matchText(pageHtml, /DA :<\/span>\s*<span class="fw-semibold ms-1">([\s\S]*?)<\/span>/),
    statutory: matchText(pageHtml, /Statutory :<\/span>\s*<span class="fw-semibold text-success-emphasis ms-1">([\s\S]*?)<\/span>/),
    district: matchText(pageHtml, /District:<\/strong>\s*([^<]+)/),
    category: matchText(pageHtml, /Category:<\/strong>\s*([\s\S]*?)<\/div>/),
    petitioners: petitionersSection ? collectMatches(petitionersSection[1], /<div class="fw-semibold"[^>]*>([\s\S]*?)<\/div>/gi) : [],
    petitionerAdvocates: petitionersSection ? collectMatches(petitionersSection[1], /<span class="badge[^>]*>([\s\S]*?)<\/span>/gi) : [],
    respondents: respondentsSection ? collectMatches(respondentsSection[1], /<div class="fw-semibold"[^>]*>([\s\S]*?)<\/div>/gi) : [],
    respondentAdvocates: respondentsSection ? collectMatches(respondentsSection[1], /<span class="badge[^>]*>([\s\S]*?)<\/span>/gi) : [],
  };
}

function deriveNextVisibleDate(listingRows) {
  const today = new Date();
  for (const row of listingRows) {
    const [dateText] = row;
    const parsed = new Date(dateText.split("-").reverse().join("-"));
    if (!Number.isNaN(parsed.getTime()) && parsed >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      return dateText.replace(/-/g, " ");
    }
  }
  return "No next date visible";
}

function formatRowsForTimeline(rows) {
  return rows.map((row) => ({
    date: row[0]?.replace(/-/g, " ") || "",
    coram: row[1] || "",
    purpose: row[2] || "",
    note: row[3] || "",
  }));
}

async function scrapeCase(page, config, tmpDir) {
  await page.goto(COURT_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#case_status_form", { timeout: 60000 });
  await page.selectOption("#case_type", { label: config.caseTypeName });
  await page.fill("#case_no", config.caseNo);
  await page.selectOption("#year_registration", config.year);
  await page.getByRole("button", { name: /search/i }).first().click();

  const rowLink = page.locator("a.get_data", { hasText: `${config.caseTypeName}/${config.caseNo}/${config.year}` }).first();
  await rowLink.waitFor({ timeout: 60000 });

  const filNo = await rowLink.getAttribute("data-cino");
  const rowHandle = await rowLink.locator("xpath=ancestor::tr").elementHandle();
  const rowTexts = rowHandle ? await rowHandle.$$eval("td", (cells) => cells.map((cell) => cell.textContent?.trim() || "")) : [];

  await rowLink.click();
  await page.locator("#caseDetailModalBody").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  const modalHtml = await page.locator("#caseDetailModalBody").innerHTML();
  const modal = parseModalPage(modalHtml);

  const tabNames = ["listing", "judgement", "document", "notices", "connected", "ecourt", "ia"];
  const tabs = {};
  for (const tab of tabNames) {
    const button = page.locator(`#modalCaseTabs button[data-link-type="${tab}"]`);
    if ((await button.count()) === 0) {
      tabs[tab] = "";
      continue;
    }
    await button.click();
    const pane = page.locator(`#modal_${tab}`);
    await page.waitForTimeout(1200);
    tabs[tab] = await pane.innerHTML();
  }

  const listingRows = parseTableRows(tabs.listing).slice(1);
  const iaRows = parseTableRows(tabs.ia).slice(1);
  const documentRows = parseTableRows(tabs.document).slice(1);
  const noticesRows = parseTableRows(tabs.notices).slice(1);
  const judgementRows = parseListItems(tabs.judgement)
    .map((text, index) => {
      const linkMatch = Array.from(tabs.judgement.matchAll(/href="([^"]+)"/g))[index];
      const dateMatch = text.match(/^(\d{2}-\d{2}-\d{4})/);
      return {
        date: dateMatch ? dateMatch[1].replace(/-/g, " ") : text,
        rawDate: dateMatch ? dateMatch[1] : "",
        link: linkMatch ? decodeHtml(linkMatch[1]) : "",
      };
    })
    .filter((entry) => entry.link);

  const orderHighlights = judgementRows.slice(0, 3).map((entry) => ({
    date: entry.date,
    summary: extractOrderSummary(entry.link, tmpDir),
  }));

  const pendingIaRows = iaRows.filter((rowCells) => /Pending/i.test(rowCells[rowCells.length - 1] || ""));
  const latestDocument = documentRows[documentRows.length - 1] || [];
  const noticesSummary = noticesRows.length
    ? noticesRows.map((cells) => `Notice entry: ${cells.filter(Boolean).join(" | ")}`)
    : ["No notices are currently shown on the public record."];
  const ecourtSummary =
    parseTableRows(tabs.ecourt)
      .map((cells) => `${cells[0]}: ${cells[1] || "—"}`)
      .join(" / ") || "No earlier-court linkage shown.";

  const bench = modal.bench || rowTexts[2] || "Indore";
  const status = modal.status || rowTexts[3] || "Pending";

  return {
    id: config.id,
    code: `${config.caseTypeName}/${config.caseNo}/${config.year}`,
    type: modal.type || config.caseTypeName,
    title: config.displayTitle || rowTexts[1] || "",
    bench,
    courtLocation: "MP High Court",
    status,
    statusTone: /pending/i.test(status) ? "pending" : "clear",
    stage: modal.stage || "",
    stageDetail: modal.stageDetail || "",
    filedOn: modal.filedOn || "",
    lastListedOn: modal.lastListedOn || "",
    nextVisibleDate: deriveNextVisibleDate(listingRows),
    lastOrderLabel: modal.lastOrderLabel || "",
    before: modal.before || "",
    da: modal.da || "",
    cnr: modal.cnr || "",
    sourceUrl: COURT_URL,
    partiesSummary: `${modal.petitioners.length} petitioner(s), ${modal.respondents.length} respondent(s), ${pendingIaRows.length} pending IA(s)`,
    category: modal.category || "",
    district: modal.district || "",
    statutory: modal.statutory || "",
    quickFacts: [
      ["Before", modal.before || "—"],
      ["Stage", modal.stage || "—"],
      ["Status", status || "—"],
      ["CNR", modal.cnr || "—"],
      ["District shown in record", modal.district || "—"],
      ["Category", modal.category || "—"],
      ["Earlier court reference", ecourtSummary || "—"],
    ],
    metrics: [
      {
        label: "Last listed",
        value: modal.lastListedOn || "—",
        note: "Most recent listing date on the public case page",
        accent: "#d86c63",
      },
      {
        label: "Pending IAs",
        value: String(pendingIaRows.length),
        note: pendingIaRows.length ? "Applications still marked pending" : "No pending applications are shown",
        accent: "#c89a37",
      },
      {
        label: "Orders online",
        value: String(judgementRows.length),
        note: judgementRows.length ? "Downloadable judgement/order entries" : "No online orders were found",
        accent: "#73b35c",
      },
      {
        label: "Latest filing",
        value: latestDocument[3] ? latestDocument[3].split(" ").slice(0, 3).join(" ") : "—",
        note: latestDocument.length > 0 ? `${latestDocument[1]} filed by ${latestDocument[2] || "unknown advocate"}` : "No filing history found",
        accent: "#5b8dee",
      },
    ],
    nextSteps: [
      deriveNextVisibleDate(listingRows) === "No next date visible"
        ? `No future hearing date is visible on the public record, so the immediate next step appears to be relisting at ${modal.stage || "the current stage"}.`
        : `The next visible date on the public record is ${deriveNextVisibleDate(listingRows)}.`,
      modal.before ? `The matter is currently shown before ${modal.before}.` : "The current coram is not clearly shown on the public record.",
      pendingIaRows.length
        ? `${pendingIaRows.length} IA(s) remain pending, including ${pendingIaRows
            .slice(0, 3)
            .map((cells) => cells[1])
            .filter(Boolean)
            .join(", ")}.`
        : "No pending IAs are currently shown on the public record.",
      judgementRows[0] ? `The latest downloadable order currently listed is dated ${judgementRows[0].date}.` : "No downloadable order is currently listed on the public record.",
    ],
    listingTimeline: formatRowsForTimeline(listingRows),
    orderHighlights,
    pendingIAs: pendingIaRows.map((cells) => [cells[0], cells[1], cells[2], cells[3]]),
    ordersArchive: judgementRows.map((entry) => [entry.date, entry.link]),
    documents: documentRows.map((cells) => [cells[0], cells[1], cells[2], cells[3]]),
    serviceInfo: [...noticesSummary, `Connected cases summary: ${stripTags(tabs.connected) || "Main case only."}`, `Earlier court summary: ${ecourtSummary}`],
    petitioners: modal.petitioners,
    petitionerAdvocates: modal.petitionerAdvocates,
    respondents: modal.respondents,
    respondentAdvocates: modal.respondentAdvocates,
    filNo,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function extractCasesData(html) {
  const match = html.match(/const cases = ([\s\S]*?);\n\n      const translations =/);
  if (!match) throw new Error("Unable to locate cases data block.");
  return Function(`"use strict"; return ${match[1]};`)();
}

function mergeRefreshedCases(existingCases, refreshedCases) {
  const refreshedById = new Map(refreshedCases.map((item) => [item.id, item]));
  const merged = existingCases.map((existing) => {
    const fresh = refreshedById.get(existing.id);
    if (!fresh) return existing;
    refreshedById.delete(existing.id);
    return {
      ...existing,
      ...fresh,
      courtLocation: existing.courtLocation || fresh.courtLocation || "MP High Court",
      dashletSummary: existing.dashletSummary || fresh.dashletSummary || fresh.stage,
      petitionerLine: existing.petitionerLine || fresh.petitionerLine || "",
      summaryLines: existing.summaryLines || fresh.summaryLines || [],
    };
  });

  return [...merged, ...refreshedById.values()];
}

function replaceCasesData(html, cases) {
  const replacement = `const cases = ${JSON.stringify(cases, null, 8)};`;
  const next = html.replace(/const cases = [\s\S]*?;\n\n      const translations =/, `${replacement}\n\n      const translations =`);
  if (next === html) throw new Error("Unable to replace cases data block.");
  return next;
}

function extractCasesDataBlock(html) {
  const match = html.match(/const cases = [\s\S]*?;\n\n      const translations =/);
  if (!match) throw new Error("Unable to locate cases data block.");
  return match[0].replace(/\n\n      const translations =$/, "");
}

function replaceCasesDataBlock(html, sourceHtml) {
  const replacement = extractCasesDataBlock(sourceHtml);
  const next = html.replace(/const cases = [\s\S]*?;\n\n      const translations =/, `${replacement}\n\n      const translations =`);
  if (next === html) throw new Error("Unable to replace cases data block.");
  return next;
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

function replaceLastUpdated(html, isoTimestamp, label) {
  let next = html;
  if (/const siteLastUpdatedAt = "([^"]*)";/.test(next)) {
    next = next.replace(/const siteLastUpdatedAt = "([^"]*)";/, `const siteLastUpdatedAt = "${isoTimestamp}";`);
  }
  next = next.replace(
    /(<div class="last-updated-chip"[^>]*data-last-updated[^>]*>)[\s\S]*?(<\/div>)/g,
    (_match, open, close) => `${open}Last updated: ${escapeHtml(label)}${close}`
  );
  return next;
}

function replaceBetweenMarkers(html, startMarker, endMarker, content) {
  const pattern = new RegExp(`(\\s*<!-- ${startMarker} -->)[\\s\\S]*?(\\s*<!-- ${endMarker} -->)`);
  const next = html.replace(pattern, `$1\n${content}\n$2`);
  if (next === html) throw new Error(`Unable to replace generated section between ${startMarker} and ${endMarker}.`);
  return next;
}

function buildDocumentEntries(cases) {
  return cases.flatMap((item) =>
    (item.documents || []).map((document) => ({
      caseCode: item.code,
      caseTitle: item.title,
      documentNo: document[0] || "—",
      documentType: document[1] || "Document",
      filedBy: document[2] || "—",
      filedOn: document[3] || "—",
    }))
  );
}

function buildDocumentRows(entries) {
  if (entries.length === 0) {
    return `        <div class="empty">No document records are currently stored.</div>`;
  }

  return entries
    .map(
      (entry) => `        <article class="row">
          <div><div class="case-code">${escapeHtml(entry.caseCode)}</div><div class="muted">${escapeHtml(entry.caseTitle)}</div></div>
          <div><div class="label">Document</div><div class="value">${escapeHtml(entry.documentNo)}</div></div>
          <div><div class="label">Type / Filed By</div><div class="value">${escapeHtml(String(entry.documentType).toUpperCase())}</div><div class="muted">${escapeHtml(String(entry.filedBy).toUpperCase())}</div></div>
          <div><div class="label">Filed On</div><div class="value">${escapeHtml(entry.filedOn)}</div></div>
        </article>`
    )
    .join("\n");
}

function normalizeOrderDate(date) {
  return String(date || "").trim().replace(/-/g, " ").replace(/\s+/g, " ");
}

function buildOrderEntries(cases) {
  return cases.flatMap((item) => {
    const archivedOrders = item.ordersArchive || [];
    const highlights = item.orderHighlights || [];
    const highlightsByDate = new Map(highlights.map((order) => [normalizeOrderDate(order.date).toLowerCase(), order.summary || "Court order or judgment noted in the public record."]));
    const archivedDates = new Set();

    const archiveEntries = archivedOrders.map((order) => {
      const date = normalizeOrderDate(order[0]);
      archivedDates.add(date.toLowerCase());
      return {
        caseCode: item.code,
        caseTitle: item.title,
        date,
        note: highlightsByDate.get(date.toLowerCase()) || "Downloadable court order or judgment from the public case record.",
        link: order[1] || item.sourceUrl || "",
        linkLabel: order[1] ? "Download" : "Open source",
      };
    });

    const highlightEntries = highlights
      .filter((order) => !archivedDates.has(normalizeOrderDate(order.date).toLowerCase()))
      .map((order) => ({
        caseCode: item.code,
        caseTitle: item.title,
        date: normalizeOrderDate(order.date),
        note: order.summary || "Court order or judgment noted in the public record.",
        link: item.sourceUrl || "",
        linkLabel: item.sourceUrl ? "Open source" : "Source note",
      }));

    return [...archiveEntries, ...highlightEntries];
  });
}

function buildOrderRows(entries) {
  if (entries.length === 0) {
    return `        <div class="empty">No order or judgment records are currently stored.</div>`;
  }

  return entries
    .map((entry) => {
      const action = entry.link
        ? `<a class="button-link" href="${escapeHtml(entry.link)}" target="_blank" rel="noreferrer">${escapeHtml(entry.linkLabel)}</a>`
        : `<span class="button-link">${escapeHtml(entry.linkLabel)}</span>`;
      return `        <article class="row orders">
          <div><div class="case-code">${escapeHtml(entry.caseCode)}</div><div class="muted">${escapeHtml(entry.caseTitle)}</div></div>
          <div><div class="label">Date</div><div class="value">${escapeHtml(entry.date || "—")}</div></div>
          <div><div class="label">Order / Judgment Note</div><div class="value">${escapeHtml(entry.note)}</div></div>
          ${action}
        </article>`;
    })
    .join("\n");
}

function updateCasesPage(cases, isoTimestamp, label, sourceHtml = "") {
  const currentHtml = fs.readFileSync(CASES_PATH, "utf8");
  const withCases = sourceHtml ? replaceCasesDataBlock(currentHtml, sourceHtml) : replaceCasesData(currentHtml, cases);
  const nextHtml = replaceLastUpdated(withCases, isoTimestamp, label);
  fs.writeFileSync(CASES_PATH, nextHtml);
}

function updateDocumentsPage(cases, isoTimestamp, label) {
  const entries = buildDocumentEntries(cases);
  let html = fs.readFileSync(DOCUMENTS_PATH, "utf8");
  html = replaceLastUpdated(html, isoTimestamp, label);
  html = html.replace(
    /(<h2>All Documents<\/h2>\s*)<p>[\s\S]*?<\/p>/,
    `$1<p>${entries.length} filing, diary, and source ${entries.length === 1 ? "record" : "records"} collected across ${cases.length} tracked cases.</p>`
  );
  html = replaceBetweenMarkers(html, "documents-start", "documents-end", buildDocumentRows(entries));
  fs.writeFileSync(DOCUMENTS_PATH, html);
}

function updateOrdersPage(cases, isoTimestamp, label) {
  const entries = buildOrderEntries(cases);
  let html = fs.readFileSync(ORDERS_PATH, "utf8");
  html = replaceLastUpdated(html, isoTimestamp, label);
  html = html.replace(
    /(<h2>Orders and Judgments<\/h2>\s*)<p>[\s\S]*?<\/p>/,
    `$1<p>${entries.length} order, judgment, or source ${entries.length === 1 ? "record" : "records"} collected across ${cases.length} tracked cases.</p>`
  );
  html = replaceBetweenMarkers(html, "orders-start", "orders-end", buildOrderRows(entries));
  fs.writeFileSync(ORDERS_PATH, html);
}

function updateStaticTimestampPages(isoTimestamp, label) {
  for (const filePath of [SETTINGS_PATH]) {
    const html = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, replaceLastUpdated(html, isoTimestamp, label));
  }
}

function updateDerivedPages(cases, isoTimestamp, label, sourceHtml = "") {
  updateCasesPage(cases, isoTimestamp, label, sourceHtml);
  updateDocumentsPage(cases, isoTimestamp, label);
  updateOrdersPage(cases, isoTimestamp, label);
  updateStaticTimestampPages(isoTimestamp, label);
}

function renderFromExistingData() {
  const currentHtml = fs.readFileSync(INDEX_PATH, "utf8");
  const cases = extractCasesData(currentHtml);
  const runDate = new Date();
  const runIso = runDate.toISOString();
  const runLabel = formatRunTimestamp(runDate);
  const nextHtml = replaceLastUpdated(currentHtml, runIso, runLabel);
  fs.writeFileSync(INDEX_PATH, nextHtml);
  updateDerivedPages(cases, runIso, runLabel, nextHtml);
  console.log(`Rendered derived tracker pages from ${cases.length} existing case record(s).`);
}

async function main() {
  const { chromium } = await import("playwright");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bagga-playwright-sync-"));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 2200 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  try {
    const refreshedCases = [];
    const failures = [];
    for (const config of CASE_CONFIGS) {
      try {
        const caseData = await scrapeCase(page, config, tmpDir);
        refreshedCases.push(caseData);
      } catch (error) {
        failures.push(`${config.id}: ${error.message}`);
        console.error(`Unable to refresh ${config.id}; preserving existing tracker data.`);
        console.error(error);
      }
    }

    if (refreshedCases.length === 0 && failures.length > 0) {
      throw new Error(`No live MP High Court case data could be refreshed: ${failures.join("; ")}`);
    }

    const currentHtml = fs.readFileSync(INDEX_PATH, "utf8");
    const existingCases = extractCasesData(currentHtml);
    const cases = mergeRefreshedCases(existingCases, refreshedCases);
    const runDate = new Date();
    const runIso = runDate.toISOString();
    const runLabel = formatRunTimestamp(runDate);
    const nextHtml = replaceLastUpdated(replaceCasesData(currentHtml, cases), runIso, runLabel);
    fs.writeFileSync(INDEX_PATH, nextHtml);
    updateDerivedPages(cases, runIso, runLabel, nextHtml);
    console.log(`Refreshed ${refreshedCases.length} MP High Court case(s), preserved ${cases.length - refreshedCases.length} existing case(s), and updated tracker timestamps.`);
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (process.argv.includes("--render-only")) {
  renderFromExistingData();
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
