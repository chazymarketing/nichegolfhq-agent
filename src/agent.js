/**
 * Golf Agent — AI Brain
 * ----------------------
 * Takes a user question, searches the local knowledge base for relevant
 * context, then sends the question + context to Claude to produce a
 * knowledgeable, friendly answer about competitive amateur golf.
 */

import Anthropic from "@anthropic-ai/sdk";
import { loadKnowledgeBase } from "./crawler.js";

const client = new Anthropic();

// ── Context retrieval (improved keyword search) ─────────────

/**
 * Synonym / related-term expansion so that questions like
 * "who is the top ranked mid-am" also match pages containing
 * "rankings", "top 10", "#1", etc.
 */
const SYNONYM_MAP = {
  ranked: ["ranking", "rankings", "top 10", "top ten", "#1", "number one", "leaderboard"],
  ranking: ["ranked", "rankings", "top 10", "top ten", "leaderboard"],
  rankings: ["ranked", "ranking", "top 10", "top ten", "leaderboard"],
  top: ["#1", "number one", "best", "leading", "first"],
  winner: ["winners", "champion", "champions", "won"],
  winners: ["winner", "champion", "champions", "won"],
  champion: ["champions", "winner", "winners", "won"],
  schedule: ["calendar", "dates", "upcoming", "events"],
  tournament: ["tournaments", "event", "events", "championship", "invitational"],
  midam: ["mid-am", "mid am", "mid amateur", "mid-amateur"],
  "mid-am": ["midam", "mid am", "mid amateur", "mid-amateur"],
  junior: ["juniors", "junior golf"],
  senior: ["seniors", "senior golf"],
  women: ["womens", "women's", "female", "ladies"],
  womens: ["women", "women's", "female", "ladies"],
  men: ["mens", "men's", "male"],
  mens: ["men", "men's", "male"],
};

/**
 * Finds the most relevant pages from the knowledge base using improved
 * keyword matching with synonym expansion and smarter scoring.
 * In production you'd swap this for a vector DB (Pinecone, Chroma,
 * pgvector, etc.) for even better results.
 */
