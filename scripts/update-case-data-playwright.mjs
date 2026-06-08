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
const EVENT_LOG_PATH = path.join(REPO_DIR, "event-log.html");
const COURT_URL = "https://mphc.gov.in/case-status";
const KHARGONE_COURT_URL = "https://mandleshwar.dcourts.gov.in/case-status-search-by-petitioner-respondent/";
const ECOURTS_CNR_HISTORY_URL = "https://services.ecourts.gov.in/ecourtindia_v6/?p=cnr_status/viewCNRHistory/";
const KHARGONE_REFRESH_ROUTE = "Party Name > Court Establishment > Civil Court Khargone > Kartar > 2024";
const KHARGONE_DISTRICT_CONTEXT = {
  stateCode: "23",
  districtCode: "16",
  courtComplexCode: "1230061",
  courtName: "Civil Court Khargone",
  district: "Mandleshwar / Khargone",
};

const CASE_CONFIGS = [
  {
    id: "wp-13441-2024",
    caseTypeName: "WP",
    caseNo: "13441",
    year: "2024",
    benchName: "Indore",
    displayTitle: "Prabhjit Singh Bagga and others vs The State of Madhya Pradesh and others",
  },
  {
    id: "mcrc-3868-2025",
    caseTypeName: "MCRC",
    caseNo: "3868",
    year: "2025",
    benchName: "Indore",
    partySearchName: "PRABHJIT SINGH BAGGA",
    partySearchYear: "2025",
    displayTitle: "Prabhjit Singh Bagga vs Kartar Kaur Chhabra",
  },
  {
    id: "mcc-178-2025",
    caseTypeName: "MCC",
    caseNo: "178",
    year: "2025",
    benchName: "Indore",
    partySearchName: "PRABHJIT SINGH BAGGA",
    partySearchYear: "2025",
    displayTitle: "Prabhjit Singh Bagga through power of attorney Jagjit Singh Bagga vs Kartar Kaur Chhabra",
    fallbackPetitioners: ["PRABHJIT SINGH BAGGA S/O SHRI JAGJIT SINGH BAGGA THROUGH HIS POWER OF ATTORNEY HOLDER JAGJIT SINGH"],
    fallbackRespondents: ["KARTAR KAUR CHHABRA"],
  },
];

