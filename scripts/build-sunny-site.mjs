#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE_PATH = path.join(ROOT, "sunny-cases.html");
const INDEX_PATH = path.join(ROOT, "index.html");
const CASES_PATH = path.join(ROOT, "cases.html");
const SUNNY_PATH = path.join(ROOT, "sunny-cases.html");
const ORDERS_PATH = path.join(ROOT, "orders.html");
const DOCUMENTS_PATH = path.join(ROOT, "documents.html");
const EVENT_LOG_PATH = path.join(ROOT, "event-log.html");
const EVENT_DATA_PATH = path.join(ROOT, "automation-events.json");

const nowIso = new Date().toISOString();

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function formatUpdatedLabel(isoDate) {
  const date = new Date(isoDate);
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

function extractCases(source) {
  const match = source.match(/const cases = (\[[\s\S]*?\n\s*\]);\n\n\s*const translations/);
  if (!match) throw new Error("Unable to find Sunny case data in sunny-cases.html.");
  return Function(`return ${match[1]}`)();
}

function totalDocuments(cases) {
  return cases.reduce((sum, item) => sum + (item.documents || []).length, 0);
}

function buildOrderRecords(cases) {
  const rows = [];
  for (const item of cases) {
    const archiveByDate = new Map();
    for (const [date, link] of item.ordersArchive || []) {
      const key = String(date || "").trim().toLowerCase();
      archiveByDate.set(key, link);
      const matchingHighlight = (item.orderHighlights || []).find(
        (entry) => String(entry.date || "").trim().toLowerCase() === key
      );
      rows.push({
        caseId: item.id,
        caseCode: item.code,
        caseTitle: item.title,
        date,
        note: matchingHighlight?.summary || "Court order/source PDF from the public case record.",
        href: link,
        action: "Open PDF",
      });
    }

    for (const entry of item.orderHighlights || []) {
      const key = String(entry.date || "").trim().toLowerCase();
      if (archiveByDate.has(key)) continue;
      rows.push({
        caseId: item.id,
        caseCode: item.code,
        caseTitle: item.title,
        date: entry.date,
        note: entry.summary,
        href: item.sourceUrl,
        action: (item.sourceUrl || "").includes(".pdf") ? "Open PDF" : "Open source",
      });
    }
  }
  return rows;
}

function buildDocumentRecords(cases) {
  const rows = [];
  for (const item of cases) {
    for (const [docNo, type, filedBy, filedOn] of item.documents || []) {
      rows.push({
        caseId: item.id,
        caseCode: item.code,
        caseTitle: item.title,
        docNo,
        type,
        filedBy,
        filedOn,
      });
    }
  }
  return rows;
}

function navLinks(active) {
  const links = [
    ["cases", "cases.html", "Cases"],
    ["orders", "orders.html", "Orders"],
    ["documents", "documents.html", "Documents"],
  ];
  return `<div class="menu-links">
${links
  .map(
    ([key, href, label]) =>
      `        <a class="menu-link${active === key ? " active" : ""}" href="${href}">${label}</a>`
  )
  .join("\n")}
      </div>`;
}

function menuFooter() {
  return `<div class="menu-footer">
        <a class="menu-link" href="https://www.sci.gov.in/case-status-diary-no/" target="_blank" rel="noreferrer">SCI Search</a>
      </div>`;
}

function rewriteTrackerPage(source, options = {}) {
  const isDetailPage = Boolean(options.isDetailPage);
  const updatedLabel = formatUpdatedLabel(nowIso);
  let html = source;

  html = html.replace(/<title>Sunny Cases Dashboard<\/title>/, "<title>Sunny Case Tracker</title>");
  html = html.replace(/Sunny Cases Dashboard/g, "Sunny Case Tracker");
  html = html.replace(/Bagga Case Tracker/g, "Sunny Case Tracker");
  html = html.replace(/Dashboard navigation/g, "Harpreet Singh Ajmani cases");
  html = html.replace(/Last updated: [^<]+<\/div>/, `Last updated: ${escapeHtml(updatedLabel)}</div>`);
  html = html.replace(/const siteLastUpdatedAt = "[^"]+";/, `const siteLastUpdatedAt = "${nowIso}";`);
  html = html.replace(/<div class="menu-links">[\s\S]*?<\/div>\n\s*<div class="menu-footer">/, `${navLinks("cases")}\n      <div class="menu-footer">`);
  html = html.replace(/<div class="menu-footer">[\s\S]*?<\/div>\n\s*<\/nav>/, `${menuFooter()}\n    </nav>`);
  html = html.replace(/baggaCaseTracker/g, "sunnyCaseTracker");
  html = html.replace(
    /const isCaseDetailPage = [^;]+;\n\s*(?:if \(isCaseDetailPage\) document\.body\.dataset\.page = "case-detail";\n\s*)?/,
    isDetailPage
      ? 'const isCaseDetailPage = true;\n      document.body.dataset.page = "case-detail";\n      '
      : "const isCaseDetailPage = false;\n      "
  );
  html = html.replace(
    /return `(?:sunny-cases|index|cases)\.html\?case=\$\{encodeURIComponent\(caseId\)\}`;/,
    'return `cases.html?case=${encodeURIComponent(caseId)}`;'
  );
  html = html.replace(
    /footerNote:\s*'[^']*',/,
    `footerNote: ${JSON.stringify(
      'This Sunny Case Tracker is a structured snapshot of public records found for AOR/Lawyer Harpreet Singh Ajmani from <a href="https://www.sci.gov.in/case-status-diary-no/" target="_blank" rel="noreferrer">sci.gov.in case status</a>, official SCI PDFs, <a href="https://mphc.gov.in/case-status" target="_blank" rel="noreferrer">mphc.gov.in/case-status</a>, <a href="https://services.ecourts.gov.in/" target="_blank" rel="noreferrer">services.ecourts.gov.in</a>, and broader Google-indexed web records. CAPTCHA-gated broad searches were not bypassed, so source-only rows are labeled and should be manually refreshed before reliance.'
    )},`
  );

  const translationValues = {
    pageTitle: "Sunny Case Tracker",
    heroTitle: "Sunny Case Tracker",
    benchPrefix: "Bench",
    courtLocation: "Court location",
    nextDate: "Next date",
    lastListed: "Last listed",
    completed: "Completed",
    openCaseDetails: "Open case details",
    pendingCount: "pending",
    orderLinks: "order links",
    timelineEntries: "timeline entries",
    highCourtOrderPdf: "Court source PDF",
    download: "Download",
    names: "names",
    advocates: "Advocates",
    advocatesOnRecord: "Advocates on record",
    caseSummary:
      "{type} is tracked in {bench}. It was filed on {filedOn}, last listed on {lastListedOn}, and is currently marked {status} at the {stage} stage.",
  };

  for (const [key, value] of Object.entries(translationValues)) {
    html = html.replace(new RegExp(`${key}:\\s*"[^"]*",`), `${key}: ${JSON.stringify(value)},`);
  }

  html = html.replace(
    /function t\(key\) \{\n\s*return translations\[currentLanguage\]\[key\] \|\| translations\.en\[key\] \|\| key;\n\s*\}/,
    `function t(key) {
        const dictionary = translations[currentLanguage] || translations.en || {};
        return dictionary[key] || translations.en?.[key] || key;
      }`
  );
  html = html.replace(
    /currentLanguage = button\.dataset\.lang;\n\s*if \(isCaseDetailPage\)/,
    'currentLanguage = button.dataset.lang;\n          localStorage.setItem("sunnyCaseTrackerLanguage", currentLanguage);\n          if (isCaseDetailPage)'
  );

  if (isDetailPage) {
    html = html.replace(
      /<a class="home-title-link" href="index\.html" aria-label="Go to dashboard home">/,
      '<a class="home-title-link" href="index.html" aria-label="Go to Sunny Case Tracker home">'
    );
  }

  return html;
}