function findRelevantContext(question, kb, maxChunks = 5) {
  if (!kb || !kb.pages || kb.pages.length === 0) return "";

  const rawKeywords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Expand keywords with synonyms for broader matching
  const expandedTerms = new Set(rawKeywords);
  for (const kw of rawKeywords) {
    const synonyms = SYNONYM_MAP[kw];
    if (synonyms) {
      for (const syn of synonyms) expandedTerms.add(syn);
    }
  }
  const allTerms = Array.from(expandedTerms);

  // Score each page by keyword overlap (original keywords weighted 2x, synonyms 1x)
  const scored = kb.pages.map((page) => {
    const text = `${page.title} ${page.metaDesc} ${page.body}`.toLowerCase();
    let score = 0;

    // Original keywords score double
    for (const kw of rawKeywords) {
      const matches = text.split(kw).length - 1;
      score += matches * 2;
    }

    // Synonym matches score single
    for (const term of allTerms) {
      if (!rawKeywords.includes(term)) {
        const matches = text.split(term).length - 1;
        score += matches;
      }
    }

    // Boost section landing pages (they contain rankings, schedules, etc.)
    if (/\/(midamgolfhq|juniorgolfhq|seniorgolfhq)\/?$/.test(page.url)) {
      score *= 1.5;
    }

    return { page, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const topPages = scored.slice(0, maxChunks).filter((s) => s.score > 0);

  if (topPages.length === 0) return "";

  // Smart extraction: if the question is about rankings, extract the rankings
  // section specifically rather than just taking the first N chars of the page
  const isRankingsQuery = /rank|top\s*10|top\s*ten|#1|number\s*one|leaderboard|best\s+player/i.test(question);

  return topPages
    .map(({ page }) => {
      let excerpt = "";

      if (isRankingsQuery) {
        // Try to find and extract the rankings section from the page body
        const rankingsStart = page.body.toLowerCase().indexOf("rankings");
        const top10Start = page.body.toLowerCase().indexOf("top 10");
        const menTop10Start = page.body.toLowerCase().indexOf("men's top 10");
        const womenTop10Start = page.body.toLowerCase().indexOf("women's top 10");

        // Find the earliest rankings-related section
        const starts = [rankingsStart, top10Start, menTop10Start, womenTop10Start]
          .filter((i) => i >= 0);

        if (starts.length > 0) {
          const start = Math.max(0, Math.min(...starts) - 100); // a bit before for context
          excerpt = page.body.slice(start, start + 5000);
        }
      }

      // Fall back to first 4000 chars if no rankings section found
      if (!excerpt) {
        excerpt = page.body.slice(0, 4000);
      }

      return `--- Source: ${page.title} (${page.url}) ---\n${excerpt}`;
    })
    .join("\n\n");
}

// ── System prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the nichegolfHQ Assistant — an AI agent that lives on nichegolfhq.com and helps people with everything related to competitive amateur golf.

PERSONALITY & TONE
- Friendly, knowledgeable, and encouraging — like a scratch-golfer friend who also knows the rulebook inside out.
- Speak conversationally but accurately. Use golf terminology naturally.
- When you don't know something, say so honestly rather than guessing.

AREAS OF EXPERTISE
- Tournament formats, schedules, and results (match play, stroke play, four-ball, etc.)
- USGA Rules of Golf and Rules of Handicapping
- Amateur status rules and eligibility
- Course ratings, slope, and handicap calculations
- State and regional amateur golf associations
- College golf recruiting and eligibility
- Equipment rules and local rules
- Tournament preparation, strategy, and mental game tips
- Golf Genius and common tournament software

IMPORTANT SITE FEATURES
- nichegolfhq.com has its own Mid-Am Rankings (Men's Top 10 and Women's Top 10), Junior Rankings, and Senior Rankings updated regularly on the section pages.
- When users ask about rankings or top players, ALWAYS look for this data in the provided context — it will contain player names, points per event (PTS/EVT), scoring average (SG), and win-loss records.
- The rankings are nichegolfHQ's own proprietary ranking system based on tournament performance.

HOW TO USE CONTEXT
You may receive snippets from nichegolfhq.com and other golf sources below the user's question. Use these to give specific, sourced answers when possible. If the context is relevant, reference it. If not, rely on your general golf knowledge. When rankings data is present in the context, cite the specific rankings with player names and stats.

GUIDELINES
- Keep answers concise but thorough — aim for 2-4 paragraphs unless more detail is needed.
- When citing rules, reference the specific rule number (e.g., "Rule 14.3" or "Handicap Rule 5.2").
- For tournament-specific questions, note if information may be outdated and suggest checking the source.
- If someone asks about something outside golf, politely redirect: "I'm built to help with competitive amateur golf — want to ask me something on that topic?"
- Never make up tournament results or scores.`;

// ── Chat function ────────────────────────────────────────────

/**
 * @param {string} userMessage   The user's question
 * @param {Array}  history       Previous messages [{role, content}, ...]
 * @returns {string}             The agent's reply
 */
export async function chat(userMessage, history = []) {
  // 1. Load knowledge base & find relevant context
  const kb = loadKnowledgeBase();
  const context = findRelevantContext(userMessage, kb);

  // 2. Build the prompt with context injection
  const augmentedMessage = context
    ? `${userMessage}\n\n--- RELEVANT SITE CONTEXT ---\n${context}`
    : userMessage;

  // 3. Build message list (keep last 10 turns for memory)
  const messages = [
    ...history.slice(-20), // last 10 exchanges (20 messages)
    { role: "user", content: augmentedMessage },
  ];

  // 4. Call Claude
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  return response.content[0].text;
}