const KHARGONE_CASE_CONFIGS = [
  {
    id: "rcs-hm-86-2024",
    code: "RCS HM/86/2024",
    cnr: "MP10050048062024",
    type: "Regular Civil Suit (Hindu Marriage Act)",
    displayTitle: "Kartar kaur vs Prabhjitsingh Bagga",
    partiesSummary: "Kartar kaur against Prabhjitsingh Bagga",
    category: "Hindu Marriage Act, 1955",
    statutory:
      "Regular civil suit under section 9 of the Hindu Marriage Act, 1955. The eCourts status page marks the current sub-stage as proceedings stayed.",
    orderNote:
      "No order PDF link was returned in the fetched eCourts history; the record currently emphasizes the pending status and next hearing date.",
  },
  {
    id: "mjc-r-278-2024",
    code: "MJC R/278/2024",
    cnr: "MP10050042942024",
    type: "Miscellaneous Judicial Case (Criminal)",
    displayTitle: "Kartar Kor vs Prabhjitshing",
    partiesSummary: "Kartar Kor against Prabhjitshing",
    category: "Bharatiya Nagarik Suraksha Sanhita, 2023",
    statutory:
      "Miscellaneous judicial criminal case under section 144 of the Bharatiya Nagarik Suraksha Sanhita, 2023.",
    orderNote:
      "No order PDF link was returned in the fetched eCourts history; the record currently emphasizes appearance of the respondent/non-applicant.",
  },
  {
    id: "mjc-r-181-2024",
    code: "MJC R/181/2024",
    cnr: "MP10050024632024",
    type: "Miscellaneous Judicial Case (Criminal)",
    displayTitle: "Kartar Kor vs Prabhjit Singh and others",
    partiesSummary: "Kartar Kor against four Bagga-side respondents",
    category: "Protection of Women from Domestic Violence Act, 2005",
    statutory:
      "Miscellaneous judicial criminal case under section 23 of the Protection of Women from Domestic Violence Act, 2005.",
    orderNote:
      "No order PDF link was returned in the fetched eCourts history; the record currently emphasizes appearance of accused/surety.",
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

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longMonthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const monthIndexByName = new Map(longMonthNames.map((name, index) => [name.toLowerCase(), index]));
monthNames.forEach((name, index) => monthIndexByName.set(name.toLowerCase(), index));

function cleanText(value) {
  return stripTags(String(value || ""))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLabel(value) {
  return cleanText(value).replace(/\s+/g, " ").replace(/:$/, "").trim();
}

function parseCourtDate(value) {
  const cleaned = cleanText(value).replace(/(\d+)(st|nd|rd|th)/gi, "$1");
  let match = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    return { day: Number(match[1]), month: Number(match[2]) - 1, year: Number(match[3]) };
  }

  match = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const month = monthIndexByName.get(match[2].toLowerCase());
    if (month !== undefined) {
      return { day: Number(match[1]), month, year: Number(match[3]) };
    }
  }

  return null;
}

function formatCourtDate(value, style = "short") {
  const parsed = parseCourtDate(value);
  if (!parsed) return cleanText(value);
  if (style === "long") return `${longMonthNames[parsed.month]} ${parsed.day}, ${parsed.year}`;
  return `${String(parsed.day).padStart(2, "0")} ${monthNames[parsed.month]} ${parsed.year}`;
}

function normalizeDistrictPurpose(value) {
  return cleanText(value).replace(/Miscellanceous/gi, "Miscellaneous");
}

function normalizeDistrictStage(value) {
  const stage = normalizeDistrictPurpose(value);
  if (/miscellaneous matters not defined otherwise/i.test(stage)) return "Miscellaneous Matters";
  return stage;
}

function tableHtmlByClass(html, className) {
  const match = html.match(new RegExp(`<table[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>[\\s\\S]*?<\\/table>`, "i"));
  return match ? match[0] : "";
}

function parseKeyValueTable(html, className) {
  const rows = parseTableRows(tableHtmlByClass(html, className));
  const values = new Map();
  for (const cells of rows) {
    if (cells.length === 2) {
      values.set(cleanLabel(cells[0]), cleanText(cells[1]));
    } else if (cells.length >= 4) {
      values.set(cleanLabel(cells[0]), cleanText(cells[1]));
      values.set(cleanLabel(cells[2]), cleanText(cells[3]));
    }
  }
  return values;
}

function listHtmlByClass(html, className) {
  const match = html.match(new RegExp(`<ul[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/ul>`, "i"));
  return match ? match[1] : "";
}

function parseDistrictPartyList(html, className) {
  const listHtml = listHtmlByClass(html, className);
  const people = [];
  const advocates = [];

  for (const match of listHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = cleanText(match[1]);
    const entries = text.split(/\s*(?=\d+\)\s*)/).filter(Boolean);
    for (const entry of entries) {
      const [namePart, advocatePart] = entry.replace(/^\d+\)\s*/, "").split(/\bAdvocate-\s*/i);
      const name = cleanText(namePart);
      const advocate = cleanText(advocatePart || "");
      if (name) people.push(name);
      if (advocate) advocates.push(advocate);
    }
  }

  return { people, advocates };
}

function parseDistrictActs(html) {
  return parseTableRows(tableHtmlByClass(html, "acts_table"))
    .slice(1)
    .map((cells) => [cleanText(cells[0]), cleanText(cells[1])])
    .filter((cells) => cells.some(Boolean));
}

function parseDistrictHistory(html) {
  return parseTableRows(tableHtmlByClass(html, "history_table"))
    .map((cells) => ({
      coram: cleanText(cells[0]),
      date: formatCourtDate(cells[1]),
      rawDate: cleanText(cells[1]),
      nextDate: formatCourtDate(cells[2]),
      purpose: normalizeDistrictPurpose(cells[3]),
    }))
    .filter((row) => row.date);
}

function parseDistrictTransfers(html) {
  return parseTableRows(tableHtmlByClass(html, "transfer_table"))
    .slice(1)
    .map((cells) => ({
      registration: cleanText(cells[0]),
      date: cleanText(cells[1]),
      from: cleanText(cells[2]),
      to: cleanText(cells[3]),
    }))
    .filter((row) => row.date || row.from || row.to);
}