function sharedStyles() {
  return `:root { --bg: #eef4fb; --ink: #1f2b3d; --muted: #63748d; --navy: #172d4d; --border: rgba(105, 131, 173, 0.2); --surface: #fff; --shadow: 0 18px 46px rgba(29, 53, 87, 0.12); }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "SF Pro Display", "Segoe UI", system-ui, sans-serif; color: var(--ink); background: linear-gradient(120deg, rgba(255,255,255,0.72), rgba(216,226,241,0.6) 38%, rgba(248,246,236,0.72)), linear-gradient(180deg, #f8fbff 0%, #dfe8f3 58%, #f4f0e6 100%); }
      body::before { content: ""; position: fixed; inset: 0; background: linear-gradient(105deg, rgba(47,79,128,0.1), transparent 26%, rgba(217,165,58,0.09) 58%, transparent 76%), repeating-linear-gradient(118deg, rgba(255,255,255,0.2) 0 1px, transparent 1px 34px); pointer-events: none; z-index: -1; }
      .top-banner { background: linear-gradient(112deg, #101b2e 0%, #18365b 47%, #3d5868 100%); box-shadow: 0 16px 34px rgba(13,25,43,0.24), inset 0 -1px 0 rgba(255,255,255,0.12); color: white; min-height: 52px; padding: 8px clamp(16px, 4vw, 32px); }
      .top-banner-inner, main { max-width: 1440px; margin: 0 auto; }
      .top-banner-inner { align-items: center; display: flex; gap: 16px; justify-content: space-between; min-height: 36px; }
      .banner-title, .top-banner-actions { align-items: center; display: flex; gap: 12px; }
      .home-title-link, .back-link { color: inherit; text-decoration: none; }
      h1 { font-size: clamp(1.05rem, 2vw, 1.28rem); line-height: 1.15; margin: 0; }
      h2 { font-size: clamp(1.9rem, 3vw, 2.7rem); margin: 8px 0 0; }
      h3, p { margin: 0; }
      p { color: var(--muted); line-height: 1.55; margin-top: 8px; }
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
      .menu-link { align-items: center; border: 1px solid transparent; border-radius: 14px; color: var(--ink); display: flex; font-size: 0.96rem; font-weight: 800; gap: 12px; min-height: 46px; padding: 12px 14px; text-decoration: none; }
      .menu-link:hover, .menu-link.active { background: #eef4ff; border-color: var(--border); color: #315fae; }
      .menu-footer { border-top: 1px solid var(--border); margin-top: auto; padding-top: 14px; }
      main { padding: 22px clamp(20px, 4vw, 40px) 64px; }
      .page-head, .row, .stat-card { background: linear-gradient(145deg, rgba(255,255,255,0.96), rgba(230,237,248,0.88)), linear-gradient(90deg, rgba(113,185,223,0.08), rgba(217,165,58,0.08)); border: 1px solid rgba(89,123,171,0.26); box-shadow: 0 18px 42px rgba(29,53,87,0.12), inset 0 1px 0 rgba(255,255,255,0.8); }
      .page-head { border-radius: 24px; padding: 24px; }
      .label { color: var(--muted); font-size: 0.78rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
      .stats-grid { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 18px; }
      .stat-card { border-radius: 18px; min-height: 102px; padding: 16px; }
      .stat-value { font-size: 1.8rem; font-weight: 900; margin-top: 8px; }
      .library { display: grid; gap: 14px; margin-top: 20px; }
      .sort-row, .row { display: grid; gap: 14px; grid-template-columns: minmax(180px, 1fr) minmax(130px, 0.55fr) minmax(260px, 1.25fr) minmax(150px, 0.65fr) minmax(110px, 0.45fr); }
      .sort-row { color: var(--muted); padding: 0 16px; }
      .row { border-radius: 18px; padding: 16px; }
      .document-row { grid-template-columns: minmax(180px, 1fr) minmax(130px, 0.55fr) minmax(220px, 1fr) minmax(160px, 0.75fr) minmax(110px, 0.45fr); }
      .case-code, .value { font-weight: 850; line-height: 1.35; }
      .case-link { color: inherit; text-decoration: none; }
      .case-link:hover { color: #315fae; text-decoration: underline; }
      .muted { color: var(--muted); font-size: 0.9rem; line-height: 1.4; margin-top: 4px; }
      .button-link { align-self: start; background: #eef4ff; border-radius: 999px; color: #3b67b9; display: inline-flex; font-weight: 850; justify-content: center; padding: 10px 14px; text-decoration: none; }
      .sort-button { align-items: center; background: transparent; border: 0; color: var(--muted); cursor: pointer; display: inline-flex; font: inherit; font-size: 0.78rem; font-weight: 850; gap: 8px; letter-spacing: 0.08em; padding: 0; text-align: left; text-transform: uppercase; }
      .sort-button:hover, .sort-button.active { color: var(--navy); }
      .sort-state { background: #eef4ff; border: 1px solid var(--border); border-radius: 999px; color: #3b67b9; font-size: 0.68rem; font-weight: 850; letter-spacing: 0; padding: 3px 7px; text-transform: none; }
      @media (max-width: 960px) { .stats-grid { grid-template-columns: 1fr 1fr; } .sort-row, .row, .document-row { grid-template-columns: 1fr; } }
      @media (max-width: 640px) { .top-banner-inner { align-items: flex-start; flex-direction: column; } .top-banner-actions { align-items: flex-start; justify-content: flex-start; width: 100%; } .stats-grid { grid-template-columns: 1fr; } }`;
}

