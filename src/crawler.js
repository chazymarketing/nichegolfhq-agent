/**
 * Web Crawler for nichegolfHQ Agent
 * -----------------------------------
 * Uses Puppeteer (headless Chrome) to crawl www.nichegolfhq.com — a Next.js
 * site with dynamic accordions, tabs, and client-side rendering.
 *
 * Site structure (discovered by inspection):
 *   /                     → Home (landing page)
 *   /midamgolfhq          → Mid-Am section with "2026 Mid-Am Major Schedule" accordion
 *   /midamgolfhq/<slug>   → Tournament detail pages with "Overview" + "Past winners" tabs
 *   /juniorgolfhq         → Junior section (similar structure)
 *   /seniorgolfhq         → Senior section (similar structure)
 *   /daily-briefs         → Daily Briefs / articles
 *
 * The crawler:
 *   1. Visits each page with a real browser (renders React/Next.js)
 *   2. Opens schedule accordions to discover tournament links
 *   3. On tournament pages, clicks EVERY tab (Overview, Past winners, etc.)
 *      and captures ALL content including past winner tables
 *   4. Follows internal links to discover all pages
 *   5. Saves everything to a JSON knowledge base
 *
 * Usage:
 *   node src/crawler.js          # one-time crawl
 *   (also triggered on a schedule from server.js)
 */

import puppeteer from "puppeteer";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
const KB_PATH = resolve(DATA_DIR, "knowledge-base.json");

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── nichegolfHQ-specific interaction ─────────────────────────

/**
 * On section pages (Mid-Am, Junior, Senior), the schedule is hidden
 * behind an accordion button like "2026 Mid-Am Major Schedule ▾".
 * This clicks it open so we can discover all tournament links.
 */
async function openScheduleAccordions(page) {
  try {
    // Find buttons that contain "Schedule" text (the accordion triggers)
    const accordionButtons = await page.$$eval("button", (buttons) =>
      buttons
        .filter((b) => /schedule/i.test(b.textContent))
        .map((b) => {
          const rect = b.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })
    );

    for (const pos of accordionButtons) {
      await page.mouse.click(pos.x, pos.y);
      await sleep(1000);
      console.log(`    📅 Opened schedule accordion`);
    }

    // Also try aria-expanded="false" buttons (generic accordions)
    const closedAccordions = await page.$$('button[aria-expanded="false"]');
    for (const btn of closedAccordions) {
      const isVisible = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (isVisible) {
        await btn.click();
        await sleep(800);
      }
    }
  } catch (err) {
    console.log(`    ⚠️  Accordion click error: ${err.message}`);
  }
}

/**
 * On tournament detail pages (e.g., /midamgolfhq/the-crump-cup),
 * there are tabs like "Overview" and "Past winners". This function
 * clicks EACH tab and collects ALL the text content from each panel,
 * ensuring we capture past winner tables and any other tabbed data.
 */
