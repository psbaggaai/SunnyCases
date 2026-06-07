#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_DIR = path.resolve(process.cwd());
const INDEX_PATH = path.join(REPO_DIR, "index.html");
const COURT_URL = "https://mphc.gov.in/case-status";

const CASE_CONFIGS = [
  {
    id: "wp-13441-2024",
    caseTypeName: "WP",
    caseTypeValue: "11",
    caseNo: "13441",
    year: "2024",
    displayTitle: "Prabhjit Singh Bagga and others vs The State of Madhya Pradesh and others",
  },
  {
    id: "mcrc-3868-2025",
    caseTypeName: "MCRC",
    caseTypeValue: "52",
    caseNo: "3868",
    year: "2025",
    displayTitle: "Prabhjit Singh Bagga vs Kartar Kaur Chhabra",
  },
];

function runCurl(args) {
  return execFileSync("curl", ["-sS", ...args], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

function runCurlBinary(args) {
  return execFileSync("curl", ["-sS", ...args], { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
}

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
  fs.writeFileSync(pdfPath, runCurlBinary(["-L", pdfUrl]));

  let text = "";
  try {
    text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return "Order available for download.";
  } finally {
    fs.rmSync(pdfPath, { force: true });
  }

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

function parseSearchRow(searchHtml, caseCode) {
  const rowMatch = searchHtml.match(new RegExp(`<a[^>]+data-cino="([^"]+)"[^>]*>\\s*${caseCode.replace("/", "\\/")}\\s*<\\/a>[\\s\\S]*?<td>([\\s\\S]*?)<\\/td>[\\s\\S]*?<td>([\\s\\S]*?)<\\/td>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>`, "i"));
  if (!rowMatch) return null;
  return {
    filNo: rowMatch[1],
    titleText: stripTags(rowMatch[2]).replace(/\s+vs\s+/i, " vs "),
    bench: stripTags(rowMatch[3]),
    status: stripTags(rowMatch[4]),
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

function buildCaseObject(config, parsed, tmpDir) {
  const cookiePath = path.join(tmpDir, "cookies.txt");
  const initialHtml = runCurl(["-c", cookiePath, "-b", cookiePath, COURT_URL]);
  const csrfToken = (initialHtml.match(/name="_token" value="([^"]+)"/) || [])[1];
  if (!csrfToken) throw new Error(`Unable to fetch CSRF token for ${config.id}`);

  const searchHtml = runCurl([
    "-c",
    cookiePath,
    "-b",
    cookiePath,
    "-L",
    COURT_URL,
    "-H",
    "Content-Type: application/x-www-form-urlencoded",
    "-H",
    "X-Requested-With: XMLHttpRequest",
    "--data",
    `_token=${csrfToken}&branch=01&case_type=${config.caseTypeValue}&case_no=${config.caseNo}&year_registration=${config.year}`,
  ]);

  const row = parseSearchRow(searchHtml, `${config.caseTypeName}/${config.caseNo}/${config.year}`);
  if (!row?.filNo) throw new Error(`Unable to find row for ${config.id}`);

  const modalJson = JSON.parse(
    runCurl([
      "-c",
      cookiePath,
      "-b",
      cookiePath,
      `${COURT_URL}-modal`,
      "-H",
      "Content-Type: application/x-www-form-urlencoded; charset=UTF-8",
      "-H",
      `X-CSRF-TOKEN: ${csrfToken}`,
      "-H",
      "X-Requested-With: XMLHttpRequest",
      "--data",
      `fil_no=${row.filNo}`,
    ])
  );

  const modal = parseModalPage(modalJson.page || "");

  const tabNames = ["listing", "judgement", "document", "notices", "connected", "ecourt", "ia"];
  const tabs = Object.fromEntries(
    tabNames.map((tab) => {
      const response = JSON.parse(
        runCurl([
          "-c",
          cookiePath,
          "-b",
          cookiePath,
          `${COURT_URL}-tab`,
          "-H",
          "Content-Type: application/x-www-form-urlencoded; charset=UTF-8",
          "-H",
          `X-CSRF-TOKEN: ${csrfToken}`,
          "-H",
          "X-Requested-With: XMLHttpRequest",
          "--data",
          `tab_data=${tab}&fil_no=${row.filNo}`,
        ])
      );
      return [tab, response.page || ""];
    })
  );

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

  const noticesSummary = noticesRows.length
    ? noticesRows.map((rowCells) => `Notice entry: ${rowCells.filter(Boolean).join(" | ")}`)
    : ["No notices are currently shown on the public record."];

  const ecourtRows = parseTableRows(tabs.ecourt);
  const ecourtSummary =
    ecourtRows.length > 0
      ? ecourtRows.map((cells) => `${cells[0]}: ${cells[1] || "—"}`).join(" / ")
      : "No earlier-court linkage shown.";

  const latestDocument = documentRows[documentRows.length - 1] || [];
  const nextVisibleDate = deriveNextVisibleDate(listingRows);

  const pendingIaRows = iaRows.filter((rowCells) => /Pending/i.test(rowCells[rowCells.length - 1] || ""));

  return {
    id: config.id,
    code: `${config.caseTypeName}/${config.caseNo}/${config.year}`,
    type: modal.type || config.caseTypeName,
    title: config.displayTitle || row.titleText,
    bench: modal.bench || row.bench,
    status: modal.status || row.status || "Pending",
    statusTone: "pending",
    stage: modal.stage || "",
    stageDetail: modal.stageDetail || "",
    filedOn: modal.filedOn || "",
    lastListedOn: modal.lastListedOn || "",
    nextVisibleDate,
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
      ["Status", modal.status || "—"],
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
        note:
          latestDocument.length > 0
            ? `${latestDocument[1]} filed by ${latestDocument[2] || "unknown advocate"}`
            : "No filing history found",
        accent: "#5b8dee",
      },
    ],
    nextSteps: [
      nextVisibleDate === "No next date visible"
        ? `No future hearing date is visible on the public record, so the immediate next step appears to be relisting at ${modal.stage || "the current stage"}.`
        : `The next visible date on the public record is ${nextVisibleDate}.`,
      modal.before ? `The matter is currently shown before ${modal.before}.` : "The current coram is not clearly shown on the public record.",
      pendingIaRows.length
        ? `${pendingIaRows.length} IA(s) remain pending, including ${pendingIaRows
            .slice(0, 3)
            .map((rowCells) => rowCells[1])
            .filter(Boolean)
            .join(", ")}.`
        : "No pending IAs are currently shown on the public record.",
      judgementRows[0]
        ? `The latest downloadable order currently listed is dated ${judgementRows[0].date}.`
        : "No downloadable order is currently listed on the public record.",
    ],
    listingTimeline: formatRowsForTimeline(listingRows),
    orderHighlights,
    pendingIAs: pendingIaRows.map((rowCells) => [rowCells[0], rowCells[1], rowCells[2], rowCells[3]]),
    ordersArchive: judgementRows.map((entry) => [entry.date, entry.link]),
    documents: documentRows.map((rowCells) => [rowCells[0], rowCells[1], rowCells[2], rowCells[3]]),
    serviceInfo: [...noticesSummary, `Connected cases summary: ${stripTags(tabs.connected) || "Main case only."}`, `Earlier court summary: ${ecourtSummary}`],
    petitioners: modal.petitioners,
    petitionerAdvocates: modal.petitionerAdvocates,
    respondents: modal.respondents,
    respondentAdvocates: modal.respondentAdvocates,
  };
}

function replaceCasesData(indexHtml, cases) {
  const replacement = `const cases = ${JSON.stringify(cases, null, 8)};`;
  return indexHtml.replace(/const cases = \[[\s\S]*?\n      \];\n\n      const translations =/, `${replacement}\n\n      const translations =`);
}

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bagga-case-sync-"));
  try {
    const cases = CASE_CONFIGS.map((config) => buildCaseObject(config, {}, tmpDir));
    const currentHtml = fs.readFileSync(INDEX_PATH, "utf8");
    const nextHtml = replaceCasesData(currentHtml, cases);
    fs.writeFileSync(INDEX_PATH, nextHtml);
    console.log(`Updated ${INDEX_PATH} with ${cases.length} case records.`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