function pageChrome({ title, active, updatedLabel, body }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      ${sharedStyles()}
    </style>
  </head>
  <body>
    <header class="top-banner">
      <div class="top-banner-inner">
        <div class="banner-title">
          <button class="menu-button" type="button" aria-label="Open navigation menu" aria-controls="siteMenu" aria-expanded="false" data-menu-toggle>
            <span class="menu-lines" aria-hidden="true"><span></span><span></span><span></span></span>
          </button>
          <a class="home-title-link" href="index.html" aria-label="Go to Sunny Case Tracker home">
            <h1>Sunny Case Tracker</h1>
          </a>
        </div>
        <div class="top-banner-actions">
          <div class="last-updated-chip">Last updated: ${escapeHtml(updatedLabel)}</div>
          <a class="back-link" href="cases.html">Cases</a>
        </div>
      </div>
    </header>
    <div class="menu-backdrop" data-menu-close hidden></div>
    <nav class="site-menu" id="siteMenu" aria-label="Site navigation" aria-hidden="true" hidden>
      <div class="site-menu-head">
        <div>
          <div class="site-menu-title">Sunny Case Tracker</div>
          <div class="site-menu-subtitle">Harpreet Singh Ajmani cases</div>
        </div>
        <button class="menu-close" type="button" aria-label="Close navigation menu" data-menu-close><span aria-hidden="true">X</span></button>
      </div>
      ${navLinks(active)}
      ${menuFooter()}
    </nav>
    <main>
${body}
    </main>
    <script>
      const menu = document.getElementById("siteMenu");
      const menuBackdrop = document.querySelector(".menu-backdrop");
      const menuToggle = document.querySelector("[data-menu-toggle]");
      const menuCloseButtons = Array.from(document.querySelectorAll("[data-menu-close]"));
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
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setMenuOpen(false);
      });
    </script>
  </body>