async function extractAllTabContent(page) {
  const allContent = [];

  try {
    // ── Strategy 1: Standard role="tab" elements ──────────
    const tabs = await page.$$('[role="tab"]');
    if (tabs.length > 0) {
      for (const tab of tabs) {
        try {
          const label = await tab.evaluate((el) => el.textContent.trim());
          await tab.click();
          await sleep(600);

          // Grab the visible tab panel content
          const panelText = await page.evaluate(() => {
            const panel =
              document.querySelector('[role="tabpanel"]') ||
              document.querySelector('[data-state="active"]');
            return panel?.innerText || "";
          });

          if (panelText.trim()) {
            allContent.push(`[${label}]\n${panelText.trim()}`);
            console.log(`    🔖 Tab "${label}": ${panelText.length} chars`);
          }
        } catch {
          /* tab may have gone stale */
        }
      }
      return allContent;
    }

    // ── Strategy 2: Button-based tabs (common in custom Next.js) ─
    // Look for adjacent buttons that look like tabs (e.g., "Overview" | "Past winners")
    const tabLikeButtons = await page.$$eval("button", (buttons) => {
      // Find groups of sibling buttons that look like tab controls
      const tabGroups = [];
      const seen = new Set();

      for (const btn of buttons) {
        if (seen.has(btn)) continue;
        const parent = btn.parentElement;
        if (!parent) continue;

        const siblings = Array.from(parent.querySelectorAll("button"));
        if (siblings.length >= 2 && siblings.length <= 8) {
          const labels = siblings.map((s) => s.textContent.trim());
          // Heuristic: if siblings include "Overview" or "Past winners", it's tabs
          const looksLikeTabs = labels.some((l) =>
            /overview|past winner|schedule|results|history|details/i.test(l)
          );
          if (looksLikeTabs) {
            tabGroups.push(
              siblings.map((s) => {
                const r = s.getBoundingClientRect();
                return {
                  label: s.textContent.trim(),
                  x: r.x + r.width / 2,
                  y: r.y + r.height / 2,
                };
              })
            );
            siblings.forEach((s) => seen.add(s));
          }
        }
      }
      return tabGroups;
    });

    for (const group of tabLikeButtons) {
      for (const tab of group) {
        await page.mouse.click(tab.x, tab.y);
        await sleep(800);

        // Capture whatever content is now visible below the tabs
        const contentText = await page.evaluate(() => {
          const main =
            document.querySelector("main") ||
            document.querySelector("#__next") ||
            document.body;
          return main?.innerText || "";
        });

        if (contentText.trim()) {
          allContent.push(`[${tab.label}]\n${contentText.trim()}`);
          console.log(`    🔖 Tab "${tab.label}": ${contentText.length} chars`);
        }
      }
    }
  } catch (err) {
    console.log(`    ⚠️  Tab extraction error: ${err.message}`);
  }

  return allContent;
}

// ── Page Extraction ──────────────────────────────────────────

/**
 * Full page extraction pipeline:
 *  1. Navigate and wait for Next.js render
 *  2. Dismiss any cookie/privacy banners
 *  3. Open schedule accordions (on section pages)
 *  4. Click through all tabs (on tournament detail pages)
 *  5. Extract all visible text + internal links
 */
async function extractPageContent(page, url) {
  try {
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    await page.waitForSelector("body", { timeout: 5000 });
    await sleep(2000); // let Next.js hydrate fully

    // ── Dismiss privacy/cookie banners ──────────────────
    try {
      // Look for common dismiss buttons — your site uses Ketch
      const dismissSelectors = [
        'button:has-text("Do Not Sell")',
        'button:has-text("Accept")',
        '[aria-label="Close"]',
        '.privacy-banner button',
      ];
      for (const sel of dismissSelectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          await sleep(500);
          break;
        }
      }
      // Also try the X button on any modal
      const closeButtons = await page.$$('button');
      for (const btn of closeButtons) {
        const text = await btn.evaluate(el => el.textContent.trim());
        if (text === '×' || text === 'X' || text === '✕') {
          await btn.click();
          await sleep(300);
          break;
        }
      }
    } catch {
      /* no banner — that's fine */
    }

    // ── Detect page type and apply appropriate strategy ──

    const pageUrl = page.url();
    const isSectionPage =
      /\/(midamgolfhq|juniorgolfhq|seniorgolfhq)\/?$/.test(pageUrl);
    const isTournamentDetail =
      /\/(midamgolfhq|juniorgolfhq|seniorgolfhq)\/[a-z]/.test(pageUrl);

    // Open schedule accordions on section pages (Mid-Am, Junior, Senior)
    if (isSectionPage) {
      console.log(`    📋 Section page — opening schedule accordions`);
      await openScheduleAccordions(page);
      await sleep(1000);
    }

    // Click through all tabs on tournament detail pages
    let tabContent = [];
    if (isTournamentDetail) {
      console.log(`    🏆 Tournament page — clicking through all tabs`);
      tabContent = await extractAllTabContent(page);
    }

    // ── Extract the full page content ────────────────────
    const data = await page.evaluate(() => {
      // Remove noise
      document
        .querySelectorAll("script, style, noscript, iframe")
        .forEach((el) => el.remove());

      const title = document.title || "";
      const metaDesc =
        document.querySelector('meta[name="description"]')?.content || "";

      const mainEl =
        document.querySelector("main") ||
        document.querySelector("#__next") ||
        document.body;

      const body = mainEl?.innerText || "";

      // Collect ALL links (internal + external) for discovery
      const links = [];
      document.querySelectorAll("a[href]").forEach((a) => {
        try {
          links.push(new URL(a.href, window.location.origin).href);
        } catch {
          /* skip */
        }
      });

      return { title, metaDesc, body, links };
    });

    // Combine base page text with all tab content for maximum coverage
    const combinedBody = [
      data.body,
      ...tabContent,
    ]
      .join("\n\n")
      .replace(/\s+/g, " ")
      .trim();

    return {
      url: pageUrl,
      title: data.title.trim(),
      metaDesc: data.metaDesc.trim(),
      body: combinedBody.slice(0, 15000), // generous limit per page
      links: data.links,
    };
  } catch (err) {
    console.log(`    ⚠️  Failed: ${err.message}`);
    return null;
  }
}

