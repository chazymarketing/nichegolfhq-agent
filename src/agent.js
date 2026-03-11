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

// ── Context retrieval (lightweight keyword search) ──────────

/**
 * Finds the most relevant pages from the knowledge base using simple
 * keyword matching. In production you'd swap this for a vector DB
 * (Pinecone, Chroma, pgvector, etc.) for much better results.
 */
function findRelevantContext(question, kb, maxChunks = 5) {
  if (!kb || !kb.pages || kb.pages.length === 0) return "";

  const keywords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Score each page by keyword overlap
  const scored = kb.pages.map((page) => {
    const text = `${page.title} ${page.metaDesc} ${page.body}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const matches = text.split(kw).length - 1;
      score += matches;
    }
    return { page, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const topPages = scored.slice(0, maxChunks).filter((s) => s.score > 0);

  if (topPages.length === 0) return "";

  return topPages
    .map(
      ({ page }) =>
        `--- Source: ${page.title} (${page.url}) ---\n${page.body.slice(0, 2000)}`
    )
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

HOW TO USE CONTEXT
You may receive snippets from nichegolfhq.com and other golf sources below the user's question. Use these to give specific, sourced answers when possible. If the context is relevant, reference it. If not, rely on your general golf knowledge.

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