function formatDistrictTimeline(historyRows) {
  return historyRows.map((row, index) => ({
    date: row.date,
    coram: row.coram,
    purpose: row.purpose,
    note:
      index === historyRows.length - 1
        ? `First hearing date; next hearing listed for ${row.nextDate}.`
        : `Next hearing listed for ${row.nextDate}.`,
  }));
}

function districtSubstageMetric(stageDetail) {
  if (/stay|stayed/i.test(stageDetail)) return "Stayed";
  if (/appearance/i.test(stageDetail)) return "Appearance";
  return stageDetail || "-";
}

function isBlankCourtValue(value) {
  return !cleanText(value) || cleanText(value) === "-";
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
    status: matchText(pageHtml, /bi-(?:hourglass-split|check2-circle)[^>]*><\/i>\s*([^<]+)</),
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function caseCodeMatcher(config) {
  return new RegExp(`${escapeRegExp(config.caseTypeName)}[\\/-]${escapeRegExp(config.caseNo)}[\\/-]${escapeRegExp(config.year)}`, "i");
}

async function findCaseLink(page, config, timeout = 60000) {
  const rowLink = page.locator("a.get_data", { hasText: caseCodeMatcher(config) }).first();
  await rowLink.waitFor({ timeout });
  return rowLink;
}

async function findCaseLinkByPartyName(page, config) {
  if (!config.partySearchName) {
    throw new Error(`No party-name fallback is configured for ${config.id}.`);
  }

  await page.goto(COURT_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#case_status_form", { timeout: 60000 });
  if (config.partySearchBenchName && (await page.locator('select[name="bench_code"]').count()) > 0) {
    await page.selectOption('select[name="bench_code"]', { label: config.partySearchBenchName });
  }
  await page.click("#judgments-tab");
  await page.fill("#Party_Name", config.partySearchName);
  await page.selectOption("#party_Year", config.partySearchYear || config.year);
  await page.click("#sendbtn");
  return findCaseLink(page, config, 60000);
}

async function scrapeCase(page, config, tmpDir) {
  await page.goto(COURT_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#case_status_form", { timeout: 60000 });
  if (config.benchName && (await page.locator('select[name="bench_code"]').count()) > 0) {
    await page.selectOption('select[name="bench_code"]', { label: config.benchName });
  }
  await page.selectOption("#case_type", { label: config.caseTypeName });
  await page.fill("#case_no", config.caseNo);
  await page.selectOption("#year_registration", config.year);
  await page.getByRole("button", { name: /search/i }).first().click();

  let rowLink;
  try {
    rowLink = await findCaseLink(page, config);
  } catch (error) {
    if (!config.partySearchName) throw error;
    console.log(`Case-number search did not return ${config.caseTypeName}/${config.caseNo}/${config.year}; trying party-name search.`);
    rowLink = await findCaseLinkByPartyName(page, config);
  }

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

  const bench = modal.bench || config.benchName || rowTexts[2] || "Indore";
  const rowStatus = rowTexts.find((text) => /^(Pending|Disposed)$/i.test(String(text).trim()));
  const status = modal.status || rowStatus || rowTexts[3] || "Pending";
  const petitioners = modal.petitioners.length ? modal.petitioners : config.fallbackPetitioners || [];
  const respondents = modal.respondents.length ? modal.respondents : config.fallbackRespondents || [];
  const petitionerAdvocates = modal.petitionerAdvocates.length ? modal.petitionerAdvocates : config.fallbackPetitionerAdvocates || [];
  const respondentAdvocates = modal.respondentAdvocates.length ? modal.respondentAdvocates : config.fallbackRespondentAdvocates || [];

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
    partiesSummary: `${petitioners.length} petitioner(s), ${respondents.length} respondent(s), ${pendingIaRows.length} pending IA(s)`,
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
    petitioners,
    petitionerAdvocates,
    respondents,
    respondentAdvocates,
    filNo,
  };
}

async function fetchDistrictCaseHtml(config) {
  const body = new URLSearchParams({
    cino: config.cnr,
    ajax_req: "true",
    app_token: "",
  });

  const response = await fetch(ECOURTS_CNR_HISTORY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`eCourts CNR history request failed with HTTP ${response.status}`);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`eCourts CNR history returned non-JSON content for ${config.cnr}`);
  }

  const html = payload.casetype_list || payload.data_list || "";
  if (!html) {
    throw new Error(`eCourts CNR history returned no case details for ${config.cnr}`);
  }
  return html;
}