// ── Main Crawler ─────────────────────────────────────────────

export async function crawl(options = {}) {
  const {
    siteUrl = process.env.SITE_URL || "https://www.nichegolfhq.com",
    maxPages = parseInt(process.env.MAX_PAGES) || 200,
    extraSources = (process.env.EXTRA_SOURCES || "").split(",").filter(Boolean),
  } = options;

  console.log(`\n🏌️  nichegolfHQ Crawler (Puppeteer)`);
  console.log(`   Site:       ${siteUrl}`);
  console.log(`   Max pages:  ${maxPages}`);
  console.log(`   Extras:     ${extraSources.length} source(s)\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (compatible; NicheGolfBot/1.0; +https://www.nichegolfhq.com)"
  );

  // Seed the queue with all main sections
  const visited = new Set();
  const queue = [
    siteUrl,
    `${siteUrl}/midamgolfhq`,
    `${siteUrl}/juniorgolfhq`,
    `${siteUrl}/seniorgolfhq`,
    `${siteUrl}/daily-briefs`,
    ...extraSources,
  ];
  const pages = [];
  const siteOrigin = new URL(siteUrl).origin;

  while (queue.length > 0 && visited.size < maxPages) {
    const url = queue.shift();
    const normalized = url.split("#")[0].split("?")[0];

    if (visited.has(normalized)) continue;
    visited.add(normalized);

    console.log(`  📄 [${visited.size}/${maxPages}] ${normalized}`);

    const pageData = await extractPageContent(page, normalized);

    if (pageData) {
      pages.push({
        url: pageData.url,
        title: pageData.title,
        metaDesc: pageData.metaDesc,
        body: pageData.body,
        crawledAt: new Date().toISOString(),
      });

      // Follow internal links for deep crawl
      for (const link of pageData.links) {
        const linkNorm = link.split("#")[0].split("?")[0];
        if (linkNorm.startsWith(siteOrigin) && !visited.has(linkNorm)) {
          queue.push(linkNorm);
        }
      }
    }

    // Be polite between requests
    await sleep(1500);
  }

  await browser.close();

  // ── Save knowledge base ──────────────────────────────────

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const kb = {
    crawledAt: new Date().toISOString(),
    siteUrl,
    totalPages: pages.length,
    pages,
  };

  writeFileSync(KB_PATH, JSON.stringify(kb, null, 2));
  console.log(`\n✅ Crawled ${pages.length} pages → ${KB_PATH}\n`);
  return kb;
}

/** Load the most recent knowledge base from disk */
export function loadKnowledgeBase() {
  if (!existsSync(KB_PATH)) return null;
  return JSON.parse(readFileSync(KB_PATH, "utf-8"));
}

// ── CLI entry ────────────────────────────────────────────────

const isMain = process.argv[1]?.endsWith("crawler.js");
if (isMain) {
  const { config } = await import("dotenv");
  config();
  crawl();
                                                                      }