</html>`;
}

function buildDocumentsPage(cases, updatedLabel) {
  const rows = buildDocumentRecords(cases);
  const body = `      <section class="page-head">
        <div class="label">Document Library</div>
        <h2>Documents and Source Filings</h2>
        <p>Filing, diary, office-report, and source rows collected from public case records where Harpreet Singh Ajmani appears in the tracked material.</p>
        <section class="stats-grid" aria-label="Document summary">
          <article class="stat-card"><div class="label">Cases</div><div class="stat-value">${cases.length}</div><p>Tracked matters</p></article>
          <article class="stat-card"><div class="label">Rows</div><div class="stat-value">${rows.length}</div><p>Document/source records</p></article>
          <article class="stat-card"><div class="label">Scope</div><div class="stat-value">SCI</div><p>Plus MPHC and eCourts sources where available</p></article>
        </section>
      </section>
      <section class="library">
${rows
  .map(
    (row) => `        <article class="row document-row">
          <div><a class="case-link" href="cases.html?case=${encodeURIComponent(row.caseId)}"><div class="case-code">${escapeHtml(row.caseCode)}</div></a><div class="muted">${escapeHtml(row.caseTitle)}</div></div>
          <div><div class="label">Document</div><div class="value">${escapeHtml(row.docNo)}</div></div>
          <div><div class="label">Type / Filed By</div><div class="value">${escapeHtml(row.type)}</div><div class="muted">${escapeHtml(row.filedBy)}</div></div>
          <div><div class="label">Filed On</div><div class="value">${escapeHtml(row.filedOn)}</div></div>
          <a class="button-link" href="cases.html?case=${encodeURIComponent(row.caseId)}">Details</a>
        </article>`
  )
  .join("\n")}
      </section>`;
  return pageChrome({ title: "Sunny Case Documents", active: "documents", updatedLabel, body });
}

function buildOrdersPage(cases, updatedLabel) {
  const rows = buildOrderRecords(cases);
  const body = `      <section class="page-head">
        <div class="label">Order Library</div>
        <h2>Orders, Judgments, and Source Notes</h2>
        <p>Downloadable order links and order-note records collected from the tracked Harpreet Singh Ajmani case set.</p>
        <section class="stats-grid" aria-label="Order summary">
          <article class="stat-card"><div class="label">Cases</div><div class="stat-value">${cases.length}</div><p>Tracked matters</p></article>
          <article class="stat-card"><div class="label">Records</div><div class="stat-value">${rows.length}</div><p>Order/source rows</p></article>
          <article class="stat-card"><div class="label">PDF Links</div><div class="stat-value">${rows.filter((row) => row.action === "Open PDF").length}</div><p>Direct downloadable sources</p></article>
        </section>
      </section>
      <section class="library">
        <div class="sort-row" aria-label="Sortable order columns">
          <button class="sort-button" type="button" data-sort="case">Case Number / Parties <span class="sort-state">Sort</span></button>
          <button class="sort-button" type="button" data-sort="date">Date <span class="sort-state">Sort</span></button>
          <button class="sort-button" type="button" data-sort="note">Order / Judgment Note <span class="sort-state">Sort</span></button>
          <div class="label">File</div>
          <div class="label">Case</div>
        </div>