async function scrapeKhargoneCase(config) {
  const pageHtml = await fetchDistrictCaseHtml(config);
  const caseDetails = parseKeyValueTable(pageHtml, "case_details_table");
  const caseStatus = parseKeyValueTable(pageHtml, "case_status_table");
  const petitioners = parseDistrictPartyList(pageHtml, "Petitioner_Advocate_table");
  const respondents = parseDistrictPartyList(pageHtml, "Respondent_Advocate_table");
  const acts = parseDistrictActs(pageHtml);
  const historyRows = parseDistrictHistory(pageHtml);
  const transferRows = parseDistrictTransfers(pageHtml);

  const filingNumber = caseDetails.get("Filing Number") || "-";
  const filingDate = caseDetails.get("Filing Date") || "";
  const registrationNumber = caseDetails.get("Registration Number") || "";
  const registrationDate = caseDetails.get("Registration Date") || "";
  const firstHearingDate = caseStatus.get("First Hearing Date") || "";
  const nextHearingDate = caseStatus.get("Next Hearing Date") || "";
  const stage = normalizeDistrictStage(caseStatus.get("Case Stage") || "");
  const stageDetail = normalizeDistrictPurpose(caseStatus.get("Sub Stage") || "");
  const before = cleanText(caseStatus.get("Court Number and Judge") || "");
  const lastListedOn = historyRows[0]?.date || "";
  const nextVisibleDate = formatCourtDate(nextHearingDate) || historyRows[0]?.nextDate || "No next date visible";
  const firstHistoryDate = historyRows[historyRows.length - 1]?.date || formatCourtDate(firstHearingDate);
  const status = /decision|disposed|disposal/i.test(pageHtml) && !nextHearingDate ? "Disposed" : "Pending";
  const statusTone = /pending/i.test(status) ? "pending" : "clear";
  const actName = acts[0]?.[0] || config.category || "-";
  const sectionName = acts[0]?.[1] || "";

  return {
    id: config.id,
    code: config.code,
    type: config.type,
    title: config.displayTitle,
    bench: KHARGONE_DISTRICT_CONTEXT.courtName,
    courtLocation: KHARGONE_DISTRICT_CONTEXT.courtName,
    status,
    statusTone,
    stage,
    stageDetail,
    filedOn: formatCourtDate(filingDate),
    lastListedOn,
    nextVisibleDate,
    lastOrderLabel: nextVisibleDate && nextVisibleDate !== "No next date visible" ? `Next hearing: ${nextVisibleDate}` : "",
    before,
    da: KHARGONE_DISTRICT_CONTEXT.courtName,
    cnr: config.cnr,
    sourceUrl: KHARGONE_COURT_URL,
    partiesSummary:
      config.partiesSummary ||
      (petitioners.people.length && respondents.people.length
        ? `${petitioners.people[0]} against ${respondents.people.length > 1 ? `${respondents.people.length} respondent(s)` : respondents.people[0]}`
        : `${petitioners.people.length} petitioner(s), ${respondents.people.length} respondent(s)`),
    category: config.category || actName,
    district: KHARGONE_DISTRICT_CONTEXT.district,
    statutory: config.statutory || `${actName}${sectionName ? `, section ${sectionName}` : ""}.`,
    quickFacts: [
      ["Court", KHARGONE_DISTRICT_CONTEXT.courtName],
      ["Before", before || "-"],
      ["Status", status || "-"],
      ["CNR", config.cnr],
      ["Filing number", filingNumber],
      ["Registration", `${registrationNumber || "-"}${registrationDate ? ` on ${registrationDate}` : ""}`],
      ["First hearing", formatCourtDate(firstHearingDate) || firstHistoryDate || "-"],
      ["Next hearing", nextVisibleDate || "-"],
      ["Sub-stage", stageDetail || "-"],
      ["Refresh route", KHARGONE_REFRESH_ROUTE],
    ],
    metrics: [
      {
        label: "Next hearing",
        value: nextVisibleDate || "-",
        note: "Current next date shown on eCourts",
        accent: "#d86c63",
      },
      {
        label: "Status",
        value: status,
        note: "District court status",
        accent: "#c89a37",
      },
      {
        label: "Sub-stage",
        value: districtSubstageMetric(stageDetail),
        note: stageDetail || "Current sub-stage shown on eCourts",
        accent: "#73b35c",
      },
      {
        label: "History rows",
        value: String(historyRows.length),
        note: "Business-date entries returned online",
        accent: "#5b8dee",
      },
    ],
    nextSteps: [
      nextVisibleDate && nextVisibleDate !== "No next date visible"
        ? `The next hearing is listed for ${formatCourtDate(nextVisibleDate, "long")} before ${before || "the current court"}.`
        : `No future hearing date is visible on the public record, so the next useful refresh should confirm the current ${stageDetail || "sub-stage"}.`,
      stageDetail
        ? `The current sub-stage is ${stageDetail.toLowerCase()}, so the next refresh should check whether it changes after the listed date.`
        : "The current sub-stage is not clearly shown on the public record.",
      transferRows.length
        ? `The case-transfer section shows ${transferRows.length} transfer row(s) within the Khargone establishment.`
        : "No case-transfer section was returned for this matter in the fetched record.",
    ],
    listingTimeline: formatDistrictTimeline(historyRows),
    orderHighlights: [
      {
        date: nextVisibleDate,
        summary: config.orderNote || "No order PDF link was returned in the fetched eCourts history.",
      },
    ],
    pendingIAs: [],
    ordersArchive: [],
    documents: [],
    serviceInfo: [
      `e-Filing number and e-Filing date are ${
        isBlankCourtValue(caseDetails.get("e-Filing Number")) && isBlankCourtValue(caseDetails.get("e-Filing Date"))
          ? "blank on the fetched eCourts case detail."
          : "shown in the fetched eCourts case detail."
      }`,
      ...(transferRows.length
        ? transferRows.map((row) => `Transfer on ${row.date}: from ${row.from || "-"} to ${row.to || "-"}.`)
        : ["No case-transfer section was returned for this matter in the fetched record."]),
    ],
    petitioners: petitioners.people,
    petitionerAdvocates: petitioners.advocates,
    respondents: respondents.people,
    respondentAdvocates: respondents.advocates,
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
  const pattern = /const cases = [\s\S]*?;\n\n      const translations =/;
  if (!pattern.test(html)) throw new Error("Unable to replace cases data block.");
  return html.replace(pattern, `${replacement}\n\n      const translations =`);
}

function extractCasesDataBlock(html) {
  const match = html.match(/const cases = [\s\S]*?;\n\n      const translations =/);
  if (!match) throw new Error("Unable to locate cases data block.");
  return match[0].replace(/\n\n      const translations =$/, "");
}

function replaceCasesDataBlock(html, sourceHtml) {
  const replacement = extractCasesDataBlock(sourceHtml);
  const pattern = /const cases = [\s\S]*?;\n\n      const translations =/;
  if (!pattern.test(html)) throw new Error("Unable to replace cases data block.");
  return html.replace(pattern, `${replacement}\n\n      const translations =`);
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
  for (const filePath of [SETTINGS_PATH, EVENT_LOG_PATH]) {
    if (!fs.existsSync(filePath)) continue;
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
  const pageOptions = {
    viewport: { width: 1440, height: 2200 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  };

  try {
    const refreshedCases = [];
    const failures = [];
    for (const config of CASE_CONFIGS) {
      let casePage;
      try {
        casePage = await browser.newPage(pageOptions);
        const caseData = await scrapeCase(casePage, config, tmpDir);
        refreshedCases.push(caseData);
      } catch (error) {
        failures.push(`${config.id}: ${error.message}`);
        console.error(`Unable to refresh ${config.id}; preserving existing tracker data.`);
        console.error(error);
      } finally {
        await casePage?.close().catch(() => {});
      }
    }

    for (const config of KHARGONE_CASE_CONFIGS) {
      try {
        const caseData = await scrapeKhargoneCase(config);
        refreshedCases.push(caseData);
      } catch (error) {
        failures.push(`${config.id}: ${error.message}`);
        console.error(`Unable to refresh ${config.id}; preserving existing Khargone tracker data.`);
        console.error(error);
      }
    }

    if (refreshedCases.length === 0 && failures.length > 0) {
      throw new Error(`No live case data could be refreshed: ${failures.join("; ")}`);
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
    console.log(`Refreshed ${refreshedCases.length} live case(s), preserved ${cases.length - refreshedCases.length} existing case(s), and updated tracker timestamps.`);
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
