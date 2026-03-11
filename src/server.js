/**
 * nichegolfHQ Agent — API Server
 * ----------------------------------
 * Express server that:
 *  1. Serves the chat widget (static files)
 *  2. Handles /api/chat for AI responses
 *  3. Runs the crawler on a schedule
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { chat } from "./agent.js";
import { crawl, loadKnowledgeBase } from "./crawler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      cb(new Error("Not allowed by CORS"));
    },
  })
);

app.use(express.json());
app.use(express.static(resolve(__dirname, "..", "public")));

// ── Simple in-memory rate limiter ────────────────────────────

const rateLimitMap = new Map();
const RATE_LIMIT = 20; // requests per minute per IP
const RATE_WINDOW = 60_000;

function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_WINDOW;
  }

  record.count++;
  rateLimitMap.set(ip, record);

  if (record.count > RATE_LIMIT) {
    return res.status(429).json({
      error: "Too many requests — please wait a moment and try again.",
    });
  }
  next();
}

// ── Routes ───────────────────────────────────────────────────

/**
 * POST /api/chat
 * Body: { message: string, history?: [{role, content}] }
 * Returns: { reply: string }
 */
app.post("/api/chat", rateLimit, async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required." });
    }

    if (message.length > 2000) {
      return res
        .status(400)
        .json({ error: "Message too long (max 2000 characters)." });
    }

    const reply = await chat(message.trim(), history || []);
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({
      error: "Sorry, something went wrong. Please try again in a moment.",
    });
  }
});

/** GET /api/status — health check & KB stats */
app.get("/api/status", (req, res) => {
  const kb = loadKnowledgeBase();
  res.json({
    status: "ok",
    knowledgeBase: kb
      ? {
          pages: kb.totalPages,
          lastCrawled: kb.crawledAt,
          site: kb.siteUrl,
        }
      : null,
  });
});

/** POST /api/crawl — trigger a manual re-crawl (protect in prod!) */
app.post("/api/crawl", async (req, res) => {
  // In production, add auth middleware here
  try {
    const kb = await crawl();
    res.json({ success: true, pages: kb.totalPages });
  } catch (err) {
    console.error("Crawl error:", err);
    res.status(500).json({ error: "Crawl failed." });
  }
});

// ── Scheduled crawl ──────────────────────────────────────────

const crawlHours = parseInt(process.env.CRAWL_INTERVAL_HOURS) || 24;
// Run every N hours
cron.schedule(`0 */${crawlHours} * * *`, async () => {
  console.log("⏰ Scheduled crawl starting...");
  try {
    await crawl();
  } catch (err) {
    console.error("Scheduled crawl failed:", err);
  }
});

// ── Start ────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║   🏌️  nichegolfHQ Agent — Server Running       ║
║   Port: ${String(PORT).padEnd(41)}║
║   Widget: http://localhost:${PORT}/widget.js        ║
║   Status: http://localhost:${PORT}/api/status       ║
╚═══════════════════════════════════════════════════╝
  `);

  // Run initial crawl if no knowledge base exists
  const kb = loadKnowledgeBase();
  if (!kb) {
    console.log("📡 No knowledge base found — running initial crawl...");
    crawl().catch((err) => console.error("Initial crawl failed:", err));
  }
});