${rows
  .map(
    (row, index) => `        <article class="row order-row" data-original-index="${index}">
          <div><a class="case-link" href="cases.html?case=${encodeURIComponent(row.caseId)}"><div class="case-code">${escapeHtml(row.caseCode)}</div></a><div class="muted">${escapeHtml(row.caseTitle)}</div></div>
          <div><div class="label">Date</div><div class="value">${escapeHtml(row.date)}</div></div>
          <div><div class="label">Order / Judgment Note</div><div class="value">${escapeHtml(row.note)}</div></div>
          <a class="button-link" href="${escapeAttr(row.href)}" target="_blank" rel="noreferrer">${escapeHtml(row.action)}</a>
          <a class="button-link" href="cases.html?case=${encodeURIComponent(row.caseId)}">Details</a>
        </article>`
  )
  .join("\n")}
      </section>
      <script>
        const rows = Array.from(document.querySelectorAll(".order-row"));
        const sortButtons = Array.from(document.querySelectorAll("[data-sort]"));
        const activeSort = { key: "original", direction: "asc" };
        function parseDate(value) {
          const normalized = String(value || "").replace(/(st|nd|rd|th)/gi, "");
          const parsed = Date.parse(normalized);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        function valueFor(row, key) {
          if (key === "case") return row.querySelector(".case-code")?.textContent.trim().toLowerCase() || "";
          if (key === "date") return parseDate(row.querySelector(".row > div:nth-child(2) .value")?.textContent || "");
          if (key === "note") return row.querySelector(".row > div:nth-child(3) .value")?.textContent.trim().toLowerCase() || "";
          return Number(row.dataset.originalIndex || 0);
        }
        function sortRows(key) {
          if (activeSort.key === key) {
            activeSort.direction = activeSort.direction === "asc" ? "desc" : "asc";
          } else {
            activeSort.key = key;
            activeSort.direction = key === "date" ? "desc" : "asc";
          }
          const direction = activeSort.direction === "asc" ? 1 : -1;
          rows
            .slice()
            .sort((a, b) => {
              const aValue = valueFor(a, activeSort.key);
              const bValue = valueFor(b, activeSort.key);
              if (typeof aValue === "number" && typeof bValue === "number") return (aValue - bValue) * direction;
              return String(aValue).localeCompare(String(bValue)) * direction;
            })
            .forEach((row) => row.parentElement.appendChild(row));
          sortButtons.forEach((button) => {
            const isActive = button.dataset.sort === activeSort.key;
            button.classList.toggle("active", isActive);
            const state = button.querySelector(".sort-state");
            if (state) state.textContent = isActive ? (activeSort.direction === "asc" ? "Asc" : "Desc") : "Sort";
          });
        }
        sortButtons.forEach((button) => button.addEventListener("click", () => sortRows(button.dataset.sort)));
      </script>`;
  return pageChrome({ title: "Sunny Case Orders", active: "orders", updatedLabel, body });
}

function buildEventLogPage(cases, updatedLabel) {
  const body = `      <section class="page-head">
        <div class="label">Publishing</div>
        <h2>Sunny Case Tracker Status</h2>
        <p>This static site is built from the Sunny case dataset and deployed to Cloudflare Pages as <strong>sunnycasetracker.pages.dev</strong>.</p>
        <section class="stats-grid" aria-label="Publishing summary">
          <article class="stat-card"><div class="label">Cases</div><div class="stat-value">${cases.length}</div><p>Current tracked matters</p></article>
          <article class="stat-card"><div class="label">Documents</div><div class="stat-value">${totalDocuments(cases)}</div><p>Document/source rows</p></article>
          <article class="stat-card"><div class="label">Orders</div><div class="stat-value">${buildOrderRecords(cases).length}</div><p>Order/source rows</p></article>
        </section>
      </section>`;
  return pageChrome({ title: "Sunny Case Tracker Status", active: "cases", updatedLabel, body });
}

const source = readText(SOURCE_PATH);
const cases = extractCases(source);
const updatedLabel = formatUpdatedLabel(nowIso);
const homepage = rewriteTrackerPage(source);
const casesPage = rewriteTrackerPage(source, { isDetailPage: true });

writeText(INDEX_PATH, homepage);
writeText(CASES_PATH, casesPage);
writeText(SUNNY_PATH, homepage);
writeText(DOCUMENTS_PATH, buildDocumentsPage(cases, updatedLabel));
writeText(ORDERS_PATH, buildOrdersPage(cases, updatedLabel));
writeText(EVENT_LOG_PATH, buildEventLogPage(cases, updatedLabel));
writeText(
  EVENT_DATA_PATH,
  JSON.stringify(
    {
      version: 1,
      updatedAt: nowIso,
      events: [],
    },
    null,
    2
  )
);

console.log(
  `Built Sunny site with ${cases.length} cases, ${totalDocuments(cases)} document rows, and ${buildOrderRecords(cases).length} order rows.`
);
